import {randomUUID} from 'node:crypto'
import type {ChannelCollector} from '../shared/channels'
import {one,run} from './channel-store'
import {requestContext,requireAppAdministrator} from './authorization'
import {cloudHostTarget} from './cloud-hosts'

export type ChannelStorageSettings={collectorId:string;hostId:string;directory:string;retentionDays:null;platformCapacityBytes:Record<string,number>}
type Job={id:string;operation:string;args:Record<string,any>;collector:string;state:'queued'|'sent';resolve:(result:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
const jobs=new Map<string,Job>(),listeners=new Set<()=>void>()
const fail=(text:string,code='CHANNEL_STORAGE_UNAVAILABLE',status=503)=>Object.assign(Error(text),{code,status})
export function channelStorageSettings():ChannelStorageSettings|undefined{const value=one("SELECT value FROM metadata WHERE key='content_storage'")?.value;return value?{...JSON.parse(value),retentionDays:null,platformCapacityBytes:{telegram:1e12,x:1e12,youtube:1e12}}:undefined}
export function configureChannelStorage(patch?:Record<string,any>){
 requireAppAdministrator()
 if(patch){
  if(Object.keys(patch).some(key=>!['collectorId','hostId','directory'].includes(key))||!one("SELECT id FROM collectors WHERE id=? AND revoked_at IS NULL AND source_ids='\"all\"'",patch.collectorId))throw fail('Choose an active storage collector','INVALID_CHANNEL_STORAGE',400)
  const target=cloudHostTarget(patch.hostId,patch.directory)
  const value:ChannelStorageSettings={collectorId:patch.collectorId,hostId:patch.hostId,directory:target.directory,retentionDays:null,platformCapacityBytes:{telegram:1e12,x:1e12,youtube:1e12}}
  run("INSERT INTO metadata VALUES('content_storage',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(value))
 }
 return {policy:'memory-unless-saved',storage:channelStorageSettings()??null}
}
export function channelStorageRpc<T=any>(operation:string,args:Record<string,any>={},timeout=25000):Promise<T>{
 const storage=channelStorageSettings();if(!storage)return Promise.reject(fail('Configure the channel storage server before loading news'))
 return new Promise((resolve,reject)=>{
  const id=randomUUID(),timer=setTimeout(()=>{jobs.delete(id);reject(fail('Channel storage server did not respond; nothing was cached on this Mac'))},timeout)
  jobs.set(id,{id,operation,args,collector:storage.collectorId,state:'queued',resolve,reject,timer});for(const wake of listeners)wake()
 })
}
function storageCollector(collector:ChannelCollector){if(collector.sourceIds!=='all'||channelStorageSettings()?.collectorId!==collector.id)throw fail('This collector is not the channel storage server','STORAGE_FORBIDDEN',403)}
export async function exchangeChannelStorage(collector:ChannelCollector,args:Record<string,any>){
 storageCollector(collector)
 if(Object.keys(args).some(key=>key!=='waitMs')||args.waitMs!==undefined&&(!Number.isInteger(args.waitMs)||args.waitMs<0||args.waitMs>15000))throw fail('Invalid storage wait','INVALID_REQUEST',400)
 const pending=()=>[...jobs.values()].filter(job=>job.collector===collector.id&&job.state==='queued').sort((a,b)=>Number(['asset-put','assets-import','write'].includes(a.operation))-Number(['asset-put','assets-import','write'].includes(b.operation)))[0]
 if(!pending()&&args.waitMs)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);listeners.delete(done);resolve()},timer=setTimeout(done,args.waitMs);listeners.add(done)})
 storageCollector(collector);const job=pending()
 if(!job)return {jobs:[]}
 job.state='sent';return {jobs:[{id:job.id,operation:job.operation,args:job.args}]}
}
export function completeChannelStorage(collector:ChannelCollector,args:Record<string,any>){
 storageCollector(collector)
 if(Object.keys(args).some(key=>!['id','result','error'].includes(key)))throw fail('Unknown storage response field','INVALID_REQUEST',400)
 const job=jobs.get(args.id);if(!job)return {accepted:false}
 if(job.collector!==collector.id||job.state!=='sent')throw fail('Storage result belongs to another request','STORAGE_FORBIDDEN',403)
 jobs.delete(job.id);clearTimeout(job.timer)
 args.error?job.reject(fail(String(args.error))):job.resolve(args.result)
 return {accepted:true}
}
export function closeChannelStorageTransport(){for(const job of jobs.values()){clearTimeout(job.timer);job.reject(fail('Channel storage connection closed'))}jobs.clear();for(const wake of listeners)wake();listeners.clear()}
