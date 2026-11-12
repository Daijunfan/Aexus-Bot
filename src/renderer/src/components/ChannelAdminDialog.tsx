import {useEffect,useRef,useState} from 'react'
import type {ChannelView} from '../../../shared/channels'
import type {Store} from '../../../shared/types'
import {api} from '../api'
import {translate as uiText,useI18n} from '../i18n'
import {MessageAvatar} from './MessageView'
import {Icon} from './Icon'
import {MessageWorkspace} from './MessageWorkspace'

/** Explicit reading grants only; no group membership, notifications or publishing role. */
export function ChannelAdminDialog({channel,store,onClose,onSaved}:{channel:ChannelView;store:Store;onClose:()=>void;onSaved:(channel:ChannelView)=>void}){
 useI18n()
 const [selected,setSelected]=useState(channel.readerIds??[]),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(channel.revision)
 const inFlight=useRef(false),baseline=useRef(channel.readerIds??[]),[discard,setDiscard]=useState(false)
 const dirty=selected.slice().sort().join('\n')!==baseline.current.slice().sort().join('\n'),close=()=>{if(!inFlight.current){if(discard)setDiscard(false);else if(dirty)setDiscard(true);else onClose()}}
 const shown=store.sessions.filter(card=>!card.deleting&&[card.title,card.group].join(' ').toLowerCase().includes(query.toLowerCase()))
 const loadLatest=async()=>{if(inFlight.current)return;inFlight.current=true;setSaving(true);try{const access=await api.call<{employeeIds:string[];revision:number}>('channel.access',{id:channel.id});baseline.current=access.employeeIds;setSelected(access.employeeIds);setRevision(access.revision);onSaved({...channel,readerIds:access.employeeIds,revision:access.revision});setError('')}catch(cause){setError((cause as Error).message)}finally{inFlight.current=false;setSaving(false)}}
 const save=async()=>{if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const access=await api.call<{employeeIds:string[];revision:number}>('channel.access',{id:channel.id,employeeIds:selected.filter(id=>store.sessions.find(card=>card.id===id)?.managementRole!=='secretary'),expectedRevision:revision});onSaved({...channel,readerIds:access.employeeIds,revision:access.revision});onClose()}catch(cause){setError((cause as Error).message)}finally{inFlight.current=false;setSaving(false)}}
 useEffect(()=>{void loadLatest()},[channel.id])
 return <MessageWorkspace className="channel-admin-dialog" title={uiText('Channel access')} subtitle={channel.name} icon="person-add" closeLabel={uiText('Close')} onClose={close} busy={saving} dirty={dirty} scroll={false} footer={<><button disabled={saving} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" disabled={saving||!dirty||discard} onClick={()=>void save()}>{uiText(saving?'Saving…':'Save access')}</button></>}>
   {discard&&<div className="message-workspace-discard" role="alert"><p>{uiText('Discard unsaved access changes?')}</p><button onClick={()=>setDiscard(false)}>{uiText('Keep editing')}</button><button onClick={onClose}>{uiText('Discard changes')}</button></div>}
   <p className="channel-admin-note">{uiText('Selected employees can read and search this channel through the API. Secretary always has access.')}</p>
   <label className="group-member-search"><Icon name="search"/><input aria-label={uiText('Search employees or teams')} placeholder={uiText('Search employees or teams')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="group-member-heading"><strong>{uiText('Authorized people')}</strong><span>{uiText('{0} selected',[selected.filter(id=>store.sessions.some(card=>card.id===id&&card.managementRole!=='secretary')).length+store.sessions.filter(card=>!card.deleting&&card.managementRole==='secretary').length])}</span></div>
   <div className="group-member-options channel-admin-options" inert={discard}>{shown.map(card=><label key={card.id}><input type="checkbox" checked={card.managementRole==='secretary'||selected.includes(card.id)} disabled={saving||card.managementRole==='secretary'} onChange={()=>setSelected(previous=>previous.includes(card.id)?previous.filter(id=>id!==card.id):[...previous,card.id])}/><MessageAvatar employee={card}/><span><strong>{card.title}</strong><small>{card.group}</small></span><em>{uiText(card.managementRole==='secretary'?'Always authorized':'Read and search')}</em></label>)}{!shown.length&&<p>{uiText('No employees match your search.')}</p>}</div>
   <p className="group-editor-note">{uiText('Save to apply reading and search access. This does not start employee tasks.')}</p>
   {error&&<p className="group-error" role="alert">{uiText(error)}{error==='Channel changed; reload before saving'&&<button disabled={saving} onClick={()=>void loadLatest()}>{uiText('Load latest')}</button>}</p>}
 </MessageWorkspace>
}
