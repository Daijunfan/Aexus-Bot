// Actual Core/native protocol fixtures: schedule reservations must defer communication, never lose it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-reserved-queue-')),checks=[]
let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs')
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,value.error);return value.data}
 const denied=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' must reject');return value.error}
 await rpc('group.add',{name:'Schedule queue'})
 const secretary=await f.create('Secretary','Schedule queue','secretary'),reviewer=await f.create('Reviewer','Schedule queue'),author=await f.create('Author','Schedule queue')
 const admin=await f.token(secretary.id),ordinary=await f.token(author.id),group=await rpc('chat.create',{name:'Research receipts',members:[secretary.id,reviewer.id,author.id]})
 const hold=id=>fs.writeFileSync(path.join(f.control,id+'.hold-user'),''),release=id=>fs.rmSync(path.join(f.control,id+'.hold-user'),{force:true})
 const message=async id=>(await rpc('chat.history',{id:group.id})).messages.find(message=>message.id===id)
 const complete=id=>f.until(async()=>{const m=await message(id);return m.deliveries.every(d=>d.status==='completed')&&m},'completed group receipts')
 const jobs=[]
 for(const card of [secretary,reviewer]){
  const session=(await rpc('session.open',{cardId:card.id})).sessionId
  await rpc('config.model',{id:session,model:'fixture-alt'});hold(card.id)
  const job=await rpc('schedule.create',{spec:{name:'Held scheduled work '+card.title,enabled:false,afterSeconds:3600,action:{type:'agent',employeeId:card.id,prompt:'SCHEDULE_HOLD',model:'gpt-6-luna'}}})
  const run=await rpc('schedule.run',{id:job.id});jobs.push({card,job,run})
  await f.until(async()=>{const s=await f.status(card.id);return s.busy&&s.currentTask?.runId===run.id},'reserved scheduled work')
 }
 const reservedSession=(await f.status(secretary.id)).sessionId,cancelled=await rpc('session.enqueue',{id:reservedSession,text:'CANCEL_ONLY_THE_QUEUE'})
 await rpc('session.dequeue',{id:reservedSession,messageId:cancelled.id});assert.equal((await f.status(secretary.id)).currentTask.runId,jobs[0].run.id)
 assert.ok(!(await rpc('session.queue',{id:reservedSession})).some(item=>item.id===cancelled.id))
 const publication=await rpc('chat.post',{id:group.id,text:'A saved PDF result with shared context',clientMessageId:'published-once'},ordinary)
 const work=await rpc('chat.send',{id:group.id,text:'USER_REVIEW_AFTER_SCHEDULE',mentions:[secretary.id,reviewer.id],clientMessageId:'work-once'})
 const direct=await rpc('direct.send',{employee:secretary.id,text:'PRIVATE_AFTER_SCHEDULE',clientMessageId:'private-once'})
 for(const id of [publication.id,work.id])for(const d of (await message(id)).deliveries.filter(d=>[secretary.id,reviewer.id].includes(d.employeeId))){assert.equal(d.status,'queued');assert.equal(d.taskId,undefined);assert.equal(d.deliveredAt,undefined)}
 for(const card of [secretary,reviewer]){const status=await f.status(card.id);assert.ok(status.busy);assert.ok((await rpc('session.queue',{id:status.sessionId})).length>=2);assert.equal((await rpc('session.snapshot',{id:status.sessionId})).model,'gpt-6-luna')}
 await denied('session.send',{employee:secretary.id,text:'STEAL_THE_SCHEDULE'})
 await denied('config.model',{id:(await f.status(secretary.id)).sessionId,model:'fixture-alt'})
 checks.push('Busy scheduled employees accept group awareness, explicit group work and private input as queued; reservation and mutation guards remain')
 for(const card of [secretary,reviewer])release(card.id)
 await complete(publication.id);await complete(work.id)
 await f.until(async()=>[secretary,reviewer].every(card=>!fs.existsSync(path.join(f.control,card.id+'.hold-user')))&&(await f.status(secretary.id)).busy===false&&(await f.status(reviewer.id)).busy===false,'queues drained')
 for(const card of [secretary,reviewer]){
  const items=(await rpc('session.transcript',{employee:card.id})).items
  assert.equal(items.filter(item=>item.role==='user'&&item.context?.phase==='work'&&item.context.origin.messageId===work.id).length,1)
  const info=(await f.status(card.id));assert.equal((await rpc('session.snapshot',{id:info.sessionId})).model,'fixture-alt')
  const runtime=JSON.parse(fs.readFileSync(path.join(f.control,card.id+'-work.json')));assert.equal(runtime.model,'fixture-alt','queued work starts after schedule override restoration')
 }
 const privateHistory=await rpc('direct.history',{employee:secretary.id});assert.ok(JSON.stringify(privateHistory).includes('PRIVATE_AFTER_SCHEDULE'))
 assert.ok(direct)
 checks.push('Release restores native model before FIFO work; explicit tasks execute once and private input remains separately recorded')

 // Stop before native submission: only that recipient is recoverable, under the retry actor's current authority.
 hold(reviewer.id)
 await rpc('session.send',{employee:reviewer.id,text:'MANUAL_HOLD'})
 const interrupted=await rpc('chat.send',{id:group.id,text:'RETRY_ONLY_UNDELIVERED',mentions:[reviewer.id],clientMessageId:'retryable'})
 await f.until(async()=>(await message(interrupted.id)).deliveries.find(d=>d.employeeId===reviewer.id)?.status==='queued','waiting retryable delivery')
 await rpc('session.close',{id:(await f.status(reviewer.id)).sessionId});release(reviewer.id)
 await f.until(async()=>(await message(interrupted.id)).deliveries.filter(d=>d.employeeId!==reviewer.id).every(d=>d.status==='completed'),'other members completed')
 const snapshot=await message(interrupted.id),untouched=snapshot.deliveries.filter(d=>d.employeeId!==reviewer.id)
 assert.equal(snapshot.deliveries.find(d=>d.employeeId===reviewer.id).taskId,undefined)
 await denied('chat.retry',{id:group.id,messageId:interrupted.id},ordinary)
 await denied('chat.retry',{id:group.id,messageId:interrupted.id,employeeIds:['not-a-recipient']},admin)
 const repeated=await Promise.all([rpc('chat.retry',{id:group.id,messageId:interrupted.id},admin),rpc('chat.retry',{id:group.id,messageId:interrupted.id},admin)])
 assert.equal(repeated.flatMap(r=>r.retriedEmployeeIds).length,1)
 const retried=await complete(interrupted.id)
 assert.deepEqual(retried.deliveries.filter(d=>d.employeeId!==reviewer.id),untouched)
 assert.equal(retried.author.kind,'operator');assert.equal(retried.text,snapshot.text)
 assert.equal(retried.deliveries.find(d=>d.employeeId===reviewer.id).retry.by.employeeId,secretary.id)
 assert.equal((await rpc('chat.retry',{id:group.id,messageId:interrupted.id})).retriedEmployeeIds.length,0)
 const items=(await rpc('session.transcript',{employee:reviewer.id})).items
 assert.equal(items.filter(item=>item.role==='user'&&item.context?.phase==='work'&&item.context.origin.messageId===interrupted.id).length,1)
 assert.equal((await rpc('chat.history',{id:group.id})).messages.length,3,'retry never republishes the original message')
 checks.push('Admin retry preserves original sender/content/history, current actor and completed recipients; concurrent retries dispatch exactly once; ordinary employees denied')

 // Retry must retain Governor view scope rather than taking whichever view is active later.
 const governor=await f.create('Governor','Schedule queue','governor')
 await rpc('chat.update',{id:group.id,members:[secretary.id,reviewer.id,author.id,governor.id]})
 const pinned=await rpc('team-view.create',{name:'Pinned research scope',teams:['Schedule queue']})
 hold(governor.id);await rpc('session.send',{employee:governor.id,text:'GOVERNOR_HOLD',viewId:pinned.id})
 const scoped=await rpc('chat.send',{id:group.id,text:'SCOPED_RETRY',mentions:[governor.id],viewId:pinned.id,clientMessageId:'scoped-once'})
 assert.equal((await message(scoped.id)).deliveries.find(d=>d.employeeId===governor.id).viewId,pinned.id)
 await rpc('session.close',{id:(await f.status(governor.id)).sessionId});release(governor.id);await rpc('team-view.select',{id:'all'})
 await rpc('chat.retry',{id:group.id,messageId:scoped.id},admin);await complete(scoped.id)
 const governorInput=JSON.parse(fs.readFileSync(path.join(f.control,governor.id+'-work.json')))
 assert.ok(governorInput.text.includes(pinned.id),'retry uses the saved Governor scope')
 checks.push('Governor delivery scope is frozen on acceptance and preserved across explicit retry and user view changes')

 // A retry queued under a reservation must lose authority immediately after actor demotion.
 hold(reviewer.id);await rpc('session.send',{employee:reviewer.id,text:'REVOKE_PREPARATION'})
 const revoked=await rpc('chat.send',{id:group.id,text:'RETRY_AUTHORITY_GUARD',mentions:[reviewer.id],clientMessageId:'revoke-retry'})
 await rpc('session.close',{id:(await f.status(reviewer.id)).sessionId})
 const lock=await rpc('schedule.create',{spec:{name:'Revocation reservation',enabled:false,afterSeconds:3600,action:{type:'agent',employeeId:reviewer.id,prompt:'REVOCATION_HOLD'}}})
 await rpc('schedule.run',{id:lock.id});await f.until(async()=>(await f.status(reviewer.id)).currentTask?.runId,'revocation reservation')
 await rpc('chat.retry',{id:group.id,messageId:revoked.id,employeeIds:[reviewer.id]},admin)
 await rpc('card.management-role',{id:secretary.id,role:'employee'})
 await f.until(async()=>['failed','interrupted'].includes((await message(revoked.id)).deliveries.find(d=>d.employeeId===reviewer.id).status),'retry actor revoked')
 release(reviewer.id);await f.until(async()=>!(await f.status(reviewer.id)).busy,'reservation finishes')
 const rejected=(await message(revoked.id)).deliveries.find(d=>d.employeeId===reviewer.id);assert.equal(rejected.taskId,undefined);assert.match(rejected.error,/authorization|revoked/i)
 await rpc('card.management-role',{id:secretary.id,role:'secretary'});await rpc('chat.retry',{id:group.id,messageId:revoked.id,employeeIds:[reviewer.id]},admin);await complete(revoked.id)
 checks.push('A queued retry rechecks its real actor: demotion cancels it before native work; explicit authorized recovery succeeds later')

 // A known native context is enough to withhold uncertain replay even when old receipt metadata is missing.
 await f.stop()
 const file=path.join(f.env.AGENTS_COMPANY_HOME,'chats',group.id+'.json'),history=JSON.parse(fs.readFileSync(file,'utf8')),record=history.find(m=>m.id===interrupted.id),delivery=record.deliveries.find(d=>d.employeeId===reviewer.id)
 Object.keys(delivery).forEach(key=>{if(!['employeeId','mode'].includes(key))delete delivery[key]});Object.assign(delivery,{status:'failed',error:'Legacy missing receipt metadata'})
 fs.writeFileSync(file,JSON.stringify(history));await f.start()
 const guarded=await rpc('chat.retry',{id:group.id,messageId:interrupted.id})
 assert.deepEqual(guarded.retriedEmployeeIds,[]);assert.deepEqual(guarded.skippedEmployeeIds,[reviewer.id])
 checks.push('Restart does not replay accepted work; recorded native input blocks uncertain retries despite missing legacy receipt fields')
 const out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS??path.join(root,'artifacts/message-delivery-recovery')
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'reserved-queue.json'),JSON.stringify({passed:true,checks,paidTestCalls:0,productionStateUsed:false},null,2)+'\n')
 console.log('PASS '+checks.join('; '))
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
