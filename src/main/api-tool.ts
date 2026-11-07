import {BOT_WORKER_GUIDANCE} from '../shared/bot-workers'
import {MESSAGE_REPLY_GUIDANCE} from '../shared/message-source'
import {pluginMethodReadOnly} from './plugins/registry'
import {randomUUID} from 'node:crypto'
import {apiReadOnly} from '../shared/api-effects'
import {allowedCommands,withCaller} from './authorization'
import {documentationIdentity} from './documentation-tool'
import {approvalHandler} from './approvals'
import type {Live} from './sessions'

export const API_TOOL={
 name:'agents_company_api',
 description:MESSAGE_REPLY_GUIDANCE+' '+BOT_WORKER_GUIDANCE+' Use this tool for application operations; ordinary Team replies use native text. Private direct.post is communication and remains available in native Plan/Ask modes. direct.send is user/Secretary input to an employee, not a reply API. For group files, all current members have equal shared-content rights. Use conversation.entry and conversation.download/download-status to copy attachments to your own Company execution workspace; edit there, then conversation.upload/upload-status with expectedVersion to update the shared file without overwriting another edit. Publish the completed @workspace paths with chat.post (images/files may be sent without text). User and Secretary use conversation.download-local to save an attachment to an explicit absolute Mac/Core-host file path, including when the Secretary is not a group member. Discover the schemas rather than assuming a Core path exists on your execution host. Call a documented Aexus Bot Core command as your authenticated employee. Discover schemas with api.list and api.describe. Core checks role, membership, workspace and execution permission. plan.query/schedule.* manage Plan. Group conversation.notice-* posts timed fixed text without Agent work. Channels are read-only news feeds: channel.list/get discover them; channel.sources with query finds authors by name or handle; channel.source-info returns their profile; channel.context lists sources inside a platform aggregate. sourceIds filters multiple authors (OR). since/until accept epoch milliseconds or ISO timestamps with UTC offsets; timeRanges combines separate date/time windows (OR). keywordsAll, keywordsAny and excludeKeywords combine AND/OR/NOT literal terms; filter groups combine with AND. Use system.info clock (Core time/timeZone) as a reference, honoring any timezone the user supplies. Resolve relative dates in the user timezone and explain the chosen time window. Follow nextCursor with unchanged filters to cover all matching news; channel.source-order lets user/Secretary persist author order independently of subscriptions; channel.fetch-text and channel.fetch-images read recent full messages with limit/cursor, and channel.search searches them. Authorized employees can explicitly fetch unsaved news; channel.access grants reading access. Secretary always accesses and manages all channels without a grant. Secretary can perform user-facing application operations through these same APIs, including messenger.reorder for channel/category order (read messenger.state first and supply expectedOrder), channel.access, subscriptions, groups, files and settings. fetch-images returns native image blocks; text reads never load image bytes. Explicit fetch results can persist in your native history. Plugins do not require plugin teams: plugin.resources lists your authorized pages/documents/hosts and nativeId; plugin.call {id,method,params} uses those content rights without --team or --employee. plugin.access lets user/Secretary grant read/write/create on selected content; Secretary always has full access. workspace.catalog lists your Company/Message workspaces; conversation.entry reads complete published posts and attachments; conversation.download/download-status copies attachments into your own selected workspace and reports completion. Queries need no approval; writes follow Ask/Full access and native planning mode.',
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
 const available=()=>withCaller(context,()=>{documentationIdentity(state);if(!allowedCommands(context).some(item=>item.name===command))throw Error('API not available to this caller: '+command)})
 available()
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
 const data=await handleRequest({cmd:command,args},{...context,requestId:'native:'+state.cardId+':'+callId,...(signal?{signal}:{})})
 return {ok:true,data}
}
