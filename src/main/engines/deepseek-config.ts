import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parse} from 'yaml'
import {applicationRoot} from '../resources'
import type {PermissionMode} from '../../shared/types'

export const deepseekHome=()=>path.resolve(process.env.DSH_HOME?.trim()||path.join(os.homedir(),'.dsh'))
const yaml=(file:string)=>{if(!fs.existsSync(file))return undefined;try{return parse(fs.readFileSync(file,'utf8'),{customTags:[{tag:'tag:yaml.org,2002:js',resolve:(value:string)=>value}]})}catch{throw Error('Cannot read native DeepSeek Harness configuration: '+file)}}
/** Only native configuration is read. Secrets never enter a public catalog. */
export function deepseekConfiguration(){
 const root=deepseekHome(),files=[path.join(root,'cordis.patch.yml'),path.join(root,'profiles/acp/cordis.patch.yml'),path.join(root,'.credentials.yaml')]
 const patches=files.slice(0,2).flatMap(file=>{const value=yaml(file);return Array.isArray(value)?value:[]}),provider=patches.filter(entry=>entry.id==='llm-deepseek').at(-1)?.config??{}
 const credentials=yaml(files[2])??{},secrets:string[]=[]
 const collect=(value:unknown)=>{if(typeof value==='string'&&value.length>8)secrets.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collect)}
 collect(credentials)
 const keyEnv=typeof provider.apiKeyEnv==='string'?provider.apiKeyEnv:'DEEPSEEK_API_KEY'
 if(process.env[keyEnv])secrets.push(process.env[keyEnv]!)
 return {root,files:files.filter(file=>fs.existsSync(file)),baseUrl:typeof provider.baseURL==='string'?provider.baseURL:undefined,secrets,hasCredential:secrets.length>0}
}
export function deepseekHasCredential(){try{return deepseekConfiguration().hasCredential}catch{return false}}
export const deepseekPermission=(mode:PermissionMode)=>mode==='bypassPermissions'?'danger-full-access':mode==='acceptEdits'?'workspace-write':'read-only'
/** Preserve native providers/credentials; isolate employee persistence and disable native delegation. */
export function deepseekLaunch(directory:string,cwd:string,permissionMode:PermissionMode='default'){
 fs.mkdirSync(directory,{recursive:true,mode:0o700})
 const policy=path.join(directory,'aexus-policy.mjs');fs.writeFileSync(policy,fs.readFileSync(path.join(applicationRoot(),'bin/deepseek-policy.mjs')),{mode:0o600})
 const entries=[
  {insert:[{id:'aexus-policy',name:policy,config:{preset:deepseekPermission(permissionMode),dontAsk:permissionMode==='dontAsk'}}]},
  {id:'acp',inject:['acpAppStartup','permissionPresets','aexusDeepseekPolicy']},
  {id:'permission',config:{defaultPreset:deepseekPermission(permissionMode),presets:{'read-only':{sandbox:'read-only',approval:'ask'},'workspace-write':{sandbox:'workspace-write',approval:'ask'},'danger-full-access':{sandbox:'danger-full-access',approval:'never'}}}},
  {id:'session-persistence-jsonl',config:{root:path.join(directory,'sessions')}},
  {id:'storage-json',config:{root:path.join(directory,'storages')}},
  {id:'attachment-local',config:{dshHome:directory}},
  {id:'sandbox-policy',config:{mode:deepseekPermission(permissionMode),workspaceRoot:cwd}},
  {id:'approval',config:{policy:permissionMode==='dontAsk'?'never':'ask'}},
  ...['tool-subagent','tool-subagent-fork','tool-subagent-control','tool-workflow','workflow-ptc','tool-goal','goal-round-driver','command-goal','subagent-spawn-in-process','subagent-fork-in-process','session-title-llm','session-telemetry-otel','hmr'].map(id=>({id,disabled:true}))
 ]
 const file=path.join(directory,'aexus.patch.json');fs.writeFileSync(file,JSON.stringify(entries,null,2)+'\n',{mode:0o600})
 return {args:['--profile','acp','--patch',file],env:{DSH_PERMISSION_MODE:deepseekPermission(permissionMode),DSH_TELEMETRY_DISABLED:'1'},secrets:deepseekConfiguration().secrets}
}
export function deepseekModel(value:string){const pair=JSON.parse(value);if(!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string'))throw Error('Invalid native DeepSeek model option');return pair.join('/')}
