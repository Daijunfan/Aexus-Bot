import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {fixtureCore} from './fixtures/headless-core.mjs'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/worker-conversations/removal');fs.mkdirSync(out,{recursive:true});const f=await fixtureCore({AC_NATIVE_WORKER_FIXTURE:'1'}),checks=[]
const core=async(cmd,args={})=>{const result=await f.request(null,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data},pass=text=>{checks.push(text);console.log('PASS '+text)}
const alive=pid=>{try{return !execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim().startsWith('Z')}catch{return false}}
const make=async(name)=>{const cwd=path.join(f.temp,name);fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'keep.txt'),'Keep my work');return core('worker.create',{engine:'codex',title:name,cwd})}
try{
 const target=await make('target'),peer=await make('peer')
 for(const name of ['target','peer']){fs.writeFileSync(path.join(f.control,name+'.spawn-tools'),'');fs.writeFileSync(path.join(f.control,name+'.hold-user'),'')}
 await core('worker.send',{id:target.id,text:'Run the target task',clientMessageId:'target-active'});await core('worker.send',{id:peer.id,text:'Independent peer task',clientMessageId:'peer-active'})
 await f.until(()=>['target','peer'].every(name=>fs.existsSync(path.join(f.control,name+'-tools.json.grandchild-ready'))),'native background tool descendants started')
 const targetPids=Object.values(JSON.parse(fs.readFileSync(path.join(f.control,'target-tools.json'),'utf8'))),peerPids=Object.values(JSON.parse(fs.readFileSync(path.join(f.control,'peer-tools.json'),'utf8')));assert.ok([...targetPids,...peerPids].every(alive))
 await core('worker.send',{id:target.id,text:'Waiting target task',clientMessageId:'target-queued'})
 const started=Date.now();await core('worker.remove',{id:target.id});assert.ok(Date.now()-started<7000,'Remove must finish despite inherited output pipes and SIGTERM-resistant descendants');assert.ok(targetPids.every(pid=>!alive(pid)),'Target native parent and both nested background tool processes must be gone');assert.ok(peerPids.every(alive),'Never stop a different Worker');assert.equal((await core('worker.snapshot',{id:peer.id})).worker.busy,true)
 const history=JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'worker-conversations',target.id+'.json'),'utf8'));assert.ok(history.receipts.every(receipt=>receipt.state==='interrupted'));assert.equal(fs.readFileSync(path.join(target.cwd,'keep.txt'),'utf8'),'Keep my work')
 pass('Remove waits for the selected native parent, nested detached tools and SIGTERM-resistant processes, including inherited stdio; another Worker keeps working')
 const connecting=await make('connecting');fs.writeFileSync(path.join(f.control,'connecting.hold-initialize'),'');const start=f.request(null,'worker.start',{id:connecting.id});await f.until(()=>fs.existsSync(path.join(f.control,'connecting-process.json')),'held native handshake');const pid=JSON.parse(fs.readFileSync(path.join(f.control,'connecting-process.json'),'utf8')).pid
 const now=Date.now();await core('worker.remove',{id:connecting.id});await start;assert.ok(Date.now()-now<7000);assert.equal(alive(pid),false);assert.equal((await core('worker.list')).some(worker=>worker.id===connecting.id),false)
 pass('Removing while native initialization is pending cancels startup, terminates the process and never resurrects the record')
 const storage=await make('storage-error');await core('worker.start',{id:storage.id});const storagePid=JSON.parse(fs.readFileSync(path.join(f.control,'storage-error-process.json'),'utf8')).pid,historyFile=path.join(f.env.AGENTS_COMPANY_HOME,'worker-conversations',storage.id+'.json'),backup=historyFile+'.saved',sentinel=path.join(f.temp,'do-not-overwrite.json');fs.writeFileSync(sentinel,'{"protected":true}');fs.renameSync(historyFile,backup);fs.symlinkSync(sentinel,historyFile)
 const refused=await f.request(null,'worker.send',{id:storage.id,text:'This must not dispatch without durable acceptance',clientMessageId:'storage-refused'});assert.equal(refused.ok,false);assert.equal((await core('worker.snapshot',{id:storage.id})).receipts.length,0)
 const removed=await f.request(null,'worker.remove',{id:storage.id});assert.equal(removed.ok,false);assert.equal(alive(storagePid),false);assert.ok((await core('worker.list')).some(worker=>worker.id===storage.id),'archive failure retains the stopped record');assert.equal(fs.readFileSync(sentinel,'utf8'),'{"protected":true}');fs.unlinkSync(historyFile);fs.renameSync(backup,historyFile);await core('worker.remove',{id:storage.id})
 pass('A real state-file write failure cannot acknowledge or dispatch a task and cannot prevent process termination; the record stays until its archive can be saved safely')
 await core('worker.stop',{id:peer.id});assert.ok(peerPids.every(pid=>!alive(pid)));assert.equal((await core('worker.snapshot',{id:peer.id})).worker.state,'stopped')
 await f.stop();await f.start();assert.equal((await core('worker.snapshot',{id:peer.id})).pendingMessages.length,0);assert.equal((await core('worker.snapshot',{id:peer.id})).worker.running,false)
 pass('Stop also closes the full owned process tree; a Core restart never replays interrupted or queued work')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,targetProcessCount:targetPids.length,unrelatedProcessCount:peerPids.length,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close()}
