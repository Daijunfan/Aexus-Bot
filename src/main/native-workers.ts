import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {isEngine,ENGINE_DEFINITIONS} from '../shared/engines'
import type {NativeWorker} from '../shared/native-worker'
import {atomicJson,readJson} from './atomic-file'
import {readStore} from './store'
import {executionEmployee,employeeWorkspace} from './workspaces'
import {requestContext} from './request-context'
import {isAppAdministrator} from './application-authority'
import {engineExecutable} from './engines/executable'
import {openTerminal,listTerminals,waitTerminalOutput,inputTerminal,resizeTerminal,closeTerminal} from './terminals'

type Record=Omit<NativeWorker,'running'|'terminal'|'exitCode'>
const file=path.join(APP_HOME,'native-workers.json'),stopping=new Set<string>()
const records=()=>readJson<Record[]>(file,()=>[],Array.isArray)
function owner(employee?:string){
 const principal=requestContext().principal,id=employee??(principal.kind==='agent'?principal.employeeId:undefined)
 if(!id)throw Error('请选择 Worker 的直属员工（employee）')
 if(!isAppAdministrator(principal)&&principal.kind==='agent'&&principal.employeeId!==id)throw Error('Forbidden: only directly owned Workers may be controlled')
 const store=readStore(),card=store.sessions.find(c=>c.id===id&&!c.deleting)
 if(!card)throw Error('Worker owner no longer exists')
 return {store,card}
}
function get(id:string){const value=records().find(w=>w.id===id);if(!value)throw Error('Unknown Worker');owner(value.employee);return value}
function terminal(id:string){const value=listTerminals().find(t=>t.worker===id);if(!value)throw Error('Worker 尚未启动');return value}
function present(value:Record):NativeWorker{const t=listTerminals().find(t=>t.worker===value.id);return {...value,running:t?.running??false,terminal:t?.id,exitCode:t?.exitCode}}
function location(value:Record){
 const {store,card}=owner(value.employee),effective=executionEmployee(store,card)
 if((effective.remote?.host??undefined)!==value.host)throw Error('直属员工的执行主机已改变，请重新创建 Worker；不会回退到本机')
 const paths=effective.remote?.os==='windows'?path.win32:effective.remote?path.posix:path
 const root=effective.remote?card.cwd:fs.realpathSync(card.cwd),cwd=effective.remote?paths.resolve(value.cwd):fs.realpathSync(value.cwd),relative=paths.relative(root,cwd)
 if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw Error('Worker 工作目录必须位于直属员工的工作目录内')
 if(!effective.remote&&!fs.statSync(cwd).isDirectory())throw Error('Worker 工作目录必须是已有文件夹')
 employeeWorkspace(store,card.group,card.cwd,card.id)
 return {...effective,cwd,remote:effective.remote?{...effective.remote,directory:cwd}:null}
}
export function listWorkers(employee?:string){
 const principal=requestContext().principal
 if(employee||!isAppAdministrator(principal)&&principal.kind==='agent')owner(employee)
 return records().filter(w=>employee?w.employee===employee:isAppAdministrator(principal)||principal.kind==='agent'&&w.employee===principal.employeeId).map(present)
}
export function createWorker(args:{employee?:string;engine:string;title?:string;cwd?:string}){
 if(!isEngine(args.engine))throw Error('Unsupported native Coding Agent engine')
 const {store,card}=owner(args.employee),effective=executionEmployee(store,card)
 const paths=effective.remote?.os==='windows'?path.win32:effective.remote?path.posix:path
 const value:Record={id:randomUUID(),employee:card.id,title:args.title?.trim()||ENGINE_DEFINITIONS[args.engine].label+' Worker',engine:args.engine,cwd:paths.resolve(card.cwd,args.cwd??'.'),host:effective.remote?.host,createdAt:new Date().toISOString()}
 location(value)
 atomicJson(file,[...records(),value]);return present(value)
}
export async function startWorker(id:string,cols?:number,rows?:number){
 const value=get(id)
 if(stopping.has(id))throw Error('Worker 正在停止，请稍后重试')
 stopping.add(id)
 try{
 const previous=listTerminals().find(t=>t.worker===id)
 if(previous?.running)return present(value)
 if(previous)await closeTerminal(previous.id)
 // Revalidate after await; changing hosts/permissions must never silently launch locally.
 get(id);const effective=location(value)
 if(effective.accessMode==='isolated')throw Error('严格隔离员工暂不支持原生 Worker；不会使用不受限进程替代')
 const program=[effective.remote?value.engine:engineExecutable(value.engine,false)]
 openTerminal(effective,cols,rows,{program,worker:id,root:owner(value.employee).card.cwd})
 return present(value)
 }finally{stopping.delete(id)}
}
export async function readWorker(id:string,cursor=0,waitMs=0){get(id);const output=await waitTerminalOutput(terminal(id).id,cursor,waitMs,requestContext().signal);get(id);return {...present(get(id)),output:output.output,cursor:output.cursor,reset:output.reset}}
export function inputWorker(id:string,data:string){get(id);return inputTerminal(terminal(id).id,data)}
export function resizeWorker(id:string,cols:number,rows:number){get(id);return resizeTerminal(terminal(id).id,cols,rows)}
export async function stopWorker(id:string,remove=false){
 const value=get(id)
 if(stopping.has(id))throw Error('Worker 正在停止，请稍后重试')
 stopping.add(id)
 try{const t=listTerminals().find(t=>t.worker===id);if(t)await closeTerminal(t.id);get(id);if(remove)atomicJson(file,records().filter(w=>w.id!==id));return remove?true:present(value)}finally{stopping.delete(id)}
}
/** Employee removal already revokes the owner. Preserve all native history and work files. */
export async function removeEmployeeWorkers(employee:string){
 for(const value of records().filter(w=>w.employee===employee)){const t=listTerminals().find(t=>t.worker===value.id);if(t)await closeTerminal(t.id)}
 atomicJson(file,records().filter(w=>w.employee!==employee))
}
