import {useCallback,useLayoutEffect,useRef,useState,type RefObject} from 'react'
import {api} from '../api'
import type {MessageViewportHandle} from './MessageViewport'

export type ReadingPosition={following:boolean;messageId?:string;offset?:number}
const positions=new Map<string,ReadingPosition>(),writes=new Map<string,ReturnType<typeof setTimeout>>()
const storageKey=(identity:string)=>'aexus-reading-position-'+(api.mode==='web'?sessionStorage.getItem('agents-company-client'):'desktop')+':'+identity
export function readingPosition(identity?:string){
 if(!identity)return
 if(positions.has(identity))return positions.get(identity)
 try{const value=JSON.parse(localStorage.getItem(storageKey(identity))??'null');if(value&&typeof value.following==='boolean'&&(value.following||typeof value.messageId==='string'&&Number.isFinite(value.offset))){positions.set(identity,value);return value as ReadingPosition}}catch{}
}
function flush(identity:string){clearTimeout(writes.get(identity));writes.delete(identity);const value=positions.get(identity);if(value)try{localStorage.setItem(storageKey(identity),JSON.stringify(value))}catch{}}
function save(identity:string,value:ReadingPosition){positions.set(identity,value);clearTimeout(writes.get(identity));writes.set(identity,setTimeout(()=>flush(identity),250))}

/** Reading cameras stay on this client; only message IDs and viewport offsets are retained. */
export function useReadingPosition({identity,initial,ready,items,root,viewport,skip=false,onRestore}:{identity?:string;initial?:ReadingPosition;ready:boolean;items:readonly{id:string}[];root:RefObject<HTMLDivElement|null>;viewport?:RefObject<MessageViewportHandle|null>;skip?:boolean;onRestore:(following:boolean)=>void}){
 const [status,setStatus]=useState({identity,done:false})
 if(status.identity!==identity)setStatus({identity,done:false})
 const restoring=!!identity&&!!initial&&!skip&&(status.identity!==identity||!status.done)
 const callbacks=useRef({ready,restoring,onRestore});callbacks.current={ready,restoring,onRestore}
 const remember=useCallback(()=>{
  const el=root.current,current=callbacks.current
  if(!identity||!el||el.dataset.readingKey!==identity||!current.ready||current.restoring)return
  if(el.scrollHeight-el.clientHeight-el.scrollTop<6){save(identity,{following:true});return}
  const box=el.getBoundingClientRect(),style=getComputedStyle(el),scale=box.height/parseFloat(style.height)||1,fade=(parseFloat(style.getPropertyValue('--message-read-inset'))||0)*scale
  const row=[...el.querySelectorAll<HTMLElement>('[data-chat-item]')].find(node=>{const rect=node.getBoundingClientRect();return rect.bottom>box.top+el.clientTop*scale+fade+1&&rect.top<box.bottom})
  if(row?.dataset.chatItem)save(identity,{following:false,messageId:row.dataset.chatItem,offset:(row.getBoundingClientRect().top-box.top)/scale-el.clientTop})
 },[identity,root])
 const anchorPresent=!!initial?.messageId&&items.some(item=>item.id===initial.messageId)
 useLayoutEffect(()=>{
  if(!identity)return
  if(skip){if(!status.done)setStatus({identity,done:true});return}
  if(!ready||!initial||!restoring)return
  const controller=new AbortController()
  callbacks.current.onRestore(initial.following||!anchorPresent)
  const done=()=>{if(!controller.signal.aborted)setStatus({identity,done:true})}
  if(initial.following||!anchorPresent){if(viewport?.current)viewport.current.scrollToEnd();else if(root.current)root.current.scrollTop=root.current.scrollHeight;done()}
  else if(viewport?.current)void viewport.current.scrollToMessage(initial.messageId!,{block:'start',offset:initial.offset,signal:controller.signal}).then(done)
  else requestAnimationFrame(()=>{
   if(controller.signal.aborted)return
   // Let the restored unread boundary commit before measuring this non-virtual row.
   const area=root.current,node=area?.querySelector<HTMLElement>(`[data-chat-item="${CSS.escape(initial.messageId!)}"]`)
   if(area&&node){const scale=area.getBoundingClientRect().height/area.offsetHeight||1;area.scrollTop+=(node.getBoundingClientRect().top-area.getBoundingClientRect().top)/scale-(initial.offset??0)-area.clientTop}
   done()
  })
  return()=>controller.abort()
 },[identity,ready,initial,skip,restoring,anchorPresent,viewport])
 useLayoutEffect(()=>{if(ready&&!restoring)remember()},[identity,ready,restoring,items,remember])
 useLayoutEffect(()=>{
  const el=root.current;if(!identity||!el)return
  const leave=()=>{remember();flush(identity)}
  const action=(event:Event)=>{if(!el.contains(event.target as Node))remember()}
  const key=(event:KeyboardEvent)=>{if(['Enter',' '].includes(event.key)&&!(event.target as Element)?.closest('input,textarea,[contenteditable=true]'))action(event)}
  window.addEventListener('pagehide',leave)
  document.addEventListener('pointerdown',action,true);document.addEventListener('keydown',key,true)
  return()=>{remember();window.removeEventListener('pagehide',leave);document.removeEventListener('pointerdown',action,true);document.removeEventListener('keydown',key,true);flush(identity)}
 },[identity,ready,root,remember])
 return {restoring,remember,cancelRestore:()=>{if(restoring)setStatus({identity,done:true})}}
}
