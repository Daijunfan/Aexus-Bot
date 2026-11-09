import {TerminalOutput} from './terminal-output'
import {windowsTerminal} from './terminal-windows'
import fs from 'node:fs'
import path from 'node:path'
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createInterface} from 'node:readline'
import {StringDecoder} from 'node:string_decoder'
import {randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import type {StoredSession} from '../shared/types'
import {childEnv} from './exec'
import {python,tunnelDirectory,tunnelConfig} from './tunnel'
import {nativeWorkerEnv} from './native-worker-env'

export type TerminalProgram={runtime?:'node';program:string[];worker:string;root:string}
type Terminal={id:string;employee:string;worker?:string;purpose?:'agent'|'shell';cwd:string;host?:string;running:boolean;exitCode?:number;output:TerminalOutput;process:ChildProcessWithoutNullStreams;done:Promise<void>;changed:Set<()=>void>;inputs:Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>}
const terminals=new Map<string,Terminal>()
let emit:(channel:string,payload:any)=>void=()=>{}
export function setTerminalEmitter(next:typeof emit){emit=next}
const metadata=(t:Terminal)=>({id:t.id,employee:t.employee,worker:t.worker,purpose:t.purpose,cwd:t.cwd,host:t.host,running:t.running,exitCode:t.exitCode})
export const listTerminals=(employee?:string)=>[...terminals.values()].filter(t=>!employee||t.employee===employee).map(metadata)
function get(id:string){const terminal=terminals.get(id);if(!terminal)throw new Error('Unknown terminal');return terminal}
function size(cols:number,rows:number){if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>500||rows<2||rows>300)throw new Error('无效终端尺寸');return {cols,rows}}
export function openTerminal(employee:Pick<StoredSession,'id'|'cwd'|'remote'>,cols=100,rows=24,launch?:TerminalProgram,ownership?:{worker:string;purpose:'shell'}){
  size(cols,rows)
  const id=randomUUID(),directory=path.join(APP_HOME,'terminals'),file=path.join(directory,id+'.json')
  const config={cwd:employee.remote?APP_HOME:employee.cwd,remote:employee.remote?tunnelConfig(employee.remote):undefined,cols,rows,...(launch?{program:launch.program,root:launch.root}: {})}
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(config),{mode:0o600})
  const child=process.platform==='win32'?windowsTerminal(employee.remote?APP_HOME:employee.cwd,employee.remote??undefined,cols,rows,launch?.program,launch?.runtime==='node',!!ownership):spawn(python(),['-B',path.join(tunnelDirectory(),'terminal.py'),file],{env:launch?{...nativeWorkerEnv(),...(launch.runtime==='node'?{ELECTRON_RUN_AS_NODE:'1'}:{})}:ownership?nativeWorkerEnv():childEnv(),stdio:['pipe','pipe','pipe']})
  const terminal:Terminal={id,employee:employee.id,worker:launch?.worker??ownership?.worker,purpose:launch?'agent':ownership?.purpose,cwd:employee.remote?.directory??employee.cwd,host:employee.remote?.host,running:true,output:new TerminalOutput(),process:child,done:new Promise(resolve=>child.once('close',()=>resolve())),changed:new Set(),inputs:new Map()}
  terminals.set(id,terminal);const decoder=new StringDecoder('utf8')
  const append=(data:string)=>{terminal.output.append(data);if(data)for(const notify of terminal.changed)notify();emit('terminal:data',{id})}
  createInterface({input:child.stdout}).on('line',line=>{try{const event=JSON.parse(line);if(event.data)append(decoder.write(Buffer.from(event.data,'base64')));if(event.inputId){const pending=terminal.inputs.get(event.inputId);if(pending){clearTimeout(pending.timer);terminal.inputs.delete(event.inputId);event.error?pending.reject(Error(event.error)):pending.resolve()}}if(event.exitCode!==undefined)terminal.exitCode=event.exitCode}catch{}})
  child.stderr.on('data',data=>append(data.toString()));child.stdin.on('error',()=>{})
  child.on('error',error=>append('\r\n'+error.message+'\r\n'))
  child.on('close',code=>{append(decoder.end());terminal.running=false;terminal.exitCode??=code??1;for(const input of terminal.inputs.values()){clearTimeout(input.timer);input.reject(Object.assign(Error('Native terminal closed before input completed.'),{code:'NATIVE_TERMINAL_CLOSED'}))}terminal.inputs.clear();for(const notify of terminal.changed)notify();fs.rmSync(file,{force:true});emit('terminal:changed',metadata(terminal))})
  return metadata(terminal)
}
function terminalOutput(t:Terminal,cursor:number){return {...metadata(t),...t.output.read(cursor)}}
export const terminalOwner=(id:string)=>get(id).employee
export function readTerminal(id:string,cursor=0){return terminalOutput(get(id),cursor)}
/** Optional bounded wait: idle readers sleep, output wakes them without a polling delay. */
export async function waitTerminalOutput(id:string,cursor=0,waitMs=0,signal?:AbortSignal){
  signal?.throwIfAborted()
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(waitMs)||waitMs<0||waitMs>15000)throw Error('cursor 必须为非负整数，waitMs 必须为 0–15000 毫秒')
  const t=get(id)
  if(t.running&&cursor===t.output.cursor&&waitMs)await new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);t.changed.delete(ready);signal?.removeEventListener('abort',aborted)}
    const ready=()=>{cleanup();resolve()},aborted=()=>{cleanup();reject(signal!.reason)}
    const timer=setTimeout(ready,waitMs);t.changed.add(ready);signal?.addEventListener('abort',aborted,{once:true})
  })
  return terminalOutput(t,cursor)
}
export function inputTerminal(id:string,data:string){const t=get(id);if(!t.running)throw Object.assign(new Error('终端已经退出，请新建终端'),{code:'NATIVE_TERMINAL_CLOSED'});return new Promise<boolean>((resolve,reject)=>{const inputId=randomUUID(),fail=(error:Error)=>{const pending=t.inputs.get(inputId);if(pending){clearTimeout(pending.timer);t.inputs.delete(inputId);pending.reject(error)}},timer=setTimeout(()=>fail(Error('Native terminal input could not be confirmed. Check the terminal before sending again.')),20000);t.inputs.set(inputId,{resolve:()=>resolve(true),reject,timer});t.process.stdin.write(JSON.stringify({op:'input',inputId,data})+'\n',error=>{if(error)fail(error)})})}
export function resizeTerminal(id:string,cols:number,rows:number){const t=get(id);size(cols,rows);if(t.running)t.process.stdin.write(JSON.stringify({op:'resize',cols,rows})+'\n');return true}
export async function stopTerminal(id:string){const t=get(id);if(t.running){t.process.kill('SIGTERM');const timer=setTimeout(()=>t.process.kill('SIGKILL'),2000);await t.done;clearTimeout(timer)}return metadata(t)}
export async function closeTerminal(id:string){const t=get(id);await stopTerminal(id);terminals.delete(id);emit('terminal:changed',{id,employee:t.employee,closed:true});return true}
export async function closeEmployeeTerminals(employee:string){for(const t of listTerminals(employee))await closeTerminal(t.id)}
export async function closeTerminals(){await Promise.all([...terminals.keys()].map(closeTerminal))}
