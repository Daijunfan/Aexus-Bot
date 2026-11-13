import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react'

const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'})
/** Only 1–3 complete emoji graphemes get the expressive bubble treatment. */
export function emojiCount(text:string){
 const parts=[...graphemes.segment(text.trim())].map(part=>part.segment).filter(part=>part.trim())
 return parts.length>0&&parts.length<=3&&parts.every(part=>/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(part)&&/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\uFE0F\u20e3\d#*\u{E0020}-\u{E007F}]+$/u.test(part))?parts.length:undefined
}

type Groupable={id:string;author:string;time?:number|null;break?:boolean;breakBefore?:boolean}
export type BubbleGroup='single'|'first'|'middle'|'last'

/** Group only adjacent, visible messages with a known, same-day time interval. */
export function messageGroups(items:Groupable[]):Map<string,BubbleGroup>{
  const joins=(a?:Groupable,b?:Groupable)=>!!a&&!!b&&!a.break&&!b.break&&!b.breakBefore&&a.author===b.author&&!!a.time&&!!b.time&&b.time>=a.time&&b.time-a.time<5*60_000&&new Date(a.time).toDateString()===new Date(b.time).toDateString()
  return new Map(items.map((item,index)=>{
    const previous=joins(items[index-1],item),next=joins(item,items[index+1])
    return [item.id,previous?(next?'middle':'last'):(next?'first':'single')]
  }))
}

/** Long text and illustrated reports share one reading measure; brief replies stay compact. */
export const messageLayout=(text:string)=>text.trim().length>160||text.includes('\n')?'reading':'compact'

type MotionMessage={id:string;outgoing:boolean;text?:string}
type SendOrigin={box:DOMRect;text:string;time:number}

/** Only new, visible appends enter. Streaming, history loads and restores never replay. */
export function useMessageMotion({conversation,ready,items,transcript,composer,following}:{conversation?:string;ready:boolean;items:MotionMessage[];transcript:RefObject<HTMLDivElement|null>;composer:RefObject<HTMLTextAreaElement|null>;following:()=>boolean}){
 const previous=useRef<{conversation?:string;ids:string[]}|null>(null),origin=useRef<SendOrigin|null>(null)
 const running=useRef(new Set<Animation>()),pending=useRef(new Map<string,MotionMessage>()),frame=useRef(0),reduced=useRef(false)
 const current=useRef({following,transcript});current.current={following,transcript}
 const cancel=()=>{cancelAnimationFrame(frame.current);frame.current=0;pending.current.clear();for(const animation of running.current)animation.cancel();running.current.clear()}
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>{reduced.current=media.matches;if(reduced.current||document.hidden){origin.current=null;cancel()}}
  update();media.addEventListener('change',update);document.addEventListener('visibilitychange',update)
  return()=>{cancel();media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update)}
 },[])
 useLayoutEffect(()=>{
  const last=previous.current
  if(ready&&last&&last.conversation===conversation&&last.ids.length===items.length&&last.ids.at(-1)===items.at(-1)?.id)return
  const ids=items.map(item=>item.id);previous.current=ready?{conversation,ids}:null
  if(!ready||!conversation||last?.conversation!==conversation){origin.current=null;cancel();return}
  const oldEnd=last.ids.at(-1),position=oldEnd?ids.indexOf(oldEnd):-1
  if(oldEnd&&position<0)return
  const seen=new Set(last.ids),added=items.slice(position+1).filter(item=>!seen.has(item.id))
  if(!added.length)return
  if(document.hidden||reduced.current||!following()){origin.current=null;return}
  for(const item of added.slice(-6))pending.current.set(item.id,item)
  if(frame.current)return
  let attempts=0
  const enter=()=>{
   frame.current=0
   const el=current.current.transcript.current
   if(!el||document.hidden||reduced.current||!current.current.following()){cancel();return}
   const bounds=el.getBoundingClientRect(),nodes=new Map([...el.querySelectorAll<HTMLElement>('[data-chat-item]')].map(node=>[node.dataset.chatItem,node]))
   for(const [id,item] of pending.current){
    const row=nodes.get(id),bubble=row?.querySelector<HTMLElement>(':scope > .bubble')??row
    if(!bubble)continue
    if(row?.classList.contains('message-hidden')||row?.classList.contains('group-message-withdrawn')){pending.current.delete(id);continue}
    const rect=bubble.getBoundingClientRect();if(rect.bottom<=bounds.top||rect.top>=bounds.bottom)continue
    pending.current.delete(id)
    const from=origin.current,isSend=!!(item.outgoing&&from&&Date.now()-from.time<3000&&item.text?.trim()===from.text),short=rect.height<240
    if(isSend)origin.current=null
    const x=isSend&&short?Math.max(-12,Math.min(12,from!.box.right-rect.right)):0,y=isSend&&short?Math.max(10,Math.min(32,from!.box.bottom-rect.bottom)):10
    const animation=bubble.animate([{transform:`translate3d(${x}px,${y}px,0)${short?' scale(.985)':''}`,opacity:.25,transformOrigin:item.outgoing?'bottom right':'bottom left'},{transform:'none',opacity:1}],{duration:isSend?260:220,easing:'cubic-bezier(.22,1,.36,1)'})
    running.current.add(animation);const cleanup=()=>running.current.delete(animation);animation.addEventListener('finish',cleanup,{once:true});animation.addEventListener('cancel',cleanup,{once:true})
    row!.dataset.messageArrival=isSend?'send':'incoming'
   }
   // Virtual rows may mount a frame after their parent commits and follows the append.
   if(pending.current.size&&++attempts<6)frame.current=requestAnimationFrame(enter);else pending.current.clear()
  }
  frame.current=requestAnimationFrame(enter)
 },[conversation,ready,items])
 return (text:string)=>{
  const box=composer.current?.closest('.composer-box,.group-compose-box')?.getBoundingClientRect(),ticket=box?{box,text:text.trim(),time:Date.now()}:null
  origin.current=ticket;return()=>{if(origin.current===ticket)origin.current=null}
 }
}
