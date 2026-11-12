import {pluginMethodReadOnly} from './plugins/registry'
import {randomUUID} from 'node:crypto'
import {apiFailure,knownApi,validateApiArguments} from './api-contract'
import {boundedApiResult} from './api-results'
import {apiReadOnly} from '../shared/api-effects'
import {allowedCommands,withCaller} from './authorization'
import {documentationIdentity} from './documentation-tool'
import {approvalHandler} from './approvals'
import type {Live} from './sessions'

export const API_TOOL={
 name:'agents_company_api',
 description:'以当前员工身份执行既有 Core API。先按需 api.list 缩小范围，再 api.describe 查询准确参数；插件先读对应方法文档。参数只用 command 与 args，不传身份或 token。读取文档不增加权限，写入仍受 Core 与原生批准检查。成功结果出现 api-result-page 时按 nextCall 续读，不重复写操作。普通 Team 回复使用原生正文，私聊 direct.post，群聊显式 chat.post。',
 inputSchema:{type:'object',additionalProperties:false,required:['command'],properties:{command:{type:'string',minLength:1,description:'Exact existing Core command, e.g. plan.query, schedule.delete or plugin.call'},args:{type:'object',additionalProperties:true,description:'That command’s API arguments; no token, identity or wrapper. Omit for {}.'}}}
} as const
const approvals=new WeakMap<Live,ReturnType<typeof approvalHandler>>()
export function prepareApiTool(state:Live,sessionId:string,changed:()=>void){approvals.set(state,approvalHandler(sessionId,changed))}
export async function invokeApiTool(state:Live,input:unknown,callId:string,signal?:AbortSignal):Promise<unknown>{
 if(!callId||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['command','args'].includes(key)))throw Error('Provide command and optional args')
 const value=input as {command?:unknown;args?:unknown}
 if(typeof value.command!=='string'||!value.command||value.command.length>120||value.args!==undefined&&(!value.args||typeof value.args!=='object'||Array.isArray(value.args)))throw Error('Choose a Core command and an object of arguments')
 const command=value.command,args=JSON.parse(JSON.stringify(value.args??{})) as Record<string,unknown>,task=state.currentTask?.messageId
 const active=()=>{signal?.throwIfAborted();if(!task||!state.running||state.privateInitialization||state.acknowledging||state.currentTask?.messageId!==task)throw Error('Core API calls require the current employee work turn; unavailable during initialization or private context reading')}
 active()
 const context=documentationIdentity(state)
 knownApi(command)
 const available=()=>withCaller(context,()=>{documentationIdentity(state);if(!allowedCommands(context).some(item=>item.name===command))throw Error('API not available to this caller: '+command)})
 available()
 validateApiArguments(command,args)
 if(command==='api.list'&&args.compact===undefined)args.compact=true
 // Replying to this application's user is communication, including in Plan mode.
 // direct.post cannot address peers, dispatch work or modify workspace files.
 const writing=command==='direct.post'?false:command==='plugin.call'?!pluginMethodReadOnly(String(args.id),String(args.method)):!apiReadOnly(command,args)
 let approved=false
 if(writing){
  if(state.planMode||state.permissionMode==='plan')throw Error('Native planning mode is read-only; switch to execution mode before changing application data')
  if(state.permissionMode==='dontAsk')throw Error('Write approval is disabled in this execution mode')
  if(state.permissionMode!=='bypassPermissions'){
   const approve=approvals.get(state);if(!approve)throw Error('Employee API approval is unavailable; reopen this employee')
   const answer=await approve(API_TOOL.name,{command,args},{signal:signal??new AbortController().signal,toolUseID:callId+':'+randomUUID(),requestId:callId,title:'Aexus Bot: '+command})
   if(answer?.behavior!=='allow')throw Error('Declined by user')
   approved=true;active();available()
   if(state.planMode||['plan','dontAsk'].includes(state.permissionMode))throw Error('Execution permissions changed while awaiting approval')
  }
 }
 const {handleRequest}=await import('./server')
 active();available()
 if(writing&&(state.planMode||['plan','dontAsk'].includes(state.permissionMode)||state.permissionMode!=='bypassPermissions'&&!approved))throw Error('Execution permissions changed before dispatch')
 // Dispatcher binds authors, rechecks target authorization and validates all domain arguments.
 try{
  const data=await handleRequest({cmd:command,args},{...context,requestId:'native:'+state.cardId+':'+callId,...(signal?{signal}:{})})
  return command==='api.result'?{ok:true,data}:boundedApiResult(context,command,{ok:true,data})
 }catch(error){throw apiFailure(error,command)}
}
