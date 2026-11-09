import {useContext,useEffect,useRef,useState} from 'react'
import type {Engine} from '../../../shared/types'
import {CanvasMotion} from '../office/motion'
import {useMessageAvatarMotion,watchMessageAvatar,type MessageAvatarState} from './MessageListAvatar'
import {EngineMark} from './EngineMark'

/** Preserve the native engine mark; motion communicates this Worker's actual activity. */
export function EngineAvatar({engine,state='idle',size=34}:{engine:Engine;state?:MessageAvatarState;size?:number}){
 const root=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false),allowed=useContext(CanvasMotion),motion=useMessageAvatarMotion()
 useEffect(()=>{const element=root.current;if(element)return watchMessageAvatar(element,setVisible)},[])
 return <span ref={root} className="engine-avatar" data-avatar-state={state} data-avatar-playing={allowed&&motion&&visible&&state!=='idle'||undefined} style={{width:size,height:size}}><EngineMark engine={engine} size={size-6}/></span>
}
