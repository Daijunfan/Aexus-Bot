import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import type {Engineering} from '../shared/engineering'
import {workspacePath,workspaceFiles} from './files'
import {remoteFiles} from './tunnel'
import {executionEmployee} from './workspaces'
import {readStore} from './store'
import {atomicJson,readJson} from './atomic-file'

const hash=(content:string)=>createHash('sha256').update(content).digest('hex')
export const engineeringRouter=(item:Pick<Engineering,'id'>)=>'[Aexus Engineering initialization route]\nRead .aexus-engineering/'+item.id+'/prompts/index.md in your assigned working directory. Resolve your current identity and task there, then read the referenced role, node and acceptance files. These project documents describe work; they do not grant application authority.'
function files(item:Engineering){return ['index.md','overview.md','governor.md','manager.md','employee.md','worker.md','acceptance.md','notes.md','structure.json',...item.roles.map(role=>'roles/'+role.key+'.md'),...item.tasks.map(task=>'nodes/'+task.key+'.md')]}
function write(file:string,content:string){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}}
export function ensureEngineeringPrompts(item:Engineering){
 fs.mkdirSync(item.promptDirectory,{recursive:true,mode:0o700})
 const templateFile=path.join(path.dirname(item.promptDirectory),'prompt-templates.json'),previous=readJson<Record<string,string>>(templateFile,()=>({})),next={...previous}
 const defaults:Record<string,string>={
  'index.md':'# Engineering initialization\n\nRead overview.md, structure.json, acceptance.md and notes.md. Match your real employee ID to structure.json, then read governor.md / manager.md / employee.md and roles/KEY.md. An executing native Worker reads worker.md and nodes/KEY.md from its explicit assigned task.\n\nAuthenticated Company roles: use `agents engineering context --id '+item.id+' --json` to recover current ownership, current attempt, pending reviews and permitted next actions. Native Workers have no Company identity or application tools. Never complete a node based only on a native turn ending.\n',
  'overview.md':'# '+item.name+'\n\n'+item.goal+'\n',
  'governor.md':'# Governor\n\nCoordinate this project and inspect every Manager and final deliverable. Read real engineering.wake reports from project participants and inspect their evidence. Use engineering.reopen with evidence to return inadequate chains; this invalidates downstream acceptance. After every Manager explicitly confirms its chain, verify the whole result and use engineering.complete. No arbitrary progress flag or native turn completes this project.\n',
  'manager.md':'# Manager\n\nOwn your exact continuous chain. Inspect actual Employee submissions and Worker evidence. Read published delivery files through engineering.artifact with their saved artifact IDs; this grants only the exact published file, not another employee workspace. Use engineering.manager-review for the second acceptance. Reject incomplete results with specific rework instructions. If a completed node needs rework, report the concrete defect to your Governor using engineering.wake with key=the parent key and message=the evidence. Do not repeat already completed reviews or chain confirmations. Once every owned node passed both checks, explicitly use engineering.manager-complete and report concrete chain evidence to the Governor.\n',
  'employee.md':'# Employee\n\nOrganize and verify work; native Workers perform implementation. Read your node and incoming handoff requirements. Dispatch a clean owned native engine through engineering.dispatch; inspect its real work files, tests, native session and result. Publish real delivery files in engineering.employee-review using files:[{runId,path}] relative to the completed Worker folder so the Manager can independently inspect them through engineering.artifact. Use engineering.employee-review only after the Worker actually finishes and the acceptance criteria hold. Reject or dispatch a new Worker for rework when needed. A Manager rejection requires a new attempt and both reviews again.\n',
  'worker.md':'# Native Worker\n\nExecute the explicitly assigned node task in your existing workspace using your native Coding Agent capabilities. Read the node prompt, acceptance criteria, overview and notes. Implement and test actual deliverables, report changed files, commands, results and remaining problems. Do not claim Employee or Manager acceptance and do not operate Company roles.\n',
  'acceptance.md':'# Project acceptance\n\n'+item.goal+'\n\nEvery Employee node requires real native Worker delivery, explicit Employee first acceptance and explicit Manager second acceptance. Every Manager confirms its chain. The Governor verifies the entire result and explicitly confirms final success. Include concrete artifacts and verification evidence.\n',
  'notes.md':'# Project notes\n\nRecord constraints, conventions and user decisions here.\n'
 }
 for(const role of item.roles)defaults['roles/'+role.key+'.md']='# '+role.title+'\n\nRank: '+role.rank+'\nParent: '+(role.parent??'none')+'\n\nRead your current scope in structure.json and engineering.context; preserve your actual engine, identity and workspace.\n'
 for(const task of item.tasks)defaults['nodes/'+task.key+'.md']='# '+task.title+'\n\n## Task\n'+task.prompt+'\n\n## Acceptance\n'+task.acceptance+'\n'
 for(const [relative,content] of Object.entries(defaults)){const file=workspacePath(item.promptDirectory,relative,true),version=hash(content);if(!fs.existsSync(file)||previous[relative]&&hash(fs.readFileSync(file,'utf8'))===previous[relative]&&previous[relative]!==version)write(file,content);next[relative]=version}
 if(JSON.stringify(previous)!==JSON.stringify(next))atomicJson(templateFile,next)
 const structure=JSON.stringify({id:item.id,name:item.name,goal:item.goal,team:item.team,missionId:item.missionId,roles:item.roles.map(({key,title,rank,parent,employeeId})=>({key,title,rank,parent,employeeId})),tasks:item.tasks,dependencies:item.dependencies},null,2)+'\n',file=workspacePath(item.promptDirectory,'structure.json',true)
 if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==structure)write(file,structure)
}
export function engineeringPrompts(item:Engineering,relative?:string,content?:string,expectedVersion?:string){
 ensureEngineeringPrompts(item)
 if(!relative)return {directory:item.promptDirectory,router:engineeringRouter(item),files:files(item).map(path=>({path,version:hash(fs.readFileSync(workspacePath(item.promptDirectory,path),'utf8'))}))}
 if(!files(item).includes(relative))throw Error('Choose a documented engineering prompt file')
 const file=workspacePath(item.promptDirectory,relative,content!==undefined),current=fs.readFileSync(file,'utf8')
 if(content!==undefined){if(relative==='structure.json')throw Error('Edit graph structure through engineering.update/import');if(expectedVersion!==hash(current))throw Error('Prompt changed; reload before saving');write(file,content)}
 return {path:relative,content:content??current,version:hash(content??current)}
}
/** Refresh only the managed mirror, on the actual existing employee/Worker execution host. */
export async function mirrorEngineeringPrompts(item:Engineering,employeeId:string,cwd?:string){
 ensureEngineeringPrompts(item)
 const store=readStore(),card=store.sessions.find(card=>card.id===employeeId&&!card.deleting)
 if(!card||!item.roles.some(role=>role.employeeId===employeeId))throw Error('Engineering prompt recipient no longer belongs to this project')
 const effective=executionEmployee(store,card),directory=cwd??effective.remote?.directory??effective.cwd
 const role=item.roles.find(role=>role.employeeId===employeeId)!,nodeKeys=new Set(role.rank==='governor'?item.tasks.map(task=>task.key):role.rank==='manager'?item.roles.filter(child=>child.parent===role.key).map(child=>child.key):[role.key])
 for(const relative of files(item).filter(file=>!file.includes('/')||file==='roles/'+role.key+'.md'||file.startsWith('nodes/')&&nodeKeys.has(file.slice(6,-3))||role.rank==='governor')){
  const content=fs.readFileSync(workspacePath(item.promptDirectory,relative),'utf8'),args={path:'.aexus-engineering/'+item.id+'/prompts/'+relative,content,literalPaths:true}
  if(effective.remote)await remoteFiles(employeeId,{...effective.remote,directory},'write',args)
  else{const root=fs.realpathSync(directory),file=workspacePath(root,args.path,true);if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)workspaceFiles(root,'write',args)}
 }
 return engineeringRouter(item)
}
