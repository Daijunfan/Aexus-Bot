import type {ConversationFolder} from './messenger'
/** Category membership is a projection over existing conversations, not another history. */
export const CATEGORY_INCLUDES=['outsource','private','groups','channels','telegram','x','youtube'] as const
export type CategoryInclude=typeof CATEGORY_INCLUDES[number]
export type CategoryEntry={key:string;kind:'employee'|'group'|'channel'|'source';platform?:string;enabled?:boolean;channelId?:string;sourceCount?:number;botKind?:'private'|'group'}
export type CategorySelection={conversations:readonly string[];include?:CategoryInclude;excluded?:readonly string[]}
/** Personal inbox: employee DMs and all native Bot endpoints, including Grok rooms. */
export const isPrivateConversation=(entry:CategoryEntry)=>entry.kind==='employee'||(entry.kind==='group'&&!!entry.botKind)
export const matchesCategory=(include:CategoryInclude|undefined,entry:CategoryEntry)=>(include==='youtube'||include==='x'||include==='telegram')?entry.kind==='channel'&&entry.platform===include:include==='outsource'?!!entry.botKind:include==='channels'?entry.kind==='channel':include==='private'?isPrivateConversation(entry):include==='groups'?(entry.kind==='group'&&!entry.botKind):!!include&&entry.kind==='source'&&entry.platform===include&&entry.enabled!==false
export const inCategory=(folder:CategorySelection,entry:CategoryEntry)=>folder.conversations.includes(entry.key)||matchesCategory(folder.include,entry)&&!folder.excluded?.includes(entry.key)
export type SocialElement={id:string;key:string;channelId:string;platform:'telegram'|'x'|'youtube';name:string;locator:string;enabled:boolean;createdAt:number;unreadCount:number;postCount:number;firstUnread?:{id:string;kind:'news'};lastPost?:{id:string;title:string;publishedAt:number;sourceName:string};avatar?:{sourceId:string;sha256:string}}

/** Shared by the directory CLI and live UI; category names never confer a rule. */
export const CONVERSATION_TYPES=['all','outsource','private','groups','channels','telegram','x','youtube'] as const
export type ConversationType=typeof CONVERSATION_TYPES[number]
export const matchesConversationType=(type:ConversationType,entry:CategoryEntry)=>type==='all'||((type==='youtube'||type==='x'||type==='telegram')?entry.kind==='channel'&&entry.platform===type:type==='channels'?entry.kind==='channel':type==='outsource'?!!entry.botKind:type==='private'?isPrivateConversation(entry):type==='groups'?(entry.kind==='group'&&!entry.botKind):entry.kind==='source'&&entry.platform===type)
export const matchesConversationQuery=(query:string,...values:(string|undefined)[])=>values.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
/** Each social platform has one aggregate conversation; authors are filtered inside it. */
export function uniqueConversations<T extends CategoryEntry>(entries:T[]):T[]{
 return entries.filter(entry=>entry.kind!=='source'||!['youtube','x','telegram'].includes(entry.platform??''))
}
export const CONVERSATION_TYPE_LABELS:Record<ConversationType,string>={all:'All types',outsource:'Outsource',private:'Private chats',groups:'Groups',channels:'Channels',telegram:'Telegram channel',x:'X channel',youtube:'YouTube channel'}

/** Permanent category filters, followed by the user's editable categories. No histories are copied. */
export const MESSAGE_CATEGORY_PRESETS=[
 {id:'type:outsource',name:'Outsource',include:'outsource'},
 {id:'type:private',name:'Private',include:'private'},
 {id:'type:groups',name:'Groups',include:'groups'},
 {id:'type:channels',name:'Channels',include:'channels'}
] as const
export const isBuiltinMessageCategory=(id:string)=>MESSAGE_CATEGORY_PRESETS.some(category=>category.id===id)
export function conversationCategories(folders:ConversationFolder[]=[]):ConversationFolder[]{return [...MESSAGE_CATEGORY_PRESETS.map(category=>({...category,conversations:[],revision:0})),...folders]}
