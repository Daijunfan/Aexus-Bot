import {useLayoutEffect,useRef,useState,type CSSProperties,type HTMLAttributes,type RefObject} from 'react'
import {translate as uiText} from '../i18n'

/** Provide an interaction-only horizontal track when the OS uses overlay scrollbars. */
export function ScrollArea({scrollRef,className='',children,...props}:HTMLAttributes<HTMLDivElement>&{scrollRef?:RefObject<HTMLDivElement|null>}){
 const local=useRef<HTMLDivElement>(null),ref=scrollRef??local
 const [metrics,setMetrics]=useState({width:0,total:0,left:0,overlay:false})
 useLayoutEffect(()=>{
  const el=ref.current!;let frame=0
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const style=getComputedStyle(el),nativeHeight=el.offsetHeight-el.clientHeight-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth),next={width:el.clientWidth,total:el.scrollWidth,left:el.scrollLeft,overlay:nativeHeight<4};setMetrics(previous=>Object.keys(next).every(key=>next[key as keyof typeof next]===previous[key as keyof typeof next])?previous:next)})}
  const resize=new ResizeObserver(measure),mutation=new MutationObserver(measure);resize.observe(el);mutation.observe(el,{childList:true,characterData:true,subtree:true});el.addEventListener('scroll',measure,{passive:true});measure()
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();el.removeEventListener('scroll',measure)}
 },[ref])
 const fallback=metrics.overlay&&metrics.total>metrics.width+1
 return <div className="scroll-area"><div {...props} ref={ref} className={className} data-horizontal-track={fallback||undefined}>{children}</div>{fallback&&<input className="horizontal-scroll-track" type="range" min={0} max={metrics.total-metrics.width} value={metrics.left} aria-label={uiText('Scroll horizontally')} style={{'--scroll-thumb-width':Math.max(18,metrics.width*metrics.width/metrics.total)+'px'} as CSSProperties} onChange={event=>{const el=ref.current!;el.scrollLeft=event.currentTarget.valueAsNumber;setMetrics(previous=>({...previous,left:el.scrollLeft}))}}/>}</div>
}
