import {useCallback,useEffect,useRef,useState} from 'react'
import type {Item} from '../../../shared/types'
import type {DirectHistory} from '../../../shared/direct-messages'
import {api} from '../api'

const LIMIT=200,MAX_ITEMS=1200
const order=(item:Item)=>'directSequence' in item?item.directSequence??0:0
function merge(current:Item[],incoming:Item[],older=false){
 const byId=new Map(current.map(item=>[item.id,item]))
 for(const item of incoming)byId.set(item.id,item)
 const sorted=[...byId.values()].sort((left,right)=>order(left)-order(right)||left.id.localeCompare(right.id));return older?sorted.slice(0,MAX_ITEMS):sorted.slice(-MAX_ITEMS)
}
const reason=(cause:unknown)=>cause instanceof Error?cause.message:String((cause as {message?:unknown})?.message??cause)

/** Explicit published private history only; refresh merges by ID and paging stays in memory. */
export function useDirectMessages(employeeId:string|undefined,enabled:boolean,around?:string){
 const [items,setItems]=useState<Item[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('')
 const [latestIncoming,setLatestIncoming]=useState<DirectHistory['latestIncoming']>()
 const [readSequence,setReadSequence]=useState(0),[nextBefore,setNextBefore]=useState<number|null>(null)
 const scope=useRef(employeeId),loaded=useRef<Item[]>([]),before=useRef<number|null>(null),anchor=useRef(around),request=useRef(0),older=useRef(false),active=useRef(employeeId)
 active.current=employeeId
 const load=useCallback(async(mode:'initial'|'refresh'|'older'|'latest')=>{
  if(!employeeId)return
  if(mode==='older'&&(before.current==null||older.current))return
  const id=employeeId,token=++request.current,cursor=mode==='older'?before.current:undefined
  const jump=mode==='refresh'?anchor.current:undefined
  const aroundId=mode==='initial'?anchor.current:jump
  if(mode==='older')older.current=true
  const args:Record<string,unknown>={employee:id,limit:LIMIT}
  if(mode==='older')args.before=cursor
  else if(aroundId)args.around=aroundId
  try{
   const history=await api.call<DirectHistory>('direct.history',args)
   if(token!==request.current||active.current!==id)return
   const replace=mode==='older'?false:mode==='initial'||mode==='latest'||!!jump
   const next=replace?history.items.slice(-MAX_ITEMS):merge(loaded.current,history.items,mode==='older')
   loaded.current=next;scope.current=id;before.current=next.length&&order(next[0])>1?order(next[0]):null;if(mode==='older')anchor.current=next[0]?.id
   setItems(next);setNextBefore(before.current);setLatestIncoming(history.latestIncoming);setReadSequence(history.readSequence);setReady(true);setError('')
  }catch(cause){if(token===request.current&&active.current===id)setError(reason(cause))}
  finally{if(mode==='older')older.current=false}
 },[employeeId])
 const refresh=useCallback(()=>void load('refresh'),[load])
 const loadOlder=useCallback(()=>void load('older'),[load])
 const loadLatest=useCallback(()=>{if(!anchor.current)return;anchor.current=undefined;void load('latest')},[load])
 useEffect(()=>{
  request.current++;scope.current=employeeId;loaded.current=[];before.current=null;anchor.current=around
  setItems([]);setNextBefore(null);setLatestIncoming(undefined);setReadSequence(0);setReady(false);setError('')
  if(!employeeId||!enabled)return
  void load('initial')
  let timer:ReturnType<typeof setTimeout>|undefined
  const off=api.onEvent(event=>{
   const payload=event.payload as {employee?:string}|undefined
   if(event.channel!=='client:connected'&&(event.channel!=='direct:changed'||payload?.employee!==employeeId))return
   clearTimeout(timer);timer=setTimeout(()=>{if(active.current===employeeId)void load('refresh')},120)
  })
  return()=>{clearTimeout(timer);off();request.current++}
 },[employeeId,enabled,load])
 useEffect(()=>{if(enabled&&around&&!loaded.current.some(item=>item.id===around)){anchor.current=around;void load('initial')}},[around,employeeId,enabled,load])
 const current=enabled&&scope.current===employeeId;return {items:current?items:[],ready:current&&ready,error:current?error:'',latestIncoming:current?latestIncoming:undefined,readSequence:current?readSequence:0,nextBefore:current?nextBefore:null,refresh,loadOlder,loadLatest}
}
