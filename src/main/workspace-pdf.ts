import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {Worker} from 'node:worker_threads'
import {authorize,requestContext} from './authorization'
import {requirePlugin,pluginFile} from './plugins/registry'
import {temporaryFile} from './file-snapshots'
import {workspacePath} from './files'
import {downloadInfo,downloadChunk,beginUpload,uploadChunk,commitUpload,abortUpload} from './uploads'
import type {FileEndpoint} from './transfers'
import type {FileLocation} from '../shared/transfers'

let active=0,closed=false
const waiting:Array<()=>void>=[],workers=new Set<Worker>()
const stamp=(s:fs.Stats)=>createHash('sha256').update(`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`).digest('hex').slice(0,24)
async function readPdf(local:FileEndpoint,args:Record<string,any>){
 if(active>=2)await new Promise<void>(resolve=>waiting.push(resolve));else active++
 try{
  if(closed)throw Error('PDF service is closed')
  const file=workspacePath(local.root,local.path),stat=fs.statSync(file)
  if(!stat.isFile()||stat.size>512*1024*1024)throw Error('Choose a PDF up to 512 MiB')
  const workerPath=pluginFile(requirePlugin('margin-reader').directory,'lib/preview-worker.cjs'),signal=requestContext().signal
  signal?.throwIfAborted()
  return await new Promise<any>((resolve,reject)=>{
   const worker=new Worker(workerPath,{workerData:{workspace:local.root,filename:local.path,format:'pdf',expectedVersion:stamp(stat),pdfOperation:args.operation??'info',page:args.page??1,limit:args.limit??4,width:args.width??1600,password:args.password},stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:512,stackSizeMb:8}})
   workers.add(worker);worker.stdout.resume();worker.stderr.resume();let done=false
   const finish=(error:Error|null,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);workers.delete(worker);void worker.terminate().then(()=>error?reject(error):resolve(value),reject)}
   const abort=()=>finish(Error('PDF request cancelled')),timer=setTimeout(()=>finish(Error('PDF processing timed out')),120000);timer.unref();signal?.addEventListener('abort',abort,{once:true})
   worker.once('message',value=>{try{if(value.error)finish(Error(value.error.message));else if(stamp(fs.statSync(file))!==stamp(stat))finish(Error('PDF changed while reading; try again'));else finish(null,value.result)}catch(error){finish(error as Error)}})
   worker.once('error',error=>finish(error));worker.once('exit',()=>finish(Error('PDF renderer stopped')))
  })
 }finally{const next=waiting.shift();if(next)next();else active--}
}
export async function workspacePdf(args:Record<string,any>,resolve:(location:FileLocation,destination:boolean)=>FileEndpoint){
 const operation=args.operation??'info',location={employee:args.employee,path:args.path},source=resolve(location,false)
 authorize('workspace.read',{employee:args.employee},args.employee)
 if(operation==='render')authorize('workspace.write',{employee:args.employee},args.employee)
 if(args.to!==undefined&&operation!=='render')throw Error('to is only valid for render')
 const before=await downloadInfo(source),sourceVersion=before.version??before.bytes+':'+before.modifiedAt
 if(args.expectedVersion!==undefined&&args.expectedVersion!==sourceVersion)throw Error('PDF version changed; inspect the current file before retrying')
 const result=await temporaryFile(source,512*1024*1024,local=>readPdf(local,{...args,operation})),after=await downloadInfo(source)
 if(before.version!==after.version||before.bytes!==after.bytes||before.modifiedAt!==after.modifiedAt)throw Error('PDF changed during processing; no output was published')
 const metadata={kind:'workspace-pdf',path:args.path,sourceVersion,operation,title:result.title,pageCount:result.pageCount}
 if(operation==='info')return metadata
 if(operation==='text')return {...metadata,pages:result.pages,nextPage:result.nextPage}
 if(operation==='page')return {...metadata,kind:'workspace-pdf-page',page:result.page,width:result.width,height:result.height,mimeType:result.mimeType,data:result.contentBase64,text:result.text}
 const output=args.to??path.posix.basename(String(args.path).replace(/\\/g,'/')).replace(/\.pdf$/i,'')+'-page-'+result.page+'.png'
 if(typeof output!=='string'||!output||output.includes('\\')||path.posix.isAbsolute(output)||output.split('/').includes('..')||!output.toLowerCase().endsWith('.png'))throw Error('Choose a relative PNG path in the employee workspace')
 const bytes=Buffer.from(result.contentBase64,'base64'),sha256=createHash('sha256').update(bytes).digest('hex'),parent=path.posix.dirname(output),name=path.posix.basename(output),to={employee:args.employee,path:parent},target=resolve(to,true),existing=resolve({employee:args.employee,path:output},false)
 let reused=false
 try{const info=await downloadInfo(existing),hash=createHash('sha256');for(let offset=0;offset<info.bytes;){const chunk=await downloadChunk(existing,offset,info.modifiedAt);if(!chunk.bytes)throw Error('Output ended while checking');hash.update(Buffer.from(chunk.data,'base64'));offset+=chunk.bytes}if(info.bytes!==bytes.length||hash.digest('hex')!==sha256)throw Error('A different file already exists at the output path');reused=true}catch(error){if((error as Error).message!=='Choose a regular file to download')throw error}
 if(closed)throw Error('PDF service is closed')
 requestContext().signal?.throwIfAborted()
 if(!reused){const upload=await beginUpload(to,target,name,bytes.length);try{for(let offset=0;offset<bytes.length;offset+=upload.chunkBytes)await uploadChunk(upload.id,offset,bytes.subarray(offset,offset+upload.chunkBytes).toString('base64'));await commitUpload(upload.id)}catch(error){await abortUpload(upload.id).catch(()=>{});throw error}}
 return {...metadata,path:output,sourcePath:args.path,page:result.page,width:result.width,height:result.height,mimeType:'image/png',bytes:bytes.length,sha256,reused}
}
export async function closeWorkspacePdfs(){closed=true;await Promise.all([...workers].map(worker=>worker.terminate()))}
