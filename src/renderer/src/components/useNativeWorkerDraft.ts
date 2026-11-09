import {useCallback,useEffect,useRef,useState} from 'react'
import type {NativeWorker,NativeWorkerDraft,NativeWorkerDraftResult} from '../../../shared/native-worker'
import {api} from '../api'
import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
type Content={text:string;images:string[];files:string[]}
const EMPTY:NativeWorkerDraft={text:'',revision:0},CONFLICT='This Worker draft changed in another window. Choose which draft to keep.'
const encode=(value:Partial<Content>)=>JSON.stringify({text:value.text??'',images:value.images??[],files:value.files??[]})
const decode=(value:string):Content=>JSON.parse(value)
export function useNativeWorkerDraft(worker:NativeWorker){
 const generation=useRef(0),saved=useRef(worker.draft??EMPTY),local=useRef(encode(saved.current)),pending=useRef<string|undefined>(undefined),writing=useRef<Promise<void>|undefined>(undefined),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),mounted=useRef(true),conflicted=useRef(false),inflight=useRef<{value:string;revision:number}|null>(null),clearing=useRef<number|null>(null)
 const preparations=useRef<{value:string;newAttempt:boolean;resolve:(draft:NativeWorkerDraft)=>void;reject:(cause:unknown)=>void}[]>([])
 const [value,setValue]=useState<Content>(decode(local.current)),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saving,setSaving]=useState(false)
 useBeforeUnloadGuard(()=>pending.current!==undefined||!!writing.current||conflicted.current)
 const accept=useCallback((draft:NativeWorkerDraft,own=false)=>{
  if(draft.revision<saved.current.revision)return
  const snapshot=encode(draft),dirty=pending.current!==undefined||!!writing.current,ours=own||!!inflight.current&&inflight.current.value===snapshot&&draft.revision<=inflight.current.revision+1||clearing.current!==null&&draft.text===''&&draft.revision===clearing.current+1
  if(draft.revision>saved.current.revision&&dirty&&!ours&&snapshot!==local.current){conflicted.current=true;if(pending.current===undefined)pending.current=local.current;if(mounted.current){setConflict(true);setError(CONFLICT)}}
  const externalNewer=!ours&&draft.revision>saved.current.revision;saved.current=draft;if(!dirty&&!conflicted.current){if(externalNewer)generation.current++;local.current=snapshot;if(mounted.current)setValue(decode(snapshot))}
 },[])
 useEffect(()=>accept(worker.draft??EMPTY),[worker.draft?.revision,worker.draft?.text,JSON.stringify(worker.draft?.images),JSON.stringify(worker.draft?.files),accept])
 const flush=useCallback(async()=>{
  clearTimeout(timer.current);if(conflicted.current)throw Error(CONFLICT)
  while(preparations.current.length||pending.current!==undefined||writing.current){
   const work=writing.current??(writing.current=(async()=>{
    if(mounted.current){setSaving(true);setError('')}
    try{while(preparations.current.length||pending.current!==undefined){
     if(conflicted.current){for(const prepared of preparations.current.splice(0))prepared.reject(Error(CONFLICT));throw Error(CONFLICT)}
     const prepared=preparations.current.shift(),content=prepared?.value??pending.current!;if(!prepared||pending.current===content)pending.current=undefined
     try{const revision=saved.current.revision;inflight.current={value:content,revision};const result=await api.call<NativeWorkerDraftResult>('worker.draft',{id:worker.id,...decode(content),expectedRevision:revision,...(prepared?.newAttempt?{newAttempt:true}:{})})
      if(!result.applied){conflicted.current=true;if(pending.current===undefined)pending.current=content;accept(result.draft);if(mounted.current)setConflict(true);throw Error(CONFLICT)}
      if(pending.current===undefined&&local.current!==content)pending.current=local.current;accept(result.draft,true);prepared?.resolve(result.draft)
     }catch(cause){prepared?.reject(cause);for(const waiting of preparations.current.splice(0))waiting.reject(cause);if(pending.current===undefined)pending.current=local.current;if(mounted.current)setError((cause as Error).message);throw cause}finally{inflight.current=null}
    }}finally{if(mounted.current)setSaving(false)}
   })())
   try{await work}finally{if(writing.current===work)writing.current=undefined;if(pending.current===undefined&&!conflicted.current)accept(saved.current)}
  }
 },[worker.id,accept])
 const change=useCallback((patch:Partial<Content>)=>{generation.current++;const next=encode({...decode(local.current),...patch});local.current=next;pending.current=next;setValue(decode(next));setError(conflicted.current?CONFLICT:'');clearTimeout(timer.current);if(!conflicted.current)timer.current=setTimeout(()=>void flush().catch(()=>{}),250)},[flush])
 const edit=useCallback((text:string)=>change({text}),[change])
 const attach=useCallback((path:string,kind:'image'|'file')=>{const current=decode(local.current),field=kind==='image'?'images':'files';change({[field]:[...new Set([...current[field],path])]})},[change])
 const remove=useCallback((path:string)=>{const current=decode(local.current);change({images:current.images.filter(value=>value!==path),files:current.files.filter(value=>value!==path)})},[change])
 const resolve=useCallback(async(keepLocal:boolean)=>{conflicted.current=false;setConflict(false);setError('');clearTimeout(timer.current);if(keepLocal){pending.current=local.current;await flush()}else{pending.current=undefined;local.current=encode(saved.current);setValue(decode(local.current))}},[flush])
 const prepare=(text:string,newAttempt=false,attachments?:Pick<NativeWorkerDraft,'images'|'files'>):Promise<NativeWorkerDraft>=>{if(conflicted.current)return Promise.reject(Error(CONFLICT));clearTimeout(timer.current);const content=encode({...decode(local.current),...(attachments?{images:attachments.images??[],files:attachments.files??[]}:{}),text});if(content!==local.current&&pending.current===undefined)pending.current=local.current;const result=new Promise<NativeWorkerDraft>((resolve,reject)=>preparations.current.push({value:content,newAttempt,resolve,reject}));void flush().catch(()=>{});return result}
 const clear=async(revision:number,keepAttachments=false)=>{await flush();clearing.current=revision;try{const current=decode(local.current),result=await api.call<NativeWorkerDraftResult>('worker.draft',{id:worker.id,text:'',...(keepAttachments?{images:current.images,files:current.files}:{}),expectedRevision:revision});accept(result.draft,result.applied);return result.applied}finally{clearing.current=null}}
 useEffect(()=>onPluginFlush(flush),[flush]);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);void flush().catch(()=>{})}},[flush])
 return {...value,error,conflict,saving,edit,attach,remove,flush,resolve,prepare,clear,editVersion:generation.current,clearText:(expected:string,version:number)=>{if(generation.current===version&&decode(local.current).text===expected)change({text:''})},savedText:saved.current.text}
}
