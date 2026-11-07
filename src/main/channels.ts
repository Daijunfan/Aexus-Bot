import {CHANNEL_FETCH_APIS} from '../shared/channel-fetch'
import {CHANNEL_FILTER_FIELDS,normalizeChannelFilter} from '../shared/channel-filter'
import {appendChannelFilters,validateChannelSources} from './channel-filters'
import {channelSourceOrder,orderedChannelSources} from './channel-source-order'
import {fetchChannelMessages} from './channel-fetch'
import {requireSavedChannelEntry} from './channel-content-policy'
import {channelAccess,channelReaderIds,canReadChannel,requireChannelReader} from './channel-access'
import {channelMemberIds,channelOffices} from './channel-members'
import {requireConversation} from './conversation-policy'
import {controlChanged} from './conversation-policy'
import {channelDocuments,channelFileStatus,downloadChannelFile} from './channel-files'
import {notifyChannelSchedule,reconcileSchedules} from './scheduler/service'
import {validatedChannelImage,putSourceAvatar,sourceAvatar,readSourceAvatar} from './channel-avatars'
import {channelEngine,validateChannelEngine,storeChannelEngine,syncEmployeeSources,createProcessSource,employeePublishingSource,sourceEmployee,collectorAllowsSource,authorizeSourcePublisher,assertExternalChannel,recordCollectorActivity,channelConnection,putChannelAvatar,customChannelAvatar,readChannelAvatar} from './channel-engines'
import {readStore} from './store'
import type {ChannelEngineInput} from '../shared/channels'
import {updateChannelAdmins,channelAdminIds,freezeChannelNews,deliverChannelNews,channelHistory,channelContext,sendChannelMessage,postChannelMessage,getChannelMessage} from './channel-discussion'
import {channelTimeline} from './channel-timeline'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import type {SQLInputValue} from 'node:sqlite'
import type {ChannelReadSummary,ChannelReadState,ChannelReadEntry,ChannelAcknowledgment} from '../shared/channels'
import {authorize,requestContext,isAppAdministrator,requireAppAdministrator} from './authorization'
import {CHANNEL_PLUGINS,CHANNEL_IMAGE_LIMIT,NEWS_RETENTION_MS,type ChannelSettings,type ChannelRecord,type ChannelSource,type ChannelPost,type ChannelView,type ChannelPostPage,type ChannelMedia,type ChannelSourceInput,type ChannelSourcePatch,type ChannelPublishInput,type ChannelPublishResult,type ChannelMediaInput,type ChannelCollector,type CollectorConfig,type ChannelEvent,type ChannelFileRef} from '../shared/channels'

import {directory,mediaDirectory,db,one,all,run,revision,transaction,changed,closeChannelStore,archiveSources,archiveAvatars,canonicalChannelId,type Row,channelMedia as media,projectChannelPost as projected,postSelect,liveChannelPost as livePost} from './channel-store'
import {collectorReceived,collectorDelivery,acknowledgeSubscriptions,subscriptionStatus} from './channel-subscription-sync'
import {cloudHostTarget} from './cloud-hosts'
import {channelStorageSettings,channelStorageRpc,configureChannelStorage,exchangeChannelStorage,completeChannelStorage} from './channel-storage-transport'
import {beforeChannelRequest,flushChannelContent,cacheChannelAsset,channelAsset,loadChannelAsset,ensureChannelContent,channelArchivePage,channelArchiveTimeline,refreshChannelSummaries,invalidateChannelSummaries,channelContentStatus} from './channel-content'
import {discoveryPosts} from './channel-discovery'
export {setChannelStoreEmitter as setChannelsEmitter} from './channel-store'
let timer:ReturnType<typeof setInterval>|undefined
const fail=(message:string,code='INVALID_CHANNEL_REQUEST',status=400)=>Object.assign(Error(message),{code,status})
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
const postId=(sourceId:string,externalId:string)=>'np_'+hash(JSON.stringify([sourceId,externalId]))
const fields=(value:Record<string,unknown>,allowed:string[])=>{for(const key of Object.keys(value))if(value[key]!==undefined&&!allowed.includes(key))throw fail('Unknown channel field: '+key)}
const text=(value:unknown,label:string,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('Provide a valid '+label);return value.trim()}
const optionalText=(value:unknown,label:string,max=500)=>value===undefined?undefined:text(value,label,max)
const webUrl=(value:unknown)=>{if(value===undefined||value==='')return undefined;const url=new URL(text(value,'HTTP URL',4096));if(!['http:','https:'].includes(url.protocol))throw fail('Use an HTTP or HTTPS URL');return url.href}
const timestamp=(value:unknown,now=Date.now())=>{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>now+300000)throw fail('publishedAt must be Unix milliseconds, not a future date');return Number(value)}
const positive=(value:unknown,label:string)=>{if(!Number.isSafeInteger(value)||Number(value)<1)throw fail('Provide a positive '+label);return Number(value)}
export function getChannelSettings():ChannelSettings{return JSON.parse(one("SELECT value FROM metadata WHERE key='settings'")!.value)}
function settings(patch?:Record<string,unknown>){
 const current=getChannelSettings();if(patch===undefined)return current
 fields(patch,['enabled','port']);if(patch.enabled!==undefined&&typeof patch.enabled!=='boolean')throw fail('enabled must be boolean')
 if(patch.port!==undefined&&(!Number.isInteger(patch.port)||Number(patch.port)<1024||Number(patch.port)>65535))throw fail('Choose a listener port from 1024 to 65535')
 const next={...current,...patch,host:'127.0.0.1' as const};run("UPDATE metadata SET value=? WHERE key='settings'",JSON.stringify(next));changed('settings');return next
}
function channelRow(id:unknown){const row=one('SELECT * FROM channels WHERE id=?',canonicalChannelId(text(id,'channel ID')));if(!row)throw fail('Unknown news channel','CHANNEL_NOT_FOUND',404);return row}
function sourceRow(id:unknown){const row=one('SELECT * FROM sources WHERE id=?',text(id,'source ID'));if(!row)throw fail('Unknown news source','SOURCE_NOT_FOUND',404);return row}
const record=(row:Row):ChannelRecord=>({...channelOffices(row.id),readerIds:channelReaderIds(row.id),id:row.id,name:row.name,kind:row.kind,createdAt:row.created_at,updatedAt:row.updated_at,adminIds:channelAdminIds(row.id),revision:row.revision,engine:channelEngine(row.id)})
const unreadEntries="SELECT p.id,'news' AS kind,p.published_at AS time FROM posts p JOIN sources s ON s.id=p.source_id LEFT JOIN channel_user_reads r ON r.entry_id=p.id WHERE s.channel_id=? AND p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?) AND r.entry_id IS NULL UNION ALL SELECT m.id,'message' AS kind,m.created_at AS time FROM channel_messages m LEFT JOIN channel_user_reads r ON r.entry_id=m.id WHERE m.channel_id=? AND json_extract(m.author,'$.kind')='agent' AND r.entry_id IS NULL"
function readSummary(id:string,now=Date.now()):ChannelReadSummary{if(archiveSources.size){const summaries=all('SELECT id FROM sources WHERE channel_id=?',id).flatMap(row=>archiveSources.has(row.id)?[archiveSources.get(row.id)!]:[]),first=summaries.flatMap(row=>row.firstUnread?[row.firstUnread]:[]).sort((a,b)=>a.published_at-b.published_at||a.id.localeCompare(b.id))[0];return {unreadCount:summaries.reduce((n,row)=>n+row.unread,0),...(first?{firstUnread:{id:first.id,kind:'news' as const}}:{})}}const first=one('SELECT id,kind,COUNT(*) OVER() AS count FROM ('+unreadEntries+') ORDER BY time,id COLLATE BINARY LIMIT 1',id,now,id);return {unreadCount:Number(first?.count??0),...(first?{firstUnread:{id:first.id,kind:first.kind}}:{})}}
function readEntryIds(input:unknown){if(!Array.isArray(input)||input.length>200||input.some(id=>typeof id!=='string'||!id||id!==id.trim()))throw fail('Choose up to 200 channel entry IDs');return [...new Set(input)] as string[]}
/** Resolve current routing and retention without reading bodies or touching Agent receipts. */
function userReadEntry(channelId:string,id:string,now:number){
 const row=id.startsWith('np_')?one("SELECT p.id,s.channel_id,p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?) AS visible,1 AS incoming,r.entry_id AS known,r.read_at FROM posts p JOIN sources s ON s.id=p.source_id LEFT JOIN channel_user_reads r ON r.entry_id=p.id WHERE p.id=?",now,id):one("SELECT m.id,m.channel_id,1 AS visible,json_extract(m.author,'$.kind')='agent' AS incoming,r.entry_id AS known,r.read_at FROM channel_messages m LEFT JOIN channel_user_reads r ON r.entry_id=m.id WHERE m.id=?",id)
 if(!row||!row.visible)return undefined
 if(row.channel_id!==channelId)throw fail('Entry belongs to another channel','CHANNEL_ENTRY_SCOPE_MISMATCH',403)
 return row
}
function channelReadState(args:Record<string,any>):ChannelReadState{
 fields(args,['id','entryIds']);const channel=channelRow(args.id),ids=readEntryIds(args.entryIds),now=Date.now()
 const entries=ids.flatMap((id):ChannelReadEntry[]=>{const row=userReadEntry(channel.id,id,now);if(!row)return [];return [{id,state:!row.incoming?'read':!row.known?'unread':row.read_at===null?'unknown':'read',...(row.incoming&&row.read_at!==null?{readAt:row.read_at}:{})}]})
 return {id:channel.id,entries,...readSummary(channel.id,now)}
}
function acknowledgeChannel(args:Record<string,any>,notify=true,readAt=Date.now()):ChannelAcknowledgment{
 requireAppAdministrator()
 fields(args,['id','entryIds','all','sourceId','sourceIds']);if((args.sourceId!==undefined||args.sourceIds!==undefined)&&args.all!==true)throw fail('Source reading requires explicit all:true');if(args.all!==undefined&&args.all!==true||args.all===true&&args.entryIds!==undefined||args.all===undefined&&args.entryIds===undefined)throw fail('Choose entryIds or all:true')
 const channel=channelRow(args.id),ids=args.all?[]:readEntryIds(args.entryIds),now=readAt,changedIds:string[]=[]
 const selected=normalizeChannelFilter({sourceId:args.sourceId,sourceIds:args.sourceIds});validateChannelSources(selected,channel.id)
 const result=transaction(()=>{
  if(selected.sourceIds){const count=Number(run("INSERT INTO channel_user_reads(entry_id,read_at) SELECT p.id,? FROM posts p LEFT JOIN channel_user_reads r ON r.entry_id=p.id WHERE p.source_id IN (SELECT value FROM json_each(?)) AND p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?) AND p.received_at<=? AND r.entry_id IS NULL",now,JSON.stringify(selected.sourceIds),now,now).changes);return {acknowledged:true as const,id:channel.id,all:true as const,acknowledgedCount:count,...readSummary(channel.id,now)}}
  if(args.all){const count=Number(run('INSERT INTO channel_user_reads(entry_id,read_at) SELECT id,? FROM ('+unreadEntries+") WHERE id NOT IN (SELECT id FROM posts WHERE received_at>?) AND (kind<>'message' OR time<=?)",now,channel.id,now,channel.id,now,now).changes);return {acknowledged:true as const,id:channel.id,all:true as const,acknowledgedCount:count,...readSummary(channel.id,now)}}
  const entries=ids.map(id=>userReadEntry(channel.id,id,now)).filter((row):row is Row=>!!row)
  for(const row of entries)if(row.incoming&&Number(run('INSERT INTO channel_user_reads(entry_id,read_at) VALUES(?,?) ON CONFLICT(entry_id) DO UPDATE SET read_at=excluded.read_at WHERE channel_user_reads.read_at IS NULL',row.id,now).changes))changedIds.push(row.id)
  return {acknowledged:true as const,id:channel.id,entryIds:entries.map(row=>row.id),acknowledgedCount:changedIds.length,...readSummary(channel.id,now)}
 })
 if(notify&&result.acknowledgedCount)changed('reads',{channelIds:[channel.id],...(args.all?{}:{entryIds:changedIds})})
 return result
}
function sourceProfileUrl(row:Row){
 if(row.plugin==='x')return 'https://x.com/'+sourceIdentity('x',row.locator)
 if(row.plugin==='youtube'){const target=sourceIdentity('youtube',row.locator);return 'https://www.youtube.com/'+(target.startsWith('UC')?'channel/'+target:target.startsWith('@')?target:'@'+target)}
 if(row.plugin==='telegram'){if(/^https:\/\/t\.me\//i.test(row.locator))return row.locator;if(/^@?[a-zA-Z_][a-zA-Z0-9_]*$/.test(row.locator))return 'https://t.me/'+row.locator.replace(/^@/,'')}
 return undefined
}
function source(row:Row):ChannelSource{
 const avatar=one("SELECT id,avatar_media_id,author_url FROM posts WHERE source_id=? AND state='active' AND (saved_at IS NOT NULL OR expires_at>?) AND avatar_media_id IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT 1",row.id,Date.now())
 const native=sourceAvatar(row.id)
 return {...(sourceProfileUrl(row)?{authorUrl:sourceProfileUrl(row)}:{}),...(native?{sourceAvatar:{sourceId:row.id,sha256:native.sha256}}:{}),id:row.id,plugin:row.plugin,targetId:row.target_id,locator:row.locator,name:row.name,enabled:!!row.enabled,pollSeconds:row.poll_seconds,channelId:row.channel_id,createdAt:row.created_at,updatedAt:row.updated_at,...(avatar?{avatar:{postId:avatar.id,mediaId:avatar.avatar_media_id},...(avatar.author_url?{authorUrl:avatar.author_url}:{})}:{})}
}
function channelView(row:Row):ChannelView{
 const counts=one("SELECT COUNT(*) AS count,SUM(p.saved_at IS NOT NULL) AS saved FROM posts p JOIN sources s ON s.id=p.source_id WHERE s.channel_id=? AND p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?)",row.id,Date.now())!
 const last=one("SELECT p.id,p.title,p.published_at,p.telegram,s.name FROM posts p JOIN sources s ON s.id=p.source_id WHERE s.channel_id=? AND p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?) ORDER BY p.published_at DESC,p.id DESC LIMIT 1",row.id,Date.now())
 const customAvatar=customChannelAvatar(row.id)
 const avatarSource=row.kind==='telegram'&&Number(one('SELECT COUNT(*) n FROM sources WHERE channel_id=?',row.id)!.n)===1?one("SELECT id FROM sources WHERE channel_id=? AND plugin='telegram' ORDER BY created_at LIMIT 1",row.id):undefined;const nativeAvatar=avatarSource?sourceAvatar(avatarSource.id):undefined;const avatar=avatarSource&&nativeAvatar?{id:avatarSource.id,sha256:nativeAvatar.sha256}:undefined
 const lastMessage=one('SELECT id,text,created_at,author_name,author FROM channel_messages WHERE channel_id=? ORDER BY sequence DESC LIMIT 1',row.id)
 const subscriberCount=last?.telegram?JSON.parse(last.telegram).subscriberCount:undefined
 const remote:Row[]=all('SELECT id,name FROM sources WHERE channel_id=?',row.id).flatMap(src=>{const value=archiveSources.get(src.id);return value?[{...value,name:src.name}]:[]}),latest=remote.filter(value=>value.last).sort((a,b)=>b.last.published_at-a.last.published_at||b.last.id.localeCompare(a.last.id))[0];if(remote.length){counts.count=remote.reduce((n,value)=>n+value.total,0);counts.saved=remote.reduce((n,value)=>n+value.saved,0)}
 const remoteSubscribers=latest?.last.telegram?JSON.parse(latest.last.telegram).subscriberCount:subscriberCount
 return {...(remoteSubscribers!==undefined?{subscriberCount:remoteSubscribers}:{}),...record(row),...readSummary(row.id),...(lastMessage?{lastMessage:{id:lastMessage.id,text:lastMessage.text,createdAt:lastMessage.created_at,authorName:lastMessage.author_name,author:JSON.parse(lastMessage.author)}}:{}),...(customAvatar?{avatar:customAvatar}:avatar?{avatar:{sourceId:avatar.id,sha256:avatar.sha256}}:{}),sourceCount:Number(one('SELECT COUNT(*) AS count FROM sources WHERE channel_id=? AND enabled=1',row.id)!.count),postCount:Number(counts.count),savedCount:Number(counts.saved??0),...(latest?{lastPost:{id:latest.last.id,title:latest.last.title,publishedAt:latest.last.published_at,sourceName:latest.name}}:last?{lastPost:{id:last.id,title:last.title,publishedAt:last.published_at,sourceName:last.name}}:{})}
}
function createChannel(name:string,kind:ChannelRecord['kind']='custom'){
 const now=Date.now(),id='nc_'+randomUUID();run('INSERT INTO channels(id,name,kind,created_at,updated_at) VALUES(?,?,?,?,?)',id,name,kind,now,now);return channelRow(id)
}
function configurePublishingEngine(id:string,input:ChannelEngineInput){
 const previous=channelEngine(id)
 storeChannelEngine(id,input)
 if(input.kind==='employees')return undefined
 const sources=all('SELECT id FROM sources WHERE channel_id=?',id).map(row=>String(row.id))
 if(!sources.length)sources.push(createProcessSource(id,input.name))
 const collectorId=input.collectorId??(previous.kind==='external'?previous.collectorId:undefined)
 const issued=collectorId?undefined:addCollector({name:input.name,sourceIds:sources})
 storeChannelEngine(id,{...input,collectorId:collectorId??issued!.collector.id})
 return issued?{collectorId:issued.collector.id,token:issued.token}:undefined
}
function createConfiguredChannel(args:Record<string,any>){
 fields(args,['name','engine','avatar']);const name=text(args.name,'channel name'),engine=validateChannelEngine(args.engine)
 const result=transaction(()=>{
  const row=createChannel(name),setup=configurePublishingEngine(row.id,engine)
  if(engine.kind==='employees'){run('UPDATE channels SET admin_ids=? WHERE id=?',JSON.stringify(engine.employeeIds),row.id);syncEmployeeSources(row.id)}
  if(args.avatar!==undefined)putChannelAvatar(row.id,args.avatar)
  return {...channelView(channelRow(row.id)),...(setup?{setup}:{})}
 })
 changed('channels',{channelIds:[result.id]});return result
}
function updateConfiguredChannel(args:Record<string,any>){
 fields(args,['id','name','adminIds','engine','avatar','expectedRevision']);const row=channelRow(args.id)
 if(args.expectedRevision!==undefined&&args.expectedRevision!==row.revision)throw Error('Channel changed; reload before saving')
 if(['name','adminIds','engine','avatar'].every(key=>args[key]===undefined))throw fail('Provide a channel name, avatar, engine or administrators')
 const name=args.name===undefined?row.name:text(args.name,'channel name'),engine=args.engine===undefined?undefined:validateChannelEngine(args.engine)
 if(engine?.kind==='employees'&&args.adminIds!==undefined)throw fail('Choose engine employeeIds or adminIds, not both')
 if(args.adminIds!==undefined)throw fail('Channels do not have employee members','CHANNEL_READ_ONLY',403)
 const adminIds=engine?.kind==='employees'?engine.employeeIds:args.adminIds
 const result=transaction(()=>{
  const setup=engine?configurePublishingEngine(row.id,engine):undefined
  if(adminIds!==undefined)updateChannelAdmins(row.id,adminIds,args.expectedRevision)
  run('UPDATE channels SET name=?,updated_at=?,revision=revision+? WHERE id=?',name,Date.now(),adminIds===undefined?1:0,row.id)
  syncEmployeeSources(row.id)
  if(args.avatar!==undefined)putChannelAvatar(row.id,args.avatar)
  return {...channelView(channelRow(row.id)),...(setup?{setup}:{})}
 })
 changed('channels',{channelIds:[row.id]});controlChanged('channel:'+row.id);reconcileSchedules();return result
}
function defaultChannel(plugin:ChannelSourceInput['plugin'],name:string){return one('SELECT * FROM channels WHERE kind=? AND id NOT IN (SELECT alias FROM channel_aliases) ORDER BY created_at LIMIT 1',plugin)??createChannel(plugin==='x'?'X':plugin==='telegram'?'Telegram':'YouTube',plugin)}
async function aggregateChannels(args:Record<string,any>){
 requireAppAdministrator();fields(args,['plugin'])
 if(!CHANNEL_PLUGINS.includes(args.plugin))throw fail('Choose a social platform')
 const rows=all('SELECT * FROM channels WHERE kind=? AND id NOT IN (SELECT alias FROM channel_aliases) ORDER BY created_at,id',args.plugin)
 if(!rows.length)throw fail('This platform has no channel')
 const target=rows.find(row=>{const engine=channelEngine(row.id);return engine.kind==='external'&&engine.fileStorage})??rows[0],engine=channelEngine(target.id),others=rows.filter(row=>row.id!==target.id),readers=[...new Set<string>(rows.flatMap(row=>channelReaderIds(row.id)))]
 for(const row of others){
  const previous=channelEngine(row.id)
  if(channelMemberIds(row.id).length||one('SELECT 1 FROM channel_messages WHERE channel_id=? LIMIT 1',row.id)||one('SELECT 1 FROM channel_post_rules WHERE channel_id=? LIMIT 1',row.id)||one('SELECT 1 FROM sources WHERE channel_id=? AND plugin<>? LIMIT 1',row.id,args.plugin))throw fail('Channel has independent members, discussion or publishing rules; preserve it until those are moved explicitly')
  if(previous.kind!=='external'||engine.kind!=='external'||previous.collectorId!==engine.collectorId)throw fail('Platform channels have different publishing credentials')
 }
 if(channelStorageSettings())for(const row of others){const history=await channelStorageRpc<any>('history-page',{id:row.id,limit:1});if(history.rows.length)throw fail('Channel has retained discussions; move them before consolidating')}
 transaction(()=>{
  run('INSERT INTO channel_read_access VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET employee_ids=excluded.employee_ids',target.id,JSON.stringify(readers))
  for(const row of others){run('UPDATE sources SET channel_id=?,updated_at=? WHERE channel_id=?',target.id,Date.now(),row.id);run('INSERT INTO channel_aliases VALUES(?,?)',row.id,target.id);run('UPDATE channel_aliases SET channel_id=? WHERE channel_id=?',target.id,row.id)}
  run('UPDATE channels SET name=?,revision=revision+1,updated_at=? WHERE id=?',args.plugin==='telegram'?'Telegram':args.plugin==='x'?'X':'YouTube',Date.now(),target.id)
 })
 invalidateChannelSummaries();if(channelStorageSettings())await refreshChannelSummaries(true)
 changed('sources',{channelIds:[target.id,...others.map(row=>row.id)]})
 return {channel:channelView(channelRow(target.id)),aliases:others.map(row=>row.id)}
}
function sourceIdentity(plugin:ChannelSourceInput['plugin'],locator:string){
 const value=locator.trim().replace(/\/+$/,'');if(plugin==='telegram'){const link=value.match(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([a-z\d_]+)(?:\/\d+)?(?:[?#].*)?$/i);if(link&&!['c','joinchat','addlist'].includes(link[1].toLowerCase()))return link[1].toLowerCase();return /^@?[a-z\d_]+$/i.test(value)?value.replace(/^@/,'').toLowerCase():value}
 const url=value.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i),hosts=plugin==='x'?['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com']:['youtube.com','www.youtube.com','m.youtube.com']
 const invalid=()=>fail(plugin==='x'?'Use a valid X author handle or profile URL':'Use a YouTube author handle or channel homepage URL','INVALID_SOURCE_LOCATOR')
 if(url&&!hosts.includes(url[1].toLowerCase()))throw invalid()
 let target=url?(url[2]??'').replace(/^\/|\/+$/g,''):value
 if(plugin==='x'){
  target=target.replace(/^@/,'').toLowerCase()
  if(!/^[a-z\d_]{1,15}$/.test(target)||['home','explore','search','settings','notifications','messages','i','intent','share','login','signup','compose'].includes(target))throw invalid()
  return target
 }
 if(!url&&!value.startsWith('@'))throw invalid()
 target=target.replace(/\/(videos|shorts|streams|featured|about|playlists|community)$/,'')
 const creator=target.match(/^(?:@([\p{L}\p{N}_.-]+)|channel\/(UC[\p{L}\p{N}_-]+)|(?:c\/|user\/)?([\p{L}\p{N}_.-]+))$/u)
 if(!creator||['watch','playlist','shorts','live','feed'].includes(target.toLowerCase()))throw invalid()
 return creator[1]?'@'+creator[1].toLowerCase():creator[2]??target
}
function addSource(args:ChannelSourceInput):ChannelSource{
 fields(args as any,['plugin','targetId','locator','name','enabled','pollSeconds','channelId']);if(!CHANNEL_PLUGINS.includes(args.plugin))throw fail('Use telegram, x or youtube')
 const locator=text(args.locator,'source locator',4096),targetId=optionalText(args.targetId,'target ID',4096)??args.plugin+':'+locator.replace(/\/$/,''),name=optionalText(args.name,'source name')??locator
 if(args.enabled!==undefined&&typeof args.enabled!=='boolean')throw fail('enabled must be boolean')
 const identity=sourceIdentity(args.plugin,locator),existing=one('SELECT * FROM sources WHERE plugin=? AND target_id=?',args.plugin,targetId)??all('SELECT * FROM sources WHERE plugin=?',args.plugin).find(row=>sourceIdentity(args.plugin,row.locator)===identity)
 if(existing){if(sourceIdentity(args.plugin,existing.locator)!==identity)throw fail('An existing source cannot change authors; follow a new source instead','SOURCE_ID_CONFLICT',409);return updateSource(existing.id,{...(args.name!==undefined?{name}:{}),enabled:args.enabled??true,...(args.pollSeconds!==undefined?{pollSeconds:args.pollSeconds}:{}),...(args.channelId?{channelId:args.channelId}:{})})}
 if(one('SELECT id FROM sources WHERE target_id=?',targetId))throw fail('Target ID is already used by another source','SOURCE_ID_CONFLICT',409)
 if(args.channelId)assertExternalChannel(args.channelId)
 const row=transaction(()=>{const channel=args.channelId?channelRow(args.channelId):defaultChannel(args.plugin,name),now=Date.now(),id='ns_'+randomUUID();run('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?,?)',id,args.plugin,targetId,locator,name,Number(args.enabled??true),args.pollSeconds===undefined?{telegram:300,x:3600,youtube:7200}[args.plugin]:positive(args.pollSeconds,'poll interval'),channel.id,now,now);return sourceRow(id)})
 changed('sources',{channelIds:[row.channel_id]});return source(row)
}
function updateSource(id:unknown,patch:ChannelSourcePatch):ChannelSource{
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw fail('Provide a source patch');fields(patch as any,['name','locator','enabled','pollSeconds','channelId']);const row=sourceRow(id)
 if(row.plugin==='employee')throw fail('Manage publishing employees through channel membership, not source settings')
 if(row.plugin==='process'&&(patch.locator!==undefined||patch.channelId!==undefined&&patch.channelId!==row.channel_id))throw fail('A process source keeps its configured identity and channel')
 if(patch.enabled!==undefined&&typeof patch.enabled!=='boolean')throw fail('enabled must be boolean')
 if(patch.locator!==undefined&&sourceIdentity(row.plugin,text(patch.locator,'source locator',4096))!==sourceIdentity(row.plugin,row.locator))throw fail('An existing source cannot change authors; follow a new source instead','SOURCE_ID_CONFLICT',409)
 if(patch.channelId!==undefined){const target=canonicalChannelId(patch.channelId);channelRow(target);assertExternalChannel(target);patch={...patch,channelId:target}}
 run('UPDATE sources SET name=?,enabled=?,poll_seconds=?,channel_id=?,updated_at=? WHERE id=?',patch.name===undefined?row.name:text(patch.name,'source name'),patch.enabled===undefined?row.enabled:Number(patch.enabled),patch.pollSeconds===undefined?row.poll_seconds:positive(patch.pollSeconds,'poll interval'),patch.channelId??row.channel_id,Date.now(),row.id)
 changed('sources',{channelIds:[...new Set([row.channel_id,patch.channelId??row.channel_id])]});return source(sourceRow(row.id))
}
export function getChannelPost(id:unknown):ChannelPost{const row=livePost(id);requireChannelReader(row.channel_id);return projected(row)}
function memberRecord(row:Row):ChannelRecord{const value=record(row);if(value.engine?.kind==='external')value.engine={kind:'external',location:value.engine.location};return value}
export function getChannel(id:unknown):ChannelRecord{const row=channelRow(id);requireChannelReader(row.id);return isAppAdministrator()?channelView(row):memberRecord(row)}
export function listChannels():ChannelRecord[]{const rows=all('SELECT * FROM channels WHERE id NOT IN (SELECT alias FROM channel_aliases) ORDER BY created_at,id'),principal=requestContext().principal;return rows.filter(row=>canReadChannel(row.id,principal)).map(row=>isAppAdministrator(principal)?channelView(row):memberRecord(row))}
function channelReadingContext(args:Record<string,any>){
 fields(args,['id','entryId']);const channel=getChannel(args.id)
 const sources=listChannelSources({channelId:channel.id}).map(row=>({id:row.id,name:row.name,platform:row.plugin,locator:row.locator,authorUrl:row.authorUrl}))
 const selected=args.entryId?getChannelPost(args.entryId):undefined;if(selected&&selected.channelId!==channel.id)throw Error('News item belongs to another channel')
 return {channel,sources,...(selected?{entry:{kind:'news',post:selected}}:{}),reading:{text:'channel.fetch-text',images:'channel.fetch-images',search:'channel.search',sources:'channel.sources',sourceInfo:'channel.source-info',args:{id:channel.id,limit:20},optional:[...CHANNEL_FILTER_FIELDS,'cursor'],maxLimit:100},guidance:'Use channel.sources with query to find authors, then select sourceIds (OR). since/until and timeRanges filter publication time; use ISO timestamps with explicit UTC offsets and [since,until) bounds. timeRanges combines separate days/windows with OR. keywordsAll requires every literal term; keywordsAny requires at least one; excludeKeywords removes matches. Combine groups with AND. Use system.info clock as the Core time/timeZone reference, honor an explicit user timezone, and resolve relative dates and “around 3 PM” using the user’s timezone and state the chosen window. Follow nextCursor with the same filters; do not summarize only the first page. Reading does not save news, mark user reads or start tasks. Secretary can manage all channels without a grant.'}
}
export function listChannelSources(args:{channelId?:string;plugin?:string;includeDisabled?:boolean;query?:string}={}):ChannelSource[]{
 fields(args as any,['channelId','plugin','includeDisabled','query']);const where:string[]=[],values:SQLInputValue[]=[]
 if(args.channelId){requireChannelReader(args.channelId);where.push('channel_id=?');values.push(canonicalChannelId(args.channelId))}
 if(args.plugin){where.push('plugin=?');values.push(args.plugin)}if(!args.includeDisabled)where.push('enabled=1')
 const rows=all('SELECT * FROM sources'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY created_at,id',...values).filter(row=>canReadChannel(row.channel_id))
 const orders=new Map([...new Set(rows.map(row=>String(row.channel_id)))].map(id=>[id,orderedChannelSources(id).sourceIds]))
 return rows.filter(row=>!args.query||[row.name,row.locator,row.target_id,row.plugin].join(' ').toLowerCase().includes(args.query.trim().toLowerCase())).sort((a,b)=>a.channel_id.localeCompare(b.channel_id)||orders.get(a.channel_id)!.indexOf(a.id)-orders.get(b.channel_id)!.indexOf(b.id)).map(source)
}
function sourceInfo(args:Record<string,any>){
 fields(args,['id']);const row=sourceRow(args.id);requireChannelReader(row.channel_id)
 const summary=archiveSources.get(row.id),local=one("SELECT COUNT(*) total,MAX(published_at) last_at FROM posts WHERE source_id=? AND state='active'",row.id)!,latest=summary?.last,telegram=latest?.telegram?JSON.parse(latest.telegram):undefined
 return {...source(row),channelName:channelRow(row.channel_id).name,postCount:Number(summary?.total??local.total),...((latest?.published_at??local.last_at)!==null?{lastPublishedAt:latest?.published_at??local.last_at}:{}),...(telegram?.subscriberCount!==undefined?{subscriberCount:telegram.subscriberCount}:{}),canManage:isAppAdministrator()}
}
export function queryChannelPosts(args:Record<string,any>={}):ChannelPostPage{
 if(!isAppAdministrator())args={...args,saved:true}
 requireAppAdministrator();fields(args,['channelId',...CHANNEL_FILTER_FIELDS,'saved','query','media','links','messageOrder','cursor','offset','limit','order','seed','snapshot','avoidFirst']);const limit=args.limit??50,offset=args.offset??0;if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(offset)||offset<0)throw fail('Invalid news limit or offset')
 const where=["p.state='active'",'(p.saved_at IS NOT NULL OR p.expires_at>?)'],values:SQLInputValue[]=[Date.now()]
 const principal=requestContext().principal;if(!isAppAdministrator(principal)){where.push('s.channel_id IN (SELECT value FROM json_each(?))');values.push(JSON.stringify(all('SELECT id FROM channels').map(row=>String(row.id)).filter(id=>canReadChannel(id,principal))))}
 if(args.channelId!==undefined){channelRow(args.channelId);where.push('s.channel_id=?');values.push(args.channelId)}
 const filter=normalizeChannelFilter(args);validateChannelSources(filter,args.channelId);appendChannelFilters(where,values,filter)
 if(args.saved!==undefined){if(typeof args.saved!=='boolean')throw fail('saved must be boolean');where.push('p.saved_at IS '+(args.saved?'NOT ':'')+'NULL')}
 if(args.media)where.push('json_array_length(p.media_ids)>0')
 if(args.links)where.push("(p.url LIKE 'http%' OR p.body LIKE '%http://%' OR p.body LIKE '%https://%')")
 if(args.messageOrder&&args.cursor)throw fail('Message ordering cannot use a news cursor')
 if(args.query!==undefined){const query=text(args.query,'search text',500);where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");const term='%'+query.replace(/[\\%_]/g,'\\$&')+'%';values.push(term,term,term)}
 if(args.order!==undefined&&!['newest','discovery'].includes(args.order))throw fail('Unknown feed ordering')
 if(args.order==='discovery'){if(typeof args.seed!=='string'||!Number.isSafeInteger(args.snapshot))throw fail('Discovery requires a refresh seed and snapshot');if(args.messageOrder||offset)throw fail('Discovery uses its own refresh cursor');where.push('p.received_at<=?');values.push(args.snapshot);const page=discoveryPosts(all(postSelect+' WHERE '+where.join(' AND '),...values),args,limit);return {posts:page.rows.map(projected),nextCursor:page.nextCursor,total:page.total}}
 const total=Number(one('SELECT COUNT(*) AS count FROM posts p JOIN sources s ON s.id=p.source_id WHERE '+where.join(' AND '),...values)!.count)
 if(args.cursor){if(offset)throw fail('Choose a cursor or offset, not both');let cursor:any;try{cursor=JSON.parse(Buffer.from(args.cursor,'base64url').toString())}catch{throw fail('Invalid news cursor')};if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||typeof cursor[1]!=='string')throw fail('Invalid news cursor');where.push('(p.published_at<? OR (p.published_at=? AND p.id<?))');values.push(cursor[0],cursor[0],cursor[1])}
 const order=args.messageOrder?'p.published_at DESC,s.channel_id ASC,p.id ASC':'p.published_at DESC,p.id DESC',rows=all(postSelect+' WHERE '+where.join(' AND ')+' ORDER BY '+order+' LIMIT ? OFFSET ?',...values,limit+1,offset),page=rows.slice(0,limit),last=page.at(-1)
 return {posts:page.map(projected),nextCursor:!args.messageOrder&&rows.length>limit&&last?Buffer.from(JSON.stringify([last.published_at,last.id])).toString('base64url'):null,total}
}
function expire(row:Row,state:'deleted'|'expired',now=Date.now()){
 run("UPDATE posts SET state=?,title=NULL,body=NULL,url=NULL,author_name=NULL,author_url=NULL,avatar_media_id=NULL,saved_at=NULL,media_ids='[]',forget_at=?,updated_at=? WHERE id=?",state,now+NEWS_RETENTION_MS,now,row.id)
 for(const asset of all('SELECT * FROM media WHERE post_id=?',row.id)){fs.rmSync(path.join(mediaDirectory,asset.file),{force:true});run('DELETE FROM media WHERE id=?',asset.id)}
 run('DELETE FROM channel_user_reads WHERE entry_id=?',row.id)
}
function savePost(id:unknown,saved:unknown){
 if(typeof saved!=='boolean')throw fail('saved must be boolean');const row=livePost(id)
 if(saved)run('UPDATE posts SET saved_at=COALESCE(saved_at,?) WHERE id=?',Date.now(),row.id)
 else{run('UPDATE posts SET saved_at=NULL WHERE id=?',row.id);if(row.expires_at<=Date.now()){expire(row,'expired');changed('posts',{channelIds:[row.channel_id],postIds:[row.id]});return {id:row.id,saved:false,expired:true}}}
 changed('posts',{channelIds:[row.channel_id],postIds:[row.id]});return projected(livePost(row.id))
}
function deletePost(id:unknown){const row=one(postSelect+' WHERE p.id=?',text(id,'post ID'));if(row&&row.state==='active'){expire(row,'deleted');changed('posts',{channelIds:[row.channel_id],postIds:[row.id]})};return {id,deleted:true}}
function activeSource(id:unknown,collector?:ChannelCollector){
 const sourceId=text(id,'source ID'),row=sourceRow(sourceId)
 if(collector){if(!collectorAllowsSource(row,collector))throw fail('Collector cannot publish this source','SOURCE_FORBIDDEN',403)}else authorizeSourcePublisher(row)
 if(!row.enabled)throw fail('Source is disabled; refresh collector configuration','SOURCE_DISABLED',409);return row
}
function publicationSource(args:{sourceId?:string;channelId?:string},collector?:ChannelCollector){
 if((args.sourceId===undefined)===(args.channelId===undefined))throw fail('Choose sourceId or channelId, not both')
 if(args.channelId!==undefined){if(collector)throw fail('Collector publication requires its sourceId','SOURCE_FORBIDDEN',403);return activeSource(employeePublishingSource(args.channelId).id)}
 return activeSource(args.sourceId,collector)
}
function itemState(sourceId:string,externalId:string,publishedAt:number){sourceRow(sourceId);const id=postId(sourceId,externalId),row=one('SELECT * FROM posts WHERE id=?',id),now=Date.now(),expiresAt=Number.MAX_SAFE_INTEGER;if(row&&row.published_at!==publishedAt)throw fail('An existing item cannot change its publishedAt','POST_ID_CONFLICT',409);return {id,row,now,expiresAt}}
function telegramInfo(value:unknown,plugin:string):import('../shared/channels').TelegramPostInfo|undefined{
 if(value===undefined)return undefined
 if(plugin!=='telegram'||!value||typeof value!=='object'||Array.isArray(value))throw fail('Telegram metadata requires a Telegram source')
 const input=value as Record<string,any>;fields(input,['groupId','views','subscriberCount','reactions'])
 if(input.groupId!==undefined&&(typeof input.groupId!=='string'||!/^\d{1,30}$/.test(input.groupId)))throw fail('Invalid Telegram album ID')
 for(const field of ['views','subscriberCount'])if(input[field]!==undefined&&(!Number.isSafeInteger(input[field])||input[field]<0))throw fail('Invalid Telegram count')
 if(input.reactions!==undefined&&(!Array.isArray(input.reactions)||input.reactions.length>32||input.reactions.some((reaction:any)=>!reaction||typeof reaction.emoji!=='string'||reaction.emoji.length>64||!Number.isSafeInteger(reaction.count)||reaction.count<0)))throw fail('Invalid Telegram reactions')
 return input
}
function publish(args:ChannelPublishInput,collector?:ChannelCollector):ChannelPublishResult{
 fields(args as any,['sourceId','channelId','externalId','publishedAt','title','body','url','authorName','authorUrl','avatarMediaId','mediaIds','files','telegram','contentHash']);const src=publicationSource(args,collector),externalId=text(args.externalId,'external item ID',1024),publishedAt=timestamp(args.publishedAt),item=itemState(src.id,externalId,publishedAt)
 if(typeof args.title!=='string'||args.title.length>1000||typeof args.body!=='string'||Buffer.byteLength(args.body)>1024*1024)throw fail('News requires a title up to 1000 characters and a body up to 1 MiB')
 const telegram=telegramInfo(args.telegram,src.plugin);
 const files=channelDocuments(args.files),engine=channelEngine(src.channel_id);if(files.length&&!channelStorageSettings()&&(engine.kind!=='external'||!engine.fileStorage))throw fail('Configure cloud file storage before publishing document metadata');
 const ids=args.mediaIds??[];if(!Array.isArray(ids)||ids.length>16||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw fail('Choose up to 16 unique uploaded images')
 const employeeId=sourceEmployee(src.id),employeeName=employeeId?readStore().sessions.find(card=>card.id===employeeId)?.title:undefined
 if(employeeId&&args.authorName!==undefined&&args.authorName!==employeeName)throw fail('Cannot publish as another author','CHANNEL_PUBLISH_FORBIDDEN',403)
 const title=args.title.trim(),body=args.body,url=webUrl(args.url),authorName=employeeName??optionalText(args.authorName,'author name'),authorUrl=webUrl(args.authorUrl),avatar=optionalText(args.avatarMediaId,'avatar media ID'),payloadHash=hash(JSON.stringify([title,body,url??null,authorName??null,authorUrl??null,avatar??null,ids,...(files.length?[files]:[]),...(telegram?[telegram]:[])])),contentHash=optionalText(args.contentHash,'content hash',128)??payloadHash
 if(!title&&!body.trim()&&!ids.some(id=>id!==avatar)&&!files.length&&!url)throw fail('News requires text, a body image or a source URL')
 const result=(status:ChannelPublishResult['status'],storedHash=contentHash):ChannelPublishResult=>({id:item.id,channelId:src.channel_id,status,contentHash:storedHash,expiresAt:item.expiresAt})
 if(item.row&&['deleted','expired'].includes(item.row.state))return result(item.row.state,item.row.content_hash)
 if(item.row?.state==='active'&&item.row.saved_at===null&&item.expiresAt<=item.now){expire(item.row,'expired');changed('posts',{channelIds:[src.channel_id],postIds:[item.id]});return result('expired',item.row.content_hash)}
 if(item.row?.state==='active'&&item.row.payload_hash===payloadHash&&item.row.content_hash===contentHash)return result('duplicate')
 if(item.expiresAt<=item.now)return result('expired',item.row?.content_hash??contentHash)
 for(const file of files)if(file.thumbnailMediaId&&!ids.includes(file.thumbnailMediaId))throw fail('Document thumbnail must be an uploaded image in this item');
 for(const id of [...ids,...(avatar?[avatar]:[])])if(!one('SELECT id FROM media WHERE id=? AND post_id=? AND source_id=?',id,item.id,src.id))throw fail('Media is not an uploaded image for this source item','MEDIA_SCOPE_MISMATCH',403)
 if(item.row?.content_hash===contentHash&&item.row.payload_hash!==payloadHash)throw fail('Content hash was reused for a different payload','CONTENT_HASH_CONFLICT',409)
 transaction(()=>{run(`INSERT INTO posts(id,source_id,external_id,state,title,body,url,author_name,author_url,avatar_media_id,published_at,received_at,updated_at,expires_at,saved_at,content_hash,payload_hash,media_ids,forget_at) VALUES(?,?,?,'active',?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL)
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,url=excluded.url,author_name=excluded.author_name,author_url=excluded.author_url,avatar_media_id=excluded.avatar_media_id,updated_at=excluded.updated_at,content_hash=excluded.content_hash,payload_hash=excluded.payload_hash,media_ids=excluded.media_ids`,item.id,src.id,externalId,title,body,url??null,authorName??null,authorUrl??null,avatar??null,publishedAt,item.now,item.now,item.expiresAt,contentHash,payloadHash,JSON.stringify(ids));run('UPDATE posts SET remote_files=?,telegram=? WHERE id=?',JSON.stringify(files),telegram?JSON.stringify(telegram):null,item.id);if(!item.row)freezeChannelNews(src.channel_id,item.id,sourceEmployee(src.id))})
 changed('posts',{channelIds:[src.channel_id],postIds:[item.id]});if(!item.row){notifyChannelSchedule(src.channel_id,item.id,sourceEmployee(src.id));deliverChannelNews(src.channel_id,item.id)}return result(item.row?'updated':'created')
}
function mediaPut(args:ChannelMediaInput,collector?:ChannelCollector){
 fields(args as any,['sourceId','channelId','externalId','publishedAt','mediaKey','name','mimeType','data']);const src=publicationSource(args,collector),externalId=text(args.externalId,'external item ID',1024),publishedAt=timestamp(args.publishedAt),item=itemState(src.id,externalId,publishedAt),key=text(args.mediaKey,'media key',1024),name=text(args.name,'image filename',255)
 if(item.row?.state==='deleted')throw fail('News was deleted; do not replay it','POST_DELETED',410)
 if(item.row?.state==='expired'||item.expiresAt<=item.now)throw fail('News is outside the 7-day receive window','POST_EXPIRED',410)
 const {data,sha256,extension}=validatedChannelImage(args),id='nm_'+hash(JSON.stringify([item.id,key,sha256])),old=one('SELECT * FROM media WHERE id=?',id)
 if(old&&channelAsset(id))return {media:media(old),duplicate:true}
 const file=id+'.'+extension;cacheChannelAsset(id,data,args.mimeType,true)
 run('INSERT OR REPLACE INTO media VALUES(?,?,?,?,?,?,?,?,?,?)',id,item.id,src.id,key,name,args.mimeType,data.length,sha256,file,item.expiresAt)
 return {media:media(one('SELECT * FROM media WHERE id=?',id)!),duplicate:false}
}
async function mediaRegister(args:Record<string,any>,collector:ChannelCollector){
 if(collector.id!==channelStorageSettings()?.collectorId||collector.sourceIds!=='all')throw fail('Only the configured archive collector can register server images','SOURCE_FORBIDDEN',403)
 fields(args,['sourceId','externalId','publishedAt','mediaKey','name','mimeType','sha256','bytes'])
 const src=activeSource(args.sourceId,collector),item=itemState(src.id,text(args.externalId,'external item ID',1024),timestamp(args.publishedAt)),key=text(args.mediaKey,'media key',1024),name=text(args.name,'image filename',255),extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[args.mimeType]
 if(!extension||!Number.isSafeInteger(args.bytes)||args.bytes<1||args.bytes>8*1024*1024||typeof args.sha256!=='string'||!/^[a-f0-9]{64}$/.test(args.sha256)||/[\\/\x00-\x1f]/.test(name))throw fail('Invalid server image metadata')
 if(item.row?.state==='deleted')throw fail('News was deleted; do not replay it','POST_DELETED',410)
 const id='nm_'+hash(JSON.stringify([item.id,key,args.sha256])),old=one('SELECT * FROM media WHERE id=?',id)
 if(old)return {media:media(old),duplicate:true}
 const linked=await channelStorageRpc<{missing:string[]}>('assets-import',{verifyImage:true,assets:[{id,sha256:args.sha256,bytes:args.bytes,mimeType:args.mimeType}]})
 if(linked.missing.length)throw fail('The original server image was not found or failed verification','SOURCE_ASSET_MISSING',409)
 run('INSERT OR REPLACE INTO media VALUES(?,?,?,?,?,?,?,?,?,?)',id,item.id,src.id,key,name,args.mimeType,args.bytes,args.sha256,id+'.'+extension,Number.MAX_SAFE_INTEGER)
 return {media:media(one('SELECT * FROM media WHERE id=?',id)!),duplicate:false}
}
function collectorRecord(row:Row):ChannelCollector{return {id:row.id,name:row.name,sourceIds:JSON.parse(row.source_ids),createdAt:row.created_at,...(row.revoked_at!==null?{revokedAt:row.revoked_at}:{})}}
function addCollector(args:Record<string,any>):{collector:ChannelCollector;token:string}{
 fields(args,['name','sourceIds','channelId']);const name=text(args.name,'collector name')
 if(args.channelId!==undefined){
  if(args.sourceIds!==undefined)throw fail('Choose channelId or sourceIds, not both')
  const channel=channelRow(args.channelId);assertExternalChannel(channel.id)
  const result=transaction(()=>{const sources=all('SELECT id FROM sources WHERE channel_id=?',channel.id).map(row=>String(row.id));if(!sources.length)sources.push(createProcessSource(channel.id,name));const issued=addCollector({name,sourceIds:sources}),engine=channelEngine(channel.id);if(engine.kind!=='external')throw fail('Choose an external channel');storeChannelEngine(channel.id,{...engine,collectorId:issued.collector.id});run('UPDATE channels SET revision=revision+1,updated_at=? WHERE id=?',Date.now(),channel.id);return issued})
  changed('channels',{channelIds:[channel.id]});return result
 }
 const sourceIds=args.sourceIds??'all';if(sourceIds!=='all'&&(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.some((id:unknown)=>typeof id!=='string')))throw fail('Choose all or explicit source IDs')
 if(sourceIds!=='all')for(const id of sourceIds)if(sourceRow(id).plugin==='employee')throw fail('Collector credentials cannot include employee publishing sources')
 const id='ncc_'+randomUUID(),token='news_'+randomBytes(32).toString('hex');run('INSERT INTO collectors VALUES(?,?,?,?,?,NULL)',id,name,hash(token),JSON.stringify(sourceIds==='all'?'all':[...new Set(sourceIds)]),Date.now());return {collector:collectorRecord(one('SELECT * FROM collectors WHERE id=?',id)!),token}
}
function authenticateCollector(token:unknown):ChannelCollector{if(typeof token!=='string'||token.length>512)throw fail('Invalid collector token','COLLECTOR_UNAUTHORIZED',401);const row=one('SELECT * FROM collectors WHERE token_hash=? AND revoked_at IS NULL',hash(token));if(!row)throw fail('Invalid or revoked collector token','COLLECTOR_UNAUTHORIZED',401);return collectorRecord(row)}
function collectorConfig(args:Record<string,any>,collector?:ChannelCollector):CollectorConfig{
 fields(args,['sinceRevision']);const current=revision('config_revision');if(args.sinceRevision!==undefined&&!Number.isSafeInteger(args.sinceRevision))throw fail('Invalid configuration revision')
 if(args.sinceRevision===current&&(!collector||(collectorDelivery(collector.id)??-1)>=current))return {revision:current,changed:false}
 if(collector)collectorReceived(collector.id,current)
 return {revision:current,changed:true,targets:all('SELECT * FROM sources ORDER BY created_at,id').filter(row=>row.plugin!=='employee'&&(!collector||collectorAllowsSource(row,collector))).map(row=>({...(channelEngine(row.channel_id).kind==='external'&&(channelEngine(row.channel_id) as import('../shared/channels').ChannelEngineInput&{fileStorage?:unknown}).fileStorage?{collectFiles:true}:{}),sourceId:row.id,targetId:row.target_id,plugin:row.plugin,locator:row.locator,name:row.name,enabled:!!row.enabled,pollSeconds:row.poll_seconds}))}
}
/** This capability never becomes an operator/employee principal or enters the general dispatcher. */
export async function channelCollectorRequest(token:unknown,command:string,args:Record<string,any>={}){
 const collector=authenticateCollector(token)
 const execute=()=>{
 if(command==='channel.collector-config')return collectorConfig(args,collector)
 if(command==='channel.collector-ack')return acknowledgeSubscriptions(collector,args)
 if(command==='channel.storage-exchange')return exchangeChannelStorage(collector,args)
 if(command==='channel.storage-result')return completeChannelStorage(collector,args)
 if(command==='channel.media-put')return mediaPut(args as ChannelMediaInput,collector)
 if(command==='channel.media-register')return mediaRegister(args,collector)
 if(command==='channel.publish')return publish(args as ChannelPublishInput,collector)
 if(command==='channel.source-avatar-put'){fields(args,['sourceId','name','mimeType','data']);const src=activeSource(args.sourceId,collector),before=sourceAvatar(src.id),result=putSourceAvatar(args as any);if(before?.sha256!==result.sha256)changed('avatars',{channelIds:[src.channel_id]});return result}
 throw fail('Collector tokens only permit source configuration reads and news/image submission','COLLECTOR_FORBIDDEN',403)
 }
 if(!['channel.storage-exchange','channel.storage-result','channel.collector-config','channel.collector-ack'].includes(command))await beforeChannelRequest(command,args)
 const result=await execute();recordCollectorActivity(collector.id);if(!['channel.storage-exchange','channel.storage-result','channel.collector-config','channel.collector-ack'].includes(command))await flushChannelContent();return result
}

/** Archive IO stays asynchronous; the existing dispatcher retains local/fixture compatibility. */
export async function channelOperation(command:string,args:Record<string,any>={}){
 if(CHANNEL_FETCH_APIS.has(command))return fetchChannelMessages(command,args)
 if(command==='channel.aggregate')return aggregateChannels(args)
 if(command==='channel.source-info')await ensureChannelContent()
 args={...args,...(typeof args.id==='string'?{id:canonicalChannelId(args.id)}:{}),...(typeof args.channelId==='string'?{channelId:canonicalChannelId(args.channelId)}:{})}
 if(!channelStorageSettings())return channelRequest(command,args)
 if(['channel.list','channel.get','channel.sources'].includes(command)){await ensureChannelContent();await refreshChannelSummaries();return channelRequest(command,args)}
 if(command==='channel.read-state'){
  requireAppAdministrator();fields(args,['id','entryIds']);channelRow(args.id);const ids=readEntryIds(args.entryIds);await ensureChannelContent()
  const sources=all('SELECT id FROM sources WHERE channel_id=?',args.id),states=await channelStorageRpc<{entries:ChannelReadEntry[]}>('read-states',{ids:ids.filter(id=>id.startsWith('np_')),sourceIds:sources.map(row=>row.id)})
  const local=channelReadState({...args,entryIds:ids.filter(id=>!id.startsWith('np_'))})
  return {...local,entries:[...states.entries,...local.entries]}
 }
 if(command==='channel.acknowledge'){
  requireAppAdministrator()
  fields(args,['id','entryIds','all','sourceId','sourceIds']);channelRow(args.id)
  if((args.sourceId!==undefined||args.sourceIds!==undefined)&&args.all!==true||args.all!==undefined&&args.all!==true||args.all===true&&args.entryIds!==undefined||args.all===undefined&&args.entryIds===undefined)throw fail('Choose entryIds or all:true')
  const selected=normalizeChannelFilter({sourceId:args.sourceId,sourceIds:args.sourceIds});validateChannelSources(selected,args.id)
  const ids=args.all?[]:readEntryIds(args.entryIds);await ensureChannelContent()
  const previous=readSummary(args.id),stamp=Date.now()
  if(args.all){
   const sources=all('SELECT id FROM sources WHERE channel_id=?'+(selected.sourceIds?' AND id IN (SELECT value FROM json_each(?))':''),args.id,...(selected.sourceIds?[JSON.stringify(selected.sourceIds)]:[]))
   const marked=await channelStorageRpc<{marked:number}>('read-mark',{all:true,sourceIds:sources.map(row=>row.id),readAt:stamp})
   acknowledgeChannel(args,false,stamp);invalidateChannelSummaries();await refreshChannelSummaries(true)
   if(marked.marked||previous.unreadCount!==readSummary(args.id).unreadCount)changed('reads',{channelIds:[args.id]})
   return {acknowledged:true,id:args.id,all:true,acknowledgedCount:marked.marked,...readSummary(args.id)}
  }
  const states=await channelOperation('channel.read-state',{id:args.id,entryIds:ids}) as ChannelReadState,accepted=states.entries.filter(row=>row.state!=='read')
  await channelStorageRpc('read-mark',{entries:accepted.map(row=>({entry_id:row.id,read_at:stamp}))})
  transaction(()=>{for(const row of accepted)run('INSERT INTO channel_user_reads VALUES(?,?) ON CONFLICT(entry_id) DO UPDATE SET read_at=excluded.read_at',row.id,stamp)})
  invalidateChannelSummaries();await refreshChannelSummaries(true)
  if(accepted.length||previous.unreadCount!==readSummary(args.id).unreadCount)changed('reads',{channelIds:[args.id],entryIds:states.entries.map(row=>row.id)})
  return {acknowledged:true,id:args.id,entryIds:states.entries.map(row=>row.id),acknowledgedCount:accepted.length,...readSummary(args.id)}
 }
 if(command==='channel.timeline'){
  fields(args,['id','limit','cursor','beforeEntry','kind']);requireChannelReader(args.id)
  const page=await channelArchiveTimeline({...args,sourceIds:all('SELECT id FROM sources WHERE channel_id=?',args.id).map(row=>row.id)})
  return {entries:page.entries.map((entry:any)=>{if(entry.kind==='message')return {...entry,message:getChannelMessage(args.id,entry.id)};const {saved:_,savedAt:__,...post}=getChannelPost(entry.id);return {...entry,post}}),nextCursor:page.nextCursor,order:page.order}
 }
 if(command==='channel.posts'){
  requireAppAdministrator();fields(args,['channelId',...CHANNEL_FILTER_FIELDS,'saved','query','media','links','messageOrder','cursor','offset','limit','order','seed','snapshot','avoidFirst'])
  const limit=args.limit??50,offset=args.offset??0
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||args.saved!==undefined&&typeof args.saved!=='boolean'||args.query!==undefined&&(typeof args.query!=='string'||args.query.length>500)||args.order!==undefined&&!['newest','discovery'].includes(args.order))throw fail('Invalid archive page')
  if(args.channelId)channelRow(args.channelId);if(args.sourceId)sourceRow(args.sourceId)
  const filter=normalizeChannelFilter(args);validateChannelSources(filter,args.channelId)
  const principal=requestContext().principal,sources=all('SELECT id,channel_id FROM sources').filter(row=>(!args.channelId||row.channel_id===args.channelId)&&(!filter.sourceIds||filter.sourceIds.includes(row.id))&&canReadChannel(row.channel_id,principal))
  const page=await channelArchivePage({...args,...filter,limit,offset,...(!isAppAdministrator(principal)?{saved:true}:{}),sourceIds:sources.map(row=>row.id)})
  const posts=page.postIds.map(id=>getChannelPost(id)).map(post=>(post.body?.length??0)>4096?{...post,body:post.body.slice(0,4096),bodyTruncated:true}:post)
  return {posts,total:page.total,nextCursor:page.nextCursor}
 }
 await beforeChannelRequest(command,args)
 const result=channelRequest(command,args)
 if(command==='channel.storage'&&!args.patch)return {...result,memory:channelContentStatus(),capacity:await channelStorageRpc('capacity-status')}
 if(['channel.source-add','channel.source-update','channel.source-remove'].includes(command)){invalidateChannelSummaries();void refreshChannelSummaries().catch(()=>{})}
 return result
}
/** The Messenger merge retains its existing ordering while archive reads remain paged. */
export async function queryChannelPostPrefix(args:Record<string,any>){
 if(!channelStorageSettings())return queryChannelPosts(args)
 const wanted=args.limit??50,posts:ChannelPost[]=[],snapshot=Date.now();let total=0
 while(posts.length<wanted){const page=await channelOperation('channel.posts',{...args,snapshot,limit:Math.min(100,wanted-posts.length),offset:posts.length}) as ChannelPostPage;total=page.total;if(!page.posts.length)break;posts.push(...page.posts);if(posts.length>=total)break}
 return {posts,total,nextCursor:null}
}
export function channelFileEndpoint(ref:Partial<ChannelFileRef>):import('./transfers').FileEndpoint&{name:string;mimeType:string;bytes:number}{
 const parts=ref.path?.split('/'),id=ref.postId??parts?.[0],mediaId=ref.mediaId??parts?.[1],post=livePost(id);ref={...ref,channelId:canonicalChannelId(String(ref.channelId))};requireChannelReader(channelRow(ref.channelId).id)
 if(post.channel_id!==ref.channelId||!mediaId||!(JSON.parse(post.media_ids).includes(mediaId)||post.avatar_media_id===mediaId))throw fail('Image is not published in this channel item','MEDIA_SCOPE_MISMATCH',403)
 const asset=one('SELECT * FROM media WHERE id=? AND post_id=?',mediaId,post.id);if(!asset)throw fail('News image is unavailable','MEDIA_NOT_FOUND',404)
 requireChannelReader(post.channel_id)
 const storage=channelStorageSettings();if(post.saved_at===null&&storage){const remote=cloudHostTarget(storage.hostId,storage.directory);return {root:remote.directory,path:'assets/'+hash(asset.id),remote,name:asset.name,mimeType:asset.mime_type,bytes:asset.bytes}}
 // Unsaved local news images live only in the bounded RAM cache. An explicit
 // download can stream them without first writing a hidden Mac disk copy.
 const read=post.saved_at===null?async(operation:string,args:Record<string,any>)=>{
  const current=livePost(id);requireChannelReader(current.channel_id)
  if(args.path!==asset.file)throw Error('Choose the published channel image')
  if(operation==='copy-info')return {exists:true,directory:false,regular:true,symlink:false,bytes:asset.bytes,modifiedAt:asset.expires_at,mode:0o600}
  if(!Number.isSafeInteger(args.offset)||args.offset<0||!Number.isInteger(args.length)||args.length<1||args.length>262144)throw Error('Invalid image download range')
  const data=(await loadChannelAsset(asset.id)).data.subarray(args.offset,args.offset+args.length)
  return {data:data.toString('base64'),bytes:data.length}
 }:undefined
 return {root:mediaDirectory,path:asset.file,name:asset.name,mimeType:asset.mime_type,bytes:asset.bytes,...(read?{read}:{})}
}
export function channelRequest(command:string,args:Record<string,any>={}){
 authorize(command,args)
 if(['channel.message-send','channel.message-post'].includes(command))throw fail('Channels are read-only feeds; use group chat for discussion','CHANNEL_READ_ONLY',403)
 if(['channel.publish','channel.media-put'].includes(command)&&(!isAppAdministrator()||args.channelId))throw fail('Only external collectors publish channel content','CHANNEL_READ_ONLY',403)
 if(!isAppAdministrator()&&['channel.history','channel.timeline'].includes(command))requireChannelReader(args.id)
 if(command==='channel.timeline')return channelTimeline(args)
 if(command==='channel.sources')return listChannelSources(args)
 if(command==='channel.source-info')return sourceInfo(args)
 if(command==='channel.source-order'){fields(args,['id','sourceIds','expectedRevision']);return channelSourceOrder(args as any)}
 switch(command){case 'channel.list':fields(args,[]);return listChannels();case 'channel.get':fields(args,['id']);return getChannel(args.id);case 'channel.history':return channelHistory(args);case 'channel.context':return channelReadingContext(args);case 'channel.message-send':return sendChannelMessage(args);case 'channel.message-post':return postChannelMessage(args)}
 if(command==='channel.publish')return publish(args as ChannelPublishInput)
 if(command==='channel.media-put')return mediaPut(args as ChannelMediaInput)
 if(command==='channel.post'){fields(args,['id']);return getChannelPost(args.id)}
 requireAppAdministrator()
 switch(command){
  case 'channel.access':fields(args,['id','employeeIds','expectedRevision']);return channelAccess(args as any)
  case 'channel.file-download':fields(args,['postId','fileId']);return downloadChannelFile(text(args.postId,'post ID'),text(args.fileId,'file ID'))
  case 'channel.file-status':fields(args,['postId','fileId']);return channelFileStatus(text(args.postId,'post ID'),text(args.fileId,'file ID'))
  case 'channel.connection':fields(args,['id']);channelRow(args.id);return channelConnection(args.id,getChannelSettings())
  case 'channel.avatar-image':fields(args,['id']);channelRow(args.id);return readChannelAvatar(args.id)
  case 'channel.read-state':return channelReadState(args)
  case 'channel.acknowledge':return acknowledgeChannel(args)
  case 'channel.settings':fields(args,['patch']);return settings(args.patch)
  case 'channel.sources':return listChannelSources(args)
  case 'channel.aggregate':throw fail('Use the asynchronous channel dispatcher')
  case 'channel.create':return createConfiguredChannel(args)
  case 'channel.update':return updateConfiguredChannel(args)
  case 'channel.source-add':return addSource(args as ChannelSourceInput)
  case 'channel.source-update':fields(args,['id','patch']);return updateSource(args.id,args.patch)
  case 'channel.source-remove':fields(args,['id']);return updateSource(args.id,{enabled:false})
  case 'channel.posts':fields(args,['channelId',...CHANNEL_FILTER_FIELDS,'saved','query','cursor','limit','order','seed','snapshot','avoidFirst']);if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100))throw fail('News page limit must be 1–100');return queryChannelPosts(args)
  case 'channel.post':fields(args,['id']);return getChannelPost(args.id)
  case 'channel.save':fields(args,['id','saved']);return savePost(args.id,args.saved)
  case 'channel.delete':fields(args,['id']);return deletePost(args.id)
  case 'channel.collector-add':return addCollector(args)
  case 'channel.collectors':fields(args,[]);return all('SELECT * FROM collectors ORDER BY created_at,id').map(collectorRecord)
  case 'channel.collector-revoke':fields(args,['id']);{const id=text(args.id,'collector ID');run('UPDATE collectors SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',Date.now(),id);changed('sources');return {id,revoked:true}}
  case 'channel.collector-config':return collectorConfig(args)
  case 'channel.collector-ack':throw fail('Only a collector capability can acknowledge applied subscriptions','COLLECTOR_REQUIRED',403)
  case 'channel.subscription-status':return subscriptionStatus(args)
  case 'channel.storage':fields(args,['patch']);return configureChannelStorage(args.patch)
  case 'channel.storage-exchange':case 'channel.storage-result':throw fail('Storage transport requires its dedicated collector capability','COLLECTOR_REQUIRED',403)
  case 'channel.media-put':return mediaPut(args as ChannelMediaInput)
  case 'channel.media-register':throw fail('Server image registration requires its archive collector capability','COLLECTOR_REQUIRED',403)
  case 'channel.source-image':fields(args,['sourceId','maxEdge']);sourceRow(args.sourceId);return readSourceAvatar(args.sourceId)
  case 'channel.source-avatar-put':{fields(args,['sourceId','name','mimeType','data']);const src=activeSource(args.sourceId),before=sourceAvatar(src.id),result=putSourceAvatar(args as any);if(before?.sha256!==result.sha256)changed('avatars',{channelIds:[src.channel_id]});return result}
  case 'channel.publish':return publish(args as ChannelPublishInput)
  default:throw fail('Unknown channel operation')
 }
}
/** Only local channel storage is reclaimed; collector/remote retention is never changed. */
export function pruneChannelNews(now=Date.now()){
 if(channelStorageSettings()&&!one("SELECT value FROM metadata WHERE key='content_memory_migrated'"))return {expired:0}
 const expired=all("SELECT p.*,s.channel_id FROM posts p JOIN sources s ON s.id=p.source_id WHERE p.state='active' AND p.saved_at IS NULL AND p.expires_at<=?",now)
 for(const row of expired)expire(row,'expired',now)
 for(const asset of all('SELECT m.*,p.state,p.saved_at,p.expires_at AS post_expiry,p.media_ids,p.avatar_media_id FROM media m LEFT JOIN posts p ON p.id=m.post_id')){
  const referenced=asset.state==='active'&&(asset.saved_at!==null||asset.post_expiry>now)&&(JSON.parse(asset.media_ids).includes(asset.id)||asset.avatar_media_id===asset.id)
  if(!referenced&&asset.expires_at<=now){fs.rmSync(path.join(mediaDirectory,asset.file),{force:true});run('DELETE FROM media WHERE id=?',asset.id)}
 }
 run("DELETE FROM posts WHERE state IN ('deleted','expired') AND forget_at<=?",now)
 run("DELETE FROM channel_deliveries WHERE kind='news' AND NOT EXISTS(SELECT 1 FROM posts WHERE posts.id=channel_deliveries.entry_id)")
 run("DELETE FROM channel_user_reads WHERE NOT EXISTS(SELECT 1 FROM posts p WHERE p.id=channel_user_reads.entry_id AND p.state='active' AND (p.saved_at IS NOT NULL OR p.expires_at>?)) AND NOT EXISTS(SELECT 1 FROM channel_messages m WHERE m.id=channel_user_reads.entry_id)",now)
 const known=new Set(all('SELECT file FROM media').map(row=>row.file));for(const name of fs.readdirSync(mediaDirectory))if(!known.has(name))fs.rmSync(path.join(mediaDirectory,name),{force:true})
 if(expired.length){db().exec('PRAGMA wal_checkpoint(TRUNCATE)');changed('posts',{channelIds:[...new Set(expired.map(row=>row.channel_id))]})}
 return {expired:expired.length}
}
export function startChannels(){db();pruneChannelNews();if(!timer){timer=setInterval(()=>{try{pruneChannelNews()}catch(error){console.error('[Channels cleanup]',(error as Error).message)}},60000);timer.unref()}}
export function closeChannels(){if(timer)clearInterval(timer);timer=undefined;closeChannelStore()}
