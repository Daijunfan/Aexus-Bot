import {useCallback,useEffect,useRef,useState} from 'react'
import type {NativeWorker,NativeWorkerDraft,NativeWorkerDraftResult} from '../../../shared/native-worker'
import {api} from '../api'
import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'

const EMPTY:NativeWorkerDraft={text:'',revision:0}
const CONFLICT='This Worker draft changed in another window. Choose which draft to keep.'
export function useNativeWorkerDraft(worker:NativeWorker){
 const saved=useRef(worker.draft??EMPTY),local=useRef(saved.current.text),pending=useRef<string|undefined>(undefined),writing=useRef<Promise<void>|undefined>(undefined),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),mounted=useRef(true),conflicted=useRef(false)
 const inflight=useRef<{value:string;revision:number}|null>(null),clearing=useRef<number|null>(null)
 const preparations=useRef<{value:string;newAttempt:boolean;resolve:(draft:NativeWorkerDraft)=>void;reject:(cause:unknown)=>void}[]>([])
 const [text,setText]=useState(local.current),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saving,setSaving]=useState(false)
 useBeforeUnloadGuard(()=>pending.current!==undefined||!!writing.current||conflicted.current)
 const accept=useCallback((draft:NativeWorkerDraft,own=false)=>{
  if(draft.revision<saved.current.revision)return
  const dirty=pending.current!==undefined||!!writing.current,ours=own||!!inflight.current&&inflight.current.value===draft.text&&draft.revision<=inflight.current.revision+1||clearing.current!==null&&draft.text===''&&draft.revision===clearing.current+1
  if(draft.revision>saved.current.revision&&dirty&&!ours&&draft.text!==local.current){conflicted.current=true;if(pending.current===undefined)pending.current=local.current;if(mounted.current){setConflict(true);setError(CONFLICT)}}
  saved.current=draft
  if(!dirty&&!conflicted.current){local.current=draft.text;if(mounted.current)setText(draft.text)}
 },[])

 useEffect(()=>{accept(worker.draft??EMPTY)},[worker.draft?.revision,worker.draft?.text,accept])
 const flush=useCallback(async()=>{
  clearTimeout(timer.current)
  if(conflicted.current)throw Error(CONFLICT)
  while(preparations.current.length||pending.current!==undefined||writing.current){
   const work=writing.current??(writing.current=(async()=>{
    if(mounted.current){setSaving(true);setError('')}
    try{while(preparations.current.length||pending.current!==undefined){
     if(conflicted.current){for(const prepared of preparations.current.splice(0))prepared.reject(Error(CONFLICT));throw Error(CONFLICT)}
     const prepared=preparations.current.shift(),value=prepared?.value??pending.current!;if(!prepared||pending.current===value)pending.current=undefined
     try{
      const revision=saved.current.revision;inflight.current={value,revision}
      const result=await api.call<NativeWorkerDraftResult>('worker.draft',{id:worker.id,text:value,expectedRevision:revision,...(prepared?.newAttempt?{newAttempt:true}:{})})
      if(!result.applied){conflicted.current=true;if(pending.current===undefined)pending.current=value;accept(result.draft);if(mounted.current)setConflict(true);throw Error(CONFLICT)}
      if(pending.current===undefined&&local.current!==value)pending.current=local.current
      accept(result.draft,true);prepared?.resolve(result.draft)
     }catch(cause){prepared?.reject(cause);for(const waiting of preparations.current.splice(0))waiting.reject(cause);if(pending.current===undefined)pending.current=local.current;if(mounted.current)setError((cause as Error).message);throw cause}finally{inflight.current=null}
    }}finally{if(mounted.current)setSaving(false)}
   })())
   try{await work}finally{if(writing.current===work)writing.current=undefined;if(pending.current===undefined&&!conflicted.current)accept(saved.current)}
  }
 },[worker.id,accept])
 const edit=useCallback((value:string)=>{local.current=value;pending.current=value;setText(value);setError(conflicted.current?CONFLICT:'');clearTimeout(timer.current);if(!conflicted.current)timer.current=setTimeout(()=>void flush().catch(()=>{}),250)},[flush])
 const resolve=useCallback(async(keepLocal:boolean)=>{
  conflicted.current=false;setConflict(false);setError('');clearTimeout(timer.current)
  if(keepLocal){pending.current=local.current;await flush()}else{pending.current=undefined;local.current=saved.current.text;setText(local.current)}
 },[flush])
 const prepare=(value:string,newAttempt=false):Promise<NativeWorkerDraft>=>{
  if(conflicted.current)return Promise.reject(Error(CONFLICT))
  clearTimeout(timer.current)
  // A send is an immutable write barrier. New typing remains a separate pending draft.
  if(value!==local.current&&pending.current===undefined)pending.current=local.current
  const result=new Promise<NativeWorkerDraft>((resolve,reject)=>preparations.current.push({value,newAttempt,resolve,reject}))
  void flush().catch(()=>{});return result
 }

 const clear=async(revision:number)=>{await flush();clearing.current=revision;try{const result=await api.call<NativeWorkerDraftResult>('worker.draft',{id:worker.id,text:'',expectedRevision:revision});accept(result.draft,result.applied);return result.applied}finally{clearing.current=null}}

 useEffect(()=>onPluginFlush(flush),[flush])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);void flush().catch(()=>{})}},[flush])
 return {text,error,conflict,saving,edit,flush,resolve,prepare,clear,savedText:saved.current.text}
}
