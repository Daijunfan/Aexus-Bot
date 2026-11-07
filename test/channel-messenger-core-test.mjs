// Canonical news-only Messenger projection; isolated Core and synthetic publications.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r}
try{
 const source=await rpc('channel.source-add',{plugin:'x',locator:'@projection'}),ref='channel:'+source.channelId,other=await rpc('channel.source-add',{plugin:'youtube',locator:'@otherprojection'}),posts=[]
 for(let i=0;i<130;i++)posts.push(await rpc('channel.publish',{sourceId:source.id,externalId:'news-'+i,publishedAt:Date.now()+i,title:'News '+i,body:(i===0?'Oldest needle ':i===129?'Latest needle ':'Full article ')+i}))
 const first=await rpc('messenger.search',{conversation:ref,limit:20}),second=await rpc('messenger.search',{conversation:ref,offset:20,limit:20});assert.equal(first.total,130);assert.ok(second.messages.every(m=>!first.messages.some(a=>a.id===m.id)));assert.equal(new Set([...first.messages,...second.messages].map(m=>m.id)).size,40)
 assert.equal((await rpc('messenger.search',{conversation:ref,query:'needle'})).total,2);assert.equal((await rpc('messenger.search',{conversation:ref,author:'you'})).total,0)
 const oldest=posts[0];await rpc('channel.save',{id:oldest.id,saved:true});const reference=await rpc('messenger.reference',{conversation:ref,id:oldest.id});assert.equal(reference.id,oldest.id);assert.ok(reference.text.includes('Oldest needle'))
 await deny('messenger.reference',{conversation:'channel:'+other.channelId,id:oldest.id});await deny('channel.message-send',{id:source.channelId,text:'No channel discussion'})
 await rpc('messenger.message',{conversation:ref,id:oldest.id,patch:{saved:true}});assert.equal((await rpc('messenger.search',{conversation:ref,filter:'saved'})).messages[0].id,oldest.id)
 await deny('messenger.message',{conversation:ref,id:oldest.id,patch:{hidden:true}})
 assert.equal((await rpc('channel.history',{id:source.channelId})).messages.length,0);assert.equal((await rpc('channel.posts',{channelId:source.channelId})).total,130)
 await f.stop();await f.start();assert.equal((await rpc('messenger.search',{conversation:ref})).total,1);assert.equal((await rpc('messenger.search',{conversation:ref,filter:'saved'})).messages[0].id,oldest.id)
 await rpc('messenger.message',{conversation:ref,id:oldest.id,patch:{saved:false}});assert.equal((await rpc('channel.post',{id:oldest.id})).saved,false)
 await f.cli('group','add','Readers');const employee=await f.create('Reader','Readers'),token=await f.token(employee.id);await deny('messenger.search',{conversation:ref},token)
 assert.deepEqual((await rpc('direct.history',{employee:employee.id})).items,[]);assert.deepEqual(await rpc('schedule.list'),[])
 console.log('PASS channel Messenger: complete news-only search and pagination, no user discussion, exact references and cross-channel isolation, Save authority, saved-only disk persistence and no employee tasks')
}finally{await f.close()}
