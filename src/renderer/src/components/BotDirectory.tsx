import {createContext,useEffect,useMemo,useRef,useState} from 'react'
import type {BotCatalog,NativeBotSummary} from '../../../shared/bot-management'
import type {BotBinding} from '../../../shared/bot-workers'
import {api} from '../api'
import {createRefreshQueue} from '../snapshot'
import {translate as t} from '../i18n'
import {BotAvatar,botProviderLabel} from './BotWorkerParts'
import {Icon} from './Icon'
import '../styles/bot-directory.css'

export const NativeBotDirectoryContext=createContext<NativeBotSummary[]>([])
export const NativeBotManageContext=createContext<((item?:Pick<NativeBotSummary,'provider'|'nativeId'>)=>void)|null>(null)
export const nativeBotKey=(item:Pick<NativeBotSummary,'provider'|'nativeId'>)=>item.provider+':'+item.nativeId
const binding=(item:NativeBotSummary):BotBinding=>({provider:item.provider,remoteId:item.nativeId,kind:item.kind,role:'worker',grokShape:item.grokShape,grokColor:item.grokColor})
export function NativeBotAvatar({item,items}:{item:NativeBotSummary;items:NativeBotSummary[]}){
 if(item.kind!=='group')return <BotAvatar provider={item.provider} bot={binding(item)}/>
 const members=item.members.flatMap(id=>{const found=items.find(value=>value.provider===item.provider&&value.nativeId===id);return found?[found]:[]}).slice(0,4)
 return <span className="native-bot-group-avatar" data-member-count={members.length}>{members.length?members.map(member=><span key={member.nativeId} data-native-member={member.nativeId}><BotAvatar provider={member.provider} bot={binding(member)}/></span>):<Icon name="organization"/>}</span>
}

/** Metadata only. No histories, connections, model turns or remote mutations on listing. */
export function useNativeBotDirectory(){
 const [catalog,setCatalog]=useState<BotCatalog|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),active=useRef(false),checked=useRef(0)
 const refresh=useMemo(()=>createRefreshQueue(async()=>{
  if(!active.current)return
  setLoading(true)
  try{const value=await api.call<BotCatalog>('bot.catalog');if(active.current){setCatalog(value);setError('');checked.current=Date.now()}}
  catch(cause){if(active.current)setError((cause as Error).message)}
  finally{if(active.current)setLoading(false)}
 }),[])
 useEffect(()=>{
  active.current=true;void refresh()
  const focus=()=>{if(document.visibilityState==='visible'&&Date.now()-checked.current>30_000)void refresh()},off=api.onEvent(event=>{if(event.channel==='client:connected')void refresh()})
  window.addEventListener('focus',focus)
  return()=>{active.current=false;off();window.removeEventListener('focus',focus)}
 },[refresh])
 return {catalog,loading,error,refresh}
}

export function NativeBotRows({items,directory,opening,disabled,onOpen,onManage}:{items:NativeBotSummary[];directory:NativeBotSummary[];opening:string|null;disabled?:boolean;onOpen:(item:NativeBotSummary)=>void;onManage:(item:NativeBotSummary)=>void}){
 return <>{items.map(item=><div key={nativeBotKey(item)} role="listitem" className="message-contact-wrap message-native-contact" data-native-key={nativeBotKey(item)}>
  <button className="message-contact" data-native-id={item.nativeId} data-native-provider={item.provider} disabled={disabled||opening===nativeBotKey(item)} aria-label={t('Open native conversation {0}',[item.name])} onClick={()=>onOpen(item)}>
   <span className="message-native-avatar"><NativeBotAvatar item={item} items={directory}/></span>
   <span className="message-contact-content"><span className="message-contact-line"><strong>{item.name}</strong></span><span className="message-contact-preview message-snippet">{t(opening===nativeBotKey(item)?'Opening…':item.removed?'Disconnected from Aexus':'Open conversation')}</span><span className="message-contact-subtitle">{botProviderLabel(item.provider)} · {t(item.kind==='group'?'Native group':'Native bot')}{item.kind==='group'&&<> · {t(item.members.length===1?'{0} native bot member':'{0} native bot members',[item.members.length])}</>}</span></span>
  </button>
  <button className="message-row-menu" disabled={opening===nativeBotKey(item)} aria-label={t('Manage native {0}',[item.name])} title={t('Native bot settings')} onClick={()=>onManage(item)}><Icon name="settings-gear"/></button>
 </div>)}</>
}
