import {useEffect,useId,useRef} from 'react'
import {createGrokAvatar,grokBody,grokColor,grokViewportScale,type GrokAvatarState} from '../assets/bots/grok-native'
import {useMessageAvatarMotion} from './MessageListAvatar'

/** The native renderer owns geometry, gaze, blink and state transitions on both clients. */
export function GrokAvatar({shape='blob',color='black',state='idle',seed}:{shape?:string;color?:string;state?:GrokAvatarState;seed?:string}){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,''),root=useRef<HTMLSpanElement>(null),canvas=useRef<HTMLSpanElement>(null),player=useRef<ReturnType<typeof createGrokAvatar>|undefined>(undefined),motion=useMessageAvatarMotion(),extent=grokViewportScale(1)*100+'%'
 useEffect(()=>{
  const element=root.current,viewport=canvas.current;if(!element||!viewport)return
  const renderer=createGrokAvatar({id:'grok-'+id,seed:seed??id,body:grokBody(shape),appearance:{ink:[0,0,0],spot:[0,0,0],cutout:true,inkPaint:grokColor(color)},size:'100%',fill:1,state,isPlaying:motion,isFollowingPointer:false})
  player.current=renderer;const detach=renderer.attach({host:element,canvas:viewport})
  return()=>{detach();player.current=undefined}
 },[id,seed,shape,color])
 useEffect(()=>player.current?.update({state,isPlaying:motion}),[state,motion])
 return <span ref={root} className="grok-native-avatar" data-native-state={state} onPointerEnter={()=>player.current?.update({isFollowingPointer:true})} onPointerLeave={()=>player.current?.update({isFollowingPointer:false})} aria-hidden="true"><span ref={canvas} className="grok-native-canvas" style={{width:extent,height:extent}}/></span>
}
