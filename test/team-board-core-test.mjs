// Real authenticated Core/CLI and native PTY, with disposable profiles and a deterministic engine.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=process.cwd(),f=await fixtureCore({CODEX_BIN:path.join(root,'test/fixtures/native-worker.cjs')})
const rpc=async(token,cmd,args={})=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data},deny=async(token,cmd,args={})=>assert.equal((await f.request(token,cmd,args)).ok,false,cmd)
try{
 await f.cli('group','add','Studio');const employee=await f.create('Alex','Studio'),secretary=await f.create('Secretary','Studio','secretary'),token=await f.token(employee.id),admin=await f.token(secretary.id),before=await rpc(null,'session.list')
 assert.equal((await f.cli('view','select','company','--team-tab','board')).teamTab,'board')
 await f.cli('view','select','messages');assert.equal((await f.cli('view','select','company')).teamTab,'board')
 await f.cli('view','open','conversation','--employee',employee.id);assert.equal((await f.cli('view','close')).teamTab,'board')
 await deny(null,'view.select',{id:'messages',teamTab:'board'});await deny(null,'view.select',{id:'company',teamTab:'infinite'});await deny(null,'view.open',{kind:'plan',teamTab:'board'})
 await f.cli('view','open','home','--team-tab','characters');assert.equal((await f.cli('view','get')).teamTab,'board')
 const focus=await f.cli('team-view','create','--name','Studio focus','--teams','["Studio"]')
 await f.cli('team-view','select',focus.id);await f.cli('view','select','company','--team-tab','board');assert.equal((await f.cli('team-view','list')).activeId,focus.id)
 await f.cli('view','select','company');assert.equal((await f.cli('team-view','list')).activeId,focus.id);await f.cli('view','select','company','--team-tab','characters')
 await f.stop();await f.start();assert.equal((await f.cli('view','get')).teamTab,'board')
 const workspace=path.join(f.temp,'plain project');fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'keep.txt'),'keep')
 const worker=await f.cli('worker','create','--engine','codex','--cwd',workspace,'--title','Independent');assert.equal(worker.employee,undefined);assert.equal(worker.running,false);assert.equal(worker.cwd,workspace)
 assert.equal((await rpc(null,'session.list')).sessions.length,before.sessions.length)
 assert.deepEqual((await rpc(token,'worker.list')),[]);assert.ok((await rpc(admin,'worker.list')).some(w=>w.id===worker.id))
 for(const cmd of ['worker.start','worker.read','worker.input','worker.resize','worker.interrupt','worker.stop','worker.remove'])await deny(token,cmd,{id:worker.id,data:'forbidden',cols:80,rows:24})
 await deny(null,'worker.create',{engine:'codex'});await deny(null,'worker.create',{engine:'codex',cwd:path.join(workspace,'missing')})
 const own=await rpc(token,'worker.create',{engine:'codex'});assert.equal(own.employee,employee.id)
 const delegated=await rpc(admin,'worker.create',{engine:'codex',cwd:workspace,title:'Secretary created independent Worker'});assert.equal(delegated.employee,undefined)
 await rpc(admin,'worker.remove',{id:delegated.id});await rpc(null,'worker.remove',{id:worker.id});assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'keep')
 assert.deepEqual((await rpc(null,'session.list')).sessions.map(card=>[card.id,card.engine,card.cwd,card.threadId]),before.sessions.map(card=>[card.id,card.engine,card.cwd,card.threadId]))
 console.log('PASS Team tab CLI/navigation/restart, independent native Worker creation, direct-owner isolation, Secretary parity and preserved employee/workspace identities; no model calls')
}finally{await f.close()}
