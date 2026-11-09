import {validateGroupDraftScope} from './group-collaboration'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {authorize,requestContext} from './authorization'
import {requireConversation} from './conversation-policy'
import {readChatMessages,groupMediaRoot} from './chat-groups'
import {conversationFileEndpoint,sharedFilesChanged,sharedFileIO} from './conversation-workspaces'
import type {WorkspaceTrash} from './files'
import type {FileEndpoint} from './transfers'
import {readStore} from './store'
import {validateApiArguments} from './api-contract'
import type {SharedFile,SharedFilePage} from '../shared/conversation-files'
import type {ChatMessage} from '../shared/chat-groups'
import {fileMime,type MessageAttachment} from '../shared/message-attachments'

type Source={key:string;id:string;path:string;end?:FileEndpoint;file:MessageAttachment;message?:ChatMessage;sharedAt:number;references:number;external:boolean;stat?:any;removed:WorkspaceTrash[]}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32)
const keyFor=(end:FileEndpoint)=>JSON.stringify([end.remote?.host??null,end.root,end.path])
async function catalog(conversation:string,filters:Record<string,any>={}){
 const scope=requireConversation(conversation);if(scope.kind!=='group')throw Error('Choose a group conversation')
 const rows=new Map<string,Source>(),byPath=new Map<string,Source>(),base=scope.group?.bot?undefined:conversationFileEndpoint(conversation,'.'),inventory=base?await sharedFileIO(base,'shared-list'):undefined
 const active=new Map<string,any>((inventory?.entries??[]).map((entry:any)=>[entry.path,entry])),removed:WorkspaceTrash[]=inventory?.trash??[]
 const add=async(file:MessageAttachment,message?:ChatMessage,stat?:any)=>{
  const external=!!scope.group?.bot,end=external?undefined:file.path.startsWith('@workspace/')?conversationFileEndpoint(conversation,file.path):{root:groupMediaRoot(scope.id),path:file.path,validate:()=>{requireConversation(conversation)}}
  const key=end?keyFor(end):file.path,previous=rows.get(key)
  if(previous){if(message){previous.references++;previous.message=message;previous.file=file;previous.path=file.path;byPath.set(file.path,previous)}return}
  const same=!!end&&!!base&&end.root===base.root&&JSON.stringify(end.remote)===JSON.stringify(base.remote),trash=same?removed.filter(item=>item.path===end!.path):end?(await sharedFileIO(end,'shared-list')).trash.filter((item:WorkspaceTrash)=>item.path===end.path):[]
  const current=stat??(end?same?active.get(end.path)??{exists:false,...(trash.length?{trashed:true}:{})}:await sharedFileIO(end,'copy-info',{path:end.path}):undefined)
  const value:Source={key,id:hash(conversation+'\0'+(file.path.startsWith('@workspace/')?'workspace:':'attachment:')+(end?.path??file.path)),path:file.path,end,file,message,sharedAt:message?.createdAt??current?.modifiedAt??trash[0]?.deletedAt??0,references:message?1:0,external,stat:current?{exists:current.exists??true,...current}:undefined,removed:trash}
  rows.set(key,value);byPath.set(file.path,value)
 }
 for(const message of readChatMessages(scope.id).filter(message=>!message.deletedAt&&(!filters.topicId||(message.topicId??'general')===filters.topicId)&&(!filters.authorId||(message.author.kind==='operator'?'operator':message.author.employeeId)===filters.authorId)&&(filters.from===undefined||message.createdAt>=filters.from)&&(filters.to===undefined||message.createdAt<=filters.to)))for(const file of message.attachments??[])await add(file,message)
 for(const entry of inventory?.entries??[]){const mimeType=fileMime(entry.name);await add({path:'@workspace/'+entry.path,name:entry.name,bytes:entry.bytes,mimeType,kind:mimeType.startsWith('image/')?'image':'file'},undefined,entry)}
 for(const item of removed)if(!item.directory){const name=path.posix.basename(item.path),mimeType=fileMime(name);await add({path:'@workspace/'+item.path,name,bytes:item.bytes??0,mimeType,kind:mimeType.startsWith('image/')?'image':'file'})}
 requireConversation(conversation);return {scope,rows:[...rows.values()],byPath}
}
function info(source:Source,conversation:string,trash?:WorkspaceTrash,actorNames?:Map<string,string>):SharedFile{
 const stat=source.stat,state=trash?'trashed':source.external?'external':stat?.exists&&stat.regular?'available':stat?.trashed?'trashed':'missing'
 return {id:source.id+(trash?'~'+trash.id:''),path:source.path,name:source.file.name,bytes:trash?.bytes??stat?.bytes??source.file.bytes,mimeType:source.file.mimeType,kind:source.file.kind,version:trash?.version??stat?.version??(source.end?'missing':hash(source.path)),state,referenceCount:source.references,...(source.message?{messageId:source.message.id,authorIdentity:source.message.author}:{}),author:source.message?.authorName??'',sharedAt:source.sharedAt,canTrash:state==='available'&&!stat?.symlink,canRestore:!!trash&&!trash.directory,...(source.end&&state==='available'?{previewId:(source.path.startsWith('@workspace/')?conversation:'published:'+conversation)+'|'+encodeURIComponent(source.end.path)}:{}),...(trash?{trashId:trash.id,deletedAt:trash.deletedAt,...(trash.by?{deletedBy:trash.by,...(trash.by.kind==='agent'&&actorNames?.get(trash.by.employeeId)?{deletedByName:actorNames.get(trash.by.employeeId)}:{})}:{})}:{})}
}
export async function listConversationFiles(args:Record<string,any>):Promise<SharedFilePage>{
 authorize('conversation.files',args);validateApiArguments('conversation.files',args);if(args.from!==undefined&&args.to!==undefined&&args.from>args.to)throw Error('Choose a valid date range');if(args.topicId)validateGroupDraftScope(args.conversation.slice(6),args.topicId)
 const names=new Map(readStore().sessions.map(card=>[card.id,card.title])),data=await catalog(args.conversation,args),list=data.rows.flatMap(source=>args.state==='trash'?source.removed.map(item=>info(source,args.conversation,item,names)):[info(source,args.conversation)]).filter(file=>file.state!=='trashed'||args.state==='trash').filter(file=>(!args.query||file.name.toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase()))&&(args.author===undefined||args.author==='all'||(args.author==='you'?file.authorIdentity?.kind==='operator':file.authorIdentity?.kind==='agent'))&&!( !file.messageId&&(args.topicId||args.authorId||args.from!==undefined&&file.sharedAt<args.from||args.to!==undefined&&file.sharedAt>args.to)))
 list.sort((a,b)=>args.sort==='name'?a.name.localeCompare(b.name)||a.id.localeCompare(b.id):args.sort==='size'?b.bytes-a.bytes||a.name.localeCompare(b.name):(b.deletedAt??b.sharedAt)-(a.deletedAt??a.sharedAt)||a.id.localeCompare(b.id))
 const offset=args.offset??0,limit=args.limit??40;return {files:list.slice(offset,offset+limit),total:list.length,totalBytes:list.reduce((n,file)=>n+file.bytes,0),nextOffset:offset+limit<list.length?offset+limit:null,readOnly:!!data.scope.group?.bot}
}
export async function trashConversationFiles(args:Record<string,any>){
 authorize('conversation.file-trash',args);validateApiArguments('conversation.file-trash',args);const data=await catalog(args.conversation),keys=new Set<string>(),planned:{source:Source;version:string;existing?:WorkspaceTrash}[]=[]
 for(const target of args.files){
  const source=data.byPath.get(target.path);if(!source)throw Error('Choose a shared file from conversation.files');if(source.external||!source.end)throw Error('File deletion is not supported by this native chat connector');if(keys.has(source.key))throw Error('Choose each shared file only once');keys.add(source.key)
  const current=await sharedFileIO(source.end,'copy-info',{path:source.end.path})
  if(current.exists){if(!current.regular||current.symlink)throw Error('Choose regular shared files');if(current.version!==target.version)throw Error('File changed; refresh before deleting')}
  else{const previous=source.removed.find(item=>item.version===target.version&&!item.directory);if(!previous)throw Error('File is no longer available; refresh the list');planned.push({source,version:target.version,existing:previous});continue}
  planned.push({source,version:target.version})
 }
 const moved:{source:Source;id:string}[]=[]
 try{for(const item of planned)if(!item.existing){const result=await sharedFileIO(item.source.end!,'trash',{path:item.source.end!.path,by:requestContext().principal,expectedVersion:item.version});moved.push({source:item.source,id:result.id})}}
 catch(error){let failed=false;for(const item of moved.reverse())try{await sharedFileIO(item.source.end!,'restore',{id:item.id})}catch{failed=true};sharedFilesChanged(args.conversation);if(failed)throw Error('Some files remain recoverable in Trash. Refresh before trying again.');throw error}
 sharedFilesChanged(args.conversation);return {trashed:planned.map(item=>({path:item.source.path,trashId:item.existing?.id??moved.find(value=>value.source===item.source)!.id})),count:planned.length}
}
export async function restoreConversationFiles(args:Record<string,any>){
 authorize('conversation.file-restore',args);validateApiArguments('conversation.file-restore',args);const data=await catalog(args.conversation),keys=new Set<string>(),planned:{source:Source;id:string;already:boolean}[]=[]
 for(const target of args.files){
  const source=data.byPath.get(target.path);if(!source||source.external||!source.end)throw Error('Choose a recoverable shared group file');if(keys.has(source.key))throw Error('Several removed versions share the same filename. Restore one version at a time.');keys.add(source.key)
  const receipt=await sharedFileIO(source.end,'trash-info',{id:target.trashId});if(receipt.path!==source.end.path||receipt.directory)throw Error('Trash receipt belongs to another file');if(!receipt.already&&!receipt.available)throw Error('Trash content is unavailable');if(!receipt.already&&receipt.originalExists)throw Error('A file already uses this name. It was not overwritten; the removed file remains in Trash.');planned.push({source,id:target.trashId,already:receipt.already})
 }
 const restored:typeof planned=[]
 try{for(const item of planned)if(!item.already){await sharedFileIO(item.source.end!,'restore',{id:item.id,keepReceipt:true});restored.push(item)}}catch(error){let failed=false;for(const item of restored.reverse())try{await sharedFileIO(item.source.end!,'restore-rollback',{id:item.id})}catch{failed=true};sharedFilesChanged(args.conversation);if(failed)throw Error('Some files were restored. Refresh to inspect their current locations before retrying.');throw error}
 sharedFilesChanged(args.conversation);return {restored:planned.map(item=>({path:item.source.path,trashId:item.id})),count:planned.length}
}
export async function sharedFileForReading(args:Record<string,any>){
 authorize('conversation.file-open',args);validateApiArguments('conversation.file-open',args);const source=(await catalog(args.conversation)).byPath.get(args.path)
 if(!source||source.external||!source.end)throw Error('Choose an available shared PDF');if(path.posix.extname(source.end.path).toLowerCase()!=='.pdf')throw Error('Choose a PDF to open in Margin Reader')
 const validate=async()=>{const stat=await sharedFileIO(source.end!,'copy-info',{path:source.end!.path});if(!stat.exists||!stat.regular||stat.symlink||stat.version!==args.version)throw Error('File changed or is unavailable; refresh before opening')};await validate()
 return {root:source.end.root,path:source.end.path,version:args.version,end:source.end,validate}
}
