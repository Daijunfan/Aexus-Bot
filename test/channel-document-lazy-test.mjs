import {collectorSourceRoot} from './fixtures/collector-source.mjs'
// Two fixture roots model the Mac and Linux. SSH/file RPC is real, with a local-only SSH fixture.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createHash} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-lazy-document-'))),server=path.join(temp,'server'),bin=path.join(temp,'bin');fs.mkdirSync(server);fs.mkdirSync(bin)
fs.writeFileSync(path.join(bin,'ssh'),"#!/usr/bin/env python3\nimport os,sys\nos.execv('/bin/sh',['sh','-c',sys.argv[-1]])\n",{mode:0o755})
const payload=Buffer.from('%PDF-lazy-fixture\n'.repeat(4096)),digest=createHash('sha256').update(payload).digest('hex')
const f=await fixtureCore({PATH:bin+path.delimiter+process.env.PATH}),rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
const python=spawn('python3',['-B','-u','-c',`import sys,json,base64
from pathlib import Path
sys.path.insert(0,${JSON.stringify(collectorSourceRoot)})
from channel_content import ChannelContentStore
store=ChannelContentStore(Path(${JSON.stringify(server)}));calls=0
for line in sys.stdin:
 try:
  job=json.loads(line)
  if job['operation']=='document-prepare':
   calls+=1;p=store.root/'documents'/${JSON.stringify(digest)};p.parent.mkdir(exist_ok=True);p.write_bytes(base64.b64decode(${JSON.stringify(payload.toString('base64'))}));result={'id':'fixture','state':'completed','serverPath':'documents/'+p.name,'sha256':p.name,'bytes':p.stat().st_size}
  elif job['operation']=='fixture-count':result={'calls':calls}
  else:result=store.execute(job['operation'],job['args'])
  print(json.dumps({'result':result}),flush=True)
 except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
store.close()
`],{stdio:['pipe','pipe','pipe']})
const waiting=[];createInterface({input:python.stdout}).on('line',line=>waiting.shift()?.(JSON.parse(line)));const execute=job=>new Promise(resolve=>{waiting.push(resolve);python.stdin.write(JSON.stringify(job)+'\n')})
let stop=false,worker
try{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));await rpc('channel.settings',{patch:{enabled:true,port}})
 const source=await rpc('channel.source-add',{plugin:'telegram',locator:'fixture_magazines',name:'Magazines'}),issued=await rpc('channel.collector-add',{name:'Storage fixture',sourceIds:'all'}),host=await rpc('host.create',{name:'Linux fixture',host:'fixture',os:'linux',defaultDirectory:server})
 await rpc('channel.storage',{patch:{collectorId:issued.collector.id,hostId:host.id,directory:server}})
 const external=async(cmd,args={})=>{const response=await fetch(`http://127.0.0.1:${port}/api/channels/collector`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data}
 worker=(async()=>{while(!stop){try{const message=await external('channel.storage-exchange',{waitMs:250});for(const job of message.jobs)await external('channel.storage-result',{id:job.id,...await execute(job)})}catch{if(!stop)await new Promise(resolve=>setTimeout(resolve,50))}}})()
 const post=await external('channel.publish',{sourceId:source.id,externalId:'123',publishedAt:Date.now()-1000,title:'Magazine.pdf',body:'File metadata only',files:[{id:'tg-123-456',name:'Magazine.pdf',mimeType:'application/pdf',bytes:payload.length,deferred:true}]})
 await rpc('channel.posts',{channelId:source.channelId});await rpc('channel.file-status',{postId:post.id,fileId:'tg-123-456'})
 assert.equal((await execute({operation:'fixture-count',args:{}})).result.calls,0);assert.equal(fs.existsSync(path.join(server,'documents',digest)),false)
 await rpc('channel.file-download',{postId:post.id,fileId:'tg-123-456'})
 const status=await f.until(async()=>{const value=await rpc('channel.file-status',{postId:post.id,fileId:'tg-123-456'});if(value.state==='failed')throw Error(value.error);return value.state==='completed'?value:false},'server fetch and Mac transfer')
 assert.equal((await execute({operation:'fixture-count',args:{}})).result.calls,1);assert.ok(fs.readFileSync(path.join(server,'documents',digest)).equals(payload))
 const matches=[];const walk=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const p=path.join(directory,item.name);if(item.isDirectory())walk(p);else if(item.isFile()&&item.name==='Magazine.pdf')matches.push(p)}};walk(f.env.AGENTS_COMPANY_HOME)
 assert.equal(matches.length,1);assert.ok(fs.readFileSync(matches[0]).equals(payload));await rpc('channel.file-download',{postId:post.id,fileId:'tg-123-456'});assert.equal((await execute({operation:'fixture-count',args:{}})).result.calls,1)
 console.log('PASS listing performs no document download; explicit click fetches once on server, transfers exact bytes to Mac, and retains the server cache')
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??path.join(root,'artifacts/channel-redesign'));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'document-result.json'),JSON.stringify({passed:true,serverRequests:1,bytes:payload.length,sha256:digest,modelCalls:0},null,2)+'\n')
}finally{stop=true;await f.close();if(worker)await worker;python.stdin.end();if(python.exitCode===null)await new Promise(resolve=>python.once('close',resolve));fs.rmSync(temp,{recursive:true,force:true})}
