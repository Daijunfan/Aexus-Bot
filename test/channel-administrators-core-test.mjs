// Isolated Core/CLI with deterministic engines; no production state or paid inference.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r}
try{
 await f.cli('group','add','Readers');const reader=await f.create('Reader','Readers'),manager=await f.create('Manager','Readers','manager'),secretary=await f.create('Secretary','Readers','secretary'),rt=await f.token(reader.id),mt=await f.token(manager.id),st=await f.token(secretary.id)
 const source=await rpc('channel.source-add',{plugin:'telegram',locator:'reading_access_fixture'}),id=source.channelId,conversation='channel:'+id
 assert.deepEqual(await rpc('channel.list',{},rt),[]);assert.deepEqual(await rpc('channel.list',{},mt),[]);assert.equal((await rpc('channel.list',{},st)).length,1)
 const grant=await rpc('channel.access',{id});await rpc('channel.access',{id,employeeIds:[reader.id],expectedRevision:grant.revision},st)
 assert.equal((await rpc('channel.get',{id},rt)).id,id);assert.deepEqual((await rpc('channel.get',{id},rt)).memberIds,[])
 await deny('channel.access',{id,employeeIds:[manager.id],expectedRevision:grant.revision},st);await deny('channel.access',{id},mt)
 for(const roleToken of [null,rt,mt,st])for(const [cmd,args] of [['channel.update',{id,adminIds:[reader.id]}],['conversation.member',{conversation,employee:reader.id,action:'add',expectedRevision:1}],['conversation.role',{conversation,employee:reader.id,role:'owner',expectedRevision:1}],['channel.message-send',{id,text:'No channel work'}],['channel.message-post',{id,text:'No channel discussion'}]])await deny(cmd,args,roleToken)
 const post=await rpc('channel.publish',{sourceId:source.id,externalId:'one',publishedAt:Date.now(),title:'Frontier information',body:'Full source body'})
 assert.equal((await rpc('channel.fetch-text',{id,limit:1},rt)).messages[0].id,post.id);assert.deepEqual((await rpc('channel.context',{id,entryId:post.id},rt)).entry.post.id,post.id)
 assert.deepEqual((await rpc('conversation.policy',{conversation},st)).allowedActions,[])
 const current=await rpc('channel.access',{id});await rpc('channel.access',{id,employeeIds:[],expectedRevision:current.revision},st)
 assert.deepEqual(await rpc('channel.list',{},rt),[]);for(const cmd of ['channel.get','channel.fetch-text','channel.fetch-images','channel.search','channel.context'])await deny(cmd,{id,...(cmd==='channel.search'?{query:'Frontier'}:{})},rt)
 assert.equal((await rpc('channel.fetch-text',{id,limit:1},st)).messages[0].id,post.id)
 const before=(await rpc('session.list')).sessions.map(c=>[c.id,c.cwd,c.engine,c.managementRole]);await f.stop();await f.start()
 assert.deepEqual(await rpc('channel.list',{},rt),[]);assert.equal((await rpc('channel.list',{},st)).length,1);assert.deepEqual((await rpc('session.list')).sessions.map(c=>[c.id,c.cwd,c.engine,c.managementRole]),before)
 for(const employee of [reader,manager,secretary]){assert.deepEqual((await rpc('session.transcript',{employee:employee.id})).items,[]);assert.deepEqual((await rpc('direct.history',{employee:employee.id})).items,[]);assert.equal(fs.existsSync(path.join(f.control,employee.id+'-work.json')),false)}
 assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('terminal.list'),[])
 console.log('PASS channel reading grants: role-independent read authorization, stale-write rejection, immediate revocation, automatic Secretary, no membership/moderation/publication or automatic Agent tasks, restart and identity preservation')

}finally{await f.close()}
