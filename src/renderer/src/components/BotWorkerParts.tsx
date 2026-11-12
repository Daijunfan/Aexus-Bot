import {useEffect,useMemo,useState} from 'react'
import {createPortal} from 'react-dom'
import type {ChatGroup} from '../../../shared/chat-groups'
import {type BotBinding,type BotProvider} from '../../../shared/bot-workers'
import {type MessageAvatarState} from './MessageListAvatar'
import {GrokAvatar} from './GrokAvatar'
import {DotAvatar} from './DotAvatar'
import {translate as uiText,useI18n} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {api} from '../api'
import {Icon} from './Icon'
import {MessageWorkspace} from './MessageWorkspace'
import '../styles/bot-workers.css'

type AccessEmployee={id:string;title:string;role:string;team:string}
type AccessResult={id:string;employeeIds:string[];revision:number;employees:AccessEmployee[];automaticRoles:string[]}

export function botProviderLabel(provider:BotProvider){return provider==='grok'?'Grok':'Dot'}
export function botConversationSubtitle(bot:BotBinding){
 const label=`${botProviderLabel(bot.provider)} · Worker`
 if(bot.kind!=='group')return label
 return `${label} · Group`
}
export function BotAvatar({provider,bot,size,state='idle'}:{provider:BotProvider;bot?:BotBinding;size?:number;state?:MessageAvatarState}){
 return <span className="bot-avatar" data-provider={provider} style={size?{width:size,height:size}:undefined} aria-hidden="true">{provider==='grok'?<GrokAvatar shape={bot?.grokShape} color={bot?.grokColor} seed={bot?.remoteId} state={state==='working'?'thinking':state==='responding'?'streaming':'idle'}/>:<DotAvatar state={state}/>}</span>
}
export function BotAppearanceDialog({id,onClose}:{id:string;onClose:()=>void}){
 useI18n();useDialogFocus('.dot-native-preview',true)
 return createPortal(<div className="group-editor-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose()}}}><div className="group-editor-backdrop" onClick={onClose}/><section className="group-editor dot-native-preview" role="dialog" aria-modal="true" aria-label={uiText('Dot native appearance')}><header><h2>{uiText('Dot native appearance')}</h2><button aria-label={uiText('Close')} onClick={onClose}><Icon name="close"/></button></header><div className="dot-native-preview-stage"><DotAvatar state="idle"/></div><strong>Codey · OpenAI</strong><p>{uiText('Dot uses the original blue computer animation from OpenAI. Its native colors and character remain fixed.')}</p></section></div>,document.body)

}

export function BotConnectionDialog({bot,mode,onClose,onSaved}:{bot:ChatGroup;mode:'edit'|'remove';onClose:()=>void;onSaved:()=>void}){
 useI18n();useDialogFocus('.bot-connection-dialog',true)
 const [name,setName]=useState(bot.name),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const save=async()=>{setBusy(true);setError('');try{await api.call(mode==='edit'?'bot.update':'bot.delete',mode==='edit'?{id:bot.id,name,expectedRevision:bot.bot!.profileRevision??1}:{id:bot.id});onSaved()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 return createPortal(<div className="group-editor-overlay" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();onClose()}}}><div className="group-editor-backdrop" onClick={()=>!busy&&onClose()}/><section className="group-editor bot-connection-dialog" role={mode==='remove'?'alertdialog':'dialog'} aria-modal="true" aria-label={uiText(mode==='edit'?'Edit bot':'Remove bot')}><header><h2>{uiText(mode==='edit'?'Edit bot':'Remove bot')}</h2><button disabled={busy} aria-label={uiText('Close')} onClick={onClose}><Icon name="close"/></button></header>{mode==='edit'?<label>{uiText('Display name')}<input autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>:<><strong>{bot.name}</strong><p>{uiText('Remove this connection from Aexus. The native bot and its history are retained.')}</p></>}{error&&<p className="group-error" role="alert">{error}</p>}<footer><button disabled={busy} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" disabled={busy||mode==='edit'&&!name.trim()} onClick={()=>void save()}>{uiText(busy?'Saving…':mode==='edit'?'Save changes':'Remove bot')}</button></footer></section></div>,document.body)
}
export function BotAccessDialog({id,name,onClose,onRefresh}:{id:string;name?:string;onClose:()=>void;onRefresh?:()=>void}){
 useI18n()
 const [data,setData]=useState<AccessResult|null>(null),[employeeIds,setEmployeeIds]=useState<string[]>([]),[initial,setInitial]=useState<string[]>([])
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[discard,setDiscard]=useState(false)
 useEffect(()=>{
  let alive=true
  void api.call<AccessResult>('bot.access',{id}).then(result=>{if(!alive)return;setData(result);setEmployeeIds(result.employeeIds);setInitial(result.employeeIds)}).catch(cause=>{if(alive)setError((cause as Error).message)}).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[id])
 const dirty=useMemo(()=>[...employeeIds].sort().join('\n')!==[...initial].sort().join('\n'),[employeeIds,initial])
 const close=()=>{if(discard)setDiscard(false);else if(dirty)setDiscard(true);else onClose()}
 const toggle=(employeeId:string)=>setEmployeeIds(value=>value.includes(employeeId)?value.filter(item=>item!==employeeId):[...value,employeeId])
 const save=async()=>{
  if(!data||saving||!dirty)return
  setSaving(true);setError('');setSaved(false)
  try{const result=await api.call<AccessResult>('bot.access',{id,employeeIds,expectedRevision:data.revision});setData(result);setEmployeeIds(result.employeeIds);setInitial(result.employeeIds);setSaved(true);onRefresh?.()}catch(cause){setError((cause as Error).message)}finally{setSaving(false)}
 }
 return <MessageWorkspace className="bot-access-dialog" title={uiText('Authorized people')} subtitle={name} icon="organization" closeLabel={uiText('Close')} onClose={close} busy={saving} dirty={dirty} scroll={false} footer={<><span className="message-workspace-footer-note">{uiText('Secretary is always authorized.')}</span><button disabled={saving} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" disabled={saving||!data||!dirty||discard} onClick={()=>void save()}>{uiText(saving?'Saving…':'Save access')}</button></>}>
   {discard&&<div className="message-workspace-discard" role="alert"><p>{uiText('Discard unsaved access changes?')}</p><button onClick={()=>setDiscard(false)}>{uiText('Keep editing')}</button><button onClick={onClose}>{uiText('Discard changes')}</button></div>}
   <p className="bot-dialog-note">{uiText('Selected employees can message and use shared files. Secretary is always authorized.')}</p>
   {loading?<p className="bot-loading"><span className="spinner"/>{uiText('Loading…')}</p>:<div className="bot-access-list">
    <div className="bot-access-row automatic"><span><strong>{uiText('Secretary')}</strong><small>{uiText('Always authorized')}</small></span><em>{uiText('Full access')}</em></div>
    {data?.employees.filter(employee=>employee.role!=='secretary').map(employee=><label className="bot-access-row" key={employee.id}>
     <input type="checkbox" disabled={saving||discard} checked={employeeIds.includes(employee.id)} onChange={()=>toggle(employee.id)}/>
     <span><strong>{employee.title}</strong><small>{employee.team} · {uiText(employee.role==='employee'?'Employee':employee.role==='manager'?'Manager':employee.role==='governor'?'Governor':employee.role==='secretary'?'Secretary':employee.role)}</small></span>
    </label>)}
   </div>}
   {error&&<p className="group-error" role="alert">{error}</p>}
   {saved&&<p className="bot-access-saved" role="status">{uiText('Access saved')}</p>}
 </MessageWorkspace>
}
