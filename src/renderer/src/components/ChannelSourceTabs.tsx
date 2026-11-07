import {useEffect,useMemo,useRef,useState} from 'react'
import type {ChannelSourceOrder} from '../../../shared/channels'
import type {SocialElement} from '../../../shared/message-categories'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {ChannelAvatar} from './ChannelNewsCard'
import {Icon} from './Icon'

export function ChannelSourceTabs({channelId,sources,values,onChange,onAll,onAuthor}:{channelId:string;sources:SocialElement[];values:string[];onChange:(ids:string[])=>void;onAll:()=>void;onAuthor:(id:string)=>void}){
 const [order,setOrder]=useState<ChannelSourceOrder>(),[query,setQuery]=useState(''),[searching,setSearching]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[announcement,setAnnouncement]=useState(''),[dragOver,setDragOver]=useState(''),dragged=useRef(''),search=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),searchButton=useRef<HTMLButtonElement>(null)
 const closeSearch=()=>{setSearching(false);setQuery('')}
 useEffect(()=>{if(!searching)return;searchInput.current?.focus();const outside=(event:MouseEvent)=>{if(!search.current?.contains(event.target as Node))closeSearch()};document.addEventListener('click',outside);return()=>document.removeEventListener('click',outside)},[searching])
 useEffect(()=>{let alive=true;const load=()=>void api.call<ChannelSourceOrder>('channel.source-order',{id:channelId}).then(value=>{if(alive)setOrder(value)}).catch(cause=>alive&&setError(cause.message));load();const off=api.onEvent(event=>{if(event.channel==='channel:changed'&&['sources','source-order'].includes(event.payload.kind)&&(!event.payload.channelIds||event.payload.channelIds.includes(channelId)))load()});return()=>{alive=false;off()}},[channelId])
 const sorted=useMemo(()=>{const ranks=new Map((order?.sourceIds??[]).map((id,index)=>[id,index]));return [...sources].sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity))},[sources,order])
 const needle=query.trim().toLowerCase(),shown=sorted.filter(source=>[source.name,source.locator].join(' ').toLowerCase().includes(needle))
 const move=async(id:string,target:string,after=false)=>{
  if(!order||busy||id===target)return
  const ids=order.sourceIds.filter(value=>value!==id),index=ids.indexOf(target);if(index<0)return;ids.splice(index+(after?1:0),0,id)
  const previous=order;setBusy(true);setOrder({...order,sourceIds:ids});setError('');setAnnouncement('')
  try{setOrder(await api.call<ChannelSourceOrder>('channel.source-order',{id:channelId,sourceIds:ids,expectedRevision:order.revision}));setAnnouncement(uiText('Source order saved'))}catch(cause){setOrder(previous);setError((cause as Error).message);void api.call<ChannelSourceOrder>('channel.source-order',{id:channelId}).then(setOrder).catch(()=>{})}finally{setBusy(false)}
 }
 return <div className="channel-source-tabs" role="group" aria-label={uiText('Post sources')} aria-busy={busy}>
  <button className="channel-all-sources" type="button" aria-label={uiText('All sources')} title={uiText('All sources')} aria-pressed={!values.length} onClick={onAll}><span>{uiText('All')}</span></button>
  <div className="channel-source-strip">{shown.map(source=><div key={source.id} className="channel-source-chip" data-selected={values.includes(source.id)} data-drag-over={dragOver===source.id} draggable={!busy} title={uiText('Drag to reorder; Alt + arrow keys to move')} onDragStart={event=>{dragged.current=source.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',source.id)}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';setDragOver(source.id)}} onDragLeave={()=>setDragOver('')} onDragEnd={()=>{dragged.current='';setDragOver('')}} onDrop={event=>{event.preventDefault();setDragOver('');const id=dragged.current;if(id){const rect=event.currentTarget.getBoundingClientRect();void move(id,source.id,event.clientX>rect.left+rect.width/2)}dragged.current=''}}>
   <button type="button" className="channel-source-avatar" aria-label={uiText('Author information {0}',[source.name])} onClick={()=>onAuthor(source.id)}><ChannelAvatar social kind={source.platform} avatar={source.avatar} name={source.name}/></button>
   <button type="button" className="channel-source-select" data-source-key={source.platform+':'+source.id} aria-pressed={values.includes(source.id)} title={source.name} onClick={()=>onChange(values.includes(source.id)?values.filter(id=>id!==source.id):[...values,source.id])} onKeyDown={event=>{if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const index=sorted.findIndex(value=>value.id===source.id),target=sorted[index+(event.key==='ArrowLeft'?-1:1)];if(target)void move(source.id,target.id,event.key==='ArrowRight')}}}><span>{source.name}</span></button>
  </div>)}{!shown.length&&<span className="channel-source-no-results">{uiText('No matching sources')}</span>}</div>
  <div className="channel-source-filter" ref={search} data-searching={searching} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();closeSearch();searchButton.current?.focus()}}}><button ref={searchButton} type="button" aria-label={uiText('Search sources')} title={uiText('Search sources')} aria-expanded={searching} onClick={()=>searching?closeSearch():setSearching(true)}><Icon name="search"/></button>{searching&&<input ref={searchInput} type="search" aria-label={uiText('Search sources')} placeholder={uiText('Search sources…')} value={query} onChange={event=>setQuery(event.target.value)}/>}</div>
  <span className="channel-source-announcement" role="status">{announcement}</span>{error&&<span className="channel-source-order-error" role="alert">{error}</span>}
 </div>
}
