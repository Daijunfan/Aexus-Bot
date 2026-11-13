import {useMessageMotion} from '../chat/messagePresentation'
import {MessageRichBody} from '../chat/MessageRichBody'
import {ChatQuestionCard} from './ChatQuestions'
import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import type {ChatGroupView,ChatMessage} from '../../../shared/chat-groups'
import type {Store} from '../../../shared/types'
import {groupDraftKey,type MessageDraft} from '../../../shared/messenger'
import {reuseDraft} from '../../../shared/message-drafts'
import {api} from '../api'
import {createRefreshQueue} from '../snapshot'
import {translate as t,useI18n} from '../i18n'
import {formatMessageDateTime} from '../message-time'
import {BlockView} from '../chat/Chat'
import {useAttachmentUploads,DraftFiles,AttachmentTransfers,MessageFile} from '../chat/MessageAttachments'
import {MessageImages,MessageGalleryContext,messageGalleryItems} from '../chat/MessageImage'
import {VoiceRecorder} from '../chat/VoiceRecorder'
import {useReadAtBottom} from '../chat/useReplyRead'
import {useComposerHeight} from '../chat/useComposerHeight'
import {useMessenger} from './useMessenger'
import {ComposerTools} from './ComposerTools'
import {MessageAuthorAvatar} from './MessageIdentity'
import {GroupPollCard,GroupChecklistCard} from './GroupCards'
import {Icon} from './Icon'
import {MessageWorkspace} from './MessageWorkspace'
import '../styles/group-thread.css'

type Thread={canReply:boolean;topicArchived:boolean;root:ChatMessage;replies:ChatMessage[];total:number;nextBefore:number|null}
type Props={group:ChatGroupView;messageId:string;store:Store;onClose:()=>void}
export function GroupThread(props:Props){
 const [initial,setInitial]=useState<Thread|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let alive=true;void api.call<Thread>('chat.thread',{id:props.group.id,messageId:props.messageId,limit:100}).then(value=>{if(alive){setInitial(value);setError('')}}).catch(cause=>alive&&setError(cause.message));return()=>{alive=false}},[props.group.id,props.messageId,retry])
 return initial?<GroupThreadBody key={initial.root.id} {...props} messageId={initial.root.id} initialPage={initial}/>:<MessageWorkspace className="group-thread-panel" title={t('Thread')} label={t('Message thread')} subtitle={props.group.name} icon="comment-discussion" closeLabel={t('Close thread')} onClose={props.onClose}><p className="group-card-error" role={error?'alert':'status'}>{t(error||'Loading…')}</p>{error&&<button onClick={()=>setRetry(value=>value+1)}>{t('Retry')}</button>}</MessageWorkspace>
}
function GroupThreadBody({group,messageId,store,onClose,initialPage}:Props&{initialPage:Thread}){
 useI18n()
 const messenger=useMessenger()!,conversation='group:'+group.id,key=groupDraftKey(conversation,undefined,messageId)
 const initial=messenger.getDraft(key),[draft,setDraft]=useState<Partial<MessageDraft>>(initial??{text:''}),current=useRef(draft);current.current=draft
 const [page,setPage]=useState<Thread|null>(initialPage),[error,setError]=useState(''),[busy,setBusy]=useState(false),[older,setOlder]=useState(false),alive=useRef(true),inFlight=useRef(false),hydrated=useRef(!!initial),transcript=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),fileInput=useRef<HTMLInputElement>(null),following=useRef(true),rows=useRef<ChatMessage[]>([])
 const images=draft.images??[],files=draft.files??[]
 const persist=(patch:Partial<MessageDraft>)=>{const value=reuseDraft({...current.current,text:current.current.text??'',...patch},messenger.getDraft(key),'group');current.current=value;setDraft(value);messenger.scheduleDraft(key,value)}
 const uploads=useAttachmentUploads(conversation,(_scope,path,kind)=>persist({[kind==='image'?'images':'files']:[...(current.current[kind==='image'?'images':'files']??[]),path]}),images.length+files.length)
 useEffect(()=>{if(!messenger.ready||hydrated.current)return;hydrated.current=true;const value=messenger.getDraft(key);if(value){current.current=value;setDraft(value)}},[messenger.ready,key])
 useEffect(()=>{alive.current=true;const refresh=createRefreshQueue(async()=>{const next=await api.call<Thread>('chat.thread',{id:group.id,messageId,limit:100});if(!alive.current)return;setPage(old=>{if(!old)return next;const merged=new Map([...old.replies,...next.replies].map(message=>[message.id,message]));return {...next,replies:[...merged.values()].sort((a,b)=>a.sequence-b.sequence),nextBefore:old.nextBefore===null?null:old.nextBefore}});setError('')});void refresh().catch(cause=>setError(cause.message));const off=api.onEvent(event=>{if(event.channel==='chat:changed'&&event.payload.id===group.id)void refresh().catch(cause=>alive.current&&setError(cause.message))});return()=>{alive.current=false;off()}},[group.id,messageId])
 const all=page?[page.root,...page.replies]:[];rows.current=all
 const prepareSendMotion=useMessageMotion({conversation:key,ready:!!page,items:all.map(message=>({id:message.id,outgoing:message.author.kind==='operator',text:message.text})),transcript,composer:input,following:()=>following.current})
 const read=async()=>{const messageIds=rows.current.slice(-200).map(message=>message.id);if(messageIds.length)await api.call('chat.acknowledge',{id:group.id,messageIds})}
 const reading=useReadAtBottom(transcript,key,!!page,read)
 useLayoutEffect(()=>{if(following.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight},[page])
 useComposerHeight(input,draft.text??'',true,key,true)
 const close=async()=>{if(inFlight.current)return;if(uploads.pending){setError('Wait for attachments to finish uploading before closing this thread.');return}try{await messenger.flushDrafts();onClose()}catch(cause){setError((cause as Error).message)}}
 const send=async()=>{
  if(!page?.canReply||inFlight.current||uploads.pending||!current.current.text?.trim()&&!images.length&&!files.length)return
  inFlight.current=true;setBusy(true);setError('');following.current=true
  const value=reuseDraft({...current.current,text:current.current.text??'',replyTo:page.root.id,viewId:current.current.viewId??store.activeTeamViewId??'all'},messenger.getDraft(key),'group')
  let cancelMotion:(()=>void)|undefined
  try{
   await messenger.prepareSend(key,value);cancelMotion=prepareSendMotion(value.text)
   await api.call('chat.send',{id:group.id,text:value.text.trim(),images:value.images,files:value.files,replyTo:page.root.id,clientMessageId:value.clientMessageId,viewId:value.viewId,...(page.root.topicId?{topicId:page.root.topicId}:{})})
   cancelMotion=undefined
   const clearing=messenger.clearDraft(key,value.clientMessageId),remaining=messenger.getDraft(key)
   if(alive.current){current.current=remaining??{text:''};setDraft(current.current)}
   if(!await clearing&&alive.current)setError('Reply was sent, but its draft could not be cleared.')
  }catch(cause){cancelMotion?.();if(alive.current)setError((cause as Error).message)}finally{inFlight.current=false;if(alive.current){setBusy(false);input.current?.focus()}}
 }

 const loadOlder=async()=>{if(!page?.nextBefore||older)return;setOlder(true);const el=transcript.current,oldHeight=el?.scrollHeight??0,oldTop=el?.scrollTop??0;following.current=false;try{const next=await api.call<Thread>('chat.thread',{id:group.id,messageId,before:page.nextBefore,limit:100});setPage(old=>old?{...old,replies:[...new Map([...next.replies,...old.replies].map(message=>[message.id,message])).values()].sort((a,b)=>a.sequence-b.sequence),nextBefore:next.nextBefore}:next);requestAnimationFrame(()=>{if(el)el.scrollTop=oldTop+el.scrollHeight-oldHeight})}catch(cause){setError((cause as Error).message)}finally{setOlder(false)}}
 const addFiles=(items:File[])=>{if(!page?.canReply)return;try{uploads.add(items)}catch(cause){setError((cause as Error).message)}}
 return <MessageWorkspace className="group-thread-panel" title={t('Thread')} label={t('Message thread')} subtitle={group.name+' · '+t('{0} replies',[page?.total??0])} icon="comment-discussion" closeLabel={t('Close thread')} onClose={()=>void close()} busy={busy} scroll={false} footer={<>   <div className="group-thread-compose" onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='copy'}} onDrop={event=>{event.preventDefault();addFiles([...event.dataTransfer.files])}}>
    {page&&!page.canReply&&<p className="group-thread-readonly"><Icon name="lock"/>{t(page.topicArchived?'This topic is archived. Reopen it from Group info to reply.':'This topic is closed.')}</p>}
    {(error||reading.error)&&<p className="group-card-error" role="alert">{t(error||reading.error)}</p>}<DraftFiles conversation={conversation} images={images} files={files} onRemove={path=>persist({images:images.filter(value=>value!==path),files:files.filter(value=>value!==path)})}/><AttachmentTransfers uploads={uploads}/>
    <div><input type="file" multiple hidden ref={fileInput} onChange={event=>{addFiles([...event.target.files??[]]);event.target.value=''}}/><button title={t('Attach files')} aria-label={t('Attach files')} disabled={busy||!page?.canReply} onClick={()=>fileInput.current?.click()}><Icon name="attach"/></button><VoiceRecorder conversation={conversation} disabled={busy||!page?.canReply} onRecorded={file=>addFiles([file])}/><textarea ref={input} aria-label={t('Reply in thread')} placeholder={t('Reply in this thread…')} value={draft.text??''} disabled={busy||!messenger.ready} readOnly={!page?.canReply} rows={1} onChange={event=>persist({text:event.target.value})} onPaste={event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();addFiles(files)}}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();void send()}}}/><button className="group-thread-send" aria-busy={busy} aria-label={t('Send thread reply')} disabled={busy||!page?.canReply||uploads.pending||!draft.text?.trim()&&!images.length&&!files.length} onClick={()=>void send()}>{busy?<span className="spinner"/>:<Icon name="arrow-up"/>}</button></div>
    <footer><ComposerTools input={input} value={draft.text??''} onChange={value=>persist({text:value})} disabled={busy}/><span>{t('Thread draft saved separately')}</span></footer>
   </div>
</>}>
   <MessageGalleryContext.Provider value={{images:all.filter(message=>!message.deletedAt).flatMap(message=>messageGalleryItems({group:group.id,messageId:message.id},(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path),message.text))}}><div className="group-thread-messages" ref={transcript} tabIndex={0} aria-label={t('Thread messages')} onScroll={event=>{const el=event.currentTarget;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<5}}>
    {page?.nextBefore&&<button className="group-thread-older" disabled={older} onClick={()=>void loadOlder()}>{t(older?'Loading…':'Earlier replies')}</button>}
    {!page&&!error&&<p role="status">{t('Loading…')}</p>}
    {all.map((message,index)=>message.deletedAt?<p key={message.id} className="group-message-withdrawn" data-chat-item={message.id} data-thread-message={message.id}>{t(message.deletedBy?'Message withdrawn':'Message expired')}</p>:<article key={message.id} data-chat-item={message.id} data-thread-message={message.id} data-root={index===0}>
     <header><MessageAuthorAvatar author={message.author} authorName={message.authorName} store={store}/><div><strong>{message.author.kind==='operator'?t('You'):message.authorName}</strong><small>{formatMessageDateTime(message.createdAt)}{index===0?' · '+t('Original message'):''}</small></div></header>
     <>{message.pollId?<GroupPollCard groupId={group.id} id={message.pollId}/>:message.checklistId?<GroupChecklistCard group={group} id={message.checklistId}/>:message.questionId?<ChatQuestionCard id={message.questionId} fallback={message.text}/>:<MessageRichBody group={group.id} text={message.text} paths={(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path)} messageId={message.id}/>}{(message.pollId||message.checklistId||message.questionId)&&<MessageImages group={group.id} paths={(message.attachments??[]).filter(file=>file.kind==='image').map(file=>file.path)} messageId={message.id} caption={message.text}/>}{message.attachments?.filter(file=>file.kind==='file').map(file=><MessageFile key={file.path} conversation={conversation} messageId={message.id} file={file}/>)}</>
     <button className="group-thread-reveal" onClick={()=>{messenger.setJump({conversation,id:message.id});void close()}}><Icon name="go-to-file"/>{t('Go to message')}</button>
    </article>)}
    {page&&!page.replies.length&&<div className="group-thread-empty"><Icon name="comment-discussion"/><strong>{t('Keep this discussion together')}</strong><p>{t('Replies here stay attached to the original message.')}</p></div>}
   </div></MessageGalleryContext.Provider>
 </MessageWorkspace>
}
