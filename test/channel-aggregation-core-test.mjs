// Synthetic legacy wrappers only. No real news, hosts or model requests.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 const a=await rpc('channel.source-add',{plugin:'telegram',locator:'aggregate_alpha',name:'Alpha'}),b=await rpc('channel.source-add',{plugin:'telegram',locator:'aggregate_beta',name:'Beta'});assert.equal(a.channelId,b.channelId)
 await f.stop();const db=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite')),old='nc_legacy_telegram'
 db.prepare('INSERT INTO channels VALUES(?,?,?,?,?,?,?)').run(old,'Legacy Telegram','telegram',Date.now()+10,Date.now(),'[]',1);db.prepare('UPDATE sources SET channel_id=? WHERE id=?').run(old,b.id);db.close();await f.start()
 const first=await rpc('channel.publish',{sourceId:a.id,externalId:'a',publishedAt:Date.now()-1000,title:'Alpha story',body:'Full original Alpha text'}),second=await rpc('channel.publish',{sourceId:b.id,externalId:'b',publishedAt:Date.now()-900,title:'Beta story',body:'Full original Beta text'})
 await rpc('channel.save',{id:second.id,saved:true});await rpc('channel.acknowledge',{id:old,entryIds:[second.id]})
 const folder=await rpc('messenger.folder-save',{name:'Legacy links',conversations:['channel:'+old]});await rpc('messenger.conversation',{conversations:['channel:'+old],patch:{pinned:true}})
 const before=await rpc('channel.sources',{plugin:'telegram',includeDisabled:true}),read=await rpc('channel.read-state',{id:old,entryIds:[second.id]})
 const merged=await rpc('channel.aggregate',{plugin:'telegram'});assert.equal(merged.channel.id,a.channelId);assert.equal(merged.channel.sourceCount,2);assert.deepEqual(merged.aliases,[old]);assert.equal((await rpc('channel.list')).filter(c=>c.kind==='telegram').length,1)
 assert.equal((await rpc('channel.get',{id:old})).id,a.channelId);await rpc('view.open',{kind:'messages',channelId:old});assert.equal((await rpc('view.get')).channelId,a.channelId)
 await rpc('view.open',{kind:'messages',sourceId:b.id});assert.equal((await rpc('view.get')).sourceId,undefined)
 assert.deepEqual(new Set((await rpc('channel.posts',{channelId:a.channelId})).posts.map(p=>p.id)),new Set([first.id,second.id]));assert.equal((await rpc('channel.post',{id:second.id})).saved,true)
 const after=await rpc('channel.sources',{plugin:'telegram',includeDisabled:true});assert.deepEqual(after.map(({channelId,updatedAt,...s})=>s),before.map(({channelId,updatedAt,...s})=>s));assert.ok(after.every(s=>s.channelId===a.channelId))
 assert.deepEqual((await rpc('channel.read-state',{id:a.channelId,entryIds:[second.id]})).entries,read.entries)
 const state=await rpc('messenger.state');assert.equal(state.conversations['channel:'+a.channelId].pinned,true);assert.deepEqual(state.folders.find(x=>x.id===folder.folders[0].id).conversations,['channel:'+a.channelId])
 assert.equal((await rpc('messenger.directory',{type:'telegram'})).total,1)
 await f.stop();await f.start();assert.equal((await rpc('channel.get',{id:old})).id,a.channelId);assert.equal((await rpc('channel.post',{id:second.id})).saved,true)
 console.log('PASS Telegram aggregation preserves source/post identities, saved/read state, old navigation, folders/preferences and durable aliases')
}finally{await f.close()}
