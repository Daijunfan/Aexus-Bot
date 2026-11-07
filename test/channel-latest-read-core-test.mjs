// Authenticated Core/CLI, temporary state only. No content loads or model work for bulk reads.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),checks=[],rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(args,token=null)=>assert.equal((await f.request(token,'channel.acknowledge',args)).ok,false)
try{
 await f.cli('group','add','Readers');const employee=await f.create('Reader','Readers'),secretary=await f.create('Secretary','Readers','secretary'),et=await f.token(employee.id),st=await f.token(secretary.id)
 const sources=[];for(const locator of ['@latestalpha','@latestbeta','@latestgamma'])sources.push(await rpc('channel.source-add',{plugin:'x',locator}))
 const foreign=await rpc('channel.source-add',{plugin:'telegram',locator:'foreign_latest'}),id=sources[0].channelId,posts=[],stamp=Date.now()-500000
 for(let i=0;i<120;i++)posts.push(await rpc('channel.publish',{sourceId:sources[i%3].id,externalId:'p'+i,publishedAt:stamp+i,title:'Post '+i,body:'Retained fixture.'}))
 const untouched=await rpc('channel.publish',{sourceId:foreign.id,externalId:'foreign',publishedAt:stamp,title:'Other platform',body:'Separate scope'})
 const count=async channel=>(await rpc('channel.get',{id:channel})).unreadCount
 assert.equal(await count(id),120)
 for(const args of [{id,all:true,sourceIds:[sources[0].id,foreign.id]},{id,all:true,sourceIds:[]},{id,all:true,sourceIds:['unknown']},{id,entryIds:[posts[0].id],sourceIds:[sources[0].id]},{id,all:true,sourceId:sources[0].id,sourceIds:[sources[1].id]}]){await deny(args);assert.equal(await count(id),120)}
 await deny({id,all:true},et)
 const selected=await f.cli('channel','acknowledge',id,'--all','--source-ids',JSON.stringify(sources.slice(0,2).map(s=>s.id)))
 assert.equal(selected.acknowledgedCount,80);assert.equal(selected.unreadCount,40)
 const states=await rpc('channel.read-state',{id,entryIds:posts.map(p=>p.id)})
 assert.equal(states.entries.filter(p=>p.state==='read').length,80);assert.equal(states.entries.filter(p=>p.state==='unread').length,40);assert.equal(await count(foreign.channelId),1)
 checks.push('Actual CLI bulk source union clears unloaded history only in selected sources; foreign/invalid unions reject atomically, employees cannot change user reading')
 const again=await rpc('channel.acknowledge',{id,all:true,sourceIds:sources.slice(0,2).map(s=>s.id)});assert.equal(again.acknowledgedCount,0)
 const rest=await rpc('channel.acknowledge',{id,all:true,sourceId:sources[2].id},st);assert.equal(rest.unreadCount,0);assert.equal(rest.acknowledgedCount,40)
 const late=await rpc('channel.publish',{sourceId:sources[0].id,externalId:'late',publishedAt:stamp-1000,title:'Late arrival',body:'Old publication, new received time'})
 assert.equal(await count(id),1);assert.equal((await rpc('channel.read-state',{id,entryIds:[late.id]})).entries[0].state,'unread')
 await rpc('channel.acknowledge',{id,all:true});assert.equal(await count(id),0)
 assert.equal((await rpc('channel.read-state',{id:foreign.channelId,entryIds:[untouched.id]})).entries[0].state,'unread')
 assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('terminal.list'),[])
 checks.push('Repeated bulk calls are idempotent; Secretary retains user authority; new backfilled arrivals remain unread and other channels stay untouched; no tasks/terminals start')
 const out=path.join(f.root,'artifacts/telegram-reader');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'latest-core.json'),JSON.stringify({passed:true,checks,modelCalls:0,productionDataUsed:false},null,2));checks.forEach(c=>console.log('PASS '+c))
}finally{await f.close()}
