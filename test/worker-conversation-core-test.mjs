import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=process.cwd(),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/worker-conversations/core');fs.mkdirSync(out,{recursive:true});const f=await fixtureCore({AC_NATIVE_WORKER_FIXTURE:'1'}),checks=[]
const core=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data},deny=async(cmd,args,token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd);return value.error},pass=text=>{checks.push(text);console.log('PASS '+text)}
const turns=name=>{const file=path.join(f.control,name+'-native-turns.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]}
try{
 await core('group.add',{name:'Studio'});const owner=await f.create('Owner','Studio'),peer=await f.create('Peer','Studio'),ownerToken=await f.token(owner.id),peerToken=await f.token(peer.id)
 const one=path.join(f.temp,'codex-one'),two=path.join(f.temp,'codex-two');fs.mkdirSync(one);fs.mkdirSync(two);fs.writeFileSync(path.join(one,'keep.md'),'Retain this work file.')
 const a=await core('worker.create',{engine:'codex',cwd:one,title:'Codex One',clientRequestId:'worker-one'}),b=await core('worker.create',{engine:'codex',cwd:two,title:'Codex Two'}),owned=await core('worker.create',{engine:'codex',employee:owner.id})
 assert.equal((await core('worker.create',{engine:'codex',cwd:one,title:'Codex One',clientRequestId:'worker-one'})).id,a.id)
 for(const cmd of ['worker.snapshot','worker.start','worker.send','worker.stop','worker.remove'])await deny(cmd,{id:a.id,text:'Forbidden task'},peerToken)
 await deny('worker.configure',{id:owned.id,permissionMode:'bypassPermissions'},ownerToken);await deny('worker.snapshot',{id:owned.id},peerToken);assert.equal((await core('worker.snapshot',{id:owned.id},ownerToken)).worker.id,owned.id)
 await deny('worker.create',{engine:'codex',employee:owner.id,cwd:one},ownerToken)
 pass('Worker creation remains idempotent, native identity is separate from employees, and direct ownership and folder boundaries hold')
 await core('worker.start',{id:a.id});const connected=await core('worker.snapshot',{id:a.id});assert.equal(connected.worker.state,'ready');assert.ok(connected.models.length);assert.equal(turns('codex-one').length,0);assert.equal(connected.items.length,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.control,'codex-one-process.json'),'utf8')).controllerEnvironment,[]);assert.equal((await core('terminal.list')).filter(terminal=>terminal.worker===a.id).length,0)
 await deny('worker.input',{id:a.id,data:'\u001b[A'});await deny('worker.resize',{id:a.id,cols:80,rows:24})
 pass('Connecting discovers real native capabilities without inference, a PTY, an employee prompt or a task')
 fs.writeFileSync(path.join(f.control,'codex-one.hold-user'),'');fs.writeFileSync(path.join(f.control,'codex-one.stream.txt'),'Working through the native graphical connection…')
 const text='First line of one task.\n第二行必须属于同一个任务。',sent=await core('worker.send',{id:a.id,text,clientMessageId:'one-task'});assert.equal(sent.accepted,true);await f.until(()=>turns('codex-one').length===1,'first native Worker task');assert.equal(turns('codex-one')[0].text,text)
 const duplicate=await core('worker.send',{id:a.id,text,clientMessageId:'one-task'});assert.equal(duplicate.duplicate,true);assert.equal(turns('codex-one').length,1);await deny('worker.send',{id:a.id,text:'Changed body',clientMessageId:'one-task'})
 await core('worker.send',{id:b.id,text:'Another Worker is independent.',clientMessageId:'peer-task'});await f.until(async()=>(await core('worker.snapshot',{id:b.id})).items.some(item=>item.role==='assistant'),'second Worker response')
 assert.equal((await core('worker.snapshot',{id:a.id})).worker.busy,true)
 pass('Multiline text is one unwrapped native turn; retries never duplicate it and another Worker can finish independently')
 const second=await core('worker.send',{id:a.id,text:'Second task to cancel',clientMessageId:'second-task'}),third=await core('worker.send',{id:a.id,text:'Third ordered task',clientMessageId:'third-task'});assert.equal((await core('worker.snapshot',{id:a.id})).pendingMessages.length,2)
 await core('worker.dequeue',{id:a.id,messageId:second.receipt.id});await deny('worker.interrupt',{id:a.id,expectedMessageId:'a-stale-task'});assert.equal((await core('worker.snapshot',{id:a.id})).worker.busy,true)
 fs.rmSync(path.join(f.control,'codex-one.hold-user'));await f.until(()=>turns('codex-one').length===2,'queued Worker task');await f.until(async()=>!(await core('worker.snapshot',{id:a.id})).worker.busy,'queue finished');assert.deepEqual(turns('codex-one').map(item=>item.text),[text,'Third ordered task'])
 const native=(await core('worker.snapshot',{id:a.id})).worker.nativeSessionId;assert.ok(native);assert.equal(new Set(turns('codex-one').map(item=>item.thread)).size,1)
 pass('The native thread is retained across turns, queue order is exact, cancellation removes only its item and stale Stop cannot interrupt newer work')
 fs.writeFileSync(path.join(f.control,'codex-one.board-approval'),'');await core('worker.send',{id:a.id,text:'Request a native approval',clientMessageId:'approval-task'});await f.until(async()=>(await core('worker.snapshot',{id:a.id})).approvals.length,'native permission visible');const approval=(await core('worker.snapshot',{id:a.id})).approvals[0]
 await deny('worker.respond',{id:a.id,requestId:approval.id,decision:'allow',answers:{choice:['Continue']}},peerToken);await core('worker.respond',{id:a.id,requestId:approval.id,decision:'allow',answers:{choice:['Continue']}});await f.until(async()=>!(await core('worker.snapshot',{id:a.id})).worker.busy,'approval completed');fs.rmSync(path.join(f.control,'codex-one.board-approval'));assert.equal((await core('worker.snapshot',{id:a.id})).approvals.length,0)
 pass('Native questions cross the authenticated Worker API, reject foreign callers and resume only after the selected answer')
 const draft=await core('worker.draft',{id:a.id,text:'Keep a newer unsent draft',expectedRevision:0});const newer=await core('worker.draft',{id:a.id,text:'Newer draft',expectedRevision:draft.draft.revision});assert.equal((await core('worker.draft',{id:a.id,text:'',expectedRevision:draft.draft.revision})).applied,false);const next=await core('worker.draft',{id:a.id,text:'Newer draft',expectedRevision:newer.draft.revision,newAttempt:true});assert.equal(next.draft.revision,newer.draft.revision+1)
 await core('worker.stop',{id:a.id});assert.equal((await core('worker.snapshot',{id:a.id})).worker.running,false);await core('worker.start',{id:a.id});assert.equal((await core('worker.snapshot',{id:a.id})).worker.nativeSessionId,native);assert.equal((await core('worker.list')).find(worker=>worker.id===a.id).draft.text,'Newer draft')
 await core('worker.send',{id:a.id,text:'Resume the same native conversation',clientMessageId:'resumed'});await f.until(async()=>!(await core('worker.snapshot',{id:a.id})).worker.busy,'resume completed');assert.equal(turns('codex-one').at(-1).thread,native)
 pass('Draft compare-and-swap preserves newer text; an explicit new attempt renews its durable key; disconnect and resume retain the same native conversation')
 await core('worker.remove',{id:a.id});assert.equal((await core('worker.list')).some(worker=>worker.id===a.id),false);assert.equal(fs.readFileSync(path.join(one,'keep.md'),'utf8'),'Retain this work file.');assert.ok(fs.existsSync(path.join(f.env.AGENTS_COMPANY_HOME,'worker-conversations',a.id+'.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'worker-conversations',a.id+'.json'),'utf8')).nativeSessionId,native);assert.ok((await core('worker.snapshot',{id:b.id})).worker.running)
 pass('Removal deletes only the target connection after shutdown and retains its work files and native history')
 assert.equal((await core('session.list')).sessions.length,2);assert.equal((await core('worker.read',{id:b.id})).output.includes('Another Worker is independent.'),true)
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close()}
