import {AppSelect} from './AppSelect'
import {useEffect,useRef,useState} from 'react'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import type {NativeWorker} from '../../../shared/native-worker'
import type {StoredSession,Engine} from '../../../shared/types'
import {ENGINE_DEFINITIONS,supportsNativeWorker} from '../../../shared/engines'
import {api} from '../api'
import {EngineMark} from './EngineMark'
import '@xterm/xterm/css/xterm.css'
import '../styles/native-workers.css'

export function EmployeeWorkers({employee}:{employee:StoredSession}){
 const [workers,setWorkers]=useState<NativeWorker[]>([]),[selected,setSelected]=useState(''),[engine,setEngine]=useState<Engine>(supportsNativeWorker(employee.engine)?employee.engine:'codex'),[title,setTitle]=useState(''),[cwd,setCwd]=useState(''),[creating,setCreating]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('')
 const refresh=()=>api.call<NativeWorker[]>('worker.list',{employee:employee.id}).then(setWorkers)
 useEffect(()=>{let active=true;const load=()=>api.call<NativeWorker[]>('worker.list',{employee:employee.id}).then(value=>{if(active)setWorkers(value)}).catch(cause=>{if(active)setError(cause.message)});void load();const timer=setInterval(()=>void load(),2000);return()=>{active=false;clearInterval(timer)}},[employee.id])
 const run=async(action:()=>Promise<unknown>)=>{setPending(true);setError('');try{await action();await refresh()}catch(cause){setError((cause as Error).message)}finally{setPending(false)}}
 const open=(worker:NativeWorker)=>run(async()=>{await api.call('worker.start',{id:worker.id});setSelected(worker.id)})
 const active=workers.find(worker=>worker.id===selected)
 return <section className="profile-section native-workers" data-native-workers>
  <header><h2>Worker</h2><button disabled={pending} onClick={()=>setCreating(!creating)}>创建 Worker</button></header>
  <p className="profile-footnote">直属于 {employee.title} 的原生 Coding Agent。沿用引擎自己的配置与历史，不注入员工身份、协作提示或本软件的工具。</p>
  {!supportsNativeWorker(employee.engine)&&<p className="profile-footnote">DeepSeek Harness 没有原生终端界面。此处可创建其他引擎的 Worker，请在下方选择引擎。</p>}
  {creating&&<form className="native-worker-form" onSubmit={event=>{event.preventDefault();void run(async()=>{const worker=await api.call<NativeWorker>('worker.create',{employee:employee.id,engine,...(title.trim()?{title:title.trim()}:{}),...(cwd.trim()?{cwd:cwd.trim()}: {})});setCreating(false);setTitle('');setCwd('');setSelected(worker.id)})}}>
   <label>原生引擎<AppSelect aria-label="Worker engine" value={engine} onChange={event=>setEngine(event.target.value as Engine)}>{Object.entries(ENGINE_DEFINITIONS).filter(([id])=>supportsNativeWorker(id as Engine)).map(([id,definition])=><option value={id} key={id}>{definition.label}</option>)}</AppSelect></label>
   <label>名称<input aria-label="Worker name" value={title} placeholder={`${ENGINE_DEFINITIONS[engine].label} Worker`} onChange={event=>setTitle(event.target.value)}/></label>
   <label>工作目录<input aria-label="Worker directory" value={cwd} placeholder={employee.cwd} onChange={event=>setCwd(event.target.value)}/></label>
   <small>留空使用直属员工目录，也可选择其中已有的子目录。创建后由你或直属员工启动。</small>
   <button disabled={pending} type="submit">创建</button>
  </form>}
  {error&&<p className="profile-error" role="alert">{error}</p>}
  {!workers.length&&!creating&&<p className="profile-footnote">尚无 Worker。所有员工职位均可创建和控制自己的 Worker。</p>}
  <div className="native-worker-list">{workers.map(worker=><article key={worker.id} data-native-worker={worker.id} className={selected===worker.id?'selected':''}>
   <EngineMark engine={worker.engine} size={32}/><div><strong>{worker.title}</strong><small>{worker.running?'进程运行中':worker.exitCode===undefined?'未运行':`已退出 · ${worker.exitCode}`} · {worker.host||'本机'}</small><code>{worker.cwd}</code></div>
   <button disabled={pending} onClick={()=>void open(worker)}>{worker.running?'打开':'启动'}</button>
   {worker.running&&<button disabled={pending} onClick={()=>void run(()=>api.call('worker.interrupt',{id:worker.id}))}>中断</button>}
   {worker.terminal&&<button disabled={pending} onClick={()=>void run(()=>api.call('worker.stop',{id:worker.id}))}>停止</button>}
   <button disabled={pending} onClick={()=>void run(async()=>{await api.call('worker.remove',{id:worker.id});if(selected===worker.id)setSelected('')})}>移除</button>
  </article>)}</div>
  {active?.terminal&&<NativeWorkerTerminal key={active.terminal} worker={active} onError={setError}/>}
  <p className="profile-footnote">移除 Worker 只删除控制记录，保留工作文件、原生会话与登录。运行状态表示进程状态；模型任务和审批由原生界面显示。</p>
 </section>
}

function NativeWorkerTerminal({worker,onError}:{worker:NativeWorker;onError:(message:string)=>void}){
 const container=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(!container.current)return
  let disposed=false,cursor=0,pending=false,again=false
  const term=new Terminal({cursorBlink:true,fontFamily:'Menlo, Monaco, monospace',fontSize:14,scrollback:3000,theme:{background:'#10141d',foreground:'#e1e7f0',cursor:'#a9c1ff'}}),fit=new FitAddon()
  term.loadAddon(fit);term.open(container.current)
  const read=async()=>{if(pending){again=true;return}pending=true;try{const value=await api.call<{output:string;cursor:number;reset:boolean}>('worker.read',{id:worker.id,cursor});if(!disposed){if(value.reset)term.reset();if(value.output)term.write(value.output);cursor=value.cursor}}catch(error){if(!disposed)onError((error as Error).message)}finally{pending=false;if(again&&!disposed){again=false;void read()}}}
  const input=term.onData(data=>void api.call('worker.input',{id:worker.id,data}).catch(error=>onError(error.message)))
  const dimensions=term.onResize(({cols,rows})=>void api.call('worker.resize',{id:worker.id,cols,rows}).catch(error=>!disposed&&onError(error.message)))
  const off=api.onEvent(event=>{if(event.channel.startsWith('terminal:')&&event.payload.id===worker.terminal&&!event.payload.closed)void read()})
  const observer=new ResizeObserver(()=>{if(!disposed)fit.fit()});observer.observe(container.current);fit.fit();void read();const timer=setInterval(()=>void read(),1500)
  return()=>{disposed=true;clearInterval(timer);off();observer.disconnect();input.dispose();dimensions.dispose();term.dispose()}
 },[worker.id,worker.terminal])
 return <div className="native-worker-terminal" aria-label="Native Worker terminal" ref={container}/>
}
