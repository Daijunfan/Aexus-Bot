import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {useEffect,useId,useRef,useState} from 'react'
import type {Store} from '../../../shared/types'
import type {ChatGroupView} from '../../../shared/chat-groups'
import {api} from '../api'
import {translate as t,useI18n} from '../i18n'
import {AppSelect} from './AppSelect'
import {ConversationControls} from './ConversationControls'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'
import {MessageWorkspace,MessageWorkspaceNav} from './MessageWorkspace'
import {StorageFolderFields} from './StorageFolderFields'
import {defaultStorageFolderName,type StorageFolderInput} from '../../../shared/storage-folder'

type Props={store:Store;group?:ChatGroupView;onClose:()=>void;onSaved:(group:ChatGroupView)=>void}
/** Existing groups save each management action through their own Core policy. */
export function GroupEditor(props:Props){return props.group?<ConversationControls conversation={'group:'+props.group.id} store={props.store} onClose={props.onClose}/>:<GroupCreation {...props}/>}

function GroupCreation({store,onClose,onSaved}:Props){
 useI18n()
 const formId='group-create-'+useId().replace(/:/g,''),[step,setStep]=useState('members'),inFlight=useRef(false),completed=useRef(false),attempt=useRef({signature:'',id:crypto.randomUUID()})
 const [storage,setStorage]=useState<StorageFolderInput>({mode:'create'}),[name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]),[owner,setOwner]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[discard,setDiscard]=useState(false),[error,setError]=useState('')
 const exitState=useRef({dirty:false,busy});exitState.current={dirty:!!name.trim()||!!selected.length||JSON.stringify(storage)!=='{"mode":"create"}',busy};useBeforeUnloadGuard(()=>!completed.current&&(exitState.current.dirty||exitState.current.busy))
 useEffect(()=>onPluginFlush(async()=>{if(!completed.current&&(exitState.current.dirty||exitState.current.busy)){setError('Finish or cancel group creation before leaving.');throw Error('Finish or cancel group creation before leaving.')}}),[])
 const cards=store.sessions.filter(card=>!card.deleting),shown=cards.filter(card=>[card.title,card.group].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())),ownerId=selected.includes(owner)?owner:selected[0]??''
 const addTeam=(team:string)=>{if(!team)return;setSelected(previous=>[...new Set([...previous,...cards.filter(card=>card.group===team).map(card=>card.id)])]);if(!name.trim())setName(team)}
 const close=()=>{if(inFlight.current)return;if(exitState.current.dirty)setDiscard(true);else onClose()}
 const save=async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{const values={name:name.trim(),members:selected,ownerId,storage:{...storage,folderName:storage.mode==='create'?storage.folderName??defaultStorageFolderName(name):undefined}},signature=JSON.stringify(values);if(signature!==attempt.current.signature)attempt.current={signature,id:crypto.randomUUID()};const result=await api.call<ChatGroupView>('chat.create',{...values,clientRequestId:attempt.current.id});completed.current=true;onSaved(result)}catch(cause){setError((cause as Error).message)}finally{inFlight.current=false;setBusy(false)}}
 return <MessageWorkspace className="group-creation-dialog" title={t('New group')} subtitle={t('Choose a name, members and group owner')} icon="organization" closeLabel={t('Close group editor')} onClose={()=>discard?setDiscard(false):close()} busy={busy} dirty={!completed.current&&exitState.current.dirty} navigation={<MessageWorkspaceNav label={t('Group creation sections')} value={step} disabled={busy||discard} items={[{id:'members',label:t('Group and members'),icon:'organization'},{id:'storage',label:t('Storage folder'),icon:'folder-opened'}]} onChange={setStep}/>} footer={<><span className="message-workspace-footer-note">{t('{0} members',[selected.length])}</span><button type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button form={formId} type="submit" className="primary" disabled={busy||discard||!name.trim()||!selected.length||selected.length>200||storage.hostId===''||storage.mode==='bind'&&!storage.directory}>{t(busy?'Creating…':'Create group')}</button></>}>
   {discard&&<div className="creation-discard" role="alert"><p>{t('Discard unsaved form changes?')}</p><button type="button" onClick={()=>setDiscard(false)}>{t('Keep editing')}</button><button type="button" onClick={onClose}>{t('Discard changes')}</button></div>}
   <form id={formId} className="group-creation-body" inert={discard} onSubmit={event=>{event.preventDefault();if(!busy&&name.trim()&&selected.length&&selected.length<=200)void save()}}>
    <section className="group-create-members-page" hidden={step!=='members'}>
    <label>{t('Group name')}<input autoFocus name="chat-name" maxLength={80} placeholder={t('e.g. Product team')} disabled={busy} value={name} onChange={event=>setName(event.target.value)}/></label>
    <div className="group-creation-pair"><label>{t('Add a Team')}<AppSelect aria-label={t('Add a Team')} name="chat-team" value="" disabled={busy} onChange={event=>addTeam(event.target.value)}><option value="">{t('Choose a Team to add its members')}</option>{store.groups.map(team=><option key={team} value={team}>{team}</option>)}</AppSelect></label><label>{t('Group owner')}<AppSelect aria-label={t('Group owner')} name="chat-owner" value={ownerId} disabled={busy||!selected.length} onChange={event=>setOwner(event.target.value)}>{!selected.length&&<option value="">{t('Choose members first')}</option>}{cards.filter(card=>selected.includes(card.id)).map(card=><option key={card.id} value={card.id}>{card.title}</option>)}</AppSelect></label></div>

    <div className="group-member-heading"><strong>{t('Members')}</strong><span>{selected.length} / 200</span><button type="button" disabled={busy||!selected.length} onClick={()=>setSelected([])}>{t('Clear')}</button></div>
    <label className="management-search"><Icon name="search"/><input aria-label={t('Search group members')} placeholder={t('Search employees or teams')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <div className="group-member-options group-creation-members">{shown.map(card=><label key={card.id} data-selected={selected.includes(card.id)}><input type="checkbox" checked={selected.includes(card.id)} disabled={busy||!selected.includes(card.id)&&selected.length>=200} onChange={()=>setSelected(previous=>previous.includes(card.id)?previous.filter(id=>id!==card.id):[...previous,card.id])}/><EmployeePortrait employeeId={card.id} avatar={card.avatar} color={card.color}/><span><strong>{card.title}</strong><small>{card.group} · {t(card.kind==='cloud-native-worker'?'Cloud engine':'Local engine')}</small></span>{ownerId===card.id&&<em className="conversation-role-badge owner"><Icon name="star-full"/>{t('Group owner')}</em>}</label>)}{!shown.length&&<p>{t('No employees match your search.')}</p>}</div>
    </section>
    <section className="group-create-storage-page" hidden={step!=='storage'}>
    <StorageFolderFields value={storage} onChange={setStorage} name={name} disabled={busy}/><small className="workspace-note">{t('All group members share the files in this folder; their Team workspaces stay unchanged.')}</small>
    </section>
    {error&&<p className="group-error" role="alert">{t(error)}</p>}
   </form>
 </MessageWorkspace>
}
