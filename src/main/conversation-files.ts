import {validateGroupDraftScope} from './group-collaboration'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {authorize,requestContext} from './authorization'
import {requireConversation} from './conversation-policy'
import {readChatMessages,groupMediaRoot} from './chat-groups'
import {conversationFileEndpoint,sharedFilesChanged,workspaceForMember} from './conversation-workspaces'
import {workspaceFiles,workspacePath,workspaceTrash,type WorkspaceTrash} from './files'
import {fileVersion} from './read-cache'
import {readStore} from './store'
import {atomicJson} from './atomic-file'
import {validateApiArguments} from './api-contract'
import type {SharedFile,SharedFilePage} from '../shared/conversation-files'
import type {ChatMessage} from '../shared/chat-groups'
import {fileMime,type MessageAttachment} from '../shared/message-attachments'

type Source={key:string;id:string;path:string;root?:string;relative?:string;file:MessageAttachment;message?:ChatMessage;sharedAt:number;references:number;external:boolean}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32)
function catalog(conversation:string,filters:Record<string,any>={}){
 const scope=requireConversation(conversation)
 if(scope.kind!=='group')throw Error('Choose a group conversation')
 const rows=new Map<string,Source>(),byPath=new Map<string,Source>()
 for(const message of readChatMessages(scope.id).filter(message=>!message.deletedAt&&(!filters.topicId||(message.topicId??'general')===filters.topicId)&&(!filters.authorId||(message.author.kind==='operator'?'operator':message.author.employeeId)===filters.authorId)&&(filters.from===undefined||message.createdAt>=filters.from)&&(filters.to===undefined||message.createdAt<=filters.to)))for(const file of message.attachments??[]){
  const external=!!scope.group?.bot,endpoint=external?undefined:file.path.startsWith('@workspace/')?conversationFileEndpoint(conversation,file.path):{root:groupMediaRoot(scope.id),path:file.path}
  const relative=endpoint?path.relative(endpoint.root,workspacePath(endpoint.root,endpoint.path)).split(path.sep).join('/'):undefined
  const key=endpoint?endpoint.root+'\0'+relative:file.path,previous=rows.get(key)
  if(previous){previous.references++;previous.message=message;previous.file=file;previous.path=file.path;byPath.set(file.path,previous);continue}
  const value:Source={key,id:hash(conversation+'\0'+(file.path.startsWith('@workspace/')?'workspace:':'attachment:')+(relative??file.path)),path:file.path,...(endpoint?{root:endpoint.root,relative}:{}),file,message,sharedAt:message.createdAt,references:1,external}
  rows.set(key,value);byPath.set(file.path,value)
 }
 if(!scope.group?.bot){
  const workspace=workspaceForMember(conversation),root=workspace.root
  const add=(relative:string,bytes:number,sharedAt:number)=>{
   const publishedPath='@workspace/'+relative,key=root+'\0'+relative
   if(rows.has(key))return
   const name=path.basename(relative),mimeType=fileMime(name),file:MessageAttachment={path:publishedPath,name,bytes,mimeType,kind:mimeType.startsWith('image/')?'image':'file'}
   const source:Source={key,id:hash(conversation+'\0workspace:'+relative),path:publishedPath,root,relative,file,sharedAt,references:0,external:false};rows.set(key,source);byPath.set(publishedPath,source)
  }
  const walk=(folder:string)=>{for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){
   if(entry.name.startsWith('.')||entry.isSymbolicLink())continue
   const relative=path.posix.join(folder,entry.name)
   if(entry.isDirectory())walk(relative)
   else if(entry.isFile()){const stat=fs.lstatSync(path.join(root,relative));if(stat.isFile()&&!stat.isSymbolicLink())add(relative,stat.size,stat.mtimeMs)}
  }}
  walk('')
  for(const item of workspaceTrash(root))if(!item.directory)add(item.path.split(path.sep).join('/'),item.bytes??0,item.deletedAt)
 }
 return {scope,rows:[...rows.values()],byPath}
}
const actorName=(message?:ChatMessage)=>message?.authorName??''
function info(source:Source,conversation:string,trash?:WorkspaceTrash,actorNames?:Map<string,string>):SharedFile{
 const stat=(!trash&&source.root?workspaceFiles(source.root,'copy-info',{path:source.relative}):undefined) as {exists?:boolean;regular?:boolean;symlink?:boolean;bytes?:number;trashed?:boolean}|undefined
 const state=trash?'trashed':source.external?'external':stat?.exists&&stat.regular?'available':stat?.trashed?'trashed':'missing'
 return {id:source.id+(trash?'~'+trash.id:''),path:source.path,name:source.file.name,bytes:trash?.bytes??stat?.bytes??source.file.bytes,mimeType:source.file.mimeType,kind:source.file.kind,version:trash?.version??(source.root?(stat?.exists?fileVersion(path.join(source.root,source.relative!)):'missing'):hash(source.path)),state,referenceCount:source.references,...(source.message?{messageId:source.message.id,authorIdentity:source.message.author}:{}),author:actorName(source.message),sharedAt:source.message?.createdAt??source.sharedAt,canTrash:state==='available'&&!stat?.symlink,canRestore:!!trash&&!trash.directory,...(source.root&&state==='available'?{previewId:(source.path.startsWith('@workspace/')?conversation:'published:'+conversation)+'|'+encodeURIComponent(source.relative!)}:{}),...(trash?{trashId:trash.id,deletedAt:trash.deletedAt,...(trash.by?{deletedBy:trash.by,...(trash.by.kind==='agent'&&actorNames?.get(trash.by.employeeId)?{deletedByName:actorNames.get(trash.by.employeeId)}:{})}:{})}:{})}
}
export function listConversationFiles(args:Record<string,any>):SharedFilePage{
 authorize('conversation.files',args);validateApiArguments('conversation.files',args)
 if(args.from!==undefined&&args.to!==undefined&&args.from>args.to)throw Error('Choose a valid date range')
 if(args.topicId)validateGroupDraftScope(args.conversation.slice(6),args.topicId)
 const actorNames=new Map(readStore().sessions.map(card=>[card.id,card.title])),data=catalog(args.conversation,args),trashByRoot=new Map<string,WorkspaceTrash[]>(),state=args.state??'active'
 const list=data.rows.flatMap(source=>{
  if(state==='trash'){
   if(!source.root)return []
   if(!trashByRoot.has(source.root))trashByRoot.set(source.root,workspaceTrash(source.root))
   return trashByRoot.get(source.root)!.filter(item=>item.path===source.relative&&!item.directory).map(item=>info(source,args.conversation,item,actorNames))
  }
  const item=info(source,args.conversation)
  if(item.state==='trashed')return []
  return [item]
 }).filter(item=>(!args.query||item.name.toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase()))&&(args.author===undefined||args.author==='all'||(args.author==='you'?item.authorIdentity?.kind==='operator':item.authorIdentity?.kind==='agent')))
 const filtered=list.filter(file=>!(!file.messageId&&(args.topicId||args.authorId||args.from!==undefined&&file.sharedAt<args.from||args.to!==undefined&&file.sharedAt>args.to)))
 const sort=args.sort??'newest'
 filtered.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name)||a.id.localeCompare(b.id):sort==='size'?b.bytes-a.bytes||a.name.localeCompare(b.name):(b.deletedAt??b.sharedAt)-(a.deletedAt??a.sharedAt)||a.id.localeCompare(b.id))
 const offset=args.offset??0,limit=args.limit??40
 return {files:filtered.slice(offset,offset+limit),total:filtered.length,totalBytes:filtered.reduce((n,file)=>n+file.bytes,0),nextOffset:offset+limit<filtered.length?offset+limit:null,readOnly:!!data.scope.group?.bot}
}
export function trashConversationFiles(args:Record<string,any>){
 authorize('conversation.file-trash',args);validateApiArguments('conversation.file-trash',args)
 const data=catalog(args.conversation),keys=new Set<string>(),planned:{source:Source;version:string;existing?:WorkspaceTrash}[]=[]
 for(const target of args.files){
  const source=data.byPath.get(target.path);if(!source)throw Error('Choose a shared file from conversation.files')
  if(source.external||!source.root)throw Error('File deletion is not supported by this native chat connector')
  if(keys.has(source.key))throw Error('Choose each shared file only once');keys.add(source.key)
  if(source.path.startsWith('@workspace/'))conversationFileEndpoint(args.conversation,source.path,true)
  const current=workspaceFiles(source.root,'copy-info',{path:source.relative})
  if(current.exists){if(!current.regular||current.symlink)throw Error('Choose regular shared files');if(fileVersion(path.join(source.root,source.relative!))!==target.version)throw Error('File changed; refresh before deleting')}
  else{const previous=workspaceTrash(source.root,source.relative).find(item=>item.version===target.version&&!item.directory);if(!previous)throw Error('File is no longer available; refresh the list');planned.push({source,version:target.version,existing:previous});continue}
  planned.push({source,version:target.version})
 }
 const moved:{source:Source;id:string}[]=[]
 try{
  for(const item of planned)if(!item.existing){const result=workspaceFiles(item.source.root!,'trash',{path:item.source.relative},{by:requestContext().principal,expectedVersion:item.version});moved.push({source:item.source,id:result.id!})}
 }catch(error){
  let rollbackFailed=false
  for(const item of moved.reverse())try{workspaceFiles(item.source.root!,'restore',{id:item.id})}catch{rollbackFailed=true}
  sharedFilesChanged(args.conversation)
  if(rollbackFailed)throw Error('Some files remain recoverable in Trash. Refresh before trying again.')
  throw error
 }
 sharedFilesChanged(args.conversation)
 return {trashed:planned.map(item=>({path:item.source.path,trashId:item.existing?.id??moved.find(value=>value.source===item.source)!.id})),count:planned.length}
}
export function restoreConversationFiles(args:Record<string,any>){
 authorize('conversation.file-restore',args);validateApiArguments('conversation.file-restore',args)
 const data=catalog(args.conversation),keys=new Set<string>(),planned:{source:Source;id:string;manifest:string;value:any;already:boolean}[]=[]
 for(const target of args.files){
  const source=data.byPath.get(target.path);if(!source||source.external||!source.root)throw Error('Choose a recoverable shared group file')
  if(keys.has(source.key))throw Error('Several removed versions share the same filename. Restore one version at a time.');keys.add(source.key)
  if(source.path.startsWith('@workspace/'))conversationFileEndpoint(args.conversation,source.path,true)
  const manifest=workspacePath(source.root,'.agents-company/trash/'+target.trashId+'.json'),stat=fs.existsSync(manifest)?fs.lstatSync(manifest):undefined
  if(!stat?.isFile()||stat.isSymbolicLink())throw Error('Trash receipt unavailable; refresh the list')
  const value=JSON.parse(fs.readFileSync(manifest,'utf8'))
  if(path.relative(source.root,workspacePath(source.root,value.path)).split(path.sep).join('/')!==source.relative||value.directory)throw Error('Trash receipt belongs to another file')
  const blob=workspacePath(source.root,'.agents-company/trash/'+target.trashId),exists=fs.existsSync(blob),already=!!value.restoredAt&&!exists
  if(!already&&!exists)throw Error('Trash content is unavailable')
  if(!already&&fs.existsSync(path.join(source.root,source.relative!)))throw Error('A file already uses this name. It was not overwritten; the removed file remains in Trash.')
  planned.push({source,id:target.trashId,manifest,value,already})
 }
 const restored:typeof planned=[]
 try{for(const item of planned)if(!item.already){workspaceFiles(item.source.root!,'restore',{id:item.id},{keepReceipt:true});restored.push(item)}}
 catch(error){
  let rollbackFailed=false
  for(const item of restored.reverse())try{fs.renameSync(path.join(item.source.root!,item.source.relative!),path.join(item.source.root!,'.agents-company/trash',item.id));atomicJson(item.manifest,item.value,true)}catch{rollbackFailed=true}
  sharedFilesChanged(args.conversation)
  if(rollbackFailed)throw Error('Some files were restored. Refresh to inspect their current locations before retrying.')
  throw error
 }
 sharedFilesChanged(args.conversation)
 return {restored:planned.map(item=>({path:item.source.path,trashId:item.id})),count:planned.length}
}

/** Resolve a current group file, never an arbitrary local path supplied by the renderer. */
export function sharedFileForReading(args:Record<string,any>){
 authorize('conversation.file-open',args);validateApiArguments('conversation.file-open',args)
 const source=catalog(args.conversation).byPath.get(args.path)
 if(!source||source.external||!source.root)throw Error('Choose an available local shared PDF')
 const file=info(source,args.conversation)
 if(file.state!=='available'||file.version!==args.version)throw Error('File changed or is unavailable; refresh before opening')
 if(path.extname(source.relative!).toLowerCase()!=='.pdf')throw Error('Choose a PDF to open in Margin Reader')
 if(source.path.startsWith('@workspace/'))conversationFileEndpoint(args.conversation,source.path)
 const filename=workspacePath(source.root,source.relative!),stat=fs.lstatSync(filename)
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Choose a regular shared PDF')
 return {root:source.root,path:source.relative!,version:file.version}
}
