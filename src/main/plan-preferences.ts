import {join} from 'node:path'
import {APP_HOME} from '../shared/protocol'
import type {PlanPreferences} from '../shared/plan-preferences'
import type {RequestContext} from '../shared/management'
import {atomicJson,readJson} from './atomic-file'
import {requestContext,requireAppAdministrator,withCaller,isAppAdministrator,canSchedule} from './authorization'
import {credentialActive} from './agent-access'
import {scheduleRequest} from './scheduler/service'
import type {ScheduledJob,ScheduleRun} from '../shared/scheduler'
import {archiveMission,missionRows,missionRequest} from './missions'

type State=PlanPreferences&{version:1;archives:Record<string,string>;context?:RequestContext}
const file=join(APP_HOME,'plan-preferences.json')
let emit:(channel:string,payload:unknown)=>void=()=>{},timer:ReturnType<typeof setInterval>|undefined,sweeping=false
function read(){return readJson<State>(file,()=>({version:1,revision:1,filter:{},hiddenIds:[],retention:{succeeded:{action:'keep',afterSeconds:86400},failed:{action:'keep',afterSeconds:604800}},archives:{}}),value=>(value as State)?.version===1&&Number.isSafeInteger((value as State)?.revision))}
function save(value:State){value.revision++;atomicJson(file,value,true);emit('plan:changed',{})}
const publicValue=(value:State):PlanPreferences=>({revision:value.revision,filter:value.filter,hiddenIds:value.hiddenIds,retention:value.retention})
export function planArchives(){return read().archives}
export async function planPreferencesRequest(method:string,args:Record<string,any>){
 const value=read()
 if(method==='preferences'){
  requireAppAdministrator()
  if(args.patch){if(args.expectedRevision!==value.revision)throw Error('Mission preferences changed; reload before saving');Object.assign(value,args.patch);const context=requestContext();value.context={principal:context.principal,requestId:context.requestId,credentialHash:context.credentialHash};save(value)}
  return publicValue(value)
 }
 if(method==='archive'){
  if(args.id.startsWith('mission_'))return missionRequest('archive',args)
  const job=await scheduleRequest('get',{id:args.id}) as ScheduledJob
  if(!isAppAdministrator()&&!canSchedule(requestContext().principal,job.action.employeeId))throw Error('Forbidden archive target')
  if((job.revision??0)!==args.expectedRevision)throw Error('Schedule changed; reload before archiving')
  if(args.archived)value.archives[job.id]=new Date().toISOString();else delete value.archives[job.id]
  save(value);return {archived:args.archived,id:job.id}
 }
 throw Error('Unknown Mission preference operation')
}
/** Retention never cancels an active/recurring job or deletes an unresolved mission. */
export async function sweepPlanRetention(){
 if(sweeping)return;sweeping=true
 try{
  const initial=read(),context=initial.context
  if(!context||!isAppAdministrator(context.principal)||context.principal.kind==='agent'&&context.credentialHash&&!credentialActive(context.principal.employeeId,context.credentialHash))return
  await withCaller(context,async()=>{
   const jobs=await scheduleRequest('list',{}) as ScheduledJob[],runs=await scheduleRequest('history',{limit:1000}) as ScheduleRun[],latest=new Map<string,ScheduleRun>();for(const run of runs)if(!latest.has(run.jobId))latest.set(run.jobId,run)
   for(const item of missionRows()){
    const kind=item.status==='succeeded'?'succeeded':item.status==='failed'?'failed':null;if(!kind)continue
    const policy=read().retention[kind],at=kind==='succeeded'?item.completedAt:item.failedAt
    if(policy.action==='keep'||!at||Date.now()-Date.parse(at)<policy.afterSeconds*1000)continue
    if(policy.action==='archive'||item.engineering){if(!item.archivedAt)archiveMission(item.id,true)}
    else if(item.status==='succeeded')await missionRequest('delete',{id:item.id,expectedRevision:item.revision})
   }
   for(const job of jobs){
    const run=latest.get(job.id);if(!run||run.status==='running'||job.nextAt||job.rule.kind==='event')continue
    const kind=run.status==='succeeded'?'succeeded':['failed','timed_out','interrupted','cancelled','skipped'].includes(run.status)?'failed':null;if(!kind||!run.finishedAt)continue
    const policy=read().retention[kind];if(policy.action==='keep'||Date.now()-Date.parse(run.finishedAt)<policy.afterSeconds*1000)continue
    if(policy.action==='delete')await scheduleRequest('delete',{id:job.id,expectedRevision:job.revision??0})
    else{const value=read();if(!value.archives[job.id]){value.archives[job.id]=new Date().toISOString();save(value)}}
   }
  })
 }finally{sweeping=false}
}
export function startPlanRetention(broadcast:typeof emit){emit=broadcast;timer=setInterval(()=>void sweepPlanRetention().catch(error=>console.error('[Mission retention]',error.message)),10000);timer.unref()}
export function stopPlanRetention(){clearInterval(timer)}
