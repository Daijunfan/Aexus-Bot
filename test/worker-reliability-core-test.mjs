import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=process.cwd(),f=await fixtureCore({AC_NATIVE_WORKER_FIXTURE:'1'}),checks=[]
const turns=()=>{const file=path.join(f.control,path.basename(ownerCwd)+'-native-turns.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};let ownerCwd
const call=async(cmd,args={},token=null)=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,result.error);return result.data}
const denied=async(cmd,args,token)=>{const result=await f.request(token,cmd,args);assert.equal(result.ok,false);return result.error}
const pass=value=>{checks.push(value);console.log('PASS '+value)}
try{
 await call('group.add',{name:'Worker reliability'});const owner=await f.create('Owner','Worker reliability'),other=await f.create('Other','Worker reliability'),token=await f.token(owner.id),foreign=await f.token(other.id)
 const args={employee:owner.id,engine:'codex',title:'Stable Worker',clientRequestId:'stable-worker-create'}
 const first=await call('worker.create',args);ownerCwd=first.cwd;const again=await call('worker.create',args);assert.equal(first.id,again.id);assert.equal((await call('worker.list')).length,1);assert.equal(first.clientRequestId,undefined);assert.equal(first.createdBy,undefined)
 await denied('worker.create',{...args,title:'Changed settings'});await denied('worker.create',args,foreign)
 await f.stop();await f.start();assert.equal((await call('worker.create',args)).id,first.id)
 pass('A creation retry and Core restart return one caller-owned Worker; changed settings and foreign ownership fail')
 const draft=await f.cli('worker','draft',first.id,'--text','Unsent work\n保留这一行','--expected-revision','0');assert.equal(draft.applied,true);assert.equal(draft.draft.revision,1)
 await denied('worker.draft',{id:first.id,text:'Foreign draft'},foreign)
 const peer=await call('worker.draft',{id:first.id,text:'Newer draft',expectedRevision:1},token);assert.equal(peer.applied,true)
 const stale=await call('worker.draft',{id:first.id,text:'',expectedRevision:1});assert.equal(stale.applied,false);assert.equal(stale.draft.text,'Newer draft')
 assert.equal(turns().length,0,'saving drafts never runs a native task')
 await f.stop();await f.start();assert.deepEqual((await call('worker.list'))[0].draft,{text:'Newer draft',revision:2})
 pass('Worker drafts survive restart, obey direct ownership and reject a late conditional clear without starting an engine')
 const started=await call('worker.start',{id:first.id});assert.equal(started.running,true);assert.equal(started.terminal,undefined)
 await denied('worker.input',{id:first.id,data:'\u001b[A'},token);await denied('worker.resize',{id:first.id,cols:80,rows:24},token)
 const task='One explicit task';await call('worker.send',{id:first.id,text:task,clientMessageId:'stable-task'},token)
 await f.until(()=>turns().some(turn=>turn.text===task),'native input');assert.equal(turns().filter(turn=>turn.text===task).length,1)
 const stopped=await call('worker.stop',{id:first.id});assert.equal(stopped.running,false)
 assert.match((await call('worker.read',{id:first.id,cursor:0})).output,/One explicit task/)
 const restarted=await call('worker.start',{id:first.id});assert.equal(restarted.running,true)
 const retry=await call('worker.send',{id:first.id,text:task,clientMessageId:'stable-task'},token);assert.equal(retry.duplicate,true);assert.equal(turns().filter(turn=>turn.text===task).length,1)
 await denied('worker.send',{id:first.id,text:'MUST_NOT_REACH_NEW_PROCESS',clientMessageId:'stable-task'},token);assert.ok(!JSON.stringify(turns()).includes('MUST_NOT_REACH_NEW_PROCESS'))
 assert.equal((await call('worker.list'))[0].draft.text,'Newer draft')
 await call('worker.remove',{id:first.id});assert.equal((await call('worker.list')).length,0);assert.ok(fs.existsSync(owner.cwd))
 pass('Stop retains output for review; restart preserves task deduplication, stale retry cannot reach it, and removal preserves work files')
 fs.mkdirSync('artifacts/product-polish-v2',{recursive:true});fs.writeFileSync('artifacts/product-polish-v2/worker-core.json',JSON.stringify({passed:true,checks,paidModelCalls:0,productionDataUsed:false},null,2))
}finally{await f.close()}
