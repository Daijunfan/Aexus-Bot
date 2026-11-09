// One authenticated draft store; isolated work/private composers and CAS after restart.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore()
const call=async(cmd,args={})=>{const result=await f.request(null,cmd,args);assert.ok(result.ok,result.error);return result.data}
try{
 await call('group.add',{name:'Studio'})
 const employee=await f.create('Draft owner','Studio'),conversation='employee:'+employee.id,key='work:'+conversation
 for(const row of await call('session.status'))if(row.sessionId)await call('session.close',{id:row.sessionId})
 const before=await call('session.transcript',{id:employee.id})
 await f.stop();const legacy={version:1,revision:4,conversations:{},messages:{},drafts:{[conversation]:{text:'Legacy work attempt',sourceView:'company',clientMessageId:'legacy-work',files:['old.txt'],updatedAt:123}}};fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'messenger.json'),JSON.stringify(legacy));await f.start()
 const migrated=await call('messenger.state');assert.equal(migrated.drafts[conversation],undefined);assert.deepEqual(migrated.drafts[key],legacy.drafts[conversation]);assert.equal(migrated.draftScopes,1);assert.equal(migrated.revision,5)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'messenger.json.previous'),'utf8')),legacy,'the legacy draft remains recoverable in the atomic backup')
 await f.cli('messenger','draft',conversation,'--data',JSON.stringify({text:'Private conversation',clientMessageId:'private-a'}))
 await f.cli('messenger','draft',conversation,'--scope','work','--data',JSON.stringify({text:'Work plan\n工作草稿',files:['.agents-attachments/design.md'],sourceView:'company',clientMessageId:'work-a'}))
 let state=await call('messenger.state')
 assert.equal(state.drafts[conversation].text,'Private conversation');assert.equal(state.drafts[key].text,'Work plan\n工作草稿')
 assert.deepEqual((await call('session.list',{live:true})),[],'drafts never launch engines')
 assert.deepEqual(await call('session.transcript',{id:employee.id}),before,'drafts do not rewrite history')
 await f.stop();await f.start();state=await call('messenger.state')
 assert.equal(state.drafts[key].clientMessageId,'work-a');assert.equal(state.drafts[conversation].clientMessageId,'private-a')
 await call('messenger.draft',{conversation,scope:'work',text:'Newer work draft',clientMessageId:'work-b'})
 const revision=(await call('messenger.state')).revision
 state=await call('messenger.draft',{conversation,scope:'work',text:'',expectedClientMessageId:'work-a'})
 assert.equal(state.revision,revision);assert.equal(state.drafts[key].clientMessageId,'work-b')
 state=await call('messenger.draft',{conversation,scope:'work',text:'',expectedClientMessageId:'work-b'})
 assert.equal(state.drafts[key],undefined);assert.equal(state.drafts[conversation].clientMessageId,'private-a')
 assert.equal((await f.request(await f.token(employee.id),'messenger.draft',{conversation,scope:'work',text:'Unauthorized'})).ok,false)
 const group=await call('chat.create',{name:'Review',members:[employee.id]})
 assert.equal((await f.request(null,'messenger.draft',{conversation:'group:'+group.id,scope:'work',text:'Wrong scope'})).ok,false)
 assert.equal((await f.request(null,'messenger.draft',{conversation,scope:'invalid',text:'Wrong scope'})).ok,false)
 assert.equal((await f.raw(null,'messenger','draft',conversation,'--scope','work','--data','{"text":"Conflicting","scope":"messages"}')).ok,false)
 console.log('PASS work drafts: legacy draft preservation, CLI/API isolation, durable restart, conditional clear, authority, no engine/history changes')
}finally{await f.close()}
