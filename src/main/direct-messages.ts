import {validateMessageImages} from '../shared/message-inline-images'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {DIRECT_ATTACHMENT_PREFIX,DIRECT_UPLOAD_PREFIX,type DirectClearResult,type DirectEntry,type DirectFileItem,type DirectFilePage,type DirectHistory,type DirectReplyReference,type DirectSearchItem,type DirectSearchPage,type DirectStorageInfo} from '../shared/direct-messages'
import {messageLinks,messageReply,messagePreview} from '../shared/messages'
import {attachmentPaths,attachmentInfo,type MessageAttachment} from '../shared/message-attachments'
import type {Item,MessageReply,OutboundReceipt} from '../shared/types'
import type {PrincipalRef} from '../shared/management'
import type {MessageQuote} from '../shared/message-quotes'
import {validateApiArguments} from './api-contract'
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
const directory=path.join(APP_HOME,'direct'),mediaDirectory=(employee:string)=>path.join(directory,'media',employee),uploadsDirectory=(employee:string)=>path.join(directory,'uploads',employee),boot=randomUUID(),pending=new SingleFlight<Entry>(),cache=new ReadCache<State>(64,16*1024*1024)
export const directMediaRoot=(employee:string)=>mediaDirectory(employee)
let emit:(employee:string)=>void=()=>{},published:(employee:string,reference:DirectReplyReference)=>void=()=>{},acknowledged:(employee:string,reference:DirectReplyReference)=>void=()=>{},cleared:(employee:string)=>void=()=>{}
export function setDirectEmitter(handler:typeof emit){emit=handler}
export function setDirectReplyHandlers(posted:typeof published,read:typeof acknowledged){published=posted;acknowledged=read}
export function setDirectClearHandler(handler:typeof cleared){cleared=handler}
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
const effectiveDeliveryState=(entry:Entry)=>entry.delivery?(entry.delivery.boot!==boot&&['preparing','queued'].includes(entry.delivery.state)?'interrupted':entry.delivery.state):undefined
const isUnsentDirectEntry=(entry:Entry)=>{const s=effectiveDeliveryState(entry);return s==='preparing'||s==='queued'||s==='interrupted'}
const body=(entry:Entry):Item=>{
 const images=entry.attachments.filter(attachment=>attachment.kind==='image'),media={images:images.map(attachment=>attachment.path),imageNames:images.length?Object.fromEntries(images.map(attachment=>[attachment.path,attachment.name])):undefined,files:entry.attachments.filter(attachment=>attachment.kind==='file')}
 const deliveryState=effectiveDeliveryState(entry)
 return entry.author.kind==='operator'||entry.delivery
 ?{role:'user',id:entry.id,directSequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,text:entry.text,...media,reply:entry.reply,outbound:entry.outbound,delivery:entry.delivery?{state:deliveryState!,error:entry.delivery.error}:undefined}
 :{role:'assistant',id:entry.id,questionId:entry.questionId,author:entry.author,directSequence:entry.sequence,createdAt:entry.createdAt,blocks:entry.text?[{kind:'text',text:entry.text}]:[],...media,reply:entry.reply}
}

/** Public items are an independent ledger, never a projection of native Agent history. */
export function directItems(employee:string){readable(employee);return state(employee).entries.map(body)}
export function directPublishedEntry(employee:string,id:string){
 readable(employee);const entry=state(employee).entries.find(e=>e.id===id);if(!entry)throw Error('Private message is unavailable')
 return {id:entry.id,sequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,text:entry.text,attachments:entry.attachments,reply:entry.reply}
}
export function directSummary(employee:string){
 const value=state(employee),incoming=[...value.entries].reverse().find(e=>!e.delivery&&e.author.kind==='agent'),preview=messagePreview(value.entries.filter(e=>!isUnsentDirectEntry(e)).map(body))
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

const REMOTE_CHUNK=262144
const uploadLocation=(employee:string,reference:string)=>{
 if(!reference.startsWith(DIRECT_UPLOAD_PREFIX))throw Error('Invalid private upload path')
 const rest=reference.slice(DIRECT_UPLOAD_PREFIX.length),slash=rest.indexOf('/')
 if(slash<=0)throw Error('Invalid private upload path')
 const id=rest.slice(0,slash),name=rest.slice(slash+1)
 if(!/^[a-f0-9-]{36}$/i.test(id)||!name||name==='.'||name==='..'||name.includes('/')||name.includes('\\'))throw Error('Invalid private upload path')
 const root=path.join(uploadsDirectory(employee),id)
 return {id,root,name,full:path.join(root,name)}
}
export function directUploadDirectory(employee:string){
 card(employee)
 const id=randomUUID(),root=path.join(uploadsDirectory(employee),id)
 fs.mkdirSync(root,{recursive:true,mode:0o700})
 return {employee,id,root,path:'.',referencePrefix:DIRECT_UPLOAD_PREFIX+id}
}
export function directUploadEndpoint(employee:string,reference:string):FileEndpoint{
 readable(employee);const target=uploadLocation(employee,reference),context=requestContext()
 return {root:target.root,path:target.name,name:target.name,validate:async()=>{
  authorize('session.transcript',{employee},employee,context)
  const info=workspaceFiles(target.root,'copy-info',{path:target.name})
  if(!info.exists||!info.regular||info.symlink)throw Error('Staged private upload is unavailable')
 }}
}
async function storeLocalCopy(folder:string,fileUuid:string,sourceFull:string,sourceRoot:string,sourcePath:string,info:{bytes:number;modifiedAt:number},name:string,kind:'image'|'file',id:string,mimeType?:string){
 fs.mkdirSync(folder,{recursive:true,mode:0o700})
 const target=path.join(folder,fileUuid),reference=DIRECT_ATTACHMENT_PREFIX+id+'/'+fileUuid
 await fs.promises.copyFile(sourceFull,target,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE)
 await fs.promises.chmod(target,0o600)
 const after=workspaceFiles(sourceRoot,'copy-info',{path:sourcePath})
 if(!after.exists||!after.regular||after.bytes!==info.bytes||after.modifiedAt!==info.modifiedAt)throw Error('Attachment changed while sending; retry with the unchanged file')
 const copied=workspaceFiles(folder,'copy-info',{path:fileUuid})
 const descriptor={...attachmentInfo(name,info,kind,mimeType),path:reference}
 return {descriptor,source:{root:folder,path:fileUuid,name:descriptor.name,bytes:Number(copied.bytes),modifiedAt:Number(copied.modifiedAt)} as AttachmentSource}
}
async function storeRemoteCopy(folder:string,fileUuid:string,sessionKey:string,remote:NonNullable<FileEndpoint['remote']>,sourcePath:string,info:{bytes:number;modifiedAt:number},name:string,kind:'image'|'file',id:string,mimeType?:string){
 fs.mkdirSync(folder,{recursive:true,mode:0o700})
 const target=path.join(folder,fileUuid),reference=DIRECT_ATTACHMENT_PREFIX+id+'/'+fileUuid
 const fd=await fs.promises.open(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600)
 try{
  let offset=0
  while(offset<info.bytes){
   requestContext().signal?.throwIfAborted()
   const chunk=await remoteFiles(sessionKey,remote,'copy-read',{path:sourcePath,offset,length:Math.min(REMOTE_CHUNK,info.bytes-offset)})
   const buffer=Buffer.from(chunk.data,'base64')
   if(!buffer.length)throw Error('Remote attachment ended unexpectedly')
   await fd.write(buffer,0,buffer.length,offset)
   offset+=buffer.length
  }
 }finally{await fd.close()}
 const after=await remoteFiles(sessionKey,remote,'copy-info',{path:sourcePath})
 if(!after.exists||!after.regular||after.bytes!==info.bytes||after.modifiedAt!==info.modifiedAt)throw Error('Attachment changed while sending; retry with the unchanged file')
 const copied=workspaceFiles(folder,'copy-info',{path:fileUuid})
 const descriptor={...attachmentInfo(name,info,kind,mimeType),path:reference}
 return {descriptor,source:{root:folder,path:fileUuid,name:descriptor.name,bytes:Number(copied.bytes),modifiedAt:Number(copied.modifiedAt)} as AttachmentSource}
}

/** Private media is always materialized under APP_HOME/direct on Mac, decoupled from workspace. */
async function attachments(employee:string,id:string,images:unknown,files:unknown){
 const photos=attachmentPaths(images),docs=attachmentPaths(files)
 const sources:Record<string,AttachmentSource>={},result:MessageAttachment[]=[]
 let stampBinding:string|undefined
 const folder=path.join(mediaDirectory(employee),id)
 for(const [value,kind]of [...photos.map(p=>[p,'image'] as const),...docs.map(p=>[p,'file'] as const)]){
  requestContext().signal?.throwIfAborted();readable(employee)
  const fileUuid=randomUUID()
  if(value.startsWith(DIRECT_UPLOAD_PREFIX)){
   const upload=uploadLocation(employee,value),info=workspaceFiles(upload.root,'copy-info',{path:upload.name})
   if(!info.exists||!info.regular||info.symlink)throw Error('Only existing regular files can be sent')
   const mimeType=kind==='image'?(workspaceFiles(upload.root,'read-image',{path:upload.name}) as {mimeType:string}).mimeType:undefined
   const stored=await storeLocalCopy(folder,fileUuid,upload.full,upload.root,upload.name,info,upload.name,kind,id,mimeType)
   sources[stored.descriptor.path]=stored.source;result.push(stored.descriptor)
   continue
  }
  if(value.startsWith(DIRECT_ATTACHMENT_PREFIX)){
   const existing=directFileEndpoint(employee,value);await existing.validate?.('copy-info',{path:existing.path})
   const name=existing.name??path.basename(existing.path)
   if(existing.remote){
    const info=await remoteFiles('direct-post-'+id,existing.remote,'copy-info',{path:existing.path})
    if(!info.exists||!info.regular||info.symlink)throw Error('Only existing regular files can be sent')
    const mimeType=kind==='image'?(await remoteFiles('direct-post-'+id,existing.remote,'read-image',{path:existing.path})).mimeType:undefined
    const stored=await storeRemoteCopy(folder,fileUuid,'direct-post-'+id,existing.remote,existing.path,info,name,kind,id,mimeType)
    sources[stored.descriptor.path]=stored.source;result.push(stored.descriptor)
   }else{
    const info=workspaceFiles(existing.root,'copy-info',{path:existing.path})
    if(!info.exists||!info.regular||info.symlink)throw Error('Only existing regular files can be sent')
    const mimeType=kind==='image'?(workspaceFiles(existing.root,'read-image',{path:existing.path}) as {mimeType:string}).mimeType:undefined
    const stored=await storeLocalCopy(folder,fileUuid,path.join(existing.root,existing.path),existing.root,existing.path,info,name,kind,id,mimeType)
    sources[stored.descriptor.path]=stored.source;result.push(stored.descriptor)
   }
   continue
  }
  const c=executionEmployee(readStore(),card(employee)),root=employeeWorkspace(readStore(),c.cwd,c.id)
  if(stampBinding===undefined)stampBinding=binding(employee)
  const request=(operation:string)=>c.remote?remoteFiles('direct-post-'+id,c.remote,operation,{path:value}):Promise.resolve(workspaceFiles(root,operation,{path:value}))
  const info=await request('copy-info');if(!info.exists||!info.regular||info.symlink)throw Error('Only existing regular files can be sent')
  const mimeType=kind==='image'?(await request('read-image')).mimeType:undefined
  const stored=c.remote
   ?await storeRemoteCopy(folder,fileUuid,'direct-post-'+id,c.remote,value,info,value,kind,id,mimeType)
   :await storeLocalCopy(folder,fileUuid,workspacePath(root,value),root,value,info,value,kind,id,mimeType)
  sources[stored.descriptor.path]=stored.source;result.push(stored.descriptor)
 }
 if(stampBinding!==undefined&&binding(employee)!==stampBinding)throw Error('Employee workspace changed while sending')
 return {attachments:result,sources}
}
async function append(employee:string,args:Record<string,any>,author:PrincipalRef,incoming:boolean){
 readable(employee);const text=args.text??'',images=attachmentPaths(args.images),files=attachmentPaths(args.files),key=args.clientMessageId
 if(typeof text!=='string'||text.length>(incoming?100000:64000)||!text.trim()&&!images.length&&!files.length)throw Error('Provide text, images or files')
 if(typeof key!=='string'||!key||key!==key.trim()||key.length>160)throw Error('Provide a stable clientMessageId')
 validateMessageImages(text,images.length)
 const fingerprint=hash([text,images,files,args.replyTo??null,args.replyQuote??null,args.replyConversation??null]),find=()=>state(employee).entries.find(e=>sameAuthor(e.author,author)&&!!e.delivery===incoming&&e.clientMessageId===key),previous=find()
 if(previous){if(previous.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return previous}
 const result=await pending.run(employee+'/'+hash([author,key,incoming]),async()=>{
  const known=find();if(known){if(known.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return known}
  const id='dm_'+randomUUID()
  try{
   const media=await attachments(employee,id,images,files)
   authorize(incoming?'direct.send':'direct.post',{employee},employee);readable(employee)
   const reply=args.resolvedReply??(args.replyTo?directReply(employee,args.replyTo,args.replyQuote):undefined),value=state(employee),initialDeliveryState=args.initialDeliveryState==='queued'?'queued':'preparing',entry:Entry={id,sequence:(value.entries.at(-1)?.sequence??0)+1,createdAt:Date.now(),author,text,clientMessageId:key,fingerprint,...media,...(reply?{reply}:{}),...(incoming?{delivery:{state:initialDeliveryState,boot}}:{})}
   value.entries.push(entry);save(employee,value);if(!incoming)published(employee,{messageId:entry.id,sequence:entry.sequence});return entry
  }catch(error){fs.rmSync(path.join(directory,'media',employee,id),{recursive:true,force:true});throw error}
 });if(result.fingerprint!==fingerprint)throw Error('Client message ID already used for different private content');return result
}
export async function postDirectMessage(args:Record<string,any>){
 for(const key of Object.keys(args))if(!['text','images','files','replyTo','replyQuote','clientMessageId'].includes(key))throw Error('Unknown direct.post field: '+key)
 const principal=requestContext().principal;if(principal.kind!=='agent')throw Error('direct.post publishes the authenticated employee’s own private reply; use direct.send for user input')
 const entry=await append(principal.employeeId,args,principal,false);return {sent:true,id:entry.id,sequence:entry.sequence,conversation:'employee:'+principal.employeeId,createdAt:entry.createdAt,attachments:entry.attachments}
}
export function linkDirectQuestion(employee:string,messageId:string,questionId:string){const value=state(employee),entry=value.entries.find(entry=>entry.id===messageId);if(!entry)throw Error('Question publication is unavailable');entry.questionId=questionId;save(employee,value)}
export async function prepareDirectInput(employee:string,args:Record<string,any>){if(!isAppAdministrator())throw Error('Only the user or Secretary may send private user input');return append(employee,args,requestContext().principal,true)}
export function updateDirectInput(employee:string,id:string,patch:Partial<DirectEntry>){const value=state(employee),index=value.entries.findIndex(e=>e.id===id&&e.delivery);if(index<0)return;value.entries[index]={...value.entries[index],...patch};save(employee,value)}
export function dispatchDirectInput(employee:string,id:string,taskId:string){
 const value=state(employee),index=value.entries.findIndex(e=>e.id===id&&e.delivery)
 if(index<0)return
 const current=value.entries[index],wasQueued=current.delivery?.state==='queued',notLast=index<value.entries.length-1
 const nextSequence=notLast?(value.entries.at(-1)!.sequence+1):current.sequence
 const updated:Entry={...current,sequence:nextSequence,createdAt:wasQueued||notLast?Date.now():current.createdAt,nativeTaskId:taskId,outbound:{...current.outbound,taskId}}
 if(notLast){value.entries.splice(index,1);value.entries.push(updated)}else value.entries[index]=updated
 save(employee,value)
}
export function directDelivery(employee:string,id:string,status:NonNullable<DirectEntry['delivery']>['state'],error?:string){
 const value=state(employee),index=value.entries.findIndex(e=>e.id===id&&e.delivery)
 if(index<0)return
 const current=value.entries[index].delivery
 if(status==='queued'&&current&&['accepted','failed','interrupted'].includes(current.state))return
 if(current?.state===status&&current.boot===boot&&(current.error??undefined)===(error??undefined))return
 value.entries[index]={...value.entries[index],delivery:{state:status,boot,...(error?{error}:{})}}
 save(employee,value)
}
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

const attachmentHashId=(value:string)=>'attachment:'+createHash('sha256').update(value).digest('hex').slice(0,32)
const entryRole=(entry:Entry):'user'|'assistant'=>entry.author.kind==='operator'||!!entry.delivery?'user':'assistant'
const sourceAvailable=(entry:Entry,reference:string)=>{const source=entry.sources?.[reference];if(!source)return false;return source.remote?true:fs.existsSync(path.join(source.root,source.path))}
function resolveTargetEmployee(employee?:unknown){
 if(typeof employee==='string'&&employee.trim())return employee.trim()
 const caller=callerEmployee(requestContext().principal);if(caller)return caller.id
 throw Error('Specify --employee')
}
function directoryStats(root:string):{files:number;bytes:number}{
 if(!fs.existsSync(root))return {files:0,bytes:0}
 let files=0,bytes=0
 const walk=(current:string)=>{
  for(const entry of fs.readdirSync(current,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue
   const full=path.join(current,entry.name)
   if(entry.isDirectory())walk(full)
   else if(entry.isFile()){files++;bytes+=fs.lstatSync(full).size}
  }
 }
 walk(root);return {files,bytes}
}
export function directFiles(args:Record<string,any>):DirectFilePage{
 validateApiArguments('direct.files',args)
 const employee=resolveTargetEmployee(args.employee);readable(employee)
 const query=(args.query??'').trim().toLocaleLowerCase(),kind=args.kind??'all',author=args.author??'all',sort=args.sort??'newest',offset=args.offset??0,limit=args.limit??100
 const files:DirectFileItem[]=[]
 for(const entry of state(employee).entries){
  const role=entryRole(entry)
  if(author==='you'&&role!=='user'||author==='employee'&&role!=='assistant')continue
  for(const att of entry.attachments){
   if(kind!=='all'&&att.kind!==kind)continue
   if(query&&!att.name.toLocaleLowerCase().includes(query)&&!att.mimeType.toLocaleLowerCase().includes(query))continue
   const attachmentId=attachmentHashId(att.path),available=sourceAvailable(entry,att.path)
   files.push({id:attachmentId,path:att.path,name:att.name,kind:att.kind,mimeType:att.mimeType,bytes:att.bytes,available,messageId:entry.id,sequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,read:{command:att.kind==='image'?'workspace.image':'workspace.read',args:{employee,path:att.path}},download:{command:'conversation.download',args:{conversation:'employee:'+employee,entryId:entry.id,attachmentId}}})
  }
 }
 files.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name)||(b.sequence-a.sequence):sort==='size'?(b.bytes-a.bytes)||(b.sequence-a.sequence)||a.name.localeCompare(b.name):(b.createdAt-a.createdAt)||(b.sequence-a.sequence)||a.name.localeCompare(b.name))
 const totalBytes=files.reduce((sum,item)=>sum+(item.available?item.bytes:0),0),page=files.slice(offset,offset+limit)
 return {employee,conversation:'employee:'+employee,storageLocation:'mac-local',workspaceDecoupled:true,files:page,total:files.length,totalBytes,nextOffset:offset+page.length<files.length?offset+page.length:null}
}
export function directSearch(args:Record<string,any>):DirectSearchPage{
 validateApiArguments('direct.search',args)
 const employee=resolveTargetEmployee(args.employee);readable(employee)
 const query=(args.query??'').trim().toLocaleLowerCase(),filter=args.filter??'all',author=args.author??'all',from=args.from as number|undefined,to=args.to as number|undefined,offset=args.offset??0,limit=args.limit??50
 if(from!==undefined&&to!==undefined&&from>to)throw Error('Choose a valid date range')
 const items:DirectSearchItem[]=[]
 for(const entry of state(employee).entries){
  if(isUnsentDirectEntry(entry))continue
  const role=entryRole(entry),links=messageLinks(entry.text)
  if(author==='you'&&role!=='user'||author==='employee'&&role!=='assistant')continue
  if(from!==undefined&&entry.createdAt<from||to!==undefined&&entry.createdAt>to)continue
  const hasMedia=entry.attachments.some(att=>att.kind==='image'||att.mimeType.startsWith('video/')),hasAudio=entry.attachments.some(att=>att.mimeType.startsWith('audio/')),hasFiles=entry.attachments.some(att=>att.kind==='file'),hasLinks=links.length>0
  if(filter==='media'&&!hasMedia||filter==='audio'&&!hasAudio||filter==='files'&&!hasFiles||filter==='links'&&!hasLinks)continue
  if(query&&![entry.text,...entry.attachments.map(att=>att.name),...links].join(' ').toLocaleLowerCase().includes(query))continue
  items.push({id:entry.id,sequence:entry.sequence,createdAt:entry.createdAt,author:entry.author,role,text:entry.text,attachments:entry.attachments,links,...(entry.reply?{reply:entry.reply}:{})})
 }
 items.sort((a,b)=>(b.createdAt-a.createdAt)||(b.sequence-a.sequence))
 const page=items.slice(offset,offset+limit)
 return {employee,conversation:'employee:'+employee,items:page,total:items.length,nextOffset:offset+page.length<items.length?offset+page.length:null}
}
export function directStorage(args:Record<string,any>):DirectStorageInfo{
 validateApiArguments('direct.storage',args)
 const employee=resolveTargetEmployee(args.employee);readable(employee)
 const value=state(employee),media=directoryStats(mediaDirectory(employee)),uploads=directoryStats(uploadsDirectory(employee)),ledger=file(employee),ledgerBytes=fs.existsSync(ledger)?fs.lstatSync(ledger).size:0
 const fileCount=value.entries.reduce((n,entry)=>n+entry.attachments.filter(att=>sourceAvailable(entry,att.path)).length,0)
 return {employee,conversation:'employee:'+employee,storageLocation:'mac-local',workspaceDecoupled:true,messageCount:value.entries.length,fileCount,mediaBytes:media.bytes,uploadStagingBytes:uploads.bytes,ledgerBytes,totalBytes:media.bytes+uploads.bytes+ledgerBytes,revision:value.revision}
}
export function directClear(args:Record<string,any>):DirectClearResult{
 if(!isAppAdministrator())throw Error('Only the user or Secretary may clear private chat history')
 validateApiArguments('direct.clear',args)
 const employee=String(args.employee);readable(employee)
 const scope=(args.scope??'all') as 'all'|'files',value=state(employee)
 const mediaBefore=directoryStats(mediaDirectory(employee)),uploadsBefore=directoryStats(uploadsDirectory(employee)),ledger=file(employee),ledgerBefore=fs.existsSync(ledger)?fs.lstatSync(ledger).size:0
 const removedFiles=Math.max(mediaBefore.files+uploadsBefore.files,value.entries.reduce((n,entry)=>n+entry.attachments.length,0))
 fs.rmSync(mediaDirectory(employee),{recursive:true,force:true})
 fs.rmSync(uploadsDirectory(employee),{recursive:true,force:true})
 let removedMessages=0
 if(scope==='all'){
  removedMessages=value.entries.length
  value.entries=[];value.readSequence=0
  save(employee,value);cleared(employee)
 }else{
  const beforeCount=value.entries.length
  const next:Entry[]=[]
  for(const entry of value.entries){
   if(!entry.text.trim())continue
   if(entry.attachments.length||entry.sources){const cleaned:Entry={...entry,attachments:[]};delete cleaned.sources;next.push(cleaned)}
   else next.push(entry)
  }
  removedMessages=beforeCount-next.length
  value.entries=next
  if(removedFiles>0||removedMessages>0)save(employee,value)
 }
 const ledgerAfter=fs.existsSync(ledger)?fs.lstatSync(ledger).size:0
 return {cleared:true,employee,scope,removedMessages,removedFiles,freedBytes:mediaBefore.bytes+uploadsBefore.bytes+Math.max(0,ledgerBefore-ledgerAfter),workspaceUntouched:true}
}
