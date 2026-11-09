import {useContext,useEffect,useRef,useState,type CSSProperties} from 'react'
import {CanvasMotion} from '../office/motion'
import {useMessageAvatarMotion,watchMessageAvatar} from './MessageListAvatar'
import codey from '../assets/pets/codex.webp'
import type {MessageAvatarState} from './MessageListAvatar'

/** Original OpenAI Codey atlas. Dot is independent of the employee character catalog. */
export function DotAvatar({state='idle'}:{state?:MessageAvatarState}){
 const root=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[hovered,setHovered]=useState(false),[column,setColumn]=useState(0)
 const allowed=useContext(CanvasMotion),motion=useMessageAvatarMotion(),playing=allowed&&motion&&visible
 const row=state==='working'?7:state==='responding'?8:state==='attention'?5:hovered?3:0,frames=row===3?4:row===5?8:6
 useEffect(()=>{const element=root.current;if(element)return watchMessageAvatar(element,setVisible)},[])
 useEffect(()=>{
  setColumn(0)
  if(!playing)return
  let index=0,timer:ReturnType<typeof setTimeout>
  const tick=()=>{index=(index+1)%frames;setColumn(index);timer=setTimeout(tick,row===0&&index===0?1800:140)}
  timer=setTimeout(tick,row===0?1800:140)
  return()=>clearTimeout(timer)
 },[row,frames,playing])
 return <span ref={root} className="dot-native-avatar" data-native-character="codey" data-native-state={state} data-native-playing={playing||undefined} data-native-frame={row+':'+column} onPointerEnter={()=>setHovered(true)} onPointerLeave={()=>setHovered(false)} aria-hidden="true"><span className="dot-native-cell" style={{backgroundImage:'url('+codey+')',backgroundPosition:(playing?column:0)/7*100+'% '+row/10*100+'%'} as CSSProperties}/></span>
}
