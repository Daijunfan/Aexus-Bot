import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {useEffect,useState} from 'react'
import {api} from '../api'
import type {EngineProviderCatalog} from '../../../shared/engine-providers'
import type {EngineHealth,EngineId} from '../../../shared/engines'
type Descriptor={engine:EngineId;label:string;target:string;configuration:{inheritNative?:boolean;path?:string;baseUrl?:string;model?:string;hasApiKey:boolean}}
export function EngineSettings(){
  useI18n()

  const [engines,setEngines]=useState<Descriptor[]>([]),[error,setError]=useState('')
  useEffect(()=>{let active=true;const load=()=>void api.call<Descriptor[]>('engine.list').then(value=>{if(active)setEngines(value)}).catch(cause=>{if(active)setError(cause.message)});load();window.addEventListener('focus',load);const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},5000);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load)}},[])
  return <section className="settings-section" aria-label={uiText("Coding agent engines")}><h3>{uiText("Coding agent engines")}</h3><p className="workspace-note">{uiText("Programs are installed and model requests run on the Core host. Detection does not send inference tasks; authentication and actual quota are determined by the provider.")}</p>{error&&<p role="alert">{error}</p>}<div className="engine-health">{engines.map(engine=><EngineCard key={engine.engine} descriptor={engine}/>)}</div></section>
}
function EngineCard({descriptor}:{descriptor:Descriptor}){
  useI18n()

  const [health,setHealth]=useState<EngineHealth>(),[checking,setChecking]=useState(false),[error,setError]=useState('')
  const [editing,setEditing]=useState(false),[executable,setExecutable]=useState(descriptor.configuration.path??'')
  const [plan,setPlan]=useState<any>(),[job,setJob]=useState<any>(),[login,setLogin]=useState<any>(),[saving,setSaving]=useState(false)
  const [testPlan,setTestPlan]=useState(false),[testing,setTesting]=useState(false),[testModel,setTestModel]=useState(''),[testResult,setTestResult]=useState<{text:string;model:string;elapsedMs:number}>()
  const probe=async()=>{setTesting(true);setTestPlan(false);setError('');setTestResult(undefined);try{setTestResult(await api.call('engine.probe',{engine:descriptor.engine,confirm:true,model:testModel||undefined}))}catch(cause){setError((cause as Error).message)}finally{setTesting(false)}}
  const check=async()=>{setChecking(true);setError('');try{setHealth(await api.call<EngineHealth>('engine.check',{engine:descriptor.engine,force:true}))}catch(cause){setError((cause as Error).message)}finally{setChecking(false)}}
  useEffect(()=>{void check()},[descriptor.engine])
  useEffect(()=>{
    if(job?.state!=='running')return
    let active=true,pending=false
    const timer=setInterval(()=>{if(pending)return;pending=true;void api.call('engine.install-status',{id:job.id}).then(value=>{if(active){setJob(value);if(value.state==='succeeded')setExecutable('');if(value.state!=='running')void check()}}).catch(cause=>{if(active)setError(cause.message)}).finally(()=>{pending=false})},1000)
    return()=>{active=false;clearInterval(timer)}
  },[job?.id,job?.state])
  useEffect(()=>{
    if(login?.state!=='running')return
    let active=true,pending=false
    const timer=setInterval(()=>{if(pending)return;pending=true;void api.call('engine.login-status',{id:login.id}).then(value=>{if(active){setLogin(value);if(value.state!=='running')void check()}}).catch(cause=>{if(active)setError(cause.message)}).finally(()=>{pending=false})},1000)
    return()=>{active=false;clearInterval(timer)}
  },[login?.id,login?.state])
  useEffect(()=>{if(!editing){setExecutable(descriptor.configuration.path??'')}},[descriptor.configuration.path,editing])
  const save=async()=>{
    setSaving(true);setError('');setTestResult(undefined)
    try{await api.call('engine.configure',{engine:descriptor.engine,patch:{path:executable,inheritNative:true}});setEditing(false);await check()}catch(cause){setError((cause as Error).message)}finally{setSaving(false)}
  }
  return <article data-engine-health={descriptor.engine}>
    <header><strong>{descriptor.label}</strong><span>{checking?uiText("Checking…"):testResult?uiText("Test call passed"):health?.ready?uiText("Configured · Call not yet verified"):health?.installed?health.protocol==='incompatible'?uiText("Incompatible version or protocol"):health.authentication==='not-signed-in'?uiText("Not authenticated"):uiText("Authentication needs checking"):uiText("Not installed")}</span></header>
    <EngineProviders engine={descriptor.engine}/><small>{uiText("Execution host:")}{descriptor.target}</small>{health?.path&&<code>{health.path}</code>}{health?.version&&<small>{health.version}</small>}
    {health&&<small>{uiText("Protocol:")}{health.protocol}  {uiText("· Authentication:")}{health.authentication}  {uiText("· Checked at")} {new Date(health.checkedAt).toLocaleString()}</small>}
    {(error||health?.error)&&<small className="warn" role="alert">{error||health?.error}</small>}
    <div className="actions"><button type="button" className="btn" disabled={checking} onClick={()=>void check()}>{uiText("Check again")}</button><button type="button" className="btn" onClick={()=>setEditing(!editing)}>{uiText("Engine settings")}</button><button type="button" className="btn" disabled={job?.state==='running'} onClick={()=>void api.call('engine.install-plan',{engine:descriptor.engine}).then(setPlan).catch(cause=>setError(cause.message))}>{uiText("Download / install")}</button>{descriptor.engine==='codex'&&<button type="button" className="btn" disabled={!health?.installed||login?.state==='running'} onClick={()=>void api.call('engine.login',{engine:'codex'}).then(setLogin).catch(cause=>setError(cause.message))}>{uiText("Official device-code sign-in")}</button>}</div>
    <div className="actions"><button type="button" className="btn" disabled={testing||!health?.installed} onClick={()=>setTestPlan(true)}>{testing?uiText("Testing…"):uiText("Test call")}</button></div>
    {testPlan&&<div><p>{uiText("This will send to")} {descriptor.target}  {uiText("one real model request asking only for OK. Charges may apply.")}</p><label>{uiText("Test model (leave empty for default)")}<input value={testModel} onChange={event=>setTestModel(event.target.value)}/></label><button type="button" className="btn" onClick={()=>void probe()}>{uiText("Confirm test call")}</button><button type="button" className="btn" onClick={()=>setTestPlan(false)}>{uiText("Cancel")}</button></div>}
    {testResult&&<p role="status">{uiText("Test passed ·")} {testResult.model} · {testResult.elapsedMs}  {uiText("ms · Reply:")}{testResult.text}</p>}
    {editing&&<div><label>{uiText("Backend executable path (leave empty to detect)")}<input aria-label={uiText("{0} executable path",[descriptor.label])} value={executable} onChange={event=>setExecutable(event.target.value)}/></label><p><button type="button" className="btn" disabled={saving} onClick={()=>void save()}>{saving?uiText("Saving…"):uiText("Save configuration")}</button></p></div>}
    {plan&&<div><p>{uiText("Install")} {plan.package}@{plan.version}  {uiText("to the backend application directory without changing the global PATH.")}</p><code>{plan.directory}</code>{!!plan.requires?.length&&<small>{uiText("Requirements:")}{plan.requires.join('；')}</small>}<p><button type="button" className="btn" disabled={job?.state==='running'} onClick={()=>{setPlan(undefined);void api.call('engine.install',{engine:descriptor.engine,confirm:true}).then(setJob).catch(cause=>setError(cause.message))}}>{uiText("Confirm download and installation")}</button><button type="button" className="btn" onClick={()=>setPlan(undefined)}>{uiText("Cancel")}</button></p></div>}
    {job&&<div><small>{uiText("Installation:")}{job.state}{job.error?' · '+job.error:''}</small><pre>{job.log}</pre>{job.state==='running'&&<button type="button" className="btn" onClick={()=>void api.call('engine.cancel-install',{id:job.id}).then(setJob).catch(cause=>setError(cause.message))}>{uiText("Cancel installation")}</button>}</div>}
    {login&&<div><small>{uiText("Codex sign-in:")}{login.state}</small><pre>{login.log||uiText("Requesting a device code…")}</pre>{login.url&&<button type="button" className="btn" onClick={()=>void api.openExternal(login.url)}>{uiText("Open the official authorization page")}</button>}{login.state==='running'&&<button type="button" className="btn" onClick={()=>void api.call('engine.cancel-login',{id:login.id}).then(setLogin)}>{uiText("Cancel sign-in")}</button>}</div>}
  </article>
}

function EngineProviders({engine}:{engine:EngineId}){
 const [catalog,setCatalog]=useState<EngineProviderCatalog>(),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 useEffect(()=>{let active=true,pending=false;const load=async()=>{if(pending)return;pending=true;try{const result=await api.call<EngineProviderCatalog>('engine.providers',{engine});if(active){setCatalog(result);setError('')}}catch(cause){if(active)setError((cause as Error).message)}finally{pending=false}};void load();window.addEventListener('focus',load);const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},5000);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load)}},[engine])
 if(error)return <p className="engine-provider-error" role="alert">{error}</p>
 if(!catalog)return <small>{uiText('Loading services…')}</small>
 const active=catalog.profiles.find(profile=>profile.active),live=catalog.profiles.filter(profile=>profile.source!=='saved'),saved=catalog.profiles.filter(profile=>profile.source==='saved')
 const rows=(profiles:typeof live)=>profiles.map(profile=><div className="engine-provider-row" data-provider-id={profile.id} data-active={profile.active||undefined} key={profile.id}><span><strong>{profile.name}</strong>{profile.active&&<b>{uiText('Current')}</b>}<code title={profile.baseUrl}>{profile.baseUrl??uiText('Native default')}</code>{profile.models.length>1?<details><summary>{uiText('{0} models',[profile.models.length])}</summary><small>{profile.models.join(' · ')}</small></details>:profile.models[0]&&<small>{profile.models[0]}</small>}</span><span className="engine-provider-credential" title={profile.credential.fingerprint}>{uiText(profile.credential.kind==='login'?'Native sign-in':profile.credential.configured?'Key configured':'Key not configured')}{profile.credential.fingerprint&&<small>{profile.credential.fingerprint}</small>}</span></div>)
 return <section className="engine-provider-catalog" aria-label={uiText('{0} services',[engine])}>
  <header><strong>{uiText(catalog.source==='native'?'Shared native configuration':'Application override')}</strong><span>{uiText('{0} services',[live.length])}</span></header>
  <p>{active?.name??uiText('Native default')}{catalog.activeModel&&<small> · {catalog.activeModel}</small>}</p>
  {rows(live)}{saved.length>0&&<details className="engine-saved-providers"><summary>{uiText('Saved profiles ({0})',[saved.length])}</summary>{rows(saved)}</details>}
  <details className="engine-provider-files"><summary>{uiText('Configuration sources')}</summary>{catalog.files.map(file=><code key={file}>{file}</code>)}<small>CLI · {uiText(catalog.clients.cli)}<br/>VS Code · {uiText(catalog.clients.vscode)}</small></details>
  {catalog.source==='app'&&<button type="button" className="btn" disabled={saving} onClick={async()=>{setSaving(true);try{await api.call('engine.configure',{engine,patch:{inheritNative:true}});setCatalog(await api.call('engine.providers',{engine}))}catch(cause){setError((cause as Error).message)}finally{setSaving(false)}}}>{uiText('Use shared native configuration')}</button>}
 </section>
}
