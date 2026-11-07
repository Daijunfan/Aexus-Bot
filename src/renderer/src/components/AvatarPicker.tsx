import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {avatarDescription,displayAvatar,listAvatars,randomAvatar} from '../../../shared/avatars'
import {currentAvatar,type AvatarKind} from '../../../shared/office'
import {useDialogFocus} from '../office/useDialogFocus'
import {Mascot} from '../office/Mascot'
import {translate as uiText,useI18n} from '../i18n'
import {useEnabledAvatars} from './AvatarCatalog'
import {EmployeePortrait} from './EmployeePortrait'
import {MessageListAvatar} from './MessageListAvatar'
import {Icon} from './Icon'
import '../styles/characters.css'

/** A local selection until confirmed; cancelling never changes the parent form or Core. */
export function AvatarPicker({value,onApply,onClose,loading=false,loadError=''}:{value:AvatarKind;onApply:(avatar:AvatarKind)=>void|Promise<void>;onClose:()=>void;loading?:boolean;loadError?:string}){
 useI18n();useDialogFocus('.character-picker',true)
 const available=useEnabledAvatars(),[selected,setSelected]=useState(()=>displayAvatar(value,available)),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),search=useRef<HTMLInputElement>(null)
 const choices=listAvatars({query,enabled:available}),character=avatarDescription(selected)
 useEffect(()=>{if(!available.includes(currentAvatar(selected)))setSelected(displayAvatar(selected,available))},[available,selected])
 useEffect(()=>{setSelected(displayAvatar(value,available))},[value])
 useEffect(()=>{search.current?.focus()},[])
 const apply=async()=>{setBusy(true);setError('');try{await onApply(selected);onClose()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 return createPortal(<div className="character-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose()}}}>
  <div className="character-backdrop" onClick={()=>!busy&&onClose()}/><section className="character-dialog character-picker" role="dialog" aria-modal="true" aria-label={uiText('Choose character')}>
   <header><div><h2>{uiText('Choose character')}</h2><p>{uiText('Preview a character, then confirm your choice.')}</p></div><button type="button" className="character-close" aria-label={uiText('Close character picker')} disabled={busy} onClick={onClose}><Icon name="close"/></button></header>
   <div className="character-content"><aside className="character-preview"><div className="character-stage"><Mascot kind={selected} working pose="type"/></div><strong>{character.character}</strong><small>{character.name}</small><div className="character-avatar-preview"><div><EmployeePortrait avatar={selected}/><span>{uiText('Avatar')}</span></div><div><MessageListAvatar avatar={selected} state="working" continuous/><span>{uiText('Animated avatar')}</span></div></div><button type="button" className="character-random" disabled={busy} onClick={()=>setSelected(randomAvatar(available))}><Icon name="refresh"/>{uiText('Random character')}</button></aside>
    <div className="character-browser"><label className="character-search"><Icon name="search"/><input ref={search} aria-label={uiText('Search characters')} value={query} placeholder={uiText('Search name or character ID')} onChange={event=>setQuery(event.target.value)}/>{query&&<button type="button" aria-label={uiText('Clear character search')} onClick={()=>setQuery('')}><Icon name="close"/></button>}</label>
     <div className="character-grid" role="group" aria-label={uiText('Available characters')}>{choices.map(item=><button type="button" key={item.id} data-character={item.id} aria-label={item.name} aria-pressed={selected===item.id} disabled={busy} onClick={()=>setSelected(item.id)}><EmployeePortrait avatar={item.id}/><strong>{item.character}</strong>{selected===item.id&&<Icon name="check"/>}</button>)}</div>{!choices.length&&<p className="character-empty">{uiText('No matching characters')}</p>}
    </div></div>
   <footer><span role={error||loadError?'alert':undefined}>{(error||loadError)?uiText(error||loadError):(loading?uiText('Loading…'):uiText('{0} enabled characters',[available.length]))}</span><button type="button" className="character-cancel" disabled={busy} onClick={onClose}>{uiText('Cancel')}</button><button type="button" className="character-apply" disabled={busy||loading} onClick={()=>void apply()}>{uiText(busy?'Saving…':'Use character')}</button></footer>
  </section>
 </div>,document.body)
}
