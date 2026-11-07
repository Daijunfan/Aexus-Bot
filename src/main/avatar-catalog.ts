import {AVATAR_CATALOG,displayAvatar,enabledAvatarIds,listAvatars,type AvatarCatalogState} from '../shared/avatars'
import {DEFAULT_AVATAR,currentAvatar,type AvatarKind} from '../shared/office'
import {readStore,writeStore} from './store'
import {catalog as chatCatalog} from './chat-group-store'

export const activeAvatarIds=()=>enabledAvatarIds(readStore().avatarCatalog)
export function avatarCatalog(args:{id?:string;query?:string;style?:string;status?:string;all?:boolean}={}){
 const store=readStore(),enabled=enabledAvatarIds(store.avatarCatalog),revision=store.avatarCatalog?.revision??0
 const status=args.status??(args.all?'all':'active')
 if(!['active','archived','all'].includes(status))throw Error('status must be active, archived or all')
 const assigned=new Map<string,number>(),usage=new Map<string,number>()
 for(const avatar of [...store.sessions.filter(c=>!c.deleting).map(c=>c.avatar??DEFAULT_AVATAR),...chatCatalog().groups.filter(g=>g.bot?.provider==='dots').map(g=>g.bot?.avatar??DEFAULT_AVATAR)]){
  const id=currentAvatar(avatar),display=displayAvatar(avatar,enabled);assigned.set(id,(assigned.get(id)??0)+1);usage.set(display,(usage.get(display)??0)+1)
 }
 return listAvatars({query:args.query,style:args.style,all:true,enabled}).filter(item=>(!args.id||item.id===currentAvatar(args.id as AvatarKind))&&(status==='all'||enabled.includes(item.id)===(status==='active'))).map(item=>({...item,enabled:item.selectable,status:item.selectable?'active':'archived',displayId:displayAvatar(item.id,enabled),assignedCount:assigned.get(item.id)??0,usageCount:usage.get(item.id)??0,inUse:!!usage.get(item.id),revision}))
}
export function getAvatar(id:string){
 if(!id)throw Error('Character ID is required; discover IDs with avatar.list')
 const item=avatarCatalog({id,status:'all'})[0]
 if(!item)throw Error('Unknown character; discover current IDs with avatar.list --all')
 return item
}
export function updateAvatar(args:{id:string;enabled:boolean;expectedRevision?:number}){
 if(typeof args.enabled!=='boolean')throw Error('enabled must be true or false')
 const item=AVATAR_CATALOG.find(item=>item.id===currentAvatar(args.id as AvatarKind))
 if(!item)throw Error('Unknown character; discover current IDs with avatar.list --all')
 const store=readStore(),before=enabledAvatarIds(store.avatarCatalog),revision=store.avatarCatalog?.revision??0
 if(args.expectedRevision!==undefined&&args.expectedRevision!==revision)throw Error('Character catalog changed; read avatar.get and retry with its revision')
 if(before.includes(item.id)===args.enabled)return getAvatar(item.id)
 const enabled=args.enabled?[...before,item.id]:before.filter(id=>id!==item.id)
 if(!enabled.length)throw Error('Keep at least one enabled character; enable its replacement before archiving this one')
 store.avatarCatalog={revision:revision+1,enabled} satisfies AvatarCatalogState
 writeStore(store,{reconcileOffice:false})
 return getAvatar(item.id)
}
