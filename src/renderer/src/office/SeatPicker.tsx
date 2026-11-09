import {useState} from 'react'
import {createPortal} from 'react-dom'
import type {PlannedRoom} from '../../../shared/canvas'
import {translate as uiText} from '../i18n'
import {useDialogFocus} from './useDialogFocus'

export function SeatPicker({room,id,onMove,onClose}:{room:PlannedRoom;id:string;onMove:(id:string,seat:number)=>Promise<unknown>;onClose:()=>void}){
 const [pending,setPending]=useState(false),[error,setError]=useState('')
 const employee=room.employees.find(entry=>entry.card.id===id)!.card
 useDialogFocus('.seat-picker',true)
 const move=async(seat:number)=>{if(pending)return;setPending(true);setError('');try{await onMove(id,seat);onClose()}catch(cause){setError((cause as Error).message)}finally{setPending(false)}}
 return createPortal(<div className="office-panel-wrap seat-picker-overlay" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&!pending){event.preventDefault();event.stopPropagation();onClose()}}}><div className="panel-backdrop" onClick={()=>!pending&&onClose()}/><section className="office-panel seat-picker" role="dialog" aria-modal="true" aria-label={uiText('Choose a seat for {0}',[employee.title])}>
  <header><div><h2>{uiText('Choose a seat')}</h2><p>{employee.title} · {room.name}</p></div><button aria-label={uiText('Close panel')} disabled={pending} onClick={onClose}>×</button></header>
  <p>{uiText('Choose an empty seat or swap with a teammate. The Team size stays fixed.')}</p>
  <div className="seat-picker-grid">{room.seats?.map(seat=>{const occupant=room.employees.find(entry=>entry.card.id===seat.employeeId)?.card,current=occupant?.id===id;return <button key={seat.number} type="button" disabled={pending} aria-pressed={current} aria-label={uiText('Seat {0} · {1}',[seat.number,occupant?.title??uiText('Empty')])} onClick={()=>void move(seat.number)}><strong>{String(seat.number).padStart(2,'0')}</strong><span>{current?uiText('Current seat'):occupant?.title??uiText('Empty seat')}</span></button>})}</div>
  {error&&<p className="profile-error" role="alert">{uiText(error)}</p>}
 </section></div>,document.body)
}
