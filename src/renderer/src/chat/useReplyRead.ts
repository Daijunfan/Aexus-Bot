import {useCallback,useEffect,useRef,useState,type RefObject} from 'react'
import type {EmployeeReply} from '../../../shared/types'
import {api} from '../api'

type Receipt={key:string;selector:string;command:string;args:Record<string,unknown>}

/** A real downward gesture reaching the tail has the same meaning as Latest messages. */
export function useReadAtBottom(root:RefObject<HTMLDivElement|null>,key:string,enabled:boolean,onRead:(passive?:boolean)=>Promise<unknown>){
  const current=useRef({enabled,onRead});current.current={enabled,onRead}
  const wake=useRef(()=>{}),reading=useRef(new Set<string>()),scope=useRef(key),[error,setError]=useState('');scope.current=key
  const acknowledge=useCallback(async(passive=false)=>{const id=scope.current;if(reading.current.has(id))return;reading.current.add(id);try{await current.current.onRead(passive);if(scope.current===id)setError('')}catch(cause){if(scope.current===id)setError((cause as Error).message)}finally{reading.current.delete(id)}},[])
  useEffect(()=>{
    const area=root.current;if(!area)return
    let armed=false,pressed=false,moved=false,busy=false,disposed=false,frame=0,timer:ReturnType<typeof setTimeout>|undefined
    setError('')
    const clear=()=>{armed=false;clearTimeout(timer);timer=undefined}
    const visible=()=>{
      if(!current.current.enabled||document.visibilityState!=='visible'||!document.hasFocus()||!area.clientHeight||area.scrollHeight-area.clientHeight-area.scrollTop>4)return false
      for(const overlay of document.querySelectorAll<HTMLElement>('[aria-modal="true"],.messenger-menu,.app-select-menu'))if(!overlay.closest('[aria-hidden="true"],[inert]')&&overlay.getBoundingClientRect().height)return false
      const box=area.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,Math.min(innerHeight-1,box.bottom-8))
      return !!hit&&area.contains(hit)
    }
    const check=()=>{
      if(disposed||!armed||busy||!visible()){clearTimeout(timer);timer=undefined;return}
      if(timer)return
      timer=setTimeout(()=>{
        timer=undefined;if(disposed||!armed||!visible())return
        armed=false;busy=true
        void acknowledge(true).finally(()=>{busy=false;if(!disposed&&armed)schedule()})
      },180)
    }
    const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(()=>{frame=0;check()})};wake.current=schedule
    const wheel=(event:WheelEvent)=>{if(event.deltaY>0){armed=true;schedule()}else if(event.deltaY<0)clear()}
    const down=(event:PointerEvent)=>{if(event.button===0){pressed=true;moved=false}}
    const up=()=>{pressed=false;if(moved)schedule()}
    const scroll=()=>{if(pressed){armed=true;moved=true}schedule()}
    const keyboard=(event:KeyboardEvent)=>{if(!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&['End','PageDown','ArrowDown',' '].includes(event.key)&&!(event.target as HTMLElement).closest('input,textarea,button,a,[contenteditable]')){armed=true;schedule()}}
    const focus=()=>{if(document.visibilityState!=='visible'||!document.hasFocus())clear()}
    const resize=new ResizeObserver(schedule);resize.observe(area)
    area.addEventListener('wheel',wheel,{passive:true});area.addEventListener('pointerdown',down);area.addEventListener('scroll',scroll,{passive:true});area.addEventListener('keydown',keyboard)
    window.addEventListener('pointerup',up);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',focus)
    return()=>{disposed=true;clear();cancelAnimationFrame(frame);resize.disconnect();area.removeEventListener('wheel',wheel);area.removeEventListener('pointerdown',down);area.removeEventListener('scroll',scroll);area.removeEventListener('keydown',keyboard);window.removeEventListener('pointerup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',focus)}
  },[root,key])
  useEffect(()=>{if(!enabled)setError('');wake.current()},[enabled,onRead])
  return {error,acknowledge}
}
/** One receipt path for every presentation. Observe late-mounted content and retry foreground races. */
export function useVisibleReceipt(root:RefObject<HTMLDivElement|null>,receipt:Receipt|undefined,enabled:boolean,renderKey?:unknown){
  useEffect(()=>{
    if(!enabled||!receipt||!root.current)return
    const transcript=root.current
    let timer:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined,sending=false,disposed=false,done=false,frame=0
    const visible=()=>{
      // Native focus is checked afresh by the IPC endpoint. Never latch a stale blur event.
      if(disposed||done||document.visibilityState!=='visible'||!document.hasFocus())return false
      const marker=transcript.querySelector<HTMLElement>(receipt.selector)
      if(!marker?.isConnected||marker.closest('[hidden]'))return false
      const r=marker.getBoundingClientRect(),t=transcript.getBoundingClientRect()
      const faded=(parseFloat(getComputedStyle(transcript).getPropertyValue('--message-read-inset'))||0)*(t.height/transcript.offsetHeight||1)
      if(!r.width||!r.height||!t.width||!t.height||r.top<t.top+faded||r.bottom>t.bottom+1||r.bottom>window.innerHeight||r.top<0)return false
      const x=Math.max(t.left+1,Math.min(t.right-1,r.left+r.width/2)),y=r.top+r.height/2
      const hit=document.elementFromPoint(x,y)
      return !!hit&&transcript.contains(hit)
    }
    const check=()=>{
      if(!visible()){clearTimeout(timer);timer=undefined;return}
      if(timer||sending||disposed||done)return
      timer=setTimeout(()=>{
        timer=undefined;if(!visible())return
        sending=true
        void api.call<{acknowledged:boolean}>(receipt.command,receipt.args).then(result=>{done=result.acknowledged}).catch(()=>{}).finally(()=>{
          sending=false
          if(!disposed&&!done)retry=setTimeout(check,250)
        })
      },650)
    }
    // Check after layout/React commits: closing an overlay or loading an image may
    // reveal the receipt without a transcript scroll or a native focus event.
    const scheduleCheck=()=>{if(!frame&&!disposed&&!done)frame=requestAnimationFrame(()=>{frame=0;check()})}
    const off=api.onEvent(event=>{if(event.channel==='desktop:visibility'){check();scheduleCheck()}})
    const mutation=new MutationObserver(scheduleCheck);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','class','open']})
    const resize=new ResizeObserver(scheduleCheck);resize.observe(transcript)
    const intersection=new IntersectionObserver(scheduleCheck,{root:transcript,threshold:[0,1]})
    let observed:Element|null=null
    const observeMarker=()=>{const marker=transcript.querySelector(receipt.selector);if(marker!==observed){if(observed)intersection.unobserve(observed);observed=marker;if(marker)intersection.observe(marker)}}
    const content=new MutationObserver(()=>{observeMarker();scheduleCheck()});content.observe(transcript,{childList:true,subtree:true})
    observeMarker();scheduleCheck()
    transcript.addEventListener('scroll',check,{passive:true})
    window.addEventListener('focus',check);window.addEventListener('blur',check);window.addEventListener('resize',check)
    document.addEventListener('visibilitychange',check);document.addEventListener('focusin',scheduleCheck);document.addEventListener('pointerup',scheduleCheck)
    return()=>{disposed=true;off();clearTimeout(timer);clearTimeout(retry);cancelAnimationFrame(frame);mutation.disconnect();content.disconnect();intersection.disconnect();resize.disconnect();transcript.removeEventListener('scroll',check);window.removeEventListener('focus',check);window.removeEventListener('blur',check);window.removeEventListener('resize',check);document.removeEventListener('visibilitychange',check);document.removeEventListener('focusin',scheduleCheck);document.removeEventListener('pointerup',scheduleCheck)}
  },[receipt?.key,enabled,root,renderKey])
}
export function useReplyRead(root:RefObject<HTMLDivElement|null>,employeeId:string|undefined,reply:EmployeeReply|undefined,enabled:boolean,presentation?:string){
  useVisibleReceipt(root,employeeId&&reply&&!reply.readAt?{key:employeeId+':'+reply.id,selector:`[data-reply-id="${reply.id}"]`,command:'session.acknowledge',args:{employee:employeeId,replyId:reply.id}}:undefined,enabled,presentation)
}
