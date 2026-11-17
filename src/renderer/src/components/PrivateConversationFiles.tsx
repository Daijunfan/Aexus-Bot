import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {DirectClearResult,DirectFileItem,DirectFilePage,DirectStorageInfo} from '../../../shared/direct-messages'
import {attachmentSize} from '../../../shared/message-attachments'
import {api} from '../api'
import {downloadFile} from '../file-actions'
import {translate as t,interfaceLocale,useI18n} from '../i18n'
import {createRefreshQueue} from '../snapshot'
import {formatMessageDateTime} from '../message-time'
import {useDialogFocus} from '../office/useDialogFocus'
import {MessageImageViewer,type GalleryImage} from '../chat/MessageImageViewer'
import {AppSelect} from './AppSelect'
import {ConversationDownload} from './ConversationDownload'
import {Icon} from './Icon'

export function ClearPrivateHistoryDialog({employeeId,employeeTitle,workspacePath,initialScope='all',onClose,onCleared}:{employeeId:string;employeeTitle:string;workspacePath?:string;initialScope?:'all'|'files';onClose:()=>void;onCleared?:(result:DirectClearResult)=>void}){
 useI18n()
 const [scope,setScope]=useState<'all'|'files'>(initialScope)
 const [storage,setStorage]=useState<DirectStorageInfo|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const busyRef=useRef(false)
 useDialogFocus('.private-clear-dialog',true)
 useEffect(()=>{
  let alive=true
  void api.call<DirectStorageInfo>('direct.storage',{employee:employeeId}).then(value=>{if(alive)setStorage(value)}).catch(()=>{})
  const key=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||busyRef.current)return
   event.preventDefault();event.stopImmediatePropagation();onClose()
  }
  window.addEventListener('keydown',key,true)
  return()=>{alive=false;window.removeEventListener('keydown',key,true)}
 },[employeeId,onClose])
 const confirm=async()=>{
  if(busyRef.current)return
  busyRef.current=true;setBusy(true);setError('')
  try{
   const result=await api.call<DirectClearResult>('direct.clear',{employee:employeeId,scope})
   onCleared?.(result)
   onClose()
  }catch(cause){
   setError((cause as Error).message)
  }finally{
   busyRef.current=false;setBusy(false)
  }
 }
 return createPortal(<div className="shared-file-dialog-backdrop">
  <section role="dialog" aria-modal="true" aria-label={t('Clear private chat history')} className="shared-file-confirm private-clear-dialog">
   <header><Icon name="trash"/><h3>{t('Clear private chat history')}</h3></header>
   <p>{workspacePath?t('Files inside {0}’s assigned workspace ({1}) and native Agent sessions are never modified or deleted.',[employeeTitle,workspacePath]):t('Files inside {0}’s assigned workspace and native Agent sessions are never modified or deleted.',[employeeTitle])}</p>
   {storage&&<div className="private-clear-stats" role="status">{t('{0} messages · {1} files · {2} on Mac',[storage.messageCount,storage.fileCount,attachmentSize(storage.totalBytes)])}</div>}
   <div className="private-clear-options" role="radiogroup" aria-label={t('Clear private chat history')}>
    <label className={scope==='files'?'is-selected':undefined}><input type="radio" name="private-clear-scope" value="files" checked={scope==='files'} disabled={busy} onChange={()=>setScope('files')}/><span><strong>{t('Clear files only')}</strong><small>{t('Mac-local private storage · Decoupled from workspace')}</small></span></label>
    <label className={scope==='all'?'is-selected':undefined}><input type="radio" name="private-clear-scope" value="all" checked={scope==='all'} disabled={busy} onChange={()=>setScope('all')}/><span><strong>{t('Clear messages and files')}</strong><small>{t('Stored locally on this Mac, independent of the employee’s workspace.')}</small></span></label>
   </div>
   {error&&<p role="alert" className="shared-file-confirm-error">{t(error)}</p>}
   <footer>
    <button type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button type="button" className="danger" disabled={busy} onClick={()=>void confirm()}>{t(busy?'Clearing…':scope==='files'?'Clear files only':'Clear messages and files')}</button>
   </footer>
  </section>
 </div>,document.body)
}

export function PrivateConversationFiles({employeeId,employeeTitle,workspacePath,query,author,onAuthor,onMessage}:{employeeId:string;employeeTitle:string;workspacePath?:string;query:string;author:string;onAuthor:(value:string)=>void;onMessage:(id:string)=>Promise<void>}){
 useI18n()
 const [data,setData]=useState<DirectFilePage>({employee:employeeId,conversation:'employee:'+employeeId,storageLocation:'mac-local',workspaceDecoupled:true,files:[],total:0,totalBytes:0,nextOffset:null})
 const [storage,setStorage]=useState<DirectStorageInfo|null>(null)
 const [sort,setSort]=useState<'newest'|'name'|'size'>('newest')
 const [count,setCount]=useState(40)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState(''),[loadError,setLoadError]=useState('')
 const [downloading,setDownloading]=useState('')
 const [clearScope,setClearScope]=useState<'all'|'files'|null>(null)
 const [notice,setNotice]=useState<DirectClearResult|null>(null)
 const [images,setImages]=useState<{items:GalleryImage[];index:number}|null>(null)
 const refresh=useRef<()=>void>(()=>{}),list=useRef<HTMLDivElement>(null)
 useEffect(()=>{setError('');list.current?.scrollTo({top:0})},[employeeId,query,author,sort])
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined
  const run=createRefreshQueue(async()=>{
   try{
    const files:DirectFileItem[]=[];let page:DirectFilePage
    const normalizedAuthor=(['all','you','employee'].includes(author)?author:'all') as 'all'|'you'|'employee'
    do{
     page=await api.call<DirectFilePage>('direct.files',{employee:employeeId,query,kind:'all',author:normalizedAuthor,sort,offset:files.length,limit:Math.min(100,Math.max(40,count-files.length))})
     if(!alive)return
     files.push(...page.files)
    }while(page.nextOffset!==null&&files.length<count)
    const stats=await api.call<DirectStorageInfo>('direct.storage',{employee:employeeId})
    if(!alive)return
    setData({...page,files});setStorage(stats);setLoadError('')
   }catch(cause){if(alive)setLoadError((cause as Error).message)}
   finally{if(alive)setLoading(false)}
  })
  refresh.current=()=>void run();setLoading(true);timer=setTimeout(()=>void run(),query?150:0)
  const off=api.onEvent(event=>{if(event.channel==='direct:changed'&&event.payload?.employee===employeeId)void run()})
  return()=>{alive=false;clearTimeout(timer);off();refresh.current=()=>{}}
 },[employeeId,query,author,sort,count])
 const open=async(file:DirectFileItem)=>{
  if(!file.available)return
  if(file.kind==='image'){
   const imageFiles=data.files.filter(item=>item.kind==='image'&&item.available)
   setImages({items:imageFiles.map(item=>({employee:employeeId,path:item.path,messageId:item.messageId,caption:item.name})),index:Math.max(0,imageFiles.findIndex(item=>item.id===file.id))})
   return
  }
  await download(file)
 }
 const download=async(file:DirectFileItem)=>{
  if(!file.available||downloading)return
  setDownloading(file.id);setError('')
  try{await downloadFile({employee:employeeId,path:file.path})}
  catch(cause){setError((cause as Error).message)}
  finally{setDownloading('')}
 }
 const date=(at:number)=>new Date(at).toLocaleDateString(interfaceLocale(),{month:'short',day:'numeric'})
 return <section className="shared-file-library private-files-library" aria-label={t('Private file manager')} aria-busy={loading}>
  <div className="private-storage-banner">
   <div>
    <strong>{t('Mac-local private storage · Decoupled from workspace')}</strong>
    <small role="status">{storage?t('{0} messages · {1} files · {2} on Mac',[storage.messageCount,storage.fileCount,attachmentSize(storage.totalBytes)]):t('Loading…')}</small>
   </div>
   <div className="private-storage-actions">
    <button type="button" disabled={loading||!storage||(storage.fileCount===0&&storage.uploadStagingBytes===0)} onClick={()=>setClearScope('files')}><Icon name="trash"/>{t('Clear private files…')}</button>
    <button type="button" className="danger" disabled={loading||!storage||(storage.messageCount===0&&storage.totalBytes===0&&storage.fileCount===0)} onClick={()=>setClearScope('all')}><Icon name="trash"/>{t('Clear private history…')}</button>
   </div>
  </div>
  <div className="shared-files-summary">
   <span role="status">{loading?t('Loading…'):t(data.total===1?'{0} file':'{0} files',[data.total])}{!loading&&data.total>0&&<small> · {attachmentSize(data.totalBytes)}</small>}</span>
   <AppSelect aria-label={t('Sort shared files')} value={sort} onChange={event=>{setSort(event.target.value as 'newest'|'name'|'size');setCount(40)}}><option value="newest">{t('Recently shared')}</option><option value="name">{t('File name')}</option><option value="size">{t('Largest first')}</option></AppSelect>
   <AppSelect aria-label={t('Filter file sender')} value={['all','you','employee'].includes(author)?author:'all'} onChange={event=>{onAuthor(event.target.value);setCount(40)}}><option value="all">{t('Everyone')}</option><option value="you">{t('From you')}</option><option value="employee">{t('From teammates')}</option></AppSelect>
  </div>
  {notice&&<div className="shared-files-feedback" role="status"><Icon name="check"/><span>{notice.scope==='files'?t('Cleared {0} files · Freed {1}',[notice.removedFiles,attachmentSize(notice.freedBytes)]):t('Cleared {0} messages and {1} files · Freed {2}',[notice.removedMessages,notice.removedFiles,attachmentSize(notice.freedBytes)])}</span><button type="button" aria-label={t('Dismiss file notification')} onClick={()=>setNotice(null)}><Icon name="close"/></button></div>}
  {(error||loadError)&&<div className="shared-files-error" role="alert"><Icon name="warning"/><span>{t(error||loadError)}</span><button type="button" onClick={()=>refresh.current()}>{t('Refresh')}</button></div>}
  <div ref={list} inert={loading} className="shared-files-list" role="list" aria-label={t('Private files')}>
   {data.files.map(file=><article key={file.id} className="shared-file-row" role="listitem" data-private-file={file.id} data-file-available={file.available}>
    <button type="button" className="shared-file-thumbnail" aria-label={t('Preview {0}',[file.name])} disabled={!file.available} onClick={()=>void open(file)}><span className="shared-file-icon" data-extension={file.name.split('.').at(-1)?.toLowerCase()}><Icon name={file.kind==='image'?'file-media':'file-text'}/><small>{file.name.split('.').at(-1)?.slice(0,5).toUpperCase()}</small></span></button>
    <div className="shared-file-details">
     <button type="button" className="shared-file-name" title={file.path} disabled={!file.available} onClick={()=>void open(file)}>{file.name}</button>
     <div className="shared-file-facts"><span>{attachmentSize(file.bytes)}</span><span title={formatMessageDateTime(file.createdAt,true)}>{date(file.createdAt)}</span><span>{file.author.kind==='operator'?t('You'):employeeTitle}</span>{!file.available&&<em>{t('Unavailable')}</em>}</div>
    </div>
    <div className="shared-file-actions">
     <button type="button" aria-label={t('Go to message')} title={t('Go to message')} onClick={()=>void onMessage(file.messageId).catch(cause=>setError((cause as Error).message))}><Icon name="go-to-file"/></button>
     {file.available&&<ConversationDownload conversation={'employee:'+employeeId} entryId={file.messageId} attachmentId={file.id} name={file.name}/>}
     <button type="button" disabled={!file.available||!!downloading} aria-label={t('Download {0}',[file.name])} title={t('Download file')} onClick={()=>void download(file)}><Icon name={downloading===file.id?'loading':'cloud-download'}/></button>
    </div>
   </article>)}
   {!loading&&!data.files.length&&<div className="shared-files-empty"><Icon name={query?'search':'folder-opened'}/><h3>{t(query?'No matching files':'No private files yet')}</h3><p>{t(query?'Try another filename or sender.':'Files and images sent in this private chat are stored locally on your Mac without touching the Agent’s workspace.')}</p></div>}
   {data.nextOffset!==null&&<button type="button" className="shared-files-more" disabled={loading} onClick={()=>setCount(value=>value+40)}>{t('Load more files')}</button>}
  </div>
  {clearScope&&<ClearPrivateHistoryDialog employeeId={employeeId} employeeTitle={employeeTitle} workspacePath={workspacePath} initialScope={clearScope} onClose={()=>setClearScope(null)} onCleared={result=>{setNotice(result);refresh.current()}}/>}
  {images&&<MessageImageViewer items={images.items} initialIndex={images.index} initialSrc="" origin={()=>null} onClose={()=>setImages(null)}/>}
 </section>
}
