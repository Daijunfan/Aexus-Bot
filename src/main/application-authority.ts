import {rolePolicy} from '../shared/roles'
import type {PrincipalRef} from '../shared/management'
import {employeeIndex} from './employee-index'
import {requestContext} from './request-context'

/** Application administration keeps the authenticated Agent identity and audit author. */
export function isAppAdministrator(principal:PrincipalRef=requestContext().principal){
 if(principal.kind==='operator')return true
 const card=employeeIndex().get(principal.employeeId)
 return !!rolePolicy(card&&!card.deleting?card.managementRole:undefined).appAdministrator
}
export function requireAppAdministrator(){if(!isAppAdministrator())throw Error('Only the user or a Secretary may administer the application')}
