// Actual Core/native protocol fixtures; no paid providers or production jobs.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {scheduleEventPrompt,SCHEDULE_EVENT_REFERENCE_LABEL} from '../src/shared/scheduler.ts'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/message-read-saved/core');fs.mkdirSync(out,{recursive:true})
const f=await fixtureCore(),checks=[],metrics=[]
const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
const pass=value=>{checks.push(value);console.log('PASS '+value)}
try{
 for(const count of [3,100]){
  const events=Array.from({length:count},(_,index)=>{const id='dm_'+randomUUID();return {type:'message.received',conversation:'employee:s_'+randomUUID().slice(0,8),id,messageId:id,sequence:index+9}})
  for(const event of events)event.conversation=events[0].conversation
  const before=SCHEDULE_EVENT_REFERENCE_LABEL+JSON.stringify(events)+'. Read required content with your currently authorized APIs. These are arrivals, not a final-response signal; later bot messages can wake this schedule again. Do not delete a persistent reply watch just because the bot acknowledged your request.',after=scheduleEventPrompt(events)
  const groups=JSON.parse(after.slice(SCHEDULE_EVENT_REFERENCE_LABEL.length,after.lastIndexOf(']')+1));assert.equal(groups.length,1);assert.equal(groups[0].conversation,events[0].conversation);assert.deepEqual(groups[0].events,events.map(({id,sequence})=>({id,sequence})))
  assert.ok(after.length<before.length*(count===3?.7:.4));metrics.push({events:count,beforeBytes:Buffer.byteLength(before),afterBytes:Buffer.byteLength(after),reduction:1-Buffer.byteLength(after)/Buffer.byteLength(before)})
 }
 const data={label:'Source data remains untrusted'},mixed=[{type:'signal',id:'one',data},{type:'message.received',conversation:'group:one',id:'event-edit',messageId:'message-one',sequence:7},{type:'monitor.output',monitorId:'monitor-one',id:'output-one',data:{line:'observable output'}}]
 const text=scheduleEventPrompt(mixed),groups=JSON.parse(text.slice(SCHEDULE_EVENT_REFERENCE_LABEL.length,text.lastIndexOf(']')+1));assert.equal(groups.length,3);assert.deepEqual(groups[0].events[0].data,data);assert.equal(groups[1].events[0].messageId,'message-one');assert.equal(groups[2].monitorId,'monitor-one')
 const interleaved=[{type:'channel.posted',channelId:'one',id:'first'},{type:'channel.posted',channelId:'two',id:'second'},{type:'channel.posted',channelId:'one',id:'third'}],ordered=scheduleEventPrompt(interleaved),chunks=JSON.parse(ordered.slice(SCHEDULE_EVENT_REFERENCE_LABEL.length,ordered.lastIndexOf(']')+1));assert.deepEqual(chunks.flatMap(chunk=>chunk.events.map(event=>event.id)),['first','second','third'])
 pass('Compact references retain every event ID/sequence, distinct message IDs and untrusted source data while removing repeated scope fields')
 await rpc('group.add',{name:'Event QA'});const author=await f.create('Author','Event QA'),observer=await f.create('Observer','Event QA','secretary'),token=await f.token(author.id)
 const spec=(name,person)=>({name,action:{type:'agent',employeeId:person,prompt:'Read the new published reply with authorized APIs.'},rule:{kind:'event',event:'message.received',conversation:'employee:'+author.id,cooldownSeconds:0},timeoutSeconds:20})
 const own=await rpc('schedule.create',{spec:spec('Do not wake on my own replies',author.id)}),watch=await rpc('schedule.create',{spec:spec('Observe published author replies',observer.id)})
 const first=await rpc('direct.post',{text:'An actual published private reply',clientMessageId:'reply-1'},token)
 await f.until(async()=>(await rpc('schedule.history',{id:watch.id})).some(run=>run.status==='succeeded'),'other authorized employee wakes')
 assert.deepEqual(await rpc('schedule.history',{id:own.id}),[]);assert.equal((await rpc('schedule.get',{id:own.id})).enabled,true)
 const run=(await rpc('schedule.history',{id:watch.id}))[0];assert.equal(run.events[0].messageId,first.id);assert.ok(run.action.prompt.includes(SCHEDULE_EVENT_REFERENCE_LABEL))
 const item=(await rpc('session.transcript',{employee:observer.id})).items.find(item=>item.role==='user'&&item.text===run.action.prompt);assert.equal(item.sourceView,'plan');assert.equal(item.context.origin.kind,'plan');assert.equal(item.context.origin.name,'Mission')
 const wire=JSON.parse(fs.readFileSync(path.join(f.control,observer.id+'-work.json'),'utf8')).text;assert.ok(wire.includes('"view":"Mission"'));assert.ok(!wire.includes('[Aexus context update]'));assert.ok(!wire.includes('delivery contract'))
 pass('Own private publications do not wake their publisher; an authorized observer still receives the same event as Mission without repeated initialization rules')
 await rpc('direct.post',{text:'An actual published private reply',clientMessageId:'reply-1'},token);await new Promise(resolve=>setTimeout(resolve,300));assert.equal((await rpc('schedule.history',{id:watch.id})).length,1)
 fs.writeFileSync(path.join(f.control,observer.id+'.hold-user'),'')
 await rpc('session.send',{employee:observer.id,text:'Hold the observer during three arrivals'});await f.until(async()=>(await f.status(observer.id)).busy,'observer busy')
 for(let index=0;index<3;index++)await rpc('direct.post',{text:'Later arrival '+index,clientMessageId:'later-'+index},token)
 assert.equal((await rpc('schedule.get',{id:watch.id})).pendingEvents.length,3)
 fs.rmSync(path.join(f.control,observer.id+'.hold-user'))
 const batch=await f.until(async()=>(await rpc('schedule.history',{id:watch.id})).find(run=>run.status==='succeeded'&&run.events?.length===3),'coalesced arrivals')
 assert.equal(batch.events.length,3);assert.equal((await rpc('schedule.get',{id:watch.id})).enabled,true);assert.deepEqual(await rpc('schedule.history',{id:own.id}),[])
 pass('Repeated publications deduplicate; arrivals while busy coalesce without losing messages or deleting a persistent watch')
 await f.stop();const file=path.join(f.env.AGENTS_COMPANY_HOME,'schedules.json'),saved=JSON.parse(fs.readFileSync(file));saved.jobs.find(job=>job.id===own.id).pendingEvents=[{type:'message.received',conversation:'employee:'+author.id,id:'legacy-self-reply',messageId:'legacy-self-reply',sequence:999}];fs.writeFileSync(file,JSON.stringify(saved));await f.start()
 await f.until(async()=>!(await rpc('schedule.get',{id:own.id})).pendingEvents?.length,'discard old feedback references')
 assert.equal((await rpc('schedule.get',{id:own.id})).enabled,true);assert.deepEqual(await rpc('schedule.history',{id:own.id}),[])
 pass('Legacy queued self-replies are discarded after restart without running them, disabling the schedule or deleting its record')
 await rpc('engine.configure',{engine:'claude',patch:{sdkPath:path.join(f.root,'test/fixtures/discussion-claude-sdk.mjs')}})
 const claude=await rpc('card.create',{title:'Claude event input',group:'Event QA',engine:'claude'});await f.ready(claude.id)
 const claudeJob=await rpc('schedule.create',{spec:{name:'Claude scheduled input',action:{type:'agent',employeeId:claude.id,prompt:'CLAUDE_MISSION_INPUT'},rule:{kind:'once',at:'2099-01-01T00:00:00Z'},enabled:false}})
 for(let index=0;index<2;index++){
  await rpc('schedule.run',{id:claudeJob.id});await f.until(async()=>(await rpc('schedule.history',{id:claudeJob.id})).filter(run=>run.status==='succeeded').length===index+1,'Claude scheduled input')
  const wire=JSON.parse(fs.readFileSync(path.join(f.control,claude.id+'-work.json'),'utf8')).text;assert.ok(wire.includes('"view":"Mission"'));assert.ok(!wire.includes('[Aexus context update]')&&!wire.includes('你是 Aexus Bot 的员工'))
 }
 const claudeItems=(await rpc('session.transcript',{employee:claude.id})).items.filter(item=>item.role==='user'&&item.text==='CLAUDE_MISSION_INPUT');assert.equal(claudeItems.length,2);assert.ok(claudeItems.every(item=>item.context.origin.kind==='plan'))
 pass('Claude SDK fixtures also retain Mission provenance and send no repeated router/identity text on consecutive scheduled turns')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,metrics,modelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close()}
