import {join} from 'node:path'
import {atomicJson,readJson} from './atomic-file'
import {reconcileGroupUnread,catalog,directory,indexFile,historyFile,messages,emitChatChange} from './chat-group-store'
import {requireConversation,auditConversation} from './conversation-policy'
import {requestContext} from './request-context'
import {groupDetails} from '../shared/group-collaboration'
import type {ChatMessage,ChatGroup} from '../shared/chat-groups'

type Removal={message:ChatMessage;deletedAt:number;revision:number;reason:'manual'|'retention';restoredAt?:number}
const file=(id:string)=>join(directory,id+'-removed.json')
function refreshPreview(id:string){const store=catalog(),group=store.groups.find(value=>value.id===id),last=messages(id).at(-1);if(group&&last){reconcileGroupUnread(group,messages(id));group.lastMessage={id:last.id,sequence:last.sequence,text:last.deletedAt?'':last.text.slice(0,240),...(last.deletedAt?{removed:true}:{}),createdAt:last.createdAt,authorName:last.authorName,author:last.author};group.revision++;group.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(id)}}
const ledger=(id:string)=>readJson<Record<string,Removal>>(file(id),()=>({}))
function authority(group:ChatGroup,message:ChatMessage){const principal=requestContext().principal;if(principal.kind==='agent'&&!(message.author.kind==='agent'&&message.author.employeeId===principal.employeeId))requireConversation('group:'+group.id,'admin')}
export function requireGroupExport(conversation:string){if(!conversation.startsWith('group:'))return;const current=requireConversation(conversation);if(groupDetails(current.group?.details,current.id).protectedContent)throw Error('Content protection is enabled in this group. Disable it in Group settings before exporting, forwarding or downloading.')}
/** A tombstone retains the message identity and receipts; original content has a separate recovery ledger. */
function remove(group:ChatGroup,selected:ChatMessage[],reason:'manual'|'retention'){
 const entries=ledger(group.id),at=Date.now(),all=messages(group.id),ids=new Set(selected.map(message=>message.id))
 for(const message of selected)if(!message.deletedAt)entries[message.id]={message,deletedAt:at,revision:(message.editRevision??0)+1,reason}
 // Persist the undo record first; a stopped write never loses the original content.
 atomicJson(file(group.id),entries,true)
 const changed=all.map(message=>!ids.has(message.id)||message.deletedAt?message:{...message,text:'',attachments:undefined,pollId:undefined,checklistId:undefined,questionId:undefined,replyQuote:undefined,reply:undefined,deletedAt:at,...(reason==='manual'?{deletedBy:requestContext().principal}:{}),editRevision:(message.editRevision??0)+1})
 atomicJson(historyFile(group.id),changed,true);refreshPreview(group.id);for(const message of selected)emitChatChange(group.id,message.id,undefined,'removed')
 return {count:selected.filter(message=>!message.deletedAt).length,messageIds:[...ids]}
}
export function groupHistoryRequest(command:string,args:Record<string,any>,content:(message:ChatMessage)=>Record<string,unknown>=()=>({})){
 const current=requireConversation('group:'+args.id),group=current.group!;if(group.bot)throw Error('Native Bot message removal and exports are managed by the native service')
 const all=messages(group.id)
 if(command==='chat.export'){
  requireGroupExport(current.conversation);const selected=all.filter(message=>!message.deletedAt&&(!args.topicId||(message.topicId??'general')===args.topicId)&&(args.before===undefined||message.sequence<args.before)),page=selected.slice(-(args.limit??100))
  return {group:{id:group.id,name:group.name,description:groupDetails(group.details,group.id).description},messages:page.map(({fingerprint,clientMessageId,deliveries,...message})=>({...message,...content(message as ChatMessage)})),nextBefore:selected.length>page.length?page[0].sequence:null}
 }
 if(command==='chat.trash'){
  const entries=ledger(group.id),rows=all.filter(message=>message.deletedAt&&entries[message.id]&&!entries[message.id].restoredAt&&(args.before===undefined||message.sequence<args.before)).filter(message=>{try{authority(group,message);return true}catch{return false}}),page=rows.slice(-(args.limit??40)).reverse()
  return {rows:page.map(message=>({id:message.id,sequence:message.sequence,author:message.authorName,deletedAt:message.deletedAt,revision:message.editRevision,text:entries[message.id].message.text.slice(0,240),reason:entries[message.id].reason,attachments:entries[message.id].message.attachments?.length??0})),nextBefore:rows.length>page.length?page.at(-1)!.sequence:null}
 }
 if(command==='chat.clear-history'){
  requireConversation(current.conversation,'admin');const selected=all.filter(message=>!message.deletedAt&&message.sequence<=args.through&&(!args.topicId||(message.topicId??'general')===args.topicId));const result=remove(group,selected,'manual');auditConversation(current.conversation,'clear-history',{through:args.through,topicId:args.topicId,count:result.count});return result
 }
 const targets=args.messages as {id:string;expectedRevision:number}[],seen=new Set<string>(),entries=ledger(group.id)
 const selected=targets.map(target=>{if(seen.has(target.id))throw Error('Choose each message once');seen.add(target.id);const message=all.find(message=>message.id===target.id);if(!message)throw Error('Unknown group message');authority(group,message)
  if(command==='chat.message-trash'&&message.deletedAt){if(entries[message.id]?.message.editRevision!==target.expectedRevision&&(entries[message.id]?.message.editRevision??0)!==target.expectedRevision)throw Error('Message changed; reload before removing');return message}
  if(command==='chat.message-restore'&&!message.deletedAt){if(!entries[message.id]||entries[message.id].revision!==target.expectedRevision||(message.editRevision??0)!==target.expectedRevision+1)throw Error('Message is not in Trash');return message}
  if((message.editRevision??0)!==target.expectedRevision)throw Error('Message changed; reload before saving');return message})
 if(command==='chat.message-trash'){const result=remove(group,selected,'manual');auditConversation(current.conversation,'message-remove',{messageIds:result.messageIds});return result}
 if(command==='chat.message-restore'){
  for(const message of selected)if(message.deletedAt&&!entries[message.id])throw Error('Recovery record is unavailable')
  const ids=new Set(selected.map(message=>message.id)),restored=all.map(message=>{if(!ids.has(message.id)||!message.deletedAt)return message;entries[message.id].restoredAt=Date.now();return {...entries[message.id].message,expiresAt:groupDetails(group.details,group.id).autoDeleteSeconds?Date.now()+groupDetails(group.details,group.id).autoDeleteSeconds*1000:undefined,deliveries:message.deliveries,editRevision:(message.editRevision??0)+1}})
  atomicJson(historyFile(group.id),restored,true);atomicJson(file(group.id),entries,true);refreshPreview(group.id);for(const message of selected)emitChatChange(group.id,message.id,undefined,'restored');auditConversation(current.conversation,'message-restore',{messageIds:[...ids]});return {count:ids.size,messageIds:[...ids]}
 }
 throw Error('Unknown group history operation')
}
let maintenance:ReturnType<typeof setInterval>|undefined
export function startGroupRetention(){stopGroupRetention();const tick=()=>{for(const group of catalog().groups){if(group.bot)continue;try{const expired=messages(group.id).filter(message=>!message.deletedAt&&message.expiresAt&&message.expiresAt<=Date.now());if(expired.length)remove(group,expired,'retention')}catch(cause){console.error('[Group retention]',group.id,(cause as Error).message)}}};tick();maintenance=setInterval(tick,30000);maintenance.unref()}
export function stopGroupRetention(){clearInterval(maintenance);maintenance=undefined}
