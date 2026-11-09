import {useEffect,useState} from 'react'
import type {StorageFolderInput} from '../../../shared/storage-folder'
import {defaultStorageFolderName} from '../../../shared/storage-folder'
import {RemoteConnectionFields} from '../office/RemoteConnectionFields'
import {api} from '../api'
import {translate as t} from '../i18n'
import {Icon} from './Icon'
import {useCatalog} from './useCatalog'
import type {CloudHost} from '../../../shared/remote'

/** A location and a folder label are separate choices, shared by group and Team creation. */
export function StorageFolderFields({value,onChange,name,location,localDefault='',disabled=false}:{value:StorageFolderInput;onChange:(next:StorageFolderInput)=>void;name:string;location?:'local'|'remote';localDefault?:string;disabled?:boolean}){
 const [cloud,setCloud]=useState(!!value.hostId),[error,setError]=useState(''),remote=location?location==='remote':cloud,folder=value.folderName??defaultStorageFolderName(name)
 const {value:hosts}=useCatalog<CloudHost>('host.list',remote,event=>event.channel==='store:changed')
 useEffect(()=>{if(!remote||!value.hostId||value.directory)return;const host=hosts.find(host=>host.id===value.hostId);if(host)onChange({...value,directory:host.defaultDirectory})},[remote,value.hostId,value.directory,hosts])
 const separator=remote&&hosts.find(host=>host.id===value.hostId)?.os==='windows'||!remote&&api.platform==='windows'?'\\':'/'
 const preview=value.mode==='bind'?value.directory:(value.directory||localDefault||t('Default application storage')).replace(/[\\/]+$/,'')+separator+folder
 return <fieldset className="storage-folder-fields" disabled={disabled}><legend><Icon name="folder-opened"/>{t('Storage folder')}</legend>
  {!location&&<div className="directory-mode-options" role="group" aria-label={t('Storage location')}><button type="button" aria-pressed={!remote} onClick={()=>{setCloud(false);onChange({mode:value.mode,folderName:value.folderName})}}><Icon name="device-desktop"/>{t('Core host')}</button><button type="button" aria-pressed={remote} onClick={()=>{setCloud(true);onChange({mode:value.mode,folderName:value.folderName,hostId:''})}}><Icon name="server"/>{t('Cloud host')}</button></div>}
  <div className="directory-mode-options" role="group" aria-label={t('Storage folder mode')}><button type="button" aria-pressed={value.mode==='create'} onClick={()=>onChange({...value,mode:'create'})}>{t('Create a new folder')}</button><button type="button" aria-pressed={value.mode==='bind'} onClick={()=>onChange({...value,mode:'bind'})}>{t('Use an existing folder')}</button></div>
  {remote?<RemoteConnectionFields directoryLabel={value.mode==='create'?'Parent folder':'Existing folder'} value={{mode:'cloud',hostId:value.hostId,directory:value.directory}} onChange={next=>onChange({...value,hostId:next.hostId,directory:next.directory})}/>:<label>{t(value.mode==='create'?'Parent folder':'Existing folder')}<div className="folder-input"><input name="storage-directory" aria-label={t(value.mode==='create'?'Parent folder':'Existing folder')} value={value.directory??''} placeholder={localDefault||t('Default application storage')} onChange={event=>onChange({...value,directory:event.target.value||undefined})}/><button type="button" onClick={()=>{setError('');void api.call<{path:string|null}>('workspace.choose',{path:value.directory||localDefault}).then(result=>{if(result.path)onChange({...value,directory:result.path})}).catch(cause=>setError(cause.message))}}>{t('Browse')}</button></div></label>}
  {value.mode==='create'&&<label>{t('Folder name')}<input name="storage-folder-name" aria-label={t('Folder name')} value={folder} required maxLength={120} onChange={event=>onChange({...value,folderName:event.target.value})}/></label>}
  <output className="storage-folder-preview" title={preview}><Icon name={remote?'server':'folder'}/><code>{preview||t('Choose a storage folder')}</code></output>{error&&<p role="alert">{error}</p>}
 </fieldset>
}
