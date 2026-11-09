import {isAppAdministrator} from './application-authority'
import {readStore} from './store'
import {requestContext} from './authorization'
import {employeeSettings} from '../shared/types'
import type {WorkspaceChoice} from '../shared/message-collaboration'

export function workspaceCatalog(args:Record<string,any>){
 const principal=requestContext().principal,employee=args.employee==='self'||args.employee===undefined?(principal.kind==='agent'?principal.employeeId:undefined):args.employee
 if(!employee||!isAppAdministrator(principal)&&principal.kind==='agent'&&employee!==principal.employeeId)throw Error('Choose your own employee identity; the user supplies employee explicitly')
 const store=readStore(),card=store.sessions.find(card=>card.id===employee&&!card.deleting)
 if(!card)throw Error('Unknown employee')
 const settings=employeeSettings(store,card),base={employeeId:card.id,employeeName:card.title,team:card.group}
 const workspaces:WorkspaceChoice[]=[{...base,id:'company:'+card.id,view:'company',name:card.group+' / '+card.title,path:card.cwd,location:settings.mode==='cloud'?'remote':'core',nativeAccess:settings.mode!=='cloud'||card.kind==='cloud-native-worker',fileApi:{command:'workspace.list',args:{employee:card.id,path:'.'}}}]

 return {employeeId:employee,workspaces,total:workspaces.length}
}
