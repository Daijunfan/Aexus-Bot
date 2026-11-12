import {memo,useContext} from 'react'
import {avatarTint,type TitanAvatar} from '../../../shared/office'
import {CanvasMotion} from './motion'
import {useMessageMotion} from '../chat/surfaceMotion'
import type {PetPose} from './usePetBehavior'
import '../styles/titan-pets.css'

const portraits=import.meta.glob<string>('../assets/pets/titan/*.webp',{eager:true,query:'?url',import:'default'})
/** Transform-only character motion uses the same visibility/activity gate as other portraits. */
export const TitanPet=memo(function TitanPet({kind,pose,working,color}:{kind:TitanAvatar;pose:PetPose;working:boolean;color?:string}){
 const motion=useContext(CanvasMotion),visible=useMessageMotion(),state=working?'working':['pickup','land','wave'].includes(pose)?'greeting':pose==='sleep'?'resting':'idle'
 return <span className="mascot official-pet titan-pet" data-avatar={kind} data-pose={pose} data-character-state={state} data-animate={motion&&visible||undefined} aria-hidden="true"><img src={portraits[`../assets/pets/titan/${kind}.webp`]} alt="" draggable={false} style={{filter:avatarTint(kind,color)}}/></span>
})
