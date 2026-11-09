import {createContext,memo,useContext} from 'react'
import type {AvatarKind} from '../../../shared/office'
import {MessageListAvatar,type MessageAvatarState} from './MessageListAvatar'

/** Presentation state only; the employee ID keeps shared artwork from sharing task state. */
export const CharacterActivityContext=createContext<Record<string,MessageAvatarState>>({})
export const EmployeePortrait=memo(function EmployeePortrait({avatar,color,large=false,employeeId,state}:{avatar?:AvatarKind;color?:string;large?:boolean;employeeId?:string;state?:MessageAvatarState}){
 const activity=useContext(CharacterActivityContext)
 return <MessageListAvatar avatar={avatar} color={color} state={state??(employeeId?activity[employeeId]:undefined)??'idle'} className={`message-avatar employee-portrait${large?' large':''}`}/>
})
