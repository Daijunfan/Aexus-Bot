import {nativeClaudeSettings,claudeConfigRoot,nativeJson} from './engines/native-config'
import {engineProcessEnvironment,usesNativeConfiguration} from './engines/configuration'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type {Options} from '@anthropic-ai/claude-agent-sdk'
import type {EffortLevel,ModelInfo} from '../shared/types'

export const claudeUserSettings=nativeClaudeSettings

/** Detect the provider, including gateways that keep Claude IDs but label the routed models. */
export function deepSeekProvider(cwd?:string){
  let settings=claudeUserSettings()
  for(const name of cwd?['settings.json','settings.local.json']:[]){
    const file=path.join(cwd!,'.claude',name)
    if(fs.existsSync(file)){const local=JSON.parse(fs.readFileSync(file,'utf8'));settings={...settings,...local,env:{...settings.env,...local.env}}}
  }
  const env=engineProcessEnvironment('claude',{...settings.env,...process.env})
  const deepseek=/api\.deepseek\.com/i.test(env.ANTHROPIC_BASE_URL??'')||Object.entries(env).some(([key,value])=>/^ANTHROPIC_.*MODEL(?:_NAME)?$/.test(key)&&/^deepseek-/i.test(String(value)))
  const customPicker=usesNativeConfiguration('claude')&&!!settings.modelPicker?.options?.some((option:any)=>!/^deepseek-(flash|v4-pro)(\[1m\])?$/i.test(option.model))
  return deepseek?{env,defaultModel:settings.model as string|undefined,settings,customPicker}:undefined
}
export type DeepSeekProvider=NonNullable<ReturnType<typeof deepSeekProvider>>
export const deepSeekModels:ModelInfo[]=[
  {value:'deepseek-flash',displayName:'DeepSeek Flash',description:'Text & image input · 1M context · Thinking: off / low / high / max',inputModalities:['text','image']},
  {value:'deepseek-v4-pro',displayName:'DeepSeek V4 Pro',description:'Text only · 1M context · Thinking: off / low / high / max',inputModalities:['text']}
].map(m=>({...m,supportsEffort:true,supportedEffortLevels:['low','high','max'],defaultEffort:'high',supportsAdaptiveThinking:true,supportsFastMode:false}))

export function deepSeekModel(provider:DeepSeekProvider,model?:string):string{
  if(provider.customPicker){const requested=model&&model!=='default'?model:provider.env.ANTHROPIC_MODEL||provider.defaultModel;const option=provider.settings.modelPicker.options.find((m:any)=>m.model.replace(/\[1m\]$/i,'')===requested?.replace(/\[1m\]$/i,''));if(option)return option.model}
  let value=(model&&model!=='default'?model:provider.env.ANTHROPIC_MODEL||provider.defaultModel||'opus').replace(/\[1m\]$/i,'')
  for(const alias of ['haiku','sonnet','opus','fable']){
    const prefix='ANTHROPIC_DEFAULT_'+alias.toUpperCase()+'_MODEL'
    if(value===alias||value===String(provider.env[prefix]??'').replace(/\[1m\]$/i,'')||value.startsWith('claude-'+alias)){
      value=provider.env[prefix+'_NAME']||provider.env[prefix]||(alias==='haiku'?'deepseek-flash':'deepseek-v4-pro');break
    }
  }
  if(/deepseek-(?:v4(?:\.1)?-)?flash/i.test(value)||value.startsWith('claude-haiku'))return 'deepseek-flash'
  if(/deepseek-v4-pro/i.test(value)||/^claude-(opus|sonnet|fable)/.test(value))return 'deepseek-v4-pro'
  throw new Error('DeepSeek 仅支持 deepseek-flash 和 deepseek-v4-pro')
}
export function deepSeekEffort(effort?:EffortLevel):EffortLevel|undefined{
  if(effort===undefined)return undefined
  return ['max','ultra'].includes(effort)?'max':['minimal','low'].includes(effort)?'low':'high'
}
/** Native model handling controls effort support; the outgoing model ID stays DeepSeek. */
export const deepSeekPicker:NonNullable<Options['settings']&object>={modelPicker:{replaceBuiltInOptions:true,options:deepSeekModels.map(m=>({model:m.value,label:m.displayName,description:m.description,behavesAs:'claude-opus-4-6'}))}}

export const claudeProviderPicker=(provider:DeepSeekProvider)=>provider.customPicker?{modelPicker:provider.settings.modelPicker}:deepSeekPicker

/** The native router maps Claude max to OpenAI xhigh; expose the upstream name. */
function openAIRoute(model?:string){return !!model&&nativeJson(path.join(claudeConfigRoot(),'model-router/routes.json')).routes?.[model.replace(/\[1m\]$/i,'')]?.adapter==='openai'}
export function claudeModelCatalog(models:ModelInfo[]):ModelInfo[]{
 return models.map(model=>openAIRoute(model.resolvedModel??model.value)?{...model,supportedEffortLevels:model.supportedEffortLevels?.map(e=>e==='max'?'xhigh':e),defaultEffort:model.defaultEffort==='max'?'xhigh':model.defaultEffort}:model)
}
export function claudeWireEffort(provider:DeepSeekProvider|undefined,model:string|undefined,effort?:EffortLevel|null):EffortLevel|undefined{
 if(effort==null)return undefined
 if(provider?.customPicker)return openAIRoute(model)&&effort==='xhigh'?'max':effort
 return provider?deepSeekEffort(effort):effort
}
