// Real isolated Core over the authenticated socket/CLI: synthetic news, deterministic employee
// engines, channel search filters, source order and persistence boundaries. No model/network calls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore(),checks=[]
const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+(value.error??'rejected'));return value.data}
const deny=async(cmd,args,token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' unexpectedly allowed');return String(value.error)}
const ids=page=>page.messages.map(message=>message.id)
const sameIds=(left,right)=>assert.deepEqual([...new Set(left)].sort(),[...new Set(right)].sort())
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 const at={
  d2:Date.parse('2026-11-02T15:00:00+08:00'),
  d3Start:Date.parse('2026-11-03T14:30:00+08:00'),
  d3Before:Date.parse('2026-11-03T14:29:59+08:00'),
  d3Late:Date.parse('2026-11-03T15:29:59+08:00'),
  d3End:Date.parse('2026-11-03T15:30:00+08:00'),
  d4Start:Date.parse('2026-11-04T14:30:00+08:00'),
  d4Inside:Date.parse('2026-11-04T14:45:00+08:00'),
  d4Late:Date.parse('2026-11-04T15:00:00+08:00'),
  d4LatePlus:Date.parse('2026-11-04T15:10:00+08:00'),
  d4End:Date.parse('2026-11-04T15:30:00+08:00'),
  d4After:Date.parse('2026-11-04T15:45:00+08:00'),
  youtube:Date.parse('2026-11-04T16:00:00+08:00')
 }
 await rpc('group.add',{name:'Filter readers'})
 const employee=await f.create('Filter reader','Filter readers','employee'),secretary=await f.create('Filter Secretary','Filter readers','secretary')
 const employeeToken=await f.token(employee.id),secretaryToken=await f.token(secretary.id)
 const telegramA=await rpc('channel.source-add',{plugin:'telegram',locator:'@zaihua',name:'在花频道'})
 const telegramB=await rpc('channel.source-add',{plugin:'telegram',locator:'@lingyi',name:'另一频道'})
 const youtube=await rpc('channel.source-add',{plugin:'youtube',targetId:'@videofeed',locator:'@videofeed',name:'视频频道'})
 const telegramId=telegramA.channelId
 assert.equal(telegramB.channelId,telegramId,'two Telegram authors share one aggregate channel')
 assert.notEqual(youtube.channelId,telegramId)
 let access=await rpc('channel.access',{id:telegramId})
 access=await rpc('channel.access',{id:telegramId,employeeIds:[employee.id],expectedRevision:access.revision})
 assert.deepEqual(access.employeeIds,[employee.id])
 assert.deepEqual((await rpc('channel.list',{},employeeToken)).map(channel=>channel.id),[telegramId])
 assert.match(await deny('channel.fetch-text',{id:youtube.channelId},employeeToken),/Channel access required/)
 pass('Only the ordinary employee is granted the Telegram channel; the YouTube channel stays outside their reading scope')

 const publish=(sourceId,externalId,publishedAt,title,body)=>rpc('channel.publish',{sourceId,externalId,publishedAt,title,body})
 const aStart=await publish(telegramA.id,'tg-a-start',at.d3Start,'OpenAI 金融快讯','模型与市场，窗口起点')
 const aLate=await publish(telegramA.id,'tg-a-late',at.d3Late,'OpenAI 经济观察','市场动态')
 const aEnd=await publish(telegramA.id,'tg-a-end',at.d3End,'OpenAI 金融 广告','广告内容')
 const bBefore=await publish(telegramB.id,'tg-b-before',at.d3Before,'OpenAI 金融早报','窗口之前')
 const bStart=await publish(telegramB.id,'tg-b-start',at.d4Start,'OpenAI 金融晨报','经济数据')
 const bAd=await publish(telegramB.id,'tg-b-ad',at.d4Inside,'OpenAI 金融速递','这是一条广告推广')
 const aAny=await publish(telegramA.id,'tg-a-any',at.d4Late,'OpenAI 经济要闻','宏观信息')
 const aNoAll=await publish(telegramA.id,'tg-a-noall',at.d4LatePlus,'金融市场观察','只有经济词汇，没有模型公司')
 const bEnd=await publish(telegramB.id,'tg-b-end',at.d4End,'OpenAI 金融晚报','窗口端点不含')
 const bAfter=await publish(telegramB.id,'tg-b-after',at.d4After,'OpenAI 金融盘后','窗口之后')
 const aOld=await publish(telegramA.id,'tg-a-old',at.d2,'OpenAI 金融旧闻','经济')
 const telegramPosts=[aStart,aLate,aEnd,bBefore,bStart,bAd,aAny,aNoAll,bEnd,bAfter,aOld]
 assert.equal(new Set(telegramPosts.map(post=>post.id)).size,telegramPosts.length)
 assert.ok(telegramPosts.every(post=>post.channelId===telegramId&&post.status==='created'))
 const readBefore=await rpc('channel.read-state',{id:telegramId,entryIds:telegramPosts.map(post=>post.id)})

 const window3={since:'2026-11-03T14:30:00+08:00',until:'2026-11-03T15:30:00+08:00'}
 const window4={since:'2026-11-04T14:30:00+08:00',until:'2026-11-04T15:30:00+08:00'}
 const composite={timeRanges:[window3,window4],keywordsAll:['OpenAI'],keywordsAny:['金融','经济'],excludeKeywords:['广告']}
 const expected=[aAny.id,bStart.id,aLate.id,aStart.id]
 const found=await rpc('channel.search',{id:telegramId,...composite,limit:100},employeeToken)
 assert.equal(found.total,expected.length)
 assert.deepEqual(ids(found),expected)
 assert.deepEqual(found.filters.keywordsAll,['openai'])
 assert.deepEqual(found.filters.keywordsAny,['金融','经济'].sort())
 assert.deepEqual(found.filters.excludeKeywords,['广告'])
 assert.equal(found.filters.timeRanges.length,2)
 for(const message of found.messages){
  const text=(message.title+'\n'+message.text).toLowerCase()
  assert.ok(text.includes('openai')&&(text.includes('金融')||text.includes('经济'))&&!text.includes('广告'))
 }
 assert.ok(ids(found).includes(aStart.id),'exact start is included')
 assert.ok(!ids(found).includes(bEnd.id),'exact end is excluded')
 assert.ok(!ids(found).includes(bBefore.id)&&!ids(found).includes(bAd.id)&&!ids(found).includes(bAfter.id)&&!ids(found).includes(aOld.id))
 pass('channel.search without query honors keywordsAll/keywordsAny/excludeKeywords and OR-ed multi-day [since,until) ranges with exact IDs and total')

 const onlyA=await rpc('channel.search',{id:telegramId,...composite,sourceId:telegramA.id,limit:100},employeeToken)
 const onlyB=await rpc('channel.search',{id:telegramId,...composite,sourceId:telegramB.id,limit:100},employeeToken)
 const onlyBArray=await rpc('channel.search',{id:telegramId,...composite,sourceIds:[telegramB.id],limit:100},employeeToken)
 const multi=await rpc('channel.search',{id:telegramId,...composite,sourceIds:[telegramA.id,telegramB.id],limit:100},employeeToken)
 assert.deepEqual(ids(onlyA),[aAny.id,aLate.id,aStart.id])
 assert.deepEqual(ids(onlyB),[bStart.id])
 assert.deepEqual(ids(onlyBArray),ids(onlyB))
 assert.deepEqual(ids(multi),expected)
 sameIds([...ids(onlyA),...ids(onlyB)],expected)
 const legacyText=await rpc('channel.fetch-text',{id:telegramId,sourceId:telegramA.id,limit:100},employeeToken)
 assert.equal(legacyText.total,6)
 assert.ok(legacyText.messages.every(message=>message.sourceId===telegramA.id))
 pass('Multi-source sourceIds OR, single-source legacy sourceId, and same-channel scope agree across search and fetch-text')

 const isoRange={keywordsAll:['OpenAI'],since:'2026-11-03T14:30:00+08:00',until:'2026-11-04T15:00:00+08:00'}
 const msRange={keywordsAll:['OpenAI'],since:at.d3Start,until:at.d4Late}
 const isoPage=await rpc('channel.search',{id:telegramId,...isoRange,limit:2},employeeToken)
 const msPage=await rpc('channel.search',{id:telegramId,...msRange,limit:2},employeeToken)
 assert.deepEqual(ids(isoPage),ids(msPage))
 assert.equal(isoPage.filters.since,at.d3Start);assert.equal(isoPage.filters.until,at.d4Late)
 const isoSecond=await rpc('channel.search',{id:telegramId,...msRange,limit:2,cursor:isoPage.nextCursor},employeeToken)
 const msSecond=await rpc('channel.search',{id:telegramId,...msRange,limit:2,cursor:msPage.nextCursor},employeeToken)
 assert.deepEqual(ids(isoSecond),ids(msSecond))
 const rangesMs=await rpc('channel.search',{id:telegramId,timeRanges:[{since:at.d3Start,until:at.d3End},{since:at.d4Start,until:at.d4End}],keywordsAll:['OpenAI'],keywordsAny:['金融','经济'],excludeKeywords:['广告'],limit:100},employeeToken)
 assert.deepEqual(ids(rangesMs),expected)
 pass('ISO date-times with explicit offsets and epoch milliseconds are synonymous for since/until and timeRanges, including continuation cursors')

 const first=await rpc('channel.search',{id:telegramId,...composite,limit:2},employeeToken)
 const second=await rpc('channel.search',{id:telegramId,...composite,limit:2,cursor:first.nextCursor},employeeToken)
 assert.equal(first.total,expected.length);assert.equal(first.messages.length,2);assert.ok(first.nextCursor)
 assert.equal(second.total,expected.length);assert.equal(second.messages.length,2);assert.equal(second.nextCursor,null)
 assert.deepEqual([...ids(first),...ids(second)],expected)
 assert.equal(new Set([...ids(first),...ids(second)]).size,expected.length)
 assert.match(await deny('channel.search',{id:telegramId,...composite,sourceIds:[telegramA.id],limit:2,cursor:first.nextCursor},employeeToken),/Cursor belongs to another channel or search/)
 assert.match(await deny('channel.search',{id:telegramId,...composite,keywordsAny:['金融'],limit:2,cursor:first.nextCursor},employeeToken),/Cursor belongs to another channel or search/)
 assert.match(await deny('channel.fetch-text',{id:telegramId,limit:2,cursor:first.nextCursor},employeeToken),/Cursor belongs to another channel or search/)
 const textSeen=[]
 for(let page=0,cursor;page<10;page++){
  const value=await rpc('channel.fetch-text',{id:telegramId,sourceIds:[telegramA.id,telegramB.id],limit:3,...(cursor?{cursor}:{})},employeeToken)
  textSeen.push(...ids(value));cursor=value.nextCursor
  if(!cursor)break
 }
 assert.equal(textSeen.length,telegramPosts.length)
 assert.equal(new Set(textSeen).size,telegramPosts.length)
 pass('Bounded search and fetch-text pagination return every matching message exactly once; cursors reject changed filters')

 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],sourceIds:[]},employeeToken),/one or more source IDs/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],timeRanges:[]},employeeToken),/time ranges/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:[],keywordsAny:['金融']},employeeToken),/nonempty keywords/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],excludeKeywords:[]},employeeToken),/nonempty keywords/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],since:'not-a-date'},employeeToken),/epoch milliseconds or an ISO date-time/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],since:'2026-11-04T14:30:00'},employeeToken),/epoch milliseconds or an ISO date-time/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],since:at.d4Start,until:at.d4Start},employeeToken),/since must precede until/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],timeRanges:[{since:at.d4Late,until:at.d4Start}]},employeeToken),/Each time range must have since before until/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],sourceId:youtube.id},employeeToken),/Source does not belong to this channel/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],sourceIds:[telegramA.id,youtube.id]},employeeToken),/Source does not belong to this channel/)
 assert.match(await deny('channel.fetch-text',{id:telegramId,sourceId:youtube.id},employeeToken),/Source does not belong to this channel/)
 assert.match(await deny('channel.search',{id:telegramId,keywordsAll:['OpenAI'],sourceId:telegramA.id,sourceIds:[telegramB.id]},employeeToken),/not both/)
 pass('Empty lists, malformed/ambiguous times and cross-platform source IDs are rejected before any read')

 const gui=await rpc('channel.posts',{channelId:telegramId,sourceIds:[telegramA.id,telegramB.id],limit:100})
 const guiA=await rpc('channel.posts',{channelId:telegramId,sourceId:telegramA.id,limit:100})
 const guiGlobal=await rpc('channel.posts',{sourceIds:[telegramA.id,telegramB.id],limit:100})
 assert.equal(gui.total,telegramPosts.length)
 assert.equal(new Set(gui.posts.map(post=>post.id)).size,telegramPosts.length)
 assert.equal(guiA.total,6);assert.ok(guiA.posts.every(post=>post.sourceId===telegramA.id))
 assert.equal(guiGlobal.total,telegramPosts.length)
 assert.match(await deny('channel.posts',{channelId:telegramId,sourceIds:[telegramA.id,youtube.id]}),/Source does not belong to this channel/)
 pass('channel.posts supports the same multi-source OR and legacy single-source filters for the GUI')

 const byHandle=await rpc('channel.sources',{query:'zaihua'},employeeToken)
 const byName=await f.call(employeeToken,'channel','sources','--query','在花')
 const hidden=await rpc('channel.sources',{query:'视频'},employeeToken)
 const visible=await rpc('channel.sources',{},employeeToken)
 assert.deepEqual(byHandle.map(source=>source.id),[telegramA.id])
 assert.deepEqual(byName.map(source=>source.id),[telegramA.id])
 assert.deepEqual(hidden,[])
 assert.deepEqual(visible.map(source=>source.id).sort(),[telegramA.id,telegramB.id].sort())
 assert.ok(visible.every(source=>source.channelId===telegramId))
 const infoA=await rpc('channel.source-info',{id:telegramA.id},employeeToken)
 const infoB=await rpc('channel.source-info',{id:telegramB.id},employeeToken)
 assert.equal(infoA.authorUrl,'https://t.me/zaihua');assert.equal(infoA.name,'在花频道')
 assert.equal(infoB.authorUrl,'https://t.me/lingyi');assert.equal(infoB.name,'另一频道')
 assert.match(await deny('channel.source-info',{id:youtube.id},employeeToken),/Channel access required/)
 pass('Employee channel.sources name/handle search and source-info expose only the granted Telegram channel with correct platform URLs')

 const summary=await publish(youtube.id,'yt-summary',at.youtube,'YouTube 摘要','## 视频总结\n\nActual summary')
 const summaryPost=await rpc('channel.post',{id:summary.id},secretaryToken)
 assert.equal(summaryPost.body,'Actual summary')
 const youtubePage=await rpc('channel.fetch-text',{id:youtube.channelId,limit:100},secretaryToken)
 assert.equal(youtubePage.total,1)
 assert.equal(youtubePage.messages[0].text,'Actual summary')
 assert.ok(!JSON.stringify(youtubePage).includes('视频总结'))
 const infoYoutube=await rpc('channel.source-info',{id:youtube.id},secretaryToken)
 assert.equal(infoYoutube.name,'视频频道');assert.equal(infoYoutube.authorUrl,'https://www.youtube.com/@videofeed')
 assert.ok(!JSON.stringify(infoYoutube).includes('视频总结'))
 pass('YouTube summary headings are removed from post and fetch-text while source-info still returns the author profile')

 const sourceShape=value=>value.map(({id,plugin,targetId,locator,name,enabled,pollSeconds,channelId})=>({id,plugin,targetId,locator,name,enabled,pollSeconds,channelId})).sort((a,b)=>a.id.localeCompare(b.id))
 const sourcesBefore=sourceShape(await rpc('channel.sources',{},secretaryToken))
 const identity=async()=>(await rpc('session.list')).sessions.filter(card=>[employee.id,secretary.id].includes(card.id)).map(card=>({id:card.id,title:card.title,group:card.group,managementRole:card.managementRole,engine:card.engine,cwd:card.cwd,threadId:card.threadId,nativeSessions:card.nativeSessions})).sort((a,b)=>a.id.localeCompare(b.id))
 const identitiesBefore=await identity()
 const initial=await rpc('channel.source-order',{id:telegramId},employeeToken)
 assert.equal(initial.revision,0)
 sameIds(initial.sourceIds,[telegramA.id,telegramB.id])
 const reversed=[initial.sourceIds[1],initial.sourceIds[0]]
 assert.match(await deny('channel.source-order',{id:telegramId,sourceIds:reversed,expectedRevision:initial.revision},employeeToken),/Only the user or a Secretary/)
 const written=await rpc('channel.source-order',{id:telegramId,sourceIds:reversed,expectedRevision:initial.revision},secretaryToken)
 assert.equal(written.revision,initial.revision+1)
 assert.deepEqual(written.sourceIds,reversed)
 assert.deepEqual((await rpc('channel.source-order',{id:telegramId},employeeToken)).sourceIds,reversed)
 assert.match(await deny('channel.source-order',{id:telegramId,sourceIds:initial.sourceIds,expectedRevision:initial.revision},secretaryToken),/Source order changed/)
 assert.match(await deny('channel.source-order',{id:telegramId,sourceIds:[youtube.id],expectedRevision:written.revision},secretaryToken),/Choose unique sources belonging to this channel/)
 assert.deepEqual(sourceShape(await rpc('channel.sources',{},secretaryToken)),sourcesBefore)
 assert.deepEqual(await identity(),identitiesBefore)
 pass('Employee reads but cannot write source order; Secretary writes it with optimistic revisions without changing subscriptions, identities, cwd or native references')

 const readAfter=await rpc('channel.read-state',{id:telegramId,entryIds:telegramPosts.map(post=>post.id)})
 assert.deepEqual(readAfter.entries,readBefore.entries)
 assert.equal(readAfter.unreadCount,readBefore.unreadCount)
 const telegramFeed=await rpc('channel.posts',{channelId:telegramId,limit:100})
 const youtubeFeed=await rpc('channel.posts',{channelId:youtube.channelId,limit:100})
 assert.ok(telegramFeed.posts.every(post=>!post.saved&&post.savedAt===undefined))
 assert.ok(youtubeFeed.posts.every(post=>!post.saved&&post.savedAt===undefined))
 assert.equal((await rpc('session.status')).filter(status=>status.busy).length,0)
 assert.deepEqual(await identity(),identitiesBefore)
 const disk=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true})
 try{
  for(const table of ['posts','media','channel_messages'])assert.equal(disk.prepare('SELECT COUNT(*) n FROM '+table).get().n,0)
  const row=disk.prepare('SELECT value FROM metadata WHERE key=?').get('source_order:'+telegramId)
  assert.ok(row,'source order is stored as channel metadata')
  const order=JSON.parse(row.value)
  assert.deepEqual(Object.keys(order).sort(),['id','revision','sourceIds'])
  assert.equal(order.id,telegramId);assert.equal(order.revision,written.revision);assert.deepEqual(order.sourceIds,reversed)
  assert.ok(!row.value.includes('OpenAI')&&!row.value.includes('金融')&&!row.value.includes('Actual summary'))
 }finally{disk.close()}
 assert.deepEqual(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')),[])
 pass('Source ordering and reads leave no Mac body/media rows, favorites, user receipts, tasks or session changes; order is metadata only')

 await f.stop();await f.start()
 const persisted=await rpc('channel.source-order',{id:telegramId},employeeToken)
 assert.deepEqual(persisted.sourceIds,reversed)
 assert.equal(persisted.revision,written.revision)
 assert.deepEqual(sourceShape(await rpc('channel.sources',{},secretaryToken)),sourcesBefore)
 assert.deepEqual(await identity(),identitiesBefore)
 assert.deepEqual((await rpc('channel.list',{},employeeToken)).map(channel=>channel.id),[telegramId])
 pass('Source order, reading grant and every employee/subscription identity survive a full Core restart')
 const summaryResult={passed:true,checks,providerCalls:0,productionMutations:0}
 console.log('CHANNEL FILTER CORE: '+JSON.stringify(summaryResult))
}finally{await f.close()}
