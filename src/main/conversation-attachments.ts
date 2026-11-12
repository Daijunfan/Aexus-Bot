import {botGroup,botFileEndpoint} from './bot-workers'
import {isAppAdministrator} from './application-authority'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {requireConversation} from './conversation-policy'
import {channelReaderIds} from './channel-access'
import {readChatMessages,groupMediaRoot} from './chat-groups'
import {getChannelMessage} from './channel-discussion'
import {channelFileEndpoint,getChannel} from './channels'
import {one,run,liveChannelPost,projectChannelPost,projectChannelDocuments} from './channel-store'
import {cloudDocumentSource,prepareChannelDocument} from './channel-files'
import {conversationFileEndpoint,sharedFileIO} from './conversation-workspaces'
import {workspaceCatalog} from './workspace-catalog'
import {authorize,requestContext,withCaller} from './authorization'
import {workspaceFiles} from './files'
import {startTransfer,getTransfer,cancelTransfer,type FileEndpoint} from './transfers'
import type {FileLocation,TransferJob} from '../shared/transfers'
import type {PrincipalRef} from '../shared/management'
import {directPublishedEntry,directFileEndpoint,directHistory} from './direct-messages'
import {fileVersion} from './read-cache'
import {saveDownload} from './uploads'

type Attachment={deferred?:boolean;id:string;name:string;kind:'image'|'document';bytes:number;mimeType?:string;sha256?:string;version?:string;path?:string;mediaId?:string;fileId?:string;read?:{command:string;args:Record<string,unknown>}}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
const actor=(principal:PrincipalRef)=>principal.kind==='operator'?'operator':principal.employeeId
const relative=(value:unknown='.')=>{if(typeof value!=='string'||!value||value.includes('\0')||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(p=>p==='..'||p==='.agents-company'||p.startsWith('.agents-transfer-')))throw Error('Use a relative path inside your own workspace');return path.posix.normalize(value)}
const filename=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>240||/[\\/\x00-\x1f]/.test(value)||['.','..','.agents-company'].includes(value)||value.startsWith('.agents-transfer-'))throw Error('Choose a regular attachment filename');return value}
function publishedScope(conversation:string){
 if(typeof conversation==='string'&&/^employee:[a-zA-Z0-9_-]+$/.test(conversation)){const id=conversation.slice(9);directHistory({employee:id,limit:1});return {conversation,kind:'employee' as const,id,members:[id]}}
 if(typeof conversation==='string'&&/^channel:[a-zA-Z0-9_-]+$/.test(conversation)){const channel=getChannel(conversation.slice(8));return {conversation:'channel:'+channel.id,kind:'channel' as const,id:channel.id,members:channelReaderIds(channel.id)}}
 return requireConversation(conversation)
}

/** Full public data, never a private transcript or a guessed latest-N summary. */
export async function conversationEntry(args:Record<string,any>){
 const scope=publishedScope(args.conversation);if(typeof args.id!=='string'||!args.id)throw Error('Choose a published entry ID')
 let entry:any,kind:'news'|'message'='message';let attachments:Attachment[]=[]
 if(scope.kind==='channel'&&args.id.startsWith('np_')){
  const row=liveChannelPost(args.id);if(row.channel_id!==scope.id)throw Error('Entry belongs to another conversation')
  const {saved:_,savedAt:__,...post}=projectChannelPost(row);entry=post;kind='news'
  attachments=[...post.media.map(file=>({id:'image:'+file.id,name:file.name,kind:'image' as const,bytes:file.bytes,mimeType:file.mimeType,sha256:file.sha256,mediaId:file.id,read:{command:'channel.image',args:{channelId:scope.id,postId:post.id,mediaId:file.id}}})),...(post.files??[]).map(({savedPath:_,...file})=>({...file,id:'document:'+file.id,fileId:file.id,kind:'document' as const}))]
 }else{
  entry=scope.kind==='employee'?directPublishedEntry(scope.id,args.id):scope.kind==='group'?readChatMessages(scope.id).find(message=>message.id===args.id):getChannelMessage(scope.id,args.id)
  if(!entry)throw Error('Unknown published message')
  attachments=await Promise.all((entry.attachments??[]).map(async(file:any)=>{
   const shared=file.path.startsWith('@workspace/'),endpoint=shared?conversationFileEndpoint(scope.conversation,file.path):undefined,info=endpoint?await sharedFileIO(endpoint,'copy-info',{path:endpoint.path}):undefined
   return {id:'attachment:'+hash(file.path).slice(0,32),name:file.name,kind:file.kind==='image'?'image':'document',bytes:info?.regular?info.bytes:file.bytes,mimeType:file.mimeType,path:file.path,...(endpoint?{version:info?.version??'missing'}:{}),read:scope.kind==='employee'?{command:file.kind==='image'?'workspace.image':'workspace.read',args:{employee:scope.id,path:file.path}}:shared?{command:'conversation.file',args:{conversation:scope.conversation,path:file.path,operation:file.kind==='image'?'image':'chunk'}}:{command:'chat.file',args:{id:scope.id,path:file.path,operation:file.kind==='image'?'image':'chunk'}}}
  }))
 }
 const text=[entry.url,entry.authorUrl,entry.title,entry.body,entry.text].filter(value=>typeof value==='string').join('\n')
 const links=[...new Set((text.match(/https?:\/\/[^\s<>"\u0000-\u001f]+/g)??[]).map(url=>url.replace(/[),.;]+$/,'')))]
 return {conversation:scope.conversation,kind,entry,links,attachments:attachments.map(file=>({...file,download:{command:'conversation.download',args:{conversation:scope.conversation,entryId:args.id,attachmentId:file.id}}}))}
}
async function attachmentSource(conversation:string,entryId:string,file:Attachment):Promise<FileEndpoint>{
 const scope=publishedScope(conversation),context=requestContext();let endpoint:FileEndpoint
 if(file.fileId){const row=liveChannelPost(entryId),original=projectChannelDocuments(row).find(value=>value.id===file.fileId)!
  const cached=one('SELECT path FROM channel_file_imports WHERE post_id=? AND file_id=? AND sha256=?',entryId,file.fileId,file.sha256!)
  endpoint=cached&&fs.existsSync(cached.path)?{root:path.dirname(cached.path),path:path.basename(cached.path)}:cloudDocumentSource(row,original)
 }else if(file.mediaId)endpoint=channelFileEndpoint({channelId:scope.id,postId:entryId,mediaId:file.mediaId})
 else if(scope.kind==='employee'&&file.path)endpoint=directFileEndpoint(scope.id,file.path)
 else if(scope.kind==='group'&&botGroup(scope.id)&&file.path?.startsWith('@bot/'))endpoint=await botFileEndpoint(scope.id,file.path)
 else if(file.path?.startsWith('@workspace/'))endpoint=conversationFileEndpoint(conversation,file.path)
 else{if(scope.kind!=='group'||!file.path)throw Error('Attachment source is unavailable');endpoint={root:groupMediaRoot(scope.id),path:file.path}}
 const validate=endpoint.validate
 return {...endpoint,name:file.name,validate:async(operation,args)=>withCaller(context,async()=>{
  authorize('conversation.entry');publishedScope(conversation)
  if(scope.kind==='channel'&&entryId.startsWith('np_')){const post=liveChannelPost(entryId);if(post.channel_id!==scope.id)throw Error('Post moved to another channel')}
  if(operation==='copy-info'){
   const current=(await conversationEntry({conversation,id:entryId})).attachments.find(value=>value.id===file.id)
   if(!current||current.bytes!==file.bytes||current.sha256!==file.sha256||current.version!==file.version)throw Error('Published attachment changed during download')
  }
  await validate?.(operation,args)
 })}
}
type Download={id:string;transferId?:string;phase?:'server'|'transfer';owner:string;fingerprint:string;conversation:string;entryId:string;attachmentId:string;employeeId:string;workspace:string;workspacePath:string;targetRoot:string;name:string;sourceVersion?:string;state:TransferJob['state']|'interrupted';bytes:number;totalBytes:number;destination?:string;absolutePath?:string;error?:string;createdAt:number}
let downloadsClosing=false
const activeDownloads=new Map<string,Download>()
const pendingDownloads=new Map<string,{fingerprint:string;promise:Promise<any>}>()
const persist=(job:Download)=>run('UPDATE conversation_downloads SET data=? WHERE id=?',JSON.stringify(job),job.id)
function refresh(job:Download){
 if(!['queued','running'].includes(job.state))return job
 if(!job.transferId){if(activeDownloads.has(job.id))return activeDownloads.get(job.id)!;job.state='interrupted';job.error='Core restarted during document preparation; this copy was not replayed.';persist(job);return job}
 try{const live=getTransfer(job.transferId);job.state=live.state;job.bytes=live.bytes;job.error=live.error;if(live.destination){job.destination=live.destination;job.absolutePath=path.join(job.targetRoot,live.destination)}}
 catch{job.state='interrupted';job.error='Core restarted; inspect your workspace before requesting another copy. This request was not replayed.'}
 persist(job);return job
}
const publicDownload=({owner:_,fingerprint:__,targetRoot:___,transferId:____,...job}:Download)=>job
export function downloadStatus(args:Record<string,any>){
 const row=one('SELECT data FROM conversation_downloads WHERE id=?',String(args.id)),job:Download|undefined=row&&JSON.parse(row.data)
 if(!job||job.owner!==actor(requestContext().principal))throw Error('Unknown attachment download for this caller')
 if(args.cancel!==undefined&&typeof args.cancel!=='boolean')throw Error('cancel must be boolean')
 if(args.cancel&&['queued','running'].includes(job.state)){const pending=activeDownloads.get(job.id);if(pending&&!pending.transferId){pending.state='cancelled';persist(pending);return publicDownload(pending)}if(job.transferId)try{cancelTransfer(job.transferId)}catch{}}
 return publicDownload(refresh(job))
}
export async function downloadAttachment(args:Record<string,any>,resolve:(ref:FileLocation,destination:boolean)=>FileEndpoint){
 const scope=publishedScope(args.conversation),principal=requestContext().principal,employee=args.employee??(principal.kind==='agent'?principal.employeeId:scope.kind==='employee'?scope.id:undefined),context=requestContext()
 const workspaceId=args.workspace??'company:'+employee,workspace=workspaceCatalog({employee}).workspaces.find(w=>w.id===workspaceId)
 if(!workspace)throw Error('Choose one of your workspace.catalog IDs')
 const validate=()=>{if(downloadsClosing)throw Error('Core is stopping; this copy will not be replayed');authorize('conversation.download');const currentScope=publishedScope(scope.conversation);if(currentScope.kind!=='employee'&&!isAppAdministrator()&&!currentScope.members.includes(employee))throw Error('The selected employee must belong to the source conversation');const current=workspaceCatalog({employee}).workspaces.find(w=>w.id===workspaceId);if(!current||current.path!==workspace.path)throw Error('Destination workspace changed or membership was removed')}
 validate()
 if(typeof args.clientRequestId!=='string'||!args.clientRequestId.trim()||args.clientRequestId.length>160)throw Error('Provide a stable clientRequestId')
 let file=(await conversationEntry({conversation:scope.conversation,id:args.entryId})).attachments.find(file=>file.id===args.attachmentId)
 if(!file)throw Error('Choose an attachment ID returned by conversation.entry')
 const subdirectory=relative(args.path),name=filename(args.name??file.name),fingerprint=hash(JSON.stringify([scope.conversation,args.entryId,file.id,workspaceId,employee,subdirectory,name])),requestKey=JSON.stringify([actor(principal),args.clientRequestId])
 const previous=one('SELECT data FROM conversation_downloads WHERE request_key=?',requestKey)
 if(previous){const job:Download=JSON.parse(previous.data);if(job.fingerprint!==fingerprint)throw Error('Download request ID already used with different arguments');return publicDownload(refresh(job))}
 const pending=pendingDownloads.get(requestKey)
 if(pending){if(pending.fingerprint!==fingerprint)throw Error('Download request ID already used with different arguments');return pending.promise}
 const promise=(async()=>{
  const to:FileLocation={employee,path:subdirectory},initial=resolve(to,true),root=initial.root,remote=JSON.stringify(initial.remote),job:Download={id:'cd_'+randomUUID(),phase:file!.fileId&&(!file!.sha256||file!.deferred)?'server':'transfer',owner:actor(principal),fingerprint,conversation:scope.conversation,entryId:args.entryId,attachmentId:file!.id,employeeId:employee,workspace:workspaceId,workspacePath:workspace.path,targetRoot:root,name,sourceVersion:file!.version,state:'queued',bytes:0,totalBytes:file!.bytes,createdAt:Date.now()}
  activeDownloads.set(job.id,job);run('INSERT INTO conversation_downloads VALUES(?,?,?)',job.id,requestKey,JSON.stringify(job))
  void withCaller(context,async()=>{try{
   const check=()=>{if(!['queued','running'].includes(job.state))throw Error('Attachment download stopped');validate();const current=resolve(to,true);if(current.root!==root||JSON.stringify(current.remote)!==remote)throw Error('Destination execution host changed')}
   if(job.phase==='server'){
    await prepareChannelDocument(args.entryId,file!.fileId!,check,(bytes,state)=>{job.bytes=bytes;job.state=state;persist(job)})
    check();file=(await conversationEntry({conversation:scope.conversation,id:args.entryId})).attachments.find(value=>value.id===job.attachmentId)
    if(!file)throw Error('Published attachment was removed during retrieval')
   }
   check();job.phase='transfer';job.bytes=0
   let bytes=0;const digest=file!.sha256?createHash('sha256'):undefined,originalValidate=initial.validate
   const target:FileEndpoint={...initial,validate:async(operation,input)=>{check();await originalValidate?.(operation,input);if(operation==='copy-write'){if(input.offset!==bytes)throw Error('Unexpected download offset');const chunk=Buffer.from(String(input.data),'base64');bytes+=chunk.length;digest?.update(chunk)}if(operation==='copy-commit'&&(bytes!==file!.bytes||digest&&digest.digest('hex')!==file!.sha256))throw Error('Attachment size or SHA-256 did not match; no file was committed')}}
   const source=await attachmentSource(scope.conversation,args.entryId,file!);source.name=name
   if(!target.remote){let suffix=1;const ext=path.extname(name),stem=name.slice(0,name.length-ext.length);while(fs.existsSync(path.join(target.root,target.path,source.name)))source.name=stem+' ('+suffix+++')'+ext}
   check();const transfer=startTransfer({conversation:scope.conversation,path:file!.path??args.entryId+'/'+file!.id},to,source,target);job.transferId=transfer.id;job.name=source.name;job.state=transfer.state;persist(job)
   while(['queued','running'].includes(job.state)){await new Promise(resolve=>setTimeout(resolve,100));refresh(job)}
  }catch(error){if(job.state!=='cancelled'&&job.state!=='interrupted'){job.state='failed';job.error=(error as Error).message;persist(job)}}finally{activeDownloads.delete(job.id)}})
  return publicDownload(job)
 })()
 pendingDownloads.set(requestKey,{fingerprint,promise});void promise.finally(()=>pendingDownloads.delete(requestKey)).catch(()=>{});return promise
}
export async function downloadAttachmentLocal(args:Record<string,any>){
 if(!isAppAdministrator())throw Error('Only the user or Secretary may save files to a chosen Mac/Core-host path')
 const scope=publishedScope(args.conversation),file=(await conversationEntry({conversation:scope.conversation,id:args.entryId})).attachments.find(f=>f.id===args.attachmentId)
 if(!file)throw Error('Choose an attachment returned by conversation.entry')
 if(typeof args.path!=='string'||!path.isAbsolute(args.path))throw Error('Choose an absolute local destination file path')
 return saveDownload(await attachmentSource(scope.conversation,args.entryId,file),args.path,args.overwrite===true)
}

export function closeConversationDownloads(){downloadsClosing=true;for(const job of activeDownloads.values()){if(job.transferId)refresh(job);if(['queued','running'].includes(job.state)){job.state='interrupted';job.error='Core stopped; inspect your workspace before requesting another copy. This request was not replayed.';persist(job)}}}
