import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {deepseekConfig} from './deepseek-config'
export type NativeAcpEngine='opencode'|'kilo'|'deepseek'
/** JSONC strings are consumed as tokens so URLs and quoted comment markers stay intact. */
export function readCodeJson(file:string):Record<string,any>{
 if(!fs.existsSync(file))return {}
 return JSON.parse(fs.readFileSync(file,'utf8').replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|,\s*(?=[}\]])/g,token=>token.startsWith('"')?token:''))
}
export function codeConfig(engine:NativeAcpEngine){
 if(engine==='deepseek')return deepseekConfig()
 const root=path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),engine),files=[path.join(root,engine+'.json'),path.join(root,engine+'.jsonc')]
 let data:Record<string,any>={}
 for(const file of files){const next=readCodeJson(file);data={...data,...next,provider:{...data.provider,...next.provider}}}
 const extra=process.env[engine.toUpperCase()+'_CONFIG'];if(extra){files.push(extra);const next=readCodeJson(extra);data={...data,...next,provider:{...data.provider,...next.provider}}}
 const content=process.env[engine.toUpperCase()+'_CONFIG_CONTENT'];if(content){const next=JSON.parse(content);data={...data,...next,provider:{...data.provider,...next.provider}}}
 const authFile=path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),engine,'auth.json'),auth=readCodeJson(authFile)
 const providers=Object.fromEntries(Object.entries(data.provider??{}).filter(([id])=>(!data.enabled_providers||data.enabled_providers.includes(id))&&!data.disabled_providers?.includes(id))) as Record<string,any>
 return {root,files:files.filter(file=>fs.existsSync(file)),data,providers,auth,authFile,model:data.model as string|undefined}
}
export function codeCredential(value:unknown){
 if(typeof value!=='string')return undefined
 const file=value.match(/^\{file:(.+)\}$/);if(file){const target=file[1].replace(/^~(?=\/)/,os.homedir());return fs.existsSync(target)?fs.readFileSync(target,'utf8').trim():undefined}
 const env=value.match(/^\{env:(.+)\}$/);return env?process.env[env[1]]:value
}
export function codeHasCredential(engine:NativeAcpEngine){const config=codeConfig(engine);return Object.values(config.providers).some(p=>!!codeCredential(p.options?.apiKey))||Object.keys(config.auth).length>0}
