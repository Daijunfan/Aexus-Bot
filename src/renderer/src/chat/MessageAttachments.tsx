import {MessageMedia} from './MessageMedia'
import {mediaKind} from '../../../shared/media'
import {useEffect,useRef,useState} from 'react'
import {api} from '../api'
import {Icon} from '../components/Icon'
import {MessageImage,MessageGalleryContext} from './MessageImage'
import {MotionStrip} from './MotionStrip'
import {translate as uiText,useI18n} from '../i18n'
import {attachmentSize,fileMime,type MessageAttachment} from '../../../shared/message-attachments'
import {downloadBrowserFile} from '../web/files'
import {onPluginFlush} from '../plugins'

type Upload={id:string;conversation:string;composerKey:string;onReady:(conversation:string,path:string,kind:'image'|'file')=>void;file:File;progress:number;state:'queued'|'uploading'|'failed';error?:string;controller:AbortController}
let uploading=0
const uploadWaiters:Array<()=>void>=[]
function uploadSlot(signal:AbortSignal):Promise<()=>void>{
 signal.throwIfAborted()
 const release=()=>{const next=uploadWaiters.shift();if(next)next();else uploading--}
 if(uploading<4){uploading++;return Promise.resolve(release)}
 return new Promise((resolve,reject)=>{const start=()=>{signal.removeEventListener('abort',cancel);resolve(release)},cancel=()=>{const index=uploadWaiters.indexOf(start);if(index>=0)uploadWaiters.splice(index,1);reject(new DOMException('Upload cancelled','AbortError'))};uploadWaiters.push(start);signal.addEventListener('abort',cancel,{once:true})})
}
const scope=(conversation:string)=>conversation.startsWith('worker:')?{worker:conversation.slice(7)}:conversation.startsWith('group:')?{group:conversation.slice(6)}:conversation.startsWith('channel:')?{channel:conversation.slice(8)}:{employee:conversation.slice(9)}
const imageFile=(file:File)=>['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)&&file.size<=10*1024*1024
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)}
export function useAttachmentUploads(conversation:string,onReady:(conversation:string,path:string,kind:'image'|'file')=>void,_count:number,composerKey=conversation){
 const [jobs,setJobs]=useState<Upload[]>([]),tasks=useRef(new Map<string,Upload>())
 const ready=useRef({composerKey,onReady});ready.current={composerKey,onReady}
 useEffect(()=>onPluginFlush(async()=>{if(tasks.current.size)throw Error('Finish or cancel attachment transfers before leaving.')}),[])
 const update=()=>setJobs([...tasks.current.values()])
 useEffect(()=>()=>{for(const job of tasks.current.values())job.controller.abort()},[])
 const run=async(job:Upload)=>{
  job.controller=new AbortController();job.state='queued';job.error=undefined;job.progress=0;tasks.current.set(job.id,job);update()
  let upload:{id:string;chunkBytes:number}|undefined,release:(()=>void)|undefined
  const check=()=>{if(job.controller.signal.aborted)throw new DOMException('Upload cancelled','AbortError')}
  try{
   release=await uploadSlot(job.controller.signal);check();job.state='uploading';update()
   upload=await api.call(job.conversation.startsWith('worker:')?'worker.upload-begin':'messenger.upload-begin',{...(job.conversation.startsWith('worker:')?{id:job.conversation.slice(7)}:{conversation:job.conversation}),name:job.file.name,bytes:job.file.size});check()
   for(let offset=0;offset<job.file.size;offset+=upload!.chunkBytes){check();const bytes=new Uint8Array(await job.file.slice(offset,offset+upload!.chunkBytes).arrayBuffer());check();await api.call('transfer.upload-chunk',{id:upload!.id,offset,data:base64(bytes)});job.progress=(offset+bytes.length)/job.file.size;update()}
   check();const result=await api.call<{destination:string}>('transfer.upload-commit',{id:upload!.id});if(!job.controller.signal.aborted)(ready.current.composerKey===job.composerKey?ready.current.onReady:job.onReady)(job.conversation,result.destination,imageFile(job.file)?'image':'file');tasks.current.delete(job.id)
  }catch(cause){if(upload)await api.call('transfer.upload-abort',{id:upload.id}).catch(()=>{});if(job.controller.signal.aborted)tasks.current.delete(job.id);else {job.state='failed';job.error=(cause as Error).message}}
  release?.();update()
 }
 const add=(files:File[])=>{
  if(files.some(file=>file.size>2*1024*1024*1024))throw Error(uiText('Files must be at most 2 GiB'))
  for(const file of files)void run({id:crypto.randomUUID(),conversation,composerKey,onReady,file,progress:0,state:'uploading',controller:new AbortController()})
 }
 const visible=jobs.filter(job=>job.composerKey===composerKey)
 return {add,busy:visible.some(job=>job.state!=='failed'),pending:visible.length>0,jobs:visible,cancel:(job:Upload)=>{job.controller.abort();if(job.state==='failed'){tasks.current.delete(job.id);update()}},retry:(job:Upload)=>void run(job)}
}
export function AttachmentTransfers({uploads}:{uploads:ReturnType<typeof useAttachmentUploads>}){
 useI18n()
 if(!uploads.jobs.length)return null
 return <MotionStrip className="attachment-transfers" aria-label={uiText('Attachment transfers')}>{uploads.jobs.map(job=><div className={'attachment-transfer '+job.state} key={job.id}><span className="attachment-file-icon"><Icon name="file"/></span><span className="attachment-transfer-info"><strong>{job.file.name}</strong><small role={job.state==='failed'?'alert':'status'}>{job.state==='failed'?job.error:job.state==='queued'?uiText('Queued'):uiText('Uploading {0} · {1}%',[attachmentSize(job.file.size),Math.round(job.progress*100)])}</small><progress max={1} value={job.progress} aria-label={uiText('Upload progress for {0}',[job.file.name])}/></span>{job.state==='failed'&&<button aria-label={uiText('Retry upload {0}',[job.file.name])} onClick={()=>uploads.retry(job)}><Icon name="refresh"/></button>}<button aria-label={uiText('Cancel upload {0}',[job.file.name])} onClick={()=>uploads.cancel(job)}><Icon name="close"/></button></div>)}</MotionStrip>
}
type PublishedFileInfo={exists?:boolean;regular?:boolean;directory?:boolean;symlink?:boolean;bytes?:number}
const groupFileReads=new Map<string,Promise<PublishedFileInfo>>()
function readGroupFileInfo(conversation:string,path:string){
 const key=conversation+'\0'+path,pending=groupFileReads.get(key);if(pending)return pending
 const request=api.call<PublishedFileInfo>('chat.file',{id:conversation.slice(6),path,operation:'info'});groupFileReads.set(key,request)
 void request.finally(()=>groupFileReads.delete(key)).catch(()=>{});return request
}
export function MessageFile({conversation,file,onRemove,messageId}:{messageId?:string;conversation:string;file:MessageAttachment|{path:string};onRemove?:()=>void}){
 useI18n()
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),name='name' in file?file.name:file.path.split(/[\\/]/).at(-1)!,extension=name.split('.').at(-1)?.toUpperCase()??'FILE'
 const [unavailable,setUnavailable]=useState(false)
 const [size,setSize]=useState<number|undefined>('bytes' in file?file.bytes:undefined)
 const groupFile=conversation.startsWith('group:')&&!file.path.startsWith('@bot/')
 const sharedWorkspace=file.path.startsWith('@workspace/')&&(conversation.startsWith('group:')||conversation.startsWith('channel:'))
 useEffect(()=>{
  let alive=true
  const read=()=>{void (groupFile?readGroupFileInfo(conversation,file.path):api.call<PublishedFileInfo>('transfer.download-info',{from:{...scope(conversation),path:file.path}})).then(info=>{if(alive){setUnavailable(info.exists===false||info.regular===false||!!info.directory||!!info.symlink);if(info.bytes!==undefined)setSize(info.bytes)}}).catch(()=>{})}
  if('bytes' in file){setSize(file.bytes);if(!sharedWorkspace&&!groupFile)return}
  read()
  const off=sharedWorkspace||groupFile?api.onEvent(event=>{if(event.channel==='client:connected'||event.channel==='conversation:files-changed'&&event.payload?.conversation===conversation)read()}):undefined
  return()=>{alive=false;off?.()}
 },[conversation,file.path,'bytes' in file?file.bytes:undefined,groupFile])
 const kind=mediaKind('mimeType' in file?file.mimeType:fileMime(file.path))
 const download=async()=>{setBusy(true);setError('');try{const from={...scope(conversation),path:file.path};if(api.mode==='web')downloadBrowserFile(from);else await api.call('transfer.download-save',{from})}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 return <div className={'message-file-wrap'+(kind?' has-media':'')+(unavailable?' is-unavailable':'')}>{kind&&!unavailable&&!conversation.startsWith('worker:')&&<MessageMedia key={conversation+'/'+file.path} conversation={conversation} messageId={messageId} path={file.path} name={name} kind={kind}/>}<div className="message-file" data-file-kind={extension.toLowerCase()}><span className="attachment-file-icon"><Icon name="file"/><small>{extension.slice(0,5)}</small></span><span className="message-file-info"><strong title={name}>{name}</strong><small>{unavailable?uiText('Removed from shared files'):<>{size!==undefined?attachmentSize(size)+' · ':''}{extension}</>}</small></span><button disabled={busy||unavailable} aria-label={onRemove?uiText('Remove attachment {0}',[name]):uiText('Download {0}',[name])} title={onRemove?uiText('Remove attachment'):uiText('Download file')} onClick={onRemove??(()=>void download())}>{busy?<span className="spinner"/>:<Icon name={onRemove?'close':'cloud-download'}/>}</button></div>{error&&<small className="message-file-error" role="alert">{error}</small>}</div>
}
export function DraftFiles({conversation,images,files,onRemove}:{conversation:string;images:string[];files:string[];onRemove:(path:string)=>void}){
 useI18n()
 if(!images.length&&!files.length)return null
 return <MessageGalleryContext.Provider value={{images:images.map(path=>({...scope(conversation),path}))}}><MotionStrip className="message-attachment-draft" aria-label={uiText('Attachments')}><div className="message-draft-attachments">{images.map(path=><div className="message-draft-attachment" key={path}><MessageImage {...scope(conversation)} path={path}/><div className="attachment-chips"><button aria-label={uiText('Remove attachment {0}',[path.split('/').at(-1)])} onClick={()=>onRemove(path)}><Icon name="close"/></button></div><small>{path.split('/').at(-1)}</small></div>)}</div>{files.map(path=><MessageFile key={path} conversation={conversation} file={{path}} onRemove={()=>onRemove(path)}/>)}</MotionStrip></MessageGalleryContext.Provider>
}
