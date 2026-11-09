import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {useEffect,useRef,useState,type CSSProperties} from 'react'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import {PanelDivider} from './PanelDivider'
import {Icon} from './Icon'
import {api} from '../api'
import {onPluginFlush} from '../plugins'
import '@xterm/xterm/css/xterm.css'
type Tab={id:string;employee:string;cwd:string;host?:string;running:boolean;exitCode?:number}
export function EmployeeTerminal({employee,terminalHeight=220,active:visible=true,autoOpen=true}:{employee:string;terminalHeight?:number;active?:boolean;autoOpen?:boolean}){
  useI18n()

  const [heightDraft,setHeightDraft]=useState<number>()
  useEffect(()=>setHeightDraft(undefined),[terminalHeight])
  const [tabs,setTabs]=useState<Tab[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[inputError,setInputError]=useState(''),[readError,setReadError]=useState(''),[creating,setCreating]=useState(false),[collapsed,setCollapsed]=useState(false)
  const recover=useRef<(()=>Promise<void>)|undefined>(undefined),creatingRef=useRef(false),flushInput=useRef<()=>Promise<unknown>>(async()=>{})
  const shown=visible&&!collapsed
  const activity=useRef(shown),resume=useRef<(()=>void)|undefined>(undefined);activity.current=shown
  useEffect(()=>{if(shown)resume.current?.()},[shown])
  const container=useRef<HTMLDivElement>(null),opening=useRef<Promise<Tab>|null>(null)
  const refresh=()=>api.call<Tab[]>('terminal.list',{employee}).then(setTabs)
  const create=async()=>{if(creatingRef.current)return;creatingRef.current=true;setCreating(true);try{await flushInput.current();setError('');const tab=await api.call<Tab>('terminal.open',{employee});setTabs(previous=>[...previous,tab]);setSelected(tab.id);setCollapsed(false);await refresh()}catch(e){setError((e as Error).message)}finally{creatingRef.current=false;setCreating(false)}}
  useEffect(()=>{let active=true;void (async()=>{try{let list=await api.call<Tab[]>('terminal.list',{employee});if(!list.length&&autoOpen){opening.current??=api.call<Tab>('terminal.open',{employee});list=[await opening.current]}if(active){setTabs(list);setSelected(list[0]?.id??'')}}catch(e){if(active)setError((e as Error).message)}})();return()=>{active=false}},[employee])
  useEffect(()=>{
    setInputError('');setReadError('')
    if(!selected||!container.current)return
    let disposed=false,cursor=0,pending=false,again=false,inputFailed=false,queuedInput='',writing:Promise<unknown>=Promise.resolve()
    const term=new Terminal({cursorBlink:true,cursorStyle:'bar',cursorWidth:3,cursorInactiveStyle:'bar',fontFamily:'Menlo, Monaco, monospace',fontSize:14,scrollback:3000,theme:{background:'#10141d',foreground:'#e1e7f0',cursor:'#a9c1ff'}}),fit=new FitAddon()
    term.loadAddon(fit);term.open(container.current)
    const read=async()=>{if(pending){again=true;return}pending=true;try{const value=await api.call<Tab&{output:string;cursor:number;reset:boolean}>('terminal.read',{id:selected,cursor});if(!disposed){if(value.reset)term.reset();if(value.output)term.write(value.output);cursor=value.cursor;term.options.disableStdin=inputFailed||!value.running;setReadError('');setTabs(previous=>previous.map(t=>t.id===selected?{...t,running:value.running,exitCode:value.exitCode}:t))}return value}catch(e){if(!disposed)setReadError((e as Error).message)}finally{pending=false;if(again&&!disposed){again=false;void read()}}}
    const off=api.onEvent(event=>{if(!activity.current)return;if(event.channel==='client:connected')void read();if(event.channel.startsWith('terminal:')&&event.payload.id===selected){if(event.payload.closed)void api.call<Tab[]>('terminal.list',{employee}).then(next=>{if(!disposed){setTabs(next);setSelected(next[0]?.id??'')}}).catch(e=>!disposed&&setError(e.message));else void read()}})
    const input=term.onData(data=>{queuedInput+=data;writing=writing.then(()=>{if(disposed)throw Error('Native terminal closed before input was sent.');if(!queuedInput)return;const batch=queuedInput;queuedInput='';return api.call('terminal.input',{id:selected,data:batch})});void writing.catch(e=>{if(!disposed&&!inputFailed){inputFailed=true;term.options.disableStdin=true;setInputError(e.message)}})})
    recover.current=async()=>{await writing.catch(()=>{});const value=await read();if(!value||disposed)return;writing=Promise.resolve();queuedInput='';inputFailed=false;setInputError('');term.options.disableStdin=!value.running;term.focus()}
    const dimensions=term.onResize(({cols,rows})=>{if(activity.current)void api.call('terminal.resize',{id:selected,cols,rows}).catch(e=>!disposed&&setError(e.message))})
    const fitViewport=()=>{if(!disposed&&activity.current&&container.current?.clientWidth&&container.current.clientHeight)fit.fit()};const observer=new ResizeObserver(fitViewport);observer.observe(container.current);resume.current=()=>{fitViewport();void read()};if(activity.current)resume.current()
    const timer=setInterval(()=>{if(activity.current)void read()},1500)
    flushInput.current=async()=>{if(!inputFailed)await writing}
    const flush=onPluginFlush(()=>flushInput.current().then(()=>{}))
    return()=>{disposed=true;resume.current=undefined;recover.current=undefined;flushInput.current=async()=>{};flush();clearInterval(timer);off();observer.disconnect();input.dispose();dimensions.dispose();term.dispose()}
  },[selected])
  const wasVisible=useRef(visible)
  useEffect(()=>{const resumed=!wasVisible.current&&visible;wasVisible.current=visible;if(!resumed)return;let current=true;void api.call<Tab[]>('terminal.list',{employee}).then(list=>{if(current){setTabs(list);setSelected(previous=>list.some(tab=>tab.id===previous)?previous:list[0]?.id??'')}}).catch(cause=>{if(current)setError(cause.message)});return()=>{current=false}},[visible,employee])
  const active=tabs.find(t=>t.id===selected)
  return <section className="employee-terminal" aria-label={uiText("Employee terminal")} data-terminal-empty={!selected||undefined} data-terminal-collapsed={collapsed||undefined} style={{'--terminal-height':`${heightDraft??terminalHeight}px`} as CSSProperties}>{selected&&!collapsed&&<PanelDivider axis="y" value={heightDraft??terminalHeight} min={120} max={600} label={uiText("Resize terminal height")} onDraft={setHeightDraft} onCommit={value=>api.call('settings.set',{terminalHeight:value})}/>}<header><strong>{uiText("Terminal")}</strong><nav>{tabs.map((tab,i)=><button key={tab.id} className={tab.id===selected?'active':''} onClick={()=>void flushInput.current().then(()=>setSelected(tab.id)).catch(e=>setError(e.message))}>{tab.host?'SSH':'Shell'} {i+1}{!tab.running?' · '+uiText('Stopped'):''}</button>)}</nav><button className="terminal-action" title={uiText("New terminal")} disabled={creating} onClick={()=>void create()} aria-label={uiText("New terminal")}><Icon name="add"/></button><button className="terminal-action" title={uiText("Delete current terminal")} disabled={!selected} aria-label={uiText("Close current terminal")} onClick={async()=>{try{await flushInput.current();await api.call('terminal.close',{id:selected});const next=await api.call<Tab[]>('terminal.list',{employee});setTabs(next);setSelected(next[0]?.id??'')}catch(e){setError((e as Error).message)}}}><Icon name="trash"/></button>{selected&&<button className="terminal-action" aria-label={uiText(collapsed?'Expand terminal':'Collapse terminal')} title={uiText(collapsed?'Expand terminal':'Collapse terminal')} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}><Icon name={collapsed?'chevron-up':'chevron-down'}/></button>}</header><div className="terminal-location" title={active?.cwd}>{active?.host?`${active.host} · `:''}{active?.cwd??uiText("New terminals start in the employee’s working directory")}</div>{error&&<div className="terminal-error" role="alert">{error}<button aria-label={uiText('Dismiss error')} onClick={()=>setError('')}>×</button></div>}<div className="terminal-viewport"><div className="terminal-screen" ref={container}/></div>{(inputError||readError)&&<div className="native-terminal-error" role="alert"><span>{uiText(inputError?'Input could not be confirmed. Check the terminal before reconnecting.':'Terminal output is unavailable.')}<small>{uiText(inputError||readError)}</small></span><button type="button" onClick={()=>void recover.current?.()}>{uiText('Reconnect terminal')}</button></div>}{!selected&&<button className="terminal-empty" disabled={creating} onClick={()=>void create()}>{uiText("Open a terminal in the employee’s working directory")}</button>}</section>
}
