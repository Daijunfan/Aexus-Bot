import {useEffect,useMemo,useRef,useState} from 'react'
import type {ChannelSourceOrder} from '../../../shared/channels'
import type {SocialElement} from '../../../shared/message-categories'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {ChannelAvatar} from './ChannelNewsCard'
import {Icon} from './Icon'
import {useSortableList} from '../chat/useSortableList'
import {mergeOrder} from '../../../shared/messenger-order'

export function ChannelSourceTabs({channelId,sources,values,onChange,onAll,onAuthor}:{channelId:string;sources:SocialElement[];values:string[];onChange:(ids:string[])=>void;onAll:()=>void;onAuthor:(id:string)=>void}){
 const [order,setOrder]=useState<ChannelSourceOrder>(),[query,setQuery]=useState(''),[searching,setSearching]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),search=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null),searchButton=useRef<HTMLButtonElement>(null)
 const closeSearch=()=>{setSearching(false);setQuery('')}
 useEffect(()=>{if(!searching)return;searchInput.current?.focus();const outside=(event:MouseEvent)=>{if(!search.current?.contains(event.target as Node))closeSearch()};document.addEventListener('click',outside);return()=>document.removeEventListener('click',outside)},[searching])
 useEffect(()=>{let alive=true;const load=()=>void api.call<ChannelSourceOrder>('channel.source-order',{id:channelId}).then(value=>{if(alive)setOrder(value)}).catch(cause=>alive&&setError(cause.message));load();const off=api.onEvent(event=>{if(event.channel==='channel:changed'&&['sources','source-order'].includes(event.payload.kind)&&(!event.payload.channelIds||event.payload.channelIds.includes(channelId)))load()});return()=>{alive=false;off()}},[channelId])
 const sorted=useMemo(()=>{const ranks=new Map((order?.sourceIds??[]).map((id,index)=>[id,index]));return [...sources].sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity))},[sources,order])
 const needle=query.trim().toLowerCase(),shown=sorted.filter(source=>[source.name,source.locator].join(' ').toLowerCase().includes(needle))
 const saveOrder=async(ids:string[])=>{
  if(!order||busy)return false
  const previous=order;setBusy(true);setOrder({...order,sourceIds:ids});setError('')
  try{setOrder(await api.call<ChannelSourceOrder>('channel.source-order',{id:channelId,sourceIds:ids,expectedRevision:order.revision}));return true}catch(cause){setOrder(previous);setError((cause as Error).message);void api.call<ChannelSourceOrder>('channel.source-order',{id:channelId}).then(setOrder).catch(()=>{});return false}finally{setBusy(false)}
 }
 const byId=new Map(shown.map(source=>[source.id,source])),sorting=useSortableList({keys:shown.map(source=>source.id),identity:channelId+':'+query,axis:'x',disabled:!order||busy,label:id=>byId.get(id)?.name??id,save:ids=>saveOrder(mergeOrder(order!.sourceIds,ids))})

 return <div className="channel-source-tabs" role="group" aria-label={uiText('Post sources')} aria-busy={busy}>
  <button className="channel-all-sources" type="button" aria-label={uiText('All sources')} title={uiText('All sources')} aria-pressed={!values.length} onClick={onAll}><span>{uiText('All')}</span></button>
  <div ref={sorting.root} {...sorting.bindings} className="channel-source-strip message-sortable">{sorting.keys.map(id=>{const source=byId.get(id)!;return <div key={source.id} className="channel-source-chip" data-sort-key={source.id} data-selected={values.includes(source.id)} title={uiText('Drag to reorder; Alt + arrow keys to move')}>
   <button type="button" className="channel-source-avatar" data-sort-start aria-label={uiText('Author information {0}',[source.name])} onClick={()=>onAuthor(source.id)}><ChannelAvatar social kind={source.platform} avatar={source.avatar} name={source.name}/></button>
   <button type="button" className="channel-source-select" data-sort-start aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" data-source-key={source.platform+':'+source.id} aria-pressed={values.includes(source.id)} title={source.name} onClick={()=>onChange(values.includes(source.id)?values.filter(id=>id!==source.id):[...values,source.id])}><span>{source.name}</span></button>
  </div>})}{!shown.length&&<span className="channel-source-no-results">{uiText('No matching sources')}</span>}</div>
  <div className="channel-source-filter" ref={search} data-searching={searching} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();closeSearch();searchButton.current?.focus()}}}><button ref={searchButton} type="button" aria-label={uiText('Search sources')} title={uiText('Search sources')} aria-expanded={searching} onClick={()=>searching?closeSearch():setSearching(true)}><Icon name="search"/></button>{searching&&<input ref={searchInput} type="search" aria-label={uiText('Search sources')} placeholder={uiText('Search sources…')} value={query} onChange={event=>setQuery(event.target.value)}/>}</div>
  <span className="channel-source-announcement" role="status">{sorting.announcement}</span>{error&&<span className="channel-source-order-error" role="alert">{error}</span>}
 </div>
}
