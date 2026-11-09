import {isAppAdministrator} from './application-authority'
import {createHash} from 'node:crypto'
import {readStore,writeStore} from './store'
import {requestContext} from './authorization'
import {employeeReady,type Item,type GroupReplyReference} from '../shared/types'
import {catalog,messages,advanceGroupRead} from './chat-group-store'
import {advanceDirectRead,directSummary} from './direct-messages'
import type {DirectReplyReference} from '../shared/direct-messages'

const replyId=(taskId:string|undefined,itemId:string,text:string)=>createHash('sha256').update(JSON.stringify([taskId,itemId,text])).digest('hex')
// Only the active turn and its latest explicit group publication are linked.
// No text matching, copied transcripts or per-message read history is needed.
const turns=new Map<string,{id:string;groupReply?:GroupReplyReference;directReply?:DirectReplyReference}>()
export function beginReplyTurn(employeeId:string,taskId:string){turns.set(employeeId,{id:taskId})}
export function endReplyTurn(employeeId:string,taskId?:string){if(!taskId||turns.get(employeeId)?.id===taskId)turns.delete(employeeId)}
export function recordGroupReply(employeeId:string,reference:GroupReplyReference){const turn=turns.get(employeeId);if(turn)turn.groupReply=reference}
export function recordDirectReply(employeeId:string,reference:DirectReplyReference){const turn=turns.get(employeeId);if(turn)turn.directReply=reference}
export function acknowledgeDirectReply(employeeId:string,reference:DirectReplyReference){
 const store=readStore(),card=store.sessions.find(c=>c.id===employeeId),reply=card?.lastReply
 if(!card||!reply?.directReply||reply.directReply.sequence>reference.sequence)return
 if(!reply.readAt){card.lastReply={...reply,readAt:Date.now()};writeStore(store)}
 if(reply.groupReply&&catalog().groups.some(g=>g.id===reply.groupReply!.groupId)){advanceGroupRead(reply.groupReply.groupId,reply.groupReply.sequence,reply.groupReply.topicId??'general');acknowledgeGroupReplies(reply.groupReply.groupId,reply.groupReply.sequence,reply.groupReply.topicId??'general')}
}
export function acknowledgeGroupReplies(groupId:string,sequence:number,topicId?:string,exactIds?:string[]){
 const store=readStore(),history=messages(groupId);let changed=false
 for(const card of store.sessions){const reply=card.lastReply,reference=reply?.groupReply;if(card.deleting||!reply||reply.readAt||reference?.groupId!==groupId||reference.sequence>sequence)continue
  if(!history.some(message=>message.id===reference.messageId&&message.sequence===reference.sequence&&(!topicId||(message.topicId??'general')===topicId)&&(!exactIds||exactIds.includes(message.id))&&message.author.kind==='agent'&&message.author.employeeId===card.id))continue
  card.lastReply={...reply,readAt:Date.now()};if(reply.directReply)advanceDirectRead(card.id,reply.directReply);changed=true
 }
 if(changed)writeStore(store)
}

/** Publish once per completed visible answer, never for tools/thinking/onboarding. */
export function publishReply(employeeId:string,items:Item[],turnKey?:string){
  let answer:{itemId:string;text:string}|undefined
  for(let i=items.length-1;i>=0&&!answer;i--){
    const item=items[i];if(item.role==='user')break
    if(item.role!=='assistant')continue
    for(let j=item.blocks.length-1;j>=0;j--){
      const block=item.blocks[j]
      if(block.kind==='text'&&block.text.trim()){answer={itemId:item.id,text:block.text.trim()};break}
    }
  }
  const turn=turns.get(employeeId),directReply=turn&&turn.id===turnKey?turn.directReply:undefined
  if(!answer&&directReply){for(let i=items.length-1;i>=0;i--){const item=items[i];if(item.role==='user')break;if(item.role==='assistant'){answer={itemId:item.id,text:'Private message sent'};break}}}
  if(!answer)return
  const store=readStore(),card=store.sessions.find(card=>card.id===employeeId&&!card.deleting)
  if(!card||!employeeReady(card))return
  const id=replyId(turnKey,answer.itemId,answer.text)
  if(card.lastReply?.id===id)return
  const paragraphs=answer.text.split(/\n\s*\n/).filter(text=>text.trim()&&!/^```\s*$/.test(text.trim()))
  const paragraph=paragraphs.at(-1)??answer.text,characters=Array.from(paragraph)
  // The full answer remains in transcripts; the persisted floor preview is bounded.
  const text=characters.length>4000?'…'+characters.slice(-4000).join(''):paragraph
  const groupReply=turn&&turn.id===turnKey?turn.groupReply:undefined
  const alreadyRead=groupReply&&catalog().groups.some(group=>group.id===groupReply.groupId&&(Math.max(group.readSequence,group.topicRead?.[groupReply.topicId??'general']??0)>=groupReply.sequence||group.readMessageIds?.includes(groupReply.messageId)))||directReply&&directSummary(employeeId).readSequence>=directReply.sequence
  card.lastReply={id,itemId:answer.itemId,text,createdAt:Date.now(),...(groupReply?{groupReply}:{}),...(directReply?{directReply}:{}),...(alreadyRead?{readAt:Date.now()}:{})}
  writeStore(store)
}

/** An old UI frame must not acknowledge a newer reply. Agent readers never mark user read. */
export function acknowledgeReply(employeeId:string,replyId:string){
  if(!isAppAdministrator())throw Error('Only the user or Secretary may acknowledge a reply')
  if(typeof replyId!=='string'||!replyId)throw Error('replyId is required')
  const store=readStore(),card=store.sessions.find(card=>card.id===employeeId&&!card.deleting)
  if(!card)throw Error('Unknown employee')
  if(!card.lastReply||card.lastReply.id!==replyId)return {acknowledged:false,replyId:card.lastReply?.id}
  if(card.lastReply.directReply)advanceDirectRead(employeeId,card.lastReply.directReply)
  const reference=card.lastReply.groupReply
  if(reference&&catalog().groups.some(group=>group.id===reference.groupId)&&messages(reference.groupId).some(message=>message.id===reference.messageId&&message.sequence===reference.sequence&&message.author.kind==='agent'&&message.author.employeeId===employeeId)){
   const sequence=advanceGroupRead(reference.groupId,reference.sequence,reference.topicId??'general')!
   acknowledgeGroupReplies(reference.groupId,reference.sequence,reference.topicId??'general')
   const current=readStore().sessions.find(card=>card.id===employeeId)!.lastReply!
   return {acknowledged:true,replyId,readAt:current.readAt}
  }
  if(!card.lastReply.readAt){card.lastReply={...card.lastReply,readAt:Date.now()};writeStore(store)}
  return {acknowledged:true,replyId,readAt:card.lastReply.readAt}
}
