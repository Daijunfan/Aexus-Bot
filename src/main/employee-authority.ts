import {rolePolicy} from '../shared/roles'
import type {PrincipalRef} from '../shared/management'
import {employeeIndex} from './employee-index'
import {isAppAdministrator} from './application-authority'

/** Read-only employee scope policy; independent of execution and event dispatch. */
export function canControl(principal:PrincipalRef,targetId:string){
  if(principal.kind==='operator')return true
  const index=employeeIndex(),caller=index.get(principal.employeeId),target=index.get(targetId)
  if(!caller||caller.deleting||!target||target.deleting)return false
  const policy=rolePolicy(caller.managementRole)
  return policy.controls.includes(target.managementRole??'employee')&&(policy.scope==='global'||policy.scope==='team'&&caller.group===target.group)
}

/** Secretary administers the user's plans; other employees schedule self or subordinates. */
export function canSchedule(principal:PrincipalRef,targetId:string){
  if(principal.kind==='operator'||isAppAdministrator(principal))return true
  const index=employeeIndex(),caller=index.get(principal.employeeId),target=index.get(targetId)
  return !!caller&&!caller.deleting&&!!target&&!target.deleting&&(caller.id===target.id||rolePolicy(caller.managementRole).schedules.includes(target.managementRole??'employee')&&canControl(principal,targetId))
}

export function canReadEmployee(principal:PrincipalRef,id:string){return principal.kind==='operator'||principal.employeeId===id||canControl(principal,id)}
export function canDeleteEmployee(principal:PrincipalRef,id:string){
  if(principal.kind==='operator')return true
  const index=employeeIndex(),caller=index.get(principal.employeeId),target=index.get(id)
  return !!caller&&!!target&&!rolePolicy(target.managementRole).userManaged&&rolePolicy(caller.managementRole).removes.includes(target.managementRole??'employee')&&canControl(principal,id)
}

