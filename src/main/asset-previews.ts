import {temporaryFile} from './file-snapshots'
import {downloadInfo} from './uploads'
import {isAppAdministrator} from './application-authority'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {Worker} from 'node:worker_threads'
import {assetCatalog,assetReference,locateAsset} from './assets'
import {requestContext,withCaller} from './request-context'
import {requirePlugin,pluginFile} from './plugins/registry'
import {workspacePath,workspaceFiles} from './files'
import {liveChannelPost,projectChannelDocuments} from './channel-store'
import type {AssetPreview} from '../shared/asset-schema'
import type {FileLocation} from '../shared/transfers'
import type {FileEndpoint} from './transfers'
const cache=new Map<string,AssetPreview>(),pending=new Map<string,Promise<AssetPreview>>(),workers=new Set<Worker>(),waiting:Array<()=>void>=[]
let active=0,cacheBytes=0,closed=false
const version=(stat:fs.Stats)=>createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest('hex').slice(0,24)
const fallback=(reason:string):AssetPreview=>({kind:'fallback',reason})
function remember(key:string,value:AssetPreview){cacheBytes-=cache.get(key)?.data?.length??0;cache.set(key,value);cacheBytes+=value.data?.length??0;while(cache.size>72||cacheBytes>12*1024*1024){const oldest=cache.keys().next().value!;cacheBytes-=cache.get(oldest)?.data?.length??0;cache.delete(oldest)}}
/** Reuse the Reader's pure bounded cover worker, not its library database or workspace selection. */
export async function assetPreview(id:string,call:(command:string,args:Record<string,any>)=>Promise<any>,resolve:(location:FileLocation,destination:boolean)=>FileEndpoint):Promise<AssetPreview>{
 if(!isAppAdministrator())throw Error('Only the user or Secretary may preview all company assets')
 if(closed)return fallback('Preview service is closed')
 const catalog=assetCatalog(),ref=assetReference(id)
 if(catalog.mounts.find(mount=>mount.id===ref.asset)?.remote&&!ref.asset.startsWith('group:'))return fallback('Remote original not fetched for a thumbnail')
 const {node}=await locateAsset(id,catalog,call)
 let location=node.location,format=path.extname(node.name).slice(1).toLowerCase()
 if(node.document){const post=liveChannelPost(node.document.postId),file=projectChannelDocuments(post).find(file=>file.id===node.document!.fileId);if(!file?.thumbnailMediaId)return fallback('No cached cover; the cloud original was not downloaded');location={channel:post.channel_id,path:post.id+'/'+file.thumbnailMediaId};format='png'}
 if(node.directory||!location)return fallback('Folder or virtual collection')
 const end=resolve(location,false)
 return previewEndpoint(end,format,ref.asset.startsWith('group:'))
}
async function previewEndpoint(end:FileEndpoint,format:string,allowRemote=false):Promise<AssetPreview>{
 if(end.remote){
  if(!allowRemote)return fallback('Remote original not fetched for a thumbnail')
  const info=await downloadInfo(end),stamp=info.version??String(info.modifiedAt)+':'+info.bytes,key=JSON.stringify([end.remote,end.path,stamp,format]);if(cache.has(key))return cache.get(key)!;if(pending.has(key))return pending.get(key)!
  const task=temporaryFile(end,64*1024*1024,local=>previewEndpoint(local,format)).then(async value=>{const current=await downloadInfo(end);if((current.version??String(current.modifiedAt)+':'+current.bytes)!==stamp)return fallback('File changed; refresh to load its cover');const result={...value,version:stamp};if(value.kind==='image'){remember(key,result)}return result}).catch(cause=>fallback(cause.message)).finally(()=>pending.delete(key));pending.set(key,task);return task
 }
 if(!['pdf','html','htm','xhtml','md','markdown','txt','png','jpg','jpeg','webp','gif','avif','bmp'].includes(format))return fallback('No preview for this file type')
 const filename=workspacePath(end.root,end.path),stat=fs.lstatSync(filename)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)return fallback('Preview size or file type limit')
 if(['png','jpg','jpeg','gif','webp'].includes(format)&&stat.size<=1024*1024){await end.validate?.('copy-info',{path:end.path});const image=workspaceFiles(end.root,'read-image',{path:end.path});if(version(fs.statSync(filename))!==version(stat))return fallback('File changed; refresh to load its cover');return {kind:'image',mimeType:image.mimeType,data:image.data,version:version(stat)}}
 let workerPath:string
 try{workerPath=pluginFile(requirePlugin('margin-reader').directory,'lib/preview-worker.cjs')}catch{return fallback('Reader preview renderer is not installed')}
 const stamp=version(stat),key=[workerPath,filename,stamp,format].join('|'),context=requestContext()
 await end.validate?.('copy-info',{path:end.path})
 if(cache.has(key)){const value=cache.get(key)!;cache.delete(key);cache.set(key,value);return value}
 if(pending.has(key))return pending.get(key)!
 const task=(async():Promise<AssetPreview>=>{
  if(active>=2)await new Promise<void>(resolve=>waiting.push(resolve));else active++
  try{
   if(closed)return fallback('Preview service is closed')
   return await new Promise<AssetPreview>((resolve,reject)=>{
    const worker=new Worker(workerPath,{workerData:{workspace:end.root,filename:end.path,format,expectedVersion:stamp,page:1},stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:384,stackSizeMb:8}})
    workers.add(worker);worker.stdout.resume();worker.stderr.resume();let done=false
    const finish=(value:AssetPreview)=>{if(done)return;done=true;clearTimeout(timer);workers.delete(worker);void worker.terminate().then(()=>resolve(value),reject)}
    const timer=setTimeout(()=>finish(fallback('Cover generation timed out')),15000);timer.unref()
    worker.once('message',message=>{void withCaller(context,async()=>{
     try{await end.validate?.('copy-info',{path:end.path});if(version(fs.statSync(filename))!==stamp){finish(fallback('File changed; refresh to load its cover'));return}
      const result=message.result
      if(!result||result.kind!=='image'||result.mimeType!=='image/png'||result.contentBase64.length>1400000){finish(fallback(message.error?.message??'Preview unavailable'));return}
      const value:AssetPreview={kind:'image',mimeType:result.mimeType,data:result.contentBase64,width:result.width,height:result.height,pageCount:result.pageCount,version:stamp}
      remember(key,value);finish(value)
     }catch{finish(fallback('Source changed or is no longer readable'))}
    })})
    worker.once('error',()=>finish(fallback('Preview renderer unavailable')));worker.once('exit',()=>{if(!done)finish(fallback('Preview renderer stopped'))})
   })
  }finally{const next=waiting.shift();if(next)next();else active--}
 })().finally(()=>pending.delete(key))
 pending.set(key,task);return task
}
export async function closeAssetPreviews(){closed=true;await Promise.all([...workers].map(worker=>worker.terminate()));await Promise.allSettled([...pending.values()]);cache.clear();cacheBytes=0}
