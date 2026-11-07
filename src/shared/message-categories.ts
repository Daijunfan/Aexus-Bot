/** Category membership is a projection over existing conversations, not another history. */
export const CATEGORY_INCLUDES=['outsource','private','groups','channels','telegram','x','youtube'] as const
export type CategoryInclude=typeof CATEGORY_INCLUDES[number]
export type CategoryEntry={key:string;kind:'employee'|'group'|'channel'|'source';platform?:string;enabled?:boolean;channelId?:string;sourceCount?:number;botKind?:'private'|'group'}
export type CategorySelection={conversations:readonly string[];include?:CategoryInclude;excluded?:readonly string[]}
export const matchesCategory=(include:CategoryInclude|undefined,entry:CategoryEntry)=>(include==='youtube'||include==='x'||include==='telegram')?entry.kind==='channel'&&entry.platform===include:include==='outsource'?!!entry.botKind:include==='channels'?entry.kind==='channel':include==='private'?entry.kind==='employee':include==='groups'?(entry.kind==='group'&&!entry.botKind):!!include&&entry.kind==='source'&&entry.platform===include&&entry.enabled!==false
export const inCategory=(folder:CategorySelection,entry:CategoryEntry)=>folder.conversations.includes(entry.key)||matchesCategory(folder.include,entry)&&!folder.excluded?.includes(entry.key)
export type SocialElement={id:string;key:string;channelId:string;platform:'telegram'|'x'|'youtube';name:string;locator:string;enabled:boolean;createdAt:number;unreadCount:number;postCount:number;firstUnread?:{id:string;kind:'news'};lastPost?:{id:string;title:string;publishedAt:number;sourceName:string};avatar?:{sourceId:string;sha256:string}}

/** Shared by the directory CLI and live UI; category names never confer a rule. */
export const CONVERSATION_TYPES=['all','outsource','private','groups','channels','telegram','x','youtube'] as const
export type ConversationType=typeof CONVERSATION_TYPES[number]
export const matchesConversationType=(type:ConversationType,entry:CategoryEntry)=>type==='all'||((type==='youtube'||type==='x'||type==='telegram')?entry.kind==='channel'&&entry.platform===type:type==='channels'?entry.kind==='channel':type==='outsource'?!!entry.botKind:type==='private'?entry.kind==='employee':type==='groups'?(entry.kind==='group'&&!entry.botKind):entry.kind==='source'&&entry.platform===type)
export const matchesConversationQuery=(query:string,...values:(string|undefined)[])=>values.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
/** Each social platform has one aggregate conversation; authors are filtered inside it. */
export function uniqueConversations<T extends CategoryEntry>(entries:T[]):T[]{
 return entries.filter(entry=>entry.kind!=='source'||!['youtube','x','telegram'].includes(entry.platform??''))
}
export const CONVERSATION_TYPE_LABELS:Record<ConversationType,string>={all:'All types',outsource:'Outsource',private:'Private chats',groups:'Groups',channels:'Channels',telegram:'Telegram channel',x:'X channel',youtube:'YouTube channel'}

/** Inbox sections: external Workers are kept apart from people, teams and channels. */
export const MESSAGE_SECTIONS=['outsource','private','groups','channels'] as const
export type MessageSection=typeof MESSAGE_SECTIONS[number]
export const MESSAGE_SECTION_LABELS:Record<MessageSection,string>={private:'Direct messages',groups:'Groups',channels:'Channels',outsource:'Outsource'}
/** Dot/Grok connections are group conversations carrying a bot kind, so they are classified first. */
export const messageSection=(entry:Pick<CategoryEntry,'kind'|'botKind'>):MessageSection=>entry.kind==='employee'?'private':entry.botKind?'outsource':entry.kind==='group'?'groups':'channels'
/** Stable section-major ordering; positions inside a section are preserved as given. */
export function orderBySection<T extends Pick<CategoryEntry,'kind'|'botKind'>>(entries:readonly T[]):T[]{
 return entries.map((entry,index)=>({entry,index})).sort((a,b)=>MESSAGE_SECTIONS.indexOf(messageSection(a.entry))-MESSAGE_SECTIONS.indexOf(messageSection(b.entry))||a.index-b.index).map(item=>item.entry)
}
