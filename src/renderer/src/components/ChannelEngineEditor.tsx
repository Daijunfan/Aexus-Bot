import {useEffect,useRef,useState} from 'react'
import {CHANNEL_IMAGE_LIMIT,type ChannelAvatarInput,type ChannelCollector,type ChannelCreateResult,type ChannelEngineInput,type ChannelView} from '../../../shared/channels'
import {api} from '../api'
import {translate as uiText,useI18n} from '../i18n'
import {AppSelect} from './AppSelect'
import {ChannelAvatar} from './ChannelNewsCard'
import {ChannelConnectionPanel} from './ChannelConnectionPanel'
import {Icon} from './Icon'
import '../styles/channel-engines.css'

export type ChannelEditorRun=(work:()=>Promise<void>)=>Promise<void>
/** The same form sends the same Core contract from desktop and browser. */
export function ChannelEngineEditor({channel,busy,run,onSaved,onDirty,section='all'}:{channel?:ChannelView;section?:'all'|'profile'|'deployment'|'connection';onDirty?:(value:boolean)=>void;busy:boolean;run:ChannelEditorRun;onSaved:(channel:ChannelView)=>void}){
 useI18n()
 const [current,setCurrent]=useState(channel),[name,setName]=useState(channel?.name??''),[editing,setEditing]=useState(!channel||section==='deployment')
 const external=channel?.engine?.kind==='external'?channel.engine:undefined
 const [location,setLocation]=useState<''|'local'|'remote'>(external?.location==='unconfigured'?'':external?.location??''),[processName,setProcessName]=useState(external?.name??''),[host,setHost]=useState(external?.host??''),[endpoint,setEndpoint]=useState(external?.endpoint??''),[collectorId,setCollectorId]=useState(external?.collectorId??'')
 const [collectors,setCollectors]=useState<ChannelCollector[]>([]),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0)
 const [avatar,setAvatar]=useState<ChannelAvatarInput|null|undefined>(undefined),[imagePending,setImagePending]=useState(false),[imageError,setImageError]=useState(''),[token,setToken]=useState(''),imageVersion=useRef(0),alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;imageVersion.current++}},[])
 useEffect(()=>{let active=true;setLoading(true);setLoadError('');void api.call<ChannelCollector[]>('channel.collectors').then(value=>{if(active)setCollectors(value.filter(collector=>!collector.revokedAt))}).catch(cause=>{if(active)setLoadError(cause.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[reload])
 const chooseImage=async(file?:File)=>{
  if(!file)return;const version=++imageVersion.current;setImageError('');setImagePending(true)
  try{
   if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||!file.size||file.size>CHANNEL_IMAGE_LIMIT)throw Error('Upload a PNG, JPEG, GIF or WebP image up to 8 MiB')
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the selected image'));reader.readAsDataURL(file)})
   if(alive.current&&version===imageVersion.current)setAvatar({name:file.name,mimeType:file.type,data})
  }catch(cause){if(alive.current&&version===imageVersion.current)setImageError((cause as Error).message)}finally{if(alive.current&&version===imageVersion.current)setImagePending(false)}
 }
 const save=()=>run(async()=>{
  let engine:ChannelEngineInput|undefined
  if(editing){if(!location)throw Error('Choose a process location');engine={kind:'external',location,name:processName.trim(),...(location==='remote'?{host:host.trim()}:{}),...(endpoint.trim()?{endpoint:endpoint.trim()}:{}),...(collectorId?{collectorId}:{}),...(location==='remote'&&external?.fileStorage?{fileStorage:external.fileStorage}:{})}}
  const result=await api.call<ChannelCreateResult>(current?'channel.update':'channel.create',{...(current?{id:current.id,expectedRevision:current.revision}:{}),name:name.trim(),...(engine?{engine}:{}),...(avatar!==undefined?{avatar}:{})})
  const {setup,...next}=result;if(!alive.current)return;setCurrent(next);setName(next.name);setEditing(false);setAvatar(undefined);setImageError('');setCollectorId(next.engine?.kind==='external'?next.engine.collectorId??'':'');if(setup)setToken(setup.token);else if((current?.engine?.kind==='external'?current.engine.collectorId:undefined)!==(next.engine?.kind==='external'?next.engine.collectorId:undefined))setToken('');onSaved(next)
 })
 const loadLatest=()=>run(async()=>{const next=(await api.call<ChannelView[]>('channel.list')).find(value=>value.id===current?.id);if(!next)throw Error('Unknown news channel');if(!alive.current)return;const external=next.engine?.kind==='external'?next.engine:undefined;setCurrent(next);setName(next.name);setLocation(external?.location==='unconfigured'?'':external?.location??'');setProcessName(external?.name??'');setHost(external?.host??'');setEndpoint(external?.endpoint??'');setCollectorId(external?.collectorId??'');setEditing(false);setAvatar(undefined);setImageError('');imageVersion.current++;setImagePending(false);setToken('');onSaved(next)})
 const baselineEngine=current?.engine?.kind==='external'?current.engine:undefined
 const dirty=name.trim()!==(current?.name??'')||avatar!==undefined||imagePending||editing&&(location!==(baselineEngine?.location==='unconfigured'?'':baselineEngine?.location??'')||processName!==(baselineEngine?.name??'')||host!==(baselineEngine?.host??'')||endpoint!==(baselineEngine?.endpoint??'')||collectorId!==(baselineEngine?.collectorId??''))
 useEffect(()=>onDirty?.(dirty),[dirty,onDirty])
 const validEngine=!editing||!!location&&!!processName.trim()&&(location==='local'||!!host.trim()&&!!endpoint.trim())
 return <section className="channel-engine-editor" aria-label={uiText(current?'Channel settings':'New channel')}>
  {section!=='connection'&&!(section==='all'&&current)&&<form className="channel-profile-form" onSubmit={event=>{event.preventDefault();void save()}}>
   {section!=='deployment'&&<div className="channel-profile-identity"><div className="channel-profile-picture">{avatar?<img src={`data:${avatar.mimeType};base64,${avatar.data}`} alt={uiText('Channel avatar preview')}/>:<ChannelAvatar kind={current?.kind??'custom'} avatar={avatar===null?undefined:current?.avatar} name={name}/>}</div><div><label>{uiText('Channel name')}<input aria-label={uiText('Channel name')} required value={name} maxLength={80} disabled={busy} placeholder={uiText('e.g. Design journal')} onChange={event=>setName(event.target.value)}/></label><div className="channel-image-actions"><label className="channel-upload-button"><Icon name="cloud-upload"/>{uiText('Upload channel image')}<input aria-label={uiText('Upload channel image')} type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={event=>{void chooseImage(event.target.files?.[0]);event.target.value=''}}/></label>{(avatar||current?.avatar?.channelId)&&<button type="button" disabled={busy} onClick={()=>{imageVersion.current++;setImagePending(false);setImageError('');setAvatar(current?null:undefined)}}>{uiText('Use default image')}</button>}</div></div></div>}
   {imageError&&<p className="channel-inline-error" role="alert">{uiText(imageError)}</p>}
   {section!=='profile'&&current&&!editing&&<div className="channel-engine-summary"><Icon name="server"/><span><strong>{uiText('External process engine')}</strong><small>{current.engine?.kind==='external'&&current.engine.location!=='unconfigured'?current.engine.name:uiText('Existing connection · origin not configured')}</small></span><button type="button" disabled={busy} onClick={()=>setEditing(true)}>{uiText('Configure engine')}</button></div>}
   {section!=='profile'&&editing&&<>
    <div className="channel-external-fields"><label>{uiText('Process location')}<AppSelect aria-label={uiText('Process location')} value={location} disabled={busy} onChange={event=>setLocation(event.target.value as typeof location)}><option value="">{uiText('Choose a process location')}</option><option value="local">{uiText('On this Core host')}</option><option value="remote">{uiText('Cloud or another computer')}</option></AppSelect></label><label>{uiText('Process name')}<input aria-label={uiText('Process name')} required maxLength={160} disabled={busy} value={processName} onChange={event=>setProcessName(event.target.value)} placeholder={uiText('e.g. News collector')}/></label>{location==='remote'&&<label>{uiText('Process IP or hostname')}<input aria-label={uiText('Process IP or hostname')} required disabled={busy} value={host} onChange={event=>setHost(event.target.value)} placeholder="203.0.113.10"/></label>}<label className="channel-engine-wide">{uiText('Core receiver URL')}<input aria-label={uiText('Core receiver URL')} type="url" required={location==='remote'} disabled={busy} value={endpoint} onChange={event=>setEndpoint(event.target.value)} placeholder={location==='remote'?'https://core.example.com/api/channels/collector':uiText('Default local collector listener')}/></label><label className="channel-engine-wide">{uiText('Process credential')}<AppSelect aria-label={uiText('Process credential')} value={collectorId} disabled={busy||loading} onChange={event=>setCollectorId(event.target.value)}><option value="">{uiText(current?.engine?.kind==='external'&&current.engine.collectorId?'Keep the current credential':'Create a dedicated credential')}</option>{collectors.map(collector=><option key={collector.id} value={collector.id}>{collector.name}</option>)}</AppSelect></label><p className="channel-engine-wide">{uiText('The process pushes authenticated messages to the Core receiver. Its IP identifies deployment; the credential authorizes its sources. Remote HTTP requires a loopback tunnel; otherwise use HTTPS.')}</p></div>
    {loading&&<p role="status">{uiText('Loading…')}</p>}{loadError&&<p className="channel-inline-error" role="alert">{uiText(loadError)} <button type="button" onClick={()=>setReload(value=>value+1)}>{uiText('Retry')}</button></p>}
   </>}
   <div className="channel-profile-actions">{current&&<button type="button" disabled={busy} title={uiText('Reload channel settings')} aria-label={uiText('Reload channel settings')} onClick={()=>void loadLatest()}><Icon name="refresh"/></button>}<small>{uiText('Channels are read-only feeds. Employees access news through the channel API.')}</small><button className="primary" type="submit" disabled={busy||imagePending||!name.trim()||!validEngine||editing&&(loading||!!loadError)}>{uiText(busy?'Saving…':current?'Save channel':'Create channel')}</button></div>
  </form>}
  {section==='all'&&current&&<h3>{uiText('Channel created')}</h3>}
  {current&&(section==='all'||section==='connection')&&<ChannelConnectionPanel key={current.id} channel={current} token={token} busy={busy} run={run} onCredential={setToken} onChanged={next=>{setCurrent(next);setCollectorId(next.engine?.kind==='external'?next.engine.collectorId??'':'');onSaved(next)}}/>}
 </section>
}
