import {memo,useContext,useEffect,useRef,useState,type CSSProperties} from 'react'
import {DEFAULT_AVATAR,isFateAvatar,type AvatarKind} from '../../../shared/office'
import {EmployeePortrait} from './EmployeePortrait'
import {Mascot} from '../office/Mascot'
import {CanvasMotion} from '../office/motion'
import {motionAllowed} from '../chat/surfaceMotion'
import portraits from '../assets/pets/portraits/manifest.json'
import {avatarFraming} from '../../../shared/avatar-framing'
import {useDisplayedAvatar} from './AvatarCatalog'

export type MessageAvatarState='idle'|'working'|'responding'|'attention'
const crops=new Map(portraits.map(portrait=>[portrait.id,portrait]))
const visibleAvatars=new Map<Element,(visible:boolean)=>void>()
let observer:IntersectionObserver|undefined
export function watchMessageAvatar(element:Element,update:(visible:boolean)=>void){
  observer??=new IntersectionObserver(entries=>{for(const entry of entries)visibleAvatars.get(entry.target)?.(entry.isIntersecting)})
  visibleAvatars.set(element,update);observer.observe(element)
  return()=>{observer?.unobserve(element);visibleAvatars.delete(element);if(!visibleAvatars.size){observer?.disconnect();observer=undefined}}
}

/** One window preference gate for the list; sprite players only run in bounded visible clips. */
export function useMessageAvatarMotion(){
  const [enabled,setEnabled]=useState(motionAllowed)
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setEnabled(motionAllowed());media.addEventListener('change',update);document.addEventListener('visibilitychange',update);return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update)}},[])
  return enabled
}

export const MessageListAvatar=memo(function MessageListAvatar({avatar=DEFAULT_AVATAR,color,state,continuous=false}:{avatar?:AvatarKind;color?:string;state:MessageAvatarState;continuous?:boolean}){
  const allowed=useContext(CanvasMotion),root=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[engaged,setEngaged]=useState(false),[playing,setPlaying]=useState(false)
  const display=useDisplayedAvatar(avatar,color),kind=display.avatar,active=state==='working'||state==='responding',portrait=crops.get(kind)
  const frame=portrait?avatarFraming(portrait.crop,portrait.frame):undefined
  const framing=frame?{'--avatar-width':frame.width,'--avatar-height':frame.height,'--avatar-left':frame.left,'--avatar-top':frame.top} as CSSProperties:undefined
  useEffect(()=>{const element=root.current;if(!element)return;return watchMessageAvatar(element,setVisible)},[])
  useEffect(()=>{const row=root.current?.closest('button');if(!row)return;const enter=()=>setEngaged(true),leave=()=>setEngaged(row.matches(':hover,:focus-visible'));row.addEventListener('pointerenter',enter);row.addEventListener('pointerleave',leave);row.addEventListener('focus',enter);row.addEventListener('blur',leave);return()=>{row.removeEventListener('pointerenter',enter);row.removeEventListener('pointerleave',leave);row.removeEventListener('focus',enter);row.removeEventListener('blur',leave)}},[])
  useEffect(()=>{
    if(!allowed||!visible||state==='attention'||!active&&!engaged){setPlaying(false);return}
    setPlaying(true);if(continuous&&active)return
    const timer=setTimeout(()=>setPlaying(false),active?1800:900)
    return()=>clearTimeout(timer)
  },[allowed,visible,state,active,engaged,continuous])
  return <span ref={root} className="message-list-avatar" data-avatar-state={state} data-avatar-playing={playing&&allowed&&visible||undefined} aria-hidden="true"><EmployeePortrait avatar={kind} color={display.color}/>{playing&&allowed&&visible&&<span className="message-avatar message-avatar-live" style={framing}><Mascot kind={kind} color={display.color} working={active} pose={active?(state==='responding'?'wave':'type'):'pickup'} compact={!isFateAvatar(kind)}/></span>}</span>
})
