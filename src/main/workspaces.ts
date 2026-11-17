import { applicationRoot } from './resources'
import {storageFolderName} from '../shared/storage-folder'
import {directoryName} from '../shared/directory-names'
import {remoteTarget} from '../shared/remote'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { posix,win32,dirname, isAbsolute, parse, relative, resolve, sep,join } from 'node:path'
import {homedir} from 'node:os'
import {employeeDirectoryName} from '../shared/office'
import { APP_HOME } from '../shared/protocol'
import {requirePlugin} from './plugins/registry'
import type { Store, StoredSession, TeamSettings } from '../shared/types'
import { employeeSettings } from '../shared/types'
export { employeeDirectoryName as workspaceName } from '../shared/office'

export function centralizedWorkspacesRoot(store?: Pick<Store, 'preferences'>): string {
  const configured = store?.preferences?.employeeWorkspacesRoot?.trim()
  return resolve(configured || process.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES || process.env.AGENTS_COMPANY_PROJECTS || join(homedir(), 'Aexus-bot-workspaces'))
}

/** Portable data storage, or a legacy development source marker; never packaged App resources. */
export function pluginWorkspaceBase(id:string):string {
  const plugin=requirePlugin(id),marker=join(plugin.directory,'source-location.json')
  const source=existsSync(marker)?JSON.parse(readFileSync(marker,'utf8')).source:undefined
  // Valid legacy development markers remain compatible; release packages have none.
  if(!process.env.AGENTS_COMPANY_WORKSPACES&&typeof source==='string'&&existsSync(source))return join(realpathSync(source),'workspaces')
  return resolve(process.env.AGENTS_COMPANY_WORKSPACES||join(APP_HOME,'workspaces'),plugin.workspaceDirectory||`${plugin.id}-workspace`)
}

/** Collection views are an explicit plugin capability, not an ID-specific host branch. */
export function defaultPluginWorkspace(id:string):string {
  const base=pluginWorkspaceBase(id)
  return requirePlugin(id).defaultWorkspace==='collection'?base:join(base,'default')
}

/** Previous direct-plugin workspace, retained so the first open can import its files. */
export function legacyPluginWorkspace(id:string):string {
  const plugin=requirePlugin(id)
  return join(process.env.AGENTS_COMPANY_WORKSPACES||join(homedir(),'develop','Agents-company-workspace'),plugin.workspaceDirectory||`${plugin.id}-workspace`)
}

export function inside(root: string, path: string): boolean {
  const part = relative(root, path)
  return !!part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export function employeeRoot(store:Store,card:Partial<StoredSession>){
  const config=employeeSettings(store,card)
  if(config.mode==='cloud')return card.remoteRoot??config.remote?.directory??(card.cwd?posix.dirname(card.cwd):undefined)
  if(config.mode==='work')return card.pluginId?defaultPluginWorkspace(card.pluginId):card.cwd?dirname(card.cwd):undefined
  return centralizedWorkspacesRoot(store)
}

export function localDirectory(path: string,create:boolean|'preview'=false,pluginWorkspace=false): string {
  if (!path || !isAbsolute(path)) throw new Error('请选择已存在的绝对路径文件夹')
  let ancestor=resolve(path);while(!existsSync(ancestor))ancestor=dirname(ancestor)
  if(!statSync(ancestor).isDirectory())throw new Error('工作根目录必须是文件夹')
  const root=resolve(realpathSync(ancestor),relative(ancestor,resolve(path)))
  const appHome = existsSync(APP_HOME) ? realpathSync(APP_HOME) : resolve(APP_HOME)
  if ((root === appHome || inside(appHome, root))&&!pluginWorkspace) throw new Error('请选择应用数据目录以外的文件夹')
  if(create==='preview')return root
  if(create)mkdirSync(root,{recursive:true})
  if(!existsSync(root))throw new Error('目标目录不存在，请选择已有文件夹或允许创建目录')
  return root
}

export function employeeWorkspace(store: Store, input: string, id?: string, create: boolean | 'preview' = false, directoryMode?: 'create'|'existing'): string {
  const existing=id?store.sessions.find(card=>card.id===id):undefined
  const config=existing?employeeSettings(store,existing):{mode:'build' as const}
  if(config.mode==='cloud')return cloudDirectory(config,input)
  const work=config.mode==='work'
  const base=centralizedWorkspacesRoot(store),root=work?(existing?.pluginId?defaultPluginWorkspace(existing.pluginId):dirname(existing?.cwd??base)):base
  if (!input?.trim()) throw new Error('请选择员工的工作文件夹')
  const target = resolve(root, input)
  let ancestor = target
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const actualAncestor = realpathSync(ancestor)
  if(!statSync(actualAncestor).isDirectory()) throw new Error('员工工作空间必须是文件夹')
  const prospective=resolve(actualAncestor,relative(ancestor,target))
  const canonical=(value:string)=>existsSync(value)?realpathSync(value):resolve(value)
  const appHome=canonical(APP_HOME),userHome=canonical(homedir()),central=canonical(base),sourceRoot=canonical(applicationRoot())
  if(work&&existing?.pluginId&&prospective!==root&&!inside(pluginWorkspaceBase(existing.pluginId),prospective))throw new Error('工作目录超出插件工作区范围')
  if((prospective===appHome||inside(appHome,prospective))&&!(work&&existing?.pluginId&&inside(pluginWorkspaceBase(existing.pluginId),prospective))) throw new Error('员工工作空间不能使用应用数据目录')
  if(prospective===parse(prospective).root||prospective===userHome||prospective===central||prospective===sourceRoot||inside(sourceRoot,prospective)) throw new Error('员工必须使用独立的专属工作子目录')
  for (const card of store.sessions) {
    if (card.id === id||card.deleting||employeeSettings(store,card).mode==='cloud') continue
    const other = canonical(card.cwd)
    if (other===prospective) throw new Error('一个工作文件夹只能对应一名员工，请更换文件夹名称或选择其他目录')
  }
  if(directoryMode&&!['create','existing'].includes(directoryMode))throw new Error('目录方式必须为 create 或 existing')
  if(directoryMode==='create'&&existsSync(target))throw new Error('这个文件夹已存在，请更换文件夹名称或选择“绑定已有文件夹”')
  if(directoryMode==='existing'&&!existsSync(target))throw new Error('所选文件夹不存在，请绑定已有文件夹或选择默认生成')
  if(create==='preview')return prospective
  if (create) mkdirSync(target, { recursive: true })
  if(!existsSync(target))throw new Error('员工工作目录已不存在，请在员工资料中重新选择目录')
  const cwd = realpathSync(target)
  if(!statSync(cwd).isDirectory()) throw new Error('工作空间必须是真实文件夹')
  if((cwd===appHome||inside(appHome,cwd))&&!(work&&existing?.pluginId&&inside(pluginWorkspaceBase(existing.pluginId),cwd))) throw new Error('员工工作空间不能使用应用数据目录')
  return cwd
}

export function executionEmployee(store:Store,card:StoredSession):StoredSession {
  const config=employeeSettings(store,card)
  return {...card,remote:config.mode==='cloud'&&config.remote?{...config.remote,directory:card.cwd}:null}
}
export function cloudDirectory(settings:TeamSettings,input:string):string {
  const remote=remoteTarget(settings.remote)
  if(!remote)throw new Error('云主机员工缺少主机连接配置')
  const paths=remote.os==='windows'?win32:posix,root=paths.resolve(remote.directory),target=paths.resolve(root,input),part=paths.relative(root,target)
  if(/[\0\r\n]/.test(input)||(!paths.isAbsolute(input)&&(part==='..'||part.startsWith('..'+paths.sep))))throw new Error('云端员工目录路径无效')
  return target
}
export function cloudRelative(settings:TeamSettings,input:string){const paths=settings.remote?.os==='windows'?win32:posix;return paths.relative(settings.remote!.directory,cloudDirectory(settings,input)).split(paths.sep).join('/')||'.'}
export function workspaceStatus(store: Store, card: StoredSession): StoredSession {
  const resolved=executionEmployee(store,card)
  try { employeeWorkspace(store,card.cwd,card.id); return {...resolved,workspaceError:undefined} }
  catch(error){return {...resolved,workspaceError:error instanceof Error?error.message:String(error)}}
}

/** Creation defaults to <workspacesRoot>/<name>; explicit folderName or bind remains supported. */
export function chooseEmployeeWorkspace(store:Store,title:string,folderName?:string,input?:string,mode?:string,id?:string,preview=false):string {
  if(mode!==undefined&&!['default','bind','create','existing'].includes(mode))throw new Error('请选择默认生成或绑定已有文件夹')
  if(mode==='default'||(!mode&&!input)) {
    const rawName=folderName?.trim()?storageFolderName(folderName.trim()):directoryName(String(title??''),'employee')
    if(!rawName||rawName==='.'||rawName==='..'||/[\\/\0]/.test(rawName))throw new Error('默认文件夹名称不能含路径分隔符，请修改员工或文件夹名称')
    const root=centralizedWorkspacesRoot(store),target=resolve(root,rawName)
    if(input&&resolve(root,input)!==target)throw new Error('默认工作目录由集中工作区和文件夹名生成，不能同时指定其他路径')
    const own=id&&store.sessions.find(c=>c.id===id)?.cwd===target
    return employeeWorkspace(store,target,id,preview?'preview':true,own?'existing':'create')
  }
  const existing=mode==='bind'||mode==='existing'
  return employeeWorkspace(store,input||'',id,preview?'preview':!existing,existing?'existing':mode==='create'?'create':undefined)
}
