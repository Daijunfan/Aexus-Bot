// Isolated Core/CLI with deterministic engines; no production state or paid inference.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r}
try{
 await f.cli('group','add','Readers');const reader=await f.create('Reader','Readers'),token=await f.token(reader.id),source=await rpc('channel.source-add',{plugin:'x',locator:'@batchfixture'}),id=source.channelId
 const access=await rpc('channel.access',{id});await rpc('channel.access',{id,employeeIds:[reader.id],expectedRevision:access.revision})
 const ids=[];for(let i=0;i<110;i++)ids.push((await rpc('channel.publish',{sourceId:source.id,externalId:'count-'+i,publishedAt:Date.now()-i,title:'Frontier '+i,body:'Full source '+i})).id)
 const page=await rpc('channel.fetch-text',{id,limit:100},token),next=await rpc('channel.fetch-text',{id,limit:100,cursor:page.nextCursor},token)
 assert.equal(page.messages.length,100);assert.equal(next.messages.length,10);assert.equal(next.nextCursor,null);assert.deepEqual(new Set([...page.messages,...next.messages].map(p=>p.id)),new Set(ids))
 for(const [cmd,args]of [['channel.post-trigger-set',{id,employee:reader.id,everyPosts:50,prompt:'No implicit work',enabled:true,expectedRevision:0}],['conversation.notice-create',{conversation:'channel:'+id,clientRequestId:'no-channel-notice',spec:{}}]])await deny(cmd,args)
 assert.equal((await rpc('channel.publish',{sourceId:source.id,externalId:'count-0',publishedAt:(await rpc('channel.post',{id:ids[0]})).publishedAt,title:'Frontier 0',body:'Full source 0'})).status,'duplicate')
 for(const cmd of ['session.transcript','direct.history'])assert.deepEqual((await rpc(cmd,{employee:reader.id})).items,[])
 assert.equal(fs.existsSync(path.join(f.control,reader.id+'-work.json')),false);assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('schedule.history'),[])
 await rpc('channel.save',{id:ids[0],saved:true});await f.stop();await f.start();assert.equal((await rpc('channel.fetch-text',{id,limit:100},token)).total,1)
 assert.deepEqual((await rpc('session.transcript',{employee:reader.id})).items,[]);assert.deepEqual(await rpc('schedule.list'),[])
 console.log('PASS explicit 100+10 channel pagination, idempotent collection, no automatic post-count work/notifications/private messages, saved-only Mac persistence and restart without replay')

}finally{await f.close()}
