import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),call=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 await call('group.add',{name:'Creation'});const employee=await f.create('Owner','Creation'),other=await f.create('Member','Creation'),args={name:'Review group',members:[employee.id,other.id],ownerId:employee.id,clientRequestId:'group-create-stable'}
 const first=await f.cli('chat','create','--name',args.name,'--members',JSON.stringify(args.members),'--owner-id',employee.id,'--client-request-id',args.clientRequestId),retry=await call('chat.create',args)
 assert.equal(first.id,retry.id);assert.equal(first.creation,undefined);assert.equal(first.ownerId,employee.id);assert.equal((await call('chat.list')).length,1)
 assert.equal((await f.request(null,'chat.create',{...args,name:'Changed settings'})).ok,false)
 const token=await f.token(employee.id),separate=await call('chat.create',args,token);assert.notEqual(separate.id,first.id,'creation identities are caller-bound')
 await f.stop();await f.start();assert.equal((await call('chat.create',args)).id,first.id);assert.equal((await call('chat.list')).length,2)
 assert.equal((await call('chat.history',{id:first.id})).messages.length,0);assert.equal((await f.status(employee.id)).busy,false)
 console.log('PASS group creation: stable CLI/API retry, actor isolation, restart, unchanged Owner and no messages or tasks')
}finally{await f.close()}
