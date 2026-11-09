import {TaskQueue} from './TaskQueue'
import {ComposerActions} from './ComposerActions'
import {useComposerHeight} from '../chat/useComposerHeight'
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction,type RefObject} from 'react'
import type {Item,Session,StoredSession,Store} from '../../../shared/types'
import {employeeReady,PERMISSION_MODES,teamSettings} from '../../../shared/types'
import {ENGINE_DEFINITIONS} from '../../../shared/engines'
import {activeModel,modelEfforts,enginePermissionModes} from '../../../shared/engine-commands'
import {draftContent,reuseDraft} from '../../../shared/message-drafts'
import {api} from '../api'
import {retainEqual} from '../snapshot'
import {translate as uiText} from '../i18n'
import {Turn} from '../chat/Chat'
import {MessageViewport,type MessageViewportHandle} from '../chat/MessageViewport'
import {useReplyRead} from '../chat/useReplyRead'
import {useAttachmentUploads,AttachmentTransfers,DraftFiles} from '../chat/MessageAttachments'
import {MessageAvatar} from './MessageView'
import {EmployeeWorkbench} from './ConversationBody'
import {ScrollArea} from './ScrollArea'
import {Icon} from './Icon'
import {AppSelect} from './AppSelect'
import {AgentApproval} from './AgentApproval'
import {useMessenger} from './useMessenger'
import {workDraftKey,type MessageDraft} from '../../../shared/messenger'

export type BoardDraft=Omit<MessageDraft,'updatedAt'|'images'|'files'>&{images:string[];files:string[];sending?:boolean;error?:string;reviewAttempt?:boolean}
export type BoardDrafts=Record<string,BoardDraft>
export type SetBoardDrafts=Dispatch<SetStateAction<BoardDrafts>>
const EMPTY_DRAFT:BoardDraft={text:'',images:[],files:[]}
export function useBoardVisible(root:RefObject<HTMLElement|null>,enabled:boolean){
 const [visible,setVisible]=useState(false)
 useEffect(()=>{if(!enabled||!root.current)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{root:root.current.closest('.agent-board-scroll'),rootMargin:'120px'});observer.observe(root.current);return()=>observer.disconnect()},[enabled])
 return enabled&&visible
}

export function AgentBoardPanel({card,live,enabled,hidden=false,drafts,setDrafts,onOpen,store}:{card:StoredSession;live?:Session;enabled:boolean;hidden?:boolean;drafts:BoardDrafts;setDrafts:SetBoardDrafts;onOpen:()=>void;store:Store}){
 const root=useRef<HTMLElement>(null),visible=useBoardVisible(root,enabled),liveRef=useRef(live);liveRef.current=live
 const [mounted,setMounted]=useState(false);useEffect(()=>{if(visible)setMounted(true)},[visible])
 const [session,setSession]=useState<Session>(),[history,setHistory]=useState<Item[]>([]),[loadError,setLoadError]=useState(''),[actionError,setActionError]=useState(''),[loading,setLoading]=useState(true),[pending,setPending]=useState(false)
 const messenger=useMessenger()!,key='employee:'+card.id,savedKey=workDraftKey(card.id),sending=useRef(false),status=useRef(drafts[key]);status.current=drafts[key]
 const draft={...EMPTY_DRAFT,...messenger.state.drafts[savedKey],sending:status.current?.sending,error:status.current?.error,reviewAttempt:status.current?.reviewAttempt}
 const change=useCallback((patch:Partial<BoardDraft>|((value:BoardDraft)=>BoardDraft))=>{
  const before={...EMPTY_DRAFT,...messenger.getDraft(savedKey),sending:status.current?.sending,error:status.current?.error,reviewAttempt:status.current?.reviewAttempt},next=typeof patch==='function'?patch(before):{...before,...patch}
  const {sending,error,reviewAttempt,updatedAt:_,...value}=next as BoardDraft&{updatedAt?:number}
  if(typeof patch==='function'||Object.keys(patch).some(key=>!['sending','error','reviewAttempt'].includes(key)))messenger.scheduleDraft(savedKey,value)
  status.current={...EMPTY_DRAFT,sending,error,reviewAttempt};setDrafts(previous=>({...previous,[key]:status.current!}))
 },[key,savedKey,setDrafts,messenger.getDraft,messenger.scheduleDraft])
 const transcript=useRef<HTMLDivElement>(null),viewport=useRef<MessageViewportHandle|null>(null),following=useRef(true),programmaticTop=useRef<number|undefined>(undefined),input=useRef<HTMLTextAreaElement>(null),fileInput=useRef<HTMLInputElement>(null)
 useComposerHeight(input,draft.text,mounted)
 const loadRef=useRef(()=>Promise.resolve())
 useEffect(()=>{
  if(!visible)return
  let disposed=false,inflight=false,again=false,timer:ReturnType<typeof setTimeout>|undefined
  const load=async()=>{
   if(disposed)return
   if(inflight){again=true;return}
   inflight=true
   try{
    const id=liveRef.current?.id
    if(id){const value=await api.call<Session>('session.snapshot',{id});if(!disposed){setSession(previous=>retainEqual(previous,value));setHistory([])}}
    else{const value=await api.call<{items:Item[]}>('session.transcript',{id:card.id});if(!disposed){setSession(undefined);setHistory(previous=>retainEqual(previous,value.items))}}
    if(!disposed)setLoadError('')
   }catch(cause){if(!disposed)setLoadError((cause as Error).message)}
   finally{inflight=false;if(!disposed)setLoading(false);if(again&&!disposed){again=false;void load()}}
  }
  loadRef.current=load;void load()
  const off=api.onEvent(event=>{if(event.channel!=='client:connected'&&(!event.channel.startsWith('session:')||event.payload?.sessionId&&event.payload.sessionId!==liveRef.current?.id))return;if(!timer)timer=setTimeout(()=>{timer=undefined;void load()},80)})
  return()=>{disposed=true;loadRef.current=()=>Promise.resolve();off();clearTimeout(timer)}
 },[visible,card.id,live?.id])
 const active=session?.id===live?.id?session:undefined,items=active?.items??history,busy=live?.busy??active?.busy??false,ready=employeeReady(card)&&messenger.ready,locked=pending||!!draft.sending
 const uploads=useAttachmentUploads(key,(_conversation,path,kind)=>{const field=kind==='image'?'images':'files';change(value=>({...value,[field]:[...new Set([...value[field],path])],clientMessageId:undefined,viewId:undefined,error:undefined}))},draft.images.length+draft.files.length)
 const addFiles=(files:File[])=>{setActionError('');try{uploads.add(files)}catch(cause){setActionError((cause as Error).message)}}
 const run=async(action:()=>Promise<unknown>)=>{setPending(true);setActionError('');try{await action()}catch(cause){setActionError((cause as Error).message)}finally{setPending(false);void loadRef.current()}}
 const send=async()=>{
  if(sending.current||locked||uploads.pending||!ready||(!draft.text.trim()&&!draft.images.length&&!draft.files.length))return
  const {sending:_,error:__,reviewAttempt:___,updatedAt:____,...value}=reuseDraft(draft,draft) as BoardDraft&{clientMessageId:string;updatedAt?:number}
  value.sourceView='company'
  if(card.managementRole==='governor')value.viewId??=store.activeTeamViewId??'all'
  sending.current=true;change({...value,sending:true,error:'',reviewAttempt:false})
  try{
   // Enqueue also dispatches an idle employee, atomically. A retry confirms the same attempt.
   await messenger.prepareSend(savedKey,value)
   await api.call('session.enqueue',{employee:card.id,text:value.text.trim(),images:value.images,files:value.files,sourceView:'company',clientMessageId:value.clientMessageId,replyTo:value.replyTo,replyQuote:value.replyQuote,replyConversation:value.replyConversation,replyTextOnly:value.replyTextOnly,...(value.viewId?{viewId:value.viewId}:{})})
   if(!await messenger.clearDraft(savedKey,value.clientMessageId))change({error:'Message was sent, but its draft could not be cleared.'})
   following.current=true
  }catch(cause){if(messenger.getDraft(savedKey)?.clientMessageId===value.clientMessageId)change({error:(cause as Error).message,reviewAttempt:['PRIVATE_SEND_UNCERTAIN','PRIVATE_SEND_INTERRUPTED'].includes((cause as {code:string}).code)});else setActionError((cause as Error).message)}
  finally{sending.current=false;change({sending:false});void loadRef.current();input.current?.focus()}
 }
 const configure=(cmd:string,args:Record<string,unknown>)=>active&&void run(()=>api.call(cmd,{id:active.id,...args}))
 const latest=()=>{following.current=true;if(viewport.current?.managed)viewport.current.scrollToEnd();else if(transcript.current){transcript.current.scrollTop=transcript.current.scrollHeight;programmaticTop.current=transcript.current.scrollTop}}
 useLayoutEffect(()=>{if(following.current)latest()},[items,busy])
 useReplyRead(transcript,card.id,card.lastReply,visible&&items.some(item=>item.id===card.lastReply?.itemId),'conversation')
 const model=active?activeModel(active.models,active.model):undefined,efforts=active?modelEfforts(active.engine,model):[]
 const workspaceRestricted=teamSettings(store,card.group).mode==='work'||!!card.remote&&card.kind!=='cloud-native-worker'
 const edit=(patch:Partial<BoardDraft>)=>change(current=>{const next={...current,...patch};return draftContent(next)===draftContent(current)?next:{...next,clientMessageId:undefined,viewId:undefined,error:undefined,reviewAttempt:false}})
 return <article ref={root} hidden={hidden} className="agent-board-panel" data-employee={card.id} data-working={busy} aria-label={uiText('Work conversation with {0}',[card.title])}>
  <header><MessageAvatar employee={card}/><div><h3 title={card.title}>{card.title}</h3><small>{card.group} · {ENGINE_DEFINITIONS[card.engine].label}</small></div><span className="board-status" data-working={busy} data-error={!!active?.error||card.initialization?.status==='failed'}><i/>{uiText(!ready?card.initialization?.status==='failed'?'Setup failed':'Initializing':active?.approvals?.length?'Needs approval':busy?'Working':'Ready')}</span><button className="board-icon-button" aria-label={uiText('Open full conversation with {0}',[card.title])} title={uiText('Open full conversation')} onClick={onOpen}><Icon name="screen-full"/></button></header>
  <div className="board-workspace" title={card.remote?.directory??card.cwd}><Icon name={card.remote?'remote':'folder-opened'}/><span>{card.remote?.directory??card.cwd}</span>{active?<details className="board-settings"><summary aria-label={uiText('Agent controls')}><Icon name="settings-gear"/>{uiText('Controls')}<Icon name="chevron-down"/></summary><div>
   <label>{uiText('Model')}<AppSelect aria-label={uiText('Model')} value={active.model??''} disabled={busy||locked||!active.models.length} onChange={event=>configure('config.model',{model:event.target.value})}>{!active.models.some(model=>model.value===active.model)&&<option value={active.model??''}>{active.model||uiText('Configured model')}</option>}{active.models.map(model=><option value={model.value} key={model.value}>{model.displayName}</option>)}</AppSelect></label>
   {!!efforts.length&&<label>{uiText('Reasoning')}<AppSelect aria-label={uiText('Reasoning')} value={active.effort??'default'} disabled={busy||locked} onChange={event=>configure('config.effort',{effort:event.target.value})}><option value="default">{uiText('Default')}</option>{efforts.map(effort=><option key={effort} value={effort}>{uiText(effort)}</option>)}</AppSelect></label>}
   {!workspaceRestricted&&<label>{uiText('Permissions')}<AppSelect aria-label={uiText('Permissions')} value={active.permissionMode} disabled={busy||locked} onChange={event=>configure('config.permission',{mode:event.target.value})}>{enginePermissionModes(card.engine).map(mode=><option key={mode.value} value={mode.value}>{uiText(mode.label)}</option>)}</AppSelect></label>}
   <button className="board-detail-link" onClick={onOpen}>{uiText('Open full conversation')}<Icon name="arrow-right"/></button>
  </div></details>:<small>{uiText('Native conversation')}</small>}</div>
  {mounted?<EmployeeWorkbench employee={card.id} active={visible} autoOpenTerminal={false} explorerWidth={store.preferences?.explorerWidth} explorerCollapsed={store.preferences?.explorerCollapsed} explorerTreeCollapsed={store.preferences?.explorerTreeCollapsed} terminalHeight={store.preferences?.terminalHeight} onAttachImage={path=>edit({images:[...new Set([...draft.images,path])]})}>
  {!!active?.approvals?.length&&<div className="board-approvals">{active.approvals.map(approval=><AgentApproval key={approval.id} compact approval={approval} respond={(decision,answers,form)=>run(()=>api.call('approval.respond',{id:active.id,requestId:approval.id,decision,answers,form}))}/>)}</div>}
  <ScrollArea className="transcript board-transcript" scrollRef={transcript} tabIndex={0} aria-label={uiText('Messages from {0}',[card.title])} onScroll={event=>{const node=event.currentTarget;if(Math.abs(node.scrollTop-(programmaticTop.current??-Infinity))>1)following.current=node.scrollHeight-node.clientHeight-node.scrollTop<6}} onWheel={event=>{if(event.deltaY<0)following.current=false}}>
   {!items.length&&<div className="board-conversation-empty"><Icon name="comment-discussion"/><strong>{card.title}</strong><span>{uiText(loading?'Loading conversation…':ready?'Ready for your next task':'Complete employee setup to begin')}</span>{!ready&&<button onClick={onOpen}>{uiText('Employee details')}</button>}</div>}
   <MessageViewport items={items} scrollRef={transcript} apiRef={viewport} enabled following={()=>following.current} onProgrammaticScroll={top=>{programmaticTop.current=top}} renderItem={item=><Turn key={item.id} item={item} conversationEmployee={card.id} replyId={item.id===card.lastReply?.itemId?card.lastReply.id:undefined}/>}/>
   {busy&&<div className="board-working" role="status"><i/><i/><i/><span>{active?.activity||uiText('Working…')}</span></div>}
  </ScrollArea>
  {loadError&&<p className="board-error" role="alert">{uiText(loadError)}<button onClick={()=>void loadRef.current()}>{uiText('Reload conversation')}</button></p>}
  {(draft.error||actionError||active?.error)&&<p className="board-error" role="alert">{uiText(draft.error||actionError||active!.error!)}{draft.error&&(draft.reviewAttempt?<button onClick={onOpen}>{uiText('Review this attempt in the full conversation')}</button>:<span>{uiText('Your draft is retained. Send again to confirm this request.')}</span>)}</p>}
  {active&&<TaskQueue key={active.id} messages={active.pendingMessages} onRemove={async messageId=>{try{await api.call('session.dequeue',{id:active.id,messageId})}finally{await loadRef.current()}}}/>}
  {draft.replyTo&&<div className="board-draft-reply"><Icon name="reply"/><button onClick={onOpen}>{uiText('Reply attached · Open full conversation')}</button><button aria-label={uiText('Cancel reply')} onClick={()=>edit({replyTo:undefined,replyQuote:undefined,replyConversation:undefined,replyTextOnly:undefined})}><Icon name="close"/></button></div>}
  <DraftFiles conversation={key} images={draft.images} files={draft.files} onRemove={path=>edit({images:draft.images.filter(image=>image!==path),files:draft.files.filter(file=>file!==path)})}/><AttachmentTransfers uploads={uploads}/>
  <div className="board-composer task-composer" onDragOver={event=>{if(ready&&!locked&&Array.from(event.dataTransfer.items).some(item=>item.kind==='file'))event.preventDefault()}} onDrop={event=>{const files=Array.from(event.dataTransfer.files);if(files.length){event.preventDefault();if(ready&&!locked)addFiles(files)}}}>

   <textarea ref={input} aria-label={uiText('Message {0}…',[card.title])} rows={1} disabled={locked||!ready} value={draft.text} placeholder={uiText('Message {0}…',[card.title])} onChange={event=>edit({text:event.target.value})} onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();addFiles(files)}}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send()}}}/>
   <div className="composer-bar"><div className="composer-utilities"><input ref={fileInput} type="file" hidden multiple onChange={event=>{addFiles(Array.from(event.target.files??[]));event.target.value=''}}/><button className="board-icon-button" disabled={locked||uploads.pending||!ready} aria-label={uiText('Attach files')} title={uiText('Attach files')} onClick={()=>fileInput.current?.click()}><Icon name="attach"/></button></div><ComposerActions busy={busy} disabled={locked||uploads.pending||!ready||!draft.text.trim()&&!draft.images.length&&!draft.files.length} pending={draft.sending?'send':undefined} stopping={pending} queueCount={active?.pendingMessages?.length} onSend={()=>void send()} onStop={()=>active&&void run(()=>api.call('session.interrupt',{id:active.id,expectedMessageId:active.currentTask?.messageId}))}/></div>
  </div>
  <footer><button onClick={latest}><Icon name="arrow-down"/>{uiText('Latest messages')}</button><span title={uiText(busy?'Enter to queue · Shift Enter for a new line':'Enter to send · Shift Enter for a new line')}>{uiText(busy?'Enter to queue · Shift Enter for a new line':'Enter to send · Shift Enter for a new line')}</span></footer>
 </EmployeeWorkbench>:<div className="board-conversation-empty">{uiText('Loading conversation…')}</div>}
 </article>
}
