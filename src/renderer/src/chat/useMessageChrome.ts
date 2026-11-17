import {useLayoutEffect,useRef,type RefObject} from 'react'

/** Keep one full-height transcript behind floating controls, including variable-height drafts. */
export function useMessageChrome(transcript:RefObject<HTMLDivElement|null>,identity:string|undefined,enabled:boolean,following:()=>boolean,onReading:()=>void,onScroll?:(top:number)=>void){
 const current=useRef({following,onReading,onScroll,watched:new WeakSet<Animation>()}),refresh=useRef<(()=>void)|null>(null),painted=useRef<HTMLElement|null>(null);current.current.following=following;current.current.onReading=onReading;current.current.onScroll=onScroll
 useLayoutEffect(()=>{
  const area=transcript.current,root=area?.closest<HTMLElement>('.group-conversation,.session-main')
  const previous=painted.current
  // Reading-position cleanup runs before the next setup. Do not reflow its departing transcript.
  if(previous&&(!enabled||root!==previous)){delete previous.dataset.floatingMessages;previous.style.removeProperty('--message-read-inset');previous.style.removeProperty('--message-read-bottom-inset');painted.current=null}
  if(!enabled||!area||!root)return
  const composer=root.querySelector<HTMLElement>('.group-composer,.composer');if(!composer)return
  root.dataset.floatingMessages='';painted.current=root
  const observed=new Set<Element>(),observer=new ResizeObserver(()=>measure())
  const observe=(node:Element)=>{if(!observed.has(node)){observed.add(node);observer.observe(node)}}
  let previousTop:number|undefined,previousBottom:number|undefined
  const measure=()=>{
   if(current.current.following())area.style.removeProperty('--message-leading-space')
   const bounds=root.getBoundingClientRect(),scale=bounds.height/root.offsetHeight||1
   let edge=bounds.top
   // Private headers sit outside message-chat-body; groups keep their strips beside the feed.
   for(let node:HTMLElement|null=area;node&&node!==root;node=node.parentElement){
    for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling){
     const style=getComputedStyle(sibling);if(style.position==='absolute'||style.position==='fixed'||sibling.hasAttribute('data-message-spacer'))continue
     observe(sibling);const box=sibling.getBoundingClientRect()
     if(box.height)edge=Math.max(edge,box.bottom+(parseFloat(style.marginBottom)||0)*scale)
    }
   }
   const field=composer.querySelector<HTMLTextAreaElement>('textarea')
   const running=field?field.getAnimations().filter(a=>a.playState==='running'):[]
   for(const a of running)if(!current.current.watched.has(a)){
    current.current.watched.add(a)
    void a.finished.then(()=>{if(refresh.current===measure)measure()},()=>{})
   }
   let targetDelta=0
   if(field?.style.height&&running.length>0){
    const cs=getComputedStyle(field),minH=parseFloat(cs.minHeight)||0,maxH=parseFloat(cs.maxHeight)||Infinity
    const targetH=Math.max(minH,Math.min(parseFloat(field.style.height)||0,maxH)),currentH=field.getBoundingClientRect().height/scale
    const box=field.parentElement
    const boxStyle=box&&box!==composer?getComputedStyle(box):null
    if(box&&boxStyle&&boxStyle.display.includes('flex')&&!boxStyle.flexDirection.startsWith('column')){
     let siblingFloor=0
     for(const child of box.children){
      if(child===field)continue
      const childStyle=getComputedStyle(child)
      const stretched=childStyle.alignSelf==='stretch'||(childStyle.alignSelf==='auto'&&boxStyle.alignItems==='stretch')
      if(!stretched)siblingFloor=Math.max(siblingFloor,child.getBoundingClientRect().height/scale)
     }
     const chrome=(parseFloat(boxStyle.paddingTop)||0)+(parseFloat(boxStyle.paddingBottom)||0)+(parseFloat(boxStyle.borderTopWidth)||0)+(parseFloat(boxStyle.borderBottomWidth)||0)
     const boxMin=parseFloat(boxStyle.minHeight)||0
     const targetContent=Math.max(targetH,siblingFloor)
     const targetBoxH=boxStyle.boxSizing==='border-box'?Math.max(boxMin,targetContent+chrome):Math.max(boxMin,targetContent)+chrome
     targetDelta=targetBoxH-box.getBoundingClientRect().height/scale
    }else targetDelta=targetH-currentH
   }
   const top=Math.round((edge-bounds.top)/scale+12),bottom=Math.round((bounds.bottom-composer.getBoundingClientRect().top)/scale+targetDelta+12)
   if(top===previousTop&&bottom===previousBottom)return
   const keepEnd=current.current.following(),scroll=area.scrollTop,oldTop=previousTop
   root.style.setProperty('--message-read-inset',top+'px');root.style.setProperty('--message-read-bottom-inset',bottom+'px')
   previousTop=top;previousBottom=bottom
   if(oldTop!==undefined){area.scrollTop=keepEnd?area.scrollHeight:scroll+top-oldTop;current.current.onScroll?.(area.scrollTop)}
  }
  const changes=new MutationObserver(()=>measure())
  for(let node:HTMLElement|null=area.parentElement;node;node=node.parentElement){changes.observe(node,{childList:true});if(node===root)break}
  // A short history grows into the free leading space; hold it while the user reads/selects.
  const holdLeading=()=>area.style.setProperty('--message-leading-space',getComputedStyle(area,'::before').height)
  const wheel=(event:WheelEvent)=>{if(event.deltaY<0)holdLeading()}
  const selecting=()=>{const selection=getSelection();if(selection&&!selection.isCollapsed&&area.contains(selection.anchorNode)&&area.contains(selection.focusNode)){holdLeading();current.current.onReading()}}
  area.addEventListener('pointerdown',holdLeading);area.addEventListener('wheel',wheel,{passive:true})
  document.addEventListener('selectionchange',selecting)
  observe(root);observe(composer);refresh.current=measure;measure()
  return()=>{document.removeEventListener('selectionchange',selecting);area.removeEventListener('pointerdown',holdLeading);area.removeEventListener('wheel',wheel);changes.disconnect();observer.disconnect();refresh.current=null}
 },[transcript,identity,enabled])
 useLayoutEffect(()=>{refresh.current?.()})
}
