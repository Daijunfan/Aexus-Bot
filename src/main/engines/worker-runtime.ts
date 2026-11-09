import {nativeWorkerEnv} from '../native-worker-env'
import path from 'node:path'
import spawn from 'cross-spawn'
import type {ChildProcess,ChildProcessWithoutNullStreams} from 'node:child_process'
import type {Engine,ModelInfo} from '../../shared/types'
import type {RemoteTarget} from '../../shared/remote'
import {engineExecutable} from './executable'
import {runCodexTurn,nativeModel,type SandboxMode} from '../codex'
import {startNativeCodexSession,nativeCodexRequest,closeNativeCodexSession,hasNativeCodexSession} from '../codex-native'
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

export type WorkerRuntime={configure?:(changes:{model?:string;effort?:string})=>Promise<void>;connected?:()=>boolean;send:(text:string,signal:AbortSignal)=>Promise<void>;interrupt:()=>Promise<unknown>;close:()=>Promise<unknown>}
type Context={id:string;engine:Engine;cwd:string;remote?:RemoteTarget|null;directory:string;nativeSessionId?:string;sessionFile?:string;model?:string;effort?:string;permissionMode:'default'|'acceptEdits'|'bypassPermissions';signal:AbortSignal;turnSignal:()=>AbortSignal;onProcess:(child:ChildProcess)=>void;event:(event:any,format?:'agent'|'claude')=>void;info:(value:{models?:ModelInfo[];model?:string;effort?:string;nativeSessionId?:string;sessionFile?:string})=>void;changed:()=>void}
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
  c.info({models,model:c.model||config.model||models.find(model=>model.isDefault)?.value,effort:c.effort||config.model_reasoning_effort})
  const sandbox:SandboxMode=c.permissionMode==='bypassPermissions'?'danger-full-access':c.permissionMode==='acceptEdits'?'workspace-write':['read-only','workspace-write','danger-full-access'].includes(config.sandbox_mode)?config.sandbox_mode:'read-only'
  base.effort=c.effort||config.model_reasoning_effort
  const nativeDefaultModel=config.model||models.find(model=>model.isDefault)?.value
  return {configure:async changes=>{if(changes.model!==undefined)base.model=changes.model||undefined;if(changes.effort!==undefined)base.effort=changes.effort||config.model_reasoning_effort;c.info({model:base.model||nativeDefaultModel,effort:base.effort})},connected:()=>hasNativeCodexSession(id),send:(prompt,signal)=>runCodexTurn({...base,resumeId,prompt,signal,serviceTier:config.service_tier??undefined,sandbox,approvalPolicy:c.permissionMode==='bypassPermissions'?'never':c.permissionMode==='acceptEdits'?'on-request':config.approval_policy??'on-request'}),interrupt:()=>nativeCodexRequest(id,'turn/interrupt'),close:async()=>{try{if(resumeId&&hasNativeCodexSession(id))await nativeCodexRequest(id,'thread/unsubscribe')}catch{}finally{await closeNativeCodexSession(id)}}}
 }catch(error){await closeNativeCodexSession(id);throw error}
}
async function openAcpWorker(c:Context):Promise<WorkerRuntime>{
 const id='worker:'+c.id,approve=approvalHandler(id,c.changed),tools=new Map<string,{name:string;input:unknown}>();let session:any,block=0,turn=0
 const update=(event:any)=>{
  if(event.sessionUpdate==='config_option_update'){session={...session,configOptions:event.configOptions};return}
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
  if(c.effort){const configId=c.engine==='deepseek'?'reasoning_effort':'effort',option=session.configOptions?.find((option:any)=>option.id===configId),choices=(option?.options??[]).flatMap((option:any)=>option.options??[option]),choice=choices.find((option:any)=>normalizeEffort(option.value)===c.effort);if(!choice)throw Error('This native model does not support the selected reasoning effort');await configure(configId,choice.value)}
  const publish=()=>{
   const selected=session.configOptions?.find((option:any)=>option.id==='model')?.currentValue,effort=session.configOptions?.find((option:any)=>option.id===(c.engine==='deepseek'?'reasoning_effort':'effort'))?.currentValue
   const models=c.engine==='cline'?((client as Awaited<ReturnType<typeof clineClient>>).native&&(client as any).models.length?(client as any).models.map((model:any)=>({value:model.id,displayName:model.name??model.id,description:'Native configuration'})):(session.models?.availableModels??[]).map((model:any)=>({value:model.modelId,displayName:model.name??model.modelId,description:'Native configuration'}))):acpModels(c.engine as 'opencode'|'kilo'|'deepseek',session,true)
   c.info({nativeSessionId:sessionId,models,model:c.model||(c.engine==='deepseek'&&selected?deepseekModel(selected):selected)||(client as any).model,effort:effort===undefined?undefined:normalizeEffort(effort)})
  };publish()
  const cancel=()=>client.notify('session/cancel',{sessionId})
  const settings=async(changes:{model?:string;effort?:string})=>{
   const previous=session.configOptions?.map((option:any)=>({id:option.id,value:option.currentValue}))??[]
   try{
    if(changes.model!==undefined){const value=changes.model||previous.find((option:any)=>option.id==='model')?.value;if(value)await configure('model',c.engine==='cline'?value:modelValue(c.engine as 'opencode'|'kilo'|'deepseek',session,value))}
    if(changes.effort!==undefined){const configId=c.engine==='deepseek'?'reasoning_effort':'effort',option=session.configOptions?.find((option:any)=>option.id===configId),choices=(option?.options??[]).flatMap((option:any)=>option.options??[option]);let value=changes.effort?choices.find((option:any)=>normalizeEffort(option.value)===changes.effort)?.value:choices.find((option:any)=>option.value==='default'||option.value==='')?.value??option?.currentValue
     if(!changes.effort&&c.engine==='deepseek'){const catalog=await discoverNativeAcp('deepseek',changes.model||c.model),native=catalog.models.find(model=>model.value===(changes.model||c.model))?.defaultEffort;value=choices.find((option:any)=>normalizeEffort(option.value)===native)?.value??value}
     if(value!==undefined)await configure(configId,value);else if(changes.effort)throw Error('This native model does not expose the selected reasoning effort')
    }
    if(changes.model!==undefined)c.model=changes.model||undefined;if(changes.effort!==undefined)c.effort=changes.effort||undefined;publish()
   }catch(error){for(const option of previous.filter((option:any)=>['model','effort','reasoning_effort'].includes(option.id)))try{await configure(option.id,option.value)}catch{};publish();throw error}
  }
  return {connected:()=>client.alive(),configure:settings,async send(text,signal){turn++;block=0;tools.clear();signal.addEventListener('abort',cancel,{once:true});try{signal.throwIfAborted();const result=await client.call('session/prompt',{sessionId,prompt:[{type:'text',text}]},0);if(['cancelled','refusal'].includes(result.stopReason))throw Error(result.stopReason)}finally{signal.removeEventListener('abort',cancel)}},interrupt:async()=>cancel(),close:()=>client.close()}
 }catch(error){await client.close();throw error}
}
async function openPiWorker(c:Context):Promise<WorkerRuntime>{
 const id='worker:'+c.id,approve=approvalHandler(id,c.changed);let turn=0,message=0,finish:((error?:Error)=>void)|undefined
 const client=piClient({nativeWorker:true,cwd:c.cwd,directory:c.directory,sessionFile:c.sessionFile,model:c.model,onProcess:c.onProcess,onPermission:async request=>c.permissionMode==='bypassPermissions'||(await approve(request.toolName,request.input,{signal:c.turnSignal(),toolUseID:request.toolCallId,requestId:request.toolCallId}))?.behavior==='allow',onEvent:event=>{
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
  const current=await client.call('get_state'),catalog=await client.call('get_available_models')
  if(c.model)await client.call('set_model',{provider:client.provider,modelId:c.model})
  if(c.effort)await client.call('set_thinking_level',{level:c.effort})
  c.info({nativeSessionId:current.sessionId,sessionFile:current.sessionFile,model:c.model??current.model?.id??client.model,effort:current.thinkingLevel,models:(catalog.models??[]).filter((model:any)=>model.provider===client.provider).map((model:any)=>({value:model.id,displayName:model.name??model.id,description:'Native configuration'}))})
  const abort=()=>{void client.call('abort').catch(()=>{});finish?.(Error('Interrupted'))}
  return {connected:()=>client.alive(),configure:async changes=>{if(changes.model!==undefined)await client.call('set_model',{provider:client.provider,modelId:changes.model||client.model});if(changes.effort!==undefined)await client.call('set_thinking_level',{level:changes.effort||current.thinkingLevel||'off'});c.info({model:changes.model||client.model,effort:changes.effort||current.thinkingLevel})},async send(text,signal){turn++;message=0;const settled=new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve()});signal.addEventListener('abort',abort,{once:true});try{signal.throwIfAborted();await client.call('prompt',{message:text});await settled}finally{finish=undefined;signal.removeEventListener('abort',abort)}},interrupt:()=>client.call('abort'),close:async()=>{finish?.(Error('Worker stopped'));await client.close()}}
 }catch(error){await client.close();throw error}
}
async function openClaudeWorker(c:Context):Promise<WorkerRuntime>{
 const {query}=await loadClaudeSdk(),id='worker:'+c.id,input=new AsyncQueue<any>();let finish:((error?:Error)=>void)|undefined,dead=false
 const options=buildOptions({cwd:c.cwd,nativeRemote:c.remote??undefined,model:c.model,resume:c.nativeSessionId,permissionMode:c.permissionMode,effort:c.effort as any})
 if(!c.remote)options.spawnClaudeCodeProcess=options=>{const child=spawn(options.command,options.args,{cwd:options.cwd,env:nativeWorkerEnv(options.env,true),signal:options.signal,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});c.onProcess(child);return child as ChildProcessWithoutNullStreams}
 const session=query({prompt:input,options:{...options,canUseTool:approvalHandler(id,c.changed),onElicitation:elicitationHandler(id,c.changed)}})
 const consuming=(async()=>{try{for await(const event of session){if(event.type==='system'&&(event as any).session_id)c.info({nativeSessionId:(event as any).session_id});c.event(event,'claude');if(event.type==='result')finish?.(event.subtype==='success'?undefined:Error((event as any).errors?.join('\n')??event.subtype))}}catch(error){finish?.(error as Error)}finally{dead=true;finish?.(Error('Native Claude connection closed'))}})()
 try{
  const models=await session.supportedModels();c.info({models:claudeModelCatalog(models),model:c.model})
  return {configure:async changes=>{if(changes.model!==undefined)await session.setModel(changes.model||undefined);if(changes.effort!==undefined)await session.applyFlagSettings({effortLevel:claudeWireEffort(deepSeekProvider(c.cwd),changes.model||c.model,changes.effort as any)??null} as Parameters<typeof session.applyFlagSettings>[0]);if(changes.model!==undefined)c.model=changes.model||undefined;c.info({model:c.model,effort:changes.effort})},connected:()=>!dead,async send(text,signal){if(dead)throw Error('Native Claude connection is closed');const abort=()=>void session.interrupt().catch(()=>{});const settled=new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve()});signal.addEventListener('abort',abort,{once:true});try{signal.throwIfAborted();input.push({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:''});await settled}finally{signal.removeEventListener('abort',abort);finish=undefined}},interrupt:()=>session.interrupt(),close:async()=>{input.close();session.close();await consuming}}
 }catch(error){input.close();session.close();await consuming;throw error}
}
