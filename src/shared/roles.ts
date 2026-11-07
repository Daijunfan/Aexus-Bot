import {BOT_WORKER_GUIDANCE} from './bot-workers.ts'
import {MESSAGE_REPLY_GUIDANCE} from './message-source.ts'
import type {ApiPermission} from './api-registry'

/** Role authority is attached to an employee. Team membership only bounds a team-scoped role. */
type RolePolicy={label:string;description:string;scope:'self'|'team'|'global';requiresLocal:boolean;userManaged:boolean;appAdministrator?:boolean;permissions:'all'|readonly ApiPermission[];controls:readonly string[];schedules:readonly string[];creates:readonly string[];removes:readonly string[];assigns:readonly string[]}
const personal:ApiPermission[]=['worker','chat','identity','topology','employee.read','workspace','plugin','schedule']
export const MANAGEMENT_ROLES={
  employee:{label:'Employee',description:'使用自己的工作空间与已授权工具，接收任务；不管理其他员工。',scope:'self',requiresLocal:false,userManaged:false,permissions:personal,controls:[],schedules:[],creates:[],removes:[],assigns:[]},
  manager:{label:'Manager',description:'管理本 Team 的全部 Employee，可创建、派发任务和调整位置。',scope:'team',requiresLocal:false,userManaged:false,permissions:[...personal,'relation','host.read','employee.message','employee.configure','employee.create','employee.delete','layout.read','layout.write'],controls:['employee'],schedules:['employee'],creates:['employee'],removes:['employee'],assigns:[]},
  governor:{label:'Governor',description:'跨 Team 管理团队和员工；Governor 的任免由用户或 Secretary 操作。',scope:'global',requiresLocal:false,userManaged:false,permissions:'all',controls:['employee','manager','governor'],schedules:['employee','manager'],creates:['employee','manager'],removes:['employee','manager'],assigns:['employee','manager']},
  secretary:{label:'Secretary',description:'用户的软件执行助手，统一管理频道、排序、团队、主机、文件、插件与 Plan。',scope:'global',requiresLocal:true,userManaged:true,appAdministrator:true,permissions:'all',controls:['employee','manager','governor','secretary'],schedules:['employee','manager','governor','secretary'],creates:['employee','manager','governor'],removes:['employee','manager','governor'],assigns:['employee','manager','governor']}
} as const satisfies Record<string,RolePolicy>
export type ManagementRole=keyof typeof MANAGEMENT_ROLES
export function isManagementRole(value:unknown):value is ManagementRole{return typeof value==='string'&&Object.hasOwn(MANAGEMENT_ROLES,value)}
export function rolePolicy(role:ManagementRole|undefined):RolePolicy{
  if(role!==undefined&&!isManagementRole(role))throw Error('Invalid management role')
  return MANAGEMENT_ROLES[role??'employee']
}
export const isSupervisor=(role:ManagementRole|undefined)=>rolePolicy(role).scope!=='self'
export const roleAllows=(role:ManagementRole|undefined,permission:ApiPermission)=>{const rules=rolePolicy(role).permissions;return rules==='all'||rules.includes(permission)}
export const PLAN_GUIDANCE='定时、重复和事件触发的员工工作必须通过 Core Plan 的 schedule.* API 创建、读取和调整，保存后核对 ID、目标及规则；群组固定正文通知只用 conversation.notice-*；它不运行员工工作、不属于 Mission。频道是只读信息流，不设置群通知。不要用 sleep、cron、独立计时器或插件提醒代替员工排期。事件计划支持软件内 message.received/session.completed/channel.posted，以及 monitor.output/monitor.exited。外部脚本监测源用 monitor.create 注册，再先建事件计划、后 monitor.start；脚本在本人执行主机工作区运行并输出带稳定 id 的 JSON 行，软件管理进程，不把监控脚本当员工。monitor 的 restartOnLaunch 明确决定重启后是否重启程序。忙碌和冷却只延后，不丢弃待处理事件。所有职位可创建、读取和修改分配给自己的计划，不论原创建者；上级可管理当前权限范围内下级的计划，同样不受创建者限制。Employee/Manager/Governor 仅可给职级更低且在管理范围内的员工分派。Secretary 代表用户全局管理合法员工的排期，包括其他 Secretary；Secretary 任免仍由用户决定。'
export const SECRETARY_GUIDANCE='用户的软件执行助手：通过与界面相同的 CLI/API 全局管理 Company、Messages、Plan、频道、插件、主机和文件。无需加入频道或群组即可管理；读取新闻不需要额外授权。插件按内容授权用 plugin.access，普通员工先读 plugin.resources；不需要插件团队。频道人员授权用 channel.access，频道及分类排序用 messenger.reorder（先读 messenger.state，携带 expectedOrder）。先查真实数据与接口 schema，再执行用户要求的操作，完成后回读核对；不要把可以直接完成的软件操作交回用户。用户已明确要求的操作直接执行，不再询问已明确的分类顺序、普通实现细节或必要的打包安装；若用户只要求改代码或暂不重启，则遵循该限制。需要生效的本项目修改按项目 build.py 与安装器流程完成，先检查活动工作并保留数据和原生会话。应用重启会短暂关闭 UI、Core 和原生工作进程，不能声称它们完全不受影响。只为确实缺失的关键业务信息或实际的执行权限询问，不为已授权步骤反复调用 AskUserQuestion。需要其他员工参与时，通过 Core 明确委派任务。监督任务始终以用户原目标和验收要求为准，内部计划、比例和锁稿规则不能增加无关硬门槛、排斥已发现的有效新增或缩小目标；具体业务委派给员工，自己核对真实产物、组织用户指定范围的审核并退回未达标项。遇到账户余额或认证等明确阻塞，报告证据、保留任务并等待条件变化，不反复探测，也不把运行中状态当作成功。保持本人身份，不冒充用户；Secretary 任免由用户负责，Worker 保留直属归属和干净原生上下文，Secretary 可统一管理。'
export const roleDescription=(role:ManagementRole|undefined)=>rolePolicy(role).description+(role==='secretary'?SECRETARY_GUIDANCE:'')+MESSAGE_REPLY_GUIDANCE+PLAN_GUIDANCE+BOT_WORKER_GUIDANCE
export const managementRoles=()=>Object.entries(MANAGEMENT_ROLES).map(([value,policy])=>({value,...policy,description:roleDescription(value as ManagementRole)}))
