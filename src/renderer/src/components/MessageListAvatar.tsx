import {memo,useContext,useEffect,useRef,useState,useSyncExternalStore,type CSSProperties} from 'react'
import {DEFAULT_AVATAR,isFateAvatar,type AvatarKind} from '../../../shared/office'
import {PortraitImage} from './PortraitImage'
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

const motionListeners=new Set<()=>void>();let removeMotionListeners:(()=>void)|undefined
const subscribeMotion=(listener:()=>void)=>{motionListeners.add(listener);if(!removeMotionListeners){const media=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>{for(const notify of motionListeners)notify()};media.addEventListener('change',update);document.addEventListener('visibilitychange',update);removeMotionListeners=()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update)}}return()=>{motionListeners.delete(listener);if(!motionListeners.size){removeMotionListeners?.();removeMotionListeners=undefined}}}
/** One shared window preference gate; sprite players only run in visible clips. */
export function useMessageAvatarMotion(){return useSyncExternalStore(subscribeMotion,motionAllowed)}

export const MessageListAvatar=memo(function MessageListAvatar({avatar=DEFAULT_AVATAR,color,state,className=''}:{avatar?:AvatarKind;color?:string;state:MessageAvatarState;continuous?:boolean;className?:string}){
  const allowed=useContext(CanvasMotion),root=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),[engaged,setEngaged]=useState(false),[playing,setPlaying]=useState(false)
  const motion=useMessageAvatarMotion(),display=useDisplayedAvatar(avatar,color),kind=display.avatar,active=state!=='idle',portrait=crops.get(kind)
  const frame=portrait?avatarFraming(portrait.crop,portrait.frame):undefined
  const framing=frame?{'--avatar-width':frame.width,'--avatar-height':frame.height,'--avatar-left':frame.left,'--avatar-top':frame.top} as CSSProperties:undefined
  useEffect(()=>{const element=root.current;if(!element)return;return watchMessageAvatar(element,setVisible)},[])
  useEffect(()=>{const row=root.current?.closest('button');if(!row)return;const enter=()=>setEngaged(true),leave=()=>setEngaged(row.matches(':hover,:focus-visible'));row.addEventListener('pointerenter',enter);row.addEventListener('pointerleave',leave);row.addEventListener('focus',enter);row.addEventListener('blur',leave);return()=>{row.removeEventListener('pointerenter',enter);row.removeEventListener('pointerleave',leave);row.removeEventListener('focus',enter);row.removeEventListener('blur',leave)}},[])
  useEffect(()=>{
    if(!allowed||!motion||!visible){setPlaying(false);return}
    if(active||engaged){setPlaying(true);return}
    // A quiet idle greeting; no timers or sprite players run off screen.
    setPlaying(false)
    let timer:ReturnType<typeof setTimeout>,stopped=false
    const pause=7600+Array.from(kind).reduce((sum,char)=>sum+char.charCodeAt(0),0)%2600
    const tick=()=>{if(stopped)return;setPlaying(true);timer=setTimeout(()=>{setPlaying(false);timer=setTimeout(tick,pause)},1000)}
    timer=setTimeout(tick,pause)
    return()=>{stopped=true;clearTimeout(timer)}
  },[allowed,motion,visible,state,active,engaged,kind])
  return <span ref={root} className={`message-list-avatar ${className}`} data-avatar-state={state} data-avatar-playing={playing&&allowed&&motion&&visible||undefined} onPointerEnter={()=>setEngaged(true)} onPointerLeave={()=>setEngaged(false)} aria-hidden="true"><PortraitImage avatar={kind} color={display.color}/>{playing&&allowed&&motion&&visible&&<span className="message-avatar message-avatar-live" style={framing}><Mascot kind={kind} color={display.color} working={active} pose={state==='attention'?'think':active?(state==='responding'?'wave':'type'):'pickup'} compact={!isFateAvatar(kind)}/></span>}</span>
})
