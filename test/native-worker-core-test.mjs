// Actual Core/CLI, native PTY and role boundaries; no real model or user data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-native-worker-')),capture=path.join(temp,'capture.jsonl'),fixture=path.join(root,'test/fixtures/native-worker.cjs')
fs.chmodSync(fixture,0o755)
const overrides={CODEX_BIN:fixture,CLAUDE_BIN:fixture,CLINE_BIN:fixture,PI_BIN:fixture,OPENCODE_BIN:fixture,KILO_BIN:fixture,NATIVE_WORKER_CAPTURE:capture,AGENTS_COMPANY_WORKER_SENTINEL:'synthetic-do-not-inherit',AEXUS_WORKER_SENTINEL:'synthetic-do-not-inherit'}
const engines=['codex','claude','cline','pi','opencode','kilo']
const f=await fixtureCore(overrides),checks=[]
const rpc=async(token,cmd,args={})=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,value.error);return value.data}
const denied=async(token,cmd,args={})=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' must reject');return value.error}
const events=()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await f.cli('group','add','Native Workers')
 const employees=[],tokens=[]
 for(const role of ['employee','manager','governor','secretary']){const employee=await f.create(role,'Native Workers',role);employees.push(employee);tokens.push(await f.token(employee.id))}
 for(const engine of engines.slice(4)){const employee=await f.create(engine,'Native Workers','employee');employees.push(employee);tokens.push(await f.token(employee.id))}
 const first=employees[0],nativeHome=f.env.CODEX_HOME;fs.mkdirSync(nativeHome,{recursive:true});fs.writeFileSync(path.join(nativeHome,'history.fixture'),'native history retained')
 const project=path.join(first.cwd,'plain project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'AGENTS.md'),'User-authored native instructions.');fs.writeFileSync(path.join(project,'keep.txt'),'keep')
 const workers=[]
 for(let i=0;i<employees.length;i++)workers.push(i===0?await f.call(tokens[0],'worker','create','--engine','codex','--title','Native 0','--cwd','plain project'):await rpc(tokens[i],'worker.create',{engine:engines[i],title:'Native '+i}))
 assert.equal((await f.cli('session','list')).sessions.length,6);assert.equal(events().length,0)
 assert.ok(workers.every(w=>!w.running&&!w.terminal));pass('All employee roles create directly owned Workers without onboarding, inference or new employee identities')
 for(let i=0;i<3;i++)assert.deepEqual((await rpc(tokens[i],'worker.list')).map(w=>w.id),[workers[i].id])
 assert.equal((await f.cli('worker','list')).length,6)
 for(let i=1;i<3;i++){
  for(const cmd of ['worker.start','worker.read','worker.input','worker.resize','worker.interrupt','worker.stop','worker.remove'])await denied(tokens[i],cmd,{id:workers[0].id,data:'forbidden',cols:80,rows:24})
  await denied(tokens[i],'worker.create',{employee:first.id,engine:'codex'});await denied(tokens[i],'worker.list',{employee:first.id})
 }
 assert.equal((await rpc(tokens[3],'worker.list')).length,6);assert.equal((await rpc(tokens[3],'worker.list',{employee:first.id}))[0].id,workers[0].id);pass('Manager and Governor retain direct ownership; user and Secretary administer all Workers without changing their owners')
 await denied(tokens[0],'worker.create',{engine:'codex',cwd:'../outside'});const link=path.join(first.cwd,'escape');fs.symlinkSync(temp,link,'dir');await denied(tokens[0],'worker.create',{engine:'codex',cwd:'escape'})
 pass('Worker directory boundaries resolve real paths and reject sibling or symlink escapes')
 for(let i=0;i<workers.length;i++){
  const w=await rpc(tokens[i],'worker.start',{id:workers[i].id,cols:100,rows:28});workers[i]=w
  await f.until(()=>events().filter(e=>e.type==='start').length===i+1,'native CLI startup')
  const event=events().filter(e=>e.type==='start')[i]
  assert.deepEqual(event.argv,[]);assert.equal(event.cwd,i===0?project:employees[i].cwd);assert.equal(event.home,nativeHome)
  assert.equal(event.keys.some(k=>/^(AGENTS_|AEXUS_)/.test(k)),false);assert.equal(event.keys.includes('ELECTRON_RUN_AS_NODE'),false)
  assert.doesNotMatch(event.path,/\.agents-company|AgentsCompany\/(?:cli|agent-access)/)
  await denied(tokens[i],'terminal.read',{id:w.terminal});await denied(tokens[3],'terminal.input',{id:w.terminal,data:'bypass'})
  assert.equal((await f.cli('terminal','list')).some(t=>t.id===w.terminal),false)
  const again=await rpc(tokens[i],'worker.start',{id:w.id});assert.equal(again.terminal,w.terminal)
 }
 pass('All engine launches receive empty argv, exact cwd and native config; no Company identity, CLI path, role prompt, MCP or nested-session marker')
 const starts=events().filter(e=>e.type==='start'),pids=starts.map(e=>e.pid);assert.equal(starts.length,workers.length)
 const literal='请改代码 $(touch SHOULD_NOT_RUN) `echo literal`',id=workers[0].id
 for(let i=0;i<workers.length;i++){
  await f.call(tokens[i],'worker','input',workers[i].id,'--data',literal,'--enter')
  await f.until(()=>events().filter(e=>e.type==='input'&&e.pid===pids[i]).map(e=>e.text).join('').includes(literal+'\r'),'literal input '+engines[i])
  assert.equal(fs.existsSync(path.join(employees[i].cwd,'SHOULD_NOT_RUN')),false)
 }
 assert.equal(fs.existsSync(path.join(project,'SHOULD_NOT_RUN')),false)
 const output=await rpc(tokens[3],'worker.read',{id,cursor:0,waitMs:100});assert.match(output.output,/NATIVE WORKER READY/);assert.ok(output.cursor>0)
 await rpc(tokens[3],'worker.resize',{id,cols:86,rows:27});await rpc(tokens[0],'worker.interrupt',{id})
 await f.until(async()=>!(await rpc(tokens[0],'worker.list'))[0].running,'native interrupt')
 const restarted=await rpc(tokens[0],'worker.start',{id});assert.notEqual(restarted.terminal,workers[0].terminal)
 await f.until(()=>events().filter(e=>e.type==='start').length===7,'fresh restart');assert.deepEqual(events().filter(e=>e.type==='start').at(-1).argv,[])
 pass('CLI input is literal Unicode/control data; resize, incremental output, interrupt and fresh native restart work without shell interpolation or inherited context')
 await rpc(tokens[0],'worker.stop',{id});assert.equal((await rpc(tokens[0],'worker.list'))[0].running,false)
 await rpc(tokens[0],'worker.remove',{id});assert.equal((await rpc(tokens[0],'worker.list')).length,0)
 assert.equal(fs.readFileSync(path.join(project,'AGENTS.md'),'utf8'),'User-authored native instructions.');assert.equal(fs.readFileSync(path.join(project,'keep.txt'),'utf8'),'keep');assert.equal(fs.readFileSync(path.join(nativeHome,'history.fixture'),'utf8'),'native history retained')
 await f.cli('card','remove',employees[1].id);assert.equal((await f.cli('worker','list')).some(w=>w.employee===employees[1].id),false)
 assert.equal(fs.existsSync(employees[1].cwd),true)
 pass('Stop/remove and employee deletion clean processes and ownership records while preserving work files, user instructions and native history')
 await f.stop();await f.start();assert.ok((await f.cli('worker','list')).every(w=>!w.running&&!w.terminal));assert.equal((await f.cli('worker','list')).length,4)
 pass('Worker records survive Core restart without auto-launch or auto-resume')
 const stateFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.sessions.find(card=>card.id===employees[2].id).accessMode='isolated';fs.writeFileSync(stateFile,JSON.stringify(state))
 assert.match(await denied(tokens[2],'worker.start',{id:workers[2].id}),/严格隔离/)
 await f.cli('auth','revoke',employees[3].id);await denied(tokens[3],'worker.list')
 pass('Strict isolation is never bypassed and revoked employee credentials cannot use Worker APIs')
 fs.mkdirSync(path.join(root,'artifacts/native-workers'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/native-workers/core-result.json'),JSON.stringify({passed:true,checks,providerCalls:0},null,2)+'\n')
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true})}
