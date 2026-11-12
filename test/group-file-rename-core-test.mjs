// Actual Core contracts and a local SSH protocol fixture. No real accounts/hosts/model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-file-move-')),entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs'),checks=[]
let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(cmd,args,token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r.error},pass=text=>{checks.push(text);console.log('PASS '+text)}
 const bin=path.join(f.temp,'bin');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'ssh'),"#!/usr/bin/env python3\nimport os,sys\nos.execv('/bin/sh',['sh','-c',sys.argv[-1]])\n",{mode:0o755});await f.stop();f.env.PATH=bin+path.delimiter+f.env.PATH;await f.start()
 await rpc('group.add',{name:'Rename review'});const member=await f.create('Reader','Rename review'),outsider=await f.create('Outside','Rename review'),token=await f.token(member.id),outside=await f.token(outsider.id),hostRoot=path.join(f.temp,'remote-files');fs.mkdirSync(hostRoot);const host=await rpc('host.create',{name:'Protocol fixture',host:'fixture-rename',os:'linux',defaultDirectory:hostRoot})
 const snapshot=messages=>messages.map(({attachments,...message})=>message)
 for(const remote of [false,true]){
  const group=await rpc('chat.create',{name:remote?'Cloud files':'Local files',members:[member.id],...(remote?{storage:{mode:'create',hostId:host.id,directory:hostRoot,folderName:'Originals'}}:{})}),conversation='group:'+group.id,base=await rpc('conversation.workspace',{conversation}),file=path.join(base.root,'reports','notes.txt')
  await rpc('conversation.file',{conversation,operation:'write',path:'reports/notes.txt',content:'Original evidence',create:true},token)
  const first=await rpc('chat.post',{id:group.id,text:'The original stays the source.',files:['@workspace/reports/notes.txt'],clientMessageId:'original'},token),second=await rpc('chat.post',{id:group.id,text:'The same file in another message.',files:['@workspace/reports/notes.txt'],clientMessageId:'other-reference'},token)
  await rpc('chat.post',{id:group.id,text:'',files:['@workspace/reports/notes.txt'],clientMessageId:'file-only'},token)
  await f.until(async()=>(await rpc('chat.history',{id:group.id})).messages.every(message=>message.deliveries.every(d=>['completed','failed','interrupted'].includes(d.status))),'delivery settle')
  const before=(await rpc('chat.history',{id:group.id})).messages,version=(await rpc('conversation.file',{conversation,operation:'info',path:'reports/notes.txt'})).version
  await deny('conversation.file',{conversation,operation:'move',path:'reports/notes.txt',to:'reports/no-access.txt',expectedVersion:version},outside);assert.ok(fs.existsSync(file))
  await rpc('conversation.file',{conversation,operation:'write',path:'reports/collision.txt',content:'Keep this existing file',create:true})
  await deny('conversation.file',{conversation,operation:'move',path:'reports/notes.txt',to:'reports/collision.txt',expectedVersion:version},token);assert.equal(fs.readFileSync(path.join(base.root,'reports/collision.txt'),'utf8'),'Keep this existing file')
  await deny('conversation.file',{conversation,operation:'move',path:'reports/notes.txt',to:'../outside.txt',expectedVersion:version},token)
  await rpc('conversation.file',{conversation,operation:'move',path:'reports/notes.txt',to:'reports/renamed 中文.txt',expectedVersion:version},token)
  const after=(await rpc('chat.history',{id:group.id})).messages;assert.deepEqual(snapshot(after),snapshot(before));assert.ok(after.every(message=>message.attachments[0].path==='@workspace/reports/renamed 中文.txt'));assert.ok(after.every(message=>message.attachments[0].name==='renamed 中文.txt'));assert.equal(fs.readFileSync(path.join(base.root,'reports/renamed 中文.txt'),'utf8'),'Original evidence');assert.ok(!fs.existsSync(file))
  for(const message of [first,second]){const entry=await rpc('conversation.entry',{conversation,id:message.id});assert.ok(entry.attachments.some(value=>value.path==='@workspace/reports/renamed 中文.txt'))}
  assert.equal((await rpc('conversation.files',{conversation})).files.find(value=>value.name==='renamed 中文.txt').referenceCount,3)
  assert.equal((await rpc('chat.get',{id:group.id})).lastMessage.text,'renamed 中文.txt')
  assert.equal((await rpc('chat.post',{id:group.id,text:'The original stays the source.',files:['@workspace/reports/notes.txt'],clientMessageId:'original'},token)).id,first.id);await deny('chat.post',{id:group.id,text:'Changed retry',files:['@workspace/reports/notes.txt'],clientMessageId:'original'},token);
  const fresh=(await rpc('conversation.file',{conversation,operation:'info',path:'reports/renamed 中文.txt'})).version;await rpc('conversation.file',{conversation,operation:'write',path:'reports/renamed 中文.txt',content:'Updated evidence'});await deny('conversation.file',{conversation,operation:'move',path:'reports/renamed 中文.txt',to:'stale.txt',expectedVersion:fresh});assert.equal(fs.readFileSync(path.join(base.root,'reports/renamed 中文.txt'),'utf8'),'Updated evidence')
  await rpc('chat.message-trash',{id:group.id,messages:[{id:first.id,expectedRevision:0}]},token);await rpc('conversation.file',{conversation,operation:'move',path:'reports',to:'archive'},token);const removed=(await rpc('chat.trash',{id:group.id},token)).rows.find(value=>value.id===first.id);await rpc('chat.message-restore',{id:group.id,messages:[{id:first.id,expectedRevision:removed.revision}]},token)
  assert.ok((await rpc('chat.history',{id:group.id})).messages.filter(message=>message.attachments?.length).every(message=>message.attachments[0].path==='@workspace/archive/renamed 中文.txt'))
  const posting=rpc('chat.post',{id:group.id,text:'Concurrent publication',files:['@workspace/archive/renamed 中文.txt'],clientMessageId:'concurrent'},token);await rpc('conversation.file',{conversation,operation:'move',path:'archive/renamed 中文.txt',to:'archive/final.txt'},token);await posting
  await rpc('conversation.file',{conversation,operation:'move',path:'archive/final.txt',to:'archive/Final.txt'},token);await rpc('conversation.file',{conversation,operation:'move',path:'archive/Final.txt',to:'archive/final.txt'},token);
  const final=(await rpc('chat.history',{id:group.id})).messages;for(const message of final)for(const attachment of message.attachments??[])assert.ok(fs.existsSync(path.join(base.root,attachment.path.slice(11))),attachment.path)
  const repeated=await Promise.all(Array.from({length:8},()=>rpc('chat.post',{id:group.id,text:'One unchanged text request',clientMessageId:'parallel-text'},token)));assert.equal(new Set(repeated.map(message=>message.id)).size,1);
  pass((remote?'Cloud':'Local')+' renames preserve all live/recoverable references, IDs, text and receipts; collisions, traversal, stale versions and outside callers are rejected; concurrent publication keeps valid links')
 }
 const group=(await rpc('chat.list')).find(group=>group.name==='Local files'),conversation='group:'+group.id,workspace=await rpc('conversation.workspace',{conversation});await f.until(async()=>(await rpc('chat.history',{id:group.id})).messages.every(message=>message.deliveries.every(d=>['completed','failed','interrupted'].includes(d.status))),'settled before fault')
 const previous=path.join(f.env.AGENTS_COMPANY_HOME,'chats',group.id+'.json.previous'),backup=previous+'.fixture-saved';if(fs.existsSync(previous))fs.renameSync(previous,backup);fs.mkdirSync(previous)
 try{await deny('conversation.file',{conversation,operation:'move',path:'archive/final.txt',to:'archive/rollback.txt'});assert.ok(fs.existsSync(path.join(workspace.root,'archive/final.txt')));assert.ok(!fs.existsSync(path.join(workspace.root,'archive/rollback.txt')))}finally{fs.rmdirSync(previous);if(fs.existsSync(backup))fs.renameSync(backup,previous)}
 pass('A failed reference metadata write rolls back the physical move and retains the original file')
 await f.stop();await f.start();const history=(await rpc('chat.history',{id:group.id})).messages;assert.ok(history.every(message=>(message.attachments??[]).every(file=>fs.existsSync(path.join(workspace.root,file.path.slice(11))))));pass('References remain valid after Core restart without allocating employee group workspaces')
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/message-workspaces/file-rename-core');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,realHosts:false,paidModelCalls:0,productionStateUsed:false},null,2)+'\n')
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
