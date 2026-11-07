import {useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {AVATAR_CATALOG,type AvatarCatalogEntry} from '../../../shared/avatars'
import {api} from '../api'
import {useDialogFocus} from '../office/useDialogFocus'
import {translate as uiText,useI18n} from '../i18n'
import {AvatarCatalogContext} from './AvatarCatalog'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'
import '../styles/characters.css'

const allPreviews={revision:0,enabled:AVATAR_CATALOG.map(item=>item.id)}
export function CharacterLibrary({onClose}:{onClose:()=>void}){
 useI18n();useDialogFocus('.character-library',true)
 const current=useContext(AvatarCatalogContext),[items,setItems]=useState<AvatarCatalogEntry[]>([]),[status,setStatus]=useState<'active'|'archived'|'all'>('active'),[query,setQuery]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 const readOrder=useRef(0)
 const load=useCallback(async()=>{const order=++readOrder.current;try{const next=await api.call<AvatarCatalogEntry[]>('avatar.list',{status:'all'});if(order===readOrder.current){setItems(next);setError('')}}catch(cause){if(order===readOrder.current)setError((cause as Error).message)}finally{if(order===readOrder.current)setLoading(false)}},[])
 useEffect(()=>{void load()},[load,current?.revision])
 const shown=useMemo(()=>{const text=query.trim().toLocaleLowerCase();return items.filter(item=>(status==='all'||item.status===status)&&(!text||[item.id,item.name,item.character,...item.aliases].some(name=>name.toLocaleLowerCase().includes(text))))},[items,status,query])
 const toggle=async(item:AvatarCatalogEntry)=>{setBusy(item.id);setError('');try{const next=await api.call<AvatarCatalogEntry>('avatar.update',{id:item.id,enabled:!item.enabled,expectedRevision:item.revision});setItems(items=>items.map(value=>value.id===next.id?next:{...value,revision:next.revision}))}catch(cause){const message=(cause as Error).message;await load();setError(message)}finally{setBusy('')}}
 return createPortal(<div className="character-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose()}}}><div className="character-backdrop" onClick={()=>!busy&&onClose()}/><section className="character-dialog character-library" role="dialog" aria-modal="true" aria-label={uiText('Character library')}>
  <header><div><h2>{uiText('Character library')}</h2><p>{uiText('Enable characters for selection. Archived sources and saved identities are retained.')}</p></div><button className="character-close" aria-label={uiText('Close character library')} disabled={!!busy} onClick={onClose}><Icon name="close"/></button></header>
  <div className="character-library-tools"><div className="character-status-tabs" role="group" aria-label={uiText('Character availability')}>{(['active','archived','all'] as const).map(value=><button type="button" key={value} data-character-status={value} aria-pressed={status===value} onClick={()=>setStatus(value)}>{uiText(value==='active'?'Enabled':value==='archived'?'Archived':'All')}<span>{items.filter(item=>value==='all'||item.status===value).length}</span></button>)}</div><label className="character-search"><Icon name="search"/><input aria-label={uiText('Search character library')} value={query} placeholder={uiText('Search name or character ID')} onChange={event=>setQuery(event.target.value)}/></label></div>
  {error&&<p className="character-library-error" role="alert">{uiText(error)}</p>}
  <AvatarCatalogContext.Provider value={allPreviews}><div className="character-library-list">{shown.map(item=><article key={item.id} data-library-character={item.id} data-enabled={item.enabled}><EmployeePortrait avatar={item.id}/><div><strong>{item.name}</strong><small>{item.usageCount?uiText('{0} using this character',[item.usageCount]):item.assignedCount?uiText('{0} saved assignments',[item.assignedCount]):uiText(item.enabled?'Not in use':'Archived')}</small></div><button type="button" role="switch" aria-checked={item.enabled} aria-label={uiText(item.enabled?'Archive {0}':'Enable {0}',[item.name])} disabled={!!busy} onClick={()=>void toggle(item)}><i/>{uiText(item.enabled?'Enabled':'Enable')}</button></article>)}{!shown.length&&<p className="character-empty">{uiText(loading?'Loading…':'No matching characters')}</p>}</div></AvatarCatalogContext.Provider>
  <footer><span>{uiText('Availability changes apply immediately across all views.')}</span><button type="button" className="character-apply" disabled={!!busy} onClick={onClose}>{uiText('Done')}</button></footer>
 </section></div>,document.body)
}
