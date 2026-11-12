import {useEffect,useRef,useState,type RefObject} from 'react'

export const postsZoom=(value:number)=>Math.round(Math.max(.5,Math.min(2,Number.isFinite(value)?value:1))*100)/100

/** Pinch belongs to Posts only. Reflow around the actual post under the gesture. */
export function usePostsZoom(root:RefObject<HTMLDivElement|null>,enabled:boolean,identity:string,initial:number,onSave:(scale:number)=>void){
 const current=useRef(postsZoom(initial)),save=useRef(onSave),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),apply=useRef<(value:number,x?:number,y?:number)=>void>(()=>{}),[value,setValue]=useState(current.current)
 save.current=onSave
 useEffect(()=>{
  const element=root.current;if(!element||!enabled)return
  current.current=postsZoom(initial);setValue(current.current);element.style.setProperty('--posts-zoom',String(current.current))
  let dirty=false,frame=0,pending:{scale:number;x?:number;y?:number}|undefined,touch:{distance:number;scale:number}|undefined
  const commit=()=>{clearTimeout(timer.current);if(dirty){dirty=false;setValue(current.current);save.current(current.current)}}
  const update=()=>{
   frame=0;if(!pending)return
   const {scale,x,y}=pending;pending=undefined
   const next=postsZoom(scale),previous=current.current;if(next===previous)return
   const box=element.getBoundingClientRect(),clientX=x??box.left+box.width/2,clientY=y??box.top+box.height/2
   const rows=()=>[...element.querySelectorAll<HTMLElement>('.channel-posts-item')],anchor=document.elementFromPoint(clientX,clientY)?.closest<HTMLElement>('.channel-posts-item')??rows().find(row=>row.getBoundingClientRect().bottom>=clientY)??rows().at(-1),before=anchor?.getBoundingClientRect(),fraction=before?(clientY-before.top)/before.height:0
   element.style.setProperty('--posts-zoom',String(next));current.current=next
   if(anchor&&before)element.scrollTop+=anchor.getBoundingClientRect().top+anchor.getBoundingClientRect().height*fraction-clientY
   dirty=true;clearTimeout(timer.current);timer.current=setTimeout(commit,180)
  }
  apply.current=(scale,x,y)=>{pending={scale,x,y};if(!frame)frame=requestAnimationFrame(update)}
  const wheel=(event:WheelEvent)=>{if(!event.ctrlKey)return;event.preventDefault();apply.current((pending?.scale??current.current)*Math.exp(-event.deltaY*.008),event.clientX,event.clientY)}
  const distance=(event:TouchEvent)=>Math.hypot(event.touches[1].clientX-event.touches[0].clientX,event.touches[1].clientY-event.touches[0].clientY)
  const start=(event:TouchEvent)=>{if(event.touches.length===2)touch={distance:distance(event),scale:current.current}}
  const move=(event:TouchEvent)=>{if(!touch||event.touches.length!==2)return;event.preventDefault();apply.current(touch.scale*distance(event)/touch.distance,(event.touches[0].clientX+event.touches[1].clientX)/2,(event.touches[0].clientY+event.touches[1].clientY)/2)}
  const end=()=>{touch=undefined}
  element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('touchstart',start,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',end);element.addEventListener('touchcancel',end)
  return()=>{if(frame){cancelAnimationFrame(frame);update()}commit();element.removeEventListener('wheel',wheel);element.removeEventListener('touchstart',start);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',end);element.removeEventListener('touchcancel',end);apply.current=()=>{}}
 },[root,enabled,identity])
 return {value,change:(value:number)=>apply.current(value)}
}
