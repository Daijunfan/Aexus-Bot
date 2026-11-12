import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {engineeringOrder,type Engineering,type EngineeringSpec,type EngineeringRole,type EngineeringNode,type EngineeringRun,type EngineeringNotice,type EngineeringTaskSpec} from '../shared/engineering'
import {parseEngineeringMermaid,exportEngineeringMermaid,mergeEngineeringGraph} from '../shared/engineering-mermaid'
import type {Delegation,PrincipalRef,RequestContext} from '../shared/management'
import {atomicJson,readJson} from './atomic-file'
import {validateApiArguments} from './api-contract'
import {authorize,canSchedule,isAppAdministrator,requestContext,withCaller,registerDelegationValidator,validateDelegation} from './authorization'
import {credentialActive} from './agent-access'
import {readStore} from './store'
import {employeeIndex} from './employee-index'
import {startSession,enqueueMessage,listLive,getLive} from './sessions'
import {taskViewId} from './task-view'
import {ownedWorkerExecution,cancelOwnedWorkerExecution} from './native-workers'
import {missionRequest,recordEngineeringMission,existingEngineeringMission,registerEngineeringMissionAccess} from './missions'
import {engineeringPrompts,ensureEngineeringPrompts,engineeringRouter,mirrorEngineeringPrompts} from './engineering-prompts'
import {publishEngineeringArtifacts,readEngineeringArtifact,verifyEngineeringArtifacts} from './engineering-artifacts'
import {transcriptItems} from './transcripts'

type Dispatch=(command:string,args:Record<string,any>)=>Promise<any>
type Saved=Engineering&{authority:Delegation;generation:number;requestKey?:string;fingerprint?:string;ownsTeam:boolean;viewLabel?:string}
type State={version:1;projects:Saved[]}
const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,stable(value)])):value
const file=path.join(APP_HOME,'engineering.json'),stamp=()=>new Date().toISOString(),hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
let state:State|undefined,serviceError='',running=false,timer:ReturnType<typeof setInterval>|undefined,emit:(channel:string,payload:unknown)=>void=()=>{},serial=new Map<string,Promise<unknown>>()
const deliveries=new Map<string,Promise<unknown>>()
function data(){if(serviceError)throw Error(serviceError);return state??=readJson<State>(file,()=>({version:1,projects:[]}),value=>(value as State)?.version===1&&Array.isArray((value as State)?.projects)&&(value as State).projects.every(item=>typeof item.id==='string'&&item.id.startsWith('eng_')&&Array.isArray(item.roles)&&Array.isArray(item.nodes)&&Array.isArray(item.runs)&&Array.isArray(item.notices)&&Array.isArray(item.reviews)&&Number.isSafeInteger(item.revision)&&!!item.authority?.requestedBy))}
function store(){try{atomicJson(file,data(),true)}catch(error){serviceError='Engineering storage is unavailable: '+(error as Error).message;clearInterval(timer);throw Error(serviceError)}}
function changed(item:Saved){item.revision++;item.updatedAt=stamp();store();syncMission(item);emit('engineering:changed',{id:item.id,missionId:item.missionId})}
function syncMission(item:Saved){if(item.missionId)recordEngineeringMission(item.missionId,{id:item.id,completed:item.nodes.filter(node=>node.phase==='completed').length,total:item.nodes.length,status:item.status,nextCheckAt:item.status==='running'?governor(item).nextCheckAt:undefined},item.result,{name:item.name,prompt:item.goal,reminderSeconds:governor(item).checkSeconds??item.governorCheckSeconds!,employeeIds:governor(item).employeeId?[governor(item).employeeId!]:[],viewId:item.viewId},item.authority)}
function same(a:PrincipalRef,b:PrincipalRef){return a.kind===b.kind&&(a.kind==='operator'||b.kind==='agent'&&a.employeeId===b.employeeId)}
function person(id:string){const card=employeeIndex().get(id);return card&&!card.deleting?card:undefined}
function visible(item:Saved,p=requestContext().principal){return isAppAdministrator(p)||p.kind==='agent'&&item.roles.some(role=>role.employeeId===p.employeeId&&person(p.employeeId)?.group===item.team&&(person(p.employeeId)?.managementRole??'employee')===role.rank)}
registerEngineeringMissionAccess((id,principal)=>{if(serviceError)return false;const item=data().projects.find(item=>item.id===id);return !!item&&visible(item,principal)})
async function questions(item:Saved){return item.missionId?(await import('./chat-questions')).missionPendingQuestions(item.missionId).map(question=>({id:question.id,authorId:question.authorId})):[]}
async function present(item:Saved){return {...publicValue(item),pendingQuestions:await questions(item)}}
function get(id:string){const item=data().projects.find(item=>item.id===id);if(item)refreshTeam(item);if(!item||!visible(item))throw Error('Unknown or unauthorized Engineering');return item}
function revision(item:Saved,value:number,scope?:string[]){if(item.revision===value)return;if(value>=1&&value<item.revision&&scope?.length&&scope.every(key=>(nodeFor(item,key).lastChangedRevision??item.revision)<=value))return;throw Error('Engineering changed; reload before applying this action. Your draft is retained.')}
function touchNode(item:Saved,key:string){nodeFor(item,key).lastChangedRevision=item.revision+1}
function refreshTeam(item:Saved){
 const storeValue=readStore(),lead=item.roles.find(role=>role.rank==='governor'),current=lead?.employeeId?storeValue.sessions.find(card=>card.id===lead.employeeId&&!card.deleting)?.group:undefined
 let dirty=false
 if(current&&current!==item.team&&!storeValue.groups.includes(item.team)&&storeValue.groups.includes(current)&&item.roles.filter(role=>role.employeeId).every(role=>storeValue.sessions.some(card=>card.id===role.employeeId&&card.group===current&&!card.deleting))){item.team=current;dirty=true}
 for(const role of item.roles){const card=role.employeeId?storeValue.sessions.find(card=>card.id===role.employeeId&&!card.deleting):undefined;if(card&&card.title!==role.title){role.title=card.title;dirty=true}}
 if(dirty)changed(item)
}
function roleFor(item:Saved,key:string){const role=item.roles.find(role=>role.key===key);if(!role||!role.employeeId||(person(role.employeeId)?.managementRole??'employee')!==role.rank||person(role.employeeId)?.group!==item.team)throw Error('Engineering role identity changed; repair the project before continuing');return role}
function owns(item:Saved,role:EngineeringRole){const p=requestContext().principal;if(isAppAdministrator(p))return;if(p.kind!=='agent'||p.employeeId!==role.employeeId)throw Error('Only the exact '+role.rank+' or user/Secretary can perform this engineering action');roleFor(item,role.key)}
function administrative(){if(!isAppAdministrator())throw Error('Only the user or a Secretary may configure Engineering')}
function governor(item:Saved){return item.roles.find(role=>role.rank==='governor')!}
function nodeFor(item:Saved,key:string){const node=item.nodes.find(node=>node.key===key);if(!node)throw Error('Unknown Employee task');return node}
function authorityValid(item:Saved){
 refreshTeam(item)
 const owner=item.authority.requestedBy
 if(owner.kind==='agent'&&item.authority.credentialHash&&!credentialActive(owner.employeeId,item.authority.credentialHash))throw Error('Engineering creator credential was revoked; user/Secretary must update the project to resume')
 if(!isAppAdministrator(owner))throw Error('Engineering creator no longer has application administration authority')
 for(const role of item.roles){const current=roleFor(item,role.key);if(!canSchedule(owner,current.employeeId!))throw Error('Engineering assignment authorization changed')}
}
function activityValue(item:Saved){
 const liveByEmployee=new Map(listLive().flatMap(({id})=>{const live=getLive(id);return live?[[live.cardId,{id,live}] as const]:[]}))
 const activity=item.roles.map(role=>{
  const liveRef=role.employeeId?liveByEmployee.get(role.employeeId):undefined,session=liveRef?.live,own=session?.currentTask?.delegation.engineeringNotice?.id===item.id,node=item.nodes.find(node=>node.key===role.key),review=item.reviews.filter(review=>review.node===role.key||review.manager===role.key).at(-1)
  const items=own?transcriptItems(liveRef!.id):[],start=items.findIndex(entry=>entry.role==='user'&&entry.outbound?.taskId===session?.currentTask?.messageId),answer=start<0?undefined:items.slice(start+1).filter(entry=>entry.role==='assistant').at(-1)
  const report=item.notices.filter(entry=>entry.message&&entry.by?.kind==='agent'&&entry.by.employeeId===role.employeeId).at(-1),activeRun=item.runs.find(run=>run.node===role.key&&!run.superseded&&['queued','running'].includes(run.state))
  const message=own?(answer?.role==='assistant'?answer.blocks.filter(block=>block.kind==='text').map(block=>block.kind==='text'?block.text:'').join('\n').slice(-250):undefined):report?.message?.slice(0,250)??activeRun?.task.slice(0,250)??review?.result?.slice(0,250)
  const initialization=role.employeeId?person(role.employeeId)?.initialization:undefined
  return {role:role.key,state:initialization&&initialization.status!=='ready'?initialization.status==='failed'?'initialization_failed':'initializing':activeRun?.approvalCount?'needs_input':role.error?'failed':role.completedAt?'completed':own&&session?.running?'working':session?.running?'busy_elsewhere':node?.phase??'waiting',...(message?{message}:{})}
 })
 return activity
}
function publicValue(item:Saved):Engineering{
 const {authority,generation,requestKey,fingerprint,ownsTeam,viewLabel,...value}=item,activity=activityValue(item)
 const admin=isAppAdministrator(),current=requestContext().principal,member=current.kind==='agent'?item.roles.find(role=>role.employeeId===current.employeeId):undefined
 return structuredClone({...value,progress:{completed:item.nodes.filter(node=>node.phase==='completed').length,total:item.nodes.length},activity,allowedActions:[...(admin?['configure','layout','prompts','archive']:[]),...(admin||member?.rank==='governor'?['start','pause','resume','reopen','complete']:[]),...(admin||member?.rank==='manager'?['manager-review','manager-complete']:[]),...(admin||member?.rank==='employee'?['dispatch','employee-review','worker-stop']:[])]})
}
function definition(item:Engineering):EngineeringSpec{return {name:item.name,goal:item.goal,team:item.team,createTeam:item.createTeam,roles:item.roles.map(({key,title,rank,parent,employeeId,engine,model,checkSeconds,position})=>({key,title,rank,parent,employeeId,engine,model,checkSeconds,position})),tasks:item.tasks,dependencies:item.dependencies,collaboration:item.collaboration,managerCheckSeconds:item.managerCheckSeconds,governorCheckSeconds:item.governorCheckSeconds}}
function spec(input:EngineeringSpec,existing?:Saved){
 validateApiArguments('engineering.create',{spec:input})
 const value:EngineeringSpec={...structuredClone(input),name:input.name.trim(),goal:input.goal.trim(),team:input.team.trim(),managerCheckSeconds:input.managerCheckSeconds??900,governorCheckSeconds:input.governorCheckSeconds??1800,collaboration:input.collaboration??[]}
 if(!value.name||!value.goal||!value.team)throw Error('Provide an engineering name, goal and Team')
 for(const role of value.roles){role.title=role.title.trim();if(!role.title)throw Error('Role names cannot be blank');if(role.rank==='employee'&&role.checkSeconds!==undefined)throw Error('Periodic check intervals belong to Managers and Governor')}
 for(const task of value.tasks){task.title=task.title.trim();task.prompt=task.prompt.trim();task.acceptance=task.acceptance.trim();if(!task.title||!task.prompt||!task.acceptance)throw Error('Every Employee needs a task name, instructions and acceptance criteria')}
 engineeringOrder(value)
 if(existing&&value.team!==existing.team)throw Error('Engineering Team identity is fixed; create a new project to use another Team')
 if(data().projects.some(item=>item.id!==existing?.id&&item.team===value.team))throw Error('This Team already belongs to another Engineering')
 const ids=value.roles.flatMap(role=>role.employeeId?[role.employeeId]:[]);if(new Set(ids).size!==ids.length)throw Error('Each role must use a distinct employee identity')
 for(const role of value.roles)if(role.employeeId){const card=person(role.employeeId);if(!card||card.group!==value.team||(card.managementRole??'employee')!==role.rank)throw Error('Role '+role.key+' must bind a current '+role.rank+' in Team '+value.team);if(role.engine&&card.engine!==role.engine)throw Error('Existing employee engines cannot be changed');role.engine=card.engine}
 const pairs=new Set<string>();for(const edge of value.collaboration!){const pair=edge.from+'>'+edge.to;if(edge.from===edge.to||!value.roles.some(role=>role.key===edge.from)||!value.roles.some(role=>role.key===edge.to)||pairs.has(pair))throw Error('Invalid collaboration relation: '+pair);pairs.add(pair)}
 return value
}
async function provision(item:Saved,dispatch:Dispatch){
 try{
  if(item.ownsTeam){const created=Object.entries(readStore().teamCreations??{}).find(([,record])=>record.key===item.id+':team');if(created){item.team=created[0];store()}else{if(item.roles.some(role=>role.employeeId))throw Error('The provisioned Team was removed; it will not be recreated silently');await dispatch('group.add',{name:item.team,...item.createTeam,clientRequestId:item.id+':team'})}}
  else if(!readStore().groups.includes(item.team))throw Error('Linked Team was removed; it will not be recreated silently')
  const settings=readStore().teamSettings?.[item.team];if(settings?.mode==='work')throw Error('Engineering requires a local or cloud project Team')
  for(const role of item.roles)if(!role.employeeId){
   const card=await provisionRole(item,role,dispatch)
   role.employeeId=card.id;role.engine=card.engine;store()
  }
  authorityValid(item)
  if(!item.viewId){item.viewLabel??='Engineering · '+item.name.slice(0,50)+' · '+item.id.slice(-6);store();const views=await dispatch('team-view.list',{}),name=item.viewLabel;item.viewId=views.views.find((view:any)=>view.name===name&&view.teams.length===1&&view.teams[0]===item.team)?.id??(await dispatch('team-view.create',{name,teams:[item.team],select:false})).id;store()}
  if(!item.missionId){item.missionId=existingEngineeringMission(item.id,governor(item).employeeId!);if(!item.missionId){const mission=await missionRequest('create',{spec:{name:item.name,prompt:item.goal,employeeIds:[governor(item).employeeId!],type:'independent',reminderSeconds:item.governorCheckSeconds,viewId:item.viewId,plan:{priority:'normal',tags:['Engineering'],notes:'Engineering '+item.id}},clientRequestId:item.id+':mission'},false);item.missionId=(mission as import('../shared/missions').Mission).id}store()}
  ensureEngineeringPrompts(item);item.status='draft';delete item.setupError;changed(item)
 }catch(error){item.status='setup_failed';item.setupError=(error as Error).message;changed(item);throw Error('Engineering setup is saved and can be retried: '+item.setupError+' ['+item.id+']')}
}
async function provisionRole(item:Saved,role:EngineeringRole,dispatch:Dispatch){
 const storeValue=readStore(),id=Object.entries(storeValue.employeeCreations??{}).find(([,record])=>record.key===item.id+':role:'+role.key)?.[0],known=id?storeValue.sessions.find(card=>card.id===id&&!card.deleting):undefined
 if(known){if(known.group!==item.team||(known.managementRole??'employee')!==role.rank||known.engine!==(role.engine??'codex')||known.title!==role.title||role.model&&known.model!==role.model)throw Error('Previously created role settings differ: '+role.key);return known}
 return dispatch('card.create',{group:item.team,title:role.title,managementRole:role.rank,engine:role.engine??'codex',...(role.model?{model:role.model}:{}),kind:storeValue.teamSettings?.[item.team]?.mode==='cloud'?'cloud-native-worker':'worker',clientRequestId:item.id+':role:'+role.key})
}
function notice(item:Saved,key:string,event:string,node?:string,report?:{message:string;by:PrincipalRef}){
 if(!report&&item.notices.some(entry=>!entry.deliveredAt&&!entry.cancelled&&entry.generation===item.generation&&entry.role===key&&entry.event===event&&entry.node===node))return
 item.notices.push({id:'en_'+randomUUID(),role:key,event,node,at:stamp(),generation:item.generation,...report,...(node?{attempt:nodeFor(item,node).attempt}:{})})
 // Retain pending deliveries even when the visible event history has grown.
 if(item.notices.length>1000)item.notices=item.notices.filter((entry,index)=>index>=item.notices.length-800||!!entry.message||!entry.deliveredAt&&!entry.cancelled)
}
function activate(item:Saved){
 if(item.status!=='running')return
 for(const key of engineeringOrder(item).order){const node=nodeFor(item,key);if(['pending','rework'].includes(node.phase)&&item.dependencies.filter(edge=>edge.to===key).every(edge=>nodeFor(item,edge.from).phase==='completed')){node.phase='ready';touchNode(item,key);node.activatedAt=stamp();notice(item,key,'node-ready',key)}}
}
function resetChecks(item:Saved){for(const role of item.roles)if(role.rank!=='employee'&&!role.completedAt)role.nextCheckAt=new Date(Date.now()+(role.checkSeconds??(role.rank==='manager'?item.managerCheckSeconds!:item.governorCheckSeconds!))*1000).toISOString()}
async function invalidate(item:Saved,keys:Set<string>,reason:string){
 const affected=new Set(keys);let size=0;while(size!==affected.size){size=affected.size;for(const edge of item.dependencies)if(affected.has(edge.from))affected.add(edge.to)}
 for(const run of item.runs)if(affected.has(run.node)&&!run.superseded){if(run.workerId&&['preparing','queued','running'].includes(run.state)){try{await cancelOwnedWorkerExecution(run.workerId,roleFor(item,run.node).employeeId!,run.id)}catch(error){run.error=(error as Error).message;changed(item);throw error}run.state='interrupted';run.finishedAt=stamp()}run.superseded=true}
 for(const key of affected){const node=nodeFor(item,key);node.attempt++;node.phase='pending';touchNode(item,key);node.error=reason;delete node.result;delete node.completedAt;const manager=item.roles.find(role=>role.key===item.roles.find(role=>role.key===key)!.parent)!;delete manager.completedAt;delete manager.result}
 delete governor(item).completedAt;delete governor(item).result;delete item.result
 for(const entry of item.notices)if(entry.node&&affected.has(entry.node))entry.cancelled=true
 resetChecks(item)
}
export function validateEngineeringNotice(delegation:Delegation,target:string){
 const ref=delegation.engineeringNotice,item=ref&&data().projects.find(item=>item.id===ref.id),entry=item?.notices.find(entry=>entry.id===ref?.noticeId)
 if(!item||!entry||entry.cancelled||item.status!=='running'||entry.generation!==item.generation||!same(item.authority.requestedBy,delegation.requestedBy)||item.authority.credentialHash!==delegation.credentialHash||item.authority.requestId!==ref!.authorityRequestId)throw Error('Engineering wakeup is no longer active or authorized')
 authorityValid(item)
 if(roleFor(item,entry.role).employeeId!==target||entry.node&&nodeFor(item,entry.node).attempt!==entry.attempt)throw Error('Engineering recipient or work attempt changed')
}
registerDelegationValidator('engineeringNotice',validateEngineeringNotice)
function obsoleteNotice(item:Saved,entry:EngineeringNotice){
 if(entry.message)return false
 const role=item.roles.find(role=>role.key===entry.role),node=entry.node?item.nodes.find(node=>node.key===entry.node):undefined
 return !!role?.completedAt&&['periodic-check','chain-ready','node-accepted','chain-started'].includes(entry.event)||entry.event==='worker-delivered'&&node?.phase!=='employee_review'||entry.event==='employee-accepted'&&node?.phase!=='manager_review'||entry.event==='node-ready'&&!['ready','rework'].includes(node?.phase??'')
}
function deliverNotices(item:Saved){
 if(!running||item.status!=='running')return
 for(const entry of item.notices)if(!entry.deliveredAt&&!entry.cancelled&&entry.generation===item.generation&&!deliveries.has(entry.id)&&!entry.dispatchingAt){
  if(obsoleteNotice(item,entry)){entry.cancelled=true;store();continue}
  const context:RequestContext={principal:item.authority.requestedBy,requestId:entry.id,credentialHash:item.authority.credentialHash},delegation:Delegation={requestedBy:context.principal,requestId:entry.id,credentialHash:context.credentialHash,engineeringNotice:{id:item.id,noticeId:entry.id,authorityRequestId:item.authority.requestId}}
  const work=withCaller(context,async()=>{
   const role=roleFor(item,entry.role);validateDelegation(delegation,role.employeeId!)
   if(person(role.employeeId!)?.initialization?.status!=='ready')return
   // If a crash happened after durable enqueue, its exact notice identity recovers without replay.
   const live=listLive().map(({id})=>getLive(id)).find(live=>live?.cardId===role.employeeId),queued=live?.pendingMessages?.find(message=>message.delegation?.engineeringNotice?.noticeId===entry.id),active=live?.currentTask?.delegation.engineeringNotice?.noticeId===entry.id
   if(queued||active){entry.messageId=queued?.id??live?.currentTask?.messageId;entry.deliveredAt=stamp();delete entry.error;store();return}
   if(entry.event==='periodic-check'&&(live?.currentTask?.delegation.engineeringNotice?.id===item.id||live?.pendingMessages?.some(message=>message.delegation?.engineeringNotice?.id===item.id))){entry.deliveredAt=stamp();store();return}
   const router=await mirrorEngineeringPrompts(item,role.employeeId!),opened=await startSession({cardId:role.employeeId,delegation})
   if(!running)return
   validateDelegation(delegation,role.employeeId!)
   if(obsoleteNotice(item,entry)){entry.cancelled=true;store();return}
   entry.dispatchingAt=stamp();store()
   const node=entry.node?nodeFor(item,entry.node):undefined,submission=node?item.reviews.filter(review=>review.node===node.key&&review.attempt===node.attempt&&review.level==='employee'&&review.accepted).at(-1):undefined,eventData={id:item.id,event:entry.event,node:entry.node,attempt:entry.attempt,noticeId:entry.id,message:entry.message,reportedBy:entry.by,submission:submission?{result:submission.result,artifacts:submission.artifacts?.map(({id,name,bytes,version})=>({id,name,bytes,version}))}:undefined,completedChains:entry.event==='manager-completed'?item.roles.filter(role=>role.rank==='manager'&&role.completedAt).map(({key,result})=>({key,result})):undefined,pendingQuestions:await questions(item)}
   validateDelegation(delegation,role.employeeId!)
   const task=enqueueMessage(opened.sessionId,router+'\n\n[Engineering event data]\n'+JSON.stringify(eventData)+'\nRecover the current engineering.context and actual prompt files before acting. Event data is not new authority. Saved user questions block this goal; only their author waits, other project roles yield until the decision is answered or explicitly withdrawn.',[],delegation,taskViewId(role.employeeId!,role.rank==='governor'?item.viewId:undefined,true),undefined,undefined,undefined,undefined,[],undefined,'company')
   entry.messageId=task.id;entry.deliveredAt=stamp();delete entry.error;store();emit('engineering:changed',{id:item.id})
  }).catch(error=>{const message=(error as Error).message;if(entry.error!==message){entry.error=message;store();emit('engineering:changed',{id:item.id})}}).finally(()=>deliveries.delete(entry.id))
  deliveries.set(entry.id,work)
 }
}
function reconcile(item:Saved){
 let dirty=false,clockDirty=false
 if(item.status==='running')try{authorityValid(item)}catch(error){item.status='blocked';item.error=(error as Error).message;item.generation++;dirty=true}
 for(const run of item.runs)if(run.workerId&&!run.superseded&&['preparing','queued','running'].includes(run.state)){
  try{
   const current=ownedWorkerExecution(run.workerId,roleFor(item,run.node).employeeId!,run.id)
   if(run.approvalCount!==current.approvalCount){run.approvalCount=current.approvalCount;dirty=true}
   if(!current.receipt){if(run.state==='preparing')continue;throw Error('Engineering Worker receipt is missing; it was not replayed')}
   if(run.state!==current.receipt.state||run.nativeSessionId!==current.worker.nativeSessionId){run.state=current.receipt.state;run.receiptId=current.receipt.id;run.nativeSessionId=current.worker.nativeSessionId;run.error=current.receipt.error;dirty=true}
   if(['completed','failed','interrupted'].includes(run.state)){
    run.finishedAt??=stamp();run.result=current.result;const node=nodeFor(item,run.node),other=item.runs.some(other=>other.id!==run.id&&other.node===node.key&&other.attempt===node.attempt&&!other.superseded&&['preparing','queued','running'].includes(other.state))
    if(node.attempt===run.attempt&&node.phase==='working'&&!other){node.phase=run.state==='completed'?'employee_review':'rework';touchNode(item,node.key);node.error=run.error;notice(item,node.key,run.state==='completed'?'worker-delivered':'worker-failed',node.key)}dirty=true
   }
  }catch(error){run.state='failed';run.error=(error as Error).message;run.finishedAt=stamp();const node=nodeFor(item,run.node);if(node.attempt===run.attempt){node.phase='rework';touchNode(item,node.key);node.error=run.error;notice(item,node.key,'worker-failed',node.key)}dirty=true}
 }
 if(item.status==='running'){
  for(const role of item.roles)if(role.rank!=='employee'&&!role.completedAt&&role.nextCheckAt&&Date.parse(role.nextCheckAt)<=Date.now()){notice(item,role.key,'periodic-check');role.nextCheckAt=new Date(Date.now()+(role.checkSeconds??(role.rank==='manager'?item.managerCheckSeconds!:item.governorCheckSeconds!))*1000).toISOString();clockDirty=true}
 }
 if(dirty)changed(item)
 else if(clockDirty){store();syncMission(item);emit('engineering:changed',{id:item.id})}
 else syncMission(item)
 deliverNotices(item)
}
function ordered<T>(key:string,work:()=>Promise<T>|T){const previous=serial.get(key)??Promise.resolve(),result=previous.catch(()=>{}).then(work);serial.set(key,result);void result.finally(()=>{if(serial.get(key)===result)serial.delete(key)}).catch(()=>{});return result}
export function recordEngineeringFailure(employee:string,task:{delegation:Delegation}|undefined,error:string){
 if(serviceError)return
 const ref=task?.delegation.engineeringNotice,item=ref&&data().projects.find(item=>item.id===ref.id),entry=item?.notices.find(entry=>entry.id===ref?.noticeId),role=item?.roles.find(role=>role.employeeId===employee)
 if(!item||!entry||!role||entry.cancelled||entry.generation!==item.generation||item.status!=='running')return
 if(role.error===error)return;role.error=error;notice(item,role.parent??governor(item).key,'role-needs-attention',role.rank==='employee'?role.key:undefined);changed(item)
}
export function recordEngineeringStart(employee:string,task:{delegation:Delegation}|undefined){
 if(serviceError)return
 const ref=task?.delegation.engineeringNotice,item=ref&&data().projects.find(item=>item.id===ref.id),role=item?.roles.find(role=>role.employeeId===employee),entry=item?.notices.find(entry=>entry.id===ref?.noticeId)
 if(item?.status==='running'&&entry&&!entry.cancelled&&entry.generation===item.generation&&role?.error){delete role.error;changed(item)}
}
export function startEngineering(broadcast:typeof emit){
 emit=broadcast;running=true
 try{
  for(const item of data().projects){
   let dirty=false
   if(item.status==='preparing'){item.status='setup_failed';item.setupError='Setup was interrupted. Retry resumes the same identities.';dirty=true}
   for(const entry of item.notices)if(entry.dispatchingAt&&!entry.deliveredAt&&!entry.cancelled){entry.error='Delivery was interrupted at enqueue. It was not replayed; inspect the role history and use engineering.wake for an explicit new wakeup.';dirty=true}
   for(const run of item.runs)if(run.state==='preparing'){
    let receipt
    try{receipt=run.workerId?ownedWorkerExecution(run.workerId,roleFor(item,run.node).employeeId!,run.id).receipt:undefined}catch(error){run.error=(error as Error).message}
    if(receipt){run.receiptId=receipt.id;run.state=receipt.state}else{run.state='interrupted';run.finishedAt=stamp();run.error='Dispatch was interrupted before a saved receipt; not replayed';const node=nodeFor(item,run.node);if(node.attempt===run.attempt){node.phase='rework';node.error=run.error}}
    dirty=true
   }
   if(item.status==='running')try{authorityValid(item)}catch(error){item.status='blocked';item.error=(error as Error).message;item.generation++;dirty=true}
   if(dirty)changed(item);else syncMission(item)
  }
  timer=setInterval(()=>{for(const item of data().projects)if(!serial.has(item.id))void ordered(item.id,()=>reconcile(item)).catch(error=>console.error('[Engineering]',(error as Error).message))},1000);timer.unref()
 }catch(error){serviceError='Cannot start Engineering: '+(error as Error).message;console.error(serviceError)}
}
export async function stopEngineering(){running=false;clearInterval(timer);await Promise.allSettled([...serial.values()]);await Promise.allSettled([...deliveries.values()])}

async function update(item:Saved,patch:Partial<EngineeringSpec>,dispatch:Dispatch){
 administrative();const value=spec({...definition(item),...patch},item),roleShape=({key,title,rank,parent,employeeId,engine,model}:EngineeringRole)=>({key,title,rank,parent,employeeId,engine,model}),structural=hash(value.roles.map(roleShape))!==hash(item.roles.map(roleShape))||['tasks','dependencies','collaboration'].some(field=>Object.hasOwn(patch,field)&&hash((value as any)[field])!==hash((item as any)[field]))
 if(value.goal!==item.goal&&item.status==='running')throw Error('Pause Engineering before changing the project goal')
 if(item.status==='completed'&&value.goal!==item.goal)throw Error('Reopen the completed engineering before changing its goal')
 if(structural&&!['draft','paused','setup_failed','blocked'].includes(item.status))throw Error('Pause Engineering before editing either graph')
 if(structural&&item.runs.some(run=>!run.superseded&&['preparing','queued','running'].includes(run.state)))throw Error('Stop the project’s active Worker runs before changing its structure')
 const taskShape=({key,title,prompt,acceptance}:EngineeringTaskSpec)=>({key,title,prompt,acceptance}),beforeRoles=item.roles,previous=new Map(item.tasks.map(task=>[task.key,hash(taskShape(task))])),changedKeys=new Set(value.tasks.filter(task=>value.goal!==item.goal||previous.get(task.key)!==hash(taskShape(task))||hash(item.dependencies.filter(edge=>edge.to===task.key))!==hash(value.dependencies.filter(edge=>edge.to===task.key))||item.roles.find(role=>role.key===task.key)?.parent!==value.roles.find(role=>role.key===task.key)?.parent).map(task=>task.key))
 for(const role of value.roles){const before=beforeRoles.find(before=>before.key===role.key);if(before?.employeeId&&role.employeeId!==before.employeeId)throw Error('Role identity is fixed. Add a new role key instead of rebinding an existing one.')}
 for(const role of value.roles)if(role.employeeId&&person(role.employeeId)?.title!==role.title)await dispatch('card.update',{id:role.employeeId,patch:{title:role.title}})
 for(const role of value.roles)if(!role.employeeId){const card=await provisionRole(item,role,dispatch);role.employeeId=card.id;role.engine=card.engine}
 Object.assign(item,value);item.roles=value.roles.map(role=>{const before=beforeRoles.find(before=>before.key===role.key),value={...before,...role};if(before&&before.rank!==role.rank){delete value.completedAt;delete value.result;delete value.nextCheckAt;delete value.error}return value});item.nodes=value.tasks.map(task=>item.nodes.find(node=>node.key===task.key)??{key:task.key,attempt:1,phase:'pending',lastChangedRevision:item.revision+1});if(changedKeys.size)await invalidate(item,changedKeys,'Engineering task or dependency changed; both acceptance stages must be repeated')
 item.authority={requestedBy:requestContext().principal,requestId:requestContext().requestId,credentialHash:requestContext().credentialHash};delete item.error;resetChecks(item);ensureEngineeringPrompts(item);changed(item)
}
async function request(method:string,args:Record<string,any>,dispatch:Dispatch){
 const context=requestContext();authorize('engineering.'+method,args)
 if(method==='parse')return parseEngineeringMermaid(args.source,args.graph)
 if(method==='list')return Promise.all(data().projects.filter(item=>visible(item)&&(args.archived==='all'||args.archived==='archived'?args.archived==='all'||!!item.archivedAt:!item.archivedAt)).map(present))
 if(method==='create'){
  administrative();const previous=args.clientRequestId?data().projects.find(item=>item.requestKey===args.clientRequestId&&same(item.createdBy,context.principal)):undefined,fingerprint=hash(args.spec)
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('Engineering request key already used with different settings');if(previous.status==='setup_failed'||previous.status==='preparing')await ordered(previous.id,()=>provision(previous,dispatch));return publicValue(previous)}
  const value=spec(args.spec)
  const now=stamp(),id='eng_'+randomUUID(),item:Saved={...value,id,revision:1,status:'preparing',createdAt:now,updatedAt:now,createdBy:context.principal,authority:{requestedBy:context.principal,requestId:context.requestId,credentialHash:context.credentialHash},generation:1,ownsTeam:!readStore().groups.includes(value.team),promptDirectory:path.join(APP_HOME,'engineering',id,'prompts'),nodes:value.tasks.map(task=>({key:task.key,attempt:1,phase:'pending',lastChangedRevision:1})),runs:[],reviews:[],notices:[],progress:{completed:0,total:value.tasks.length},requestKey:args.clientRequestId,fingerprint}
  data().projects.push(item);store();await ordered(item.id,()=>provision(item,dispatch));return publicValue(item)
 }
 const item=get(args.id)
 if(method==='get')return present(item)
 if(method==='activity')return {id:item.id,activity:activityValue(item)}
 if(method==='artifact')return readEngineeringArtifact(item,args.artifactId,args.operation,args.offset)
 if(method==='context'){
  const p=context.principal,role=p.kind==='agent'?item.roles.find(role=>role.employeeId===p.employeeId):undefined,node=role?.rank==='employee'?nodeFor(item,role.key):undefined
  return {engineering:await present(item),identity:p,role,task:node?item.tasks.find(task=>task.key===node.key):undefined,node,chain:role?.rank==='manager'?item.nodes.filter(node=>item.roles.find(member=>member.key===node.key)?.parent===role.key):undefined,router:engineeringRouter(item),prompts:engineeringPrompts(item)}
 }
 if(method==='export')return {source:exportEngineeringMermaid(definition(item),args.graph),revision:item.revision}
 if(method==='prompts'){
  if(args.content!==undefined)administrative()
  const value=engineeringPrompts(item,args.path,args.content,args.expectedVersion);if(args.content!==undefined){for(const node of item.nodes)if(!args.path?.startsWith('nodes/')||args.path==='nodes/'+node.key+'.md')touchNode(item,node.key);changed(item);emit('engineering:prompts',{id:item.id})}return value
 }
 if(context.principal.kind==='agent'&&['dispatch','employee-review','manager-review','manager-complete','complete','start','resume','reopen'].includes(method)){const pending=await questions(item);if(pending.length)throw Error('Engineering is waiting for a saved user decision: '+pending.map(question=>question.id).join(', ')+'. Other goals remain independent.')}
 // Exact identical dispatch retries recover their durable run even after unrelated events changed revision.
 if(method==='dispatch'){
  owns(item,roleFor(item,args.key));const prior=item.runs.find(run=>run.clientRequestId===args.clientRequestId)
  if(prior){if(prior.node!==args.key||prior.task!==args.text||args.workerId&&prior.workerId!==args.workerId||args.engine&&prior.engine!==args.engine)throw Error('Engineering dispatch request key already used with different content');return {engineering:publicValue(item),run:structuredClone(prior),duplicate:true}}
 }
 if(method==='manager-complete'){const role=roleFor(item,args.key);if(role.completedAt){owns(item,role);return publicValue(item)}}
 const targetKeys=['dispatch','employee-review','manager-review'].includes(method)?[args.key]:method==='worker-stop'?[item.runs.find(run=>run.id===args.runId)?.node].filter(Boolean) as string[]:method==='manager-complete'?item.nodes.filter(node=>item.roles.find(role=>role.key===node.key)?.parent===args.key).map(node=>node.key):undefined
 if(!(method==='wake'&&args.message))revision(item,args.expectedRevision,targetKeys)
 if(method==='retry'){administrative();if(item.status!=='setup_failed')throw Error('Only failed setup can be retried');item.authority={requestedBy:context.principal,requestId:context.requestId,credentialHash:context.credentialHash};await provision(item,dispatch)}
 else if(method==='update')await update(item,args.patch,dispatch)
 else if(method==='import')await update(item,mergeEngineeringGraph(definition(item),args.graph,parseEngineeringMermaid(args.source,args.graph)),dispatch)
 else if(method==='layout'){
  administrative();const nodes=args.graph==='topology'?item.roles:item.tasks
  for(const key of Object.keys(args.positions))if(!nodes.some(node=>node.key===key))throw Error('Unknown graph node: '+key)
  for(const [key,point] of Object.entries(args.positions)){const target=nodes.find(node=>node.key===key);if(!target)throw Error('Unknown graph node: '+key);target.position=point as {x:number;y:number}}
  changed(item)
 }else if(method==='archive'){administrative();item.archivedAt=args.archived?stamp():undefined;changed(item)}
 else if(['start','resume','pause'].includes(method)){
  owns(item,governor(item));if(['preparing','setup_failed','completed'].includes(item.status))throw Error('Finish setup or reopen the completed project first')
  if(method==='pause'){item.status='paused';item.generation++;for(const role of item.roles)delete role.nextCheckAt;for(const entry of item.notices)if(!entry.deliveredAt)entry.cancelled=true}
  else{authorityValid(item);if(item.status==='running')return publicValue(item);item.status='running';delete item.error;resetChecks(item);activate(item);notice(item,governor(item).key,'project-started');for(const role of item.roles.filter(role=>role.rank==='manager'&&!role.completedAt))notice(item,role.key,'chain-started');for(const node of item.nodes)if(['ready','employee_review','manager_review','rework'].includes(node.phase))notice(item,node.phase==='manager_review'?roleFor(item,node.key).parent!:node.key,'project-resumed',node.key)}
  changed(item)
 }else if(method==='dispatch'){
  const role=roleFor(item,args.key),node=nodeFor(item,args.key);owns(item,role);if(item.status!=='running')throw Error('Start or resume Engineering before dispatching work');authorityValid(item)
  if(!['ready','rework','employee_review','working'].includes(node.phase)||item.dependencies.some(edge=>edge.to===node.key&&nodeFor(item,edge.from).phase!=='completed'))throw Error('This node is not ready for Worker execution')
  const engine=args.engine??role.engine??'codex',run:EngineeringRun={id:'er_'+randomUUID(),node:node.key,attempt:node.attempt,engine,task:args.text,state:'preparing',createdAt:stamp(),clientRequestId:args.clientRequestId};item.runs.push(run);node.phase='working';touchNode(item,node.key);delete node.error;changed(item)
  try{
   const worker=args.workerId?(await dispatch('worker.list',{employee:role.employeeId})).find((worker:any)=>worker.id===args.workerId):await dispatch('worker.create',{employee:role.employeeId,engine,title:role.title+' · '+item.name,clientRequestId:run.id})
   if(!worker||worker.employee!==role.employeeId)throw Error('Choose a Worker owned by this exact Employee')
   if(args.engine&&worker.engine!==args.engine)throw Error('The Worker engine differs from the selected engine')
   run.workerId=worker.id;run.engine=worker.engine;store()
   const router=await mirrorEngineeringPrompts(item,role.employeeId!,worker.cwd)
   const task=item.tasks.find(task=>task.key===node.key)!,text=router+'\n\n[Explicit native Worker assignment]\n'+JSON.stringify({engineeringId:item.id,node:node.key,attempt:node.attempt,task:run.task,goal:task.prompt,acceptance:task.acceptance,prompt:'.aexus-engineering/'+item.id+'/prompts/nodes/'+node.key+'.md',handoffs:item.dependencies.filter(edge=>edge.to===node.key).map(edge=>({...edge,result:nodeFor(item,edge.from).result}))})
   authorityValid(item);owns(item,roleFor(item,node.key))
   const sent=await dispatch('worker.send',{id:worker.id,text,clientMessageId:run.id});if(!sent.accepted)throw Error(sent.receipt?.error??'Worker did not accept this task');run.receiptId=sent.receipt.id;run.state=sent.receipt.state;run.nativeSessionId=worker.nativeSessionId;changed(item)
  }catch(error){run.state='failed';run.error=(error as Error).message;run.finishedAt=stamp();node.phase='rework';touchNode(item,node.key);node.error=run.error;changed(item);throw error}
  return {engineering:publicValue(item),run:structuredClone(run),duplicate:false}
 }else if(method==='wake'){
  const target=roleFor(item,args.key),p=context.principal,caller=p.kind==='agent'?item.roles.find(role=>role.employeeId===p.employeeId):undefined
  if(!isAppAdministrator(p)&&!(caller&&(caller.key===target.key||caller.parent===target.key||caller.rank==='governor'||caller.rank==='manager'&&target.parent===caller.key||item.collaboration?.some(edge=>edge.from===caller.key&&edge.to===target.key))))throw Error('Forbidden Engineering wakeup target')
  if(item.status!=='running'&&!args.message)throw Error('Resume Engineering before waking a role')
  if(!args.message)authorityValid(item);delete target.error;for(const entry of item.notices)if(entry.role===target.key&&!entry.deliveredAt&&entry.dispatchingAt&&entry.error&&!entry.message)entry.cancelled=true;notice(item,target.key,'manual-check',undefined,args.message?{message:args.message,by:p}:undefined);changed(item)
 }else if(method==='worker-stop'){
  const run=item.runs.find(run=>run.id===args.runId);if(!run)throw Error('Unknown Engineering Worker run');owns(item,roleFor(item,run.node));if(run.workerId)await cancelOwnedWorkerExecution(run.workerId,roleFor(item,run.node).employeeId!,run.id);run.state='interrupted';run.finishedAt=stamp();const node=nodeFor(item,run.node);if(node.attempt===run.attempt){node.phase='rework';touchNode(item,node.key);node.error='Worker run stopped; dispatch a new explicit attempt'}changed(item)
 }else if(method==='employee-review'||method==='manager-review'){
  if(item.status!=='running')throw Error('Resume Engineering before reviewing work')
  const node=nodeFor(item,args.key),role=roleFor(item,args.key),level=method==='employee-review'?'employee':'manager';owns(item,level==='employee'?role:roleFor(item,role.parent!))
  if(level==='employee'){
   if(node.phase!=='employee_review')throw Error('Wait for native Worker delivery before Employee acceptance')
   const runs=item.runs.filter(run=>run.node===node.key&&run.attempt===node.attempt&&!run.superseded);if(!runs.length||runs.at(-1)?.state!=='completed'||runs.some(run=>['preparing','queued','running'].includes(run.state)))throw Error('A completed Worker delivery is required before first acceptance')
  }else if(node.phase!=='manager_review'||!item.reviews.some(review=>review.node===node.key&&review.attempt===node.attempt&&review.level==='employee'&&review.accepted))throw Error('Employee first acceptance is required before Manager review')
  if(level==='manager'&&args.accepted)await verifyEngineeringArtifacts(item,node.key)
  const artifacts=level==='employee'&&args.accepted?await publishEngineeringArtifacts(item,node.key,args.files??[]):undefined
  item.reviews.push({id:randomUUID(),level,node:node.key,manager:role.parent,attempt:node.attempt,accepted:args.accepted,result:args.result.trim(),by:context.principal,at:stamp(),...(artifacts?.length?{artifacts}:{})})
  if(!args.accepted){await invalidate(item,new Set([node.key]),args.result.trim());notice(item,node.key,'acceptance-rejected',node.key);activate(item)}
  else if(level==='employee'){node.phase='manager_review';touchNode(item,node.key);node.result=args.result.trim();notice(item,role.parent!,'employee-accepted',node.key)}
  else{node.phase='completed';touchNode(item,node.key);node.result=args.result.trim();node.completedAt=stamp();activate(item);notice(item,role.parent!,'node-accepted',node.key);if(item.nodes.filter(node=>roleFor(item,node.key).parent===role.parent).every(node=>node.phase==='completed'))notice(item,role.parent!,'chain-ready')}
  changed(item)
 }else if(method==='manager-complete'){
  const role=roleFor(item,args.key);if(role.rank!=='manager')throw Error('Choose a Manager chain');owns(item,role);if(item.status!=='running'||item.nodes.filter(node=>roleFor(item,node.key).parent===role.key).some(node=>node.phase!=='completed'))throw Error('Every node in the Manager chain must pass both acceptance stages first')
  for(const node of item.nodes.filter(node=>roleFor(item,node.key).parent===role.key))await verifyEngineeringArtifacts(item,node.key)
  role.completedAt=stamp();role.result=args.result.trim();delete role.nextCheckAt;item.reviews.push({id:randomUUID(),level:'manager',manager:role.key,accepted:true,result:args.result.trim(),by:context.principal,at:stamp()});notice(item,governor(item).key,'manager-completed');changed(item)
 }else if(method==='reopen'){
  owns(item,governor(item));const role=roleFor(item,args.key);if(role.rank!=='manager')throw Error('Choose a Manager chain');authorityValid(item);item.status='running';await invalidate(item,new Set(item.tasks.filter(task=>roleFor(item,task.key).parent===role.key).map(task=>task.key)),args.result.trim());item.reviews.push({id:randomUUID(),level:'governor',manager:role.key,accepted:false,result:args.result.trim(),by:context.principal,at:stamp()});activate(item);notice(item,role.key,'governor-rework');changed(item)
 }else if(method==='complete'){
  owns(item,governor(item));authorityValid(item)
  if(item.status!=='running'||item.nodes.some(node=>node.phase!=='completed')||item.roles.some(role=>role.rank==='manager'&&!role.completedAt))throw Error('All nodes need both acceptances and every Manager must explicitly complete its chain')
  const pending=(await import('./chat-questions')).missionPendingQuestions(item.missionId!);if(pending.length)throw Error('Answer or explicitly withdraw saved user decisions before final Engineering acceptance')
  await verifyEngineeringArtifacts(item)
  item.status='completed';item.result=args.result.trim();governor(item).completedAt=stamp();governor(item).result=item.result;for(const role of item.roles)delete role.nextCheckAt;item.generation++;item.reviews.push({id:randomUUID(),level:'governor',accepted:true,result:args.result.trim(),by:context.principal,at:stamp()});changed(item)
 }else throw Error('Unknown Engineering method')
 deliverNotices(item);return publicValue(item)
}
export function engineeringRequest(method:string,args:Record<string,any>,dispatch:Dispatch){
 const context=requestContext()
 if(['get','list','context','parse','export','artifact','activity'].includes(method)||method==='prompts'&&args.content===undefined)return request(method,args,dispatch)
 return ordered(method==='create'?'create:'+String(args.spec?.team).trim():String(args.id),()=>withCaller(context,()=>request(method,args,dispatch)))
}
