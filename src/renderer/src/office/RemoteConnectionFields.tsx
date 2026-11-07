import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {Icon} from '../components/Icon'
import {AppSelect} from '../components/AppSelect'
import {useState} from 'react'
import {useCatalog} from '../components/useCatalog'
import type {CloudHost} from '../../../shared/remote'
import type {TeamSettings} from '../../../shared/types'
import {api} from '../api'
export function RemoteConnectionFields({value,onChange}:{value:TeamSettings;onChange:(settings:TeamSettings)=>void}){
  useI18n()

  const {value:hosts,ready,loading,error:hostsError,refresh:load}=useCatalog<CloudHost>('host.list',true,event=>event.channel==='store:changed')
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [listing,setListing]=useState<{path:string;entries:{name:string;path:string}[]}|null>(null)
  const directory=value.directory??value.remote?.directory??''
  const selected=hosts.find(h=>h.id===value.hostId)
  const choose=(id:string)=>{const host=hosts.find(h=>h.id===id);if(!host)return;setListing(null);setMessage('');onChange({mode:'cloud',hostId:id,directory:host.defaultDirectory,remote:{...host,directory:host.defaultDirectory}})}
  const browse=async(path=directory)=>{if(!value.hostId)return;setBusy(true);setMessage('');try{setListing(await api.call('host.directories',{id:value.hostId,path}))}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
  const join=(base:string,name:string)=>base.replace(/[\\/]$/,'')+(selected?.os==='windows'?'\\':'/')+name
  const parent=(path:string)=>{const value=path.replace(/[\\/]+$/,'').replace(/[\\/][^\\/]+$/,'');return selected?.os==='windows'?value.length<=2?value+'\\':value:value||'/'}
  return <div className="remote-fields cloud-host-binding" role="group" aria-label={uiText("Cloud host")}>
    <label>{uiText("Cloud host")}<AppSelect name="cloud-host-id" disabled={busy||loading} required value={value.hostId??''} onChange={e=>choose(e.target.value)}><option value="" disabled>{uiText(loading?"Loading…":"Choose a registered host")}</option>{hosts.map(host=><option key={host.id} value={host.id}>{host.name} · {host.host}</option>)}</AppSelect></label>
    <div className="host-binding-actions"><button type="button" onClick={()=>void api.call('plugin.open',{id:'cloud-hosts'})}><Icon name="settings-gear"/>{uiText("Manage hosts")}</button><button type="button" aria-label={uiText("Refresh list")} onClick={()=>void load()}><Icon name="refresh"/></button>{selected&&<span>{selected.os==='windows'?'Windows':selected.os==='macos'?'macOS':selected.distribution||'Linux'}</span>}</div>
    {ready&&!hosts.length&&<p className="workspace-note">{uiText("Add a host first")}</p>}
    <label>{uiText("Folder")}<div className="folder-input"><input name="remote-directory" disabled={busy} required value={directory} placeholder={uiText("Choose an existing folder")} onChange={e=>{setListing(null);onChange({...value,directory:e.target.value,remote:value.remote?{...value.remote,directory:e.target.value}:undefined})}}/><button type="button" disabled={!value.hostId||busy} onClick={()=>void browse()}>{busy?uiText("Loading…"):uiText("Browse")}</button></div></label>
    {listing&&<div className="remote-directory-browser"><header><button type="button" disabled={busy} onClick={()=>void browse(parent(listing.path))}>{uiText("↑ Parent folder")}</button><code>{listing.path}</code><button type="button" disabled={busy} onClick={()=>{onChange({...value,directory:listing.path,remote:value.remote?{...value.remote,directory:listing.path}:undefined});setListing(null)}}>{uiText("Bind this directory")}</button></header>{listing.entries.map(entry=><button type="button" disabled={busy} key={entry.path} onClick={()=>void browse(join(listing.path,entry.name))}>▱ {entry.name}</button>)}{!listing.entries.length&&<small>{uiText("No subfolders here. You can bind this directory directly.")}</small>}</div>}

    {(message||hostsError)&&<p className="workspace-note" role="alert">{message||hostsError}</p>}
  </div>
}
