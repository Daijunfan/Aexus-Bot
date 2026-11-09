import {ENGINE_DEFINITIONS} from '../../shared/engines'
import {activeModel,mergeCommands} from '../../shared/engine-commands'
import type {Engine,ModelInfo,SlashCommand} from '../../shared/types'
import type {WorkerConfigOption,WorkerFeatures} from '../../shared/worker-controls'
export function workerFeatures(engine:Engine):WorkerFeatures{const value=ENGINE_DEFINITIONS[engine].capabilities;return {plan:value.plan,thinking:value.thinking,fast:false,steer:value.steer,images:engine==='pi'||value.images,background:value.background,fork:engine==='pi'||value.clone,compact:engine==='codex'||engine==='claude'||engine==='pi',review:engine==='codex',sections:['capabilities','config',...(engine==='codex'||engine==='claude'?['skills','mcp','account','usage']:['skills','usage'])]}}
export function workerCommands(engine:Engine,features:WorkerFeatures,native:SlashCommand[],models:ModelInfo[],model?:string){
 const result=new Map(mergeCommands(native,engine,activeModel(models,model)).map(command=>[command.name,{...command}]))
 for(const [flag,names] of [['plan',['plan','normal']],['thinking',['thinking']],['fast',['fast']],['fork',['fork']],['compact',['compact']],['review',['review']],['background',['ps','stop']]] as const){if(!features[flag])for(const name of names)result.delete(name)}
 for(const section of ['skills','mcp','account','usage']){if(features.sections.includes(section))result.set(section,{name:section,description:{skills:'Skills and native commands',mcp:'Native MCP services',account:'Native account',usage:'Native usage and quota'}[section]!,argumentHint:''});else result.delete(section)}
 if(features.compact)result.set('compact',{name:'compact',description:'Compact native conversation context',argumentHint:engine==='pi'?'[instructions]':''})
 if(features.background){result.set('ps',{name:'ps',description:'Native background processes',argumentHint:''});result.set('stop',{name:'stop',description:'Stop this Worker’s background processes',argumentHint:''})}
 if(features.thinking)result.set('thinking',{name:'thinking',description:'Native thinking mode',argumentHint:'[on|off|status]'})
 result.set('new',{name:'new',aliases:['clear'],description:'New Worker context; retain archived history',argumentHint:''})
 result.set('config',{name:'config',description:'Native model, execution and engine configuration',argumentHint:''})
 result.set('history',{name:'history',description:'Archived Worker contexts',argumentHint:''})
 result.set('export',{name:'export',description:'Export Worker conversation',argumentHint:''})
 if(features.fork)result.set('fork',{name:'fork',description:'Fork into an independent Worker',argumentHint:'<title>'})
 const defaults={plan:'Native plan mode',normal:'Return to execution mode',help:'Available Worker commands',model:'Native model selection',effort:'Native reasoning effort',permissions:'Worker execution permissions',status:'Worker status and configuration'}
 for(const [name,description] of Object.entries(defaults)){const item=result.get(name);if(item)item.description=description}
 return [...result.values()]
}
export function acpWorkerOptions(session:any):WorkerConfigOption[]{return (session?.configOptions??[]).map((option:any)=>({id:option.id,name:option.name??option.id,type:option.type??'select',currentValue:String(option.currentValue??''),description:option.description,options:(option.options??[]).flatMap((value:any)=>value.options??[value]).map((value:any)=>({value:String(value.value),name:value.name??String(value.value),description:value.description}))})).filter((option:WorkerConfigOption)=>!/(key|password|token|secret|credential)/i.test(option.id))}
/** Native configuration is useful to inspect; credential values stay on the Core host. */
export function workerPublicData(value:any):any{if(Array.isArray(value))return value.map(workerPublicData);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(api.?key|authorization|token|secret|password|credential|headers)/i.test(key)&&typeof item!=='number'&&typeof item!=='boolean'?'[redacted]':workerPublicData(item)]));if(typeof value==='string'&&/^https?:\/\//.test(value)){try{const url=new URL(value);url.username='';url.password='';for(const key of url.searchParams.keys())if(/key|token|secret|auth/i.test(key))url.searchParams.set(key,'[redacted]');return url.href}catch{}}return value}
