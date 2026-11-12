import {useState} from 'react'
import type {Store,StoredSession} from '../../../shared/types'
import {rolePolicy} from '../../../shared/roles'
import {translate as uiText,useI18n} from '../i18n'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'
import {MessageWorkspace} from './MessageWorkspace'

export function MessageEmployeesDialog({store,onClose,onNew,onOpen,onEdit,onRemove}:{store:Store;onClose:()=>void;onNew:()=>void;onOpen:(card:StoredSession)=>void;onEdit:(card:StoredSession)=>void;onRemove:(card:StoredSession)=>void}){
 useI18n();const [query,setQuery]=useState(''),shown=store.sessions.filter(card=>!card.deleting&&(card.title+' '+card.group).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 return <MessageWorkspace className="message-employees-dialog" title={uiText('Manage employees')} icon="person" closeLabel={uiText('Close')} onClose={onClose} scroll={false} actions={<button className="message-workspace-primary-action" onClick={()=>{onClose();onNew()}}><Icon name="add"/>{uiText('Add Employee')}</button>}>
  <label className="group-member-search"><Icon name="search"/><input type="search" aria-label={uiText('Search employees or teams')} placeholder={uiText('Search employees or teams')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <div className="message-employees-list">{shown.map(card=><div className="message-employee-row" key={card.id}><button className="message-employee-open" onClick={()=>{onClose();onOpen(card)}}><EmployeePortrait employeeId={card.id} avatar={card.avatar}/><span><strong>{card.title}</strong><small>{card.group} · {uiText(rolePolicy(card.managementRole).label)}</small></span></button><button aria-label={uiText('Edit {0}',[card.title])} title={uiText('Edit employee')} onClick={()=>{onClose();onEdit(card)}}><Icon name="edit"/></button><button aria-label={uiText('Delete {0}',[card.title])} title={uiText('Delete employee')} onClick={()=>onRemove(card)}><Icon name="trash"/></button></div>)}{!shown.length&&<p className="message-workspace-empty">{uiText('No employees match your search.')}</p>}</div>
 </MessageWorkspace>
}
