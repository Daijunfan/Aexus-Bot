import {inheritSurfacePalette,useSurfaceMotion} from '../chat/surfaceMotion'
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {activeDialog,dialogFocusables} from '../office/useDialogFocus'

export const messageContextAnchor=(event:Pick<MouseEvent,'clientX'|'clientY'|'currentTarget'|'target'>)=>{
 const target=event.currentTarget instanceof HTMLElement?event.currentTarget:event.target instanceof Element?event.target.closest<HTMLElement>('.bubble,[data-chat-item],article'):null
 const box=!event.clientX&&!event.clientY?target?.getBoundingClientRect():undefined
 const x=box?box.left+Math.min(24,box.width/2):event.clientX,y=box?box.top+Math.min(24,box.height/2):event.clientY
 return {x:x+4,y:y+4,originX:x,originY:y}
}
export function selectedMessageText(owner:Element){const selection=getSelection(),text=selection?.toString();return text?.trim()&&selection?.anchorNode&&selection.focusNode&&owner.contains(selection.anchorNode)&&owner.contains(selection.focusNode)?text:undefined}

/** Shared pointer/keyboard menu for conversation and message actions. */
export function MessageMenu({anchor,onClose,label,children,className='',motion='menu',nativeKeys=false,role='menu',trigger,owner,busy=false}:{anchor:{x:number;y:number;originX?:number;originY?:number};onClose:()=>void;label:string;children:ReactNode;className?:string;motion?:'menu'|'file-menu';nativeKeys?:boolean;role?:'menu'|'dialog';trigger?:HTMLElement|null;owner?:HTMLElement|null;busy?:boolean}){
 const previous=useRef(document.activeElement as HTMLElement),root=useSurfaceMotion<HTMLDivElement>(motion),[point,setPoint]=useState({...anchor,scale:1}),close=useRef(onClose);close.current=onClose
 useLayoutEffect(()=>{
  const el=root.current;if(!el)return
  if(owner){owner.dataset.messageContext='true';inheritSurfacePalette(el,owner)}
  const place=()=>{
   const scale=parseFloat(getComputedStyle(document.documentElement).zoom)||1,width=el.offsetWidth,height=el.offsetHeight,viewWidth=innerWidth/scale,viewHeight=innerHeight/scale
   let x=anchor.x/scale,y=anchor.y/scale
   if(anchor.originX!==undefined&&x+width>viewWidth-8)x=(anchor.originX-4)/scale-width
   if(anchor.originY!==undefined&&y+height>viewHeight-8)y=(anchor.originY-4)/scale-height
   setPoint({x:Math.max(8,Math.min(x,viewWidth-width-8)),y:Math.max(8,Math.min(y,viewHeight-height-8)),scale})
  }
  place();const resize=new ResizeObserver(place);resize.observe(el);window.addEventListener('resize',place)
  const first=el.querySelector<HTMLElement>('input:not(:disabled):not([hidden]):not([type=hidden]),textarea:not(:disabled):not([hidden])')??el.querySelector<HTMLElement>('button[aria-checked=true]:not(:disabled)')??el.querySelector<HTMLElement>('button:not(:disabled)');first?.focus({preventScroll:true})
  return()=>{resize.disconnect();window.removeEventListener('resize',place);if(owner)delete owner.dataset.messageContext;if(el.contains(document.activeElement)){const target=trigger??previous.current;if(target?.isConnected)target.focus({preventScroll:true})}}
 },[anchor,owner,trigger])
 useEffect(()=>{
  // Nested pickers are portals too. Ownership follows aria-controls, not the body.
  const nested=()=>[...root.current?.querySelectorAll<HTMLElement>('[aria-expanded=true][aria-controls]')??[]].flatMap(control=>{const popup=document.getElementById(control.getAttribute('aria-controls')!);return popup?[{control,popup}]:[]})
  const owns=(target:Node)=>!!root.current?.contains(target)||!!trigger?.contains(target)||nested().some(({popup})=>popup.contains(target))
  const outside=(event:Event)=>{if(!owns(event.target as Node))close.current()}
  const scroll=(event:Event)=>{if(!root.current?.contains(event.target as Node)&&!nested().some(({popup})=>popup.contains(event.target as Node)))close.current()}
  const key=(event:KeyboardEvent)=>{
   if(nested().some(({control,popup})=>control.contains(event.target as Node)||popup.contains(event.target as Node)))return
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close.current();const dialog=activeDialog(),target=trigger??previous.current;if(dialog&&!dialog.contains(target))dialogFocusables(dialog)[0]?.focus({preventScroll:true});else target?.focus({preventScroll:true})}
   else if(event.key==='Tab'&&!nativeKeys)close.current()
   else if(!nativeKeys&&!(event.target instanceof HTMLElement&&(event.target.matches('input,textarea,select')||event.target.isContentEditable))){
    const buttons=[...root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]],current=document.activeElement as HTMLButtonElement,strip=current?.closest('.message-reaction-picker')
    if(strip&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const choices=[...strip.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];choices[(choices.indexOf(current)+(event.key==='ArrowRight'?1:-1)+choices.length)%choices.length]?.focus()}
    else if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const options=buttons.filter(button=>!button.closest('.message-reaction-picker')),quick=buttons.find(button=>button.closest('.message-reaction-picker')),index=options.indexOf(current);if(event.key==='Home')buttons[0]?.focus();else if(event.key==='End')buttons.at(-1)?.focus();else if(strip)(event.key==='ArrowDown'?options[0]:options.at(-1))?.focus();else if(quick&&(event.key==='ArrowUp'&&index===0||event.key==='ArrowDown'&&index===options.length-1))quick.focus();else options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus()}
   }
  }
  document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside);document.addEventListener('wheel',scroll,{capture:true,passive:true});document.addEventListener('touchmove',scroll,{capture:true,passive:true});window.addEventListener('keydown',key,true)
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);document.removeEventListener('wheel',scroll,true);document.removeEventListener('touchmove',scroll,true);window.removeEventListener('keydown',key,true)}
 },[trigger,nativeKeys])
 return createPortal(<div ref={root} className={`messenger-menu ${className}`} data-message-context-menu={owner?'true':undefined} role={role} aria-label={label} aria-busy={busy||undefined} style={{left:point.x,top:point.y,maxWidth:innerWidth/point.scale-16,maxHeight:innerHeight/point.scale-16,transformOrigin:`${Math.max(0,(anchor.originX??anchor.x)/point.scale-point.x)}px ${Math.max(0,(anchor.originY??anchor.y)/point.scale-point.y)}px`}} onClick={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>{children}</div>,document.body)
}
