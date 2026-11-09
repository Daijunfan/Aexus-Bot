import {useEffect,useRef,useState} from 'react'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import type {NativeWorker} from '../../../shared/native-worker'
import type {StoredSession,Store} from '../../../shared/types'
import {ENGINE_DEFINITIONS} from '../../../shared/engines'
import {api} from '../api'
import {EngineMark} from './EngineMark'
import {Icon} from './Icon'
import {NativeWorkerDialog} from './NativeWorkerDialog'
import {translate as uiText,useI18n} from '../i18n'
import {onPluginFlush} from '../plugins'
import '@xterm/xterm/css/xterm.css'
import '../styles/native-workers.css'

export function EmployeeWorkers({employee,store}:{employee:StoredSession;store:Store}){
 useI18n()
 const [workers,setWorkers]=useState<NativeWorker[]>([]),[selected,setSelected]=useState(''),[creating,setCreating]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState(''),busy=useRef(false)
 const refresh=()=>api.call<NativeWorker[]>('worker.list',{employee:employee.id}).then(setWorkers)
 useEffect(()=>{let active=true,running=false;const load=async()=>{if(running)return;running=true;try{const value=await api.call<NativeWorker[]>('worker.list',{employee:employee.id});if(active)setWorkers(value)}catch(cause){if(active)setError((cause as Error).message)}finally{running=false}};void load();const off=api.onEvent(event=>{if(event.channel==='workers:changed'||event.channel==='terminal:changed')void load()}),timer=setInterval(()=>void load(),2000);return()=>{active=false;clearInterval(timer);off()}},[employee.id])
 const run=async(action:()=>Promise<unknown>)=>{if(busy.current)return;busy.current=true;setPending(true);setError('');try{await action();await refresh().catch(cause=>setError(uiText('Change applied, but the display could not refresh: {0}',[(cause as Error).message])))}catch(cause){setError((cause as Error).message)}finally{busy.current=false;setPending(false)}}
 const active=workers.find(worker=>worker.id===selected)
 return <section className="profile-section native-workers" data-native-workers>
  <header><h2>Workers</h2><button type="button" disabled={pending} onClick={()=>setCreating(true)}><Icon name="add"/>{uiText('Add Worker')}</button></header>
  <p className="profile-footnote">{uiText('Native Coding Agents managed by {0}. Their configuration, files and history stay with the native engine.',[employee.title])}</p>
  {creating&&<NativeWorkerDialog store={store} employee={employee} onClose={()=>setCreating(false)} onCreated={worker=>{setSelected(worker.id);setCreating(false);void refresh().catch(cause=>setError((cause as Error).message))}}/>}
  {error&&<p className="profile-error" role="alert">{uiText(error)}</p>}
  {!workers.length&&!creating&&<div className="native-workers-empty"><Icon name="terminal"/><strong>{uiText('No Workers yet')}</strong><p>{uiText('Add a native Coding Agent in this employee’s workspace.')}</p></div>}
  <div className="native-worker-list">{workers.map(worker=><article key={worker.id} data-native-worker={worker.id} className={selected===worker.id?'selected':''}>
   <EngineMark engine={worker.engine} size={27}/><div><strong>{worker.title}</strong><small>{ENGINE_DEFINITIONS[worker.engine].label} · {uiText(worker.running?'Running':worker.exitCode===undefined?'Ready to start':'Stopped')} · {worker.host??uiText('Local')}</small><code title={worker.cwd}>{worker.cwd}</code></div>
   <div className="native-worker-actions"><button type="button" disabled={pending} onClick={()=>void run(async()=>{await api.call('worker.start',{id:worker.id});setSelected(worker.id)})}><Icon name={worker.running?'terminal':'play'}/>{uiText(worker.running?'Open':'Start Worker')}</button>
   {worker.running&&<><button type="button" disabled={pending} onClick={()=>void run(()=>api.call('worker.interrupt',{id:worker.id}))}>{uiText('Interrupt')}</button><button type="button" disabled={pending} onClick={()=>void run(()=>api.call('worker.stop',{id:worker.id}))}>{uiText('Stop')}</button></>}
   <button type="button" className="native-worker-remove" disabled={pending} aria-expanded={removing===worker.id} onClick={()=>setRemoving(removing===worker.id?'':worker.id)}><Icon name="trash"/>{uiText('Remove')}</button></div>
   {removing===worker.id&&<div className="board-inline-confirm"><span>{uiText('Remove this Worker? Work files and native history are retained.')}</span><button type="button" className="board-danger" disabled={pending} onClick={()=>void run(async()=>{await api.call('worker.remove',{id:worker.id});setRemoving('');if(selected===worker.id)setSelected('')})}>{uiText('Remove Worker')}</button><button type="button" disabled={pending} onClick={()=>setRemoving('')}>{uiText('Cancel')}</button></div>}
  </article>)}</div>
  {active?.terminal&&<><div className="native-worker-active-title"><Icon name="terminal"/><strong>{active.title}</strong><span>{uiText(active.running?'Running':'Stopped')}</span></div><NativeWorkerTerminal key={active.terminal} worker={active} onError={setError}/></>}
  <p className="profile-footnote">{uiText('Running describes the native process. Tasks and approvals appear in its terminal. Removing a Worker retains its files, native history and sign-in.')}</p>
 </section>
}

export type NativeWorkerSubmit=(text:string)=>Promise<void>
export function NativeWorkerTerminal({worker,active=true,onError,onStatusChange,onSubmitReady}:{worker:NativeWorker;active?:boolean;onError:(message:string)=>void;onStatusChange?:()=>void;onSubmitReady?:(submit:NativeWorkerSubmit|null)=>void}){
 useI18n()
 const container=useRef<HTMLDivElement>(null),callbacks=useRef({onError,onStatusChange,onSubmitReady}),recover=useRef<(()=>Promise<void>)|undefined>(undefined),[inputError,setInputError]=useState(''),[readError,setReadError]=useState('');callbacks.current={onError,onStatusChange,onSubmitReady}
 const activity=useRef(active),resume=useRef<(()=>void)|undefined>(undefined);activity.current=active
 useEffect(()=>{
  if(!container.current)return
  let disposed=false,cursor=0,pending=false,again=false,writing:Promise<unknown>=Promise.resolve(),inputFailed=false,capturing=false,pasted='',queuedInput=''
  setInputError('');setReadError('')
  const term=new Terminal({cursorBlink:worker.running,disableStdin:!worker.running,fontFamily:'Menlo, Monaco, monospace',fontSize:14,scrollback:3000,theme:{background:'#10141d',foreground:'#e1e7f0',cursor:'#a9c1ff'}}),fit=new FitAddon()
  term.loadAddon(fit);term.open(container.current)
  const read=async()=>{if(pending){again=true;return}pending=true;try{const value=await api.call<{output:string;cursor:number;reset:boolean;running:boolean}>('worker.read',{id:worker.id,cursor});if(!disposed){if(value.reset)term.reset();if(value.output)term.write(value.output);cursor=value.cursor;setReadError('');if(value.running!==worker.running)callbacks.current.onStatusChange?.()}return value}catch(cause){if(!disposed){setReadError((cause as Error).message)}}finally{pending=false;if(again&&!disposed){again=false;void read()}}}
  const write=(data:string)=>{queuedInput+=data;const work=writing.then(()=>{if(disposed)throw Error('Native terminal closed before input was sent.');if(!queuedInput)return;const batch=queuedInput;queuedInput='';return api.call('worker.input',{id:worker.id,terminal:worker.terminal,data:batch})});writing=work;void work.catch(cause=>{if(!disposed&&!inputFailed){inputFailed=true;term.options.disableStdin=true;setInputError((cause as Error).message);callbacks.current.onSubmitReady?.(null)}});return work}
  const submit:NativeWorkerSubmit=async text=>{
   if(!worker.running||inputFailed)throw Object.assign(Error('Reconnect the native terminal before sending.'),{code:'NATIVE_INPUT_NOT_SENT'})
   if(/[\r\n]/.test(text)&&!term.modes.bracketedPasteMode)throw Object.assign(Error('This native terminal does not support multiline tasks. Use one line or the engine’s native editor.'),{code:'NATIVE_INPUT_NOT_SENT'})
   capturing=true;pasted='';try{term.paste(text)}finally{capturing=false}
   await write(pasted+'\r')
  }
  const input=term.onData(data=>{if(capturing)pasted+=data;else void write(data).catch(()=>{})})
  callbacks.current.onSubmitReady?.(worker.running?submit:null)
  recover.current=async()=>{await writing.catch(()=>{});const value=await read();if(!value||disposed)return;writing=Promise.resolve();queuedInput='';inputFailed=false;setInputError('');setReadError('');callbacks.current.onError('');term.options.disableStdin=!value.running;callbacks.current.onSubmitReady?.(value.running?submit:null);term.focus()}
  const dimensions=term.onResize(({cols,rows})=>void api.call('worker.resize',{id:worker.id,cols:Math.max(2,cols),rows:Math.max(2,rows)}).catch(cause=>!disposed&&callbacks.current.onError((cause as Error).message)))
  const off=api.onEvent(event=>{if(activity.current&&(event.channel==='client:connected'||event.channel.startsWith('terminal:')&&event.payload.id===worker.terminal&&!event.payload.closed))void read()})
  const fitViewport=()=>{if(!disposed&&container.current?.clientWidth&&container.current.clientHeight)fit.fit()}
  const observer=new ResizeObserver(fitViewport);observer.observe(container.current);resume.current=()=>{fitViewport();void read()};if(activity.current)resume.current();const timer=worker.running?setInterval(()=>{if(activity.current)void read()},1500):undefined
  const flush=onPluginFlush(async()=>{if(inputFailed)return;await writing})
  return()=>{disposed=true;callbacks.current.onSubmitReady?.(null);recover.current=undefined;resume.current=undefined;flush();clearInterval(timer);off();observer.disconnect();input.dispose();dimensions.dispose();term.dispose()}
 },[worker.id,worker.terminal,worker.running])
 useEffect(()=>{if(active)resume.current?.()},[active])
 return <div className="native-worker-console"><div className="native-worker-terminal" aria-label={uiText('Native Worker terminal')} ref={container}/>{(inputError||readError)&&<div className="native-terminal-error" role="alert"><span>{inputError?uiText('Input could not be confirmed. Check the terminal before reconnecting.'):uiText('Terminal output is unavailable.')}<small>{uiText(inputError||readError)}</small></span><button type="button" onClick={()=>void recover.current?.()}>{uiText('Reconnect terminal')}</button></div>}</div>
}
