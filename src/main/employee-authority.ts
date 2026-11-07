import {rolePolicy} from '../shared/roles'
import type {StoredSession} from '../shared/types'
import type {PrincipalRef} from '../shared/management'
import {readStore} from './store'
import {isAppAdministrator} from './application-authority'

/** Read-only employee scope policy; independent of execution and event dispatch. */
let indexedRevision:number|undefined,indexed:{cards:Map<string,StoredSession>}|undefined
function managementIndex(){const store=readStore();if(!indexed||indexedRevision!==store.revision){indexedRevision=store.revision;indexed={cards:new Map(store.sessions.map(card=>[card.id,card]))}}return indexed}
export function canControl(principal:PrincipalRef,targetId:string){
  if(principal.kind==='operator')return true
  const index=managementIndex(),caller=index.cards.get(principal.employeeId),target=index.cards.get(targetId)
  if(!caller||caller.deleting||!target||target.deleting)return false
  const policy=rolePolicy(caller.managementRole)
  return policy.controls.includes(target.managementRole??'employee')&&(policy.scope==='global'||policy.scope==='team'&&caller.group===target.group)
}

/** Secretary administers the user's plans; other employees schedule self or subordinates. */
export function canSchedule(principal:PrincipalRef,targetId:string){
  if(principal.kind==='operator'||isAppAdministrator(principal))return true
  const index=managementIndex(),caller=index.cards.get(principal.employeeId),target=index.cards.get(targetId)
  return !!caller&&!caller.deleting&&!!target&&!target.deleting&&(caller.id===target.id||rolePolicy(caller.managementRole).schedules.includes(target.managementRole??'employee')&&canControl(principal,targetId))
}

export function canReadEmployee(principal:PrincipalRef,id:string){return principal.kind==='operator'||principal.employeeId===id||canControl(principal,id)}
export function canDeleteEmployee(principal:PrincipalRef,id:string){
  if(principal.kind==='operator')return true
  const caller=managementIndex().cards.get(principal.employeeId),target=managementIndex().cards.get(id)
  return !!caller&&!!target&&!rolePolicy(target.managementRole).userManaged&&rolePolicy(caller.managementRole).removes.includes(target.managementRole??'employee')&&canControl(principal,id)
}

