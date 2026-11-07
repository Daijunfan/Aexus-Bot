import {CHANNEL_FILTER_FIELDS,normalizeChannelFilter} from '../shared/channel-filter'
import {appendChannelFilters,validateChannelSources} from './channel-filters'
import {authorize} from './authorization'
import {all,one,postSelect,projectChannelPost,canonicalChannelId,type Row} from './channel-store'
import {channelStorageSettings} from './channel-storage-transport'
import {channelArchivePage,loadChannelAsset} from './channel-content'
import {requireChannelReader} from './channel-access'
import type {ChannelFetchPage,ChannelFetchedMessage} from '../shared/channel-fetch'

const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url')
const fail=(message:string)=>{throw Error(message)}

/** Explicit authorized reads: no save, user receipt, document download or Agent dispatch. */
export async function fetchChannelMessages(command:string,args:Record<string,any>):Promise<ChannelFetchPage>{
 authorize(command,args)
 const searching=command==='channel.search',images=command==='channel.fetch-images'||searching&&args.images===true,limit=args.limit??20
 for(const key of Object.keys(args))if(!['id',...CHANNEL_FILTER_FIELDS,'limit','cursor',...(searching?['query','images']:[])].includes(key))fail('Unknown channel fetch field: '+key)
 const id=typeof args.id==='string'?canonicalChannelId(args.id):fail('Choose a channel ID')
 if(!one('SELECT 1 FROM channels WHERE id=?',id))fail('Unknown news channel')
 requireChannelReader(id)
 if(!Number.isInteger(limit)||limit<1||limit>100)fail('Choose limit 1–100; use nextCursor for more messages')
 if(args.query!==undefined&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>500))fail('Provide search text (1–500 characters)')
 if(searching&&!args.query?.trim()&&!args.keywordsAll?.length&&!args.keywordsAny?.length)fail('Provide query, keywordsAll or keywordsAny')
 if(args.images!==undefined&&typeof args.images!=='boolean')fail('images must be boolean')
 const query=searching&&args.query?.trim()?args.query.trim():null,filter=normalizeChannelFilter(args),filterKey=JSON.stringify(filter)
 validateChannelSources(filter,id)
 let after:[number,string]|undefined
 if(args.cursor!==undefined){
  let value:any;try{value=JSON.parse(Buffer.from(args.cursor,'base64url').toString())}catch{fail('Invalid channel fetch cursor')}
  if(!Array.isArray(value)||value.length!==5||value[0]!==2||value[1]!==id||value[2]!==filterKey||value[3]!==query||!Number.isSafeInteger(value[4]?.[0])||typeof value[4]?.[1]!=='string')fail('Cursor belongs to another channel or search')
  after=value[4]
 }
 let rows:Row[],total:number,more:boolean
 if(channelStorageSettings()){
  const sourceIds=filter.sourceIds??all('SELECT id FROM sources WHERE channel_id=?',id).map(row=>row.id)
  const page=await channelArchivePage({...filter,sourceIds,limit,...(query?{query}:{}),...(after?{cursor:encode(after)}:{})})
  rows=page.postIds.map(postId=>one(postSelect+' WHERE p.id=?',postId)!);total=page.total;more=!!page.nextCursor
 }else{
  const where=["s.channel_id=?","p.state='active'",'(p.saved_at IS NOT NULL OR p.expires_at>?)'],values:any[]=[id,Date.now()]
  appendChannelFilters(where,values,filter)
  if(query){where.push('(instr(lower(p.title),lower(?))>0 OR instr(lower(p.body),lower(?))>0 OR instr(lower(s.name),lower(?))>0)');values.push(query,query,query)}
  total=Number(one('SELECT COUNT(*) n FROM posts p JOIN sources s ON s.id=p.source_id WHERE '+where.join(' AND '),...values)!.n)
  if(after){where.push('(p.published_at<? OR (p.published_at=? AND p.id<?))');values.push(after[0],after[0],after[1])}
  rows=all(postSelect+' WHERE '+where.join(' AND ')+' ORDER BY p.published_at DESC,p.id DESC LIMIT ?',...values,limit+1);more=rows.length>limit;rows=rows.slice(0,limit)
 }
 const messages:ChannelFetchedMessage[]=[];let imageBytes=0,imageCount=0,textBytes=0
 for(const row of rows){
  const post=projectChannelPost(row),message:ChannelFetchedMessage={id:post.id,sourceId:post.sourceId,sourceName:post.sourceName,platform:post.plugin,authorName:post.authorName??post.sourceName,title:post.title,text:post.body,publishedAt:post.publishedAt,...(post.url?{url:post.url}:{}),...(post.files?.length?{files:post.files.map(({savedPath,serverPath,...file})=>file)}:{})}
  const size=Buffer.byteLength(JSON.stringify(message))
  if(textBytes+size>2*1024*1024||images&&imageCount+post.media.length>32){if(messages.length)break;fail('This message exceeds the response budget')}
  if(images){
   message.images=[];let bytes=0
   for(const media of post.media){const asset=await loadChannelAsset(media.id,640);bytes+=asset.data.length;if(imageBytes+bytes>8*1024*1024)break;message.images.push({id:media.id,mimeType:asset.mimeType,data:asset.data.toString('base64')})}
   if(imageBytes+bytes>8*1024*1024){if(messages.length)break;fail('This message exceeds the image response budget; use channel.fetch-text')}
   imageBytes+=bytes;imageCount+=message.images.length
  }
  messages.push(message);textBytes+=size
 }
 const last=messages.at(-1),hasMore=messages.length<rows.length||more
 authorize(command,args);requireChannelReader(id)
 return {kind:'channel-messages',channelId:id,mode:images?'images':'text',messages,limit,total,filters:filter,nextCursor:hasMore&&last?encode([2,id,filterKey,query,[last.publishedAt,last.id]]):null}
}
