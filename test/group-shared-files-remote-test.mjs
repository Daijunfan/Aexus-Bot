// Real Core + SSH/Python file transport, disposable SSH fixture; no real host or model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-shared-ssh-'))),bin=path.join(temp,'bin'),cloud=path.join(temp,'cloud'),checks=[]
fs.mkdirSync(bin);fs.mkdirSync(cloud)
fs.writeFileSync(path.join(bin,'ssh'),"#!/usr/bin/env python3\nimport os,sys\nif 'offline' in sys.argv: sys.exit(255)\nos.execv('/bin/sh',['sh','-c',sys.argv[-1]])\n",{mode:0o755})
const f=await fixtureCore({PATH:bin+':'+process.env.PATH}),rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},hash=value=>createHash('sha256').update(value).digest('hex')
const finish=(command,id,token)=>f.until(async()=>{const r=await rpc(command,{id},token);if(['failed','cancelled','interrupted'].includes(r.state))throw Error(r.error);return r.state==='completed'&&r},command)
try{
 await f.cli('group','add','Remote file team');const employee=await f.create('Remote editor','Remote file team'),token=await f.token(employee.id),group=await rpc('chat.create',{name:'Remote file room',members:[employee.id]}),conversation='group:'+group.id
 await rpc('conversation.file',{conversation,operation:'write',path:'shared.txt',content:'Remote original',create:true})
 const message=await rpc('chat.send',{id:group.id,text:'File reference',files:['@workspace/shared.txt'],clientMessageId:'remote-original'})
 await f.until(async()=>{const m=(await rpc('chat.history',{id:group.id})).messages[0];return m.deliveries.every(d=>d.status==='completed')&&!(await f.status(employee.id)).busy},'seed settled')
 const host=await rpc('host.create',{name:'Disposable SSH fixture',host:'fixture',os:'linux',defaultDirectory:cloud})
 await f.stop()
 // A ready, isolated actor supplies the execution binding. Only the transport is under test.
 const storeFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),store=JSON.parse(fs.readFileSync(storeFile,'utf8')),cwd=path.join(cloud,'editor');fs.mkdirSync(cwd)
 Object.assign(store.sessions.find(s=>s.id===employee.id),{cwd,kind:'cloud-native-worker',workEnvironment:'team'})
 store.teamSettings['Remote file team']={mode:'cloud',hostId:host.id,directory:cloud,remote:{host:'fixture',os:'linux',directory:cloud}};store.teamRoots['Remote file team']=cloud
 fs.writeFileSync(storeFile,JSON.stringify(store));await f.start()
 const entry=await rpc('conversation.entry',{conversation,id:message.id},token),job=await rpc('conversation.download',{conversation,entryId:message.id,attachmentId:entry.attachments[0].id,clientRequestId:'remote-own-copy'},token),download=await finish('conversation.download-status',job.id,token)
 assert.equal(download.workspace,'company:'+employee.id);assert.equal(download.absolutePath,path.join(cwd,'shared.txt'));assert.equal(fs.readFileSync(download.absolutePath,'utf8'),'Remote original')
 const bytes=Buffer.concat([Buffer.from('REMOTE_EDIT\n'),randomBytes(5*1024*1024+31)]);fs.writeFileSync(path.join(cwd,'edited.bin'),bytes)
 const upload=await rpc('conversation.upload',{conversation,from:{path:'edited.bin'},path:'shared.txt',expectedVersion:download.sourceVersion,clientRequestId:'remote-upload-back'},token),done=await finish('conversation.upload-status',upload.id,token),workspace=await rpc('conversation.workspace',{conversation},token)
 assert.equal(done.totalBytes,bytes.length);assert.equal(hash(fs.readFileSync(path.join(workspace.root,'shared.txt'))),hash(bytes));assert.equal(hash(fs.readFileSync(path.join(cwd,'edited.bin'))),hash(bytes))
 checks.push('Default attachment download uses the remote personal execution workspace; a 5 MiB binary edit uploads back with the downloaded source version and exact bytes')
 const api=await rpc('conversation.file',{conversation,operation:'info',path:'shared.txt'},token);assert.equal(done.version,api.version)
 await rpc('host.update',{id:host.id,patch:{host:'offline'}}).catch(()=>{})
 fs.mkdirSync(path.join(f.root,'artifacts/shared-files'),{recursive:true});fs.writeFileSync(path.join(f.root,'artifacts/shared-files/remote-result.json'),JSON.stringify({passed:true,checks,sshFixture:true,realLinuxServerTested:false,modelCalls:0,productionDataUsed:false},null,2));checks.forEach(c=>console.log('PASS '+c))
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
