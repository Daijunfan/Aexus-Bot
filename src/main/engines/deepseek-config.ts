import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parse,stringify} from 'yaml'

export const deepseekHome=()=>process.env.DSH_HOME||path.join(os.homedir(),'.dsh')
function yaml(file:string):any{
 if(!fs.existsSync(file))return undefined
 try{return parse(fs.readFileSync(file,'utf8'),{maxAliasCount:20,logLevel:'silent'})}catch{throw Error('Invalid DeepSeek Harness configuration: '+path.basename(file))}
}
/** Import connection settings only. Never import native tools, policies, or sessions. */
export function deepseekConfig(){
 const root=deepseekHome(),files=[path.join(root,'profiles/acp/cordis.patch.yml'),path.join(root,'cordis.patch.yml')].filter(f=>fs.existsSync(f))
 const rows=new Map<string,any>()
 for(const file of files){const patch=yaml(file);if(!Array.isArray(patch))throw Error('DeepSeek Harness patch must be a list');for(const row of patch)if(['acp','llm-deepseek'].includes(row?.id)&&row.config)rows.set(row.id,{id:row.id,config:row.config})}
 const authFile=path.join(root,'.credentials.yaml'),credentials=yaml(authFile)??{}
 if(credentials.version!==undefined&&credentials.version!==1)throw Error('Unsupported DeepSeek Harness credential store version')
 const storedKey=credentials.version===1?credentials.refs?.DEEPSEEK_API_KEY:credentials.DEEPSEEK_API_KEY
 if(storedKey!==undefined&&(typeof storedKey!=='string'||!storedKey))throw Error('Invalid DeepSeek Harness API-key reference')
 const key=storedKey??process.env.DEEPSEEK_API_KEY
 const acp=rows.get('acp')?.config??{provider:'deepseek-official',model:'deepseek-v4-flash'},provider=acp.provider??'deepseek-official'
 const connection=rows.get('llm-deepseek')?.config??{}
 if(provider!=='deepseek-official'||connection.apiKeyEnv&&connection.apiKeyEnv!=='DEEPSEEK_API_KEY')throw Error('DeepSeek Harness adapter requires the native deepseek-official API-key route using DEEPSEEK_API_KEY')
 return {root,files,rows:[...rows.values()],data:{} as Record<string,any>,authFile,auth:(typeof key==='string'&&key?{[provider]:{key}}:{}) as Record<string,any>,providers:{[provider]:{name:'DeepSeek Harness native configuration',options:{baseURL:connection.baseURL??connection.baseUrl},models:{}}} as Record<string,any>,model:typeof acp.model==='string'?JSON.stringify([provider,acp.model]):undefined}
}
/** The guard runs before every tool body, including nested dispatch. */
export const deepseekGuardSource=`export const inject = ['tools','approval'];
export function apply(ctx) {
 ctx.on('tools/execute', async (exec, next) => {
  if (!exec.agent || exec.signal.aborted) throw Error('No active Aexus employee turn');
  if (/subagent|spawn_agent|fork_agent|schedule|workflow|plugin|cordis|run_code/i.test(exec.name)) throw Error('Unsupported Aexus delegated tool');
  const outcome = await ctx.approval.request({agent:exec.agent,callId:exec.callId,toolName:exec.name,reason:'Aexus Core tool authorization',signal:exec.signal});
  if (outcome !== 'allowed-once' || exec.signal.aborted) throw Error('Aexus Core denied tool execution');
  return next();
 });
 ctx.provide('aexusGuard', true);
}
`;
export function prepareDeepseek(directory:string){
 const config=deepseekConfig();fs.mkdirSync(directory,{recursive:true,mode:0o700})
 const write=(file:string,content:string)=>{fs.writeFileSync(path.join(directory,file),content,{mode:0o600});fs.chmodSync(path.join(directory,file),0o600)}
 // Credentials remain in the employee-private runtime, never in source or logs.
 const key=Object.values(config.auth)[0]?.key
 write('.credentials.yaml',stringify({version:1,refs:key?{DEEPSEEK_API_KEY:key}:{}}))
 write('aexus-guard.mjs',deepseekGuardSource)
 const disabled=['tool-subagent','tool-subagent-fork','tool-subagent-control','tool-subagent-list-agents','tool-workflow','tool-plugin-manager']
 const patch=[...config.rows,
  ...disabled.map(id=>({id,disabled:true})),
  {id:'tools',config:{mode:'native'}},
  {id:'permission',config:{presets:{'workspace-write':{sandbox:'workspace-write',approval:'ask'}},defaultPreset:'workspace-write'}},
  {id:'approval',config:{policy:'ask'}},
  {insert:[{id:'aexus-guard',name:path.join(directory,'aexus-guard.mjs')}]},
  {id:'acp',inject:['acpAppStartup','aexusGuard'],config:config.rows.find(r=>r.id==='acp')?.config??{provider:'deepseek-official',model:'deepseek-v4-flash'}}]
 write('cordis.patch.yml',stringify(patch))
 return {env:{DSH_HOME:directory,DSH_PERMISSION_MODE:'workspace-write',DSH_TELEMETRY_MODE:'DISABLED'},args:['--profile','acp'],secrets:key?[key]:[]}
}
