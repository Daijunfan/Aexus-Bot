import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {db,one,all,run,changed,mediaDirectory,transaction,archiveSources,archiveAvatars,canonicalChannelId,type Row} from './channel-store'
import {CHANNEL_CONTENT_KEYS,contentChanges,acknowledgeContent,hydrateContent,markChannelContent,purgeUnsavedDiskContent,persistSavedPost,persistSavedChannelMessage,forgetCachedPosts,readPersistedReads} from './channel-persistence'
import {channelStorageSettings,channelStorageRpc} from './channel-storage-transport'
import {readJson} from './atomic-file'

const bytes=new Map<string,{data:Buffer;mimeType:string}>(),pendingAssets=new Map<string,{data:Buffer;mimeType:string}>()
let routeKey=''
let byteCount=0,ready:Promise<void>|undefined,hydrated=false,flushing:Promise<void>|undefined,lastError='',summaryAt=0,summaryPending:Promise<void>|undefined
const LIMIT=32*1024*1024,touched=new Map<string,number>(),imageRequests=new Map<string,Promise<{data:Buffer;mimeType:string}>>(),postRequests=new Map<string,Promise<void>>()
export const channelContentStatus=()=>({ready:hydrated,error:lastError||undefined,memoryBytes:byteCount,cachedPosts:Number(one('SELECT COUNT(*) n FROM posts')?.n??0),textBytes:Number(one('SELECT COALESCE(SUM(length(CAST(body AS BLOB))+length(CAST(title AS BLOB))),0) n FROM posts')?.n??0),rssBytes:process.memoryUsage().rss,policy:'memory-unless-saved',retentionDays:null,platformCapacityBytes:{telegram:1e12,x:1e12,youtube:1e12}})
export function channelAsset(id:string){const value=bytes.get(id);if(value){bytes.delete(id);bytes.set(id,value)}return value}
export function cacheChannelAsset(id:string,data:Buffer,mimeType:string,pending=false){
 if(pending&&channelStorageSettings()){pendingAssets.set(id,{data,mimeType});return}
 const old=bytes.get(id);if(old)byteCount-=old.data.length
 bytes.delete(id);bytes.set(id,{data,mimeType});byteCount+=data.length
 if(pending)pendingAssets.set(id,{data,mimeType})
 while(byteCount>LIMIT&&bytes.size>1){const first=bytes.keys().next().value!;const value=bytes.get(first)!;bytes.delete(first);byteCount-=value.data.length}
}
function wire(row:Row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?{$bytes:Buffer.from(value).toString('base64')}:value]))}
function unwire(row:Row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value&&typeof value==='object'&&'$bytes' in value?Buffer.from(value.$bytes,'base64'):value]))}
async function flushRows(){
 if(!channelStorageSettings())return
 for(const [id,asset] of pendingAssets){const linked=await channelStorageRpc<{missing:string[]}>('assets-import',{assets:[{id,sha256:createHash('sha256').update(asset.data).digest('hex'),bytes:asset.data.length,mimeType:asset.mimeType}]});if(linked.missing.length)await channelStorageRpc('asset-put',{id,data:asset.data.toString('base64'),mimeType:asset.mimeType});if(pendingAssets.get(id)===asset)pendingAssets.delete(id)}
 for(;;){const pending=contentChanges(db()).slice(0,100);if(!pending.length)return
  const receipt=await channelStorageRpc<{evicted?:string[]}>('write',{changes:pending.map(value=>({...value,row:value.row?wire(value.row):null}))})
  acknowledgeContent(db(),pending)
  if(receipt.evicted?.length){forgetCachedPosts(db(),receipt.evicted);changed('posts',{postIds:receipt.evicted})}
  const ids=pending.filter(value=>value.table==='posts').map(value=>value.key);if(ids.length){summaryAt=0;changed('posts',{postIds:ids,channelIds:[...new Set(ids.flatMap(id=>{const row=one('SELECT s.channel_id FROM posts p JOIN sources s ON s.id=p.source_id WHERE p.id=?',id);return row?[row.channel_id]:[]}))]})}
 }
}
export async function flushChannelContent(){
 if(!channelStorageSettings())return
 do{await(flushing??=(async()=>{try{await flushRows();lastError=''}catch(error){lastError=(error as Error).message;throw error}})().finally(()=>{flushing=undefined}))}while(pendingAssets.size||contentChanges(db()).length)
 trimChannelContent()
}
export function ensureChannelContent(){
 if(!channelStorageSettings()){hydrated=true;return Promise.resolve()}
 return ready??=(async()=>{
  try{
   // Legacy unsaved bytes must be durably transferred before their local copies are erased.
   if(!one("SELECT value FROM metadata WHERE key='content_memory_migrated'")){
    const media=all('SELECT * FROM media')
    for(let offset=0;offset<media.length;offset+=100){
     const batch=media.slice(offset,offset+100),result=await channelStorageRpc<{missing:string[]}>('assets-import',{assets:batch.map(row=>({id:row.id,sha256:row.sha256,bytes:row.bytes,mimeType:row.mime_type}))})
     for(const id of result.missing){const row=batch.find(row=>row.id===id)!;const file=path.resolve(mediaDirectory,row.file);if(path.dirname(file)!==path.resolve(mediaDirectory)||!fs.existsSync(file))throw Error('An existing channel image is missing; local migration was not erased');await channelStorageRpc('asset-put',{id,data:fs.readFileSync(file).toString('base64'),mimeType:row.mime_type})}
    }
    markChannelContent(db());await flushChannelContent()
    for(let offset=0;offset<media.length;offset+=100){const proof=await channelStorageRpc<{failed:string[]}>('assets-verify',{ids:media.slice(offset,offset+100).map(row=>row.id)});if(proof.failed.length)throw Error('The server image verification failed; local originals were preserved')}
    for(const [table,key] of Object.entries(CHANNEL_CONTENT_KEYS)){const rows=all('SELECT * FROM '+table);for(let offset=0;offset<rows.length;offset+=100){const expected=rows.slice(offset,offset+100).map(row=>{const value=wire(row);delete value.expires_at;const canonical=Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]));return {table,key:String(row[key]),sha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}});const proof=await channelStorageRpc<{failed:any[]}>('rows-verify',{rows:expected});if(proof.failed.length)throw Error('The server message verification failed; local originals were preserved')}}
    const preferences=readJson<any>(path.join(APP_HOME,'messenger.json'),()=>({messages:{}}))
    const savedMessages=Object.entries(preferences.messages??{}).filter(([key,value])=>key.startsWith('channel:')&&(value as any)?.saved).map(([key])=>key.slice(key.lastIndexOf('/')+1))
    for(const id of savedMessages)await channelStorageRpc('pin',{table:'channel_messages',key:id,saved:true})
    purgeUnsavedDiskContent(mediaDirectory,savedMessages)
    for(const suffix of ['','-wal','-shm'])fs.rmSync(path.join(APP_HOME,'cache/message-index.sqlite'+suffix),{force:true})
    run("INSERT INTO metadata VALUES('content_memory_migrated','1')")
   }
   if(!one("SELECT 1 FROM metadata WHERE key='archive_reads_migrated'")){
    for(let offset=0;;offset+=500){const entries=readPersistedReads(offset,500);if(!entries.length)break;await channelStorageRpc('reads-import',{entries})}
    run("INSERT INTO metadata VALUES('archive_reads_migrated','1')")
   }
   await refreshChannelSummaries(true)
   hydrated=true;lastError='';changed('posts',{channelIds:all('SELECT id FROM channels').map(row=>row.id)})
  }catch(error){lastError=(error as Error).message;ready=undefined;throw error}
 })()
}
export async function loadChannelAsset(id:string,maxEdge?:number){
 const key=id+(maxEdge?'@'+maxEdge:''),existing=channelAsset(key)??(!channelStorageSettings()?channelAsset(id):undefined);if(existing)return existing
 const pending=imageRequests.get(key);if(pending)return pending
 const request=(async()=>{
 const row=one('SELECT * FROM media WHERE id=?',id)
 if(row){const saved=one('SELECT id FROM posts WHERE id=? AND saved_at IS NOT NULL',row.post_id),file=path.resolve(mediaDirectory,row.file);if(saved&&(!maxEdge||!channelStorageSettings())&&path.dirname(file)===path.resolve(mediaDirectory)&&fs.existsSync(file)){const asset={data:fs.readFileSync(file),mimeType:row.mime_type};cacheChannelAsset(id,asset.data,asset.mimeType);return asset}}
 const remote=await channelStorageRpc<{data:string;mimeType:string}>('asset-read',{id,...(maxEdge?{maxEdge}:{})}),data=Buffer.from(remote.data,'base64');cacheChannelAsset(key,data,remote.mimeType);return {data,mimeType:remote.mimeType}
 })().finally(()=>imageRequests.delete(key));imageRequests.set(key,request);return request
}
export async function saveChannelContent(id:string){
 const post=one('SELECT * FROM posts WHERE id=?',id);if(!post)throw Error('Unknown channel item')
 if(post.saved_at!==null){
  if(channelStorageSettings())await channelStorageRpc('pin',{table:'posts',key:id,saved:true})
  if(archiveAvatars.has(post.source_id)||one('SELECT 1 FROM source_avatars WHERE source_id=?',post.source_id))await loadChannelSourceAvatar(post.source_id)
  for(const media of all('SELECT * FROM media WHERE post_id=?',id)){const asset=await loadChannelAsset(media.id);const file=path.resolve(mediaDirectory,media.file);if(path.dirname(file)!==path.resolve(mediaDirectory))throw Error('Invalid saved image path');fs.writeFileSync(file,asset.data,{mode:0o600})}
 }
 else if(channelStorageSettings())await channelStorageRpc('pin',{table:'posts',key:id,saved:false})
 persistSavedPost(db(),id,mediaDirectory);await flushChannelContent()
}
export async function saveChannelMessageContent(id:string,saved:boolean){persistSavedChannelMessage(db(),id,saved);if(channelStorageSettings())await channelStorageRpc('pin',{table:'channel_messages',key:id,saved});await flushChannelContent()}
export async function beforeChannelRequest(command:string,args:Record<string,any>){
 if(typeof args.channelId==='string')args.channelId=canonicalChannelId(args.channelId)
 if(!command.startsWith('channel.')||['channel.settings','channel.storage','channel.sources','channel.source-add','channel.source-update','channel.source-remove','channel.collectors','channel.collector-add','channel.collector-revoke','channel.collector-config','channel.subscription-status','channel.list','channel.get','channel.update','channel.create','channel.connection'].includes(command))return
 await ensureChannelContent()
 if(!channelStorageSettings())return
 const id=args.postId??(typeof args.entryId==='string'&&args.entryId.startsWith('np_')?args.entryId:undefined)??(typeof args.id==='string'&&args.id.startsWith('np_')?args.id:undefined)
 if(id)await loadChannelPost(id)
 if(['channel.publish','channel.media-put','channel.media-register'].includes(command)&&args.sourceId&&args.externalId){const id='np_'+createHash('sha256').update(JSON.stringify([args.sourceId,args.externalId])).digest('hex');await loadChannelPost(id)}
 if(command==='channel.source-image')await loadChannelSourceAvatar(args.sourceId)
 if(typeof args.entryId==='string'&&args.entryId.startsWith('cm_'))await loadChannelMessage(args.id,args.entryId)
 if(command==='channel.history'){const page=await channelStorageRpc<any>('history-page',{id:args.id,before:args.before,around:args.around,limit:args.limit??100});acceptArchiveRows(page)}
}
export function resetChannelContent(){ready=undefined;hydrated=false;lastError='';bytes.clear();pendingAssets.clear();byteCount=0;summaryAt=0;archiveSources.clear();archiveAvatars.clear();touched.clear()}

export function invalidateChannelSummaries(){summaryAt=0}
export async function refreshChannelSummaries(force=false){
 // A receipt needs a summary requested after its archive write, not a snapshot
 // which was already in flight before the user read the article.
 if(force&&summaryPending)await summaryPending
 if(!channelStorageSettings()||!force&&Date.now()-summaryAt<5000)return
 return summaryPending??=(async()=>{const nextRoute=all('SELECT id,plugin,channel_id,name FROM sources'),nextKey=createHash('sha256').update(JSON.stringify(nextRoute)).digest('hex');if(nextKey!==routeKey){await channelStorageRpc('configure',{sources:nextRoute});routeKey=nextKey}const result=await channelStorageRpc<any>('summaries');archiveSources.clear();for(const source of result.sources)archiveSources.set(source.sourceId,source);archiveAvatars.clear();for(const avatar of result.avatars)archiveAvatars.set(avatar.sourceId,{...avatar,bytes:avatar.bytes??0});summaryAt=Date.now()})().finally(()=>{summaryPending=undefined})
}
function acceptArchiveRows(value:{rows:{table:string;row:Row}[];readStates?:Row[]}){
 hydrateContent(db(),value.rows.map(value=>({...value,row:unwire(value.row)})))
 for(const item of value.rows)if(item.table==='posts')touched.set(item.row.id,Date.now())
 if(value.readStates?.length)transaction(()=>{for(const row of value.readStates!)run('INSERT INTO channel_user_reads VALUES(?,?) ON CONFLICT(entry_id) DO UPDATE SET read_at=excluded.read_at',row.entry_id,row.read_at)})
}
export async function channelArchivePage(args:Record<string,any>){await ensureChannelContent();const page=await channelStorageRpc<any>('posts-page',args);acceptArchiveRows(page);trimChannelContent(new Set(page.postIds));return page as {postIds:string[];total:number;nextCursor:string|null}}
export async function channelArchiveTimeline(args:Record<string,any>){await ensureChannelContent();const page=await channelStorageRpc<any>('timeline-page',args);acceptArchiveRows(page);trimChannelContent(new Set(page.postIds));return page}
export async function loadChannelPost(id:string){
 if(!channelStorageSettings())return
 if(one('SELECT id FROM posts WHERE id=?',id)){touched.set(id,Date.now());return}
 let request=postRequests.get(id);if(!request){request=channelStorageRpc<any>('post-get',{id}).then(page=>{acceptArchiveRows(page);trimChannelContent(new Set([id]))}).finally(()=>postRequests.delete(id));postRequests.set(id,request)}await request
}
export async function loadChannelMessage(channelId:string,id:string){if(!channelStorageSettings()||one('SELECT 1 FROM channel_messages WHERE id=?',id))return;const page=await channelStorageRpc<any>('history-page',{id:channelId,around:id,limit:1});acceptArchiveRows(page)}
export async function loadChannelSourceAvatar(sourceId:string){
 if(!channelStorageSettings()||one('SELECT 1 FROM source_avatars WHERE source_id=?',sourceId))return
 const page=await channelStorageRpc<any>('avatar-get',{sourceId});acceptArchiveRows(page)
 let total=Number(one('SELECT COALESCE(SUM(length(data)),0) n FROM source_avatars')!.n)
 if(total>8*1024*1024)for(const row of all('SELECT source_id,length(data) n FROM source_avatars WHERE source_id<>? ORDER BY updated_at',sourceId)){if(total<=8*1024*1024)break;if(one("SELECT 1 FROM content_dirty WHERE table_name='source_avatars' AND item_key=?",row.source_id))continue;db().prepare('DELETE FROM source_avatars WHERE source_id=?').run(row.source_id);db().prepare("DELETE FROM content_dirty WHERE table_name='source_avatars' AND item_key=?").run(row.source_id);total-=row.n}
}
export function trimChannelContent(protectedIds=new Set<string>()){
 if(!one("SELECT 1 FROM metadata WHERE key='content_memory_migrated'"))return
 const rows=all('SELECT id,COALESCE(length(CAST(body AS BLOB)),0)+COALESCE(length(CAST(title AS BLOB)),0)+500 AS bytes FROM posts');let bytes=rows.reduce((n,row)=>n+row.bytes,0),count=rows.length
 const drop:string[]=[]
 for(const row of rows.sort((a,b)=>(touched.get(a.id)??0)-(touched.get(b.id)??0))){if(count<=384&&bytes<=8*1024*1024)break;if(protectedIds.has(row.id))continue;drop.push(row.id);touched.delete(row.id);bytes-=row.bytes;count--}
 forgetCachedPosts(db(),drop)
}
