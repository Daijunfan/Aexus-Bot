import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {DIRECT_ATTACHMENT_PREFIX,type DirectEntry,type DirectHistory,type DirectReplyReference} from '../shared/direct-messages'
import {messageReply,messagePreview} from '../shared/messages'
import {attachmentPaths,attachmentInfo,type MessageAttachment} from '../shared/message-attachments'
import type {Item,MessageReply,OutboundReceipt} from '../shared/types'
import type {PrincipalRef} from '../shared/management'
import type {MessageQuote} from '../shared/message-quotes'
import {atomicJson,readJson} from './atomic-file'
import {authorize,callerEmployee,isAppAdministrator,requestContext} from './authorization'
import {readStore} from './store'
import {employeeWorkspace,executionEmployee} from './workspaces'
import {workspaceFiles,workspacePath} from './files'
import {remoteFiles} from './tunnel'
import {fileVersion,ReadCache} from './read-cache'
import {SingleFlight} from './single-flight'
import type {FileEndpoint} from './transfers'

type AttachmentSource=FileEndpoint&{bytes:number;modifiedAt:number;binding?:string}
type Entry=DirectEntry&{sources?:Record<string,AttachmentSource>}
type State={version:1;revision:number;readSequence:number;entries:Entry[]}
const directory=path.join(APP_HOME,'direct'),boot=randomUUID(),pending=new SingleFlight<Entry>(),cache=new ReadCache<State>(64,16*1024*1024)
let emit:(employee:string)=>void=()=>{},published:(employee:string,reference:DirectReplyReference)=>void=()=>{},acknowledged:(employee:string,reference:DirectReplyReference)=>void=()=>{}
export function setDirectEmitter(handler:typeof emit){emit=handler}
export function setDirectReplyHandlers(posted:typeof published,read:typeof acknowledged){published=posted;acknowledged=read}
const file=(employee:string)=>path.join(directory,employee+'.json')
export const directVersion=(employee:string)=>fileVersion(file(employee))
const state=(employee:string)=>cache.get(employee,directVersion(employee),()=>readJson<State>(file(employee),()=>({version:1,revision:0,readSequence:0,entries:[]}),value=>(value as State)?.version===1&&Array.isArray((value as State)?.entries)),value=>Buffer.byteLength(JSON.stringify(value)))
function save(employee:string,value:State){value.revision++;atomicJson(file(employee),value,true);emit(employee)}
function card(employee:string){const value=readStore().sessions.find(c=>c.id===employee&&!c.deleting);if(!value)throw Error('Unknown employee conversation');return value}
function readable(employee:string){card(employee);authorize('session.transcript',{employee},employee)}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const directSendKey=(value:string)=>'direct:'+hash(value)
const sameAuthor=(a:PrincipalRef,b:PrincipalRef)=>a.kind===b.kind&&(a.kind==='operator'||b.kind==='agent'&&a.employeeId===b.employeeId)
const binding=(employee:string)=>{const c=executionEmployee(readStore(),card(employee));return JSON.stringify([c.cwd,c.remote??null])}
const body=(entry:Entry):Item=>entry.author.kind==='operator'||entry.delivery
 ?{role:'user',id:entry.id,directSequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,text:entry.text,images:entry.attachments.filter(a=>a.kind==='image').map(a=>a.path),files:entry.attachments.filter(a=>a.kind==='file'),reply:entry.reply,outbound:entry.outbound,delivery:entry.delivery?{state:entry.delivery.boot!==boot&&['preparing','queued'].includes(entry.delivery.state)?'interrupted':entry.delivery.state,error:entry.delivery.error}:undefined}
 :{role:'assistant',id:entry.id,author:entry.author,directSequence:entry.sequence,createdAt:entry.createdAt,blocks:entry.text?[{kind:'text',text:entry.text}]:[],images:entry.attachments.filter(a=>a.kind==='image').map(a=>a.path),files:entry.attachments.filter(a=>a.kind==='file'),reply:entry.reply}

/** Public items are an independent ledger, never a projection of native Agent history. */
export function directItems(employee:string){readable(employee);return state(employee).entries.map(body)}
export function directPublishedEntry(employee:string,id:string){
 readable(employee);const entry=state(employee).entries.find(e=>e.id===id);if(!entry)throw Error('Private message is unavailable')
 return {id:entry.id,sequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,text:entry.text,attachments:entry.attachments,reply:entry.reply}
}
export function directSummary(employee:string){
 const value=state(employee),incoming=[...value.entries].reverse().find(e=>!e.delivery&&e.author.kind==='agent'),preview=messagePreview(value.entries.map(body))
 return {...preview,unread:!!incoming&&incoming.sequence>value.readSequence,latestIncoming:incoming?{messageId:incoming.id,sequence:incoming.sequence}:undefined,readSequence:value.readSequence,revision:value.revision}
}
export function directHistory(args:{employee:string;limit?:number;before?:number;around?:string}):DirectHistory{
 readable(args.employee);const value=state(args.employee),limit=args.limit??200
 if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('limit must be 1..500')
 let entries=value.entries.filter(e=>args.before===undefined||e.sequence<args.before)
 if(args.around){const index=entries.findIndex(e=>e.id===args.around);if(index<0)throw Error('Private message is unavailable');const start=Math.max(0,index-Math.floor(limit/2));entries=entries.slice(start,start+limit)}else entries=entries.slice(-limit)
 return {items:entries.map(body),revision:value.revision,latestIncoming:directSummary(args.employee).latestIncoming,readSequence:value.readSequence,nextBefore:entries.length&&value.entries[0].sequence<entries[0].sequence?entries[0].sequence:null}
}
export function directReply(employee:string,id:string,quote?:MessageQuote):MessageReply{
 readable(employee);const entry=state(employee).entries.find(e=>e.id===id),reply=entry&&messageReply(body(entry),quote)
 if(!reply)throw Error('Private reply target is unavailable')
 return {...reply,conversation:'employee:'+employee,conversationTitle:card(employee).title}
}

/** Only file metadata is published for remote files; Mac never silently downloads them. */
async function attachments(employee:string,id:string,images:unknown,files:unknown){
 const photos=attachmentPaths(images),docs=attachmentPaths(files);if(photos.length+docs.length>16)throw Error('Choose at most 16 attachments')
 const sources:Record<string,AttachmentSource>={},result:MessageAttachment[]=[],c=executionEmployee(readStore(),card(employee)),root=employeeWorkspace(readStore(),c.group,c.cwd,c.id),stamp=binding(employee)
 for(const [value,kind]of [...photos.map(p=>[p,'image'] as const),...docs.map(p=>[p,'file'] as const)]){
  requestContext().signal?.throwIfAborted();readable(employee)
  const request=(operation:string)=>c.remote?remoteFiles('direct-post-'+id,c.remote,operation,{path:value}):Promise.resolve(workspaceFiles(root,operation,{path:value}))
  const info=await request('copy-info');if(!info.exists||!info.regular||info.symlink)throw Error('Only existing regular files can be sent')
  const mimeType=kind==='image'?(await request('read-image')).mimeType:undefined,reference=DIRECT_ATTACHMENT_PREFIX+id+'/'+randomUUID(),descriptor={...attachmentInfo(value,info,kind,mimeType),path:reference}
  if(c.remote)sources[reference]={root:c.cwd,path:value,remote:c.remote,name:descriptor.name,bytes:info.bytes,modifiedAt:info.modifiedAt,binding:stamp}
  else{
   const folder=path.join(directory,'media',employee,id);fs.mkdirSync(folder,{recursive:true,mode:0o700});const target=path.join(folder,reference.split('/').at(-1)!)
   await fs.promises.copyFile(workspacePath(root,value),target,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);await fs.promises.chmod(target,0o600)
   const after=workspaceFiles(root,'copy-info',{path:value});if(after.bytes!==info.bytes||after.modifiedAt!==info.modifiedAt)throw Error('Attachment changed while sending; retry with the unchanged file')
   const copied=workspaceFiles(folder,'copy-info',{path:path.basename(target)});sources[reference]={root:folder,path:path.basename(target),name:descriptor.name,bytes:Number(copied.bytes),modifiedAt:Number(copied.modifiedAt)}
  }
  result.push(descriptor)
 }
 if(binding(employee)!==stamp)throw Error('Employee workspace changed while sending')
 return {attachments:result,sources}
}
async function append(employee:string,args:Record<string,any>,author:PrincipalRef,incoming:boolean){
 readable(employee);const text=args.text??'',images=attachmentPaths(args.images),files=attachmentPaths(args.files),key=args.clientMessageId
 if(typeof text!=='string'||text.length>(incoming?100000:64000)||!text.trim()&&!images.length&&!files.length)throw Error('Provide text, images or files')
 if(typeof key!=='string'||!key||key!==key.trim()||key.length>160)throw Error('Provide a stable clientMessageId')
 const fingerprint=hash([text,images,files,args.replyTo??null,args.replyQuote??null,args.replyConversation??null,args.viewId??null]),find=()=>state(employee).entries.find(e=>sameAuthor(e.author,author)&&!!e.delivery===incoming&&e.clientMessageId===key),previous=find()
 if(previous){if(previous.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return previous}
 const result=await pending.run(employee+'/'+hash([author,key,incoming]),async()=>{
  const known=find();if(known){if(known.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return known}
  const id='dm_'+randomUUID()
  try{
   const media=await attachments(employee,id,images,files)
   authorize(incoming?'direct.send':'direct.post',{employee},employee);readable(employee)
   const reply=args.resolvedReply??(args.replyTo?directReply(employee,args.replyTo,args.replyQuote):undefined),value=state(employee),entry:Entry={id,sequence:(value.entries.at(-1)?.sequence??0)+1,createdAt:Date.now(),author,text,clientMessageId:key,fingerprint,...media,...(reply?{reply}:{}),...(incoming?{delivery:{state:'preparing',boot}}:{})}
   value.entries.push(entry);save(employee,value);if(!incoming)published(employee,{messageId:entry.id,sequence:entry.sequence});return entry
  }catch(error){fs.rmSync(path.join(directory,'media',employee,id),{recursive:true,force:true});throw error}
 });if(result.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return result
}
export async function postDirectMessage(args:Record<string,any>){
 for(const key of Object.keys(args))if(!['text','images','files','replyTo','replyQuote','clientMessageId'].includes(key))throw Error('Unknown direct.post field: '+key)
 const principal=requestContext().principal;if(principal.kind!=='agent')throw Error('direct.post publishes the authenticated employee’s own private reply; use direct.send for user input')
 const entry=await append(principal.employeeId,args,principal,false);return {sent:true,id:entry.id,sequence:entry.sequence,conversation:'employee:'+principal.employeeId,createdAt:entry.createdAt,attachments:entry.attachments}
}
export async function prepareDirectInput(employee:string,args:Record<string,any>){if(!isAppAdministrator())throw Error('Only the user or Secretary may send private user input');return append(employee,args,requestContext().principal,true)}
export function updateDirectInput(employee:string,id:string,patch:Partial<DirectEntry>){const value=state(employee),index=value.entries.findIndex(e=>e.id===id&&e.delivery);if(index<0)return;value.entries[index]={...value.entries[index],...patch};save(employee,value)}
export function directDelivery(employee:string,id:string,status:NonNullable<DirectEntry['delivery']>['state'],error?:string){updateDirectInput(employee,id,{delivery:{state:status,boot,...(error?{error}:{})}})}
export function recordDirectReceipt(employee:string,taskId:string,stage:'delivered'|'read'){
 const value=state(employee),entry=value.entries.find(e=>e.outbound?.taskId===taskId);if(!entry)return
 entry.outbound={...entry.outbound!,deliveredAt:entry.outbound!.deliveredAt??Date.now(),...(stage==='read'?{readAt:entry.outbound!.readAt??Date.now()}:{})};save(employee,value)
}
export function advanceDirectRead(employee:string,reference:DirectReplyReference){
 const value=state(employee),entry=value.entries.find(e=>e.id===reference.messageId&&e.sequence===reference.sequence&&!e.delivery&&e.author.kind==='agent'&&e.author.employeeId===employee)
 if(!entry)return false;if(value.readSequence<entry.sequence){value.readSequence=entry.sequence;save(employee,value)}return true
}
export function acknowledgeDirect(args:{employee:string;messageId:string}){
 if(!isAppAdministrator())throw Error('Only the user or Secretary may acknowledge private messages');readable(args.employee)
 const entry=state(args.employee).entries.find(e=>e.id===args.messageId&&!e.delivery&&e.author.kind==='agent');if(!entry)throw Error('Incoming private message is unavailable')
 const reference={messageId:entry.id,sequence:entry.sequence};advanceDirectRead(args.employee,reference);acknowledged(args.employee,reference);return {acknowledged:true,...reference}
}
export function directFileEndpoint(employee:string,reference:string):FileEndpoint{
 readable(employee);const source=state(employee).entries.flatMap(e=>Object.entries(e.sources??{})).find(([key])=>key===reference)?.[1]
 if(!source)throw Error('Only published private attachments are readable')
 const context=requestContext()
 return {...source,validate:async()=>{
  authorize('session.transcript',{employee},employee,context);if(source.binding&&binding(employee)!==source.binding)throw Error('The attachment’s execution host or workspace changed')
  const info=source.remote?await remoteFiles('direct-file-'+employee,source.remote,'copy-info',{path:source.path}):workspaceFiles(source.root,'copy-info',{path:source.path})
  if(!info.regular||info.bytes!==source.bytes||info.modifiedAt!==source.modifiedAt)throw Error('Published attachment is unavailable or changed; ask the sender to publish it again')
 }}
}
