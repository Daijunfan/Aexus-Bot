// Isolated Core with deterministic native protocols, no real model or user data.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {workerWorkbenchFixture} from './fixtures/worker-workbench.mjs'
const f=await workerWorkbenchFixture({AGENTS_COMPANY_WORKER_SENTINEL:'synthetic-do-not-inherit',AEXUS_WORKER_SENTINEL:'synthetic-do-not-inherit'}),checks=[]
const rpc=async(token,cmd,args={})=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(token,cmd,args={})=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r.error},pass=x=>{checks.push(x);console.log('PASS '+x)}
try{
 await f.cli('group','add','Native Workers');const employees=[],tokens=[]
 for(const role of ['employee','manager','governor','secretary','employee','employee']){const e=await f.create(role+' '+employees.length,'Native Workers',role);employees.push(e);tokens.push(await f.token(e.id))}
 const engines=['codex','claude','cline','pi','opencode','kilo'],workers=[]
 const project=path.join(employees[0].cwd,'plain project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'AGENTS.md'),'User-authored native instructions.');fs.writeFileSync(path.join(project,'keep.txt'),'keep')
 for(let i=0;i<engines.length;i++)workers.push(await rpc(tokens[i],'worker.create',{engine:engines[i],title:'Native '+i,...(i===0?{cwd:project}:{})}))
 assert.equal((await f.cli('session','list')).sessions.length,6);assert.ok(workers.every(w=>!w.running&&!w.terminal));assert.equal((await f.cli('worker','list')).length,6)
 for(let i=0;i<3;i++)assert.deepEqual((await rpc(tokens[i],'worker.list')).map(w=>w.id),[workers[i].id]);assert.equal((await rpc(tokens[3],'worker.list')).length,6)
 for(let i=1;i<3;i++){for(const cmd of ['worker.start','worker.snapshot','worker.send','worker.input','worker.resize','worker.interrupt','worker.stop','worker.remove'])await deny(tokens[i],cmd,{id:workers[0].id,text:'forbidden',data:'forbidden',cols:80,rows:24});await deny(tokens[i],'worker.create',{employee:employees[0].id,engine:'codex'});await deny(tokens[i],'worker.list',{employee:employees[0].id})}
 await deny(tokens[0],'worker.create',{engine:'codex',cwd:'../outside'});fs.symlinkSync(f.temp,path.join(employees[0].cwd,'escape'),'dir');await deny(tokens[0],'worker.create',{engine:'codex',cwd:'escape'})
 pass('Direct ownership, Secretary administration and real-path directory boundaries hold across six engines')
 const literal='请改代码 $(touch SHOULD_NOT_RUN) `echo literal`'
 for(let i=0;i<engines.length;i++){
  const id=workers[i].id;await rpc(tokens[i],'worker.start',{id});let snap=await rpc(tokens[i],'worker.snapshot',{id});assert.equal(snap.worker.state,'ready');assert.ok(snap.models.length);assert.equal(snap.items.length,0);assert.equal(snap.worker.terminal,undefined);assert.equal((await f.cli('terminal','list')).some(t=>t.worker===id),false)
  await deny(tokens[i],'worker.input',{id,data:'\u001b[A'});await deny(tokens[i],'worker.resize',{id,cols:86,rows:27})
  const key=engines[i]+'-literal';await rpc(tokens[i],'worker.send',{id,text:literal,clientMessageId:key});await f.until(async()=>['completed','failed'].includes((await rpc(tokens[i],'worker.snapshot',{id})).receipts.find(r=>r.clientMessageId===key)?.state),'worker '+engines[i]);snap=await rpc(tokens[i],'worker.snapshot',{id});assert.equal(snap.receipts.find(r=>r.clientMessageId===key).state,'completed');assert.ok(snap.items.some(item=>item.role==='user'&&JSON.stringify(item).includes(literal)));assert.ok(snap.worker.nativeSessionId);assert.equal(fs.existsSync(path.join(workers[i].cwd,'SHOULD_NOT_RUN')),false)
  const native=snap.worker.nativeSessionId;await rpc(tokens[i],'worker.stop',{id});await rpc(tokens[i],'worker.start',{id});assert.equal((await rpc(tokens[i],'worker.snapshot',{id})).worker.nativeSessionId,native)
 }
 const proc=JSON.parse(fs.readFileSync(path.join(f.control,path.basename(project)+'-process.json'),'utf8'));assert.deepEqual(proc.controllerEnvironment,[])
 pass('Six native graphical protocols connect without inference or terminals, send literal Unicode once, and resume their native session')
 await rpc(tokens[0],'worker.stop',{id:workers[0].id});await rpc(tokens[0],'worker.remove',{id:workers[0].id});assert.equal(fs.readFileSync(path.join(project,'AGENTS.md'),'utf8'),'User-authored native instructions.');assert.equal(fs.readFileSync(path.join(project,'keep.txt'),'utf8'),'keep')
 await f.cli('card','remove',employees[1].id);assert.equal((await f.cli('worker','list')).some(w=>w.employee===employees[1].id),false);assert.ok(fs.existsSync(employees[1].cwd))
 await f.stop();await f.start();assert.equal((await f.cli('worker','list')).length,4);assert.ok((await f.cli('worker','list')).every(w=>!w.running&&!w.terminal))
 const stateFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.sessions.find(card=>card.id===employees[2].id).accessMode='isolated';fs.writeFileSync(stateFile,JSON.stringify(state));assert.match(await deny(tokens[2],'worker.start',{id:workers[2].id}),/strict isolation|严格隔离/i);await f.cli('auth','revoke',employees[3].id);await deny(tokens[3],'worker.list')
 pass('Removal preserves files; restart does not auto-launch, strict isolation fails closed and revoked credentials fail')
 fs.mkdirSync('artifacts/native-workers',{recursive:true});fs.writeFileSync('artifacts/native-workers/core-result.json',JSON.stringify({passed:true,checks,providerCalls:0},null,2)+'\n')
}finally{await f.close()}
