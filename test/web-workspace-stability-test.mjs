// Authenticated transport stress: reads stay fresh; mutations and sends retain replay safety.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import {randomUUID} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
const shellHome=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-transport-home-'))
const f=await fixtureCore({HOME:shellHome,SHELL:'/bin/bash',HISTFILE:'/dev/null',BASH_SILENCE_DEPRECATION_WARNING:'1',CODEX_BIN:path.join(process.cwd(),'test/fixtures/native-worker.cjs'),AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}),url='http://127.0.0.1:'+port
f.env.NATIVE_WORKER_CAPTURE=path.join(f.temp,'keyboard.jsonl');await f.stop();await f.start()
const token=fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim()
const request=async(cmd,args={},id=randomUUID())=>{const response=await fetch(url+'/api/rpc',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-request-id':id},body:JSON.stringify({cmd,args})});return {status:response.status,...await response.json()}}
const call=async(cmd,args={},id)=>{const result=await request(cmd,args,id);assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.ok,result.error);return result.data}
try{
 await f.until(()=>fetch(url+'/api/health').then(response=>response.ok).catch(()=>false),'Web ready')
 const sameRead=randomUUID();await call('messenger.state',{},sameRead)
 for(let i=0;i<650;i++)await call('messenger.state')
 const create=randomUUID();await call('group.add',{name:'Transport'},create);await call('group.add',{name:'Transport'},create)
 assert.equal((await f.cli('group','list')).filter(name=>name==='Transport').length,1)
 const employee=await f.create('Replay owner','Transport'),conversation='employee:'+employee.id
 await call('messenger.draft',{conversation,text:'A fresh draft',clientMessageId:'fresh'})
 assert.equal((await call('messenger.state',{},sameRead)).drafts[conversation].text,'A fresh draft','repeated read IDs resolve current data')
 fs.writeFileSync(path.join(f.control,employee.id+'.hold-user'),'')
 await f.cli('session','send','--employee',employee.id,'--text','Hold this fixture turn')
 await f.until(async()=>(await f.status(employee.id)).busy,'fixture busy')
 const sendId=randomUUID(),args={employee:employee.id,text:'Queued private request',mode:'enqueue',clientMessageId:'queued-private'}
 const queued=await call('direct.send',args,sendId);assert.equal(queued.status,'queued');assert.ok(queued.queueId)
 const removed=await f.request(null,'session.dequeue',{employee:employee.id,messageId:queued.queueId});assert.ok(removed.ok,removed.error)
 const retry=await request('direct.send',args,sendId);assert.equal(retry.ok,false);assert.equal(retry.code,'PRIVATE_SEND_INTERRUPTED','Core rechecks live queue instead of returning a cached success')
 assert.deepEqual(await call('session.queue',{id:(await f.status(employee.id)).sessionId}),[])
 const native=await call('worker.create',{engine:'codex',cwd:f.temp}),started=await call('worker.start',{id:native.id});await f.until(async()=>(await call('worker.read',{id:native.id})).output.includes('NATIVE WORKER READY'),'raw native ready')
 const firstInput=randomUUID(),input={id:native.id,terminal:started.terminal,data:'k'};await call('worker.input',input,firstInput)
 for(let index=1;index<600;index++)await call('worker.input',input)
 await call('settings.set',{snapEmployees:false});await call('view.select',{id:'plan'})
 const typed=()=>fs.readFileSync(f.env.NATIVE_WORKER_CAPTURE,'utf8').trim().split('\n').map(JSON.parse).filter(event=>event.type==='input').map(event=>event.text).join('')
 await f.until(()=>typed().length===600,'all keystrokes delivered');await call('worker.input',input,firstInput);assert.equal(typed().length,600,'an exact input retry is not replayed')
 assert.equal((await request('settings.set',{snapEmployees:true},firstInput)).status,409,'request IDs cannot be reused across native and normal caches')
 await call('worker.stop',{id:native.id})
 const shell=await call('terminal.open',{employee:employee.id});for(let index=0;index<600;index++)await call('terminal.input',{id:shell.id,data:' '});await call('settings.set',{snapEmployees:true});await call('terminal.close',{id:shell.id})
 const directory=path.join(f.root,'artifacts/product-polish');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'web-transport.json'),JSON.stringify({passed:true,reads:650,checks:['reads do not exhaust mutation replay capacity','same read ID resolves fresh state','same mutation request creates one Team','600 Worker and 600 workbench input packets do not block navigation or settings','native input replay protection and cross-command ID checks remain intact','same private-send HTTP ID rechecks an interrupted queue and never replays work'],paidModelCalls:0,productionDataUsed:false},null,2))
 console.log('PASS Web workspace: 650 fresh reads, 600 native inputs without blocking navigation, mutation replay protection, and interrupted direct-send receipt revalidation')
}finally{await f.close();fs.rmSync(shellHome,{recursive:true,force:true})}
