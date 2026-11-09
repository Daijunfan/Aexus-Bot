import {Mascot} from '../office/Mascot'
import {CanvasMotion} from '../office/motion'
import {memo} from 'react'
import {useDisplayedAvatar} from './AvatarCatalog'
import {avatarTint,type AvatarKind} from '../../../shared/office'
const portraits=import.meta.glob<string>('../assets/pets/portraits/*.webp',{eager:true,query:'?url',import:'default'})
/** Static face/silhouette crops have their own framing, independent of canvas animation boxes. */
export const PortraitImage=memo(function PortraitImage({avatar,color}:{avatar?:AvatarKind;color?:string}){
 const display=useDisplayedAvatar(avatar,color),id=display.avatar,url=portraits[`../assets/pets/portraits/${id}.webp`]
 return <span className="message-avatar portrait-image" data-portrait={id}>{url?<img src={url} alt="" aria-hidden="true" loading="lazy" decoding="async" style={{filter:avatarTint(id,display.color)}}/>:<CanvasMotion.Provider value={false}><Mascot compact kind={id} color={display.color} pose="pickup"/></CanvasMotion.Provider>}</span>
})
