import {canSchedule} from './employee-authority'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import type {ScriptMonitor} from '../shared/script-monitors'
import type {PrincipalRef} from '../shared/management'
import type {ScheduleEvent} from '../shared/scheduler'
import {atomicJson,readJson} from './atomic-file'
import {readStore} from './store'
import {requestContext,withCaller,operatorContext} from './request-context'
import {isAppAdministrator} from './application-authority'
import {executionEmployee} from './workspaces'
import {spawnMonitor} from './script-monitor-process'
import {TerminalOutput} from './terminal-output'
import {StringDecoder} from 'node:string_decoder'

type Running=ReturnType<typeof spawnMonitor>&{output:TerminalOutput;pending:string;launchId:string;running:boolean;exitCode?:number}
const file=path.join(APP_HOME,'script-monitors.json'),live=new Map<string,Running>(),logs=new Map<string,TerminalOutput>(),locks=new Set<string>()
let timer:NodeJS.Timeout|undefined,publish:(event:ScheduleEvent)=>void=()=>{},changed:()=>void=()=>{},stopping=false
const records=()=>readJson<ScriptMonitor[]>(file,()=>[],Array.isArray)
export const monitorRecord=(id:string)=>records().find(m=>m.id===id)
export const canObserveMonitor=(m:ScriptMonitor,principal:PrincipalRef)=>canSchedule(principal,m.employee)
export const canUseMonitor=(m:ScriptMonitor,principal:PrincipalRef)=>isAppAdministrator(principal)||principal.kind==='agent'&&principal.employeeId===m.employee
function get(id:string,reading=false){const m=monitorRecord(id);if(!m||!(reading?canObserveMonitor:canUseMonitor)(m,requestContext().principal))throw Error('Unknown monitor for this caller');return m}
function update(id:string,patch:Partial<ScriptMonitor>){const all=records(),m=all.find(m=>m.id===id);if(!m)return;Object.assign(m,patch);atomicJson(file,all,true);if('state' in patch)changed();return m}
function owner(employee?:string){const principal=requestContext().principal,id=employee??(principal.kind==='agent'?principal.employeeId:undefined),card=readStore().sessions.find(c=>c.id===id&&!c.deleting);if(!card||!isAppAdministrator()&&(principal.kind!=='agent'||principal.employeeId!==card.id))throw Error('Choose your own employee workspace');return card}
const binding=(employee:ReturnType<typeof owner>)=>{const e=executionEmployee(readStore(),employee);return JSON.stringify([e.cwd,e.remote??null,e.accessMode??'trusted'])}
async function start(id:string){
 if(locks.has(id))throw Error('Monitor is changing state')
 if(live.has(id))return get(id)
 locks.add(id)
 try{
  const m=get(id),card=owner(m.employee),e=executionEmployee(readStore(),card)
  if(binding(card)!==m.binding)throw Error('Monitor execution host/workspace changed; recreate it. No local fallback')
  if(e.accessMode==='isolated')throw Error('Script monitors are unavailable under strict isolation; no unrestricted fallback')
  const launchId=randomUUID(),process=spawnMonitor(m.program,m.cwd,card.cwd,e.remote),stream:Running={...process,launchId,output:new TerminalOutput(),pending:'',running:true},stdout=new StringDecoder('utf8'),stderr=new StringDecoder('utf8')
  logs.set(id,stream.output);live.set(id,stream)
  process.child.stdout.on('data',data=>{const text=stdout.write(data);stream.output.append(text);stream.pending+=text;withCaller(operatorContext(),()=>consume(id,stream))})
  process.child.stderr.on('data',data=>stream.output.append(stderr.write(data)))
  process.child.on('error',error=>{stream.output.append(error.message);update(id,{error:error.message})})
  process.child.on('close',code=>{const tail=stdout.end();stream.output.append(tail);stream.pending+=tail;stream.output.append(stderr.end());stream.running=false;stream.exitCode=code??1;if(live.get(id)===stream)withCaller(operatorContext(),()=>{consume(id,stream,true);publish({type:'monitor.exited',id:stream.launchId,monitorId:id,data:{exitCode:stream.exitCode}});update(id,{state:'exited',exitCode:stream.exitCode});live.delete(id)})})
  return update(id,{state:'running',enabled:true,launchId,terminal:undefined,exitCode:undefined,error:undefined})
 }finally{locks.delete(id)}
}
function consume(id:string,stream:Running,final=false){
 if(live.get(id)!==stream)return
 const lines=stream.pending.split(/\r?\n/);stream.pending=lines.pop()??''
 if(final&&stream.pending){lines.push(stream.pending);stream.pending=''}
 if(Buffer.byteLength(stream.pending,'utf8')>65536){stream.pending='';update(id,{error:'Monitor must emit JSON lines shorter than 64 KiB'})}
 for(const line of lines){
  if(Buffer.byteLength(line,'utf8')>65536){update(id,{error:'Monitor must emit JSON lines shorter than 64 KiB'});continue}
  let value:any;try{value=JSON.parse(line)}catch{continue}
  if(!value||typeof value.id!=='string'||!value.id.trim()||value.id.length>160)continue
  publish({type:'monitor.output',id:value.id,monitorId:id,data:value.data});update(id,{lastEventId:value.id})
 }
}
function poll(){
 for(const [id]of live){const m=monitorRecord(id);if(!m||!readStore().sessions.some(c=>c.id===m.employee&&!c.deleting))void stop(id).catch(error=>console.error('[Monitor stop]',error.message))}
}
async function stop(id:string,disable=true){
 const m=monitorRecord(id),stream=live.get(id);live.delete(id)
 if(stream)await stream.stop()
 if(m)return update(id,{state:stopping?'interrupted':'stopped',terminal:undefined,...(disable?{enabled:false}:{})})
}
export function startScriptMonitors(handler:typeof publish,onChanged:()=>void=()=>{}){
 stopping=false;publish=handler;changed=onChanged
 for(const m of records()){
  if(m.state==='running')update(m.id,{state:'interrupted',terminal:undefined})
  if(m.enabled&&m.restartOnLaunch)void withCaller(operatorContext(),()=>start(m.id)).catch(error=>update(m.id,{state:'error',error:(error as Error).message}))
 }
 timer=setInterval(()=>withCaller(operatorContext(),poll),100);timer.unref()
}
export async function stopScriptMonitors(){stopping=true;clearInterval(timer);timer=undefined;await Promise.all([...live.keys()].map(id=>stop(id,false)));publish=()=>{};changed=()=>{}}
export async function monitorRequest(command:string,args:Record<string,any>){
 if(command==='monitor.list')return records().filter(m=>canObserveMonitor(m,requestContext().principal)&&(!args.employee||m.employee===args.employee))
 if(command==='monitor.create'){
  const card=owner(args.employee),e=executionEmployee(readStore(),card),paths=e.remote?.os==='windows'?path.win32:e.remote?path.posix:path
  if(typeof args.name!=='string'||!args.name.trim()||args.name.length>160||!Array.isArray(args.program)||!args.program.length||args.program.length>80||args.program.some((s:unknown)=>typeof s!=='string'||!s||s.includes('\0')))throw Error('Provide a name and program argv')
  const root=e.remote?card.cwd:fs.realpathSync(card.cwd),cwd=paths.resolve(root,args.cwd??'.'),relative=paths.relative(root,cwd)
  if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw Error('Monitor cwd must remain in your own workspace')
  if(!e.remote&&(!fs.statSync(cwd).isDirectory()||!fs.realpathSync(cwd).startsWith(root+paths.sep)&&fs.realpathSync(cwd)!==root))throw Error('Monitor cwd must be an existing own directory')
  if(args.restartOnLaunch!==undefined&&typeof args.restartOnLaunch!=='boolean')throw Error('restartOnLaunch must be boolean')
  const m:ScriptMonitor={id:'mon_'+randomUUID(),employee:card.id,name:args.name.trim(),program:[...args.program],cwd,host:e.remote?.host,binding:binding(card),createdAt:Date.now(),enabled:false,restartOnLaunch:args.restartOnLaunch??false,state:'stopped'}
  atomicJson(file,[...records(),m],true);changed();return m
 }
 const m=get(args.id,command==='monitor.read')
 if(command==='monitor.start')return start(m.id)
 if(command==='monitor.read'){if(args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0))throw Error('cursor must be a non-negative integer');return {...m,...(logs.get(m.id)?.read(args.cursor??0)??{output:'',cursor:0})}}
 if(command==='monitor.stop')return stop(m.id)
 if(command==='monitor.remove'){await stop(m.id);atomicJson(file,records().filter(r=>r.id!==m.id),true);logs.delete(m.id);changed();return {removed:true}}
 throw Error('Unknown monitor command')
}
