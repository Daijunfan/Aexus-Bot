import {useEffect,useRef,useState} from 'react'
import type {SharedFile} from '../../../shared/conversation-files'
import {api} from '../api'
import {onPluginFlush} from '../plugins'
import {translate as t,useI18n} from '../i18n'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {MessageWorkspace} from './MessageWorkspace'
import {Icon} from './Icon'

type Document={content?:string;hash:string;binary:boolean;bytes:number}
export function editableSharedFile(file:SharedFile){return file.path.startsWith('@workspace/')&&file.state==='available'&&(file.mimeType.startsWith('text/')||/\.(md|markdown|txt|csv|tsv|log|json|jsonl|ya?ml|toml|ini|conf|js|jsx|ts|tsx|py|sh|html?|css|xml|sql|rs|go|java|[ch]|cpp)$/i.test(file.name))}

/** Reuses the same authenticated file contract as the Team workbench and CLI. */
export function SharedFileEditor({conversation,file,mode,onClose,onSaved}:{conversation:string;file?:SharedFile;mode:'create'|'edit'|'rename';onClose:()=>void;onSaved:()=>void}){
 useI18n()
 const [name,setName]=useState(file?.name??'notes.md'),[content,setContent]=useState(''),[document,setDocument]=useState<Document|null>(null),[loading,setLoading]=useState(mode==='edit'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false),[version,setVersion]=useState(file?.version),[reload,setReload]=useState(0)
 const alive=useRef(true),inFlight=useRef(false),exit=useRef(false),discardAction=useRef<(()=>void)|null>(null),path=file?.path.slice(11)
 const dirty=mode==='edit'?!!document&&content!==(document.content??''):name!==(file?.name??'notes.md')||mode==='create'&&!!content
 exit.current=dirty||busy
 useBeforeUnloadGuard(()=>exit.current)
 useEffect(()=>onPluginFlush(async()=>{if(exit.current)throw Error(t('Save or cancel the file changes before leaving.'))}),[])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{
  if(mode!=='edit')return
  let active=true;setLoading(true);setError('')
  void api.call<Document>('conversation.file',{conversation,operation:'read',path}).then(value=>{if(active){setDocument(value);setContent(value.content??'');if(value.binary)setError(t('This file cannot be edited as text.'))}}).catch(cause=>active&&setError((cause as Error).message)).finally(()=>active&&setLoading(false))
  return()=>{active=false}
 },[conversation,path,mode,reload])
 const leave=(action:()=>void)=>{if(dirty){discardAction.current=action;setDiscard(true)}else action()}
 const close=()=>{if(inFlight.current)return;if(discard)setDiscard(false);else leave(onClose)}
 const refresh=async()=>{if(mode==='edit'){leave(()=>setReload(value=>value+1));return}try{const info=await api.call<{exists:boolean;version:string}>('conversation.file',{conversation,operation:'info',path});if(!info.exists)throw Error(t('The file is no longer at this location. Refresh the file list.'));setVersion(info.version);setError('')}catch(cause){setError((cause as Error).message)}}
 const save=async()=>{
  if(inFlight.current||loading||mode==='edit'&&(!document||document.binary)||mode!=='create'&&!dirty)return
  inFlight.current=true;setBusy(true);setError('')
  try{
   const filename=name.trim();if(mode!=='edit'&&(!filename||/[\/\\\0]/.test(filename)||filename==='.'||filename==='..'))throw Error(t('Enter a filename without folder separators.'))
   if(mode==='rename'){const parent=path!.split('/').slice(0,-1);await api.call('conversation.file',{conversation,operation:'move',path,to:[...parent,filename].join('/'),expectedVersion:version})}
   else await api.call('conversation.file',{conversation,operation:'write',path:mode==='create'?filename:path,content,...(mode==='create'?{create:true}:{hash:document!.hash})})
   if(alive.current){exit.current=false;onSaved();onClose()}
  }catch(cause){if(alive.current)setError((cause as Error).message)}finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 return <MessageWorkspace className={'shared-file-editor '+(mode==='rename'?'is-rename':'')} compact={mode==='rename'} title={t(mode==='create'?'New file':mode==='rename'?'Rename file':'Edit file')} subtitle={file?.name??t('Shared with this conversation')} icon={mode==='rename'?'edit':'file-text'} closeLabel={t('Close file editor')} onClose={close} busy={busy} dirty={dirty} scroll={false} initialFocus={mode==='edit'?'.shared-file-content':'[name=shared-filename]'} footer={<><span className="message-workspace-footer-note">{mode==='rename'?t('Existing message attachments follow the new filename.'):t('Changes apply to the shared file.')}</span><button disabled={busy} onClick={onClose}>{t('Cancel')}</button><button className="primary" disabled={busy||loading||discard||mode!=='create'&&!dirty||mode==='edit'&&(!document||document.binary)||mode!=='edit'&&!name.trim()} onClick={()=>void save()}><Icon name="check"/>{t(mode==='create'?'Create file':mode==='rename'?'Rename':'Save file')}</button></>}>
  {discard&&<div className="message-workspace-discard" role="alert"><p>{t('Discard unsaved file changes?')}</p><button onClick={()=>setDiscard(false)}>{t('Keep editing')}</button><button onClick={()=>{setDiscard(false);const action=discardAction.current;discardAction.current=null;action?.()}}>{t('Discard changes')}</button></div>}
  {error&&<div className="shared-files-error" role="alert"><Icon name="warning"/><span>{t(error)}</span>{mode!=='create'&&<button disabled={busy} onClick={()=>void refresh()}>{t('Load latest')}</button>}</div>}
  {mode!=='edit'&&<label className="shared-file-name-field">{t('File name')}<input name="shared-filename" aria-label={t('File name')} maxLength={240} disabled={busy||discard} value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();void save()}}}/></label>}
  {loading?<p role="status">{t('Loading file…')}</p>:mode!=='rename'&&<textarea className="shared-file-content" aria-label={t('File content')} spellCheck={false} readOnly={busy||discard||mode==='edit'&&!document||!!document?.binary} value={content} onChange={event=>setContent(event.target.value)} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!busy&&!document?.binary)void save()}}}/>}
 </MessageWorkspace>
}
