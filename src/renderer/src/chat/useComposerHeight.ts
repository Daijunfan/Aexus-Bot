import {useCallback,useLayoutEffect,useRef,type RefObject} from 'react'
import {motionAllowed,playMessageMotion} from './surfaceMotion'

/** Text can wrap after resizing or opening a panel even when the draft did not change. */
export function useComposerHeight(input:RefObject<HTMLTextAreaElement|null>,value:string,enabled=true,identity?:string,animated=false){
  const animation=useRef<Animation|null>(null),last=useRef<string|undefined>(undefined)
  const resize=useCallback(()=>{const el=input.current;if(enabled&&el){
    if(!animated){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,180)+'px';return}
    const previous=animation.current?.playState==='running'?el.getBoundingClientRect().height:parseFloat(el.style.height)||el.getBoundingClientRect().height,same=last.current===identity;last.current=identity
    animation.current?.cancel();el.style.height='auto';const next=Math.min(el.scrollHeight,180);el.style.height=next+'px'
    if(animated&&same&&motionAllowed()&&Math.abs(previous-next)>1)animation.current=playMessageMotion(el,[{height:previous+'px'},{height:next+'px'}],150)??null
  }},[input,enabled,identity,animated])
  useLayoutEffect(resize,[value,identity,resize])
  useLayoutEffect(()=>{
    const el=input.current;if(!enabled||!el)return
    let width=el.clientWidth
    const observer=new ResizeObserver(()=>{if(el.clientWidth!==width){width=el.clientWidth;resize()}})
    observer.observe(el);return()=>observer.disconnect()
  },[input,enabled,identity,resize])
  useLayoutEffect(()=>()=>animation.current?.cancel(),[])
}
