import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parse as parseToml} from 'smol-toml'

export const nativeJson=(file:string):Record<string,any>=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{}
export const claudeConfigRoot=()=>process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude')
export const clineDataRoot=()=>process.env.CLINE_DATA_DIR||path.join(process.env.CLINE_DIR||path.join(os.homedir(),'.cline'),'data')
export const piConfigRoot=()=>process.env.PI_CODING_AGENT_DIR||path.join(os.homedir(),'.pi','agent')
export const nativeClaudeSettings=()=>nativeJson(path.join(claudeConfigRoot(),'settings.json'))
export function nativeCodexSettings(){const file=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml');if(!fs.existsSync(file))return {};const data=parseToml(fs.readFileSync(file,'utf8')) as Record<string,any>;return {...data,...(data.profile?data.profiles?.[data.profile]:{})}}

/** Read the native Cline profile shared by its CLI and VS Code extension. Never write it. */
export function nativeClineConnection(){
 const root=clineDataRoot(),file=process.env.CLINE_PROVIDER_SETTINGS_PATH||path.join(root,'settings/providers.json'),profiles=nativeJson(file)
 const id=profiles.lastUsedProvider,entry=profiles.providers?.[id],settings=entry?.settings
 if(!settings)return undefined
 const registry=nativeJson(path.join(root,'settings/models.json')).providers?.[id]
 const models=Object.values(registry?.models??{}) as {id:string;name?:string}[]
 return {root,file,id,provider:String(settings.provider||id),model:String(settings.model||registry?.provider?.defaultModelId||''),baseUrl:settings.baseUrl||registry?.provider?.baseUrl,apiKey:settings.apiKey as string|undefined,settings,profiles,models}
}

/** Pi keeps provider/model/auth files in its native Agent directory; sessions remain separate. */
export function nativePiConnection(){
 const root=piConfigRoot(),settings=nativeJson(path.join(root,'settings.json')),models=nativeJson(path.join(root,'models.json')),auth=nativeJson(path.join(root,'auth.json'))
 const id=settings.defaultProvider,entry=models.providers?.[id]
 if(!id)return undefined
 const credential=auth[id]
 const apiKey=typeof entry?.apiKey==='string'&&!entry.apiKey.startsWith('!')&&!entry.apiKey.startsWith('$')?entry.apiKey:credential?.type==='api_key'?credential.key:undefined
 return {root,id:String(id),provider:String(id),model:String(settings.defaultModel||entry?.models?.[0]?.id||''),baseUrl:entry?.baseUrl,apiKey,entry,settings,models,auth,credentialConfigured:!!entry?.apiKey||!!credential}
}

/** Only connection files are mirrored; native histories, prompts, skills and task policies are untouched. */
export function copyNativeConnection(file:string,target:string){
 if(!fs.existsSync(file))return
 const data=fs.readFileSync(file)
 if(fs.existsSync(target)&&fs.readFileSync(target).equals(data)){fs.chmodSync(target,0o600);return}
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700})
 if(fs.existsSync(target)&&!fs.existsSync(target+'.before-native')){fs.copyFileSync(target,target+'.before-native');fs.chmodSync(target+'.before-native',0o600)}
 fs.writeFileSync(target,data,{mode:0o600})
 fs.chmodSync(target,0o600)
}
