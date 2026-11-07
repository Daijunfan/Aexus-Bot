import {rolePolicy} from '../shared/roles'
import type {PrincipalRef} from '../shared/management'
import {readStore} from './store'
import {requestContext} from './request-context'

/** Application administration keeps the authenticated Agent identity and audit author. */
export function isAppAdministrator(principal:PrincipalRef=requestContext().principal){
 return principal.kind==='operator'||!!rolePolicy(readStore().sessions.find(card=>card.id===principal.employeeId&&!card.deleting)?.managementRole).appAdministrator
}
export function requireAppAdministrator(){if(!isAppAdministrator())throw Error('Only the user or a Secretary may administer the application')}
