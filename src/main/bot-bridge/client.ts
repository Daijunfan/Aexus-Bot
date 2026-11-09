import path from 'node:path'
import os from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {APP_HOME} from '../../shared/protocol'
import type {BotBinding,BotFile,BotProvider,BotIssue} from '../../shared/bot-workers'
import {getChatGptAuth,getGrokAuth} from './credentials'
import * as dots from './dots'
import * as grok from './grok'
import {httpJson,httpStream} from './http'

export type RemoteBot={id:string;name:string;provider:BotProvider;kind:'private'|'group';participantIds?:string[];grokShape?:string;grokColor?:string}
export type RemoteMessage={version?:number;id:string;revision:string;cursor:string;role:'user'|'assistant';text:string;createdAt:number;authorName?:string;requestId?:string;turnId?:string;files:BotFile[]}
export type UploadSource={name:string;bytes:number;mimeType?:string;read:(offset:number,length:number)=>Promise<Buffer>}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex')
function fixtureUrl(){
 const raw=process.env.AGENTS_COMPANY_TEST_BOTS_URL
 if(!raw)return
 const url=new URL(raw)
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!process.env.AGENTS_COMPANY_HOME||APP_HOME===path.join(os.homedir(),'AgentsCompany'))throw Error('Bot fixtures require an isolated home and loopback server')
 return url.href
}
async function fixture(method:string,args:unknown){const r=await httpJson(fixtureUrl()!,{method:'POST',body:{method,args}});if(r.status!==200)throw Error(r.data?.error??'Bot fixture failed');return r.data}
export async function remoteBots(provider:BotProvider):Promise<RemoteBot[]>{
 if(fixtureUrl())return fixture('list',{provider})
 if(provider==='dots')return [{id:await dots.getPrimaryRoom(),name:'Dot',provider,kind:'private'}]
 grok.invalidateUsage()
 const result=await grok.rpc('ListGrokBotAgents',{})
 return (result.agents??[]).map((a:any)=>({id:a.agentId||a.legacyAgentId,name:a.name||'Grok Bot',provider,kind:a.kind==='GROK_BOT_AGENT_KIND_ROOM'?'group':'private',participantIds:a.memberAgentIds??[],grokShape:a.avatarShape??'blob',grokColor:a.avatarColor??'black'}))
}
export async function remoteCreate(name:string,description:string,id:string,members?:string[]):Promise<RemoteBot>{
 if(fixtureUrl())return fixture('create',{name,description,id,members})
 const result=members
  ?await grok.rpc('CreateGrokBotRoom',{agentId:id,name,description,memberAgentIds:members,humanMemberUserIds:[]})
  :await grok.rpc('CreateGrokBotTemporalAgent',{agentId:id,name,description,harness:'GROK_BOT_AGENT_HARNESS_KIND_TEMPORAL',introductionSuppressed:true,kickstartRequested:false})
 const a=result.agent
 if(a?.agentId!==id)throw Error('Grok did not confirm the requested creation identity; inspect bot.sync before retrying')
 return {id,name:a.name||name,provider:'grok',kind:members?'group':'private',participantIds:a.memberAgentIds??members}
}
export function dotMessage(m:any):RemoteMessage|null{
 if(!m?.id||m.deleted_at)return null
 const assistant=dots.isDot(m),text=dots.textOf(m),files:BotFile[]=(m.content?.attachments??[]).filter((a:any)=>a.type==='file'&&a.file_id).map((a:any)=>({id:a.file_id,remotePath:a.file_id,name:a.name??a.file?.name??'attachment',mimeType:a.mime_type??a.file?.mime_type,bytes:Number(a.size_bytes??a.file?.size_bytes??0)}))
 if(!assistant&&!String(m.account_user_id??'').startsWith('user-'))return null
 return {id:m.id,revision:digest(JSON.stringify([text,files,m.updated_at])),cursor:m.id,version:Date.parse(m.updated_at??m.created_at)||0,role:assistant?'assistant':'user',text,files,createdAt:Date.parse(m.created_at)||Date.now(),requestId:m.request_id}
}
export function grokMessage(raw:any):RemoteMessage|null{
 let b=raw.body
 if(typeof b==='string'){try{b=JSON.parse(Buffer.from(b,'base64').toString('utf8'))}catch{return null}}
 if(!b)return null
 const user=raw.entryKind==='message'&&b.role==='user',reply=raw.entryKind==='send-message'
 // Tool traces and peer internal messages never become public bot speech.
 if(!user&&!reply)return null
 const m=reply?b.message:b,text=user?String(b.content??''):m.type==='attachment'?'':grok.replyText(b),paths=m.attachmentPaths??m.attachment_paths??b.attachmentPaths??[],names=m.attachmentNames??m.attachment_names??[]
 const files:BotFile[]=paths.map((p:string,i:number)=>({id:digest(p),remotePath:p,name:names[i]??path.posix.basename(p),bytes:0}))
 if(reply&&m.type==='attachment'&&typeof m.url==='string'){const url=new URL(m.url);if(url.protocol==='file:'){const remotePath=decodeURIComponent(url.pathname);files.push({id:digest(remotePath),remotePath,name:m.file_name??path.posix.basename(remotePath),bytes:Number(m.size_bytes??0)})}}
 if(!text&&!files.length)return null
 return {id:raw.entryId??String(raw.seq),cursor:String(raw.updatedSeq??raw.seq??0),revision:digest(JSON.stringify([text,files])),version:Number(raw.updatedSeq??raw.seq??0),role:user?'user':'assistant',text,files,createdAt:Number(b.timestampMs)||Date.now(),authorName:b.author?.name??b.fromAgent?.name??m.authorName,requestId:b.clientNonce??b.requestId,turnId:b.requestId}
}
export async function remoteStatus(binding:BotBinding):Promise<{issue:BotIssue|null;checkedAt:number}|undefined>{
 if(binding.provider!=='grok')return
 if(fixtureUrl())return fixture('status',{binding})
 return grok.usageStatus().catch(()=>undefined)
}
export async function prepareRemote(binding:BotBinding){if(!fixtureUrl()&&binding.provider==='grok')await grok.ensureRunning()}
/** Catch-up uses provider pagination; no fixed recent-N window drops an offline reply. */
export async function remoteMessages(binding:BotBinding,known:Set<string>):Promise<RemoteMessage[]>{
 if(fixtureUrl())return fixture('messages',{binding})
 const messages:RemoteMessage[]=[]
 if(binding.provider==='dots'){
  let before:string|undefined
  do{
   const query=new URLSearchParams({limit:'32',...(before?{before}:{} )}),r=await dots.api(`/messaging/rooms/${encodeURIComponent(binding.remoteId)}/messages?${query}`)
   if(r.status!==200)throw Error('Dot history: HTTP '+r.status)
   const raw=r.data?.items??[],page=raw.map(dotMessage).filter(Boolean) as RemoteMessage[]
   messages.push(...page)
   if(!raw.length||page.some(m=>known.has(m.id))||!binding.cursor)break
   const next=r.data.prev_cursor??raw[0]?.id
   if(!next||next===before)break
   before=next
  }while(true)
 }else{
  let beforeSeq:string|undefined
  do{
   const r=await grok.rpc('ListGrokBotTranscriptEntries',{agentId:binding.remoteId,generation:0,limit:50,sessionId:'',...(beforeSeq?{beforeSeq}:{})}),rows=r.entries??[]
   messages.push(...rows.map(grokMessage).filter(Boolean) as RemoteMessage[])
   if(!rows.length||!binding.cursor||rows.some((e:any)=>Number(e.updatedSeq??e.seq)<=Number(binding.cursor)))break
   const next=String(Math.min(...rows.map((e:any)=>Number(e.seq))))
   if(next===beforeSeq)break
   beforeSeq=next
  }while(true)
 }
 return [...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))
}
export async function remoteSend(binding:BotBinding,text:string,requestId:string,files:Array<{path:string;name:string}>,replyTo?:string){
 if(fixtureUrl())return fixture('send',{binding,text,requestId,files,replyTo})
 if(binding.provider==='dots'){
  const r=await dots.api(`/messaging/rooms/${encodeURIComponent(binding.remoteId)}/messages`,{method:'POST',body:{content:{text,attachments:files.map(f=>({type:'file',file_id:f.path}))},request_id:requestId,idempotency_token:requestId,...(replyTo?{reply_to:{message_id:replyTo}}:{})}})
  if(r.status<200||r.status>=300)throw Error('Dot delivery failed: HTTP '+r.status)
  return {id:r.data.id,accepted:true}
 }
 const r=await grok.rpc('SendGrokBotUserMessage',{agentId:binding.remoteId,messageId:requestId,text,sentAtMs:String(Date.now()),sessionId:'',source:'GROK_BOT_CLIENT_SURFACE_DESKTOP',initiator:'GROK_BOT_USER_MESSAGE_INITIATOR_USER',sendSource:'GROK_BOT_SEND_SOURCE_CHAT',attachmentPaths:files.map(f=>f.path),attachmentNames:files.map(f=>f.name),...(replyTo?{replyToId:replyTo}:{})})
 if(r.refusal||String(r.delivery).endsWith('REFUSED')||r.dispatched===false&&!String(r.delivery).endsWith('DUPLICATE'))throw Error(r.refusal?.message??'Grok rejected this message')
 return {id:requestId,accepted:true}
}
async function* chunks(source:UploadSource,start=0,length=source.bytes){for(let offset=start;offset<start+length;){const chunk=await source.read(offset,Math.min(4*1024*1024,start+length-offset));if(!chunk.length)throw Error('Source ended during bot upload');offset+=chunk.length;yield chunk}}
export async function remoteUpload(binding:BotBinding,source:UploadSource):Promise<string>{
 if(fixtureUrl()){const hash=createHash('sha256');for await(const c of chunks(source))hash.update(c);return (await fixture('upload',{binding,name:source.name,bytes:source.bytes,sha256:hash.digest('hex')})).path}
 if(binding.provider==='dots'){
  if(source.bytes>20*1024*1024)throw Error('Dot native attachment limit is 20 MiB per file')
  const boundary='aexus'+randomUUID(),head=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${source.name.replace(/["\r\n]/g,'_')}"\r\nContent-Type: ${source.mimeType??'application/octet-stream'}\r\n\r\n`),tail=Buffer.from(`\r\n--${boundary}--\r\n`),auth=getChatGptAuth()
  async function* body(){yield head;yield* chunks(source);yield tail}
  const r=await httpJson('https://chatgpt.com/backend-api/messaging/rooms/'+encodeURIComponent(binding.remoteId)+'/files',{method:'POST',body:body(),headers:{...dots.headers(auth),'content-type':'multipart/form-data; boundary='+boundary,'content-length':head.length+source.bytes+tail.length},timeoutMs:180000})
  if(r.status!==200&&r.status!==201||!r.data?.id)throw Error('Dot upload failed: HTTP '+r.status)
  return r.data.id
 }
 const digest=createHash('sha256');for await(const c of chunks(source))digest.update(c);const sha256Hex=digest.digest('hex')
 const r=await grok.rpc('BeginGrokBotAttachmentUpload',{agentId:binding.remoteId,fileName:source.name,sizeBytes:String(source.bytes),sha256Hex,supportsStoreAttachmentRefs:true,supportsMultipart:true})
 if(String(r.mode).endsWith('USE_BOX')||r.mode===1){
  // The native desktop uses the agent file store for regular documents.
  const begin=await grok.rpc('BeginGrokBotAgentFileUpload',{agentId:binding.remoteId,fileName:randomUUID().slice(0,8)+'-'+source.name.slice(-100),sizeBytes:String(source.bytes),sha256Hex,contentType:source.mimeType??'application/octet-stream'})
  if(!begin.url||!begin.uploadToken)throw Error('Grok native file upload is unavailable')
  const put=await httpJson(begin.url,{method:'PUT',body:chunks(source),headers:{...begin.headers,'content-length':source.bytes},expectJson:false,timeoutMs:180000})
  if(put.status<200||put.status>=300)throw Error('Grok native file PUT failed: HTTP '+put.status)
  const finished=await grok.rpc('FinishGrokBotAgentFileUpload',{agentId:binding.remoteId,uploadToken:begin.uploadToken})
  if(!finished.file?.path)throw Error('Grok did not commit this file')
  return finished.file.path
 }
 const token=r.uploadToken
 if(!token)throw Error('Grok attachment upload unavailable: '+(r.refusal??r.useBoxReason??r.mode))
 const put=async(target:any,body:AsyncIterable<Buffer>|Buffer,length:number)=>{if(!target?.url)throw Error('Missing Grok upload target');const result=await httpJson(target.url,{method:'PUT',body,headers:{...target.headers,'content-length':length},expectJson:false,timeoutMs:180000});if(result.status<200||result.status>=300)throw Error('Grok attachment PUT failed: HTTP '+result.status)}
 try{
  if(String(r.mode).endsWith('SINGLE_PUT')||r.mode===2)await put(r.put,chunks(source),source.bytes)
  else if(String(r.mode).endsWith('MULTIPART')||r.mode===3){
   const size=Number(r.partSizeBytes)
   if(!Number.isSafeInteger(size)||size<1||size>32*1024*1024)throw Error('Unsupported Grok attachment part size')
   for(let offset=0,partNumber=1;offset<source.bytes;partNumber++){
    const length=Math.min(size,source.bytes-offset),parts:Buffer[]=[],collect=async()=>{for await(const c of chunks(source,offset,length))parts.push(c);return Buffer.concat(parts)},data=await collect(),checksumSha256=createHash('sha256').update(data).digest('base64'),signed=await grok.rpc('PresignGrokBotAttachmentUploadParts',{uploadToken:token,parts:[{partNumber,checksumSha256}]})
    await put(signed.parts?.[0]?.target,data,length);offset+=length
   }
  }else throw Error('Grok requires an unsupported upload route: '+r.mode)
  const done=await grok.rpc('CompleteGrokBotAttachmentUpload',{uploadToken:token})
  if(!done.alias)throw Error('Grok upload was not committed: '+(done.refusal??'missing alias'))
  return done.alias
 }catch(error){try{await grok.rpc('AbortGrokBotAttachmentUpload',{uploadToken:token})}catch{}throw error}
}
export async function remoteRead(binding:BotBinding,file:BotFile,offset:number,length:number):Promise<{data:Buffer;totalSize:number;mimeType?:string;name?:string}>{
 if(fixtureUrl()){const r=await fixture('read',{binding,file,offset,length});return {...r,data:Buffer.from(r.data,'base64')}}
 if(binding.provider==='grok'){
  const r=await grok.rpc('ReadGrokBotAgentAttachmentChunk',{path:file.remotePath,offset:String(offset),length})
  return {data:Buffer.from(r.data??'','base64'),totalSize:Number(r.totalSize??0),mimeType:file.mimeType}
 }
 const r=await dots.api(`/messaging/rooms/${encodeURIComponent(binding.remoteId)}/files/${encodeURIComponent(file.remotePath)}`)
 if(r.status!==200||!r.data?.download_url)throw Error('Dot attachment is unavailable')
 const url=r.data.download_url,headers=new URL(url).hostname==='chatgpt.com'?dots.headers(getChatGptAuth()):{},response=await httpStream(url,{method:'GET',headers:{...headers,range:`bytes=${offset}-${offset+length-1}`}})
 if(![200,206].includes(response.status)){response.req.destroy();throw Error('Dot attachment HTTP '+response.status)}
 const total=Number(r.data.size_bytes??file.bytes??0),parts:Buffer[]=[];let position=response.status===206?offset:0,bytes=0
 try{for await(const raw of response.res){const c=Buffer.from(raw),start=Math.max(0,offset-position),end=Math.min(c.length,offset+length-position);if(end>start){const part=c.subarray(start,end);parts.push(part);bytes+=part.length}position+=c.length;if(bytes>=length)break}}finally{response.req.destroy()}
 return {data:Buffer.concat(parts),totalSize:total,mimeType:r.data.mime_type??file.mimeType,name:r.data.name}
}
/** The caller owns reconnect and durable cursors. Closing is independent of UI navigation. */
export async function watchRemote(binding:BotBinding,onMessage:(m:RemoteMessage)=>void,onLost:()=>void,onFailure?:(issue:BotIssue)=>void):Promise<()=>void>{
 if(fixtureUrl())return ()=>{}
 if(binding.provider==='grok'){
  const w=await grok.openWatch({agentId:binding.remoteId,afterUpdatedSeq:Number(binding.cursor??0),auth:getGrokAuth()})
  w.on('rows',(rows:any)=>{for(const e of rows.entries??[]){const m=grokMessage(e);if(m)onMessage(m)}})
  w.on('turnFailed',(value:any)=>{grok.invalidateUsage();onFailure?.(grok.turnFailure(value))})
  let lost=false;const reportLost=()=>{if(!lost){lost=true;onLost()}}
  for(const e of ['tooOld','end','endStream','streamError'])w.once(e,reportLost)
  return ()=>w.close()
 }
 const live=await dots.openLiveStream({auth:getChatGptAuth(),room:binding.remoteId})
 live.onFrame((frame:any)=>{if(!['calpico-message-add','calpico-message-update'].includes(frame.payload?.type))return;const p=frame.payload.payload;if(p?.room_id!==binding.remoteId)return;const m=dotMessage(p.message);if(m)onMessage(m);else onLost()})
 live.ws.once('close',onLost)
 return ()=>live.close()
}
