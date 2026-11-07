import {createPortal} from 'react-dom'
import type {Store,StoredSession} from '../../../shared/types'
import {rolePolicy} from '../../../shared/roles'
import {useDialogFocus} from '../office/useDialogFocus'
import {translate as uiText} from '../i18n'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'

export function MessageEmployeesDialog({store,onClose,onNew,onOpen,onEdit,onRemove}:{store:Store;onClose:()=>void;onNew:()=>void;onOpen:(card:StoredSession)=>void;onEdit:(card:StoredSession)=>void;onRemove:(card:StoredSession)=>void}){
 useDialogFocus('.message-employees-dialog',true)
 return createPortal(<div className="group-editor-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose()}}}><div className="group-editor-backdrop" onClick={onClose}/><section className="group-editor message-employees-dialog" role="dialog" aria-modal="true" aria-label={uiText('Manage employees')}><header><h2>{uiText('Manage employees')}</h2><button aria-label={uiText('Close')} onClick={onClose}><Icon name="close"/></button></header><div className="message-employees-toolbar"><button className="primary" onClick={()=>{onClose();onNew()}}><Icon name="add"/>{uiText('Add Employee')}</button></div><div className="message-employees-list">{store.sessions.filter(card=>!card.deleting).map(card=><div className="message-employee-row" key={card.id}><button className="message-employee-open" onClick={()=>{onClose();onOpen(card)}}><EmployeePortrait avatar={card.avatar}/><span><strong>{card.title}</strong><small>{card.group} · {uiText(rolePolicy(card.managementRole).label)}</small></span></button><button aria-label={uiText('Edit {0}',[card.title])} title={uiText('Edit employee')} onClick={()=>{onClose();onEdit(card)}}><Icon name="edit"/></button><button aria-label={uiText('Delete {0}',[card.title])} title={uiText('Delete employee')} onClick={()=>onRemove(card)}><Icon name="trash"/></button></div>)}</div></section></div>,document.body)
}
