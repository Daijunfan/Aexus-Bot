import {groupHasUnread} from '../shared/chat-groups'
import {join} from 'node:path'
import {APP_HOME} from '../shared/protocol'
import {readJson,atomicJson} from './atomic-file'
import type {ChatGroup,ChatMessage,ChatDelivery} from '../shared/chat-groups'
import type {PrincipalRef} from '../shared/management'

export const directory=join(APP_HOME,'chats');export const indexFile=join(directory,'groups.json')
export type ChatChangeKind='published'|'receipt'|'metadata'|'removed'|'restored'
let emitter:(id:string,editedMessageId?:string,messageId?:string,kind?:ChatChangeKind)=>void=()=>{}
export function setChatEmitter(handler:typeof emitter){emitter=handler}
export const emitChatChange=(id:string,editedMessageId?:string,messageId?:string,kind?:ChatChangeKind)=>emitter(id,editedMessageId,messageId,kind)
/** Shared user watermark, independent of employee delivery/work receipts. */
export function advanceGroupRead(id:string,sequence:number,topicId?:string,exactIds?:string[]){
 const store=catalog(),group=store.groups.find(group=>group.id===id);if(!group)return undefined
 if(exactIds){const all=messages(id),seen=new Set(group.readMessageIds??[]);for(const message of all)if(exactIds.includes(message.id)&&message.author.kind==='agent'&&!message.bot?.delivery)seen.add(message.id);group.readMessageIds=[...seen];reconcileGroupUnread(group,all)}
 else if(topicId){group.topicRead??={};if((group.topicRead[topicId]??0)>=sequence)return group.readSequence;group.topicRead[topicId]=sequence;if(!groupHasUnread(group))group.readSequence=Math.max(group.readSequence,group.lastIncomingSequence)}else{if(group.readSequence>=sequence)return group.readSequence;group.readSequence=sequence}
 group.revision++;group.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(id)
 return group.readSequence
}
/** Removing a message dismisses its unread marker without changing any employee delivery receipt. */
export function reconcileGroupUnread(group:ChatGroup,all:ChatMessage[]){
 const seen=new Set(group.readMessageIds??[]),incoming:Record<string,number>={general:0};let first=Infinity
 for(const message of all){const topic=message.topicId??'general';if(message.author.kind!=='agent'||message.bot?.delivery||message.deletedAt||message.sequence<=Math.max(group.readSequence,group.topicRead?.[topic]??0)||seen.has(message.id))continue;incoming[topic]=Math.max(incoming[topic]??0,message.sequence);first=Math.min(first,message.sequence)}
 group.topicIncoming=incoming;group.readSequence=Math.max(group.readSequence,first===Infinity?group.lastIncomingSequence:first-1)
 group.readMessageIds=all.filter(message=>seen.has(message.id)&&message.sequence>Math.max(group.readSequence,group.topicRead?.[message.topicId??'general']??0)).map(message=>message.id)
}
export type StoredChatGroup=ChatGroup&{creation?:{caller:PrincipalRef;key:string;fingerprint:string}}
export type Catalog={version:1;groups:StoredChatGroup[]}
export const catalog=()=>readJson<Catalog>(indexFile,()=>({version:1,groups:[]}),value=>!!value&&typeof value==='object'&&(value as Catalog).version===1&&Array.isArray((value as Catalog).groups)&&(value as Catalog).groups.every(group=>!!group&&typeof group.id==='string'&&/^cg_[a-f0-9-]{36}$/.test(group.id)&&typeof group.name==='string'&&Array.isArray(group.memberIds)&&group.memberIds.every(id=>typeof id==='string')&&(group.ownerId===undefined||group.ownerId===null||typeof group.ownerId==='string')&&(group.adminIds===undefined||Array.isArray(group.adminIds)&&group.adminIds.every(id=>typeof id==='string'))&&(group.silent===undefined||typeof group.silent==='boolean')&&Number.isSafeInteger(group.revision)&&Number.isSafeInteger(group.readSequence)&&Number.isSafeInteger(group.lastIncomingSequence)&&(group.mutes===undefined||!!group.mutes&&typeof group.mutes==='object'&&!Array.isArray(group.mutes)&&Object.values(group.mutes).every(until=>until===null||Number.isSafeInteger(until)&&until>0))))
const idString=(value:unknown,label:string)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim())throw Error('Provide a valid '+label);return value}
export const groupId=(value:unknown)=>{const id=idString(value,'group ID');if(!/^cg_[a-f0-9-]{36}$/.test(id))throw Error('Invalid chat group ID');return id}
export const historyFile=(id:string)=>join(directory,groupId(id)+'.json')
export const messages=(id:string)=>readJson<ChatMessage[]>(historyFile(id),()=>[],value=>Array.isArray(value)&&value.every(message=>message&&typeof message.id==='string'&&Number.isSafeInteger(message.sequence)&&message.sequence>0&&typeof message.text==='string'&&(message.broadcast===undefined||message.broadcast===true)&&(message.editRevision===undefined||Number.isSafeInteger(message.editRevision)&&message.editRevision>=0)&&(message.editedAt===undefined||Number.isSafeInteger(message.editedAt)&&message.editedAt>=0)&&['operator','agent'].includes(message.author?.kind)&&(message.author.kind!=='agent'||typeof message.author.employeeId==='string')&&Array.isArray(message.mentions)&&Array.isArray(message.deliveries)&&message.deliveries.every((delivery:ChatDelivery)=>delivery&&typeof delivery.employeeId==='string'&&(delivery.mode===undefined||delivery.mode==='work'||delivery.mode==='awareness')&&['pending','routing','queued','running','completed','failed','interrupted'].includes(delivery.status))))
