import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {APP_HOME} from '../shared/protocol'
import {assertManagementKind,hasGlobalRole,managementRelations,emptyAccess,type ManagementRole,type PrincipalRef} from '../shared/management'
import {readStore,updateStore,writeStore} from './store'
import {employeeSettings} from '../shared/types'
import {authorize,callerEmployee,isGlobal,isAppAdministrator,publicEmployee,canControl,requestContext} from './authorization'
import {isManagementRole,isSupervisor,rolePolicy} from '../shared/roles'
import {ensureEmployeeBootstrap} from './plugins/documents'

export function initializeManagement(){
  const previous=readStore(),legacy=previous.access?.version!==2
  const legacyGlobal=(card:typeof previous.sessions[number])=>legacy&&!!previous.access?.globalManagerIds?.includes(card.id)
  const remote=(card:typeof previous.sessions[number])=>card.kind==='cloud-native-worker'||employeeSettings(previous,card).mode==='cloud'
  const invalid=previous.sessions.some(card=>remote(card)&&rolePolicy(card.managementRole).requiresLocal)
  const changedLines=JSON.stringify(previous.access?.relations??[])!==JSON.stringify(managementRelations(previous.sessions,previous.access?.bindings))
  if(!legacy&&!invalid&&!changedLines&&!previous.access?.managerTeam&&!previous.access?.globalManagerIds.length)return
  if(previous.sessions.length){mkdirSync(join(APP_HOME,'backups'),{recursive:true});writeFileSync(join(APP_HOME,'backups',`before-employee-roles-${Date.now()}.json`),JSON.stringify(previous,null,2),{mode:0o600})}
  const store=readStore();store.access??=emptyAccess();store.access.version=2
  for(const card of store.sessions){
    card.managementRole??='employee';card.accessMode??='trusted'
    if(remote(card)&&rolePolicy(card.managementRole).requiresLocal)card.managementRole='employee'
    else if(!remote(card)&&legacyGlobal(card))card.managementRole='governor'
  }
  delete store.access.managerTeam;store.access.globalManagerIds=[]
  writeStore(store)
}

export function managementTopology(creator?:string){
  const store=readStore(),principal=requestContext().principal,global=isGlobal(principal),caller=callerEmployee(principal),access=store.access??emptyAccess()
  if(creator!==undefined&&(typeof creator!=='string'||!creator.trim()))throw Error('Creator must be self, others, operator, unknown or an employee ID')
  const actions={read:'session.info',message:'session.send',configure:'config.model',delete:'card.remove',role:'card.management-role'}
  const nodes=store.sessions.filter(c=>!c.deleting&&(global||canControl(principal,c.id)||c.id===caller!.id)).map(card=>{const config=employeeSettings(store,card);return {
    ...publicEmployee(card),
    workspace:{location:config.mode==='cloud'?'cloud':'local',hostId:config.hostId,os:config.remote?.os??(process.platform==='darwin'?'macos':process.platform==='win32'?'windows':'linux'),distribution:config.remote?.distribution,directory:card.cwd},
    createdByMe:card.createdBy?card.createdBy.kind===principal.kind&&(card.createdBy.kind==='operator'||principal.kind==='agent'&&card.createdBy.employeeId===principal.employeeId):null,
    globalManager:hasGlobalRole(access,card),globalByTeam:false,
    allowedActions:Object.entries(actions).filter(([action,command])=>{try{authorize(command,{id:card.id,...(action==='role'?{role:card.managementRole??'employee'}:{})},card.id);return true}catch{return false}}).map(([action])=>action)
  }}).filter(node=>{
    if(creator===undefined)return true
    if(creator==='self')return node.createdByMe===true
    if(creator==='others')return node.createdByMe===false
    if(creator==='operator')return node.createdBy?.kind==='operator'
    if(creator==='unknown')return node.createdBy===null
    return node.createdBy?.kind==='agent'&&node.createdBy.employeeId===creator
  })
  const ids=new Set(nodes.map(node=>node.id)),relations=managementRelations(store.sessions,store.access?.bindings).filter(r=>ids.has(r.managerId)&&ids.has(r.employeeId)&&(global||isSupervisor(caller!.managementRole)||r.employeeId===caller!.id))
  return {revision:access.revision,creator,summary:{employees:nodes.length},nodes,edges:relations.filter(r=>r.state==='active'),pending:relations.filter(r=>r.state==='pending')}
}
const immutableCreationLine=()=>{throw Error('创建来源记录不可改写；旧申请和审批已停用。使用 management.bind / management.unbind 修改常驻连线，操作权限保持不变')}
export const requestManagement=(_employee:string,_manager?:string)=>immutableCreationLine()
export const decideManagement=(_id:string,_decision:string)=>immutableCreationLine()
export {bindManagement,unbindManagement} from './management-bindings'
export function setManagementRole(id:string,role:ManagementRole){
  authorize('card.management-role',{id,role},id)
  if(!isManagementRole(role))throw Error('Invalid management role')
  updateStore(store=>{const card=store.sessions.find(c=>c.id===id&&!c.deleting);if(!card)throw Error('Unknown employee');assertManagementKind({...card,managementRole:role},hasGlobalRole(store.access,card),employeeSettings(store,card).mode==='cloud');card.managementRole=role;ensureEmployeeBootstrap(card,store)});return {id,managementRole:role}
}
/** Compatibility alias; all authority still lives in managementRole. */
export function setGlobalManager(id:string,enabled:boolean){
  if(!isAppAdministrator())throw Error('Only the user or a Secretary can grant global authority')
  const card=readStore().sessions.find(card=>card.id===id);if(!card)throw Error('Unknown employee')
  const role=enabled?'governor':hasGlobalRole(undefined,card)?'manager':card.managementRole??'employee'
  const result=setManagementRole(id,role)
  return {...result,globalManager:rolePolicy(role).scope==='global'}
}

export function creationAuthority(principal:PrincipalRef){return {managementRole:'employee' as const,createdBy:principal}}
