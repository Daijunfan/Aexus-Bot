import {createContext,useContext} from 'react'
import {displayAvatar,enabledAvatarIds,type AvatarCatalogState} from '../../../shared/avatars'
import {DEFAULT_AVATAR,SPRITE_COLORS,currentAvatar,type AvatarKind,type SpriteAvatar} from '../../../shared/office'

export const AvatarCatalogContext=createContext<AvatarCatalogState|undefined>(undefined)
export const useEnabledAvatars=()=>enabledAvatarIds(useContext(AvatarCatalogContext))
export function useDisplayedAvatar(avatar:AvatarKind=DEFAULT_AVATAR,color?:string){
 const selected=displayAvatar(avatar,useEnabledAvatars()) as SpriteAvatar
 return {avatar:selected,color:selected===currentAvatar(avatar)?color:SPRITE_COLORS[selected]}
}
