import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createHash} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {collectorSourceRoot} from './fixtures/collector-source.mjs'
import {magazinePdf} from './fixtures/magazine-pdf.mjs'
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-magazine-copy-'))),server=path.join(temp,'server'),bin=path.join(temp,'bin'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??'artifacts/magazine-reading/download'),checks=[]
fs.mkdirSync(server);fs.mkdirSync(bin);fs.mkdirSync(out,{recursive:true})
fs.writeFileSync(path.join(bin,'ssh'),"#!/usr/bin/env python3\nimport os,sys\nos.execv('/bin/sh',['sh','-c',sys.argv[-1]])\n",{mode:0o755})
const payload=magazinePdf(),digest=createHash('sha256').update(payload).digest('hex'),f=await fixtureCore({PATH:bin+path.delimiter+process.env.PATH})
const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
const python=spawn('python3',['-B','-u','-c',`import sys,json,base64
from pathlib import Path
sys.path.insert(0,${JSON.stringify(collectorSourceRoot)})
from channel_content import ChannelContentStore
store=ChannelContentStore(Path(${JSON.stringify(server)}));jobs={};calls=0
def prepared(job):
 p=store.root/'documents'/${JSON.stringify(digest)};p.parent.mkdir(exist_ok=True);p.write_bytes(base64.b64decode(${JSON.stringify(payload.toString('base64'))}))
 return {'id':job['id'],'state':'completed','serverPath':'documents/'+p.name,'sha256':p.name,'bytes':p.stat().st_size}
for line in sys.stdin:
 try:
  request=json.loads(line);operation=request['operation'];args=request.get('args',{})
  if operation=='document-prepare':
   key=args['postId']+'/'+args['fileId']
   if key not in jobs: calls+=1;jobs[key]={'id':key,'polls':0}
   job=jobs[key];result=prepared(job) if job['polls']>=3 else {'id':key,'state':'queued','bytes':0}
  elif operation=='document-status':
   job=jobs[args['id']];job['polls']+=1;result=prepared(job) if job['polls']>=3 else {'id':job['id'],'state':'running','bytes':100*job['polls']}
  elif operation=='fixture-count':result={'calls':calls}
  else:result=store.execute(operation,args)
  print(json.dumps({'result':result}),flush=True)
 except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
store.close()
`],{stdio:['pipe','pipe','pipe']})
const waiting=[];createInterface({input:python.stdout}).on('line',line=>waiting.shift()?.(JSON.parse(line)));const execute=job=>new Promise(resolve=>{waiting.push(resolve);python.stdin.write(JSON.stringify(job)+'\n')})
let stopping=false,worker
try{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));await rpc('channel.settings',{patch:{enabled:true,port}})
 await f.cli('group','add','Readers');const a=await f.create('Reader','Readers'),b=await f.create('Peer','Readers'),ta=await f.token(a.id),tb=await f.token(b.id)
 const source=await rpc('channel.source-add',{plugin:'telegram',locator:'magazine_workflow',name:'Magazine desk'}),issued=await rpc('channel.collector-add',{name:'Document fixture',sourceIds:'all'}),host=await rpc('host.create',{name:'Document server fixture',host:'fixture',os:'linux',defaultDirectory:server})
 await rpc('channel.storage',{patch:{collectorId:issued.collector.id,hostId:host.id,directory:server}})
 const grant=async(employeeIds)=>{const state=await rpc('channel.access',{id:source.channelId});return rpc('channel.access',{id:source.channelId,employeeIds,expectedRevision:state.revision})}
 const external=async(cmd,args={})=>{const response=await fetch('http://127.0.0.1:'+port+'/api/channels/collector',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data}
 worker=(async()=>{while(!stopping){try{const value=await external('channel.storage-exchange',{waitMs:200});for(const job of value.jobs)await external('channel.storage-result',{id:job.id,...await execute(job)})}catch{if(!stopping)await new Promise(resolve=>setTimeout(resolve,25))}}})()
 await grant([a.id,b.id])
 const post=async(name,id)=>external('channel.publish',{sourceId:source.id,externalId:id,publishedAt:Date.now(),title:name,body:'Original magazine document',files:[{id:'document-'+id,name,mimeType:'application/pdf',bytes:payload.length,deferred:true}]})
 const entry=await post('Atlas.pdf','1'),conversation='channel:'+source.channelId,read=await rpc('conversation.entry',{conversation,id:entry.id},ta)
 assert.equal((await execute({operation:'fixture-count',args:{}})).result.calls,0)
 const begin=Date.now(),args={conversation,entryId:entry.id,attachmentId:read.attachments[0].id,clientRequestId:'read-atlas'},job=await rpc('conversation.download',args,ta);assert.equal(job.phase,'server');assert.ok(Date.now()-begin<800)
 const completed=await f.until(async()=>{const value=await rpc('conversation.download-status',{id:job.id},ta);if(['failed','cancelled','interrupted'].includes(value.state))throw Error(value.error);return value.state==='completed'&&value},'employee original copy')
 assert.equal(completed.absolutePath,path.join(a.cwd,'Atlas.pdf'));assert.ok(fs.readFileSync(completed.absolutePath).equals(payload));assert.equal((await rpc('conversation.download',args,ta)).id,job.id);assert.equal((await execute({operation:'fixture-count',args:{}})).result.calls,1)
 const wrong=await f.request(tb,'conversation.download-status',{id:job.id});assert.equal(wrong.ok,false)
 const collision=await rpc('conversation.download',{...args,clientRequestId:'read-another-copy'},ta);await f.until(async()=>{const value=await rpc('conversation.download-status',{id:collision.id},ta);if(value.state==='failed')throw Error(value.error);return value.state==='completed'&&value},'collision-safe copy');assert.ok(fs.readFileSync(path.join(a.cwd,'Atlas.pdf')).equals(payload));assert.ok(fs.existsSync(path.join(a.cwd,'Atlas (1).pdf')))
 const pdf=await rpc('workspace.pdf',{employee:a.id,path:'Atlas.pdf',operation:'text',page:3,limit:1},ta);assert.match(pdf.pages[0].text,/Reading a figure/);checks.push('Metadata listing does not fetch originals; employee request returns server progress immediately, copies exact PDF bytes into its own workspace, protects owner receipts and reuses request IDs without overwriting')
 const cancelledPost=await post('Cancelled.pdf','2'),cancelEntry=await rpc('conversation.entry',{conversation,id:cancelledPost.id},ta),cancel=await rpc('conversation.download',{conversation,entryId:cancelledPost.id,attachmentId:cancelEntry.attachments[0].id,clientRequestId:'cancel-preparation'},ta)
 assert.equal((await rpc('conversation.download-status',{id:cancel.id,cancel:true},ta)).state,'cancelled');await new Promise(resolve=>setTimeout(resolve,1100));assert.ok(!fs.existsSync(path.join(a.cwd,'Cancelled.pdf')))
 const revokedPost=await post('Revoked.pdf','3'),revokedEntry=await rpc('conversation.entry',{conversation,id:revokedPost.id},ta),revoked=await rpc('conversation.download',{conversation,entryId:revokedPost.id,attachmentId:revokedEntry.attachments[0].id,clientRequestId:'revoke-preparation'},ta);await grant([b.id])
 await f.until(async()=>['failed','cancelled'].includes((await rpc('conversation.download-status',{id:revoked.id},ta)).state),'revoked pending copy');assert.ok(!fs.existsSync(path.join(a.cwd,'Revoked.pdf')));await grant([a.id,b.id]);checks.push('Cancel during server preparation never writes a personal copy; removing the reading grant stops an accepted pending copy')
 const restartPost=await post('Restart.pdf','4'),restartEntry=await rpc('conversation.entry',{conversation,id:restartPost.id},ta),restartArgs={conversation,entryId:restartPost.id,attachmentId:restartEntry.attachments[0].id,clientRequestId:'interrupted-preparation'},interrupted=await rpc('conversation.download',restartArgs,ta)
 await f.stop();await f.start();assert.equal((await rpc('conversation.download-status',{id:interrupted.id},ta)).state,'interrupted');assert.equal((await rpc('conversation.download',restartArgs,ta)).state,'interrupted');assert.ok(!fs.existsSync(path.join(a.cwd,'Restart.pdf')));checks.push('Core restart keeps an interrupted receipt and does not silently replay the original copy')
 await f.cli('group','add','Cloud readers');const c=await f.create('Cloud reader','Cloud readers'),tc=await f.token(c.id),cloud=path.join(temp,'cloud'),cwd=path.join(cloud,'reader');fs.mkdirSync(cwd,{recursive:true});const targetHost=await rpc('host.create',{name:'Workspace SSH fixture',host:'fixture',os:'linux',defaultDirectory:cloud});await grant([a.id,b.id,c.id])
 await f.stop();const storeFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),store=JSON.parse(fs.readFileSync(storeFile,'utf8'));Object.assign(store.sessions.find(card=>card.id===c.id),{cwd,kind:'cloud-native-worker',workEnvironment:'team'});store.teamSettings['Cloud readers']={mode:'cloud',hostId:targetHost.id,directory:cloud,remote:{host:'fixture',os:'linux',directory:cloud}};store.teamRoots['Cloud readers']=cloud;fs.writeFileSync(storeFile,JSON.stringify(store));await f.start()
 const remote=await rpc('conversation.download',{...args,clientRequestId:'remote-target'},tc),remoteDone=await f.until(async()=>{const value=await rpc('conversation.download-status',{id:remote.id},tc);if(value.state==='failed')throw Error(value.error);return value.state==='completed'&&value},'remote execution workspace')
 assert.equal(remoteDone.absolutePath,path.join(cwd,'Atlas.pdf'));assert.ok(fs.readFileSync(remoteDone.absolutePath).equals(payload));const image=await rpc('workspace.pdf',{employee:c.id,path:'Atlas.pdf',operation:'render',page:3,to:'remote-page.png',width:1200},tc);assert.ok(fs.existsSync(path.join(cwd,image.path)));assert.equal(image.sha256,createHash('sha256').update(fs.readFileSync(path.join(cwd,image.path))).digest('hex'));assert.match((await rpc('workspace.pdf',{employee:c.id,path:'Atlas.pdf',operation:'text',page:3,limit:1},tc)).pages[0].text,/Reading a figure/);checks.push('The identical copy/read/render API writes to the employee’s configured remote workspace through the SSH protocol and preserves the source PDF')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,sshFixture:true,realLinuxServerTested:false,paidModelCalls:0,productionStateUsed:false},null,2)+'\n');checks.forEach(value=>console.log('PASS '+value))
}finally{stopping=true;await f.close();if(worker)await worker;python.stdin.end();if(python.exitCode===null)await new Promise(resolve=>python.once('close',resolve));fs.rmSync(temp,{recursive:true,force:true})}
