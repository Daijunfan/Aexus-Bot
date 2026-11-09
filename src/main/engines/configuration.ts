import {nativeClineConnection,nativePiConnection,nativeClaudeSettings} from './native-config'
import fs from 'node:fs'
import path from 'node:path'
import {APP_HOME} from '../../shared/protocol'
import {isEngine,isNativeAcp,type EngineId} from '../../shared/engines'
import {deepseekHasCredential} from './deepseek-config'
import {codeHasCredential} from './opencode-config'
import {atomicJson,readJson} from '../atomic-file'
export type Config={inheritNative?:boolean;sharedClineConfig?:boolean;sharedPiConfig?:boolean;path?:string;managedPath?:string;sdkPath?:string;baseUrl?:string;model?:string;secret?:string}
const directory=path.join(APP_HOME,'engines'),file=path.join(directory,'settings.json')
const all=()=>readJson<Partial<Record<EngineId,Config>>>(file,()=>({}))
export const engineConfiguration=(engine:EngineId)=>all()[engine]??{}
export function usesNativeConfiguration(_engine:EngineId){return true}
export function processProvider(engine:'cline'|'pi'){
  const native=usesNativeConfiguration(engine)?engine==='cline'?nativeClineConnection():nativePiConnection():undefined
  if(native)return {provider:native.provider,model:native.model,baseUrl:native.baseUrl,native:true,models:engine==='cline'?nativeClineConnection()?.models??[]:nativePiConnection()?.entry?.models??[],managedReasoning:true,thinkingLevel:engine==='pi'?nativePiConnection()?.settings.defaultThinkingLevel:undefined}
  return {native:true,models:[],provider:'',model:'',baseUrl:undefined,managedReasoning:true,thinkingLevel:undefined}
}
export function publicEngineConfiguration(engine:EngineId){
 const {secret,...config}=engineConfiguration(engine),inheritNative=usesNativeConfiguration(engine),native=inheritNative?engine==='cline'?nativeClineConnection():engine==='pi'?nativePiConnection():undefined:undefined
 const claude=engine==='claude'&&inheritNative?nativeClaudeSettings():undefined
 const hasApiKey=inheritNative?engine==='deepseek'?deepseekHasCredential():isNativeAcp(engine)?codeHasCredential(engine):engine==='claude'?!!(claude?.env?.ANTHROPIC_AUTH_TOKEN||claude?.env?.ANTHROPIC_API_KEY||claude?.apiKeyHelper):engine==='pi'?!!nativePiConnection()?.credentialConfigured:!!native?.apiKey:!!secret
 const {baseUrl,model,...nativeConfig}=config
 return {...nativeConfig,inheritNative,hasApiKey}
}
export function configureEngine(engine:EngineId,patch:{inheritNative?:boolean;path?:string;sdkPath?:string;baseUrl?:string;model?:string;apiKey?:string}){
  if(!isEngine(engine)||!patch||Object.keys(patch).some(k=>!['inheritNative','path','sdkPath','baseUrl','model','apiKey'].includes(k)))throw Error('Invalid engine configuration')
  if(patch.inheritNative===false||['baseUrl','model','apiKey'].some(key=>key in patch))throw Error('Coding Agent engines use their native CLI configuration; configure providers in the native client')
  const data=all(),value={...data[engine]}
  delete value.baseUrl;delete value.model;delete value.secret
  if(patch.inheritNative!==undefined&&typeof patch.inheritNative!=='boolean')throw Error('inheritNative must be boolean')
  if(patch.inheritNative!==undefined)value.inheritNative=patch.inheritNative
  if(patch.path!==undefined){if(patch.path&&(!path.isAbsolute(patch.path)||!fs.existsSync(patch.path)||!fs.statSync(patch.path).isFile()))throw Error('Choose an existing executable on the Core host');value.path=patch.path||undefined}
  if(patch.sdkPath!==undefined){if(engine!=='claude'||patch.sdkPath&&(!path.isAbsolute(patch.sdkPath)||!fs.existsSync(patch.sdkPath)||!fs.statSync(patch.sdkPath).isFile()))throw Error('Choose an existing Claude Agent SDK module on the Core host');value.sdkPath=patch.sdkPath||undefined}
  data[engine]=value;atomicJson(file,data,true);return publicEngineConfiguration(engine)
}
export function setManagedEngine(engine:EngineId,executable:string,sdkPath?:string){const data=all();data[engine]={...data[engine],path:undefined,managedPath:executable,...(sdkPath?{sdkPath}:{})};atomicJson(file,data,true)}
/** Provider credentials never cross engine boundaries. Process adapters use saved keys only. */
export function engineProcessEnvironment(engine:EngineId,base:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  const env={...base},processAdapter=engine==='cline'||engine==='pi'
  for(const name of Object.keys(env)){
    const claude=/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CONFIG_DIR$|CLAUDE_API_KEY$|CLAUDE_CODE_API_KEY$)/.test(name)
    const openai=name.startsWith('OPENAI_'),processKey=['CLINE_API_KEY','DEEPSEEK_API_KEY','PI_API_KEY'].includes(name)
    if(processKey&&!(engine==='deepseek'&&name==='DEEPSEEK_API_KEY')||claude&&engine!=='claude'||openai&&(processAdapter||engine==='claude'||engine==='deepseek'))delete env[name]
  }
  return {...env,...engineEnvironment(engine)}
}
export function engineEnvironment(engine:EngineId):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={},native=engine==='cline'?nativeClineConnection():engine==='pi'?nativePiConnection():undefined
  if(native?.apiKey&&(engine==='cline'||native.provider==='deepseek'))env[engine==='cline'?'CLINE_API_KEY':'DEEPSEEK_API_KEY']=native.apiKey
  return env
}
