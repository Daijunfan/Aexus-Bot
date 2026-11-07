// Native replies produced by group work are genuine private replies and survive restart.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 await rpc('group.add',{name:'Private routing'});const writer=await f.create('Writer','Private routing'),reader=await f.create('Reader','Private routing')
 fs.writeFileSync(path.join(f.control,writer.id+'.reply.txt'),'The private answer is 359.5.')
 const group=await rpc('chat.create',{name:'Explicit publication only',members:[writer.id,reader.id]})
 const request=await rpc('chat.send',{id:group.id,text:'Calculate this and answer me privately.',mentions:[writer.id]})
 await f.until(async()=>{const h=await rpc('chat.history',{id:group.id});return h.messages[0].deliveries.every(d=>['completed','failed','interrupted'].includes(d.status))},'deliveries')
 const answer=(await f.status(writer.id)).lastReply;assert.ok(answer);assert.match(answer.text,/359.5/);assert.equal(answer.readAt,undefined);assert.equal((await f.status(reader.id)).lastReply,undefined)
 const history=await rpc('chat.history',{id:group.id});assert.deepEqual(history.messages.map(m=>m.id),[request.id])
 await f.stop();await f.start();assert.deepEqual((await f.status(writer.id)).lastReply,answer);assert.deepEqual((await rpc('chat.history',{id:group.id})).messages.map(m=>m.id),[request.id])
 await rpc('chat.acknowledge',{id:group.id,messageId:request.id});assert.deepEqual((await f.status(writer.id)).lastReply,answer)
 console.log('PASS group work native speech is private, group contains no automatic reply, quiet readers stay quiet, private unread survives restart/group reads')
}finally{await f.close()}
