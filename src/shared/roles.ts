import type {ApiPermission} from './api-registry'

/** Role authority is attached to an employee. Team membership only bounds a team-scoped role. */
type RolePolicy={label:string;description:string;scope:'self'|'team'|'global';requiresLocal:boolean;userManaged:boolean;appAdministrator?:boolean;permissions:'all'|readonly ApiPermission[];controls:readonly string[];schedules:readonly string[];creates:readonly string[];removes:readonly string[];assigns:readonly string[]}
const personal:ApiPermission[]=['worker','chat','identity','topology','employee.read','workspace','plugin','schedule']
export const MANAGEMENT_ROLES={
  employee:{label:'Employee',description:'使用自己的工作空间与已授权工具，接收任务；不管理其他员工。',scope:'self',requiresLocal:false,userManaged:false,permissions:personal,controls:[],schedules:[],creates:[],removes:[],assigns:[]},
  manager:{label:'Manager',description:'管理本 Team 的全部 Employee，可创建、派发任务和调整位置。',scope:'team',requiresLocal:false,userManaged:false,permissions:[...personal,'relation','host.read','employee.message','employee.configure','employee.create','employee.delete','layout.read','layout.write'],controls:['employee'],schedules:['employee'],creates:['employee'],removes:['employee'],assigns:[]},
  governor:{label:'Governor',description:'跨 Team 管理团队和员工；Governor 的任免由用户或 Secretary 操作。',scope:'global',requiresLocal:false,userManaged:false,permissions:'all',controls:['employee','manager','governor'],schedules:['employee','manager'],creates:['employee','manager'],removes:['employee','manager'],assigns:['employee','manager']},
  secretary:{label:'Secretary',description:'用户的软件执行助手，统一管理频道、排序、团队、主机、文件、插件与 Mission。',scope:'global',requiresLocal:true,userManaged:true,appAdministrator:true,permissions:'all',controls:['employee','manager','governor','secretary'],schedules:['employee','manager','governor','secretary'],creates:['employee','manager','governor'],removes:['employee','manager','governor'],assigns:['employee','manager','governor']}
} as const satisfies Record<string,RolePolicy>
export type ManagementRole=keyof typeof MANAGEMENT_ROLES
export function isManagementRole(value:unknown):value is ManagementRole{return typeof value==='string'&&Object.hasOwn(MANAGEMENT_ROLES,value)}
export function rolePolicy(role:ManagementRole|undefined):RolePolicy{
  if(role!==undefined&&!isManagementRole(role))throw Error('Invalid management role')
  return MANAGEMENT_ROLES[role??'employee']
}
export const isSupervisor=(role:ManagementRole|undefined)=>rolePolicy(role).scope!=='self'
export const roleAllows=(role:ManagementRole|undefined,permission:ApiPermission)=>{const rules=rolePolicy(role).permissions;return rules==='all'||rules.includes(permission)}
export const roleDescription=(role:ManagementRole|undefined)=>rolePolicy(role).description+(role==='secretary'?' 用户的正式目标先登记或复用 Mission，业务工作按权限委派，核对真实产物并督促到实际完成。已明确授权的操作与必要生效步骤自主执行，不反复确认；关键疑问用 question.* 请用户决定。阻塞如实报告、保留任务，未完成不能标记成功。职责细节见 core/secretary-api；Secretary 任免由用户决定。':'')+' 本人及合法下级的任务使用 mission.* / schedule.*；具体能力按需读共享文档。'
export const managementRoles=()=>Object.entries(MANAGEMENT_ROLES).map(([value,policy])=>({value,...policy,description:roleDescription(value as ManagementRole)}))
