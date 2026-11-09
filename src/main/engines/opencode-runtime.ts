import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import {APP_HOME} from '../../shared/protocol'
import {nativeSessionRefs,type ModelInfo} from '../../shared/types'
import {nativeAcpClient} from './acp-client'
import {codeConfig} from './opencode-config'
import type {NativeAcpEngine} from '../../shared/engines'
import {deepseekModel} from './deepseek-config'
import {engineState} from './state'
import {patchSession} from '../store'
import {approvalHandler,cancelApprovals} from '../approvals'
import {openDiscussionMcp} from '../discussion-mcp'
import type {EngineStart,EngineDriver} from './contract'

export const normalizeEffort=(value:string)=>value==='extra-high'?'xhigh':value==='off'?'none':value
const option=(session:any,id:string)=>session.configOptions?.find((o:any)=>o.id===id)
const choices=(entry:any):any[]=>(entry?.options??[]).flatMap((o:any)=>o.options??[o])
export function acpModels(engine:NativeAcpEngine,session:any,fresh=false):ModelInfo[]{
 const current=option(session,'model')?.currentValue
 if(engine==='deepseek'){const efforts=choices(option(session,'reasoning_effort')).map(entry=>normalizeEffort(entry.value)).filter(Boolean);return choices(option(session,'model')).map(model=>({value:deepseekModel(model.value),displayName:model.name??deepseekModel(model.value),description:'DeepSeek Harness · Native configuration',inputModalities:['text'],isDefault:model.value===current,supportsEffort:model.value===current&&efforts.length>0,supportedEffortLevels:model.value===current?efforts:[],...(fresh&&model.value===current?{defaultEffort:normalizeEffort(option(session,'reasoning_effort')?.currentValue??'')}:{}),supportsAdaptiveThinking:false,supportsFastMode:false}))}
 const config=codeConfig(engine)
 return choices(option(session,'model')).map(m=>{
  const [provider,...parts]=m.value.split('/'),entry=config.providers[provider]?.models?.[parts.join('/')],efforts=Object.keys(entry?.variants??{}).length?Object.keys(entry.variants):m.value===current?choices(option(session,'effort')).map(o=>o.value):[]
  return {value:m.value,displayName:m.name??m.value,description:'Native configuration',inputModalities:entry?.modalities?.input??['text'],isDefault:m.value===current,supportsEffort:efforts.length>0,supportedEffortLevels:[...new Set<string>(efforts.filter(e=>e!=='default').map(normalizeEffort))],supportsAdaptiveThinking:false,supportsFastMode:false}
 })
}
const nativeModel=(engine:NativeAcpEngine,value:string|undefined)=>value&&engine==='deepseek'?deepseekModel(value):value
export function modelValue(engine:NativeAcpEngine,session:any,value:string){if(engine!=='deepseek')return value;const matches=choices(option(session,'model')).filter(entry=>deepseekModel(entry.value)===value);if(matches.length!==1)throw Error('Choose a model from the native DeepSeek catalog');return matches[0].value}
const initialize={protocolVersion:1,clientInfo:{name:'aexus-bot',version:'1'},clientCapabilities:{}}
export async function discoverNativeAcp(engine:NativeAcpEngine,selectedModel?:string){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-'+engine+'-discovery-')),client=nativeAcpClient({engine,cwd:directory,directory})
 try{const protocol=await client.call('initialize',initialize);if(protocol.protocolVersion!==1)throw Error('Unsupported ACP version');let session=await client.call('session/new',{cwd:directory,mcpServers:[]});if(selectedModel)session={...session,...await client.call('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:modelValue(engine,session,selectedModel)})};return {version:protocol.agentInfo?.version,models:acpModels(engine,session,true),defaultModel:nativeModel(engine,option(session,'model')?.currentValue)}}
 finally{await client.close();fs.rmSync(directory,{recursive:true,force:true})}
}
export async function probeNativeAcp(engine:NativeAcpEngine,model?:string){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-'+engine+'-probe-')),started=Date.now();let text=''
 const client=nativeAcpClient({engine,cwd:directory,directory,onUpdate:update=>{if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')text+=update.content.text}})
 try{await client.call('initialize',initialize);const session=await client.call('session/new',{cwd:directory,mcpServers:[]});if(model)await client.call('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:modelValue(engine,session,model)});await client.call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'Reply with exactly OK. Do not use tools or perform any other task.'}]},45000);if(!text.trim())throw Error(engine+' returned no assistant text');return {engine,model:model??nativeModel(engine,option(session,'model')?.currentValue),text:client.redact(text.trim()).slice(0,2000),thinkingManaged:true,target:os.hostname(),elapsedMs:Date.now()-started,checkedAt:Date.now()}}
 finally{await client.close();fs.rmSync(directory,{recursive:true,force:true})}
}
export async function openNativeAcp(context:EngineStart){
 const engine=context.engine as NativeAcpEngine,{card,args,cardId,sessionId,cwd,host,permissionMode}=context
 if(context.remote||context.nativeRemote)throw Error(engine+' requires a Core-local workspace; remote execution will not fall back to the Mac')
 if(card?.accessMode==='isolated')throw Error(engine+' ACP does not yet support strict process isolation; choose a separately isolated OS account')
 const directory=path.join(APP_HOME,'agent-access',cardId,engine),state=engineState(context,{model:args.model||(engine==='deepseek'?undefined:codeConfig(engine).model)}),bridge=await openDiscussionMcp(state,true),approve=approvalHandler(sessionId,()=>host.emit('session:changed',{sessionId}))
 let client:ReturnType<typeof nativeAcpClient>,settings:any,turnId='',block=0,acceptUpdates=false,textSeen=false,receiptTaskId:string|undefined,receiptRead=false
 const tools=new Map<string,{name:string;input:unknown}>()
 const markRead=()=>{if(receiptTaskId&&!receiptRead&&state.running){receiptRead=true;host.emit('session:receipt',{sessionId,taskId:receiptTaskId,stage:'read'})}}
 const createClient=(mode=state.permissionMode)=>nativeAcpClient({engine,cwd,directory,employeeId:cardId,permissionMode:mode,onPermission:async request=>{
  markRead();const tool=request.toolCall,coreTool=/agents_company_(documentation|api|discussion)/.test(tool.title??''),readOnly=['read','search','think'].includes(tool.kind??'')
  let allow=false
  if(state.running&&!state.acknowledging){
   if(coreTool)allow=!state.privateInitialization||/agents_company_documentation/.test(tool.title??'')
   else if(!state.privateInitialization&&!(state.planMode&&!readOnly)&&!/^Task\b|^Agent\b/i.test(tool.title??'')){
    if(readOnly||state.permissionMode==='bypassPermissions'||state.permissionMode==='acceptEdits'&&tool.kind==='edit')allow=true
    else if(state.permissionMode!=='dontAsk')allow=(await approve(tool.title??engine+' tool',tool.rawInput??{},{signal:state.abort!.signal,toolUseID:tool.toolCallId,requestId:tool.toolCallId,title:tool.title}))?.behavior==='allow'
   }
  }
  const selected=request.options.find(o=>o.kind===(allow?'allow_once':'reject_once'))
  return {outcome:selected?{outcome:'selected',optionId:selected.optionId}:{outcome:'cancelled'}}
 },onUpdate:update=>{
  if(update.sessionUpdate==='config_option_update'){settings={...settings,configOptions:update.configOptions};return}
  if(!acceptUpdates||!host.isOpen(sessionId))return
  const emit=(event:unknown)=>host.emit('session:agent',{sessionId,event})
  if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'){markRead();textSeen=true;emit({kind:'text-delta',id:turnId+'/'+block,text:update.content.text})}
  else if(update.sessionUpdate==='agent_thought_chunk'&&update.content?.type==='text'){markRead();emit({kind:'reasoning-delta',id:turnId+'/'+block,text:update.content.text})}
  else if(update.sessionUpdate==='tool_call'||update.sessionUpdate==='tool_call_update'){
   const previous=tools.get(update.toolCallId),tool={name:update.title??previous?.name??update.kind??engine+' tool',input:update.rawInput??previous?.input??{}};tools.set(update.toolCallId,tool)
   if(update.sessionUpdate==='tool_call'){markRead();block++;emit({kind:'tool-start',id:update.toolCallId,name:tool.name,command:JSON.stringify(tool.input)})}
   if(['completed','failed'].includes(update.status))emit({kind:'tool-end',id:update.toolCallId,name:tool.name,command:JSON.stringify(tool.input),output:typeof update.rawOutput==='string'?update.rawOutput:JSON.stringify(update.rawOutput??update.content??[]),exitCode:update.status==='failed'?1:0})
  }
 }})
 try{client=createClient()}catch(error){await bridge.close();throw error}
 try{
  const protocol=await client.call('initialize',initialize)
  if(protocol.protocolVersion!==1||!protocol.agentCapabilities?.mcpCapabilities?.http)throw Error(engine+' requires ACP 1 with HTTP MCP support')
  const previous=(card?nativeSessionRefs(card):[]).reverse().find(ref=>ref.engine===engine&&ref.profile===directory)
  settings=await client.call(previous?engine==='deepseek'?'session/resume':'session/load':'session/new',{...(previous?{sessionId:previous.id}:{}),cwd,mcpServers:[{type:'http',name:'agents-company',url:bridge.url,headers:[]}]})
  state.sessionId=previous?.id??settings.sessionId
  const configure=async(id:string,value:string)=>{const result=await client.call('session/set_config_option',{sessionId:state.sessionId,configId:id,value:id==='model'?modelValue(engine,settings,value):value});if(result.configOptions)settings={...settings,configOptions:result.configOptions}}
  if(state.model)await configure('model',state.model);state.model=nativeModel(engine,option(settings,'model')?.currentValue)??state.model
  const effortId=engine==='deepseek'?'reasoning_effort':'effort'
  const setEffort=async(effort:string|null)=>{const available=choices(option(settings,effortId));let value=effort?available.find(o=>normalizeEffort(o.value)===effort)?.value:available.find(o=>o.value==='default'||o.value==='')?.value??option(settings,effortId)?.currentValue;if(!effort&&engine==='deepseek'){const catalog=await discoverNativeAcp(engine,state.model),nativeDefault=catalog.models.find(model=>model.value===state.model)?.defaultEffort;value=available.find(option=>normalizeEffort(option.value)===nativeDefault)?.value}if(value===undefined)throw Error('This model does not expose the requested native effort');await configure(effortId,value)}
  if(args.effort)await setEffort(args.effort)
  state.effort=normalizeEffort(option(settings,effortId)?.currentValue??'') as typeof state.effort
  if(state.planMode){if(engine==='deepseek')throw Error('DeepSeek Harness ACP does not expose plan mode');await configure('mode','plan')}
  const reference={engine,id:state.sessionId!,profile:directory}
  patchSession(cardId,{nativeSessions:[...(card?nativeSessionRefs(card):[]).filter(ref=>ref.engine!==engine||ref.id!==reference.id),reference],model:state.model,effort:state.effort,thinking:false})
  const unsupported=(feature:string)=>Promise.reject(Error(engine+' ACP does not expose '+feature))
  state.driver={
   send(text,images,taskId){
    if(engine==='deepseek'&&images.length)throw Error('DeepSeek Harness ACP does not advertise image input')
    receiptTaskId=taskId;receiptRead=false;state.running=true;state.abort=new AbortController();turnId=randomUUID();block=0;tools.clear();textSeen=false;acceptUpdates=true;host.rememberMeta(sessionId,{busy:true});host.emit('session:turn-start',{sessionId})
    state.finished=(async()=>{let error:string|undefined
     try{const result=await client.call('session/prompt',{sessionId:state.sessionId,prompt:[{type:'text',text},...images.map(image=>({type:'image',data:image.data,mimeType:image.mimeType}))]},0);if(result.stopReason==='cancelled')throw Error('Interrupted');if(result.stopReason==='refusal')throw Error('The native engine declined this request');if(!textSeen&&!tools.size&&!state.acknowledging)throw Error(engine+' returned no assistant response')}
     catch(cause){error=client.redact((cause as Error).message);if(host.isOpen(sessionId))host.emit('session:error',{sessionId,message:error})}
     finally{acceptUpdates=false;state.running=false;state.abort=undefined;cancelApprovals(sessionId);host.rememberMeta(sessionId,{busy:false});host.emit('session:result',{sessionId,success:!error,error});host.emit('session:turn-end',{sessionId});if(host.isOpen(sessionId))host.dispatchQueued(state,sessionId)}
    })()
   },
   steer(){return unsupported('steering; enqueue the next task instead')},
   async interrupt(){if(state.running){state.abort?.abort();client.notify('session/cancel',{sessionId:state.sessionId});await state.finished}},
   async close(){acceptUpdates=false;state.abort?.abort();try{if(engine==='deepseek'){if(state.running)client.notify('session/cancel',{sessionId:state.sessionId});await client.call('session/close',{sessionId:state.sessionId},10000)}}finally{await client.close();await bridge.close();await state.finished}},
   async whenIdle(){await state.finished},
   async setModel(model){await configure('model',model??(engine==='deepseek'?nativeModel(engine,option(settings,'model').currentValue):codeConfig(engine).model)??option(settings,'model').currentValue);host.rememberMeta(sessionId,{models:acpModels(engine,settings)})},
   async setPlan(enabled){if(engine==='deepseek')throw Error('DeepSeek Harness ACP does not expose plan mode');await configure('mode',enabled?'plan':engine==='kilo'?'code':'build')},
   async setPermission(mode){
    if(mode==='auto'||engine==='deepseek'&&mode==='plan')throw Error('This adapter does not provide the requested permission mode')
    if(engine!=='deepseek')return
    if(state.running)throw Error('Wait for the current task before changing DeepSeek permissions')
    await client.call('session/close',{sessionId:state.sessionId});await client.close();client=createClient(mode)
    await client.call('initialize',initialize);settings=await client.call('session/resume',{sessionId:state.sessionId,cwd,mcpServers:[{type:'http',name:'agents-company',url:bridge.url,headers:[]}]})
    if(state.model)await configure('model',state.model);if(state.effort)await setEffort(state.effort)
    host.rememberMeta(sessionId,{models:acpModels(engine,settings)})
   },
   async setThinking(enabled){if(enabled)throw Error('Use native reasoning effort for this engine')},
   async setEffort(effort){await setEffort(effort)},
   async setFast(enabled){if(enabled)throw Error(engine+' does not expose Fast mode')},
   background(){return unsupported('background process control')}
  } satisfies EngineDriver
  host.register(sessionId,state);host.rememberMeta(sessionId,{engine,cwd,model:state.model,permissionMode,effort:state.effort,thinking:false,thinkingManaged:true,thinkingSupported:false,planMode:state.planMode,fastMode:false,commands:[],models:acpModels(engine,settings),busy:false})
  return {sessionId,cwd,engine}
 }catch(error){await client.close();await bridge.close();throw error}
}
