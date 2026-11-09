import {EngineData} from './EngineData'
import {flushPlugins} from '../plugins'
import {SlashCommandMenu,matchingCommands} from './SlashCommandMenu'
import {WorkerSettingsControls} from './WorkerSettingsControls'
import {WorkerWorkbench} from './WorkerWorkbench'
import {EngineTools,type EngineToolSection} from './EngineTools'
import {useAttachmentUploads,AttachmentTransfers,DraftFiles} from '../chat/MessageAttachments'
import type {NativeWorkerDraft} from '../../../shared/native-worker'
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {NativeWorker,WorkerSnapshot,WorkerReceipt} from '../../../shared/native-worker'
import {ENGINE_DEFINITIONS} from '../../../shared/engines'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {Turn} from '../chat/Chat'
import {MessageViewport,type MessageViewportHandle} from '../chat/MessageViewport'
import {useComposerHeight} from '../chat/useComposerHeight'
import {EngineAvatar} from './EngineAvatar'
import {Icon} from './Icon'
import {ScrollArea} from './ScrollArea'
import {TaskQueue} from './TaskQueue'
import {ComposerActions} from './ComposerActions'
import {AgentApproval} from './AgentApproval'
import {useNativeWorkerDraft} from './useNativeWorkerDraft'
import {useDialogFocus} from '../office/useDialogFocus'
import {retainEqual} from '../snapshot'
import {useBoardVisible,type BoardDrafts,type SetBoardDrafts} from './AgentBoardPanel'

export function WorkerBoardPanel({worker,owner,enabled,hidden,refresh,preferences}:{worker:NativeWorker;owner?:string;preferences?:import('../../../shared/types').Store['preferences'];enabled:boolean;hidden:boolean;drafts:BoardDrafts;setDrafts:SetBoardDrafts;refresh:()=>Promise<unknown>}){
 const root=useRef<HTMLElement>(null),visible=useBoardVisible(root,enabled),persisted=useNativeWorkerDraft(worker),input=useRef<HTMLTextAreaElement>(null),transcript=useRef<HTMLDivElement>(null),viewport=useRef<MessageViewportHandle|null>(null),following=useRef(true),programmaticTop=useRef<number|undefined>(undefined),operation=useRef(0),loadRef=useRef(()=>Promise.resolve())
 const [commandResult,setCommandResult]=useState<any>(null),[snapshot,setSnapshot]=useState<WorkerSnapshot>(),[tools,setTools]=useState<EngineToolSection|null>(null),[commandOpen,setCommandOpen]=useState(false),[cmdIndex,setCmdIndex]=useState(0),[pending,setPending]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[recovery,setRecovery]=useState(false),[retry,setRetry]=useState<NativeWorkerDraft|null>(null),[removing,setRemoving]=useState(false),[expanded,setExpanded]=useState(false),sendingRef=useRef(false)
 const fileInput=useRef<HTMLInputElement>(null)
 const current=snapshot?.worker??worker,busy=!!current.busy||!!snapshot?.pendingMessages.length,items=snapshot?.items??[],locked=pending==='worker.remove'||pending==='worker.stop'
 useComposerHeight(input,persisted.text,true,worker.id)
 const latest=useCallback(()=>{following.current=true;if(viewport.current?.managed)viewport.current.scrollToEnd();else if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight},[])
 useEffect(()=>{if(!enabled||hidden)setExpanded(false)},[enabled,hidden])
 useDialogFocus('.worker-board-panel[data-expanded="true"]',expanded,()=>root.current?.querySelector<HTMLButtonElement>('[data-worker-expand]')??document.querySelector<HTMLButtonElement>('.company-actions .add-worker'))
 useEffect(()=>{
  if(!enabled||!visible&&!expanded)return
  let disposed=false,inflight=false,again=false,timer:ReturnType<typeof setTimeout>|undefined
  const load=async()=>{if(disposed)return;if(inflight){again=true;return}inflight=true;try{const value=await api.call<WorkerSnapshot>('worker.snapshot',{id:worker.id});if(!disposed)setSnapshot(previous=>retainEqual(previous,value))}catch(cause){if(!disposed)setError((cause as Error).message)}finally{inflight=false;if(again&&!disposed){again=false;void load()}}}
  loadRef.current=load;void load();const off=api.onEvent(event=>{if(event.channel==='client:connected'||event.channel==='workers:changed'&&(!event.payload?.id||event.payload.id===worker.id)){if(!timer)timer=setTimeout(()=>{timer=undefined;void load()},60)}})
  return()=>{disposed=true;clearTimeout(timer);off();loadRef.current=()=>Promise.resolve()}
 },[enabled,visible,expanded,worker.id])
 useLayoutEffect(()=>{if(following.current)latest()},[items,busy,latest])
 const action=async(cmd:string,args:Record<string,unknown>={})=>{const ticket=++operation.current;setPending(cmd);setError('');setNotice('');try{if(cmd==='worker.remove')await flushPlugins();await api.call(cmd,{id:worker.id,...args});await loadRef.current();await refresh();return true}catch(cause){if(ticket===operation.current)setError((cause as Error).message);return false}finally{if(ticket===operation.current)setPending('')}}
 const send=async(newAttempt=false,previous?:NativeWorkerDraft,override?:string)=>{
  if(uploads.pending||sendingRef.current||pending==='worker.command'||locked||pending==='worker.configure'||!(override??previous?.text??persisted.text).trim()&&!persisted.images.length&&!persisted.files.length||persisted.conflict)return
  const text=override??previous?.text??persisted.text,command=text.trim().startsWith('/');sendingRef.current=true;setSending(true);setError('');setNotice('');setRecovery(false)
  let prepared:NativeWorkerDraft|undefined,accepted=false
  try{
   const draft=previous&&!newAttempt?previous:await persisted.prepare(text,newAttempt,previous);prepared=draft
   const result=await api.call<{accepted?:boolean;handled?:boolean;panel?:EngineToolSection;data?:unknown;receipt?:WorkerReceipt}>(command?'worker.command':'worker.send',{id:worker.id,text,clientMessageId:worker.id+':'+draft.revision,...(!command?{images:draft.images,files:draft.files}:{})})
   if(!result.accepted&&!result.handled){setRecovery(true);throw Error('The previous attempt ended. Review the conversation before sending this as a new task.')}
   accepted=true
   if(!await persisted.clear(draft.revision,command))setNotice(uiText('Task sent. A newer Worker draft was kept.'))
   setRetry(null);setCommandOpen(false);if(result.panel){setExpanded(true);setTools(result.panel)}else if(result.handled){if(['/help','/status'].includes(text.trim()))setCommandResult(text.trim()==='/help'?result.data:{engine:current.engine,cwd:current.cwd,model:snapshot?.model,effort:snapshot?.effort,planMode:snapshot?.planMode,fastMode:snapshot?.fastMode,state:current.state});else setNotice(uiText('Worker command applied.'))};latest();await loadRef.current();await refresh()
  }catch(cause){if(prepared&&!accepted)setRetry(prepared);setError((accepted?uiText('Task sent, but its draft could not be cleared.')+' ':'')+(cause as Error).message)}finally{sendingRef.current=false;setSending(false);input.current?.focus()}
 }
 const configure=(args:import('../../../shared/worker-controls').WorkerSettings)=>void action('worker.configure',args)
 const state=current.state??(current.running?'ready':'stopped'),label=state==='working'?snapshot?.approvals.length?'Needs approval':'Working':state==='starting'?'Connecting…':state==='stopping'?'Stopping…':state==='error'?'Connection error':state==='ready'?'Ready':'Not connected'
 const uploads=useAttachmentUploads('worker:'+worker.id,(_scope,path,kind)=>persisted.attach(path,kind==='image'&&snapshot?.features.images?'image':'file'),persisted.images.length+persisted.files.length)
 const attach=(files:File[])=>{try{uploads.add(files)}catch(cause){setError((cause as Error).message)}}
 const closeExpanded=async()=>{try{await flushPlugins();setExpanded(false);setTools(null)}catch(cause){setError((cause as Error).message)}}
 const openTools=async(section:EngineToolSection)=>{try{await flushPlugins();setExpanded(true);setTools(section)}catch(cause){setError((cause as Error).message)}}
 const commands=commandOpen? snapshot?.commands??[]:matchingCommands(persisted.text,snapshot?.commands??[])
 useEffect(()=>setCmdIndex(0),[persisted.text,commandOpen])
 const choose=(command:import('../../../shared/types').SlashCommand,execute=true)=>{const local=['help','status','config','model','effort','permissions','fast','thinking','skills','mcp','account','usage','ps','stop','new','history','export'].includes(command.name)
  if(commandOpen&&!persisted.text.startsWith('/')&&local){setCommandOpen(false);void api.call<any>('worker.command',{id:worker.id,text:'/'+command.name,clientMessageId:crypto.randomUUID()}).then(result=>{const ok=true;if(['help','status'].includes(command.name))setCommandResult(command.name==='help'?result.data:{engine:current.engine,cwd:current.cwd,model:snapshot?.model,effort:snapshot?.effort,state:current.state});if(ok&&['config','model','effort','permissions','fast','thinking'].includes(command.name))void openTools('config');else if(ok&&['skills','mcp','account','usage','history','export'].includes(command.name))void openTools(command.name as EngineToolSection);else if(ok&&command.name==='ps')void openTools('background')}).catch(cause=>setError(cause.message));return}
  const complete='/'+command.name+(command.argumentHint?' ':'');persisted.edit(complete);setCommandOpen(false)
  if(execute&&(local||!command.argumentHint))void send(false,undefined,'/'+command.name)
  requestAnimationFrame(()=>input.current?.focus())
 }
 // Opening one full workbench connects only its own structured protocol, never all grid cards.
 const autoConnected=useRef(false)
 useEffect(()=>{if(expanded&&!autoConnected.current){autoConnected.current=true;if(!current.running&&state==='stopped')void action('worker.start')}if(!expanded)autoConnected.current=false},[expanded])
 return <>
  {expanded&&createPortal(<div className="worker-expanded-backdrop" onClick={()=>void closeExpanded()}/>,document.body)}
  {expanded&&<div className="worker-expanded-placeholder" aria-hidden="true"/>}
  <article ref={root} hidden={hidden} className="agent-board-panel worker-board-panel worker-conversation-card" data-worker={worker.id} data-running={busy} data-expanded={expanded||undefined} role={expanded?'dialog':undefined} aria-modal={expanded||undefined} aria-label={worker.title} onKeyDown={event=>{if(expanded&&event.key==='Escape'&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&!commandOpen&&!commands.length){event.preventDefault();event.stopPropagation();void closeExpanded()}}}>
   <header><button className="worker-title" title={uiText('Open full conversation')} aria-label={uiText('Open conversation with {0}',[worker.title])} onClick={()=>setExpanded(true)}><span className="board-engine-avatar"><EngineAvatar engine={worker.engine} state={snapshot?.approvals.length?'attention':busy?'working':'idle'}/></span><span><strong>{worker.title}</strong><small>{owner??uiText('You')} · {ENGINE_DEFINITIONS[worker.engine].label}</small></span></button><span className="board-status" data-working={busy} data-error={state==='error'}><i/>{uiText(label)}</span><button data-worker-expand className="board-icon-button" aria-label={uiText(expanded?'Return to Workers':'Open full conversation')} title={uiText(expanded?'Return to Workers':'Open full conversation')} onClick={()=>expanded?void closeExpanded():setExpanded(true)}><Icon name={expanded?'screen-normal':'screen-full'}/></button><button className="board-icon-button" disabled={pending==='worker.remove'} aria-label={uiText('Remove Worker')} title={uiText('Remove Worker')} onClick={()=>setRemoving(!removing)}><Icon name="trash"/></button></header>
   <div className="board-workspace" title={worker.cwd}><Icon name={worker.host?'remote':'folder-opened'}/><span>{worker.cwd}</span><small>{uiText('Native conversation')}</small></div>
   {removing&&<div className="board-inline-confirm worker-remove-confirm"><Icon name="debug-stop"/><div><strong>{uiText('Stop and remove this Worker?')}</strong><p>{uiText('Its task, queued messages and background tools will stop. Work files and native history are retained.')}</p></div><button disabled={pending==='worker.remove'} className="board-danger" onClick={()=>void action('worker.remove')}>{pending==='worker.remove'?uiText('Stopping…'):uiText('Stop and remove')}</button><button disabled={pending==='worker.remove'} onClick={()=>setRemoving(false)}>{uiText('Cancel')}</button></div>}
   <WorkerSettingsControls worker={current} snapshot={snapshot} pending={!!pending} onConfigure={configure} onTools={section=>void openTools(section)}/>
   {!current.running&&<div className="worker-connect-row"><button className="worker-connect" disabled={!!pending||state==='starting'} onClick={()=>void action('worker.start')}><Icon name="plug"/>{uiText(state==='starting'?'Connecting…':'Connect')}</button></div>}
   {tools?<EngineTools worker id={worker.id} section={tools} onSection={setTools} onClose={()=>setTools(null)} available={[...(snapshot?.features.sections??[]),...(snapshot?.features.background?['background']:[])]} configurationPanel={<WorkerSettingsControls advanced worker={current} snapshot={snapshot} pending={!!pending} onConfigure={configure} onTools={section=>void openTools(section)}/>}/>:<WorkerWorkbench worker={current} preferences={preferences} expanded={expanded} onAttach={path=>persisted.attach(path,snapshot?.features.images?'image':'file')}>
   {commandResult&&<section className="worker-command-result" role="status"><button aria-label={uiText('Close command result')} onClick={()=>setCommandResult(null)}><Icon name="close"/></button><EngineData data={commandResult}/></section>}
   {snapshot?.requiresReconnect&&<div className="worker-policy-pending"><Icon name="info"/><span>{uiText('New permissions are saved. Reconnecting applies them and stops this Worker’s background tools.')}</span><button disabled={!!pending} onClick={()=>void action('worker.stop').then(ok=>{if(ok)void action('worker.start')})}>{uiText('Reconnect and apply')}</button></div>}
   {!!snapshot?.approvals.length&&<div className="board-approvals">{snapshot.approvals.map(approval=><AgentApproval key={approval.id} compact approval={approval} respond={(decision,answers,form)=>action('worker.respond',{requestId:approval.id,decision,answers,form})}/>)}</div>}
   <ScrollArea className="transcript worker-transcript" scrollRef={transcript} tabIndex={0} aria-label={uiText('Messages from {0}',[worker.title])} onScroll={event=>{const node=event.currentTarget;if(Math.abs(node.scrollTop-(programmaticTop.current??-Infinity))>1)following.current=node.scrollHeight-node.clientHeight-node.scrollTop<6}} onWheel={event=>{if(event.deltaY<0)following.current=false}}>
    {!items.length&&<div className="worker-conversation-empty"><span><EngineAvatar engine={worker.engine} size={46}/></span><strong>{uiText('Your native coding workspace')}</strong><p>{uiText('Send a task. Responses, tool calls and approvals appear here.')}</p><small>{uiText('Your engine configuration and native history stay with this Worker.')}</small></div>}
    <MessageViewport items={items} scrollRef={transcript} apiRef={viewport} enabled renderAllBelow={40} following={()=>following.current} onProgrammaticScroll={top=>{programmaticTop.current=top}} renderItem={item=>{const receipt=snapshot?.receipts.find(receipt=>receipt.id===item.id),stopped=receipt&&['failed','interrupted'].includes(receipt.state);return <div key={item.id}><Turn worker={worker.id} item={item}/>{receipt&&receipt.state==='queued'&&<small className="worker-task-state">{uiText('Queued')}</small>}{stopped&&<div className="worker-task-state" data-failed={receipt.state==='failed'}><Icon name={receipt.state==='failed'?'warning':'circle-slash'}/><span title={receipt.error}>{uiText(receipt.state==='failed'?'Task failed':'Cancelled')}</span><button onClick={()=>{persisted.edit([persisted.text,receipt.text].filter(Boolean).join('\n\n'));input.current?.focus()}}>{uiText('Add to draft')}</button></div>}</div>}}/>
    {busy&&<div className="board-working" role="status"><i/><i/><i/><span>{uiText(snapshot?.approvals.length?'Waiting for permission':'Working…')}</span></div>}
   </ScrollArea>
   {(error||current.error||retry)&&<div role="alert" className="board-error worker-conversation-error"><Icon name="warning"/><span>{uiText(error||current.error||'The previous send could not be confirmed. Confirm it without replaying work.')}</span>{retry&&<details className="worker-send-retry"><summary>{uiText('Previous task')}</summary><p>{retry.text}</p><button onClick={()=>void send(recovery,retry)} disabled={sending}>{uiText(recovery?'Send as a new request':'Confirm previous send')}</button></details>}{state==='error'&&!busy&&!recovery&&<button onClick={()=>void action('worker.stop').then(ok=>{if(ok)void action('worker.start')})}>{uiText('Reconnect')}</button>}</div>}
   {notice&&<p className="worker-notice" role="status"><Icon name="check"/>{notice}</p>}
   <TaskQueue messages={snapshot?.pendingMessages} onRemove={async messageId=>{try{await api.call('worker.dequeue',{id:worker.id,messageId})}finally{await loadRef.current()}}}/>
   {persisted.error&&<div className="worker-draft-error" role="alert"><span>{uiText(persisted.error)}</span>{persisted.conflict?<><div className="worker-saved-draft"><small>{uiText('Saved draft')}</small><p>{persisted.savedText||uiText('Empty draft')}</p></div><button onClick={()=>void persisted.resolve(true).catch(()=>{})}>{uiText('Keep my draft')}</button><button onClick={()=>void persisted.resolve(false)}>{uiText('Use saved draft')}</button></>:<button onClick={()=>void persisted.flush().catch(()=>{})}>{uiText('Retry save')}</button>}</div>}
   <div className="board-composer task-composer worker-task-composer" onDragOver={event=>{if(Array.from(event.dataTransfer.items).some(item=>item.kind==='file')){event.preventDefault();event.dataTransfer.dropEffect='copy'}}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();attach([...event.dataTransfer.files])}}}>
    <SlashCommandMenu commands={commands} index={Math.min(cmdIndex,commands.length-1)} onChoose={command=>choose(command)}/>
    <DraftFiles conversation={'worker:'+worker.id} images={persisted.images} files={persisted.files} onRemove={persisted.remove}/><AttachmentTransfers uploads={uploads}/>
    <textarea ref={input} aria-label={uiText('Message {0}…',[worker.title])} rows={1} maxLength={100000} placeholder={uiText('Message {0}…',[worker.title])} disabled={locked} value={persisted.text} onPaste={event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();attach(files)}}} onChange={event=>{persisted.edit(event.target.value);setError('');setNotice('');if(!retry)setRecovery(false)}} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'&&(commandOpen||commands.length)){event.preventDefault();event.stopPropagation();setCommandOpen(false);if(persisted.text.startsWith('/'))persisted.edit('');return}if(commands.length&&['ArrowDown','ArrowUp','Tab','Enter'].includes(event.key)&&!event.shiftKey){event.preventDefault();event.stopPropagation();if(event.key==='ArrowDown'||event.key==='ArrowUp')setCmdIndex(index=>(index+(event.key==='ArrowUp'?-1:1)+commands.length)%commands.length);else{const command=commands[Math.min(cmdIndex,commands.length-1)];if(command)choose(command,event.key==='Enter'&&(persisted.text==='/'+command.name||!command.argumentHint||commandOpen))}return}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}}/>
    <div className="composer-bar"><div className="composer-utilities"><input ref={fileInput} type="file" multiple hidden aria-label={uiText('Choose Worker attachments')} onChange={event=>{attach([...event.target.files??[]]);event.target.value=''}}/><button disabled={locked||uploads.pending} className="message-attach" aria-label={uiText('Attach files')} title={uiText('Attach files')} onClick={()=>fileInput.current?.click()}><Icon name="attach"/></button><button className="worker-commands-trigger" aria-label={uiText('Open slash commands')} aria-expanded={!!commands.length} onClick={()=>{setCommandOpen(!commandOpen);input.current?.focus()}}><Icon name="terminal"/>{uiText('/ Commands')}</button></div>
     <ComposerActions busy={busy} disabled={locked||pending==='worker.configure'||sending||uploads.pending||!!snapshot?.requiresReconnect||persisted.conflict||!persisted.text.trim()&&!persisted.images.length&&!persisted.files.length} pending={sending?'send':pending==='worker.steer'?'steer':undefined} stopping={pending==='worker.interrupt'} queueCount={snapshot?.pendingMessages.length} steer={snapshot?.features.steer?{reason:persisted.images.length||persisted.files.length?uiText('Queue attachments as a separate task'):!persisted.text.trim()?uiText('Write instructions to add to the running task'):undefined,send:()=>{const currentText=persisted.text,editVersion=persisted.editVersion;void action('worker.steer',{text:currentText,expectedMessageId:snapshot.currentMessageId}).then(ok=>{if(ok)persisted.clearText(currentText,editVersion)})}}:undefined} onSend={()=>void send()} onStop={()=>void action('worker.interrupt',{expectedMessageId:snapshot?.currentMessageId})}/>
    </div>
    <small className="worker-composer-hint">{uiText(persisted.saving?'Saving draft…':persisted.error?'Draft not saved':busy?'Runs after the current task':'Enter to send · Shift Enter for a new line')}</small>
   </div>
   <footer><button onClick={latest}><Icon name="arrow-down"/>{uiText('Latest messages')}</button><span>{uiText('Independent session · native configuration')}</span>{(current.running||state==='starting')&&<button disabled={locked} onClick={()=>void action('worker.stop')} title={uiText('Disconnect and stop the native process')}><Icon name="debug-disconnect"/>{uiText(state==='starting'?'Cancel connection':'Disconnect')}</button>}</footer>
   </WorkerWorkbench>}
  </article>
 </>
}
