// Actual installed OpenCode/Kilo ACP processes and Core APIs; loopback model only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'

const binaries={opencode:process.env.AGENTS_TEST_OPENCODE_BIN,kilo:process.env.AGENTS_TEST_KILO_BIN}
if(!binaries.opencode||!binaries.kilo){console.log('SKIP set AGENTS_TEST_OPENCODE_BIN and AGENTS_TEST_KILO_BIN');process.exit(0)}
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-acp-test-')),home=path.join(temp,'home'),config=path.join(temp,'config'),requests=[],checks=[]
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600})}
const text=message=>typeof message?.content==='string'?message.content:(message?.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n')
let f
const model=http.createServer(async(req,res)=>{
 if(req.method!=='POST'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'native-a'},{id:'native-b'}]}));return}
 let raw='';for await(const chunk of req)raw+=chunk
 const body=JSON.parse(raw),messages=body.messages??[],last=messages.map(m=>m.role).lastIndexOf('user'),prompt=text(messages[last]),scenario=prompt.match(/CASE_[A-Z_]+/)?.[0]??'BOOTSTRAP',after=messages.slice(last+1),called=after.flatMap(m=>m.tool_calls??[]),tools=body.tools??[]
 requests.push({scenario,model:body.model,effort:body.reasoning_effort,thinking:body.thinking,key:req.headers.authorization,hasImage:messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')),tools:tools.map(t=>t.function?.name)})
 const find=needle=>tools.find(t=>t.function?.name.includes(needle))?.function?.name
 let tool,args
 if(scenario==='BOOTSTRAP'){
  tool=find('agents_company_documentation')
  const operations=called.filter(t=>t.function.name===tool).map(t=>JSON.parse(t.function.arguments).operation)
  args={operation:!operations.includes('identity')?'identity':!operations.includes('index')?'index':null};if(!args.operation)tool=undefined
 }else if(scenario==='CASE_API'&&!called.some(t=>t.function.name.includes('agents_company_api'))){tool=find('agents_company_api');args={command:'plan.query',args:{}}}
 else if(['CASE_DIRECT','CASE_DIRECT_PLAN'].includes(scenario)&&!called.some(t=>t.function.name.includes('agents_company_api'))){tool=find('agents_company_api');args={command:'direct.post',args:{text:'EXPLICIT_'+scenario,clientMessageId:scenario}}}
 else if(['CASE_WRITE_ALLOW','CASE_WRITE_DENY','CASE_PLAN_WRITE'].includes(scenario)&&!called.length){tool=tools.find(t=>t.function?.name==='write')?.function.name;args={filePath:path.join(f.currentCwd,scenario+'.txt'),content:scenario}}
 else if(scenario==='CASE_CANCEL'&&!called.length){tool=tools.find(t=>t.function?.name==='bash')?.function.name;args={command:'sleep 2; printf unexpected > cancelled.txt',description:'Disposable cancellation fixture'}}
 res.writeHead(200,{'content-type':'text/event-stream'})
 const send=(delta,finish)=>res.write('data: '+JSON.stringify({id:'fixture-'+requests.length,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n')
 if(tool){send({role:'assistant',tool_calls:[{index:0,id:'call_'+requests.length,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]},null);send({},'tool_calls')}
 else{send({role:'assistant',content:scenario==='BOOTSTRAP'?'OK':'NATIVE_OK '+scenario},null);send({},'stop')}
 res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${model.address().port}/v1`
try{
 fs.mkdirSync(home,{recursive:true})
 for(const engine of Object.keys(binaries))write(path.join(config,engine,engine+'.jsonc'),{
  model:'native/native-a',enabled_providers:['native'],permission:{'*':'allow',read:'allow',edit:'allow',bash:'allow'},
  provider:{native:{npm:'@ai-sdk/openai-compatible',name:'Native fixture',options:{baseURL:endpoint,apiKey:'fixture-'+engine+'-key'},models:Object.fromEntries(['native-a','native-b'].map(id=>[id,{name:id,tool_call:true,reasoning:true,attachment:true,modalities:{input:['text','image'],output:['text']},limit:{context:128000,output:4096},variants:{low:{reasoningEffort:'low'},high:{reasoningEffort:'high'},max:{reasoningEffort:'max'}}}]))}}
 })
 f=await fixtureCore({HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:config,XDG_DATA_HOME:path.join(temp,'data'),XDG_STATE_HOME:path.join(temp,'state'),XDG_CACHE_HOME:path.join(temp,'cache'),OPENCODE_BIN:binaries.opencode,KILO_BIN:binaries.kilo})
 const rpc=async(cmd,args={})=>{const result=await f.request(null,cmd,args);assert.equal(result.ok,true,result.error);return result.data}
 const idle=card=>f.until(async()=>!(await f.status(card.id)).busy,'native ACP idle')
 const send=async(card,message,images=[])=>{await rpc('session.send',{employee:card.id,text:message,images});await idle(card);const status=await f.status(card.id);const snapshot=await rpc('session.snapshot',{id:status.sessionId});assert.ok(!snapshot.error,snapshot.error);return snapshot}
 await f.cli('group','add','Local')
 const listed=await rpc('engine.list');for(const engine of Object.keys(binaries))assert.ok(listed.some(d=>d.engine===engine))
 for(const engine of Object.keys(binaries)){
  const catalog=await rpc('engine.models',{engine});assert.deepEqual(catalog.models.map(m=>m.value).sort(),['native/native-a','native/native-b']);assert.equal(catalog.defaultModel,'native/native-a')
  const providers=await rpc('engine.providers',{engine});assert.equal(providers.source,'native');assert.equal(providers.profiles.length,1);assert.ok(!JSON.stringify(providers).includes('fixture-'+engine+'-key'))
  const health=await rpc('engine.check',{engine,force:true});assert.equal(health.protocol,'compatible');assert.equal(health.ready,true)
  const card=await f.cli('card','create','--title',engine+' native','--group','Local','--engine',engine,'--model','native/native-a','--effort','low');f.currentCwd=card.cwd;await f.ready(card.id)
  await send(card,'CASE_TEXT');let status=await f.status(card.id);assert.equal(status.engine,engine)
  const account=await rpc('engine.inspect',{id:status.sessionId,section:'account'});assert.equal(account.provider,'native');const capabilities=await rpc('engine.inspect',{id:status.sessionId,section:'capabilities'});assert.ok(capabilities.operations.includes('config.effort'));await assert.rejects(()=>rpc('card.clone',{id:card.id,title:'Unsupported clone'}),/does not support native session cloning/)
  const image=(await (await import('sharp')).default({create:{width:4,height:4,channels:3,background:'#4285f4'}}).png().toBuffer()).toString('base64');await rpc('workspace.write',{employee:card.id,path:'fixture.png',contentBase64:image,create:true});await send(card,'CASE_IMAGE',['fixture.png']);assert.ok(requests.some(r=>r.scenario==='CASE_IMAGE'&&r.hasImage));
  await send(card,'CASE_API');assert.ok(requests.some(r=>r.scenario==='CASE_API'&&r.tools.some(t=>t.includes('agents_company_api'))))
  await send(card,'CASE_DIRECT');assert.equal((await rpc('direct.history',{employee:card.id})).items.length,1)
  for(const decision of ['deny','allow']){
   const scenario='CASE_WRITE_'+decision.toUpperCase();await rpc('session.send',{employee:card.id,text:scenario})
   const approval=await f.until(async()=>{status=await f.status(card.id);return (await f.cli('approval','list',status.sessionId))[0]},'actual native ACP approval')
   await rpc('approval.respond',{id:status.sessionId,requestId:approval.id,decision});await idle(card)
   assert.equal(fs.existsSync(path.join(card.cwd,scenario+'.txt')),decision==='allow',engine+' must obey actual Core approval despite native global allow')
  }
  status=await f.status(card.id);await rpc('config.plan',{id:status.sessionId,enabled:true});await send(card,'CASE_DIRECT_PLAN');assert.equal((await rpc('direct.history',{employee:card.id})).items.length,2);await rpc('session.send',{employee:card.id,text:'CASE_PLAN_WRITE'});await idle(card);assert.ok(!fs.existsSync(path.join(card.cwd,'CASE_PLAN_WRITE.txt')));await rpc('config.plan',{id:status.sessionId,enabled:false})
  await rpc('config.model',{id:status.sessionId,model:'native/native-b'});await rpc('config.effort',{id:status.sessionId,effort:'high'});await send(card,'CASE_MODEL');assert.ok(requests.some(r=>r.scenario==='CASE_MODEL'&&r.model==='native-b'&&r.effort==='high'))
  await rpc('session.send',{employee:card.id,text:'CASE_CANCEL'});const cancellation=await f.until(async()=>(await f.cli('approval','list',status.sessionId))[0],'native bash approval');await rpc('approval.respond',{id:status.sessionId,requestId:cancellation.id,decision:'allow'});await new Promise(resolve=>setTimeout(resolve,150));await rpc('session.interrupt',{employee:card.id});await idle(card);await new Promise(resolve=>setTimeout(resolve,2200));assert.ok(!fs.existsSync(path.join(card.cwd,'cancelled.txt')),'interrupt must stop native command');
  const saved=(await rpc('session.list')).sessions.find(c=>c.id===card.id),native=saved.nativeSessions.find(r=>r.engine===engine);assert.match(native.id,/^ses_/)
  await rpc('session.close',{id:status.sessionId});await send(card,'CASE_RESUME');const resumed=(await rpc('session.list')).sessions.find(c=>c.id===card.id);assert.equal(resumed.nativeSessions.find(r=>r.engine===engine).id,native.id)
  const actor=await f.token(card.id),spec={name:engine+' future self task',action:{type:'agent',employeeId:'self',prompt:'CASE_SCHEDULE'},rule:{kind:'once',at:new Date(Date.now()+86400000).toISOString()},enabled:false}
  const plan=await f.request(actor,'schedule.create',{spec});assert.equal(plan.ok,true,plan.error);assert.equal(plan.data.action.engine,engine)
  const worker=await rpc('worker.create',{employee:card.id,engine});assert.equal(worker.engine,engine);await rpc('worker.remove',{id:worker.id})
  await assert.rejects(()=>rpc('engine.configure',{engine,patch:{inheritNative:false}}),/native/)
  await assert.rejects(()=>rpc('engine.models',{engine,kind:'cloud-native-worker'}),/Core-local/)
  checks.push(engine+': actual native discovery, hidden identity/index initialization, streaming, employee API, Core allow/deny over native allow-all, plan no-write, model/effort, image wire input, running native command cancellation, same-ID resume, own Plan and Worker registration')
 }
 assert.ok(requests.every(r=>r.key==='Bearer fixture-opencode-key'||r.key==='Bearer fixture-kilo-key'))
 const evidence={passed:true,actualInstalledEngines:true,model:'Deterministic loopback fixture',paidCalls:0,productionDataUsed:false,checks,requests:requests.map(({key,...r})=>r)}
 fs.mkdirSync(path.join(root,'artifacts/additional-engines'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/additional-engines/native-core-result.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS native OpenCode/Kilo '+checks.length+' engine workflows, '+requests.length+' loopback requests')
}catch(error){fs.writeFileSync(path.join(root,'artifacts/additional-engines/native-core-failure.json'),JSON.stringify({error:String(error),requests:requests.map(({key,...r})=>r)},null,2));throw error}finally{await f?.close();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
