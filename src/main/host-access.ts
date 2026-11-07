import type {PrincipalRef} from '../shared/management'
import {requestContext} from './request-context'
import {isAppAdministrator} from './application-authority'
import {pluginScope} from './plugins/access'
import {defaultPluginWorkspace} from './workspaces'
import {readStore} from './store'
export function hostRights(id:string,principal:PrincipalRef=requestContext().principal){
 if(isAppAdministrator(principal))return {read:true,write:true,create:true}
 if(principal.kind!=='agent')return {read:false,write:false,create:false}
 const grant=pluginScope('cloud-hosts',defaultPluginWorkspace('cloud-hosts'),principal.employeeId).grants.find(g=>g.resourceId===(id==='@root'?id:'host:'+id)),store=readStore(),card=store.sessions.find(p=>p.id===principal.employeeId),bound=card&&store.teamSettings?.[card.group]?.hostId===id
 return grant??{read:!!bound,write:false,create:false}
}
export function hostCommandAllowed(command:string,args:Record<string,any>,principal:PrincipalRef=requestContext().principal){
 if(isAppAdministrator(principal))return true
 if(command==='host.list')return true
 if(command==='host.create')return hostRights('@root',principal).create
 if(command==='host.remove')return false
 const rights=hostRights(String(args.id),principal)
 return ['host.get','host.check','host.directories','host.fingerprints'].includes(command)?rights.read:rights.write
}
