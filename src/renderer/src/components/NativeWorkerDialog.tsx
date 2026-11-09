import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {Engine,Store,StoredSession} from '../../../shared/types'
import type {NativeWorker,NativeWorkerEngine} from '../../../shared/native-worker'
import {ENGINE_DEFINITIONS} from '../../../shared/engines'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {AppSelect} from './AppSelect'
import {EngineMark} from './EngineMark'
import {Icon} from './Icon'
import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {useCatalog} from './useCatalog'

export function NativeWorkerDialog({store,employee,onClose,onCreated}:{store:Store;employee?:StoredSession;onClose:()=>void;onCreated:(worker:NativeWorker)=>void}){
 const [engine,setEngine]=useState<Engine>(employee?.engine??'codex'),[title,setTitle]=useState(''),[cwd,setCwd]=useState(employee?.cwd??''),[owner,setOwner]=useState(employee?.id??''),[pending,setPending]=useState(false),[discard,setDiscard]=useState(false),[error,setError]=useState('')
 const attempt=useRef({signature:'',id:crypto.randomUUID()}),creating=useRef(false),completed=useRef(false),initial=useRef(JSON.stringify([engine,title,cwd,owner])),dirty=initial.current!==JSON.stringify([engine,title,cwd,owner])
 const exitState=useRef({dirty,pending});exitState.current={dirty,pending}
 useBeforeUnloadGuard(()=>!completed.current&&(exitState.current.dirty||exitState.current.pending))
 useEffect(()=>onPluginFlush(async()=>{if(!completed.current&&(exitState.current.dirty||exitState.current.pending)){const message='Finish or cancel Worker creation before leaving.';setError(message);throw Error(message)}}),[])
 const ownerCard=store.sessions.find(card=>card.id===owner&&!card.deleting),ownerUnavailable=!!owner&&!ownerCard,localUnsupported=!['codex','claude'].includes(engine)&&!!ownerCard?.remote
 useDialogFocus('.create-native-worker',true)
 const availability=useCatalog<NativeWorkerEngine>('worker.engines',true,event=>event.channel==='store:changed'||event.channel.startsWith('engine:')),health=availability.value.find(item=>item.engine===engine),healthError=availability.error
 useEffect(()=>{const focus=()=>void availability.refresh();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)},[availability.refresh])
 const close=()=>{if(pending)return;if(dirty&&!completed.current)setDiscard(true);else onClose()}
 const create=async()=>{if(creating.current)return;creating.current=true;setPending(true);setError('');const values={engine,cwd:cwd.trim(),...(owner?{employee:owner}:{}),...(title.trim()?{title:title.trim()}:{})},signature=JSON.stringify(values);if(signature!==attempt.current.signature)attempt.current={signature,id:crypto.randomUUID()};try{const worker=await api.call<NativeWorker>('worker.create',{...values,clientRequestId:attempt.current.id});completed.current=true;onCreated(worker)}catch(cause){setError((cause as Error).message)}finally{creating.current=false;setPending(false)}}
 return createPortal(<div className="office-panel-wrap native-worker-overlay" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&!pending){event.preventDefault();event.stopPropagation();if(discard)setDiscard(false);else close()}}}>
  <div className="panel-backdrop" onClick={close}/>
  <section className="office-panel create-native-worker" role="dialog" aria-modal="true" aria-label={uiText('Add Worker')}>
   <header className="panel-header"><div><h2>{uiText('Add Worker')}</h2><p>{uiText('Native Coding Agent · your workspace, native configuration')}</p></div><button className="panel-close" disabled={pending} aria-label={uiText('Close panel')} onClick={close}>×</button></header>
   {discard&&<div className="creation-discard" role="alert"><p>{uiText('Discard unsaved form changes?')}</p><button type="button" onClick={()=>setDiscard(false)}>{uiText('Keep editing')}</button><button type="button" onClick={onClose}>{uiText('Discard changes')}</button></div>}
   <form inert={discard} onSubmit={event=>{event.preventDefault();if(!pending&&cwd.trim()&&!ownerUnavailable&&!localUnsupported)void create()}}>
    <fieldset disabled={pending}><legend>{uiText('Coding engine')}</legend><div className="worker-engine-options">{(Object.entries(ENGINE_DEFINITIONS) as [Engine,typeof ENGINE_DEFINITIONS.codex][]).map(([id,definition])=><button key={id} type="button" aria-label={definition.label} aria-pressed={engine===id} onClick={()=>setEngine(id)}><EngineMark engine={id} size={25}/><span>{definition.label}</span>{engine===id&&<Icon name="check"/>}</button>)}</div></fieldset>
    <p className="worker-engine-status" role="status" data-installed={ownerCard?.remote?undefined:health?.installed}><Icon name={health?.installed?'pass':'info'}/>{ownerCard?.remote?uiText('The native CLI runs on the owner’s host. Availability is checked when starting.'):healthError?uiText(healthError):health?health.installed?uiText('Native CLI available on Core'):uiText('Native CLI not found. Install or configure it in Settings before starting this Worker.'):uiText('Checking native engine…')}</p>
    <label>{uiText('Name')}<input disabled={pending} aria-label={uiText('Worker name')} value={title} onChange={event=>setTitle(event.target.value)} placeholder={ENGINE_DEFINITIONS[engine].label+' Worker'}/></label>
    <label>{uiText('Work folder')}<div className="folder-input"><input required disabled={pending} aria-label={uiText('Worker directory')} value={cwd} onChange={event=>setCwd(event.target.value)} placeholder={uiText('Choose an existing physical folder')}/><button type="button" disabled={pending||!!store.sessions.find(card=>card.id===owner)?.remote} onClick={async()=>{try{const value=await api.call<{path:string|null}>('workspace.choose',{path:cwd});if(value.path)setCwd(value.path)}catch(cause){setError((cause as Error).message)}}}><Icon name="folder-opened"/>{uiText('Browse')}</button></div><small className="worker-field-help">{uiText(owner?'Use the owner’s folder or an existing subfolder on the same host.':'Choose a folder on the Core host. Your files stay in place.')}</small></label>
    <label>{uiText('Managed by')}{employee?<div className="worker-fixed-owner" role="group" aria-label={uiText('Worker owner')}><Icon name="person"/><span><strong>{employee.title}</strong><small>{employee.group}</small></span><Icon name="lock"/></div>:<AppSelect disabled={pending} aria-label={uiText('Worker owner')} value={owner} onChange={event=>{const id=event.target.value;setOwner(id);setCwd(id?store.sessions.find(card=>card.id===id)?.cwd??'':'')}}><option value="">{uiText('You')}</option>{ownerUnavailable&&<option value={owner} disabled>{uiText('Owner no longer available')}</option>}{store.sessions.filter(card=>!card.deleting).map(card=><option key={card.id} value={card.id} disabled={!['codex','claude'].includes(engine)&&!!card.remote}>{card.title} · {card.group}</option>)}</AppSelect>}</label>
    {(ownerUnavailable||localUnsupported)&&<p className="profile-error" role="alert">{uiText(ownerUnavailable?'Choose an available owner.':'This engine’s graphical Worker requires a Core-local owner and folder.')}</p>}
    {error&&<p className="profile-error" role="alert">{uiText(error)}</p>}
    <footer><small>{uiText('Independent conversation · native configuration and work files are retained.')}</small><button type="button" disabled={pending} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" type="submit" disabled={pending||!cwd.trim()||ownerUnavailable||localUnsupported}>{pending?uiText('Creating…'):uiText('Create Worker')}</button></footer>
   </form>
  </section>
 </div>,document.body)
}
