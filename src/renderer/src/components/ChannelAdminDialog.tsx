import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {ChannelView} from '../../../shared/channels'
import type {Store} from '../../../shared/types'
import {api} from '../api'
import {translate as uiText,useI18n} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {useSurfaceMotion} from '../chat/surfaceMotion'
import {MessageAvatar} from './MessageView'
import {Icon} from './Icon'

/** Explicit reading grants only; no group membership, notifications or publishing role. */
export function ChannelAdminDialog({channel,store,onClose,onSaved}:{channel:ChannelView;store:Store;onClose:()=>void;onSaved:(channel:ChannelView)=>void}){
 useI18n()
 const surface=useSurfaceMotion<HTMLDivElement>('dialog'),[selected,setSelected]=useState(channel.readerIds??[]),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(channel.revision)
 const inFlight=useRef(false),close=()=>{if(!inFlight.current)onClose()}
 useDialogFocus('.channel-admin-dialog',true)
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();close()}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[onClose])
 const shown=store.sessions.filter(card=>!card.deleting&&[card.title,card.group].join(' ').toLowerCase().includes(query.toLowerCase()))
 const loadLatest=async()=>{if(inFlight.current)return;inFlight.current=true;setSaving(true);try{const access=await api.call<{employeeIds:string[];revision:number}>('channel.access',{id:channel.id});setSelected(access.employeeIds);setRevision(access.revision);onSaved({...channel,readerIds:access.employeeIds,revision:access.revision});setError('')}catch(cause){setError((cause as Error).message)}finally{inFlight.current=false;setSaving(false)}}
 const save=async()=>{if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const access=await api.call<{employeeIds:string[];revision:number}>('channel.access',{id:channel.id,employeeIds:selected.filter(id=>store.sessions.find(card=>card.id===id)?.managementRole!=='secretary'),expectedRevision:revision});onSaved({...channel,readerIds:access.employeeIds,revision:access.revision});onClose()}catch(cause){setError((cause as Error).message)}finally{inFlight.current=false;setSaving(false)}}
 useEffect(()=>{void loadLatest()},[channel.id])
 return createPortal(<div ref={surface} className="group-editor-overlay">
  <div className="group-editor-backdrop" onClick={close}/>
  <section className="group-editor channel-admin-dialog" role="dialog" aria-modal="true" aria-label={uiText('Channel access')}>
   <header><span className="management-dialog-mark"><Icon name="person-add"/></span><div><h2>{uiText('Channel access')}</h2><small>{channel.name}</small></div><button disabled={saving} aria-label={uiText('Close')} onClick={close}><Icon name="close"/></button></header>
   <p className="channel-admin-note">{uiText('Selected employees can read and search this channel through the API. Secretary always has access.')}</p>
   <label className="group-member-search"><Icon name="search"/><input aria-label={uiText('Search employees or teams')} placeholder={uiText('Search employees or teams')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="group-member-heading"><strong>{uiText('Authorized people')}</strong><span>{uiText('{0} selected',[selected.filter(id=>store.sessions.some(card=>card.id===id&&card.managementRole!=='secretary')).length+store.sessions.filter(card=>!card.deleting&&card.managementRole==='secretary').length])}</span></div>
   <div className="group-member-options channel-admin-options">{shown.map(card=><label key={card.id}><input type="checkbox" checked={card.managementRole==='secretary'||selected.includes(card.id)} disabled={saving||card.managementRole==='secretary'} onChange={()=>setSelected(previous=>previous.includes(card.id)?previous.filter(id=>id!==card.id):[...previous,card.id])}/><MessageAvatar employee={card}/><span><strong>{card.title}</strong><small>{card.group}</small></span><em>{uiText(card.managementRole==='secretary'?'Always authorized':'Read and search')}</em></label>)}{!shown.length&&<p>{uiText('No employees match your search.')}</p>}</div>
   <p className="group-editor-note">{uiText('Save to apply reading and search access. This does not start employee tasks.')}</p>
   {error&&<p className="group-error" role="alert">{uiText(error)}{error==='Channel changed; reload before saving'&&<button disabled={saving} onClick={()=>void loadLatest()}>{uiText('Load latest')}</button>}</p>}
   <footer><button disabled={saving} onClick={close}>{uiText('Cancel')}</button><button className="primary" disabled={saving} onClick={()=>void save()}>{uiText(saving?'Saving…':'Save access')}</button></footer>
  </section>
 </div>,document.body)
}
