// Real authenticated Core/CLI with the official ACP wire shape; isolated state and no provider calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-antigravity-core-')),workspace=path.join(temp,'workspace'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/antigravity/core'),checks=[]
fs.mkdirSync(workspace);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(workspace,'keep.txt'),'keep')
const f=await fixtureCore({HOME:temp,USERPROFILE:temp,ANTIGRAVITY_BIN:path.join(root,'test/fixtures/antigravity-acp.cjs'),GEMINI_API_KEY:'fixture-google-key-not-real',OPENAI_API_KEY:'unrelated-openai-key',ANTHROPIC_API_KEY:'unrelated-anthropic-key'})
const core=async(cmd,args={})=>{const response=await f.request(null,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data},pass=text=>{checks.push(text);console.log('PASS '+text)}
const workerSnapshot=id=>core('worker.snapshot',{id}),idle=id=>f.until(async()=>!(await workerSnapshot(id)).worker.busy,'Worker idle')
const records=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
const inputFiles=()=>{const found=[];const walk=dir=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name==='native-inputs.jsonl')found.push(file)}};walk(f.env.AGENTS_COMPANY_HOME);return found}
try{
 const engines=await core('engine.list');assert.equal(engines.length,8);assert.ok(engines.some(engine=>engine.engine==='antigravity'&&engine.label==='Google Antigravity'));assert.ok(!JSON.stringify(engines).includes(f.env.GEMINI_API_KEY))
 const capabilities=await f.cli('engine','capabilities','--engine','antigravity');assert.deepEqual(capabilities.workspaceModes,['build','work']);assert.deepEqual(capabilities.employeeKinds,['worker']);assert.ok(capabilities.capabilities.images&&capabilities.capabilities.plan&&capabilities.capabilities.resume)
 const plan=await core('engine.install-plan',{engine:'antigravity'});assert.equal(plan.version,'1.5.9');assert.equal(new URL(plan.url).hostname,'storage.googleapis.com');assert.match(plan.integrity,/^sha512-/);assert.equal(plan.runsPackageScripts,false);assert.equal(plan.changesGlobalPath,false)
 assert.ok(JSON.stringify(await core('api.describe',{command:'worker.create'})).includes('antigravity'));assert.ok(JSON.stringify(await core('api.describe',{command:'schedule.create'})).includes('antigravity'))
 assert.equal((await f.request(null,'engine.models',{engine:'antigravity',kind:'cloud-native-worker'})).ok,false)
 assert.equal((await f.request(null,'engine.configure',{engine:'antigravity',patch:{apiKey:'must-not-store'}})).ok,false)
 pass('Eight-engine registry, CLI/schemas, native-only credentials, pinned Google downloads and explicit remote boundary')
 const health=await core('engine.check',{engine:'antigravity',force:true}),catalog=await core('engine.models',{engine:'antigravity'});assert.equal(health.ready,true,health.error);assert.equal(health.protocol,'compatible');assert.equal(catalog.defaultModel,'fixture-gemini');assert.deepEqual(catalog.models.find(model=>model.isDefault).supportedEffortLevels,['low','high']);assert.equal(inputFiles().length,0)
 const selectedCatalog=await f.cli('engine','models','--engine','antigravity','--model','fixture-gemini-fast');assert.equal(selectedCatalog.defaultModel,'fixture-gemini-fast');assert.deepEqual(selectedCatalog.models.find(model=>model.isDefault).supportedEffortLevels,['low','high'])
 pass('Version/ACP/model discovery authenticates an explicitly configured native key without a prompt or inference')
 const worker=await f.cli('worker','create','--engine','antigravity','--cwd',workspace,'--title','Google Worker');await core('worker.start',{id:worker.id});let snapshot=await workerSnapshot(worker.id);assert.equal(snapshot.worker.state,'ready');const nativeId=snapshot.worker.nativeSessionId
 const commands=await core('worker.commands',{id:worker.id});assert.ok(JSON.stringify(commands).includes('fixture-skill'));assert.ok(snapshot.configOptions.some(option=>option.id==='thought_level'));assert.equal((await core('session.list')).sessions.length,0)
 const text='Google Worker task\nKeep this context clean';await core('worker.send',{id:worker.id,text,clientMessageId:'clean-worker'});await idle(worker.id)
 let inputs=inputFiles().flatMap(records),nativeInput=inputs.find(row=>row.text===text);assert.ok(nativeInput);assert.deepEqual(nativeInput.servers,[]);assert.ok(!JSON.stringify(nativeInput).includes('[Aexus initialization]'));assert.ok(!(await workerSnapshot(worker.id)).worker.error)
 await core('worker.send',{id:worker.id,text,clientMessageId:'clean-worker'});assert.equal(inputFiles().flatMap(records).filter(row=>row.text===text).length,1)
 await core('worker.configure',{id:worker.id,model:'fixture-gemini-fast',effort:'high',planMode:true});snapshot=await workerSnapshot(worker.id);assert.equal(snapshot.model,'fixture-gemini-fast');assert.equal(snapshot.effort,'high');assert.equal(snapshot.planMode,true);assert.equal(snapshot.worker.nativeSessionId,nativeId)
 await core('worker.configure',{id:worker.id,planMode:false});assert.equal((await workerSnapshot(worker.id)).planMode,false)
 assert.equal((await f.request(null,'worker.configure',{id:worker.id,model:'fixture-gemini',effort:'max'})).ok,false);assert.equal((await workerSnapshot(worker.id)).model,'fixture-gemini-fast')
 await core('worker.skill',{id:worker.id,name:'fixture-skill',prompt:'Native command',clientMessageId:'native-skill'});await idle(worker.id);assert.ok(inputFiles().flatMap(records).some(row=>row.text==='/fixture-skill Native command'))
 pass('Clean Worker native commands, model/thought-level/plan controls, stable identity and idempotent sends')
 const image=path.join(workspace,'pixel.png');fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh0YAAAAASUVORK5CYII=','base64'))
 await core('worker.send',{id:worker.id,text:'Image task',images:['pixel.png'],clientMessageId:'image'});await idle(worker.id);assert.ok(inputFiles().flatMap(records).find(row=>row.text==='Image task').content.some(part=>part.type==='image'&&part.mimeType==='image/png'))
 await core('worker.send',{id:worker.id,text:'WRITE_FIXTURE',clientMessageId:'approval'});const approval=await f.until(async()=>(await workerSnapshot(worker.id)).approvals?.[0],'native approval');assert.equal(fs.existsSync(path.join(workspace,'approval.txt')),false);await core('worker.respond',{id:worker.id,requestId:approval.id,decision:'allow'});await idle(worker.id);assert.equal(fs.readFileSync(path.join(workspace,'approval.txt'),'utf8'),'approved')
 await core('worker.send',{id:worker.id,text:'HOLD_FIXTURE',clientMessageId:'cancel'});await f.until(async()=>(await workerSnapshot(worker.id)).worker.busy,'busy');await core('worker.interrupt',{id:worker.id});await idle(worker.id)
 await core('worker.stop',{id:worker.id});await core('worker.start',{id:worker.id});assert.equal((await workerSnapshot(worker.id)).worker.nativeSessionId,nativeId)
 pass('Image input, real pending approval/decision, interrupt and same-session resume')
 await core('group.add',{name:'Google Team'});const card=await core('card.create',{title:'Google employee',engine:'antigravity',group:'Google Team',model:'fixture-gemini'});await f.ready(card.id)
 const status=async()=>(await core('session.status',{employee:card.id}))[0],live=(await status()).sessionId
 await core('session.enqueue',{employee:card.id,text:'Employee task',sourceView:'company'});await f.received(card.id,'Employee task');await f.until(async()=>!(await status()).busy,'employee idle')
 const roleInputs=inputFiles().flatMap(records).filter(row=>row.servers.length);assert.ok(roleInputs.some(row=>row.text.includes('[Aexus initialization]')));assert.ok(roleInputs.some(row=>row.text.includes('Employee task')))
 await core('session.enqueue',{employee:card.id,text:'/fixture-skill Employee command',sourceView:'company'});await f.until(()=>inputFiles().flatMap(records).some(row=>row.text==='/fixture-skill Employee command'),'unwrapped advertised command');await f.until(async()=>!(await status()).busy,'command idle')
 await core('config.plan',{id:live,enabled:true});await core('config.plan',{id:live,enabled:false});await core('config.effort',{id:live,effort:'high'})
 const beforeNative=(await core('session.list')).sessions.find(value=>value.id===card.id).nativeSessions.find(ref=>ref.engine==='antigravity').id;await core('session.close',{id:live});await core('session.open',{cardId:card.id});assert.equal((await core('session.list')).sessions.find(value=>value.id===card.id).nativeSessions.find(ref=>ref.engine==='antigravity').id,beforeNative)
 pass('Employee initialization proves authenticated identity/index reads; Team input, raw native slash commands and native resume work')
 const job=await core('schedule.create',{spec:{name:'Google scheduled task',enabled:false,action:{type:'agent',employeeId:card.id,prompt:'Google scheduled work',effort:'low'},rule:{kind:'once',at:new Date(Date.now()+3600000).toISOString()}}});await core('schedule.run',{id:job.id});await f.until(async()=>(await core('schedule.history',{id:job.id})).some(run=>run.status==='succeeded'),'scheduled completion');const reopened=(await status()).sessionId;assert.equal((await core('session.snapshot',{id:reopened})).effort,'high')
 pass('Mission runs with a native reasoning override and restores the existing employee settings')
 await core('worker.remove',{id:worker.id});assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'keep')
 for(const cached of [false,true]){
  const auth=await fixtureCore({HOME:temp,USERPROFILE:temp,ANTIGRAVITY_BIN:path.join(root,'test/fixtures/antigravity-acp.cjs'),GEMINI_API_KEY:'',AC_AGY_AUTHENTICATED:cached?'1':'0'})
  try{const response=await auth.request(null,'engine.check',{engine:'antigravity',force:true});assert.ok(response.ok);assert.equal(response.data.protocol,'compatible');assert.equal(response.data.ready,cached);assert.equal(response.data.authentication,cached?'configured':'not-signed-in');assert.equal(response.data.hasApiKey,false)}finally{await auth.close()}
 }
 pass('Cached native sign-in works without an API key; missing sign-in reports authentication rather than a protocol failure and never starts OAuth')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true})}
