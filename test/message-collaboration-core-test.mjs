// Real authenticated Core/CLI with disposable native/SSH fixtures; no production state or paid inference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-message-collaboration-'))),entry=path.join(temp,'daemon.cjs'),cloud=path.join(temp,'cloud'),bin=path.join(temp,'bin'),out=path.join(root,'artifacts/message-collaboration')
fs.mkdirSync(cloud);fs.mkdirSync(bin);fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
fs.writeFileSync(path.join(bin,'ssh'),"#!/usr/bin/env python3\nimport os,sys\nos.execv('/bin/sh',['sh','-c',sys.argv[-1]])\n",{mode:0o755})
await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
const f=await fixtureCore({PATH:bin+':'+process.env.PATH},entry),report={passed:false,checks:[],paidModelCalls:0,productionDataUsed:false},pass=text=>{report.checks.push(text);console.log('PASS '+text)}
const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
const deny=async(cmd,args,token)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' should reject');return value.error}
const policy=(conversation,token)=>rpc('conversation.policy',{conversation},token)
const office=async(conversation,employee,role,token)=>rpc('conversation.role',{conversation,employee,role,expectedRevision:(await policy(conversation,token)).revision},token)
const member=async(conversation,employee,action,token)=>rpc('conversation.member',{conversation,employee,action,expectedRevision:(await policy(conversation,token)).revision},token)
try{
 await rpc('group.add',{name:'Editorial'});await rpc('group.add',{name:'Elsewhere'})
 const owner=await f.create('Aster','Editorial'),admin=await f.create('Rowan','Editorial','manager'),secretary=await f.create('Mira','Editorial','secretary'),reader=await f.create('Reader','Editorial'),outside=await f.create('Outside','Elsewhere')
 const ot=await f.token(owner.id),at=await f.token(admin.id),st=await f.token(secretary.id),rt=await f.token(reader.id),xt=await f.token(outside.id)
 const group=await rpc('chat.create',{name:'Reading room',members:[owner.id,admin.id,secretary.id,reader.id],ownerId:owner.id}),g='group:'+group.id
 const source=await rpc('channel.source-add',{plugin:'telegram',targetId:'collaboration-fixture',locator:'periodical-fixture',name:'Periodical library'}),channelId=source.channelId,c='channel:'+channelId
 const access=await rpc('channel.access',{id:channelId});await rpc('channel.access',{id:channelId,employeeIds:[owner.id,admin.id,reader.id],expectedRevision:access.revision},st)
 await office(g,admin.id,'admin',ot);await office(g,reader.id,'admin',at);await office(g,reader.id,'member',at)
 await deny('conversation.role',{conversation:g,employee:owner.id,role:'member',expectedRevision:(await policy(g,at)).revision},at)
 await deny('conversation.member',{conversation:g,employee:owner.id,action:'remove',expectedRevision:(await policy(g,at)).revision},at)
 for(const command of ['conversation.member','conversation.role','conversation.mute'])await deny(command,{conversation:c,employee:reader.id,action:'add',role:'admin',member:'all',muted:true,expectedRevision:1},st)
 await deny('channel.context',{id:channelId},xt);await deny('workspace.catalog',{employee:reader.id},xt)
 const audit=await rpc('conversation.audit',{conversation:g,limit:2},ot);assert.equal(audit.rows.length,2);assert.ok(audit.nextBefore)
 const cat=await rpc('workspace.catalog',{},rt);assert.deepEqual(new Set(cat.workspaces.map(w=>w.id)),new Set(['company:'+reader.id,g]));assert.ok(cat.workspaces.every(w=>w.employeeId===reader.id))
 assert.deepEqual((await rpc('channel.get',{id:channelId},rt)).memberIds,[])
 pass('Group offices and scoped audit remain independent of Company roles; channel reading grants do not create group members or workspaces.')
 const rw=await rpc('conversation.workspace',{conversation:g},rt),sw=await rpc('conversation.workspace',{conversation:g},st)
 await rpc('conversation.file',{conversation:g,operation:'write',path:'original.txt',content:'Original',create:true})
 for(const token of [rt,ot,at,st])await rpc('conversation.file',{conversation:g,operation:'write',path:'original.txt',content:'Peer revision'},token)
 await rpc('conversation.file',{conversation:g,operation:'mkdir',path:rw.memberDirectory+'/notes'},rt)
 await rpc('conversation.file',{conversation:g,operation:'write',path:rw.memberDirectory+'/notes/result.md',content:'# Result',create:true},rt)
 await rpc('conversation.file',{conversation:g,operation:'write',path:rw.memberDirectory+'/notes/result.md',content:'Secretary revision'},st)
 const trashed=await rpc('conversation.file',{conversation:g,operation:'trash',path:'original.txt'},st);await rpc('conversation.file',{conversation:g,operation:'restore',id:trashed.id},rt)
 for(const target of ['../escape.txt',rw.memberDirectory+'/../../escape.txt','/tmp/escape.txt',rw.memberDirectory+'/.agents-company/secret'])await deny('conversation.file',{conversation:g,operation:'write',path:target,content:'no'},rt)
 await deny('conversation.file',{conversation:g,operation:'trash',path:rw.memberDirectory},rt)
 pass('Every group peer and Secretary can edit, trash and restore shared files; managed folder identity and path boundaries remain protected.')
 const host=await rpc('host.create',{name:'Fixture document host',host:'fixture',os:'linux',defaultDirectory:cloud}),collector=await rpc('channel.collector-add',{name:'Fixture document source',sourceIds:[source.id]})
 await rpc('channel.update',{id:channelId,engine:{kind:'external',location:'remote',name:'Fixture collector',host:'fixture',endpoint:'http://127.0.0.1:5152/api/channels/collector',collectorId:collector.collector.id,fileStorage:{hostId:host.id,directory:cloud}}})
 const bytes=Buffer.concat([Buffer.from('%PDF-1.7\n'),randomBytes(650000)]),sha256=createHash('sha256').update(bytes).digest('hex'),physical=path.join(cloud,sha256.slice(0,2),sha256)
 fs.mkdirSync(path.dirname(physical),{recursive:true});fs.writeFileSync(physical,bytes)
 const doc={id:'magazine',name:'magazine.pdf',mimeType:'application/pdf',bytes:bytes.length,sha256},publishedAt=Date.now(),externalId='complete-post'
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
 const {media:image}=await rpc('channel.media-put',{sourceId:source.id,externalId,publishedAt,mediaKey:'cover',name:'cover.png',mimeType:'image/png',data:png})
 const post=await rpc('channel.publish',{sourceId:source.id,externalId,publishedAt,title:'English magazine',body:'Full text and https://example.org/article',url:'https://example.org/issue',mediaIds:[image.id],files:[doc]})
 const full=await rpc('conversation.entry',{conversation:c,id:post.id},rt);assert.equal(full.entry.body,'Full text and https://example.org/article');assert.equal(full.attachments.length,2);assert.equal(full.links.length,2);assert.equal((await rpc('channel.image',{channelId,postId:post.id,mediaId:image.id},rt)).data,png)
 await deny('conversation.entry',{conversation:g,id:post.id},rt)
 const download=async(attachmentId,workspace,key,token=rt,extra={})=>{const job=await rpc('conversation.download',{conversation:c,entryId:post.id,attachmentId,clientRequestId:key,...(workspace?{workspace}:{}),...extra},token);const done=await f.until(async()=>{const s=await rpc('conversation.download-status',{id:job.id},token);return !['running','queued'].includes(s.state)&&s},'attachment copy');assert.equal(done.state,'completed',done.error);return done}
 const copy=await download('document:magazine',undefined,'own-message');assert.equal(copy.workspace,'company:'+reader.id);assert.ok(copy.absolutePath.startsWith(reader.cwd+'/'));assert.ok(fs.readFileSync(copy.absolutePath).equals(bytes));assert.ok(!fs.existsSync(path.join(rw.root,doc.name)))
 const company=await download('document:magazine','company:'+reader.id,'own-company');assert.ok(fs.readFileSync(company.absolutePath).equals(bytes));assert.ok(company.absolutePath.startsWith(reader.cwd+'/'))
 const duplicate=await rpc('conversation.download',{conversation:c,entryId:post.id,attachmentId:'document:magazine',clientRequestId:'own-message'},rt);assert.equal(duplicate.id,copy.id)
 await deny('conversation.download-status',{id:copy.id},st);await deny('conversation.download',{conversation:c,entryId:post.id,attachmentId:'document:magazine',clientRequestId:'escape',workspace:'company:'+secretary.id},rt)
 const second=await download('document:magazine',undefined,'second-copy');assert.notEqual(second.absolutePath,copy.absolutePath)
 const picture=await download('image:'+image.id,g,'image-group');assert.equal(fs.readFileSync(picture.absolutePath).toString('base64'),png)
 const changed=Buffer.from(bytes);changed[200]^=1;fs.writeFileSync(physical,changed)
 const bad=await rpc('conversation.download',{conversation:c,entryId:post.id,attachmentId:'document:magazine',clientRequestId:'bad-hash',name:'invalid.pdf'},rt)
 const failure=await f.until(async()=>{const s=await rpc('conversation.download-status',{id:bad.id},rt);return s.state==='failed'&&s},'hash rejection');assert.match(failure.error,/SHA-256/);assert.ok(!fs.existsSync(path.join(reader.cwd,'invalid.pdf')));fs.writeFileSync(physical,bytes)
 const gm=await rpc('chat.post',{id:group.id,text:'Published member document',files:['@workspace/'+(await rpc('conversation.workspace',{conversation:g},rt)).memberDirectory+'/cover.png'],clientMessageId:'agent-file'},rt)
 assert.equal((await rpc('conversation.entry',{conversation:g,id:gm.id},ot)).attachments.length,1)
 pass('Complete published entry metadata and protected image bytes; real streaming PDF downloads into own Message/Company workspaces, dedup/collision handling, hash rejection and Agent attachment publication.')
 await deny('channel.post-trigger-set',{id:channelId,employee:reader.id,everyPosts:2,prompt:'No automatic work',enabled:true,expectedRevision:0})
 const revoked=await rpc('channel.access',{id:channelId});await rpc('channel.access',{id:channelId,employeeIds:[owner.id,admin.id],expectedRevision:revoked.revision},st)
 await deny('conversation.entry',{conversation:c,id:post.id},rt)
 await deny('conversation.download',{conversation:c,entryId:post.id,attachmentId:'document:magazine',clientRequestId:'revoked-copy'},rt)
 assert.equal((await rpc('conversation.entry',{conversation:c,id:post.id},st)).attachments.length,2)
 assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('schedule.history'),[])
 pass('Channel entry/download follow current reading grants and revocation; Secretary stays authorized; no implicit post-count tasks.')
 report.passed=true
}catch(error){report.error=error.stack;throw error}finally{await f.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-verification.json'),JSON.stringify(report,null,2));fs.rmSync(temp,{recursive:true,force:true})}
