import {MessageRichBody} from '../chat/MessageRichBody'
import {useDialogFocus} from '../office/useDialogFocus'
import {GroupStickerPicker} from './GroupStickerPicker'
import {GroupThread} from './GroupThread'
import {GroupPollCard,GroupChecklistCard,GroupCardComposer} from './GroupCards'
import type {CSSProperties} from 'react'
import {GroupHub} from './GroupHub'
import {GROUP_COLORS,groupDetails,type GroupTopic} from '../../../shared/group-collaboration'
import {ChatQuestionCard,PendingQuestions} from './ChatQuestions'
import {formatMessageClock,formatMessageDateTime} from '../message-time'
import {MessageAuthorAvatar} from './MessageIdentity'
import {MessageListAvatar,useMessageAvatarMotion} from './MessageListAvatar'
import {CanvasMotion} from '../office/motion'
import '../styles/group-message-layout.css'
import {useMentionPicker,mentionLabels,mentionTargets} from '../chat/useMentionPicker'
import {reuseDraft} from '../../../shared/message-drafts'
import {MessageViewport,type MessageViewportHandle} from '../chat/MessageViewport'
import {UnreadDivider} from '../chat/UnreadDivider'
import {MessageReceipt} from '../chat/MessageReceipt'
import {EditMessageComposer} from '../chat/EditMessageComposer'
import {emojiCount} from '../chat/messagePresentation'
import {VoiceRecorder} from '../chat/VoiceRecorder'
import {useAttachmentUploads,AttachmentTransfers,DraftFiles,MessageFile} from '../chat/MessageAttachments'
import {MessageImages,MessageGalleryContext,messageGalleryItems} from '../chat/MessageImage'
import {useReplyReference} from '../chat/useReplyReference'
import {ReplyPreview,replyAuthor} from '../chat/ReplyPreview'
import {QuoteSelection} from '../chat/QuoteSelection'
import {highlightQuote} from '../chat/quoteTextRange'
import {validateQuote,type MessageQuote} from '../../../shared/message-quotes'
import {useComposerHeight} from '../chat/useComposerHeight'
import {MotionStrip} from '../chat/MotionStrip'
import {messageGroups,useMessageMotion} from '../chat/messagePresentation'
import {ConversationNoticeBadge} from './ConversationNotice'
import {translate as uiText,useI18n} from '../i18n'
import {Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {ChatGroupView,ChatHistory,ChatMessage} from '../../../shared/chat-groups'
import type {Store,Session} from '../../../shared/types'
import {api} from '../api'
import {createRefreshQueue} from '../snapshot'
import {useVisibleReceipt,useReadAtBottom} from '../chat/useReplyRead'
import {BlockView} from '../chat/Chat'
import {Icon} from './Icon'
import {GroupEditor} from './GroupEditor'
import {MessageSelectionBar,MessageCheckbox} from './MessageSelectionBar'
import {ComposerTools} from './ComposerTools'
import {PinnedMessages} from './PinnedMessages'
import {useMessenger} from './useMessenger'
import {conversationKey,messageKey,groupDraftKey,type MessengerResults} from '../../../shared/messenger'
import {GroupAvatar} from './GroupAvatar'
import {BotAccessDialog,BotAppearanceDialog,BotAvatar,botProviderLabel} from './BotWorkers'
import {BotIssueNotice} from './BotIssueNotice'
import {ConversationSearch} from '../chat/ConversationSearch'
import {MessageActions,MessageDate} from '../chat/MessageActions'
export type GroupDraft={text:string;images?:string[];files?:string[];mentions:string[]|'all';clientMessageId:string;viewId?:string;replyTo?:string;replyQuote?:MessageQuote;replyConversation?:string;replyTextOnly?:boolean}
type GroupConversationProps={group:ChatGroupView;store:Store;sessions:Session[];drafts:Record<string,GroupDraft>;onBack:()=>void;onPrivate:(id:string)=>void}
export function GroupConversation(props:GroupConversationProps){return <GroupConversationScope key={props.group.id} {...props}/>}
function GroupConversationScope(props:GroupConversationProps){
 const messenger=useMessenger()!,memory='aexus-group-topic-'+props.group.id
 const [topicId,setTopicId]=useState(()=>{try{return sessionStorage.getItem(memory)??'all'}catch{return 'all'}})
 const select=async(id:string)=>{await messenger.flushDrafts();setTopicId(id);try{sessionStorage.setItem(memory,id)}catch{}}
 useEffect(()=>{if((messenger.jump?.conversation==='group:'+props.group.id||messenger.replyIntent?.conversation==='group:'+props.group.id)&&topicId!=='all')void select('all').catch(()=>{})},[messenger.jump,messenger.replyIntent,props.group.id])
 return <GroupConversationBody {...props} key={topicId} topicId={topicId} onTopic={select}/>
}
function GroupConversationBody({group,store,sessions,drafts,onBack,onPrivate,topicId,onTopic}:GroupConversationProps&{topicId:string;onTopic:(id:string)=>Promise<void>}){
  useI18n()
 const bot=group.bot,botMode=!!bot
 const avatarMotion=useMessageAvatarMotion()
 const thinkingMembers=useMemo(()=>bot?[]:group.members.flatMap(member=>{
  const active=sessions.some(session=>{
   const context=session.currentTask?.chat
   return (session.cardId??session.id)===member.id&&(session.busy||session.acknowledging)&&!session.approvals?.length&&context&&'groupId' in context&&context.groupId===group.id
  })
  const employee=active?store.sessions.find(card=>card.id===member.id&&!card.deleting):undefined
  return employee?[employee]:[]
 }),[bot,group.id,group.members,sessions,store.sessions])
 const thinkingKey=thinkingMembers.map(member=>member.id).join('/')
 const [accessOpen,setAccessOpen]=useState(false),[appearanceOpen,setAppearanceOpen]=useState(false)

 const messenger=useMessenger()!,conversation=conversationKey('group',group.id)
 const draftKey=groupDraftKey(conversation,topicId),draftSlot=draftKey===conversation?group.id:draftKey,topicQuery=topicId==='all'?{}:{topicId}
 const [stickersOpen,setStickersOpen]=useState(false),[removeTarget,setRemoveTarget]=useState<ChatMessage|null>(null),[removing,setRemoving]=useState(false),[threadId,setThreadId]=useState<string|null>(null),[groupInfoOpen,setGroupInfoOpen]=useState(false),[topics,setTopics]=useState<(GroupTopic&{unread?:boolean})[]>([]),[cardComposer,setCardComposer]=useState<'poll'|'checklist'|null>(null)
 useDialogFocus('.group-remove-confirm>div',!!removeTarget)
 const topicUnavailable=!!topics.find(topic=>topic.id===topicId)?.archived
 const scopeUnread=topicId==='all'?group.unread:(group.topicIncoming?.[topicId]??(topicId==='general'?group.lastIncomingSequence:0))>Math.max(group.readSequence,group.topicRead?.[topicId]??0)
 const initialAttachments=messenger.getDraft(draftKey)??drafts[draftSlot]
 const [images,setImages]=useState<string[]>(initialAttachments?.images??[]),[files,setFiles]=useState<string[]>(initialAttachments?.files??[]),attachments=useRef({images,files});attachments.current={images,files}
 const attachmentInput=useRef<HTMLInputElement>(null)
 const [returnToMessage,setReturnToMessage]=useState<string|undefined>(undefined)
 const [unreadAfter,setUnreadAfter]=useState<number|null>(null),positioned=useRef(false)
 const prependAnchor=useRef<{id:string;top:number}|null>(null)
 const [search,setSearch]=useState(false),[awayFromLatest,setAwayFromLatest]=useState(false)
 const [messageToEdit,setMessageToEdit]=useState<ChatMessage|null>(null),editLookup=useRef<symbol|null>(null),editReady=useRef(false),restoreComposer=useRef(false)
 const [history,setHistory]=useState<ChatMessage[]>([]),[before,setBefore]=useState<number|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[editing,setEditing]=useState(false),[sending,setSending]=useState(false),[older,setOlder]=useState(false)
 // Merge paged and targeted reads by request order, so late snapshots cannot roll back receipts.
 const loadedHistory=useRef(history),readOrder=useRef(0),messageReadOrder=useRef(new Map<string,number>());loadedHistory.current=history
 const mergeHistory=(messages:ChatMessage[],order:number)=>setHistory(previous=>{const map=new Map(previous.map(message=>[message.id,message]));for(const message of messages){if((messageReadOrder.current.get(message.id)??0)>order||(message.editRevision??0)<(map.get(message.id)?.editRevision??0))continue;messageReadOrder.current.set(message.id,order);map.set(message.id,message)}return [...map.values()].sort((a,b)=>a.sequence-b.sequence)})
 const [text,setText]=useState(initialAttachments?.text??''),[mentions,setMentions]=useState<string[]|'all'>(initialAttachments?.mentions??[]),[replyTo,setReplyTo]=useState<string|undefined>(initialAttachments?.replyTo)
 const [replyQuote,setReplyQuote]=useState<MessageQuote|undefined>(initialAttachments?.replyQuote)
 const [replyOrigin,setReplyOrigin]=useState<{conversation?:string;textOnly?:boolean}>({conversation:initialAttachments?.replyConversation,textOnly:initialAttachments?.replyTextOnly})
 const crossReference=useReplyReference(replyOrigin.conversation,replyTo,replyQuote,replyOrigin.textOnly)
 const localReplySource=history.find(message=>message.id===replyTo)
 const localQuoteChanged=useMemo(()=>{if(replyOrigin.conversation||!replyQuote||!localReplySource)return false;try{validateQuote(localReplySource.text,replyQuote);return false}catch{return true}},[replyOrigin.conversation,replyQuote,localReplySource?.text])
 const names=useMemo(()=>Object.fromEntries(store.sessions.map(card=>[card.id,card.title])),[store.sessions])
 const viewport=useRef<MessageViewportHandle|null>(null),transcript=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),follow=useRef(true),scrollTarget=useRef<number|null>(null),sendingRef=useRef(false),loadedInitial=useRef(false)
 const picker=useMentionPicker(composer,text,mentionLabels(mentions,group.members)),mentionMenu=picker.open,mentionIndex=picker.index,setMentionIndex=picker.setIndex
 useEffect(()=>{if(!messenger.ready||drafts[draftSlot])return;const saved=messenger.getDraft(draftKey);if(saved){setImages(saved.images??[]);setFiles(saved.files??[]);setText(saved.text);setMentions(saved.mentions??[]);setReplyTo(saved.replyTo);setReplyQuote(saved.replyQuote);setReplyOrigin({conversation:saved.replyConversation,textOnly:saved.replyTextOnly});drafts[draftSlot]={...saved,mentions:saved.mentions??[],clientMessageId:saved.clientMessageId??crypto.randomUUID()}}},[messenger.ready,group.id])
 useEffect(()=>{const intent=messenger.replyIntent;if(intent?.conversation!==conversation||topicId!=='all')return
  setMessageToEdit(null);editLookup.current=null
  setReplyTo(intent.source.id);setReplyQuote(intent.source.quote);setReplyOrigin({conversation:intent.source.conversation,textOnly:intent.textOnly});persistDraft({text,...attachments.current,mentions,replyTo:intent.source.id,replyQuote:intent.source.quote,replyConversation:intent.source.conversation,replyTextOnly:intent.textOnly});messenger.setReplyIntent(null)
 },[messenger.replyIntent,conversation])
 useEffect(()=>{const el=transcript.current;if(!el)return;const observer=new ResizeObserver(()=>{if(follow.current)viewport.current?.scrollToEnd();setAwayFromLatest(el.scrollHeight-el.clientHeight-el.scrollTop>80)});observer.observe(el);return()=>observer.disconnect()},[group.id])
 const conversationJump=messenger.jump?.conversation===conversation?messenger.jump:undefined
 const jumpLoaded=history.some(message=>message.id===conversationJump?.id)
 useLayoutEffect(()=>{
  const target=conversationJump;if(!target)return
  const controller=new AbortController();let marked:HTMLElement|null=null,clearQuote=()=>{},timer:ReturnType<typeof setTimeout>|undefined
  follow.current=false
  void (async()=>{
   if(!jumpLoaded){if(before){const order=++readOrder.current,page=await api.call<ChatHistory>('chat.history',{id:group.id,...topicQuery,before,limit:100});if(controller.signal.aborted)return;mergeHistory(page.messages,order);setBefore(page.nextBefore)}return}
   const el=await viewport.current?.scrollToMessage(target.id,{block:'center',signal:controller.signal});if(controller.signal.aborted||!el)return
   marked=el;setReturnToMessage(target.returnTo);el.dataset.messageJump='true'
   const source=loadedHistory.current.find(message=>message.id===target.id);clearQuote=target.quote&&source?highlightQuote(el,source.text,target.quote):()=>{}
   scrollTarget.current=transcript.current?.scrollTop??null
   timer=setTimeout(()=>{delete el.dataset.messageJump;clearQuote();messenger.setJump(current=>current===target?null:current)},2400)
  })().catch(cause=>{if(!controller.signal.aborted)setError((cause as Error).message)})
  return()=>{controller.abort();clearTimeout(timer);clearQuote();if(marked)delete marked.dataset.messageJump}
 },[conversationJump,jumpLoaded,group.id,before])
 const messageAuthor=(id:string)=>{const message=history.find(item=>item.id===id);return message?.author.kind==='operator'?uiText('You'):message?.authorName}
 const memberName=(id:string)=>group.members.find(member=>member.id===id)?.title??store.sessions.find(card=>card.id===id)?.title??uiText('Former member')
 const draftFor=(value:Omit<GroupDraft,'clientMessageId'>):GroupDraft=>reuseDraft(value,messenger.getDraft(draftKey)??drafts[draftSlot],'group')
 const persistDraft=(value:Omit<GroupDraft,'clientMessageId'>)=>{const draft=draftFor(value);drafts[draftSlot]=draft;messenger.scheduleDraft(draftKey,draft)}
 const saveDraft=(value:string,targets:string[]|'all',reply=replyTo,quote:MessageQuote|null=replyQuote??null,origin=replyOrigin)=>persistDraft({text:value,...attachments.current,mentions:targets,replyTo:reply,replyQuote:quote??undefined,replyConversation:origin.conversation,replyTextOnly:origin.textOnly})
 const uploads=useAttachmentUploads(conversation,(_conversation,path,kind)=>{const next={...attachments.current,[kind==='image'?'images':'files']:[...attachments.current[kind==='image'?'images':'files'],path]};attachments.current=next;setImages(next.images);setFiles(next.files);saveDraft(text,mentions)},images.length+files.length)
 editReady.current=!messageToEdit&&!sending&&!mentionMenu&&text===''&&!replyTo&&mentions!=='all'&&!mentions.length&&!images.length&&!files.length&&!uploads.jobs.length
 useEffect(()=>()=>{editLookup.current=null},[])
 const startEdit=(message:ChatMessage)=>{editLookup.current=null;picker.close();setMessageToEdit(message)}
 const closeEdit=()=>{restoreComposer.current=true;setMessageToEdit(null)}
 useLayoutEffect(()=>{if(!messageToEdit&&restoreComposer.current){restoreComposer.current=false;composer.current?.focus()}},[messageToEdit])
 const editLatest=async()=>{
  if(!editReady.current||editLookup.current)return
  const own=[...history].reverse().find(message=>message.author.kind==='operator'&&!messenger.state.messages[messageKey(conversation,message.id)]?.hidden)
  if(own){startEdit(own);return}
  const ticket=Symbol();editLookup.current=ticket
  const current=()=>editLookup.current===ticket&&editReady.current&&composer.current?.value===''&&document.activeElement===composer.current
  try{const results=await api.call<MessengerResults>('messenger.search',{conversation,...topicQuery,author:'you',limit:1}),target=results.messages[0];if(!current()||!target)return;const page=await api.call<ChatHistory>('chat.history',{id:group.id,...topicQuery,around:target.id,limit:1}),message=page.messages.find(item=>item.id===target.id);if(current()&&message?.author.kind==='operator')startEdit(message)}
  catch(cause){if(current())setError((cause as Error).message)}finally{if(editLookup.current===ticket)editLookup.current=null}
 }
 const selectTopic=async(id:string)=>{if(uploads.pending)throw Error('Wait for attachments to finish uploading before switching topics.');await onTopic(id)}
 const attachFiles=(selected:File[])=>{if(topicUnavailable){setError('This topic is archived. Reopen it from Group info to reply.');return}try{uploads.add(selected)}catch(cause){setError((cause as Error).message)}}
 const handledAttachment=useRef('')
 useEffect(()=>{const request=messenger.attachmentRequest;if(!request||request.conversation!==conversation||handledAttachment.current===request.id)return;handledAttachment.current=request.id;attachFiles(request.files);messenger.setAttachmentRequest(previous=>previous?.id===request.id?null:previous)},[messenger.attachmentRequest,conversation])
 const removeAttachment=(path:string)=>{const next={images:images.filter(value=>value!==path),files:files.filter(value=>value!==path)};attachments.current=next;setImages(next.images);setFiles(next.files);saveDraft(text,mentions)}
 const cancelGroupReply=()=>{setReplyTo(undefined);setReplyQuote(undefined);setReplyOrigin({});persistDraft({text,...attachments.current,mentions});composer.current?.focus()}
 const chooseReply=(message:ChatMessage,quote?:MessageQuote)=>{messenger.setJump(null);setReplyTo(message.id);setReplyQuote(quote);setReplyOrigin({});saveDraft(text,mentions,message.id,quote??null,{});composer.current?.focus()}
 const changeText=(value:string)=>{const targets=mentionTargets(value,mentions,group.members);setText(value);setMentions(targets);saveDraft(value,targets)}
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined,messageTimer:ReturnType<typeof setTimeout>|undefined
  const changed=new Set<string>()
  const refreshChanged=createRefreshQueue(async()=>{if(!alive)return;const ids=[...changed];changed.clear();await Promise.all(ids.map(async id=>{const order=messageReadOrder.current.get(id)!;try{const page=await api.call<ChatHistory>('chat.history',{id:group.id,...topicQuery,around:id,limit:1});if(alive)mergeHistory(page.messages,order)}catch(cause){if(alive&&messageReadOrder.current.get(id)===order)setLoadError((cause as Error).message)}}))})
  const refresh=createRefreshQueue(async()=>{if(!alive)return;try{const order=++readOrder.current,[page,reading]=await Promise.all([api.call<ChatHistory>('chat.history',{id:group.id,...topicQuery,limit:100}),loadedInitial.current?Promise.resolve(null):api.call<ChatGroupView>('chat.get',{id:group.id,...topicQuery})]);if(alive){mergeHistory(page.messages,order);if(!loadedInitial.current){setBefore(page.nextBefore);setUnreadAfter(reading?.unread?reading.readSequence:null);loadedInitial.current=true};setLoadError('')}}catch(cause){if(alive)setLoadError((cause as Error).message)}finally{if(alive)setLoading(false)}})
  void refresh()
  const off=api.onEvent(event=>{
   if(event.channel==='client:connected'){void refresh();return}
   if(event.channel!=='chat:changed'||event.payload.id!==group.id)return
   const id=event.payload.editedMessageId??event.payload.messageId
   if(id){if(!loadedHistory.current.some(message=>message.id===id))return;messageReadOrder.current.set(id,++readOrder.current);changed.add(id);if(!messageTimer)messageTimer=setTimeout(()=>{messageTimer=undefined;void refreshChanged()},35);return}
   if(!timer)timer=setTimeout(()=>{timer=undefined;void refresh()},35)
  })
  return()=>{alive=false;off();clearTimeout(timer);clearTimeout(messageTimer)}
 },[group.id])
 const firstUnread=unreadAfter===null?undefined:history.find(message=>message.sequence>unreadAfter&&message.author.kind==='agent'&&!messenger.state.messages[messageKey(conversation,message.id)]?.hidden)?.id
 useEffect(()=>{if(loadedInitial.current&&unreadAfter===null&&group.unread&&!follow.current)setUnreadAfter(group.readSequence)},[group.unread,group.lastIncomingSequence,group.readSequence,unreadAfter])
 useLayoutEffect(()=>{
  if(loading||positioned.current||!history.length)return
  if(!firstUnread||conversationJump){positioned.current=true;return}
  const controller=new AbortController();follow.current=false
  void viewport.current?.scrollToMessage(firstUnread,{block:'start',signal:controller.signal}).then(row=>{const el=transcript.current;if(controller.signal.aborted||!row||!el)return;const marker=(row.closest('.group-message-row')??row).previousElementSibling;if(marker?.matches('[data-unread-boundary]'))el.scrollTop+=marker.getBoundingClientRect().top-el.getBoundingClientRect().top-14;scrollTarget.current=el.scrollTop;positioned.current=true;setAwayFromLatest(el.scrollHeight-el.clientHeight-el.scrollTop>80)})
  return()=>controller.abort()
 },[loading,firstUnread,!!history.length,conversationJump])
 useLayoutEffect(()=>{const el=transcript.current;if(!el)return;if(follow.current)viewport.current?.scrollToEnd();setAwayFromLatest(el.scrollHeight-el.clientHeight-el.scrollTop>80)},[history,loading,thinkingKey])
 const bubbleGroups=useMemo(()=>messageGroups(history.map(message=>({id:message.id,author:(message.author.kind==='agent'?message.author.employeeId:'operator')+':'+message.kind,time:message.createdAt,breakBefore:message.id===firstUnread,break:!!messenger.state.messages[messageKey(conversation,message.id)]?.hidden||!!message.replyTo}))),[history,messenger.state.messages,conversation,firstUnread])
 const motionItems=useMemo(()=>history.map(message=>({id:message.id,outgoing:message.author.kind==='operator',text:message.text})),[history])
 const markLatestRead=async(passive=false)=>{const last=loadedHistory.current.at(-1);if(last){const result=await api.call<{acknowledged:boolean}>('chat.acknowledge',{id:group.id,...topicQuery,messageId:last.id});if(!result.acknowledged){if(passive)return;throw Error(uiText('Activate this window before marking messages as read.'))}}if(!await messenger.conversations([conversation],{unread:false}) )throw Error(uiText('Could not update the unread reminder. Try again.'));setUnreadAfter(null)}
 const bottomReadError=useReadAtBottom(transcript,group.id,!loading&&!threadId&&!groupInfoOpen&&!editing&&!search&&!messenger.library&&!messenger.forward&&!conversationJump&&!!(scopeUnread||messenger.state.conversations[conversation]?.unread),markLatestRead)
 const prepareMessageSend=useMessageMotion({conversation,ready:!loading,items:motionItems,transcript,composer,following:()=>follow.current})
 const galleryImages=useMemo(()=>history.filter(message=>!message.deletedAt&&!messenger.state.messages[messageKey(conversation,message.id)]?.hidden).flatMap(message=>messageGalleryItems({group:group.id,messageId:message.id},(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path),message.text)),[history,group.id,messenger.state.messages])
 const searchItems=useMemo(()=>history.map(message=>({id:message.id,text:message.text,images:message.attachments?.map(file=>file.path)})),[history])
 useComposerHeight(composer,text,!messageToEdit,group.id)
 const newest=history.at(-1)
 // Native replies carry no outgoing delivery marker; employee messages sent through Aexus do not.
 const isBotReply=(message:ChatMessage)=>!!botMode&&!message.bot?.delivery&&(!!message.bot?.remoteId||message.author.kind==='agent'&&message.author.employeeId===group.id)
 const botWaiting=(()=>{if(!botMode||bot?.issue?.code==='GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT')return false;const outgoing=[...history].reverse().find(message=>!isBotReply(message)&&(message.author.kind==='operator'||message.author.kind==='agent'));if(!outgoing||outgoing.bot?.failure||(outgoing.bot?.delivery!=='accepted'&&outgoing.bot?.delivery!=='sending'))return false;return !history.some(message=>isBotReply(message)&&(outgoing.bot?.turnId&&message.bot?.turnId?message.bot.turnId===outgoing.bot.turnId:message.sequence>outgoing.sequence))})()
 useVisibleReceipt(transcript,newest&&scopeUnread?{key:group.id+':'+newest.id,selector:`[data-group-read="${newest.id}"]`,command:'chat.acknowledge',args:{id:group.id,...topicQuery,messageId:newest.id}}:undefined,messenger.ready&&!threadId&&!groupInfoOpen&&!editing&&!messenger.library,group.id)
 // Prefixes can move out of the old first row; retain its visible message after measurements settle.
 useLayoutEffect(()=>{
  const anchor=prependAnchor.current,el=transcript.current;if(!anchor||!el)return
  let frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
   prependAnchor.current=null
   const row=Array.from(el.querySelectorAll<HTMLElement>('[data-chat-item]')).find(row=>row.dataset.chatItem===anchor.id)
   if(row){const box=el.getBoundingClientRect(),scale=box.height/parseFloat(getComputedStyle(el).height)||1;el.scrollTop+=(row.getBoundingClientRect().top-box.top)/scale-anchor.top;scrollTarget.current=el.scrollTop}
  })});return()=>cancelAnimationFrame(frame)
 },[history])
 const loadOlder=async()=>{if(!before||older)return;setOlder(true);const el=transcript.current,top=el?.scrollTop??0,height=el?.scrollHeight??0;follow.current=false;try{const order=++readOrder.current,page=await api.call<ChatHistory>('chat.history',{id:group.id,...topicQuery,before,limit:100});if(el&&viewport.current?.managed){const box=el.getBoundingClientRect(),scale=box.height/parseFloat(getComputedStyle(el).height)||1,row=Array.from(el.querySelectorAll<HTMLElement>('[data-chat-item]')).find(row=>row.getBoundingClientRect().bottom>box.top);if(row)prependAnchor.current={id:row.dataset.chatItem!,top:(row.getBoundingClientRect().top-box.top)/scale}}mergeHistory(page.messages,order);setBefore(page.nextBefore);setLoadError('');if(!viewport.current?.managed)requestAnimationFrame(()=>{if(el)el.scrollTop=top+el.scrollHeight-height})}catch(cause){setLoadError((cause as Error).message)}finally{setOlder(false)}}
 const send=async()=>{
  if(topicUnavailable||!text.trim()&&!images.length&&!files.length||uploads.pending||sendingRef.current||crossReference.loading)return
  if(localQuoteChanged){setError(uiText('Selected text changed. Choose a new quote.'));return}
  if(replyOrigin.conversation&&!crossReference.reply){setError(uiText('Original message unavailable'));return}
  if(!botMode&&picker.active){setError('Choose a member from the mention menu before sending.');return}
  sendingRef.current=true;setSending(true);setError('');follow.current=true;viewport.current?.scrollToEnd()
  const draft=draftFor({text,images,files,mentions,replyTo,replyQuote,replyConversation:replyOrigin.conversation,replyTextOnly:replyOrigin.textOnly});draft.viewId??=store.activeTeamViewId??'all';drafts[draftSlot]=draft
  let cancelMotion:(()=>void)|undefined
  try{
   await messenger.prepareSend(draftKey,draft)
   cancelMotion=prepareMessageSend(draft.text)
   await api.call('chat.send',{id:group.id,...topicQuery,...draft,text:draft.text.trim()});cancelMotion=undefined
   if(!await messenger.clearDraft(draftKey,draft.clientMessageId)){setError('Message was sent, but its draft could not be cleared.');return}
   if(drafts[draftSlot]?.clientMessageId===draft.clientMessageId){
    const remaining=messenger.getDraft(draftKey)
    if(remaining)drafts[draftSlot]={...remaining,mentions:remaining.mentions??[],clientMessageId:remaining.clientMessageId??crypto.randomUUID()};else delete drafts[draftSlot]
    setText(remaining?.text??'');setImages(remaining?.images??[]);setFiles(remaining?.files??[]);setMentions(remaining?.mentions??[]);setReplyTo(remaining?.replyTo);setReplyQuote(remaining?.replyQuote);setReplyOrigin({conversation:remaining?.replyConversation,textOnly:remaining?.replyTextOnly});setReturnToMessage(undefined);follow.current=true
   }
  }catch(cause){cancelMotion?.();setError((cause as Error).message)}finally{sendingRef.current=false;setSending(false);composer.current?.focus()}
 }
 useEffect(()=>{if(botMode)return;let active=true;const refresh=createRefreshQueue(async()=>{const value=await api.call<GroupTopic[]>('chat.topic-list',{id:group.id,includeArchived:true});if(active)setTopics(value)});void refresh().catch(cause=>setError(cause.message));const off=api.onEvent(event=>{if(event.channel==='chat:changed'&&event.payload.id===group.id)void refresh().catch(cause=>setError(cause.message))});return()=>{active=false;off()}},[group.id,botMode])
 const term=picker.query
 const choices=[{id:'all',title:'All members',group:''},...group.members].filter(member=>member.id==='all'?!term||'all'.includes(term)||uiText('All members').toLowerCase().includes(term):member.title.toLowerCase().includes(term))
 const selectMention=(id:string)=>{const next=picker.consume(id==='all'?'all':memberName(id)),value=mentionTargets(next,id==='all'?'all':mentions==='all'?[id]:[...new Set([...mentions,id])],group.members);setText(next);setMentions(value);saveDraft(next,value)}
 return <div className="group-conversation" data-group-id={group.id} style={!botMode?{'--group-accent':GROUP_COLORS[groupDetails(group.details,group.id).color]} as CSSProperties:undefined}>
  <header className="message-thread-header"><button className="message-back" aria-label={uiText("Back to conversations")} onClick={onBack}><Icon name="arrow-left"/></button>{botMode?(bot!.provider==='dots'?<button type="button" className="message-header-avatar bot-header-avatar" aria-label={uiText("Dot native appearance")} onClick={()=>setAppearanceOpen(true)}><BotAvatar provider={bot!.provider} bot={bot} state={botWaiting?"working":"idle"}/></button>:<span className="message-header-avatar bot-header-avatar"><BotAvatar provider={bot!.provider} bot={bot} state={botWaiting?"working":"idle"}/></span>):<button className="group-header-profile" aria-label={uiText('Group info')} title={uiText('Group info')} onClick={()=>setGroupInfoOpen(true)}><GroupAvatar group={group} store={store}/></button>}<button className="group-title" title={botMode?undefined:uiText("Everyone receives every message. Replies and mentions identify the main participants; public replies are optional.")} onClick={()=>{if(botMode)setAccessOpen(true);else setGroupInfoOpen(true)}}><strong>{group.name}</strong><small>{botMode?<>{botProviderLabel(bot!.provider)} <b>·</b> {uiText('Worker')}{bot!.kind==='group'&&<> <b>·</b> {uiText('Group')}</>}</>:<>{uiText("{0} members",[group.members.length])}{group.ownerId&&<> · {uiText("Group owner")}: {store.sessions.find(card=>card.id===group.ownerId)?.title??"—"}</>}</>}</small></button><div className="message-thread-actions"><button data-message-search-trigger aria-label={uiText("Search conversation")} title={uiText("Search conversation · {0} F",[api.platform==='macos'?'⌘':uiText("Ctrl")])} aria-expanded={search} onClick={()=>setSearch(!search)}><Icon name="search"/></button><button aria-label={uiText("Group shared content")} title={uiText("Shared media, files and links")} onClick={()=>messenger.setLibrary({conversation,filter:'files',...(topicId!=='all'?{topicId}:{})})}><Icon name="file-text"/></button>{botMode?<button aria-label={uiText('Authorized people')} title={uiText('Employee access permissions')} aria-expanded={accessOpen} aria-haspopup="dialog" onClick={()=>setAccessOpen(true)}><Icon name="organization"/></button>:<button type="button" className="group-manage" aria-label={uiText("Manage group")} title={uiText("Group settings")} aria-expanded={editing} aria-haspopup="dialog" onClick={()=>setEditing(true)}><Icon name="settings-gear"/></button>}</div></header>
  {!botMode&&<PendingQuestions conversation={conversation}/>}
  <MessageSelectionBar conversation={conversation} messages={searchItems}/>
  <PinnedMessages conversation={conversation}/>
  {!botMode&&(group.details?.topicsEnabled||topicId!=='all')&&<nav className="group-topic-bar" aria-label={uiText('Group topics')}><button aria-pressed={topicId==='all'} onClick={()=>void selectTopic('all').catch(cause=>setError(cause.message))}><Icon name="list-unordered"/>{uiText('All topics')}</button>{topics.filter(topic=>!topic.archived||topic.id===topicId).map(topic=><button key={topic.id} aria-label={topic.id==='general'&&topic.name==='General'?uiText('General'):topic.name} aria-pressed={topicId===topic.id} style={{'--topic-color':GROUP_COLORS[topic.color]} as CSSProperties} onClick={()=>void selectTopic(topic.id).catch(cause=>setError(cause.message))}><span>{topic.icon}</span>{topic.id==='general'&&topic.name==='General'?uiText('General'):topic.name}{topic.closed&&<Icon name="lock"/>}{topic.unread&&<i aria-label={uiText('Unread')}/>}</button>)}</nav>}
  {topicUnavailable&&<div className="group-context-note"><Icon name="lock"/><span>{uiText('This topic is archived. Reopen it from Group info to reply.')}</span><button onClick={()=>setGroupInfoOpen(true)}>{uiText('Group info')}</button></div>}
  {botMode?<>{bot!.issue&&<BotIssueNotice issue={bot!.issue}/>} {bot!.connection==='error'&&<div className="group-context-note bot-connection-note" role="status"><Icon name="info"/><span>{uiText('Bot connection error. New replies may be delayed.')}</span></div>}</>:null}
  <ConversationSearch topicId={topicId!=='all'?topicId:undefined} conversation={conversation} open={search} onOpen={setSearch} items={searchItems} transcript={transcript} onReveal={async(id,signal)=>{follow.current=false;return await viewport.current?.scrollToMessage(id,{block:'center',signal})??null}} onNavigate={gap=>{follow.current=gap<5;if(gap<5)scrollTarget.current=transcript.current?.scrollTop??null;setAwayFromLatest(gap>80)}}/>
  <MessageGalleryContext.Provider value={{images:galleryImages,history:{conversation}}}><div className="group-transcript" ref={transcript} tabIndex={0} aria-label={uiText('Group messages')} onScroll={event=>{const el=event.currentTarget;const gap=el.scrollHeight-el.clientHeight-el.scrollTop;if(!conversationJump&&positioned.current&&Math.abs(el.scrollTop-(scrollTarget.current??-Infinity))>1)follow.current=gap<5;if(gap<5&&follow.current)scrollTarget.current=el.scrollTop;setAwayFromLatest(gap>80)}} onWheel={event=>{if(event.deltaY<0)follow.current=false}}>
   {before&&<button className="group-load-older" disabled={older} onClick={()=>void loadOlder()}>{older?uiText("Loading…"):uiText("Load earlier messages")}</button>}
   {!history.length&&<div className="group-empty"><GroupAvatar group={group} store={store} large/><h2>{loading?uiText("Loading conversation…"):uiText("Welcome to {0}",[group.name])}</h2><p>{botMode?uiText('No messages yet. Send a message to start.'):<>{uiText("Share an update, ask a question, or mention a teammate.")}<br/>{uiText("Everyone stays informed. Reply or @mention to address someone.")}</>}</p></div>}
   <MessageViewport items={history} scrollRef={transcript} apiRef={viewport} following={()=>follow.current} onProgrammaticScroll={top=>{scrollTarget.current=top}} renderItem={(message,index)=>messenger.state.messages[messageKey(conversation,message.id)]?.hidden?<div key={message.id} className="message-hidden" data-chat-item={message.id}><Icon name="eye-closed"/>{uiText("Message hidden for you")}<button onClick={()=>void messenger.message(conversation,message.id,{hidden:false})}>{uiText("Show message")}</button></div>:<Fragment key={message.id}>{(!index||new Date(history[index-1].createdAt).toDateString()!==new Date(message.createdAt).toDateString())&&<MessageDate value={message.createdAt}/>}{message.id===firstUnread&&<UnreadDivider earlier={before!==null&&unreadAfter!==null&&history[0].sequence>unreadAfter+1?()=>void loadOlder():undefined} loading={older}/>}<div className={`group-message-row ${(botMode?isBotReply(message):message.author.kind==='agent')?'is-incoming':'is-outgoing'}`} data-bubble-group={bubbleGroups.get(message.id)}>
    {botMode&&isBotReply(message)?<span className="message-author-avatar bot-message-avatar" aria-label={uiText(botProviderLabel(bot!.provider)+' Bot')}><BotAvatar provider={bot!.provider} bot={bot}/></span>:<MessageAuthorAvatar author={message.author} authorName={message.authorName} store={store}/>}
    <article data-sticker={!message.text&&message.attachments?.length===1&&message.attachments[0].kind==='image'&&message.attachments[0].name.startsWith('sticker-')||undefined} data-emoji-count={!message.reply&&!message.replyTo&&!message.attachments?.length&&!message.mentions.length?emojiCount(message.text):undefined} data-bubble-group={bubbleGroups.get(message.id)} data-selecting={messenger.selection?.conversation===conversation||undefined} data-selected={messenger.selection?.conversation===conversation&&messenger.selection.ids.includes(message.id)||undefined} onClickCapture={event=>{if(messenger.selection?.conversation===conversation&&!(event.target as Element).closest('.message-select-toggle')){event.preventDefault();event.stopPropagation();messenger.toggleSelection(conversation,message.id)}}} data-chat-item={message.id} className={`group-message ${(botMode?isBotReply(message):message.author.kind==='agent')?'from-employee':'from-user'}`} data-group-message={message.id}>
    <MessageCheckbox conversation={conversation} id={message.id}/><div className="group-message-heading"><strong>{botMode&&isBotReply(message)?(bot!.kind==='group'?message.authorName:botProviderLabel(bot!.provider)):message.author.kind==='operator'?uiText('You'):message.authorName}</strong>{!['message','summary'].includes(message.kind)&&!message.pollId&&!message.checklistId&&<span className={`group-kind kind-${message.kind}`}>{uiText(message.kind)}</span>}</div>
    {message.reply?<ReplyPreview reply={message.reply} author={replyAuthor(message.reply,'',names)} onNavigate={()=>void messenger.navigate({conversation:message.reply!.conversation!,id:message.reply!.id,quote:message.reply!.quote},{conversation,id:message.id})}/>:message.replyTo&&<button className="group-reply-link" onClick={()=>messenger.setJump({conversation,id:message.replyTo!,returnTo:message.id,quote:message.replyQuote})}>{uiText("Replying to")} {messageAuthor(message.replyTo)??uiText("an earlier message")}{message.replyQuote&&<small>{message.replyQuote.text}</small>}</button>}
    <ConversationNoticeBadge notice={message.notice}/>{message.deletedAt?<div className="group-message-removed"><Icon name="trash"/>{uiText('Message removed')}<button onClick={()=>void api.call('chat.message-restore',{id:group.id,messages:[{id:message.id,expectedRevision:message.editRevision??0}]}).catch(cause=>setError(cause.message))}>{uiText('Restore')}</button></div>:message.pollId?<GroupPollCard groupId={group.id} id={message.pollId}/>:message.checklistId?<GroupChecklistCard group={group} id={message.checklistId}/>:message.questionId?<ChatQuestionCard id={message.questionId} fallback={message.text}/>:<MessageRichBody group={group.id} text={message.text} paths={(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path)} messageId={message.id}/>}{!message.deletedAt&&(message.pollId||message.checklistId||message.questionId)&&<MessageImages group={group.id} paths={(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path)} messageId={message.id} caption={message.text}/>}{!message.deletedAt&&message.attachments?.filter(file=>file.kind==='file').map(file=><MessageFile messageId={message.id} key={file.path} conversation={conversation} file={file}/>)}
    {botMode&&message.bot?.delivery==='uncertain'&&<p className="bot-delivery-uncertain" role="status">{uiText('Delivery unconfirmed. Check history before resending.')}</p>}
    {botMode&&message.bot?.failure&&<BotIssueNotice issue={message.bot.failure} inline/>}
    <div className="message-time message-time-with-receipt">{message.editedAt&&<time className="message-edited" dateTime={new Date(message.editedAt).toISOString()} title={formatMessageDateTime(message.editedAt,true)}>{uiText('Edited')}</time>}<time dateTime={new Date(message.createdAt).toISOString()} title={formatMessageDateTime(message.createdAt,true)}>{formatMessageClock(message.createdAt)}</time><MessageReceipt deliveries={message.deliveries} onRetry={async employeeIds=>{const result=await api.call<{message:ChatMessage;retriedEmployeeIds:string[];skippedEmployeeIds:string[]}>('chat.retry',{id:group.id,messageId:message.id,employeeIds});mergeHistory([result.message],++readOrder.current);if(!result.retriedEmployeeIds.length&&result.skippedEmployeeIds.length)throw Error(uiText('Some deliveries may have already started. Open their private conversations before sending again.'))}} memberName={memberName} onOpenRecipient={onPrivate} canOpenRecipient={id=>store.sessions.some(card=>card.id===id&&!card.deleting)}/></div>
    {!botMode&&!message.deletedAt&&!!message.replyCount&&<button className="group-thread-link" aria-label={uiText('Open thread')} onClick={()=>setThreadId(message.id)}><Icon name="comment-discussion"/>{uiText('{0} replies',[message.replyCount??0])}<Icon name="chevron-right"/></button>}
    {!message.deletedAt&&<MessageActions sharedGroup={!botMode?group.id:undefined} reactions={message.reactions} sharedPinned={!!message.pinnedAt} protectedContent={group.details?.protectedContent} onThread={!botMode?()=>setThreadId(message.id):undefined} onRemove={!botMode?()=>setRemoveTarget(message):undefined} conversation={conversation} id={message.id} images={message.attachments?.length??0} text={message.text} onReply={messageToEdit?undefined:()=>chooseReply(message)} onEdit={!botMode&&!message.pollId&&!message.checklistId&&!message.questionId&&message.author.kind==='operator'&&!sending&&!messageToEdit?()=>startEdit(message):undefined} onPrivate={message.author.kind==='agent'&&store.sessions.some(card=>message.author.kind==='agent'&&card.id===message.author.employeeId&&!card.deleting)?()=>{if(message.author.kind==='agent')onPrivate(message.author.employeeId)}:undefined}/>}
    {message.id===newest?.id&&<span className="reply-seen-marker" data-group-read={message.id}/>}
   </article></div></Fragment>}/>
   {botWaiting&&<div className="group-message-row is-incoming group-typing-row bot-waiting" role="status" aria-label={uiText('Waiting for bot reply')}>
    <span className="message-author-avatar bot-message-avatar" aria-hidden="true"><BotAvatar provider={bot!.provider} bot={bot} state="working"/></span>
    <div className="group-message from-employee group-typing-bubble"><div className="group-message-heading"><strong>{uiText(botProviderLabel(bot!.provider)+' Bot')}</strong></div><span className="group-typing-dots" aria-hidden="true"><i/><i/><i/></span></div>
   </div>}
   {!!thinkingMembers.length&&<CanvasMotion.Provider value={avatarMotion}><div className="group-thinking-members" data-animate={avatarMotion}>
    {thinkingMembers.map(employee=><div className="group-message-row is-incoming group-typing-row" key={employee.id} data-typing-employee={employee.id}>
     <span className="message-author-avatar" aria-hidden="true"><MessageListAvatar avatar={employee.avatar} color={employee.color} state="working" continuous/></span>
     <div className="group-message from-employee group-typing-bubble" role="status" aria-label={`${employee.title} · ${uiText('Working…')}`}>
      <div className="group-message-heading"><strong>{employee.title}</strong></div>
      <span className="group-typing-dots" aria-hidden="true"><i/><i/><i/></span>
     </div>
    </div>)}
   </div></CanvasMotion.Provider>}
  </div></MessageGalleryContext.Provider>
  {!messageToEdit&&<QuoteSelection container={transcript} messages={history.map(message=>({id:message.id,source:message.text}))} identity={group.id} onQuote={(id,quote)=>{const message=history.find(message=>message.id===id);if(message)chooseReply(message,quote)}}/>}
  <div className="group-composer" onDragOver={event=>{if([...event.dataTransfer.items].some(item=>item.kind==='file')){event.preventDefault();event.dataTransfer.dropEffect=messageToEdit?'none':'copy'}}} onDrop={event=>{const selected=[...event.dataTransfer.files];if(selected.length){event.preventDefault();event.stopPropagation();if(!messageToEdit)attachFiles(selected)}}}>
   {messenger.navigationReturn?.viewing===conversation?<button className="message-jump-latest message-return-reply" onClick={()=>void messenger.navigate(messenger.navigationReturn!.from,undefined,conversation)}><Icon name="arrow-left"/> {uiText('Back to reply')}</button>:returnToMessage?<button className="message-jump-latest message-return-reply" onClick={()=>{messenger.setJump({conversation,id:returnToMessage});setReturnToMessage(undefined)}}><Icon name="arrow-left"/> {uiText('Back to reply')}</button>:awayFromLatest&&<button className="message-jump-latest" onClick={()=>{follow.current=true;viewport.current?.scrollToEnd();setAwayFromLatest(false);void bottomReadError.acknowledge()}}><Icon name="arrow-down"/>  {uiText("Latest messages")}</button>}
   {messageToEdit?<EditMessageComposer key={messageToEdit.id} groupId={group.id} message={messageToEdit} onCancel={closeEdit} onSaved={updated=>{setHistory(previous=>previous.map(message=>message.id===updated.id&&(message.editRevision??0)<=(updated.editRevision??0)?updated:message));closeEdit()}}/>:<>
   {(error||loadError||bottomReadError.error)&&<p className="group-error" role="alert">{uiText(error||loadError||bottomReadError.error)}{bottomReadError.error&&<button type="button" onClick={()=>void bottomReadError.acknowledge()}>{uiText('Retry')}</button>}</p>}
   {replyTo&&replyOrigin.conversation?<ReplyPreview reply={crossReference.reply} author={crossReference.reply?replyAuthor(crossReference.reply,'',names):uiText('Original message')} unavailable={crossReference.loading?uiText('Loading quoted message…'):crossReference.error?uiText(crossReference.error):undefined} onNavigate={crossReference.reply?()=>void messenger.navigate({conversation:replyOrigin.conversation!,id:replyTo,quote:replyQuote},undefined,conversation):undefined} onElsewhere={crossReference.reply?()=>messenger.setReplyTarget({conversation:replyOrigin.conversation!,id:replyTo,quote:replyQuote,text:crossReference.reply!.text,images:(crossReference.reply!.omittedImages??0)+(crossReference.reply!.omittedFiles??0)}):undefined} onCancel={cancelGroupReply}/>:replyTo&&<MotionStrip className="group-replying"><button className="group-reply-source" aria-label={uiText('Go to original message')} onClick={()=>messenger.setJump({conversation,id:replyTo,quote:replyQuote})}><strong>{replyQuote?uiText("Quoting"):uiText("Replying to")} {messageAuthor(replyTo)??uiText("a message")}</strong><small role={localQuoteChanged?'alert':undefined}>{localQuoteChanged?uiText('Selected text changed. Choose a new quote.'):replyQuote?.text??localReplySource?.text}</small></button><button className="message-reply-elsewhere" aria-label={uiText('Reply in another conversation')} title={uiText('Reply in another conversation')} onClick={()=>messenger.setReplyTarget({conversation,id:replyTo,quote:replyQuote,text:replyQuote?.text??history.find(message=>message.id===replyTo)?.text??'',images:history.find(message=>message.id===replyTo)?.attachments?.length??0})}><Icon name="arrow-swap"/></button><button aria-label={uiText("Cancel group reply")} onClick={cancelGroupReply}>×</button></MotionStrip>}
   <DraftFiles conversation={conversation} images={images} files={files} onRemove={removeAttachment}/><AttachmentTransfers uploads={uploads}/>
   <div className="group-compose-box">
    <input ref={attachmentInput} type="file" multiple hidden aria-label={uiText('Choose attachments')} onChange={event=>{const selected=[...event.target.files??[]];event.target.value='';attachFiles(selected)}}/><button className="message-attach" aria-label={uiText('Attach files')} title={uiText('Attach files')} disabled={sending||topicUnavailable} onClick={()=>attachmentInput.current?.click()}><Icon name="attach"/></button><VoiceRecorder conversation={conversation} disabled={sending||topicUnavailable} onRecorded={file=>uploads.add([file])}/>
    {!botMode&&mentionMenu&&<div className="group-mention-menu" role="listbox" aria-label={uiText("Mention group members")}>{choices.map((member,index)=><button role="option" aria-selected={index===mentionIndex} key={member.id} onMouseDown={event=>event.preventDefault()} onClick={()=>selectMention(member.id)}><Icon name={member.id==='all'?'organization':'person'}/><span>{member.id==='all'?uiText('All members'):member.title}<small>{member.id==='all'?uiText("{0} employees",[group.members.length]):member.group+' · '+uiText('Existing conversation')}</small></span></button>)}{!choices.length&&<p>{uiText("No matching members.")}</p>}</div>}
    <textarea ref={composer} {...picker.inputProps} onPaste={event=>{const selected=[...event.clipboardData.items].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(selected.length){event.preventDefault();attachFiles(selected)}}} aria-label={uiText("Group message")} placeholder={botMode?uiText("Message {0}…",[group.name]):uiText("Message {0} · type @ to mention",[group.name])} value={text} rows={1} disabled={sending} readOnly={topicUnavailable} onChange={event=>{changeText(event.currentTarget.value);picker.sync(event.currentTarget)}} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(!botMode&&mentionMenu&&['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Escape')picker.close();else if((event.key==='Enter'||event.key==='Tab')&&choices[mentionIndex])selectMention(choices[mentionIndex].id);else setMentionIndex(index=>(index+(event.key==='ArrowUp'?-1:1)+choices.length)%Math.max(1,choices.length));return}if(event.key==='Escape'&&replyTo){event.preventDefault();event.stopPropagation();cancelGroupReply();return}if(!botMode&&event.key==='ArrowUp'&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&editReady.current){event.preventDefault();void editLatest();return}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}}/>
    <button className="group-send" aria-label={uiText("Send group message")} disabled={sending||topicUnavailable||uploads.pending||crossReference.loading||localQuoteChanged||!!(replyOrigin.conversation&&!crossReference.reply)||!text.trim()&&!images.length&&!files.length} onClick={()=>void send()}>{sending?<span className="spinner"/>:<Icon name="arrow-up"/>}</button>
   </div>
   <footer><ComposerTools input={composer} value={text} onChange={changeText} disabled={sending||topicUnavailable}/>{!botMode&&<span className="group-collaboration-tools"><button aria-label={uiText('Stickers')} title={uiText('Local stickers')} disabled={sending||topicUnavailable} onClick={()=>setStickersOpen(true)}><Icon name="smiley"/></button><button aria-label={uiText('New poll')} title={uiText('New poll')} disabled={sending||topicUnavailable} onClick={()=>setCardComposer('poll')}><Icon name="graph"/><span>{uiText('Poll')}</span></button><button aria-label={uiText('New checklist')} title={uiText('New checklist')} disabled={sending||topicUnavailable} onClick={()=>setCardComposer('checklist')}><Icon name="checklist"/><span>{uiText('Checklist')}</span></button></span>}{!botMode&&<><button aria-label={uiText("Mention a member")} onClick={picker.toggle}>{uiText("@ Mention")}</button><button onClick={()=>selectMention('all')}>{uiText("@ All")}</button></>}{!botMode&&<span>{uiText('Everyone receives this · Public replies optional')}</span>}</footer>
   </>}
  </div>
  {removeTarget&&<div className="group-remove-confirm" onClick={event=>{if(event.target===event.currentTarget&&!removing)setRemoveTarget(null)}} onKeyDown={event=>{if(event.key==='Escape'&&!removing){event.preventDefault();event.stopPropagation();setRemoveTarget(null)}}} role="alertdialog" aria-label={uiText('Remove message for everyone')}><div><Icon name="trash"/><h3>{uiText('Remove this message for everyone?')}</h3><p>{uiText('You can restore it from Group settings. Employee work and original files are kept.')}</p><footer><button disabled={removing} onClick={()=>setRemoveTarget(null)}>{uiText('Cancel')}</button><button className="danger" disabled={removing} onClick={()=>{setRemoving(true);void api.call('chat.message-trash',{id:group.id,messages:[{id:removeTarget.id,expectedRevision:removeTarget.editRevision??0}]}).then(()=>setRemoveTarget(null)).catch(cause=>setError(cause.message)).finally(()=>setRemoving(false))}}>{uiText(removing?'Removing…':'Remove for everyone')}</button></footer></div></div>}
  {threadId&&<GroupThread key={threadId} group={group} messageId={threadId} store={store} onClose={()=>setThreadId(null)}/>}
  {stickersOpen&&<GroupStickerPicker onClose={()=>setStickersOpen(false)} onSelect={file=>attachFiles([file])}/>}
  {cardComposer&&<GroupCardComposer group={group} kind={cardComposer} topicId={topicId} onClose={()=>setCardComposer(null)}/>}
  {!botMode&&groupInfoOpen&&<GroupHub group={group} store={store} onClose={()=>setGroupInfoOpen(false)} onManage={()=>setEditing(true)} onPrivate={onPrivate} onTopic={selectTopic}/>}
  {!botMode&&editing&&<GroupEditor group={group} store={store} onClose={()=>setEditing(false)} onSaved={()=>setEditing(false)}/>}
  {botMode&&appearanceOpen&&<BotAppearanceDialog id={group.id} onClose={()=>setAppearanceOpen(false)}/>}{botMode&&accessOpen&&<BotAccessDialog id={group.id} name={group.name} onClose={()=>setAccessOpen(false)}/>}
 </div>
}
