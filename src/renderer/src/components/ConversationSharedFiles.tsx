import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {SharedFile,SharedFilePage} from '../../../shared/conversation-files'
import type {AssetPreview} from '../../../shared/asset-schema'
import {attachmentSize} from '../../../shared/message-attachments'
import {api} from '../api'
import {downloadFile} from '../file-actions'
import {translate as t,interfaceLocale} from '../i18n'
import {createRefreshQueue} from '../snapshot'
import {formatMessageDateTime} from '../message-time'
import {Icon} from './Icon'
import {AppSelect} from './AppSelect'
import {MessageMenu} from './MessageMenu'
import {useDialogFocus} from '../office/useDialogFocus'

type Receipt={path:string;trashId:string}
export function ConversationSharedFiles({conversation,query,author,onAuthor,onMessage,onShare,filters={},senders=[]}:{conversation:string;query:string;author:string;onAuthor:(value:string)=>void;onMessage:(id:string)=>Promise<void>;onShare?:()=>void;filters?:Record<string,unknown>;senders?:{id:string;title:string}[]}){
 const [data,setData]=useState<SharedFilePage>({files:[],total:0,totalBytes:0,nextOffset:null,readOnly:false}),[state,setState]=useState<'active'|'trash'>('active'),[sort,setSort]=useState('newest'),[count,setCount]=useState(40),[loading,setLoading]=useState(true),[error,setError]=useState(''),[loadError,setLoadError]=useState('')
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[menu,setMenu]=useState<{file:SharedFile;x:number;y:number}|null>(null),[confirm,setConfirm]=useState<SharedFile[]|null>(null),[busy,setBusy]=useState(false),busyRef=useRef(false),[downloading,setDownloading]=useState('')
 const [undo,setUndo]=useState<Receipt[]|null>(null),[notice,setNotice]=useState<{action:'trash'|'restore';count:number}|null>(null),[preview,setPreview]=useState<SharedFile|null>(null),[cover,setCover]=useState<AssetPreview|null>(null),[previewLoading,setPreviewLoading]=useState(false)
 const filterKey=JSON.stringify(filters)
 const refresh=useRef<()=>void>(()=>{}),list=useRef<HTMLDivElement>(null)
 useDialogFocus('.shared-file-confirm',!!confirm)
 useDialogFocus('.shared-file-preview',!!preview)
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key!=='Escape'||!(event.target instanceof Element)||!event.target.closest('.shared-file-confirm,.shared-file-preview'))return;event.preventDefault();event.stopImmediatePropagation();if(preview)setPreview(null);else if(!busyRef.current)setConfirm(null)};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[!!preview,!!confirm])
 useEffect(()=>{setSelected([]);setSelecting(false);setMenu(null);setError('');list.current?.scrollTo({top:0})},[conversation,query,author,state,sort,filterKey])
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined
  const run=createRefreshQueue(async()=>{
   try{
    const files:SharedFile[]=[];let page:SharedFilePage
    do{page=await api.call<SharedFilePage>('conversation.files',{conversation,query,author:['all','you','employee'].includes(author)?author:'all',...filters,state,sort,offset:files.length,limit:Math.min(100,Math.max(40,count-files.length))});if(!alive)return;files.push(...page.files)}while(page.nextOffset!==null&&files.length<count)
    setData({...page,files});setLoadError('');setSelected(previous=>previous.filter(id=>files.some(file=>file.id===id)))
   }catch(cause){if(alive)setLoadError((cause as Error).message)}finally{if(alive)setLoading(false)}
  })
  refresh.current=()=>void run();setLoading(true);timer=setTimeout(()=>void run(),query?150:0)
  const off=api.onEvent(event=>{if(event.channel==='conversation:files-changed'&&event.payload?.conversation===conversation||event.channel==='chat:changed'&&event.payload.id===conversation.slice(6)&&(!event.payload.messageId||event.payload.editedMessageId))void run()})
  return()=>{alive=false;clearTimeout(timer);off();refresh.current=()=>{}}
 },[conversation,query,author,state,sort,count,filterKey])
 useEffect(()=>{
  setCover(null);if(!preview)return
  let alive=true
  if(!preview.previewId){setPreviewLoading(false);return}
  setPreviewLoading(true)
  void api.call<AssetPreview>('assets.preview',{id:preview.previewId}).then(value=>{if(alive)setCover(value)}).catch(cause=>{if(alive)setCover({kind:'fallback',reason:(cause as Error).message})}).finally(()=>{if(alive)setPreviewLoading(false)})
  return()=>{alive=false}
 },[preview?.id,preview?.version])
 const chosen=data.files.filter(file=>selected.includes(file.id)),canSelect=(file:SharedFile)=>state==='trash'?file.canRestore:file.canTrash
 const toggle=(id:string)=>setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])
 const download=async(file:SharedFile)=>{if(busyRef.current||downloading)return;setDownloading(file.id);setError('');try{await downloadFile({group:conversation.slice(6),path:file.path})}catch(cause){setError((cause as Error).message)}finally{setDownloading('')}}
 const mutate=async(action:'trash'|'restore',files:SharedFile[]|Receipt[])=>{
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('')
  try{
   if(action==='trash'){
    const result=await api.call<{trashed:Receipt[];count:number}>('conversation.file-trash',{conversation,files:(files as SharedFile[]).map(({path,version})=>({path,version}))})
    setUndo(result.trashed);setNotice({action:'trash',count:result.count})
   }else{
    const result=await api.call<{count:number}>('conversation.file-restore',{conversation,files:files.map(file=>({path:file.path,trashId:file.trashId}))})
    setUndo(null);setNotice({action:'restore',count:result.count})
   }
   setConfirm(null);setSelected([]);setSelecting(false);refresh.current()
  }catch(cause){setError((cause as Error).message);refresh.current()}finally{busyRef.current=false;setBusy(false)}
 }
 const askTrash=(files:SharedFile[])=>{if(busyRef.current)return;setError('');setConfirm(files)}
 const popup=(file:SharedFile,element:HTMLElement)=>{const rect=element.getBoundingClientRect();setMenu({file,x:rect.right-200,y:rect.bottom+5})}
 const date=(at:number)=>new Date(at).toLocaleDateString(interfaceLocale(),{month:'short',day:'numeric'})
 return <section className="shared-file-library" aria-label={t('Shared file manager')} aria-busy={loading}>
  <div className="shared-files-controls">{onShare&&<button className="shared-files-add" onClick={onShare}><Icon name="add"/>{t('Share files')}</button>}<div className="shared-files-views" role="group" aria-label={t('File location')}><button aria-pressed={state==='active'} onClick={()=>{setState('active');setCount(40)}}><Icon name="folder-opened"/>{t('Shared')}</button>{!data.readOnly&&<button disabled={data.readOnly} title={data.readOnly?t('Files are managed by the original native chat.'):undefined} aria-pressed={state==='trash'} onClick={()=>{setState('trash');setCount(40)}}><Icon name="trash"/>{t('Trash')}</button>}</div>{(!data.readOnly&&(selecting||data.files.length>0))&&<button className="shared-files-select" disabled={busy||data.readOnly||!data.files.length} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setSelected([])}}>{t(selecting?'Done':'Select')}</button>}</div>
  {data.readOnly&&<p className="shared-files-native-note"><Icon name="link-external"/>{t('Files are managed by the original native chat.')}</p>}
  <div className="shared-files-summary"><span role="status">{loading?t('Loading…'):t(data.total===1?'{0} file':'{0} files',[data.total])}{!loading&&data.total>0&&<small> · {attachmentSize(data.totalBytes)}</small>}</span><AppSelect aria-label={t('Sort shared files')} value={sort} onChange={event=>{setSort(event.target.value);setCount(40)}}><option value="newest">{t(state==='trash'?'Recently removed':'Recently shared')}</option><option value="name">{t('File name')}</option><option value="size">{t('Largest first')}</option></AppSelect><AppSelect aria-label={t('Filter file sender')} value={author} onChange={event=>{onAuthor(event.target.value);setCount(40)}}><option value="all">{t('Everyone')}</option><option value="you">{t('From you')}</option><option value="employee">{t('From teammates')}</option>{senders.map(sender=><option key={sender.id} value={sender.id}>{sender.title}</option>)}</AppSelect></div>
  {selecting&&<div className="shared-files-bulk"><label><input type="checkbox" aria-label={t('Select all visible files')} checked={data.files.some(canSelect)&&data.files.filter(canSelect).every(file=>selected.includes(file.id))} onChange={event=>setSelected(event.target.checked?data.files.filter(canSelect).map(file=>file.id):[])}/>{t('{0} selected',[selected.length])}</label><button disabled={!chosen.length||busy||!!downloading} className={state==='active'?'danger':''} onClick={()=>state==='active'?askTrash(chosen):void mutate('restore',chosen)}><Icon name={state==='active'?'trash':'discard'}/>{t(state==='active'?'Move to Trash':'Restore')}</button></div>}
  {notice&&<div className="shared-files-feedback" role="status"><Icon name="check"/><span>{t(notice.action==='trash'?'Moved {0} files to Trash':'Restored {0} files',[notice.count])}</span>{undo&&<button disabled={busy} onClick={()=>void mutate('restore',undo)}>{t('Undo')}</button>}<button aria-label={t('Dismiss file notification')} onClick={()=>{setNotice(null);setUndo(null)}}><Icon name="close"/></button></div>}
  {(error||loadError)&&<div className="shared-files-error" role="alert"><Icon name="warning"/><span>{t(error||loadError)}</span><button disabled={busy} onClick={()=>refresh.current()}>{t('Refresh')}</button></div>}
  <div ref={list} inert={loading} className="shared-files-list" role="list" aria-label={t(state==='trash'?'Removed shared files':'Shared files')}>
   {data.files.map(file=><article key={file.id} className="shared-file-row" role="listitem" data-shared-file={file.id} data-file-state={file.state} data-selected={selected.includes(file.id)} tabIndex={0} onContextMenu={event=>{event.preventDefault();popup(file,event.currentTarget)}} onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key===' '){event.preventDefault();setSelecting(true);toggle(file.id)}else if(event.key==='Delete'&&file.canTrash&&!busy){event.preventDefault();askTrash([file])}else if(event.key==='Enter'&&file.state!=='trashed'){event.preventDefault();setPreview(file)}}}>
    {selecting&&<input type="checkbox" aria-label={t('Select {0}',[file.name])} checked={selected.includes(file.id)} disabled={!canSelect(file)||busy} onChange={()=>toggle(file.id)}/>}
    <span className="shared-file-icon" data-type={file.mimeType.startsWith('image/')?'image':file.mimeType.startsWith('audio/')?'audio':file.mimeType.startsWith('video/')?'video':/\.(zip|gz|tar|7z|rar)$/i.test(file.name)?'archive':/\.(csv|xlsx?|ods)$/i.test(file.name)?'sheet':/\.(docx?|odt|rtf)$/i.test(file.name)?'document':/\.(tsx?|jsx?|py|sh|json|yml|html|css)$/i.test(file.name)?'code':'file'} data-extension={file.name.split('.').at(-1)?.toLowerCase()}><Icon name="file"/><small>{file.name.split('.').at(-1)?.slice(0,5).toUpperCase()}</small></span>
    <div className="shared-file-details"><button className="shared-file-name" title={file.name} disabled={busy||file.state==='trashed'||file.state==='missing'} onClick={()=>setPreview(file)}>{file.name}</button><div className="shared-file-facts"><span>{attachmentSize(file.bytes)}</span><span title={formatMessageDateTime(file.deletedAt??file.sharedAt,true)}>{date(file.deletedAt??file.sharedAt)}</span><span>{state==='trash'?(file.deletedBy?.kind==='operator'?t('Removed by you'):file.deletedByName?t('Removed by {0}',[file.deletedByName]):t('Removed from shared files')):file.authorIdentity.kind==='operator'?t('You'):file.author}</span>{file.state==='missing'&&<em>{t('Unavailable')}</em>}{file.state==='external'&&<em>{t('Native chat')}</em>}</div>{file.referenceCount>1&&<small className="shared-file-references">{t('Shared in {0} messages',[file.referenceCount])}</small>}</div>
    <div className="shared-file-actions">{state==='trash'?<button disabled={busy||!file.canRestore} aria-label={t('Restore {0}',[file.name])} title={t('Restore')} onClick={()=>void mutate('restore',[file])}><Icon name="discard"/></button>:<button disabled={busy||!!downloading||file.state==='missing'} aria-label={t('Download {0}',[file.name])} title={t('Download file')} onClick={()=>void download(file)}><Icon name={downloading===file.id?'loading':'cloud-download'}/></button>}<button disabled={busy} aria-label={t('File actions for {0}',[file.name])} aria-haspopup="menu" onClick={event=>popup(file,event.currentTarget)}><Icon name="ellipsis"/></button></div>
   </article>)}
   {!loading&&!data.files.length&&<div className="shared-files-empty"><Icon name={state==='trash'?'trash':query?'search':'folder-opened'}/><h3>{t(query?'No matching files':state==='trash'?'Trash is empty':'No shared files yet')}</h3><p>{t(query?'Try another filename or sender.':state==='trash'?'Removed files can be restored here.':'Files shared in this conversation will appear here.')}</p>{onShare&&state==='active'&&!query&&<button className="shared-files-empty-action" onClick={onShare}><Icon name="attach"/>{t('Add files to this conversation')}</button>}</div>}
   {data.nextOffset!==null&&<button className="shared-files-more" disabled={loading} onClick={()=>setCount(value=>value+40)}>{t('Load more files')}</button>}
  </div>
  {menu&&<MessageMenu anchor={menu} label={t('File actions')} onClose={()=>setMenu(null)}>{menu.file.state!=='trashed'&&<button role="menuitem" disabled={menu.file.state==='missing'} onClick={()=>{setPreview(menu.file);setMenu(null)}}><Icon name="open-preview"/>{t('Preview')}</button>}{menu.file.state!=='trashed'&&<button role="menuitem" disabled={menu.file.state==='missing'||!!downloading} onClick={()=>{void download(menu.file);setMenu(null)}}><Icon name="cloud-download"/>{t('Download file')}</button>}<button role="menuitem" onClick={()=>{void onMessage(menu.file.messageId).catch(cause=>setError(cause.message));setMenu(null)}}><Icon name="go-to-file"/>{t('Go to message')}</button>{menu.file.canTrash&&<button role="menuitem" className="danger" disabled={!!downloading} onClick={()=>{askTrash([menu.file]);setMenu(null)}}><Icon name="trash"/>{t('Move to Trash')}</button>}{menu.file.canRestore&&<button role="menuitem" onClick={()=>{void mutate('restore',[menu.file]);setMenu(null)}}><Icon name="discard"/>{t('Restore')}</button>}</MessageMenu>}
  {confirm&&createPortal(<div className="shared-file-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label={t('Remove shared files')} className="shared-file-confirm"><header><Icon name="trash"/><h3>{t(confirm.length===1?'Move this file to Trash?':'Move {0} files to Trash?',[confirm.length])}</h3></header><p>{t('Group members will no longer be able to open these attachments. You can restore them from Trash; the messages stay in place.')}</p><ul>{confirm.slice(0,4).map(file=><li key={file.id}>{file.name}</li>)}{confirm.length>4&&<li>{t('And {0} more files',[confirm.length-4])}</li>}</ul>{error&&<p role="alert" className="shared-file-confirm-error">{t(error)}</p>}<footer><button disabled={busy} onClick={()=>setConfirm(null)}>{t('Cancel')}</button><button disabled={busy} className="danger" onClick={()=>void mutate('trash',confirm)}>{t(busy?'Moving…':'Move to Trash')}</button></footer></section></div>,document.body)}
  {preview&&createPortal(<div className="shared-file-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label={t('File preview')} className="shared-file-preview"><header><strong>{preview.name}</strong><button aria-label={t('Close file preview')} onClick={()=>setPreview(null)}><Icon name="close"/></button></header><div className="shared-file-cover">{previewLoading?<span role="status">{t('Loading preview…')}</span>:cover?.kind==='image'?<img alt={t('Preview of {0}',[preview.name])} src={'data:'+cover.mimeType+';base64,'+cover.data}/>:<div><Icon name="file"/><p>{t('Preview unavailable. Download the file to open it.')}</p></div>}</div><footer><span>{attachmentSize(preview.bytes)}{cover?.pageCount?' · '+t('Page 1 of {0}',[cover.pageCount]):''}</span><button disabled={!!downloading} onClick={()=>void download(preview)}><Icon name="cloud-download"/>{t('Download file')}</button></footer></section></div>,document.body)}
 </section>
}
