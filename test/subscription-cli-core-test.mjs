// Real Secretary CLI + authenticated collector HTTP, with disposable profiles and protocol fixtures.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),checks=[],out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/subscription-cli')
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'result.json'),{force:true})
const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
const deny=async(cmd,args,token)=>assert.equal((await f.request(token,cmd,args)).ok,false,cmd+' must reject')
const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await f.cli('group','add','Subscription QA');const secretary=await f.create('Secretary','Subscription QA','secretary'),employee=await f.create('Reader','Subscription QA'),st=await f.token(secretary.id),et=await f.token(employee.id)
 const sources=[]
 for(const [plugin,locator,alias] of [['telegram','@fixture_news','https://t.me/s/Fixture_News?utm_source=fixture'],['x','@fixtureauthor','https://x.com/FixtureAuthor?lang=en'],['youtube','@fixturechannel','https://www.youtube.com/@FixtureChannel/videos']]){
  const source=await f.call(st,'channel','source-add','--data',JSON.stringify({plugin,locator,name:'Fixture '+plugin}));sources.push(source)
  const same=await f.call(st,'channel','source-add','--data',JSON.stringify({plugin,locator:alias}));assert.equal(same.id,source.id)
  const changed=await f.call(st,'channel','source-update',source.id,'--patch',JSON.stringify({locator:alias,name:'Renamed '+plugin}))
  assert.equal(changed.locator,alias,'accepted locator aliases must actually be saved');assert.equal(changed.id,source.id);assert.equal(changed.targetId,source.targetId)
 }
 assert.equal((await rpc('channel.sources',{includeDisabled:true})).length,3)
 pass('Secretary adds and edits all three platforms through its own CLI token; URL aliases preserve source/target identities and are stored')
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));await rpc('channel.settings',{patch:{enabled:true,port}})
 const issued=await rpc('channel.collector-add',{name:'Scoped subscription fixture',sourceIds:'all'}),endpoint='http://127.0.0.1:'+port+'/api/channels/collector'
 const collect=async(cmd,args={})=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});return {status:response.status,...await response.json()}}
 await f.until(async()=>{try{return (await collect('channel.collector-config')).ok}catch{return false}},'collector listener')
 for(const source of sources){
  const post=await rpc('channel.publish',{sourceId:source.id,externalId:'saved-fixture',publishedAt:Date.now()-1000,title:'Saved '+source.plugin,body:'Original retained content'});await rpc('channel.save',{id:post.id,saved:true})
  await f.call(st,'channel','source-remove',source.id)
  const config=(await collect('channel.collector-config')).data;assert.equal(config.targets.find(row=>row.sourceId===source.id).enabled,false)
  const pending=await f.call(st,'channel','subscription-status','--channel',source.channelId);assert.equal(pending.collectors.find(row=>row.id===issued.collector.id).state,'pending')
  const rejected=await collect('channel.publish',{sourceId:source.id,externalId:'late',publishedAt:Date.now(),title:'Late result',body:'Cannot publish after unsubscribe'});assert.equal(rejected.code,'SOURCE_DISABLED')
  assert.equal((await collect('channel.collector-ack',{revision:config.revision})).ok,true)
  const status=await f.call(st,'channel','subscription-status','--channel',source.channelId);assert.equal(status.collectors.find(row=>row.id===issued.collector.id).state,'synced')
  assert.equal((await rpc('channel.post',{id:post.id})).saved,true)
  const restored=await f.call(st,'channel','source-add','--data',JSON.stringify({plugin:source.plugin,locator:source.locator}));assert.equal(restored.id,source.id);assert.equal(restored.targetId,source.targetId)
 }
 pass('Unfollow/restore across Telegram, X and YouTube reaches collector snapshots, blocks late writes and retains saved history; application status follows server acknowledgment')
 for(const source of sources){await deny('channel.source-update',{id:source.id,patch:{enabled:false}},et);await deny('channel.source-remove',{id:source.id},et)}
 await deny('channel.source-add',{plugin:'x',locator:'@cannotcreate'},et)
 await deny('channel.collector-ack',{revision:1},st)
 assert.equal((await collect('channel.source-add',{plugin:'x',locator:'@cannotwrite'})).ok,false)
 pass('Employees and collector tokens cannot administer subscriptions, and Secretary cannot forge a server acknowledgment')
 const before=await rpc('channel.sources',{includeDisabled:true})
 for(const data of [{plugin:'x',locator:'https://x.com/fixtureauthor/status/1'},{plugin:'youtube',locator:'https://www.youtube.com/watch?v=fixture'},{plugin:'invalid',locator:'anything'}])await deny('channel.source-add',data,st)
 await deny('channel.source-update',{id:sources[0].id,patch:{locator:'@another_author'}},st)
 assert.deepEqual(await rpc('channel.sources',{includeDisabled:true}),before)
 pass('Invalid profiles and attempts to replace an existing author reject without changing the subscription inventory')
 assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('terminal.list'),[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,modelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close()}
