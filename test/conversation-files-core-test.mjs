// Real Core/CLI, disposable files and deterministic native peers. Never deletes production content.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-file-library-')),checks=[]
let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs')
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,value.error);return value.data}
 const deny=async(cmd,args,token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' must reject');return value.error}
 await rpc('group.add',{name:'File team'});const a=await f.create('Author','File team'),b=await f.create('Member','File team'),other=await f.create('Outside','File team'),secretary=await f.create('Secretary','File team','secretary')
 const at=await f.token(a.id),bt=await f.token(b.id),ot=await f.token(other.id),st=await f.token(secretary.id)
 const group=await rpc('chat.create',{name:'Shared research',members:[a.id,b.id]}),conversation='group:'+group.id
 const workspace=await rpc('conversation.workspace',{conversation}),name='A complete long research filename with 中文 and full provenance.pdf',p='@workspace/reports/'+name,q='@workspace/reports/Notes.md'
 await rpc('conversation.file',{conversation,operation:'write',path:'reports/'+name,content:'%PDF-1.4\nfirst\n%%EOF',create:true},at)
 await rpc('conversation.file',{conversation,operation:'write',path:'reports/Notes.md',content:'# Notes',create:true},at)
 await rpc('chat.post',{id:group.id,text:'First version caption',files:[p],clientMessageId:'first'},at)
 await rpc('chat.post',{id:group.id,text:'A later review with the same shared file',files:[p],clientMessageId:'second'},bt)
 await rpc('chat.post',{id:group.id,text:'Notes',files:[q],clientMessageId:'third'},at)
 const hash=()=>createHash('sha256').update(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'chats',group.id+'.json'))).digest('hex')
 await f.until(async()=>(await rpc('chat.history',{id:group.id})).messages.every(m=>m.deliveries.every(d=>['completed','failed','interrupted'].includes(d.status))),'awareness settled')
 const historyHash=hash(),files=await rpc('conversation.files',{conversation},at)
 assert.equal(files.total,2);assert.equal(files.files.find(f=>f.path===p).referenceCount,2);assert.equal(files.files.find(f=>f.path===p).name,name)
 assert.equal((await rpc('conversation.files',{conversation,query:'中文'})).total,1)
 const page1=await rpc('conversation.files',{conversation,sort:'name',limit:1}),page2=await rpc('conversation.files',{conversation,sort:'name',limit:1,offset:page1.nextOffset});assert.notEqual(page1.files[0].id,page2.files[0].id)
 await deny('conversation.files',{conversation},ot);await deny('conversation.file-trash',{conversation,files:[{path:p,version:files.files.find(f=>f.path===p).version}]},ot)
 assert.equal((await rpc('conversation.files',{conversation},st)).total,2)
 checks.push('Published references become unique file records with full names, current versions, search/sort/pagination; group members and Secretary authorized, outsiders denied')

 const previous=files.files.find(f=>f.path===p).version
 fs.writeFileSync(path.join(workspace.root,'reports',name),'%PDF-1.4\nnew revision\n%%EOF')
 await deny('conversation.file-trash',{conversation,files:[{path:q,version:files.files.find(f=>f.path===q).version},{path:p,version:previous}]},bt)
 assert.ok(fs.existsSync(path.join(workspace.root,'reports/Notes.md')),'stale batch must not delete its valid first file')
 await deny('conversation.file-trash',{conversation,files:[{path:'@workspace/../outside',version:'bad'}]})
 const current=await rpc('conversation.files',{conversation}),targets=current.files.map(({path,version})=>({path,version}))
 const trashed=await rpc('conversation.file-trash',{conversation,files:targets},bt)
 assert.equal(trashed.count,2);assert.equal((await rpc('conversation.files',{conversation})).total,0)
 assert.deepEqual((await rpc('conversation.file-trash',{conversation,files:targets},bt)).trashed,trashed.trashed,'unchanged retry returns the same receipts')
 const removed=await rpc('conversation.files',{conversation,state:'trash'});assert.equal(removed.total,2);assert.ok(removed.files.every(f=>f.deletedBy.employeeId===b.id&&f.canRestore))
 const unavailable=await rpc('chat.file',{id:group.id,path:p,operation:'info'});assert.equal(unavailable.exists,false);assert.equal(unavailable.trashed,true)
 assert.equal(hash(),historyHash,'delete never edits messages, references, task or read receipts')
 checks.push('Versioned delete preflights the whole batch, rejects stale/escaped paths, preserves posts, records the real actor and safely retries after a lost acknowledgment')

 await f.stop();await f.start();assert.equal((await rpc('conversation.files',{conversation,state:'trash'})).total,2)
 const pReceipt=trashed.trashed.find(file=>file.path===p)
 fs.writeFileSync(path.join(workspace.root,'reports',name),'A different new file must survive')
 await deny('conversation.file-restore',{conversation,files:trashed.trashed},at)
 assert.equal(fs.readFileSync(path.join(workspace.root,'reports',name),'utf8'),'A different new file must survive');assert.ok(!fs.existsSync(path.join(workspace.root,'reports/Notes.md')))
 fs.unlinkSync(path.join(workspace.root,'reports',name))
 await deny('conversation.file-restore',{conversation,files:[{path:p,trashId:trashed.trashed.find(f=>f.path===q).trashId}]})
 await rpc('conversation.file-restore',{conversation,files:trashed.trashed},at)
 assert.equal((await rpc('conversation.files',{conversation})).total,2);assert.equal((await rpc('conversation.files',{conversation,state:'trash'})).total,0)
 await rpc('conversation.file-restore',{conversation,files:trashed.trashed},at)
 assert.match(fs.readFileSync(path.join(workspace.root,'reports',name),'utf8'),/new revision/)
 await deny('conversation.file-trash',{conversation,files:targets},bt)
 assert.equal(hash(),historyHash)
 checks.push('Trash survives restart; restore preflights collisions, preserves a new same-name file, rejects cross-file receipts and supports idempotent recovery without overwriting')

 const next=(await rpc('conversation.files',{conversation})).files.find(file=>file.path===p)
 const removal=await rpc('conversation.file-trash',{conversation,files:[{path:p,version:next.version}]},bt)
 await rpc('chat.update',{id:group.id,members:[a.id]});await deny('conversation.files',{conversation,state:'trash'},bt);await deny('conversation.file-restore',{conversation,files:removal.trashed},bt)
 await rpc('conversation.file-restore',{conversation,files:removal.trashed},st)
 assert.equal((await rpc('conversation.files',{conversation},at)).total,2)
 const parsed=await f.cli('conversation','files',conversation,'--query','中文','--sort','size');assert.equal(parsed.total,1)
 checks.push('Membership revocation applies immediately to read/delete/restore; Secretary uses its own identity outside membership; real CLI reads the same file projection')
 const out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS??path.join(root,'artifacts/group-file-library');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,paidCalls:0,productionStateUsed:false},null,2)+'\n');console.log('PASS '+checks.join('; '))
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
