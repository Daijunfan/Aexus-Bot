import {useEffect,useLayoutEffect,useRef,useState} from 'react'
/** Draft locally at display rate; commit only after the captured pointer is released. */
export function PanelDivider({axis,value,revision,min,max,label,onDraft,onCommit}:{axis:'x'|'y';value:number;revision?:number;min:number;max:number;label:string;onDraft:(value:number|undefined)=>void;onCommit:(value:number)=>Promise<unknown>}){
 const drag=useRef<{pointer:number;start:number;size:number;value:number;scale:number;element:HTMLDivElement}|null>(null),frame=useRef(0),callbacks=useRef({onDraft,onCommit}),[error,setError]=useState('');callbacks.current={onDraft,onCommit}
 const intent=useRef(value),authoritative=useRef(value),authoritativeRevision=useRef(revision),saving=useRef(false),queued=useRef<number|undefined>(undefined)
 if(authoritative.current!==value||authoritativeRevision.current!==revision){authoritative.current=value;authoritativeRevision.current=revision;if(!saving.current&&!drag.current)intent.current=value}
 // A fresh authority snapshot can repeat the same number after coalesced writes.
 useLayoutEffect(()=>{if(drag.current)return;if(saving.current)callbacks.current.onDraft(intent.current);else {intent.current=value;callbacks.current.onDraft(undefined)}},[value,revision])
 const bound=(v:number)=>Math.round(Math.max(min,Math.min(max,v)))
 const restore=()=>{if(!saving.current)intent.current=authoritative.current;callbacks.current.onDraft(saving.current?intent.current:undefined)}
 const cancel=()=>{const d=drag.current;if(!d)return;drag.current=null;cancelAnimationFrame(frame.current);if(d.element.hasPointerCapture(d.pointer))d.element.releasePointerCapture(d.pointer);restore()}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&drag.current){e.preventDefault();e.stopPropagation();cancel()}};window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);cancelAnimationFrame(frame.current);callbacks.current.onDraft(undefined)}},[])
 const save=async(v:number)=>{
  // Keep one latest target behind the active write; each key still accumulates its full delta.
  intent.current=v;queued.current=v;callbacks.current.onDraft(v);setError('');if(saving.current)return;saving.current=true
  while(queued.current!==undefined){const next=queued.current;queued.current=undefined;try{await callbacks.current.onCommit(next);setError('')}catch(e){setError((e as Error).message);if(queued.current===undefined&&!drag.current){intent.current=authoritative.current;callbacks.current.onDraft(undefined)}}}
  saving.current=false;if(!drag.current&&authoritative.current===intent.current)callbacks.current.onDraft(undefined)
 }
 const next=(d:NonNullable<typeof drag.current>,coordinate:number)=>bound(d.size+(coordinate-d.start)/d.scale*(axis==='x'?1:-1))
 return <><div className={`panel-divider divider-${axis}`} role="separator" aria-label={label} aria-orientation={axis==='x'?'vertical':'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(drag.current?.value??intent.current)} tabIndex={0}
  onPointerDown={e=>{if(drag.current||e.button!==0||!e.isPrimary)return;e.preventDefault();e.stopPropagation();const parent=e.currentTarget.parentElement!,pane=(axis==='x'?parent.querySelector<HTMLElement>('.file-list'):parent)??parent,box=pane.getBoundingClientRect(),size=axis==='x'?pane.offsetWidth:pane.offsetHeight;drag.current={pointer:e.pointerId,start:axis==='x'?e.clientX:e.clientY,size,value:size,scale:(axis==='x'?box.width:box.height)/size||1,element:e.currentTarget};e.currentTarget.setPointerCapture(e.pointerId)}}
  onPointerMove={e=>{const d=drag.current;if(!d||e.pointerId!==d.pointer)return;d.value=next(d,axis==='x'?e.clientX:e.clientY);cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>callbacks.current.onDraft(d.value))}}
  onPointerUp={e=>{const d=drag.current;if(!d||e.pointerId!==d.pointer)return;drag.current=null;cancelAnimationFrame(frame.current);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);d.value=next(d,axis==='x'?e.clientX:e.clientY);if(d.value===d.size){restore();return}void save(d.value)}}
  onPointerCancel={e=>{if(e.pointerId===drag.current?.pointer)cancel()}} onLostPointerCapture={e=>{if(e.pointerId===drag.current?.pointer)cancel()}}
  onKeyDown={e=>{const decrease=axis==='x'?'ArrowLeft':'ArrowDown',increase=axis==='x'?'ArrowRight':'ArrowUp';if([decrease,increase,'Home','End'].includes(e.key)){e.preventDefault();if(drag.current)return;void save(e.key==='Home'?min:e.key==='End'?max:bound(intent.current+(e.key===increase?10:-10)))}}}/>{error&&<span className="resize-error" role="alert">{error}</span>}</>
}
