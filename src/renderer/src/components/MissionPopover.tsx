import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react'
import {createPortal} from 'react-dom'
import {useDialogFocus} from '../office/useDialogFocus'
import {useSurfaceMotion} from '../chat/surfaceMotion'

/** One anchored surface for Mission forms; nested selects retain their own focus/escape. */
export function MissionPopover({anchor,label,className='',onClose,children,initialFocus}:{anchor:RefObject<HTMLElement|null>;label:string;className?:string;onClose:()=>void;children:ReactNode;initialFocus?:string}){
 const id=useId().replaceAll(':',''),panel=useRef<HTMLElement>(null),motion=useSurfaceMotion<HTMLElement>('file-menu'),[position,setPosition]=useState({left:8,top:8,maxWidth:innerWidth-16,maxHeight:innerHeight-16})
 useDialogFocus(`[data-mission-popover="${id}"]`,true,()=>anchor.current,initialFocus)
 useLayoutEffect(()=>{const place=()=>{if(!anchor.current||!panel.current)return;const scale=parseFloat(getComputedStyle(document.documentElement).zoom)||1,box=anchor.current.getBoundingClientRect(),maxWidth=innerWidth/scale-20,maxHeight=innerHeight/scale-20,width=Math.min(panel.current.offsetWidth,maxWidth),height=Math.min(panel.current.offsetHeight,maxHeight);setPosition({left:Math.max(10,Math.min(box.right/scale-width,innerWidth/scale-width-10)),top:Math.max(10,Math.min(box.bottom/scale+8,innerHeight/scale-height-10)),maxWidth,maxHeight})};place();const resize=new ResizeObserver(place);resize.observe(panel.current!);window.addEventListener('resize',place);return()=>{resize.disconnect();window.removeEventListener('resize',place)}},[anchor])
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&!document.querySelector('.app-select-menu:not([inert])')){event.preventDefault();onClose()}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[onClose])
 return createPortal(<div className="mission-popover-overlay"><div className="mission-popover-backdrop" onClick={onClose}/><section ref={node=>{panel.current=node;motion.current=node}} data-mission-popover={id} className={'mission-popover '+className} role="dialog" aria-modal="true" aria-label={label} style={position}>{children}</section></div>,document.body)
}
