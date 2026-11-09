import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {APP_HOME} from '../shared/core-paths'
import type {FileEndpoint} from './transfers'
import {downloadInfo,saveDownload} from './uploads'
import {fileVersion} from './read-cache'
import {workspacePath} from './files'
import {atomicJson,readJson} from './atomic-file'
import {onPluginWindows,pluginWindows} from './plugins/windows'
let active=0;const waiting:Array<()=>void>=[]
/** Bound preview scratch space; only derived covers survive a preview. */
export async function temporaryFile<T>(end:FileEndpoint,limit:number,work:(local:FileEndpoint)=>Promise<T>):Promise<T>{
 if(!end.remote)return work(end)
 if(active>=2)await new Promise<void>(resolve=>waiting.push(resolve));else active++
 let directory:string|undefined
 try{const info=await downloadInfo(end);if(info.bytes>limit)throw Error('Preview size limit');directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-preview-')));const name=path.posix.basename(end.path),file=path.join(directory,name);await saveDownload(end,file);return await work({root:directory,path:name,validate:()=>end.validate?.('copy-info',{path:end.path})})}
 finally{if(directory)fs.rmSync(directory,{recursive:true,force:true});const next=waiting.shift();if(next)next();else active--}
}
type Cached={localVersion:string;sourceVersion:string}
const tracked=new Map<string,string>(),manifest=(root:string)=>path.join(root,'.source-files.json')
function cleanup(root:string){const data=readJson<Record<string,Cached>>(manifest(root),()=>({}));for(const [relative,entry]of Object.entries(data)){try{const file=workspacePath(root,relative);if(fileVersion(file)===entry.localVersion)fs.unlinkSync(file)}catch{}}}
onPluginWindows(states=>{for(const [id,root]of tracked)if(!states.some(state=>state.id===id)){if(!states.some(state=>state.workspace===root))cleanup(root);tracked.delete(id)}})
/** Remote originals are a temporary reading cache, never a mirror of the group folder. */
export async function readingFile(end:FileEndpoint,conversation:string,version:string){
 if(!end.remote)return {root:end.root,path:end.path}
 const root=path.join(APP_HOME,'reader-cache',conversation.replace(':','-'));fs.mkdirSync(root,{recursive:true,mode:0o700})
 if(!pluginWindows().some(window=>window.workspace===root))cleanup(root)
 const data=readJson<Record<string,Cached>>(manifest(root),()=>({})),relative=end.path,file=workspacePath(root,relative)
 if(fs.existsSync(file)){
  const previous=data[relative];if(!previous||fileVersion(file)!==previous.localVersion)throw Error('The Reader copy was edited locally. Save it before reopening the shared original.')
  if(previous.sourceVersion===version)return {root,path:relative}
  fs.unlinkSync(file)
 }
 const info=await downloadInfo(end);if(info.bytes>512*1024*1024)throw Error('Reader document size limit is 512 MiB')
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});await saveDownload(end,file);fs.utimesSync(file,info.modifiedAt/1000,info.modifiedAt/1000)
 data[relative]={localVersion:fileVersion(file),sourceVersion:version};atomicJson(manifest(root),data,true);return {root,path:relative}
}
export function trackReadingWindow(id:string,root:string){if(root.startsWith(path.join(APP_HOME,'reader-cache')+path.sep))tracked.set(id,root)}
