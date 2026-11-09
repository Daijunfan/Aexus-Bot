import {validateApiArguments} from './api-contract'
import {fileVersion} from './read-cache'
import {GROUP_ACCESS_APIS} from '../shared/group-access'
import {groupAccessRequest} from './group-access'
import {GROUP_HISTORY_APIS} from '../shared/group-history'
import {groupHistoryRequest} from './group-history'
import {resolveTeamView} from '../shared/team-views'
import {clientStore} from './client-state'
import {createHash,randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {atomicJson,readJson} from './atomic-file'
import {catalog,indexFile,directory,messages,historyFile,emitChatChange} from './chat-group-store'
import {requireConversation,controlChanged,auditConversation} from './conversation-policy'
import {requestContext} from './request-context'
import {readStore} from './store'
import {SingleFlight} from './single-flight'
import {GROUP_COLORS,groupDetails,type GroupTopic,type GroupPoll,type GroupChecklist,type ChecklistItem} from '../shared/group-collaboration'
import {effectiveChatMute,type ChatGroup,type ChatMessage} from '../shared/chat-groups'
import type {PrincipalRef} from '../shared/management'

type Vote={options:string[];at:number;by:PrincipalRef}
type Poll=Omit<GroupPoll,'options'|'voterCount'|'myOptions'|'resultsVisible'|'closed'>&{options:{id:string;label:string}[];votes:Record<string,Vote>;closedAt?:number;requestKey:string;fingerprint:string;viewId?:string}
type Checklist=GroupChecklist&{requestKey:string;fingerprint:string;viewId?:string}
type State={reactions?:Record<string,Record<string,{by:PrincipalRef;emojis:string[]}>>;pins?:Record<string,{at:number;by:PrincipalRef}>;version:1;topics:(GroupTopic&{requestKey?:string;fingerprint?:string})[];polls:Poll[];checklists:Checklist[]}
type Publisher=(args:Record<string,any>,card:{pollId?:string;checklistId?:string})=>Promise<ChatMessage>|ChatMessage
const flights=new SingleFlight<any>(),actor=()=>requestContext().principal,key=(value:unknown)=>JSON.stringify(value),same=(a:PrincipalRef,b:PrincipalRef)=>key(a)===key(b)
const hash=(value:unknown)=>createHash('sha256').update(key(value)).digest('hex')
export function validateGroupDraftScope(id:string,topicId?:string,threadId?:string){const value=current(id);if(topicId!==undefined){if(typeof topicId!=='string'||!data(value.group!).topics.some(topic=>topic.id===topicId))throw Error('Unknown group topic')}else if(typeof threadId!=='string'||!messages(id).some(message=>message.id===threadId))throw Error('Unknown message thread')}
function current(id:string,admin=false){const value=requireConversation('group:'+id,admin?'admin':'read');if(value.group?.bot)throw Error('Native Bot groups do not support local group administration');return value}
const file=(id:string)=>join(directory,id+'-collaboration.json')
function data(group:ChatGroup):State{return readJson(file(group.id),()=>({version:1,topics:[{id:'general',name:'General',icon:'💬',color:'violet',closed:false,pinned:true,archived:false,revision:1,createdAt:group.createdAt}],polls:[],checklists:[]}),value=>!!value&&(value as State).version===1&&Array.isArray((value as State).topics)&&Array.isArray((value as State).polls)&&Array.isArray((value as State).checklists))}
function save(id:string,value:State){atomicJson(file(id),value,true);emitChatChange(id)}
const memberName=(principal:PrincipalRef)=>principal.kind==='operator'?'You':readStore().sessions.find(card=>card.id===principal.employeeId&&!card.deleting)?.title??'Former member'
function editable(id:string,createdBy:PrincipalRef){if(!same(actor(),createdBy))current(id,true)}
function revision(expected:unknown,actual:number){if(expected!==actual)throw Error('Group content changed; reload before saving')}
function instant(value:unknown,future=false){if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value))throw Error('Use an ISO time with a timezone');const at=Date.parse(value);if(!Number.isFinite(at)||future&&at<=Date.now())throw Error('Choose a valid future time');return at}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error('Choose text up to '+max+' characters');return value.trim()}
function writeDetails(group:ChatGroup,patch:Record<string,any>){const store=catalog(),target=store.groups.find(g=>g.id===group.id)!;target.details={...groupDetails(target.details,target.id),...patch,revision:groupDetails(target.details,target.id).revision+1};target.revision++;target.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(group.id);controlChanged('group:'+group.id);return target}
export function groupOverview(id:string){const value=current(id),details=groupDetails(value.group!.details,id),state=data(value.group!),all=messages(id).filter(message=>!message.deletedAt);return {id,name:value.name,details,actorRole:requireConversation('group:'+id).role(actor().kind==='agent'?(actor() as {employeeId:string}).employeeId:'')??(actor().kind==='operator'?'operator':null),canManage:(()=>{try{current(id,true);return true}catch{return false}})(),memberCount:value.members.length,messageCount:all.length,topicCount:state.topics.filter(t=>!t.archived).length}}
export function requireGroupPosting(group:ChatGroup,args:Record<string,any>){
 const details=groupDetails(group.details,group.id),principal=actor();let admin=true;try{current(group.id,true)}catch{admin=false}
 const topicId=args.topicId??'general',topic=data(group).topics.find(t=>t.id===topicId)
 if(!topic||topic.archived)throw Error('Topic is unavailable')
 if(topic.closed&&!admin)throw Error('This topic is closed')
 if(!admin){
  if(!details.permissions.text&&args.text?.trim()&&!args.pollId&&!args.checklistId)throw Error('Text messages are disabled for members')
  if(!details.permissions.media&&(args.images?.length||args.files?.length))throw Error('Media sharing is disabled for members')
  if(details.slowModeSeconds){const last=[...messages(group.id)].reverse().find(m=>same(m.author,principal));if(last&&Date.now()<last.createdAt+details.slowModeSeconds*1000)throw Error('Slow mode: wait '+Math.ceil((last.createdAt+details.slowModeSeconds*1000-Date.now())/1000)+' seconds')}
 }
 return topicId==='general'?undefined:topicId
}
function mayCreate(id:string,kind:'topics'|'polls'){const value=current(id);try{current(id,true);return value}catch{}const principal=actor();if(!groupDetails(value.group!.details,id).permissions[kind])throw Error('Members cannot create '+kind+' in this group');if(principal.kind==='agent'&&effectiveChatMute(value.group!,principal.employeeId)!==undefined)throw Error('You are muted in this group');return value}
function published(groupId:string,messageId?:string,cardId?:string){const message=messages(groupId).find(m=>messageId?m.id===messageId:m.pollId===cardId||m.checklistId===cardId);if(!message||message.deletedAt)throw Error('The original message is unavailable')}
function pollView(poll:Poll):GroupPoll{
 const own=poll.votes[key(actor())],closed=!!poll.closedAt||!!poll.closesAt&&poll.closesAt<=Date.now(),visible=closed||!poll.hideResults
 const options=poll.options.map(option=>({id:option.id,label:option.label,votes:visible?Object.values(poll.votes).filter(v=>v.options.includes(option.id)).length:0,...(!poll.anonymous&&visible?{voters:Object.values(poll.votes).filter(v=>v.options.includes(option.id)).map(v=>({id:v.by.kind==='operator'?'operator':v.by.employeeId,name:memberName(v.by),at:v.at}))}:{})}))
 const {votes,requestKey,fingerprint,closedAt,correctOptions,explanation,viewId,...value}=poll
 let manager=true;try{editable(poll.groupId,poll.createdBy)}catch{manager=false}
 return {...value,allowedActions:[...(!closed?['vote']:[]),...(manager&&!closed?['close']:[])],options,closed,voterCount:Object.keys(votes).length,myOptions:own?.options??[],resultsVisible:visible,...(poll.quiz&&(closed||own&&!poll.hideResults)?{correctOptions,explanation}:{})}
}
const checklistView=(item:Checklist):GroupChecklist=>{const {requestKey,fingerprint,viewId,...value}=item;let manager=true;try{editable(item.groupId,item.createdBy)}catch{manager=false}return structuredClone({...value,allowedActions:[...(item.allowComplete||manager?['check']:[]),...(item.allowAdd||manager?['add']:[]),...(manager?['edit']:[])]})}
function items(group:ChatGroup,input:any[],previous:ChecklistItem[]=[]):ChecklistItem[]{
 const used=new Set<string>();return input.map((row:any)=>{const old=previous.find(item=>item.id===row.id);if(row.id&&!old&&!/^item_[a-f0-9-]{36}$/.test(row.id))throw Error('Choose a stable item_UUID identifier for new checklist items');const id=old?.id??row.id??'item_'+randomUUID();if(used.has(id))throw Error('Duplicate checklist item');used.add(id);if(row.assignee&&row.assignee!==old?.assignee&&!group.memberIds.includes(row.assignee))throw Error('Choose a current group member');return {id,text:text(row.text,500),...(row.assignee?{assignee:row.assignee}:{}),...(row.dueAt?{dueAt:instant(row.dueAt)}:{}),done:old?.done??false,...(old?.completedAt?{completedAt:old.completedAt,completedBy:old.completedBy}:{})}})
}
async function publish(id:string,object:Poll|Checklist,type:'poll'|'checklist',topicId:string|undefined,publisher:Publisher){
 if(object.messageId)return
 const title=type==='poll'?(object as Poll).question:(object as Checklist).title
 const message=await publisher({id,text:title,clientMessageId:type+':'+object.id,...(topicId?{topicId}:{}),...(object.viewId?{viewId:object.viewId}:{})},type==='poll'?{pollId:object.id}:{checklistId:object.id})
 object.messageId=message.id;emitChatChange(id,message.id,undefined,'metadata')
}
export const groupCollaborationVersion=(id:string)=>fileVersion(file(id))
export function groupContentAnnotations(group:ChatGroup){const state=data(group);return (messageId:string)=>{const reactions=new Map<string,{emoji:string;count:number;names:string[];my:boolean}>();for(const value of Object.values(state.reactions?.[messageId]??{}))for(const emoji of value.emojis){const row=reactions.get(emoji)??{emoji,count:0,names:[],my:false};row.count++;row.names.push(memberName(value.by));row.my||=same(value.by,actor());reactions.set(emoji,row)}return {reactions:[...reactions.values()],...(state.pins?.[messageId]?{pinnedAt:state.pins[messageId].at}:{})}}}
export async function groupCollaborationRequest(command:string,args:Record<string,any>,publisher:Publisher){
 validateApiArguments(command,args)
 if(GROUP_ACCESS_APIS.has(command))return groupAccessRequest(command,args)
 if(GROUP_HISTORY_APIS.has(command)){let projection:State|undefined;return groupHistoryRequest(command,args,message=>{const state=projection??(projection=data(current(String(args.id)).group!));const poll=state.polls.find(value=>value.id===message.pollId),checklist=state.checklists.find(value=>value.id===message.checklistId);return {...(poll?{poll:pollView(poll)}:{}),...(checklist?{checklist:checklistView(checklist)}:{})}})}
 const id=String(args.id),value=current(id),group=value.group!,details=groupDetails(group.details,group.id),state=data(group),op=command.slice('chat.'.length)
 if(op==='react'||op==='pin'){
  published(id,args.messageId)
  if(op==='react'){if(!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(args.emoji))throw Error('Choose an emoji reaction');state.reactions??={};const map=state.reactions[args.messageId]??={},identity=key(actor()),previous=map[identity],values=new Set(previous?.emojis??[]);if(args.selected)values.add(args.emoji);else values.delete(args.emoji);if(values.size>3)throw Error('Choose up to three reactions per message');if(key([...values])===key(previous?.emojis??[]))return groupContentAnnotations(group)(args.messageId);if(values.size)map[identity]={by:actor(),emojis:[...values]};else delete map[identity]}
  else{try{current(id,true)}catch{if(!details.permissions.pin)throw Error('Members cannot pin messages in this group')}state.pins??={};if(args.pinned)state.pins[args.messageId]??={at:Date.now(),by:actor()};else delete state.pins[args.messageId];auditConversation('group:'+id,'pin',{messageId:args.messageId,pinned:args.pinned})}
  save(id,state);emitChatChange(id,args.messageId,undefined,'metadata');return groupContentAnnotations(group)(args.messageId)
 }
 if(op==='details')return groupOverview(id)
 if(op==='thread'){
  const all=messages(id),byId=new Map(all.map(message=>[message.id,message]));let root=byId.get(args.messageId);if(!root)throw Error('Unknown group message')
  const parents=new Set<string>();while(root.replyTo&&byId.has(root.replyTo)&&!parents.has(root.id)){parents.add(root.id);root=byId.get(root.replyTo)!}
  const included=new Set([root.id]),replies=all.filter(message=>{if(message.id===root!.id)return false;if(message.replyTo&&included.has(message.replyTo)){included.add(message.id);return true}return false}),selected=replies.filter(message=>args.before===undefined||message.sequence<args.before),limit=args.limit??40,page=selected.slice(-limit)
  const topic=state.topics.find(topic=>topic.id===(root!.topicId??'general'));let admin=true;try{current(id,true)}catch{admin=false}
  return {root,replies:page,total:replies.length,canReply:!!topic&&!topic.archived&&(!topic.closed||admin),topicArchived:!!topic?.archived,nextBefore:selected.length>page.length?page[0].sequence:null}
 }
 if(op==='details-update'){
  current(id,true);revision(args.expectedRevision,details.revision);const patch={...args.patch};if(patch.permissions)patch.permissions={...details.permissions,...patch.permissions};if(patch.slowModeSeconds>0&&patch.slowModeSeconds<1||patch.autoDeleteSeconds>0&&patch.autoDeleteSeconds<60)throw Error('Auto-delete must be at least one minute')
  const store=catalog(),target=store.groups.find(g=>g.id===id)!;if(patch.name!==undefined){target.name=text(patch.name,80);delete patch.name}target.details={...details,...patch,revision:details.revision+1};target.revision++;target.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(id);controlChanged('group:'+id);auditConversation('group:'+id,'profile',{fields:Object.keys(args.patch)});return groupOverview(id)
 }
 if(op==='member-tag'){
  const principal=actor(),employee=args.employee??(principal.kind==='agent'?principal.employeeId:undefined);if(!employee||!value.members.includes(employee))throw Error('Choose a current group member');if(principal.kind!=='agent'||principal.employeeId!==employee)current(id,true)
  const tags={...details.memberTags};if(args.tag.trim())tags[employee]=args.tag.trim();else delete tags[employee];if(key(tags)===key(details.memberTags))return {employee,tag:tags[employee]??''};writeDetails(group,{memberTags:tags});return {employee,tag:tags[employee]??''}
 }
 if(op==='topic-list'){const all=messages(id);return state.topics.filter(t=>args.includeArchived||!t.archived).map(({requestKey,fingerprint,...topic})=>({...topic,messageCount:all.filter(m=>!m.deletedAt&&(m.topicId??'general')===topic.id).length,unread:(group.topicIncoming?.[topic.id]??(topic.id==='general'?group.lastIncomingSequence:0))>Math.max(group.readSequence,group.topicRead?.[topic.id]??0)}))}
 if(op==='topic-create'){
  mayCreate(id,'topics');if(!details.topicsEnabled){current(id,true);writeDetails(group,{topicsEnabled:true})}const name=text(args.name,80),requestKey=key([actor(),args.clientRequestId]),fingerprint=hash([name,args.icon??'💬',args.color??'violet']),prior=state.topics.find(t=>t.requestKey===requestKey)
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('Request ID already used for another topic');const {requestKey:_,fingerprint:__,...view}=prior;return view}
  const topic={id:'topic_'+randomUUID(),name,icon:args.icon??'💬',color:args.color??'violet',closed:false,pinned:false,archived:false,revision:1,createdAt:Date.now(),createdBy:actor(),requestKey,fingerprint};state.topics.push(topic);save(id,state);auditConversation('group:'+id,'topic-create',{topicId:topic.id,name});const {requestKey:_,fingerprint:__,...view}=topic;return view
 }
 if(op==='topic-update'){
  const topic=state.topics.find(t=>t.id===args.topicId);if(!topic)throw Error('Unknown topic');if(topic.createdBy)editable(id,topic.createdBy);else current(id,true);if(args.patch.pinned!==undefined)current(id,true);revision(args.expectedRevision,topic.revision);if(topic.id==='general'&&args.patch.archived)throw Error('General cannot be archived');Object.assign(topic,args.patch,{revision:topic.revision+1});save(id,state);auditConversation('group:'+id,'topic-update',{topicId:topic.id,...args.patch});const {requestKey:_,fingerprint:__,...view}=topic;return view
 }
 if(args.viewId!==undefined&&actor().kind!=='operator')throw Error('Agent publications use their current task view; viewId is user-only')
 const acceptedView=actor().kind==='operator'&&['poll-create','checklist-create'].includes(op)?resolveTeamView(clientStore(readStore()),args.viewId).id:undefined
 if(op==='poll-create'||op==='checklist-create')return flights.run(op+':'+id+':'+key([actor(),args.clientRequestId]),async()=>{
  const fresh=data(group),type=op==='poll-create'?'poll':'checklist',list=type==='poll'?fresh.polls:fresh.checklists,requestKey=key([actor(),args.clientRequestId]),spec=type==='poll'?args.spec:{title:args.title,items:args.items,allowAdd:args.allowAdd??true,allowComplete:args.allowComplete??true},previous=list.find(o=>o.requestKey===requestKey),viewId=args.viewId??(previous?previous.viewId:acceptedView),fingerprint=hash([spec,args.topicId??null,viewId]);let object=previous
  if(object&&object.fingerprint!==fingerprint)throw Error('Request ID already used with different content')
  if(object?.messageId){published(id,object.messageId);return type==='poll'?pollView(object as Poll):checklistView(object as Checklist)}
  mayCreate(id,'polls')
  if(!object){
   const base={id:type+'_'+randomUUID(),groupId:id,createdAt:Date.now(),createdBy:actor(),revision:1,requestKey,fingerprint,...(viewId?{viewId}:{})}
   if(type==='poll'){
    const labels=spec.options.map((o:any)=>text(o.label,200));if(new Set(labels).size!==labels.length)throw Error('Poll answers must be distinct');const correct=spec.correctOptions??[];if(spec.quiz&&(!correct.length||correct.some((n:number)=>n>=labels.length)||!spec.multiple&&correct.length!==1))throw Error('Choose the correct quiz answer');if(spec.quiz&&spec.openAnswers)throw Error('Quiz answers cannot be added after publication')
    object={...base,question:text(spec.question,1000),options:labels.map((label:string,n:number)=>({id:'option_'+n,label})),multiple:spec.multiple??false,anonymous:spec.anonymous??true,quiz:spec.quiz??false,revote:spec.revote??!spec.quiz,hideResults:spec.hideResults??false,openAnswers:spec.openAnswers??false,...(spec.closesAt?{closesAt:instant(spec.closesAt,true)}:{}),...(spec.quiz?{correctOptions:correct.map((n:number)=>'option_'+n),explanation:spec.explanation??''}:{}),votes:{}} as Poll;fresh.polls.push(object as Poll)
   }else{object={...base,title:text(args.title,200),editRevision:1,items:items(group,args.items),allowAdd:spec.allowAdd,allowComplete:spec.allowComplete};fresh.checklists.push(object as Checklist)}
   save(id,fresh)
  }
  if(type==='poll'&&(object as Poll).closesAt&&(object as Poll).closesAt!<=Date.now())throw Error('The poll deadline passed before publication. Choose a new closing time.')
  await publish(id,object,type,args.topicId,publisher);current(id);const latest=data(group),target=type==='poll'?latest.polls:latest.checklists,index=target.findIndex(o=>o.id===object!.id);target[index].messageId=object.messageId;save(id,latest)
  return type==='poll'?pollView(target[index] as Poll):checklistView(target[index] as Checklist)
 })
 if(op.startsWith('poll-')){
  const poll=state.polls.find(p=>p.id===args.pollId);if(!poll)throw Error('Unknown poll');published(id,poll.messageId,poll.id)
  if(op==='poll-get')return pollView(poll)
  if(pollView(poll).closed){if(op==='poll-close'){editable(id,poll.createdBy);return pollView(poll)}throw Error('This poll is closed')}
  if(op==='poll-close'){editable(id,poll.createdBy);revision(args.expectedRevision,poll.revision);poll.closedAt=Date.now()}
  else if(op==='poll-option'){
   if(!poll.openAnswers||poll.quiz||poll.options.length>=50)throw Error('This poll does not accept more answers');const label=text(args.label,200);const prior=poll.options.find(o=>o.label===label);if(prior)return pollView(poll);poll.options.push({id:'option_'+randomUUID(),label})
  }else{
   const selected=[...args.options].sort(),old=poll.votes[key(actor())];if(selected.some(v=>!poll.options.some(o=>o.id===v))||!poll.multiple&&selected.length>1)throw Error('Choose valid poll answers');if(old&&key(old.options)===key(selected))return pollView(poll);if(old&&!poll.revote)throw Error('This poll does not allow changing a vote');if(selected.length)poll.votes[key(actor())]={options:selected,at:Date.now(),by:actor()};else delete poll.votes[key(actor())]
  }
  poll.revision++;save(id,state);return pollView(poll)
 }
 if(op.startsWith('checklist-')){
  const item=state.checklists.find(c=>c.id===args.checklistId);if(!item)throw Error('Unknown checklist');published(id,item.messageId,item.id)
  if(op==='checklist-get')return checklistView(item)
  if(op==='checklist-check'){
   if(!item.allowComplete)editable(id,item.createdBy);const row=item.items.find(r=>r.id===args.itemId);if(!row)throw Error('Unknown checklist item');if(row.done===args.done)return checklistView(item);row.done=args.done;if(row.done){row.completedAt=Date.now();row.completedBy=actor()}else{delete row.completedAt;delete row.completedBy}
  }else{
   let owner=true;try{editable(id,item.createdBy)}catch{owner=false}const next=items(group,args.items,item.items)
   if(!owner&&(!item.allowAdd||args.title!==undefined||next.length<item.items.length||item.items.some((r,n)=>key(r)!==key(next[n]))))throw Error('Only the creator or group admin may edit existing checklist items');const title=args.title===undefined?item.title:text(args.title,200);if(title===item.title&&key(next)===key(item.items))return checklistView(item);revision(args.expectedEditRevision??args.expectedRevision,args.expectedEditRevision===undefined?item.revision:item.editRevision??1);item.items=next;item.title=title;item.editRevision=(item.editRevision??1)+1
  }
  item.revision++;save(id,state);return checklistView(item)
 }
 throw Error('Unknown group collaboration operation')
}
