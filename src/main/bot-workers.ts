import {quoteShape,validateQuote} from '../shared/message-quotes'
import {controlChanged} from './conversation-policy'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import type {ChatGroup,ChatMessage} from '../shared/chat-groups'
import type {BotFile,BotProvider} from '../shared/bot-workers'
import {DEFAULT_DOT_AVATAR} from '../shared/bot-workers'
import {resolveAvatar} from '../shared/avatars'
import {activeAvatarIds} from './avatar-catalog'
import type {MessageAttachment} from '../shared/message-attachments'
import {attachmentPaths,attachmentInfo,fileMime} from '../shared/message-attachments'
import {atomicJson,readJson} from './atomic-file'
import {readStore} from './store'
import {isAppAdministrator,requireAppAdministrator} from './application-authority'
import {requestContext,operatorContext,withCaller,callerEmployee} from './authorization'
import {catalog,indexFile,messages,historyFile,emitChatChange,advanceGroupRead} from './chat-group-store'
import {conversationFileEndpoint} from './conversation-workspaces'
import {workspaceFiles} from './files'
import {remoteFiles} from './tunnel'
import type {FileEndpoint} from './transfers'
import {SingleFlight} from './single-flight'
import {removeIndexedConversation} from './message-index-client'
import {remoteBots,remoteCreate,remoteMessages,remoteRead,remoteSend,remoteUpload,watchRemote,type RemoteBot,type RemoteMessage} from './bot-bridge/client'

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const flights=new SingleFlight<any>(),watches=new Map<string,()=>void>(),syncing=new Set<string>()
const removedFile=path.join(APP_HOME,'bot-removed.json')
const removedBots=()=>readJson<Record<string,{group:ChatGroup;removedAt:number}>>(removedFile,()=>({}))
let timer:NodeJS.Timeout|undefined,stopped=true
export const botGroup=(id:unknown)=>typeof id==='string'?catalog().groups.find(g=>g.id===id&&g.bot):undefined
export function requireBot(id:unknown){const g=botGroup(id);if(!g)throw Error('Unknown external Worker');if(!isAppAdministrator()&&!g.memberIds.includes(callerEmployee()!.id))throw Error('External Worker access required; ask the user or Secretary to grant it');return g}
export function botDirectTarget(command:string,args:Record<string,any>){return command.startsWith('direct.')&&command!=='direct.post'?botGroup(args.employee):undefined}
function mutate(id:string,fn:(g:ChatGroup)=>void){const store=catalog(),g=store.groups.find(g=>g.id===id);if(!g?.bot)throw Error('External Worker no longer exists');fn(g);g.revision++;g.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(id);return g}
function saveMessages(id:string,rows:ChatMessage[],changed:ChatMessage,incoming=false){
 atomicJson(historyFile(id),rows,true)
 mutate(id,g=>{const latest=rows.at(-1)!;g.lastMessage={id:latest.id,sequence:latest.sequence,text:(latest.text||latest.attachments?.map(f=>f.name).join(', ')||'').slice(0,240),createdAt:latest.createdAt,author:latest.author,authorName:latest.authorName};if(incoming)g.lastIncomingSequence=Math.max(g.lastIncomingSequence,changed.sequence)})
 emitChatChange(id,undefined,incoming?changed.id:undefined)
}
function importBot(remote:RemoteBot){
 const current=catalog().groups.find(g=>g.bot?.provider===remote.provider&&g.bot.remoteId===remote.id)
 if(current)return mutate(current.id,g=>{g.name=g.bot!.displayName??remote.name;g.bot={...g.bot!,kind:remote.kind,participantIds:remote.participantIds,grokShape:remote.grokShape,grokColor:remote.grokColor}})
 const now=Date.now(),group:ChatGroup={id:'cg_'+randomUUID(),name:remote.name,ownerId:null,adminIds:[],memberIds:[],createdAt:now,updatedAt:now,revision:1,readSequence:0,lastIncomingSequence:0,bot:{provider:remote.provider,remoteId:remote.id,kind:remote.kind,role:'worker',participantIds:remote.participantIds,grokShape:remote.grokShape,grokColor:remote.grokColor}}
 const store=catalog();store.groups.push(group);atomicJson(indexFile,store,true);emitChatChange(group.id);return group
}
export function listBots(includeRemoved=false){if(includeRemoved)requireAppAdministrator();return [...catalog().groups.filter(g=>g.bot&&(isAppAdministrator()||g.memberIds.includes(callerEmployee()!.id))),...(includeRemoved?Object.values(removedBots()).map(r=>({...r.group,removed:true})):[])].map(g=>({...g,conversation:'group:'+g.id,directEmployeeId:g.bot!.kind==='private'?g.id:undefined,workerRole:'worker',automaticRoles:['secretary']}))}
export function botDirectRequest(command:string,args:Record<string,any>):any{
 const g=requireBot(args.employee)
 if(g.bot!.kind!=='private')throw Error('Use chat.* for native Grok groups')
 if(command==='direct.send')return sendBotMessage({...args,id:g.id})
 const all=messages(g.id),incoming=[...all].reverse().find(m=>m.author.kind==='agent'&&m.author.employeeId===g.id)
 if(command==='direct.send-status'){
  const principal=requestContext().principal,entry=all.find(m=>m.clientMessageId===args.clientMessageId&&JSON.stringify(m.author)===JSON.stringify(principal))
  if(!entry)throw Error('Unknown bot send receipt for this caller')
  return {status:entry.bot?.delivery,directMessageId:entry.id,clientMessageId:entry.clientMessageId,error:entry.bot?.error}
 }
 if(command==='direct.acknowledge'){
  requireAppAdministrator();const entry=all.find(m=>m.id===args.messageId);if(!entry)throw Error('Unknown private bot message')
  advanceGroupRead(g.id,entry.sequence);return {acknowledged:true,messageId:entry.id}
 }
 if(command==='direct.history'){
  const limit=args.limit??200;if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('limit must be 1..500')
  let page=all.filter(m=>args.before===undefined||m.sequence<args.before)
  if(args.around){const i=page.findIndex(m=>m.id===args.around);if(i<0)throw Error('Unknown bot message');page=page.slice(Math.max(0,i-Math.floor(limit/2)),i+Math.ceil(limit/2))}else page=page.slice(-limit)
  const items=page.map(m=>{const sent=m.author.kind==='operator'||m.bot?.delivery!==undefined,media={images:m.attachments?.filter(a=>a.kind==='image').map(a=>a.path),files:m.attachments?.filter(a=>a.kind==='file')};return {role:sent?'user':'assistant',id:m.id,directSequence:m.sequence,createdAt:m.createdAt,author:m.author,...media,...(sent?{text:m.text}:{blocks:m.text?[{kind:'text',text:m.text}]:[]})}})
  return {items,revision:g.revision,readSequence:g.readSequence,latestIncoming:incoming?{messageId:incoming.id,sequence:incoming.sequence}:undefined,nextBefore:page.length&&all[0]?.sequence<page[0].sequence?page[0].sequence:null}
 }
 throw Error('Unknown external private command')
}
async function receive(id:string,message:RemoteMessage,bootstrap=false){
 const group=botGroup(id);if(!group)return
 let all=messages(id),matched=all.find(m=>m.bot?.remoteId===message.id||message.role==='user'&&message.requestId&&m.bot?.requestId===message.requestId)
 if(matched?.bot?.revision===message.revision||matched?.bot?.version&&message.version&&matched.bot.version>message.version)return
 // The provider's user echo updates an existing send receipt; it never impersonates a bot reply.
 if(matched&&message.role==='user'){
  matched.bot={...matched.bot!,remoteId:message.id,revision:message.revision,delivery:'accepted'};saveMessages(id,all,matched);return
 }
 for(const f of message.files)if(f.bytes===0){try{const info=await remoteRead(group.bot!,f,0,1);f.bytes=info.totalSize;f.mimeType??=info.mimeType;if(f.name==='attachment'&&info.name)f.name=info.name}catch{}}
 const files=message.files.map(f=>({...f,mimeType:f.mimeType??(/\.(png|jpe?g|gif|webp)$/i.test(f.name)?'image/'+(f.name.split('.').at(-1)==='jpg'?'jpeg':f.name.split('.').at(-1)):fileMime(f.name))}))
 const attachments:MessageAttachment[]=files.map(f=>({path:'@bot/'+message.id+'/'+hash(f.id).slice(0,24),name:f.name,bytes:f.bytes,mimeType:f.mimeType,kind:f.mimeType.startsWith('image/')?'image':'file'}))
 all=messages(id);matched=all.find(m=>m.bot?.remoteId===message.id)
 if(matched?.bot?.revision===message.revision||matched?.bot?.version&&message.version&&matched.bot.version>message.version)return
 const entry:ChatMessage=matched??{id:'gm_'+randomUUID(),sequence:(all.at(-1)?.sequence??0)+1,createdAt:message.createdAt,author:message.role==='user'?{kind:'operator'}:{kind:'agent',employeeId:id},authorName:message.role==='user'?'You':message.authorName??group.name,text:message.text,kind:'message',mentions:[],deliveries:[],clientMessageId:'remote:'+message.id,fingerprint:message.revision}
 entry.text=message.text;entry.attachments=attachments;entry.bot={remoteId:message.id,revision:message.revision,version:message.version,files,requestId:message.requestId,...(message.role==='user'?{delivery:'accepted' as const}:{})}
 if(matched){entry.editRevision=(entry.editRevision??0)+1;entry.editedAt=Date.now()}else all.push(entry)
 saveMessages(id,all,entry,message.role==='assistant'&&!bootstrap)
 if(bootstrap)mutate(id,g=>{g.readSequence=Math.max(g.readSequence,entry.sequence);if(message.role==='assistant')g.lastIncomingSequence=Math.max(g.lastIncomingSequence,entry.sequence)})
 mutate(id,g=>{if(!g.bot!.cursor||g.bot!.provider==='dots'||Number(message.cursor)>Number(g.bot!.cursor))g.bot!.cursor=message.cursor})
}
async function syncMessages(id:string){
 if(syncing.has(id)||!botGroup(id))return
 syncing.add(id)
 try{
  const g=botGroup(id)!,known=new Set(messages(id).filter(m=>m.bot).map(m=>m.bot!.remoteId)),bootstrap=!g.bot!.initialized
  for(const m of await remoteMessages(g.bot!,known))await receive(id,m,bootstrap)
  mutate(id,g=>{g.bot!.initialized=true;g.bot!.connection='connected';delete g.bot!.error})
 }catch(error){if(botGroup(id))mutate(id,g=>{g.bot!.connection='error';g.bot!.error=(error as Error).message});throw error}
 finally{syncing.delete(id)}
}
async function connect(id:string){
 if(stopped||watches.has(id)||!botGroup(id))return
 // Reserve before opening a network stream so refreshes cannot duplicate watchers.
 watches.set(id,()=>{})
 try{
  const close=await watchRemote(botGroup(id)!.bot!,m=>{if(!stopped)void withCaller(operatorContext(),()=>receive(id,m)).catch(e=>console.error('[Bot receive]',e.message))},()=>{const close=watches.get(id);watches.delete(id);close?.();if(!stopped)void withCaller(operatorContext(),()=>syncMessages(id)).catch(()=>{})})
  if(stopped||!botGroup(id)){close();watches.delete(id)}else watches.set(id,close)
 }catch{watches.delete(id)}
}
export function startBotWorkers(){
 stopped=false
 for(const g of catalog().groups.filter(g=>g.bot)){const all=messages(g.id);let changed=false;for(const m of all)if(m.bot?.delivery==='sending'){m.bot.delivery='uncertain';m.bot.error='Core stopped before delivery confirmation; inspect native history before sending again';changed=true}if(changed)saveMessages(g.id,all,all.at(-1)!)}
 const tick=()=>{const groups=catalog().groups.filter(g=>g.bot);for(const [id,close]of watches)if(!groups.some(g=>g.id===id)){watches.delete(id);close()}for(const g of groups)void withCaller(operatorContext(),async()=>{await syncMessages(g.id);await connect(g.id)}).catch(()=>{})}
 tick();timer=setInterval(tick,15000);timer.unref()
}
export function stopBotWorkers(){stopped=true;clearInterval(timer);timer=undefined;for(const close of watches.values())close();watches.clear()}
export async function botRequest(command:string,args:Record<string,any>){
 if(command==='bot.list')return listBots(args.includeRemoved===true)
 requireAppAdministrator()
 if(command==='bot.update'){
  const g=requireBot(args.id)
  if(args.expectedRevision!==(g.bot!.profileRevision??1))throw Error('Bot profile changed; reload before saving')
  if(typeof args.name!=='string'||!args.name.trim()||args.name.trim().length>80)throw Error('Choose a bot name up to 80 characters')
  return mutate(g.id,g=>{g.name=args.name.trim();g.bot!.displayName=g.name;g.bot!.profileRevision=(g.bot!.profileRevision??1)+1})
 }
 if(command==='bot.delete'){
  const removed=removedBots();if(removed[args.id])return {removed:true,id:args.id}
  const g=requireBot(args.id),store=catalog();removed[g.id]={group:g,removedAt:Date.now()};atomicJson(removedFile,removed,true)
  watches.get(g.id)?.();watches.delete(g.id);store.groups=store.groups.filter(item=>item.id!==g.id);atomicJson(indexFile,store,true);removeIndexedConversation('group:'+g.id);emitChatChange(g.id);controlChanged('group:'+g.id)
  return {removed:true,id:g.id}
 }
 if(command==='bot.restore'){
  if(botGroup(args.id))return botGroup(args.id)
  const removed=removedBots(),record=removed[args.id];if(!record?.group.bot)throw Error('Unknown removed bot')
  const remote=(await remoteBots(record.group.bot.provider)).find(b=>b.id===record.group.bot!.remoteId);if(!remote)throw Error('The native bot no longer exists')
  const group={...record.group,memberIds:[],ownerId:null,adminIds:[],mutes:{},bot:{...record.group.bot,accessRevision:(record.group.bot.accessRevision??1)+1}}
  const store=catalog();store.groups.push(group);atomicJson(indexFile,store,true);delete removed[args.id];atomicJson(removedFile,removed,true)
  importBot(remote);await syncMessages(group.id);await connect(group.id);emitChatChange(group.id);controlChanged('group:'+group.id);return botGroup(group.id)
 }
 if(command==='bot.sync'){
  const providers=await Promise.all((['dots','grok'] as BotProvider[]).map(async provider=>{
   try{const remote=await remoteBots(provider),removed=Object.values(removedBots()),bots=remote.filter(b=>!removed.some(r=>r.group.bot?.provider===b.provider&&r.group.bot.remoteId===b.id)),groups=bots.map(importBot);await Promise.allSettled(groups.map(async g=>{await syncMessages(g.id);await connect(g.id)}));return {provider,connected:true,count:bots.length}}
   catch(error){return {provider,connected:false,error:(error as Error).message}}
  }))
  return {providers,conversations:listBots()}
 }
 if(command==='bot.access'){
  let g=requireBot(args.id)
  if(args.employeeIds!==undefined){
   if(args.expectedRevision!==(g.bot!.accessRevision??1))throw Error('Bot access changed; reload before saving')
   if(!Array.isArray(args.employeeIds)||args.employeeIds.length>200||args.employeeIds.some((id:unknown)=>!readStore().sessions.some(c=>c.id===id&&!c.deleting)))throw Error('Choose existing employees')
   g=mutate(g.id,g=>{g.memberIds=[...new Set<string>(args.employeeIds)].filter(id=>readStore().sessions.find(c=>c.id===id)?.managementRole!=='secretary');g.bot!.accessRevision=(g.bot!.accessRevision??1)+1;g.adminIds=[];g.ownerId=null});controlChanged('group:'+g.id)
  }
  return {id:g.id,employeeIds:g.memberIds,revision:g.bot!.accessRevision??1,automaticRoles:['secretary'],employees:readStore().sessions.filter(c=>!c.deleting).map(c=>({id:c.id,title:c.title,role:c.managementRole??'employee',team:c.group}))}
 }
 if(command==='bot.appearance'){
  let g=requireBot(args.id)
  if(args.avatar!==undefined){
   if(g.bot!.provider!=='dots')throw Error('Grok uses its native appearance')
   if(args.expectedRevision!==(g.bot!.appearanceRevision??1))throw Error('Bot appearance changed; reload before saving')
   const avatar=resolveAvatar({avatar:args.avatar},activeAvatarIds())!
   g=mutate(g.id,g=>{g.bot!.avatar=avatar;g.bot!.appearanceRevision=(g.bot!.appearanceRevision??1)+1})
  }
  return {id:g.id,avatar:g.bot!.provider==='dots'?g.bot!.avatar??DEFAULT_DOT_AVATAR:undefined,revision:g.bot!.appearanceRevision??1,editable:g.bot!.provider==='dots'}
 }
 if(command==='bot.create'||command==='bot.group-create'){
  if(typeof args.name!=='string'||!args.name.trim()||args.name.length>80||typeof args.clientRequestId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.clientRequestId))throw Error('Provide a name and stable UUID clientRequestId')
  const members=command==='bot.group-create'?args.members?.map((id:string)=>{const g=requireBot(id);if(g.bot!.provider!=='grok'||g.bot!.kind!=='private')throw Error('Choose native Grok bots');return g.bot!.remoteId}):undefined
  if(command==='bot.group-create'&&(!Array.isArray(members)||!members.length||members.length>50))throw Error('Choose 1–50 Grok bots')
  const file=path.join(APP_HOME,'bot-requests.json'),requests=readJson<Record<string,{fingerprint:string;id?:string}>>(file,()=>({})),key=args.clientRequestId,fingerprint=hash([command,args.name,args.description??'',members??null]),previous=requests[key]
  if(previous&&previous.fingerprint!==fingerprint)throw Error('Creation request ID already used with different arguments')
  if(previous?.id&&botGroup(previous.id))return botGroup(previous.id)
  if(previous?.id&&removedBots()[previous.id])throw Error('This bot was removed; use bot.restore to reconnect it')
  requests[key]={fingerprint};atomicJson(file,requests,true)
  return flights.run('create:'+key,async()=>{
   const existing=(await remoteBots('grok')).find(b=>b.id===key)
   if(existing&&(existing.name!==args.name.trim()||existing.kind!==(members?'group':'private')))throw Error('This remote creation identity belongs to another native conversation')
   const remote=existing??await remoteCreate(args.name.trim(),args.description??'',key,members),g=importBot(remote)
   const latest=readJson<typeof requests>(file,()=>({}));latest[key]={fingerprint,id:g.id};atomicJson(file,latest,true)
   await syncMessages(g.id);await connect(g.id);return botGroup(g.id)
  })
 }
 throw Error('Unknown bot command')
}
function sourceFor(group:ChatGroup,value:string):FileEndpoint{
 if(value.startsWith('@workspace/'))return conversationFileEndpoint('group:'+group.id,value)
 if(!isAppAdministrator())throw Error('Upload own files with conversation.upload, then send their @workspace path')
 const root=path.join(APP_HOME,'chats','media',group.id)
 return {root,path:value}
}
async function endpointRead(source:FileEndpoint,operation:string,args:Record<string,unknown>){await source.validate?.(operation,args);return source.read?source.read(operation,args):source.remote?remoteFiles('bot-upload',source.remote,operation,args):workspaceFiles(source.root,operation,args)}
export async function sendBotMessage(args:Record<string,any>):Promise<any>{
 const id=String(args.id??args.employee),g=requireBot(id),principal=requestContext().principal,text=args.text??'',images=attachmentPaths(args.images),files=attachmentPaths(args.files),key=args.clientMessageId??requestContext().requestId
 if(typeof text!=='string'||text.length>64000||!text.trim()&&!images.length&&!files.length||images.length+files.length>16)throw Error('Provide text, images or files (at most 16)')
 if(typeof key!=='string'||!key.trim()||key.length>160)throw Error('Provide a stable clientMessageId')
 if(args.mode&&args.mode!=='enqueue'&&args.mode!=='send')throw Error('Native bot delivery supports send or enqueue, not steer')
 const quote=args.replyQuote===undefined?undefined:quoteShape(args.replyQuote),original=args.replyTo&&!args.crossReply?messages(id).find(m=>m.id===args.replyTo):undefined
 if(args.replyTo&&!args.crossReply&&!original)throw Error('Unknown bot reply target')
 if(quote&&!args.crossReply){if(!original)throw Error('A selected quote requires a reply target');validateQuote(original.text,quote)}
 const quoted=args.crossReply?.text??quote?.text,remoteText=quoted?quoted.split('\n').map((s:string)=>'> '+s).join('\n')+'\n\n'+text:text
 const fingerprint=hash([text,images,files,args.replyTo??null,quote??null,args.crossReply??null]),same=(m:ChatMessage)=>m.clientMessageId===key&&JSON.stringify(m.author)===JSON.stringify(principal),previous=messages(id).find(same)
 if(previous){if(previous.fingerprint!==fingerprint)throw Error('Client message ID already used with different content');return {message:previous,sent:previous.bot?.delivery==='accepted',status:previous.bot?.delivery,directMessageId:previous.id,clientMessageId:key}}
 const flightKey='send:'+id+':'+hash([principal,key])
 if(flights.has(flightKey)){await flights.get(flightKey);return sendBotMessage(args)}
 return flights.run(flightKey,async()=>{
  requireBot(id)
  const requestId=randomUUID(),attachmentSources=[...images.map(p=>({p,kind:'image' as const})),...files.map(p=>({p,kind:'file' as const}))],prepared:Array<{descriptor:MessageAttachment;source:FileEndpoint;stat:any}>=[]
  for(const {p,kind} of attachmentSources){const source=sourceFor(g,p),info=await endpointRead(source,'copy-info',{path:source.path});prepared.push({source,stat:info,descriptor:attachmentInfo(p,info,kind,kind==='image'?(/\.png$/i.test(p)?'image/png':'image/jpeg'):undefined)})}
  const all=messages(id)
  const entry:ChatMessage={id:'gm_'+randomUUID(),sequence:(all.at(-1)?.sequence??0)+1,createdAt:Date.now(),author:principal,authorName:callerEmployee()?.title??'You',text,kind:'message',mentions:[],deliveries:[],clientMessageId:key,fingerprint,attachments:prepared.map(p=>p.descriptor),replyTo:args.crossReply?undefined:args.replyTo,...(quote?{replyQuote:quote}:{}),...(args.crossReply?{reply:args.crossReply}:{}),bot:{remoteId:requestId,revision:fingerprint,requestId,delivery:'sending'}}
  all.push(entry);saveMessages(id,all,entry)
  try{
   const uploads:Array<{path:string;name:string}>=[]
   for(const {descriptor,source,stat}of prepared){requireBot(id);const remotePath=await remoteUpload(g.bot!,{...descriptor,read:async(offset,length)=>{requireBot(id);const result=await endpointRead(source,'copy-read',{path:source.path,offset,length});return Buffer.from(result.data,'base64')}});const after=await endpointRead(source,'copy-info',{path:source.path});if(after.bytes!==stat.bytes||after.modifiedAt!==stat.modifiedAt)throw Error('Attachment changed while uploading; the bot message was not sent');uploads.push({path:remotePath,name:descriptor.name})}
   requireBot(id)
   const receipt=await remoteSend(g.bot!,remoteText,requestId,uploads,original?.bot?.remoteId)
   // Re-read: an instant remote reply may have appended while the request was in flight.
   const current=messages(id),saved=current.find(m=>m.id===entry.id)!
   saved.bot={...saved.bot!,remoteId:receipt.id,delivery:'accepted'};saveMessages(id,current,saved)
   void syncMessages(id).catch(()=>{});await connect(id)
   return {message:saved,sent:true,status:'accepted',directMessageId:saved.id,clientMessageId:key}
  }catch(error){
   const current=messages(id),saved=current.find(m=>m.id===entry.id)!
   // An uncertain network outcome is never retried automatically with a new remote identity.
   saved.bot={...saved.bot!,delivery:'uncertain',error:(error as Error).message};saveMessages(id,current,saved);throw error
  }
 })
}
export function botFileEndpoint(id:string,value:string):FileEndpoint{
 const g=requireBot(id),entry=messages(id).find(m=>m.attachments?.some(a=>a.path===value)),index=entry?.attachments?.findIndex(a=>a.path===value)??-1,file=entry?.bot?.files?.[index]
 if(!file)throw Error('Unknown published bot attachment')
 const context=requestContext()
 let metadata:ReturnType<typeof remoteRead>|undefined
 const info=()=>metadata??=remoteRead(g.bot!,file,0,1).then(value=>{if(!Number.isSafeInteger(value.totalSize)||value.totalSize<0)throw Error('Invalid bot attachment size');return value})
 return {root:'bot:'+id,path:value,name:file.name,read:(operation,args)=>withCaller(context,async()=>{
  requireBot(id);const metadata=await info()
  if(operation==='copy-info')return {exists:true,regular:true,directory:false,symlink:false,bytes:metadata.totalSize,modifiedAt:entry!.createdAt,mode:0o444}
  const data=await remoteRead(g.bot!,file,Number(args.offset??0),Number(args.length??262144));if(data.totalSize!==metadata.totalSize)throw Error('Bot attachment changed while reading')
  return {data:data.data.toString('base64'),bytes:data.data.length,mimeType:data.mimeType??file.mimeType,totalBytes:data.totalSize}
 })}
}
export async function readBotFile(args:Record<string,any>){
 const endpoint=await botFileEndpoint(args.id,args.path),operation=args.operation??'info'
 if(operation==='info')return endpoint.read!('copy-info',{})
 if(operation==='chunk')return endpoint.read!('copy-read',{offset:args.offset??0,length:262144})
 if(!['image','read'].includes(operation))throw Error('Unsupported bot attachment read')
 const info=await endpoint.read!('copy-info',{});if(info.bytes>10*1024*1024)throw Error('Download this attachment with conversation.download')
 const chunks:Buffer[]=[];for(let offset=0;offset<info.bytes;){const c=await endpoint.read!('copy-read',{offset,length:Math.min(262144,info.bytes-offset)});if(!c.bytes)throw Error('Attachment read was interrupted');chunks.push(Buffer.from(c.data,'base64'));offset+=c.bytes}
 const bytes=Buffer.concat(chunks),file=messages(args.id).flatMap(m=>m.attachments??[]).find(f=>f.path===args.path)!
 return operation==='image'?{data:bytes.toString('base64'),mimeType:file.mimeType,bytes:bytes.length}:{content:bytes.toString('utf8'),bytes:bytes.length}
}
