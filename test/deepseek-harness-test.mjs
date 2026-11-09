// Real DSH process, temporary Core/profile/workspace, deterministic Messages server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {stringify} from 'yaml'
import {createRequire} from 'node:module'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {fixtureCore} from './fixtures/headless-core.mjs'
const binary=process.env.AGENTS_TEST_DSH_BIN
if(!binary){console.log('SKIP: set AGENTS_TEST_DSH_BIN to run installed Harness against loopback');process.exit(0)}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-dsh-test-')),home=path.join(temp,'dsh'),requests=[]
fs.mkdirSync(home)
fs.writeFileSync(path.join(home,'.credentials.yaml'),'version: 1\nrefs:\n  DEEPSEEK_API_KEY: fixture-deepseek-key\n',{mode:0o600})
let f,app,page
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk
 if(!raw){res.writeHead(404).end();return}
 const body=JSON.parse(raw),messages=body.messages??[],text=messages.flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(c=>c.type==='text').map(c=>c.text)).join('\n'),scenario=text.match(/CASE_[A-Z_]+/g)?.at(-1)??'BOOTSTRAP'
 const calls=messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_use'):[])
 const find=needle=>body.tools?.find(t=>t.name.includes(needle))?.name
 let name,input
 if(scenario==='BOOTSTRAP'){
  name=find('agents_company_documentation');const read=calls.filter(c=>c.name===name).map(c=>c.input.operation)
  input={operation:!read.includes('identity')?'identity':!read.includes('index')?'index':null};if(!input.operation)name=undefined
 }else if(scenario==='CASE_PRIVATE'&&!calls.some(c=>c.input?.command==='direct.post')){name=find('agents_company_api');input={command:'direct.post',args:{text:'DSH private reply',clientMessageId:'fixture-private'}}}
 else if(scenario==='CASE_API'&&!calls.some(c=>c.input?.command==='plan.query')){name=find('agents_company_api');input={command:'plan.query',args:{}}}
 else if(scenario==='CASE_READ'&&!calls.some(c=>c.input?.file_path)){name=find('read');input={file_path:path.join(temp,'outside.txt')}}
 else if(scenario==='CASE_BYPASS'&&!calls.some(c=>c.input?.command?.includes('BYPASS_MARKER'))){name=find('bash');input={command:'printf allowed > BYPASS_MARKER',description:'Explicit user bypass'}}
 else if(scenario==='CASE_DENY'&&!calls.some(c=>c.input?.command?.includes('DENIED_MARKER'))){name=find('bash');input={command:'printf denied > DENIED_MARKER',description:'Fixture denial'}}
 else if(scenario==='CASE_ALLOW'&&!calls.some(c=>c.input?.command?.includes('ALLOWED_MARKER'))){name=find('bash');input={command:'printf allowed > ALLOWED_MARKER',description:'Fixture approval'}}
 else if(scenario==='CASE_CANCEL'&&!calls.some(c=>c.input?.command?.includes('CANCELLED_MARKER'))){name=find('bash');input={command:'sleep 5; printf bad > CANCELLED_MARKER',description:'Fixture cancellation'}}
 requests.push({scenario,tools:body.tools?.map(t=>t.name),model:body.model,effort:body.output_config?.effort,key:req.headers['x-api-key']})
 const content=name?{type:'tool_use',id:'call_'+requests.length,name,input}:{type:'text',text:'DSH_OK '+scenario},stop=name?'tool_use':'end_turn'
 const message={id:'msg_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}
 res.writeHead(200,{'content-type':'text/event-stream'})
 const events=[{type:'message_start',message},{type:'content_block_start',index:0,content_block:name?{...content,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:name?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:content.text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'}]
 for(const e of events)res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');res.end()
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
fs.writeFileSync(path.join(home,'cordis.patch.yml'),stringify([{id:'llm-deepseek',config:{baseURL:`http://127.0.0.1:${server.address().port}`,models:[{id:'fixture-model',contextWindow:1000000,maxTokens:4096}]}},{id:'acp',config:{provider:'deepseek-official',model:'fixture-model'}}]))
try{
 f=await fixtureCore({DSH_HOME:home,DEEPSEEK_BIN:binary,DEEPSEEK_API_KEY:'',HOME:path.join(temp,'home'),NO_PROXY:'127.0.0.1,localhost'})
 if(process.argv.includes('--desktop')){
  await f.stop();const {_electron:electron}=await import('@playwright/test'),require=createRequire(import.meta.url),application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1100'};delete env.ELECTRON_RUN_AS_NODE
  app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[f.root],env});page=await app.firstWindow();page.setDefaultTimeout(20000);await page.locator('.infinite-canvas').waitFor()
 }
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.equal(r.ok,true,r.error);return r.data}
 const idle=id=>f.until(async()=>!(await f.status(id)).busy,'DSH idle')
 assert.ok((await rpc('engine.list')).some(e=>e.engine==='deepseek'))
 const catalog=await rpc('engine.models',{engine:'deepseek'});assert.ok(catalog.models.some(m=>m.value.includes('fixture-model')));assert.equal(requests.length,0)
 assert.equal((await rpc('engine.check',{engine:'deepseek',force:true})).ready,true);assert.equal(requests.length,0)
 await f.cli('group','add','Local')
 for(const permissionMode of ['auto','plan'])await assert.rejects(()=>rpc('card.create',{title:'Unsupported',group:'Local',engine:'deepseek',permissionMode}),/Plan or Auto/)
 await assert.rejects(()=>rpc('card.create',{title:'Unsupported',group:'Local',engine:'deepseek',accessMode:'isolated'}),/isolation/)
 assert.equal((await rpc('session.list')).sessions.length,0)
 let card
 if(page){
  const {expect}=await import('@playwright/test');await rpc('settings.set',{language:'en'});await page.locator('.add-employee').click()
  await page.locator('.employee-form input[name="title"]').fill('DSH fixture');await page.locator('.engine-choices button[data-engine="deepseek"]').click()
  const modelSelect=page.locator('.employee-form select[name="model"]');await expect(modelSelect).toBeEnabled({timeout:20000});await modelSelect.locator('..').locator('.app-select-trigger').click();await page.getByRole('option',{name:'fixture-model',exact:true}).click();await expect(modelSelect).toHaveValue(catalog.defaultModel)
  const out=path.join(f.root,'artifacts/deepseek-harness');fs.mkdirSync(out,{recursive:true});await page.locator('.creation-panel').screenshot({path:path.join(out,'create-employee.png')})
  await page.locator('.save-employee').click();await expect(page.locator('.employee-form')).toHaveCount(0)
  card=(await rpc('session.list')).sessions.find(c=>c.title==='DSH fixture');assert.ok(card);assert.equal(card.engine,'deepseek')
 }else card=await f.cli('card','create','--title','DSH fixture','--group','Local','--engine','deepseek')
 await f.ready(card.id)
 const send=async text=>{await rpc('session.send',{employee:card.id,text});await idle(card.id);const s=await f.status(card.id);const snap=await rpc('session.snapshot',{id:s.sessionId});assert.ok(!snap.error,snap.error);return snap}
 await send('CASE_API')
 await send('CASE_PRIVATE');assert.equal((await rpc('direct.history',{employee:card.id})).items.length,1)
 const actor=await f.token(card.id),spec={name:'DSH future task',action:{type:'agent',employeeId:'self',prompt:'CASE_SCHEDULE'},rule:{kind:'once',at:new Date(Date.now()+86400000).toISOString()},enabled:false}
 const plan=await f.request(actor,'schedule.create',{spec});assert.equal(plan.ok,true,plan.error);assert.equal(plan.data.action.engine,'deepseek')
 for(const [scenario,decision,marker] of [['CASE_DENY','deny','DENIED_MARKER'],['CASE_ALLOW','allow','ALLOWED_MARKER']]){
  await rpc('session.send',{employee:card.id,text:scenario})
  const pending=await f.until(async()=>{const s=await f.status(card.id);return (await f.cli('approval','list',s.sessionId))[0]},'Core approval '+scenario)
  await rpc('approval.respond',{id:(await f.status(card.id)).sessionId,requestId:pending.id,decision});await idle(card.id)
  assert.equal(fs.existsSync(path.join(card.cwd,marker)),decision==='allow')
 }
 await rpc('config.permission',{id:(await f.status(card.id)).sessionId,mode:'bypassPermissions'})
 await send('CASE_BYPASS');assert.ok(fs.existsSync(path.join(card.cwd,'BYPASS_MARKER')))
 await rpc('config.permission',{id:(await f.status(card.id)).sessionId,mode:'default'})
 fs.writeFileSync(path.join(temp,'outside.txt'),'outside fixture')
 await rpc('session.send',{employee:card.id,text:'CASE_READ'})
 const readApproval=await f.until(async()=>{const s=await f.status(card.id);return (await f.cli('approval','list',s.sessionId))[0]},'external read requires Core approval')
 await rpc('approval.respond',{id:(await f.status(card.id)).sessionId,requestId:readApproval.id,decision:'deny'});await idle(card.id)
 await rpc('session.send',{employee:card.id,text:'CASE_CANCEL'})
 const cancelApproval=await f.until(async()=>{const s=await f.status(card.id);return (await f.cli('approval','list',s.sessionId))[0]},'cancel approval')
 await rpc('approval.respond',{id:(await f.status(card.id)).sessionId,requestId:cancelApproval.id,decision:'allow'})
 await new Promise(resolve=>setTimeout(resolve,150))
 await rpc('session.interrupt',{employee:card.id});await idle(card.id)
 await new Promise(resolve=>setTimeout(resolve,5200))
 assert.ok(!fs.existsSync(path.join(card.cwd,'CANCELLED_MARKER')))
 await rpc('config.effort',{id:(await f.status(card.id)).sessionId,effort:'high'})
 await send('CASE_EFFORT');assert.equal(requests.at(-1).effort,'high')
 await assert.rejects(()=>rpc('card.update',{id:card.id,patch:{engine:'codex'}}),/engine|引擎/i)
 await assert.rejects(()=>rpc('engine.models',{engine:'deepseek',kind:'cloud-native-worker'}),/Core-local/)
 const saved=(await rpc('session.list')).sessions.find(c=>c.id===card.id),ref=saved.nativeSessions.find(r=>r.engine==='deepseek')
 await rpc('session.close',{id:(await f.status(card.id)).sessionId});await send('CASE_RESUME')
 assert.equal((await rpc('session.list')).sessions.find(c=>c.id===card.id).nativeSessions.find(r=>r.engine==='deepseek').id,ref.id)
 await assert.rejects(()=>rpc('card.access-mode',{id:card.id,mode:'isolated'}),/isolation/)
 const manager=await f.create('Isolated manager','Local','manager'),managerToken=await f.token(manager.id)
 const stateFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),stored=JSON.parse(fs.readFileSync(stateFile,'utf8'));stored.sessions.find(c=>c.id===manager.id).accessMode='isolated';fs.writeFileSync(stateFile,JSON.stringify(stored))
 for(const [cmd,args] of [['config.permission',{id:(await f.status(card.id)).sessionId,mode:'bypassPermissions'}],['card.access-mode',{id:card.id,mode:'trusted'}]]){const denied=await f.request(managerToken,cmd,args);assert.equal(denied.ok,false);assert.match(denied.error,/Forbidden|Only the user/)}
 const rejected=await f.request(managerToken,'card.create',{title:'Inherited isolation',group:'Local',engine:'deepseek',accessMode:'trusted'})
 assert.equal(rejected.ok,false);assert.match(rejected.error,/isolation/);assert.equal((await rpc('session.list')).sessions.length,2)
 const activeId=(await f.status(card.id)).sessionId
 await assert.rejects(()=>rpc('config.plan',{id:activeId,enabled:true}),/Plan/)
 assert.ok(requests.every(r=>r.model==='fixture-model'))
 assert.ok(requests.every(r=>r.key==='fixture-deepseek-key'))
 assert.ok(requests.some(r=>r.scenario==='CASE_API'))
 console.log('PASS DeepSeek Harness: discovery without inference, Core initialization/API/private reply/own schedule, approval allow/deny, running command cancellation, effort, fixed identity, same-ID resume; '+requests.length+' loopback calls, zero paid calls')
}catch(error){console.error('Requests:',requests.map(({key,tools,...r})=>({...r,tools:tools?.filter(t=>/documentation|api|bash/.test(t))})));throw error}
finally{await app?.close();await f?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
