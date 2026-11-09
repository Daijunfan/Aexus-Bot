import {Fragment,useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react'
import {createPortal} from 'react-dom'
import type {ChatGroup} from '../../../shared/chat-groups'
import {DEFAULT_DOT_AVATAR,type BotBinding,type BotProvider} from '../../../shared/bot-workers'
import {type MessageAvatarState} from './MessageListAvatar'
import {GrokAvatar} from './GrokAvatar'
import {DotAvatar} from './DotAvatar'
import {MessageMenu} from './MessageMenu'
import {translate as uiText,useI18n} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {api} from '../api'
import {Icon} from './Icon'
import {BotIssueNotice,botIssueLabel} from './BotIssueNotice'
import '../styles/bot-workers.css'

type BotConversation=ChatGroup&{bot:BotBinding;removed?:boolean}
type ProviderResult={provider:BotProvider;connected:boolean;count?:number;error?:string}
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
function statusLabel(connection:BotBinding['connection']){
 if(connection==='connected')return uiText('Connected')
 if(connection==='connecting')return uiText('Connecting…')
 if(connection==='error')return uiText('Connection error')
 return uiText('Not connected')
}
function kindLabel(bot:BotBinding){return bot.kind==='group'?(bot.provider==='grok'?uiText('Native Grok group'):uiText('Native group')):uiText('Private bot')}

export function BotWorkers({onClose,onRefresh,onOpen}:{onClose:()=>void;onRefresh?:()=>void;onOpen:(id:string)=>void}){
 useI18n()
 useDialogFocus('.bot-workers-dialog',true)
 const [bots,setBots]=useState<BotConversation[]|null>(null),[loading,setLoading]=useState(false),[listError,setListError]=useState('')
 const [view,setView]=useState<'list'|'new-bot'|'new-group'>('list'),[syncing,setSyncing]=useState(false),[creating,setCreating]=useState(false)
 const [error,setError]=useState(''),[providers,setProviders]=useState<ProviderResult[]>([]),[detailId,setDetailId]=useState<string|null>(null),[accessId,setAccessId]=useState<string|null>(null),[appearanceId,setAppearanceId]=useState<string|null>(null)
 const [rowMenu,setRowMenu]=useState<{id:string;x:number;y:number}|null>(null),[connection,setConnection]=useState<{bot:BotConversation;mode:'edit'|'remove'}|null>(null)
 const [newBot,setNewBot]=useState({name:'',description:''})
 const [newGroup,setNewGroup]=useState({name:'',members:[] as string[]})
 // A stable request ID survives retries of the same submitted form, including uncertain failures.
 const botRequest=useRef<{requestId:string;fingerprint:string}|null>(null),groupRequest=useRef<{requestId:string;fingerprint:string}|null>(null)
 const refreshList=useCallback(async()=>{
  setLoading(true)
  try{setBots(await api.call<BotConversation[]>('bot.list',{includeRemoved:true}));setListError('')}catch(cause){setListError((cause as Error).message)}finally{setLoading(false)}
 },[])
 useEffect(()=>{void refreshList()},[refreshList])
 const connect=async()=>{
  setSyncing(true);setError('');setProviders([])
  try{const result=await api.call<{providers:ProviderResult[]}>('bot.sync');setProviders(result.providers);await refreshList();onRefresh?.()}catch(cause){setError((cause as Error).message)}finally{setSyncing(false)}
 }
 const openView=(next:'list'|'new-bot'|'new-group')=>{setError('');setView(next)}
 const finish=async(id:string)=>{
  await refreshList();onRefresh?.();onOpen(id);onClose()
 }
 const createBot=async(event:FormEvent)=>{
  event.preventDefault();if(!newBot.name.trim()||creating)return
  const name=newBot.name.trim(),description=newBot.description.trim(),fingerprint=JSON.stringify([name,description])
  if(!botRequest.current||botRequest.current.fingerprint!==fingerprint)botRequest.current={requestId:crypto.randomUUID(),fingerprint}
  setCreating(true);setError('')
  try{const group=await api.call<BotConversation>('bot.create',{name,...(description?{description}:{}),clientRequestId:botRequest.current.requestId});await finish(group.id)}catch(cause){setError((cause as Error).message)}finally{setCreating(false)}
 }
 const createGroup=async(event:FormEvent)=>{
  event.preventDefault();if(!newGroup.name.trim()||!newGroup.members.length||creating)return
  const name=newGroup.name.trim(),members=newGroup.members,fingerprint=JSON.stringify([name,[...members].sort()])
  if(!groupRequest.current||groupRequest.current.fingerprint!==fingerprint)groupRequest.current={requestId:crypto.randomUUID(),fingerprint}
  setCreating(true);setError('')
  try{const group=await api.call<BotConversation>('bot.group-create',{name,members,clientRequestId:groupRequest.current.requestId});await finish(group.id)}catch(cause){setError((cause as Error).message)}finally{setCreating(false)}
 }
 const grokPrivate=useMemo(()=>(bots??[]).filter(bot=>!bot.removed&&bot.bot.provider==='grok'&&bot.bot.kind==='private'),[bots])
 const toggleMember=(id:string)=>setNewGroup(value=>({...value,members:value.members.includes(id)?value.members.filter(item=>item!==id):[...value.members,id]}))
 const close=()=>{if(!creating&&!syncing)onClose()}
 return <div className="group-editor-overlay bot-workers-overlay" onKeyDown={event=>{if(event.key==='Escape'&&!creating&&!syncing)onClose()}}>
  <div className="group-editor-backdrop" onClick={close}/>
  <section className="group-editor bot-workers-dialog" role="dialog" aria-modal="true" aria-label={uiText('Bots')}>
   <header><div><span>{uiText('EXTERNAL WORKERS')}</span><h2>{uiText(view==='list'?'Bots':view==='new-bot'?'New Grok bot':'New Grok group')}</h2></div><button disabled={creating||syncing} aria-label={uiText('Close')} onClick={onClose}><Icon name="close"/></button></header>
   {view==='list'?<>
    <div className="bot-toolbar">
     <button className="primary" disabled={syncing} onClick={()=>void connect()}><Icon name="sync"/>{syncing?uiText('Connecting bots…'):uiText('Connect bots')}</button>
     <button disabled={loading||syncing} onClick={()=>void refreshList()}><Icon name="refresh"/>{uiText('Refresh')}</button>
     <button onClick={()=>openView('new-bot')}><Icon name="add"/>{uiText('New Grok bot')}</button>
     <button onClick={()=>openView('new-group')} disabled={!grokPrivate.length} title={!grokPrivate.length?uiText('Select a Grok bot and connect first.'):undefined}><Icon name="organization"/>{uiText('New Grok group')}</button>
    </div>
    {!!providers.length&&<div className="bot-provider-status" role="status">{providers.map(result=><div className="bot-provider-result" data-state={result.connected?'connected':'error'} key={result.provider}><strong>{uiText(botProviderLabel(result.provider))}</strong><span>{result.connected?uiText('{0} connected · {1} found',[botProviderLabel(result.provider),result.count??0]):uiText('{0} connection failed',[botProviderLabel(result.provider)])}</span>{!result.connected&&result.error&&<small>{result.error}</small>}</div>)}</div>}
    {error&&<p className="group-error" role="alert">{error}</p>}
    {listError&&<p className="group-error" role="alert">{listError}</p>}
    {loading&&!bots?<p className="bot-loading"><span className="spinner"/>{uiText('Loading…')}</p>:!bots?.length?<div className="bot-empty"><Icon name="robot"/><strong>{uiText('No external workers yet')}</strong><p>{uiText('Connect to import existing Dot and Grok bots.')}</p><button className="primary" disabled={syncing} onClick={()=>void connect()}>{uiText('Connect bots')}</button></div>:<div className="bot-worker-list">
     {bots.filter(bot=>!bot.removed).map(bot=>{const status=bot.bot.connection;return <div className="bot-worker" data-state={status??'idle'} key={bot.id}>
      <button className="bot-worker-main" onClick={()=>{onOpen(bot.id);onClose()}}>
       <BotAvatar provider={bot.bot.provider} bot={bot.bot}/>
       <span className="bot-worker-copy"><strong>{bot.name}</strong><small>{uiText(botConversationSubtitle(bot.bot))}</small></span>
       <em className="bot-status" data-state={bot.bot.issue?'error':status??'idle'}>{bot.bot.issue?botIssueLabel(bot.bot.issue):statusLabel(status)}</em>
      </button>
      <div className="bot-worker-actions">
       <button aria-label={uiText('Authorized people')} title={uiText('Authorized people')} onClick={()=>setAccessId(bot.id)}><Icon name="person"/></button>
       <button aria-label={uiText('Bot details')} title={uiText('Bot details')} aria-expanded={detailId===bot.id} onClick={()=>setDetailId(detailId===bot.id?null:bot.id)}><Icon name="info"/></button>
       <button aria-label={uiText('Actions for {0}',[bot.name])} onClick={event=>{const r=event.currentTarget.getBoundingClientRect();setRowMenu({id:bot.id,x:r.right,y:r.bottom})}}><Icon name="ellipsis"/></button>
      </div>
      {detailId===bot.id&&<div className="bot-worker-detail">
       <span><b>{uiText('Provider')}</b>{uiText(botProviderLabel(bot.bot.provider))}</span>
       <span><b>{uiText('Type')}</b>{kindLabel(bot.bot)}</span>
       <span><b>{uiText('Connection')}</b>{statusLabel(status)}</span>
       {bot.bot.issue&&<BotIssueNotice issue={bot.bot.issue}/>}
       {bot.bot.connection==='error'&&<p>{uiText('Connection error. Use Connect to retry.')}</p>}
      </div>}
     </div>})}
    </div>}
    {!!bots?.some(bot=>bot.removed)&&<details className="bot-removed-list"><summary>{uiText('Removed bots')}</summary>{bots.filter(bot=>bot.removed).map(bot=><div key={bot.id}><span>{bot.name}</span><button onClick={()=>{void api.call('bot.restore',{id:bot.id}).then(()=>{void refreshList();onRefresh?.()}).catch(e=>setError(e.message))}}>{uiText('Restore bot')}</button></div>)}</details>}
   </>:view==='new-bot'?<form className="bot-create-form" onSubmit={createBot}>
    <label>{uiText('Bot name')}<input autoFocus maxLength={80} value={newBot.name} onChange={event=>setNewBot({...newBot,name:event.target.value})}/></label>
    <label>{uiText('Description (optional)')}<textarea rows={3} maxLength={8000} value={newBot.description} onChange={event=>setNewBot({...newBot,description:event.target.value})}/></label>
    <p className="bot-form-note">{uiText('Create a new Worker in Grok.')}</p>
    {error&&<p className="group-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={creating} onClick={()=>openView('list')}>{uiText('Cancel')}</button><button className="primary" disabled={creating||!newBot.name.trim()}>{creating?uiText('Creating…'):uiText('Create bot')}</button></footer>
   </form>:<form className="bot-create-form" onSubmit={createGroup}>
    <label>{uiText('Bot group name')}<input autoFocus maxLength={80} value={newGroup.name} onChange={event=>setNewGroup({...newGroup,name:event.target.value})}/></label>
    <fieldset className="bot-member-select"><legend>{uiText('Choose native Grok bots')}</legend>{grokPrivate.length?grokPrivate.map(bot=><label className="bot-check" key={bot.id}><input type="checkbox" checked={newGroup.members.includes(bot.id)} onChange={()=>toggleMember(bot.id)}/><BotAvatar provider={bot.bot.provider} bot={bot.bot}/><span>{bot.name}</span></label>):<p>{uiText('Select a Grok bot and connect first.')}</p>}</fieldset>
    <p className="bot-form-note">{uiText('Choose Grok members. Employee access can be granted after creation.')}</p>
    {error&&<p className="group-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={creating} onClick={()=>openView('list')}>{uiText('Cancel')}</button><button className="primary" disabled={creating||!newGroup.name.trim()||!newGroup.members.length}>{creating?uiText('Creating…'):uiText('Create Grok group')}</button></footer>
   </form>}
  </section>
  {accessId&&<BotAccessDialog id={accessId} name={bots?.find(bot=>bot.id===accessId)?.name} onClose={()=>setAccessId(null)} onRefresh={onRefresh}/>}
  {appearanceId&&<BotAppearanceDialog id={appearanceId} onClose={()=>{setAppearanceId(null);void refreshList();onRefresh?.()}}/>}
  {rowMenu&&<MessageMenu anchor={rowMenu} label={uiText('Bot actions')} onClose={()=>setRowMenu(null)}>{(bots??[]).filter(bot=>bot.id===rowMenu.id).map(bot=><Fragment key={bot.id}><button role="menuitem" onClick={()=>{setRowMenu(null);setConnection({bot,mode:'edit'})}}><Icon name="edit"/>{uiText('Edit bot')}</button>{bot.bot.provider==='dots'&&<button role="menuitem" onClick={()=>{setRowMenu(null);setAppearanceId(bot.id)}}>{uiText('Native appearance')}</button>}<button role="menuitem" onClick={()=>{setRowMenu(null);setConnection({bot,mode:'remove'})}}><Icon name="trash"/>{uiText('Remove bot')}</button></Fragment>)}</MessageMenu>}
  {connection&&<BotConnectionDialog {...connection} onClose={()=>setConnection(null)} onSaved={()=>{if(connection.mode==='remove')void api.call<{chatId?:string}>('view.get').then(view=>{if(view.chatId===connection.bot.id)return api.call('view.open',{kind:'messages'})});setConnection(null);void refreshList();onRefresh?.()}}/>}
 </div>
}

export function BotAccessDialog({id,name,onClose,onRefresh}:{id:string;name?:string;onClose:()=>void;onRefresh?:()=>void}){
 useI18n()
 useDialogFocus('.bot-access-dialog',true)
 const [data,setData]=useState<AccessResult|null>(null),[employeeIds,setEmployeeIds]=useState<string[]>([]),[initial,setInitial]=useState<string[]>([])
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 useEffect(()=>{
  let alive=true
  void api.call<AccessResult>('bot.access',{id}).then(result=>{if(!alive)return;setData(result);setEmployeeIds(result.employeeIds);setInitial(result.employeeIds)}).catch(cause=>{if(alive)setError((cause as Error).message)}).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[id])
 const dirty=useMemo(()=>[...employeeIds].sort().join('\n')!==[...initial].sort().join('\n'),[employeeIds,initial])
 const toggle=(employeeId:string)=>setEmployeeIds(value=>value.includes(employeeId)?value.filter(item=>item!==employeeId):[...value,employeeId])
 const save=async()=>{
  if(!data||saving||!dirty)return
  setSaving(true);setError('');setSaved(false)
  try{const result=await api.call<AccessResult>('bot.access',{id,employeeIds,expectedRevision:data.revision});setData(result);setEmployeeIds(result.employeeIds);setInitial(result.employeeIds);setSaved(true);onRefresh?.()}catch(cause){setError((cause as Error).message)}finally{setSaving(false)}
 }
 return createPortal(<div className="group-editor-overlay bot-access-overlay" onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.stopPropagation();onClose()}}}>
  <div className="group-editor-backdrop" onClick={()=>!saving&&onClose()}/>
  <section className="group-editor bot-access-dialog" role="dialog" aria-modal="true" aria-label={uiText('Authorized people')}>
   <header><div><span>{uiText('BOT ACCESS')}</span><h2>{uiText('Authorized people')}</h2>{name&&<p className="bot-access-name">{name}</p>}</div><button disabled={saving} aria-label={uiText('Close')} onClick={onClose}><Icon name="close"/></button></header>
   <p className="bot-dialog-note">{uiText('Selected employees can message and use shared files. Secretary is always authorized.')}</p>
   {loading?<p className="bot-loading"><span className="spinner"/>{uiText('Loading…')}</p>:<div className="bot-access-list">
    <div className="bot-access-row automatic"><span><strong>{uiText('Secretary')}</strong><small>{uiText('Always authorized')}</small></span><em>{uiText('Full access')}</em></div>
    {data?.employees.filter(employee=>employee.role!=='secretary').map(employee=><label className="bot-access-row" key={employee.id}>
     <input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={()=>toggle(employee.id)}/>
     <span><strong>{employee.title}</strong><small>{employee.team} · {uiText(employee.role==='employee'?'Employee':employee.role==='manager'?'Manager':employee.role==='governor'?'Governor':employee.role==='secretary'?'Secretary':employee.role)}</small></span>
    </label>)}
   </div>}
   {error&&<p className="group-error" role="alert">{error}</p>}
   {saved&&<p className="bot-access-saved" role="status">{uiText('Access saved')}</p>}
   <footer><button disabled={saving} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" disabled={saving||loading||!dirty} onClick={()=>void save()}>{saving?uiText('Saving…'):uiText('Save access')}</button></footer>
  </section>
 </div>,document.body)
}
