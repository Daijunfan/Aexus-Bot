import {workerFeatures,acpWorkerOptions,workerPublicData} from './worker-tools'
import {activeModel,supportsFast,fastTier} from '../../shared/engine-commands'
import type {WorkerPermissionMode,WorkerSettings,WorkerRuntimeInfo} from '../../shared/worker-controls'
import type {ImageInput} from '../../shared/types'
import {nativeWorkerEnv} from '../native-worker-env'
import path from 'node:path'
import spawn from 'cross-spawn'
import type {ChildProcess,ChildProcessWithoutNullStreams} from 'node:child_process'
import type {Engine,ModelInfo} from '../../shared/types'
import type {RemoteTarget} from '../../shared/remote'
import {engineExecutable} from './executable'
import {runCodexTurn,nativeModel,type SandboxMode} from '../codex'
import {forkNativeCodexWorker,startNativeCodexSession,nativeCodexRequest,closeNativeCodexSession,hasNativeCodexSession} from '../codex-native'
import {nativeAcpClient} from './acp-client'
import {clineClient,type AcpPermission} from './cline-client'
import {acpModels,modelValue,discoverNativeAcp,normalizeEffort} from './opencode-runtime'
import {deepseekModel} from './deepseek-config'
import {piClient} from './pi-client'
import {loadClaudeSdk} from './claude-sdk'
import {buildOptions} from './claude-options'
import {AsyncQueue} from './session-support'
import {claudeModelCatalog,claudeWireEffort,deepSeekProvider} from '../claude-provider'
import {approvalHandler,elicitationHandler,nativeRequestHandler} from '../approvals'

export type WorkerRuntime={configure?:(changes:WorkerSettings)=>Promise<void>;inspect?:(section:string)=>Promise<any>;background?:(processId?:string,stop?:boolean)=>Promise<any>;fork?:(title:string)=>Promise<{nativeSessionId:string;sessionFile?:string}>;steer?:(text:string)=>Promise<unknown>;connected?:()=>boolean;send:(text:string,signal:AbortSignal,images?:ImageInput[])=>Promise<void>;interrupt:()=>Promise<unknown>;close:()=>Promise<unknown>}
type Context={id:string;engine:Engine;cwd:string;remote?:RemoteTarget|null;directory:string;nativeSessionId?:string;sessionFile?:string;model?:string;effort?:string;planMode?:boolean;thinking?:boolean;fastMode?:boolean;nativeOptions?:Record<string,string>;permissionMode:WorkerPermissionMode;signal:AbortSignal;turnSignal:()=>AbortSignal;onProcess:(child:ChildProcess)=>void;event:(event:any,format?:'agent'|'claude')=>void;info:(value:WorkerRuntimeInfo)=>void;changed:()=>void}
const initialize={protocolVersion:1,clientInfo:{name:'aexus-bot',version:'1'},clientCapabilities:{}}

/** Workers share native transports and transcript reducers, never employee prompts or Company tools. */
export async function openWorkerRuntime(context:Context):Promise<WorkerRuntime>{
 if(context.engine==='codex')return openCodexWorker(context)
 if(context.engine==='claude')return openClaudeWorker(context)
 if(context.remote)throw Error('This engine’s graphical Worker protocol requires a Core-local folder. The remote host was not changed.')
 if(context.engine==='pi')return openPiWorker(context)
 return openAcpWorker(context)
}
async function openCodexWorker(c:Context):Promise<WorkerRuntime>{
 const id='worker:'+c.id;let resumeId=c.nativeSessionId
 const base={nativeWorker:true,connectionId:id,prompt:'',cwd:c.cwd,nativeRemote:c.remote??undefined,resumeId:c.nativeSessionId,model:c.model,effort:c.effort,sandbox:'read-only' as SandboxMode,approvalPolicy:'on-request',signal:c.signal,onProcess:c.remote?undefined:c.onProcess,onEvent:(event:any)=>{if(event.kind==='thread'){resumeId=event.threadId;c.info({nativeSessionId:event.threadId})}else c.event(event)},onRequest:nativeRequestHandler(id,c.changed,true)}
 await startNativeCodexSession(engineExecutable('codex'),base)
 try{
  const config=(await nativeCodexRequest(id,'config/read',{includeLayers:false,cwd:c.cwd})).config??{},models:ModelInfo[]=[];let cursor:string|undefined
  do{const page=await nativeCodexRequest(id,'model/list',{limit:100,includeHidden:true,...(cursor?{cursor}:{})});models.push(...(page.data??[]).map(nativeModel));cursor=page.nextCursor??undefined}while(cursor)
  const features=workerFeatures('codex');features.fast=supportsFast('codex',activeModel(models,c.model||config.model));c.info({models,features,commands:[],model:c.model||config.model||models.find(model=>model.isDefault)?.value,effort:c.effort||config.model_reasoning_effort,planMode:!!c.planMode,fastMode:c.fastMode??['priority','fast'].includes(config.service_tier)})
  const sandbox:SandboxMode=c.permissionMode==='bypassPermissions'?'danger-full-access':c.permissionMode==='acceptEdits'?'workspace-write':['read-only','workspace-write','danger-full-access'].includes(config.sandbox_mode)?config.sandbox_mode:'read-only'
  base.effort=c.effort||config.model_reasoning_effort
  const nativeDefaultModel=config.model||models.find(model=>model.isDefault)?.value
  return {inspect:async section=>{if(section==='config')return workerPublicData(config);const methods:Record<string,[string,Record<string,unknown>]>={skills:['skills/list',{cwds:[c.cwd],forceReload:true}],mcp:['mcpServerStatus/list',{limit:100}],account:['account/read',{refreshToken:false}],usage:['account/rateLimits/read',{}]};const request=methods[section];if(!request)throw Error('Native section is unavailable');let result=await nativeCodexRequest(id,...request);if(section==='skills')result={data:(result.data??[]).flatMap((row:any)=>row.skills??[]).filter((skill:any)=>skill.enabled),errors:(result.data??[]).flatMap((row:any)=>row.errors??[])};return workerPublicData(result)},background:async(processId,stop=false)=>{if(!resumeId)return {data:[]};if(stop&&processId){const own=await nativeCodexRequest(id,'thread/backgroundTerminals/list',{});if(!(own.data??own.terminals??[]).some((row:any)=>String(row.processId)===processId))throw Error('Background process does not belong to this Worker')}return nativeCodexRequest(id,stop?processId?'thread/backgroundTerminals/terminate':'thread/backgroundTerminals/clean':'thread/backgroundTerminals/list',processId?{processId}:{})},fork:title=>forkNativeCodexWorker(id,title,c.cwd),steer:text=>nativeCodexRequest(id,'turn/steer',{input:[{type:'text',text}]}),configure:async changes=>{if(changes.nativeOptions&&Object.keys(changes.nativeOptions).length)throw Error('Codex settings use the named model, effort, plan, Fast and permissions controls');if(changes.planMode!==undefined)c.planMode=changes.planMode;if(changes.fastMode!==undefined)c.fastMode=changes.fastMode;if(changes.model!==undefined)base.model=changes.model||undefined;if(changes.effort!==undefined)base.effort=changes.effort||config.model_reasoning_effort;features.fast=supportsFast('codex',activeModel(models,base.model||nativeDefaultModel));c.info({features,model:base.model||nativeDefaultModel,effort:base.effort,planMode:!!c.planMode,fastMode:c.fastMode??['priority','fast'].includes(config.service_tier)})},connected:()=>hasNativeCodexSession(id),send:(prompt,signal,images)=>runCodexTurn({...base,resumeId,prompt,images,signal,planMode:!!c.planMode,serviceTier:c.fastMode===undefined?config.service_tier??undefined:c.fastMode?fastTier(activeModel(models,base.model||nativeDefaultModel))?.id:'default',sandbox,approvalPolicy:c.permissionMode==='bypassPermissions'?'never':c.permissionMode==='acceptEdits'?'on-request':config.approval_policy??'on-request'}),interrupt:()=>nativeCodexRequest(id,'turn/interrupt'),close:async()=>{try{if(resumeId&&hasNativeCodexSession(id))await nativeCodexRequest(id,'thread/unsubscribe')}catch{}finally{await closeNativeCodexSession(id)}}}
 }catch(error){await closeNativeCodexSession(id);throw error}
}
async function openAcpWorker(c:Context):Promise<WorkerRuntime>{
 const id='worker:'+c.id,approve=approvalHandler(id,c.changed),tools=new Map<string,{name:string;input:unknown}>();let session:any,block=0,turn=0,publish=()=>{},commands:import('../../shared/types').SlashCommand[]=[]
 const update=(event:any)=>{
  if(event.sessionUpdate==='config_option_update'){session={...session,configOptions:event.configOptions};publish();return}
  if(event.sessionUpdate==='available_commands_update'){commands=(event.availableCommands??[]).map((command:any)=>({name:command.name,description:command.description??'',argumentHint:command.input?.hint??''}));publish();return}
  if(event.sessionUpdate==='current_mode_update'){session={...session,modes:{...session?.modes,currentModeId:event.currentModeId}};publish();return}
  if(event.sessionUpdate==='usage_update')c.info({usage:event})
  const key=turn+':'+block
  if(event.sessionUpdate==='agent_message_chunk'&&event.content?.type==='text')c.event({kind:'text-delta',id:key,text:event.content.text})
  if(event.sessionUpdate==='agent_thought_chunk'&&event.content?.type==='text')c.event({kind:'reasoning-delta',id:key,text:event.content.text})
  if(['tool_call','tool_call_update'].includes(event.sessionUpdate)){
   const previous=tools.get(event.toolCallId),tool={name:event.title??previous?.name??event.kind??'Tool',input:event.rawInput??previous?.input??{}};tools.set(event.toolCallId,tool)
   if(event.sessionUpdate==='tool_call'){block++;c.event({kind:'tool-start',id:event.toolCallId,name:tool.name,command:JSON.stringify(tool.input)})}
   if(['completed','failed'].includes(event.status)){block++;c.event({kind:'tool-end',id:event.toolCallId,name:tool.name,command:JSON.stringify(tool.input),output:typeof event.rawOutput==='string'?event.rawOutput:JSON.stringify(event.rawOutput??event.content??''),exitCode:event.status==='failed'?1:0})}
  }
 }
 const permission=async(request:AcpPermission)=>{
  if(c.permissionMode!=='bypassPermissions'&&!request.options.some(option=>option.kind==='allow_once'))throw Error('This native permission request does not support one-time approval. No persistent permission was granted.')
  const allow=c.permissionMode==='bypassPermissions'||c.permissionMode==='acceptEdits'&&request.toolCall.kind==='edit'||(await approve(request.toolCall.title??request.toolCall.kind??'Native tool',request.toolCall.rawInput??{},{signal:c.turnSignal(),toolUseID:request.toolCall.toolCallId,requestId:request.toolCall.toolCallId,title:request.toolCall.title}))?.behavior==='allow'
  const choice=request.options.find(option=>option.kind===(allow?'allow_once':'reject_once'))??(allow&&c.permissionMode==='bypassPermissions'?request.options.find(option=>option.kind==='allow_always'):undefined)
  return {outcome:choice?{outcome:'selected',optionId:choice.optionId}:{outcome:'cancelled'}}
 }
 const client=c.engine==='cline'?await clineClient({nativeWorker:true,cwd:c.cwd,directory:c.directory,model:c.model,onProcess:c.onProcess,onUpdate:update,onPermission:permission}):nativeAcpClient({nativeWorker:true,engine:c.engine as 'opencode'|'kilo'|'deepseek',cwd:c.cwd,directory:c.directory,permissionMode:c.permissionMode,onProcess:c.onProcess,onUpdate:update,onPermission:permission})
 try{
  const protocol=await client.call('initialize',initialize);if(protocol.protocolVersion!==1)throw Error('Unsupported native ACP version')
  session=await client.call(c.nativeSessionId?c.engine==='deepseek'?'session/resume':'session/load':'session/new',{...(c.nativeSessionId?{sessionId:c.nativeSessionId}:{}),cwd:c.cwd,mcpServers:[]})
  const sessionId=session.sessionId??c.nativeSessionId;if(!sessionId)throw Error('Native engine returned no session identity')
  const configure=async(configId:string,value:string)=>{const result=await client.call('session/set_config_option',{sessionId,configId,value});if(result.configOptions)session={...session,configOptions:result.configOptions}}
  if(c.model)await configure('model',c.engine==='cline'?c.model:modelValue(c.engine as 'opencode'|'kilo'|'deepseek',session,c.model))
  if(c.planMode){if(c.engine==='deepseek')throw Error('DeepSeek Harness does not expose Plan mode');if(c.engine==='cline')await client.call('session/set_mode',{sessionId,modeId:'plan'});else await configure('mode','plan')}
  for(const [name,value] of Object.entries(c.nativeOptions??{}))await configure(name,value)
  if(c.effort){const configId=c.engine==='deepseek'?'reasoning_effort':'effort',option=session.configOptions?.find((option:any)=>option.id===configId),choices=(option?.options??[]).flatMap((option:any)=>option.options??[option]),choice=choices.find((option:any)=>normalizeEffort(option.value)===c.effort);if(!choice)throw Error('This native model does not support the selected reasoning effort');await configure(configId,choice.value)}
  publish=()=>{
   const selected=session.configOptions?.find((option:any)=>option.id==='model')?.currentValue,effort=session.configOptions?.find((option:any)=>option.id===(c.engine==='deepseek'?'reasoning_effort':'effort'))?.currentValue
   const models=c.engine==='cline'?((client as Awaited<ReturnType<typeof clineClient>>).native&&(client as any).models.length?(client as any).models.map((model:any)=>({value:model.id,displayName:model.name??model.id,description:'Native configuration'})):(session.models?.availableModels??[]).map((model:any)=>({value:model.modelId,displayName:model.name??model.modelId,description:'Native configuration'}))):acpModels(c.engine as 'opencode'|'kilo'|'deepseek',session,true)
   const features=workerFeatures(c.engine);c.info({features,commands,configOptions:acpWorkerOptions(session),planMode:(session.configOptions?.find((option:any)=>option.id==='mode')?.currentValue??session.modes?.currentModeId)==='plan',nativeSessionId:sessionId,models,model:c.model||(c.engine==='deepseek'&&selected?deepseekModel(selected):selected)||(client as any).model,effort:effort===undefined?undefined:normalizeEffort(effort)})
  };publish()
  const cancel=()=>client.notify('session/cancel',{sessionId})
  const settings=async(changes:WorkerSettings)=>{
   const previous=session.configOptions?.map((option:any)=>({id:option.id,value:option.currentValue}))??[],previousMode=session.modes?.currentModeId
   try{
    if(changes.nativeOptions)for(const [name,value] of Object.entries(changes.nativeOptions)){const option=acpWorkerOptions(session).find(option=>option.id===name);if(!option?.options.some(choice=>choice.value===value))throw Error('Choose an advertised native option');await configure(name,value)}
    if(changes.planMode!==undefined){if(c.engine==='deepseek')throw Error('DeepSeek Harness does not expose Plan mode');if(c.engine==='cline'){const result=await client.call('session/set_mode',{sessionId,modeId:changes.planMode?'plan':'act'});session={...session,...result,modes:{...session.modes,currentModeId:changes.planMode?'plan':'act'}}}else await configure('mode',changes.planMode?'plan':c.engine==='kilo'?'code':'build')}
    if(changes.model!==undefined){const value=changes.model||previous.find((option:any)=>option.id==='model')?.value;if(value)await configure('model',c.engine==='cline'?value:modelValue(c.engine as 'opencode'|'kilo'|'deepseek',session,value))}
    if(changes.effort!==undefined){const configId=c.engine==='deepseek'?'reasoning_effort':'effort',option=session.configOptions?.find((option:any)=>option.id===configId),choices=(option?.options??[]).flatMap((option:any)=>option.options??[option]);let value=changes.effort?choices.find((option:any)=>normalizeEffort(option.value)===changes.effort)?.value:choices.find((option:any)=>option.value==='default'||option.value==='')?.value??option?.currentValue
     if(!changes.effort&&c.engine==='deepseek'){const catalog=await discoverNativeAcp('deepseek',changes.model||c.model),native=catalog.models.find(model=>model.value===(changes.model||c.model))?.defaultEffort;value=choices.find((option:any)=>normalizeEffort(option.value)===native)?.value??value}
     if(value!==undefined)await configure(configId,value);else if(changes.effort)throw Error('This native model does not expose the selected reasoning effort')
    }
    if(changes.model!==undefined)c.model=changes.model||undefined;if(changes.effort!==undefined)c.effort=changes.effort||undefined;publish()
   }catch(error){for(const option of previous)try{await configure(option.id,option.value)}catch{};if(c.engine==='cline'&&previousMode)try{await client.call('session/set_mode',{sessionId,modeId:previousMode});session.modes={...session.modes,currentModeId:previousMode}}catch{};publish();throw error}
  }
  return {inspect:async section=>section==='config'?{configOptions:acpWorkerOptions(session),modes:session.modes}:section==='skills'?{data:commands,note:'Native commands reported by this connection'}:section==='usage'?{note:'Usage is shown when reported by this native engine'}:Promise.reject(Error('This native protocol does not expose '+section)),connected:()=>client.alive(),configure:settings,async send(text,signal,images=[]){turn++;block=0;tools.clear();signal.addEventListener('abort',cancel,{once:true});try{signal.throwIfAborted();const attachment=c.engine==='cline'?(client as Awaited<ReturnType<typeof clineClient>>).stageImages(images):undefined;const result=await client.call('session/prompt',{sessionId,prompt:[{type:'text',text:[text,attachment?.marker].filter(Boolean).join('\n\n')},...(c.engine==='cline'?[]:images.map(image=>({type:'image',data:image.data,mimeType:image.mimeType})))]},0);if(result.stopReason!=='cancelled')attachment?.verify();if(['cancelled','refusal'].includes(result.stopReason))throw Error(result.stopReason)}finally{signal.removeEventListener('abort',cancel)}},interrupt:async()=>cancel(),close:()=>client.close()}
 }catch(error){await client.close();throw error}
}
async function openPiWorker(c:Context):Promise<WorkerRuntime>{
 const id='worker:'+c.id,approve=approvalHandler(id,c.changed);let turn=0,message=0,finish:((error?:Error)=>void)|undefined
 const onNativeUI=async(request:any)=>{
  const signal=request.timeout>0?AbortSignal.any([c.turnSignal(),AbortSignal.timeout(request.timeout)]):c.turnSignal()
  if(request.method==='confirm'){const result=await approve('Pi confirmation',{message:request.message},{signal,toolUseID:request.id,requestId:request.id,title:request.title});return {confirmed:result?.behavior==='allow'}}
  if(request.method==='select'){const result=await nativeRequestHandler(id,c.changed,true)('tool/requestUserInput',{questions:[{id:request.id,question:request.title,options:(request.options??[]).map((label:string)=>({label,description:''})),isOther:false}]},signal),value=result.answers?.[request.id]?.answers?.[0];return value===undefined?{cancelled:true}:{value}}
  const result=await elicitationHandler(id,c.changed)({serverName:'Pi',message:request.title,requestedSchema:{type:'object',properties:{value:{type:'string',title:request.title,description:request.placeholder,default:request.prefill}},required:['value']}} as any,{signal,requestId:request.id});return result?.action==='accept'?{value:result.content?.value}:{cancelled:true}
 }
 const client=piClient({nativeWorker:true,cwd:c.cwd,directory:c.directory,sessionFile:c.sessionFile,model:c.model,onProcess:c.onProcess,onNativeUI,onPermission:async request=>c.permissionMode==='bypassPermissions'||(await approve(request.toolName,request.input,{signal:c.turnSignal(),toolUseID:request.toolCallId,requestId:request.toolCallId}))?.behavior==='allow',onEvent:event=>{
  if(event.type==='extension_ui_request'&&event.method==='notify')c.event({kind:'notice',level:event.notifyType==='error'?'error':'info',text:event.message})
  if(event.type==='message_start')message++
  const update=event.assistantMessageEvent,key=turn+':'+message+':'+(update?.contentIndex??0)
  if(event.type==='message_update'&&update?.type==='text_delta')c.event({kind:'text-delta',id:key,text:update.delta})
  if(event.type==='message_update'&&update?.type==='text_end')c.event({kind:'text',id:key,text:update.content})
  if(event.type==='message_update'&&['thinking_delta','thinking_end'].includes(update?.type))c.event({kind:update.type==='thinking_delta'?'reasoning-delta':'reasoning',id:key,text:update.delta??update.content})
  if(event.type==='tool_execution_start')c.event({kind:'tool-start',id:event.toolCallId,name:event.toolName,command:JSON.stringify(event.args)})
  if(event.type==='tool_execution_end')c.event({kind:'tool-end',id:event.toolCallId,name:event.toolName,command:'',output:JSON.stringify(event.result),exitCode:event.isError?1:0})
  if(event.type==='message_end'&&['error','aborted'].includes(event.message?.stopReason))finish?.(Error(event.message.errorMessage??event.message.stopReason))
  if(event.type==='agent_settled')finish?.()
  if(event.type==='process_error')finish?.(Error(event.error))
 }})
 try{
  let current=await client.call('get_state');const catalog=await client.call('get_available_models'),commands=(await client.call('get_commands')).commands??[],features=workerFeatures('pi')
  const configure=async(changes:WorkerSettings)=>{
   if(changes.model!==undefined)await client.call('set_model',{provider:client.provider,modelId:changes.model||client.model})
   if(changes.effort!==undefined)await client.call('set_thinking_level',{level:changes.effort||'off'})
   for(const [name,value] of Object.entries(changes.nativeOptions??{})){
    if(name==='thinkingLevel')await client.call('set_thinking_level',{level:value})
    else if(name==='steeringMode'||name==='followUpMode')await client.call(name==='steeringMode'?'set_steering_mode':'set_follow_up_mode',{mode:value})
    else if(name==='autoCompactionEnabled')await client.call('set_auto_compaction',{enabled:value==='true'})
    else throw Error('Pi does not expose this configuration option')
   }
   await publish()
  }
  const publish=async()=>{
   current=await client.call('get_state');const levels=(await client.call('get_available_thinking_levels')).levels??['off'],choices=(values:string[])=>values.map(value=>({value,name:value}))
   c.info({features,commands:commands.map((command:any)=>({name:command.name,description:command.description??'',argumentHint:'[arguments]'})),configOptions:[{id:'thinkingLevel',name:'Native thinking level',type:'select',currentValue:current.thinkingLevel,options:choices(levels)},...['steeringMode','followUpMode'].filter(name=>current[name]!==undefined).map(name=>({id:name,name:name==='steeringMode'?'Steering delivery':'Follow-up delivery',type:'select',currentValue:current[name],options:choices(['all','one-at-a-time'])})),...(current.autoCompactionEnabled===undefined?[]:[{id:'autoCompactionEnabled',name:'Automatic context compaction',type:'select',currentValue:String(current.autoCompactionEnabled),options:choices(['true','false'])}])],nativeSessionId:current.sessionId,sessionFile:current.sessionFile,model:current.model?.id??client.model,effort:current.thinkingLevel,models:(catalog.models??[]).filter((model:any)=>model.provider===client.provider).map((model:any)=>({value:model.id,displayName:model.name??model.id,description:'Native configuration',inputModalities:model.input}))})
  }
  await configure({model:c.model,effort:c.effort,nativeOptions:c.nativeOptions})
  const abort=()=>{void client.call('abort').catch(()=>{});finish?.(Error('Interrupted'))}
  return {fork:async title=>{if(!current.sessionFile)throw Error('Send a task before forking');const fork=piClient({nativeWorker:true,cwd:c.cwd,directory:c.directory,sessionFile:current.sessionFile,model:current.model?.id,onProcess:c.onProcess,onNativeUI});try{const result=await fork.call('clone');if(result.cancelled)throw Error('Native Pi cancelled the fork');await fork.call('set_session_name',{name:title});const next=await fork.call('get_state');if(!next.sessionId||!next.sessionFile||next.sessionId===current.sessionId)throw Error('Pi did not create an independent context');return {nativeSessionId:next.sessionId,sessionFile:next.sessionFile}}finally{await fork.close()}},inspect:async section=>section==='usage'?client.call('get_session_stats'):section==='skills'?{data:commands}:section==='config'?client.call('get_state'):Promise.reject(Error('Pi RPC does not expose '+section)),steer:text=>client.call('steer',{message:text}),connected:()=>client.alive(),configure,async send(text,signal,images=[]){turn++;message=0;const settled=new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve()});signal.addEventListener('abort',abort,{once:true});try{signal.throwIfAborted();if(/^\/compact(?:\s|$)/.test(text)){await client.call('compact',{customInstructions:text.slice(8).trim()||undefined},0);finish?.()}else await client.call('prompt',{message:text,images:images.map(image=>({type:'image',mimeType:image.mimeType,data:image.data}))});await settled}finally{finish=undefined;signal.removeEventListener('abort',abort)}},interrupt:()=>client.call('abort'),close:async()=>{finish?.(Error('Worker stopped'));await client.close()}}
 }catch(error){await client.close();throw error}
}
async function openClaudeWorker(c:Context):Promise<WorkerRuntime>{
 const {query}=await loadClaudeSdk(),id='worker:'+c.id,input=new AsyncQueue<any>();let finish:((error?:Error)=>void)|undefined,dead=false;let models:ModelInfo[]=[];const features=workerFeatures('claude');features.fork=!c.remote;const tasks=new Map<string,any>(),terminalCommands=new Set<string>();let commands:import('../../shared/types').SlashCommand[]=[]
 const publishCommands=()=>c.info({commands:commands.filter(command=>!terminalCommands.has(command.name))})
 const options=buildOptions({cwd:c.cwd,nativeRemote:c.remote??undefined,model:c.model,resume:c.nativeSessionId,permissionMode:c.permissionMode,effort:c.effort as any})
 if(!c.remote)options.spawnClaudeCodeProcess=options=>{const child=spawn(options.command,options.args,{cwd:options.cwd,env:nativeWorkerEnv(options.env,true),signal:options.signal,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});c.onProcess(child);return child as ChildProcessWithoutNullStreams}
 const session=query({prompt:input,options:{...options,canUseTool:approvalHandler(id,c.changed),onElicitation:elicitationHandler(id,c.changed)}})
 const consuming=(async()=>{try{for await(const event of session){if(event.type==='system'&&(event as any).session_id){c.nativeSessionId=(event as any).session_id;c.info({nativeSessionId:c.nativeSessionId})};if(event.type==='system'&&(event as any).subtype==='init'){const init=event as any;for(const name of init.terminal_slash_commands??[])terminalCommands.add(name);commands=[...new Map([...(init.slash_commands??[]).map((name:string)=>({name,description:'Native Claude command',argumentHint:''})),...commands].map(command=>[command.name,command])).values()];publishCommands();if(init.model){c.model??=init.model;features.fast=supportsFast('claude',activeModel(models,c.model));c.info({features,model:c.model})}}if(event.type==='system'&&(event as any).subtype==='commands_changed'){commands=(event as any).commands;publishCommands()};if(event.type==='system'&&['task_started','task_progress','task_notification'].includes((event as any).subtype)){const task=event as any;if(task.subtype==='task_notification')tasks.delete(task.task_id);else tasks.set(task.task_id,{processId:task.task_id,command:task.description??task.task_id,cwd:c.cwd})}if('fast_mode_state' in event){c.fastMode=event.fast_mode_state!=='off';c.info({fastMode:c.fastMode,fastModeState:String(event.fast_mode_state),fastModeDisabledReason:(event as any).fast_mode_disabled_reason})}if(event.type==='system'&&(event as any).subtype==='init'&&'effort' in event){c.effort=(event as any).effort??undefined;c.info({effort:c.effort})}if(event.type==='result')c.info({usage:{...(event as any).usage,totalCostUsd:(event as any).total_cost_usd}});c.event(event,'claude');if(event.type==='result')finish?.(event.subtype==='success'?undefined:Error((event as any).errors?.join('\n')??event.subtype))}}catch(error){finish?.(error as Error)}finally{dead=true;finish?.(Error('Native Claude connection closed'))}})()
 try{
  models=claudeModelCatalog(await session.supportedModels());commands=await session.supportedCommands();features.fast=supportsFast('claude',activeModel(claudeModelCatalog(models),c.model));if(c.planMode)await session.setPermissionMode('plan');if(c.thinking!==undefined)await session.setMaxThinkingTokens(c.thinking?null:0,c.thinking?'summarized':null);if(c.fastMode!==undefined)await session.applyFlagSettings({fastMode:c.fastMode});c.info({features,commands:commands.filter(command=>!terminalCommands.has(command.name)),models:claudeModelCatalog(models),model:c.model,planMode:!!c.planMode,thinking:c.thinking,fastMode:c.fastMode})
  return {inspect:async section=>section==='skills'?{data:(await session.supportedCommands()).filter(command=>!terminalCommands.has(command.name))}:section==='mcp'?{data:await session.mcpServerStatus()}:section==='account'?workerPublicData(await session.accountInfo()):section==='config'?{model:c.model,permissionMode:c.permissionMode,planMode:c.planMode,thinking:c.thinking,fastMode:c.fastMode}:section==='usage'?{note:'Native session usage is updated after each turn; /usage is available as a native command'}:Promise.reject(Error('Native section is unavailable')),background:async(processId,stop=false)=>{if(stop)for(const key of processId?[processId]:[...tasks.keys()]){if(!tasks.has(key))throw Error('Background task does not belong to this Worker');await session.stopTask(key);tasks.delete(key)}return {data:[...tasks.values()]}},fork:async title=>{if(c.remote)throw Error('Native Claude fork is unavailable on this remote transport');const nativeId=c.nativeSessionId;if(!nativeId)throw Error('Send a task before forking');const result=await(await loadClaudeSdk()).forkSession(nativeId,{title});return {nativeSessionId:result.sessionId}},steer:async text=>{if(!finish)throw Error('The native Worker turn already ended');input.push({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:''})},configure:async changes=>{if(changes.nativeOptions&&Object.keys(changes.nativeOptions).length)throw Error('Use the named Claude configuration controls');if(changes.planMode!==undefined){await session.setPermissionMode(changes.planMode?'plan':c.permissionMode);c.planMode=changes.planMode}if(changes.thinking!==undefined){await session.setMaxThinkingTokens(changes.thinking?null:0,changes.thinking?'summarized':null);c.thinking=changes.thinking}if(changes.fastMode!==undefined){await session.applyFlagSettings({fastMode:changes.fastMode});c.fastMode=changes.fastMode}if(changes.model!==undefined)await session.setModel(changes.model||undefined);if(changes.effort!==undefined)await session.applyFlagSettings({effortLevel:claudeWireEffort(deepSeekProvider(c.cwd),changes.model||c.model,changes.effort as any)??null} as Parameters<typeof session.applyFlagSettings>[0]);if(changes.model!==undefined)c.model=changes.model||undefined;if(changes.effort!==undefined)c.effort=changes.effort||undefined;features.fast=supportsFast('claude',activeModel(claudeModelCatalog(models),c.model));c.info({features,model:c.model,effort:c.effort,planMode:!!c.planMode,thinking:c.thinking,fastMode:c.fastMode})},connected:()=>!dead,async send(text,signal,images=[]){if(dead)throw Error('Native Claude connection is closed');const abort=()=>void session.interrupt().catch(()=>{});const settled=new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve()});signal.addEventListener('abort',abort,{once:true});try{signal.throwIfAborted();input.push({type:'user',message:{role:'user',content:images.length?[...(text?[{type:'text',text}]:[]),...images.map(image=>({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.data}}))]:text},parent_tool_use_id:null,session_id:''});await settled}finally{signal.removeEventListener('abort',abort);finish=undefined}},interrupt:()=>session.interrupt(),close:async()=>{input.close();session.close();await consuming}}
 }catch(error){input.close();session.close();await consuming;throw error}
}
