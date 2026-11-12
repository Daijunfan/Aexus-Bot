import {useLayoutEffect,useRef,type RefObject} from 'react'
import {playMessageMotion} from './surfaceMotion'

/** One compositor-driven highlight follows selection without moving or cloning content. */
export function useSelectionMotion(root:RefObject<HTMLElement|null>,selector:string,identity:string){
 const selection=useRef(selector),measure=useRef<(animate:boolean)=>void>(()=>{})
 selection.current=selector
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return
  const highlight=document.createElement('span');highlight.className='message-selection-glider';highlight.setAttribute('aria-hidden','true');highlight.inert=true;element.prepend(highlight);element.dataset.selectionMotion='true'
  let positioned=false,animation:Animation|undefined
  measure.current=animate=>{
   const target=element.querySelector<HTMLElement>(selection.current)
   if(!target){highlight.hidden=true;positioned=false;animation?.cancel();return}
   const box=element.getBoundingClientRect(),rect=target.getBoundingClientRect(),zoom=box.width/element.offsetWidth||1
   const next={transform:`translate3d(${(rect.left-box.left)/zoom+element.scrollLeft}px,${(rect.top-box.top)/zoom+element.scrollTop}px,0)`,width:rect.width/zoom+'px',height:rect.height/zoom+'px'}
   const style=getComputedStyle(highlight),previous=(style.transform==='none'?'':style.transform)+` scale(${parseFloat(style.width)/parseFloat(next.width)||1},${parseFloat(style.height)/parseFloat(next.height)||1})`
   animation?.cancel();highlight.hidden=false;Object.assign(highlight.style,next)
   if(animate&&positioned&&!element.hasAttribute('data-sorting'))animation=playMessageMotion(highlight,[{transform:previous},{transform:next.transform}],280)
   positioned=true
  }
  measure.current(false)
  const observer=new ResizeObserver(()=>measure.current(false));observer.observe(element)
  return()=>{observer.disconnect();animation?.cancel();highlight.remove();delete element.dataset.selectionMotion;measure.current=()=>{}}
 },[root])
 useLayoutEffect(()=>{measure.current(true)},[identity,selector])
}
