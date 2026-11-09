// Real Core/CLI with disposable employee profiles; no production state or paid inference.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {directoryName} from '../src/shared/directory-names.ts'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),out=path.join(f.root,'artifacts/conversation-workspaces'),checks=[]
const rpc=async(cmd,args={},auth=null)=>{const value=await f.request(auth,cmd,args);assert.ok(value.ok,value.error);return value.data}
const denied=async(cmd,args,auth)=>{const value=await f.request(auth,cmd,args);assert.equal(value.ok,false,cmd+' must be denied');return value.error}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=','base64')
const upload=async(conversation,name,data)=>{const begun=await rpc('messenger.upload-begin',{conversation,name,bytes:data.length});if(data.length)await rpc('transfer.upload-chunk',{id:begun.id,offset:0,data:data.toString('base64')});const done=await rpc('transfer.upload-commit',{id:begun.id});assert.equal(done.state,'completed');return done.destination}
const file=(conversation,operation,values={},auth=null)=>rpc('conversation.file',{conversation,operation,...values},auth)
try{
 await f.cli('group','add','Product');await f.cli('group','add','Engineering')
 const a=await f.create('Alex','Product','manager'),b=await f.create('Alex','Engineering'),outside=await f.create('Outside','Engineering'),ta=await f.token(a.id),tb=await f.token(b.id),to=await f.token(outside.id)
 const group=await rpc('chat.create',{name:'Release room',members:[a.id,b.id]}),other=await rpc('chat.create',{name:'Release room',members:[outside.id]}),channel=await rpc('channel.create',{name:'Research channel',engine:{kind:'external',location:'local',name:'Fixture collector'}})
 const ref='group:'+group.id,channelRef='channel:'+channel.id,wa=await rpc('conversation.workspace',{conversation:ref},ta),wb=await rpc('conversation.workspace',{conversation:ref},tb),wc=await rpc('conversation.workspace',{conversation:channelRef})
 assert.equal(path.basename(wa.root),'Release room');assert.equal(path.basename(wc.root),directoryName('Research channel'));assert.equal(wa.memberDirectory,undefined);assert.equal(wb.memberDirectory,undefined);assert.ok(wa.members.every(member=>member.directory===undefined));assert.deepEqual(fs.readdirSync(wa.root),[]);const ownFolder='Drafts',peerFolder='Reviews';await file(ref,'mkdir',{path:ownFolder},ta);await file(ref,'mkdir',{path:peerFolder},tb)
 assert.notEqual((await rpc('conversation.workspace',{conversation:'group:'+other.id})).root,wa.root)
 const guide=await f.call(ta,'api','docs','core/conversation-workspaces');assert.equal(guide.document,'core/conversation-workspaces');assert.equal(guide.markdown,fs.readFileSync(path.join(f.root,'docs/CONVERSATION_WORKSPACES.md'),'utf8'));assert.ok(guide.markdown.includes('agents conversation copy'));await denied('conversation.file',{conversation:ref,operation:'read',path:'brief.txt',base64:true},ta)
 assert.equal(wa.personalWorkspace,a.cwd);assert.equal(wb.personalWorkspace,b.cwd);assert.equal(wa.memberPath,undefined);assert.equal(wb.memberPath,undefined)
 assert.deepEqual(new Set((await rpc('conversation.workspaces',{},ta)).map(value=>value.conversation)),new Set([ref]))
 assert.equal((await f.call(ta,'conversation','workspace',ref)).memberDirectory,undefined)
 await denied('conversation.workspace',{conversation:ref},to);await denied('conversation.workspaces',{employee:b.id},ta)
 checks.push('Current membership, stable identities, same-name employees and same-name groups remain independent; personal workspace unchanged')
 const [photo,photo2,brief,empty]=await Promise.all([upload(ref,'sample.png',png),upload(ref,'sample.png',png),upload(ref,'brief.txt',Buffer.from('Original brief — immutable for employees.')),upload(ref,'empty.txt',Buffer.alloc(0))])
 assert.notEqual(photo,photo2);assert.match(photo,/^@workspace\//);assert.ok(!brief.includes('/uploads/'))
 assert.ok(fs.existsSync(path.join(wa.root,'brief.txt')));assert.equal(fs.readFileSync(path.join(wa.root,'brief.txt'),'utf8'),'Original brief — immutable for employees.')
 assert.equal((await file(ref,'read',{path:brief},ta)).content,'Original brief — immutable for employees.')
 assert.equal((await file(ref,'image',{path:photo},tb)).data,png.toString('base64'))
 assert.equal((await file(ref,'read',{path:empty},ta)).content,'')
 await file(ref,'write',{path:'brief.txt',content:'Original brief — immutable for employees.'},ta)
 await file(ref,'mkdir',{path:'user-folder'},ta);await file(ref,'write',{path:peerFolder+'/peer.txt',content:'Shared peer output',create:true},ta)
 for(const [operation,values] of [['write',{path:ownFolder+'/../brief.txt',content:'no'}],['trash',{path:'.'}],['trash',{path:'./'}],['write',{path:ownFolder+'/../../outside.txt',content:'no'}]])await denied('conversation.file',{conversation:ref,operation,...values},ta)
 await file(ref,'write',{path:ownFolder+'/notes.md',content:'Alex output',create:true},ta)
 assert.equal((await file(ref,'read',{path:ownFolder+'/notes.md'},tb)).content,'Alex output')
 const read=await file(ref,'read',{path:ownFolder+'/notes.md'},ta)
 await file(ref,'write',{path:ownFolder+'/notes.md',content:'Revised output',hash:read.hash},ta)
 await denied('conversation.file',{conversation:ref,operation:'write',path:ownFolder+'/notes.md',content:'Stale output',hash:read.hash},ta)
 const removed=await file(ref,'trash',{path:ownFolder+'/notes.md'},ta);await file(ref,'restore',{id:removed.id},ta)
 assert.equal((await file(ref,'read',{path:ownFolder+'/notes.md'},ta)).content,'Revised output')
 checks.push('Group peers share ordinary content folders and root writes; optimistic hashes and recoverable deletion work while root, traversal and metadata boundaries stay protected')
 const copy=async(from,to,auth)=>{const job=await f.call(auth,'conversation','copy','--from',JSON.stringify(from),'--to',JSON.stringify(to));return f.until(async()=>{const current=await rpc('conversation.transfer',{id:job.id},auth);return ['completed','failed','cancelled'].includes(current.state)&&current},'copy finishes')}
 const copied=await copy({conversation:ref,path:brief},{conversation:ref,path:ownFolder},ta);assert.equal(copied.state,'completed',copied.error)
 assert.equal((await file(ref,'read',{path:ownFolder+'/brief.txt'},tb)).content,'Original brief — immutable for employees.')
 const personal=await copy({conversation:ref,path:brief},{employee:'self',path:'.'},ta);assert.equal(personal.state,'completed',personal.error)
 assert.equal(fs.readFileSync(path.join(a.cwd,'brief.txt'),'utf8'),'Original brief — immutable for employees.')
 await rpc('workspace.write',{employee:a.id,path:'personal-result.txt',content:'Worked in personal Workspace.',create:true},ta)
 assert.equal((await copy({employee:'self',path:'personal-result.txt'},{conversation:ref,path:ownFolder},ta)).state,'completed')
 assert.equal((await file(ref,'read',{path:ownFolder+'/personal-result.txt'},tb)).content,'Worked in personal Workspace.')
 assert.equal((await copy({conversation:ref,path:brief},{conversation:ref,path:'.'},ta)).state,'failed','existing root file cannot be overwritten by copy')
 await denied('conversation.copy',{from:{conversation:ref,path:brief},to:{employee:b.id,path:'.'}},ta)
 const collision=await copy({conversation:ref,path:brief},{conversation:ref,path:ownFolder},ta);assert.equal(collision.state,'failed');assert.match(collision.error,/exists|overwrite|同名/i)
 fs.symlinkSync(path.join(wa.root,'brief.txt'),path.join(path.join(wa.root,ownFolder),'link.txt'))
 await denied('conversation.file',{conversation:ref,operation:'write',path:ownFolder+'/link.txt',content:'not allowed'},ta)
 await denied('conversation.file',{conversation:ref,operation:'read',path:ownFolder+'/link.txt'},ta)
 fs.unlinkSync(path.join(path.join(wa.root,ownFolder),'link.txt'))
 checks.push('Explicit copies work to the named folder and personal Workspace, and back; collision, other private workspace, overwrite and symlinks are rejected; root and peer writes share equal group rights')
 await rpc('session.send',{employee:a.id,text:'An independent private question'});await f.received(a.id,'An independent private question');await f.until(async()=>!(await f.status(a.id)).busy,'private baseline')
 const previousReply=(await f.status(a.id)).lastReply,personalFiles=fs.readdirSync(a.cwd).sort(),body='Compare these shared files and keep the assigned Team workspace.'
 const message=await rpc('chat.send',{id:group.id,text:body,images:[photo,photo2],files:[brief,empty],mentions:'all',clientMessageId:'shared-attachments-once'})
 const done=async()=>{const history=await rpc('chat.history',{id:group.id});return history.messages.find(value=>value.id===message.id)}
 await f.until(async()=>{const m=await done();const failure=m.deliveries.find(value=>['failed','interrupted'].includes(value.status));if(failure)throw Error(failure.error);return m.deliveries.every(value=>value.status==='completed')},'group notification work')
 assert.equal((await done()).text,body);assert.equal((await done()).attachments.length,4)
 for(const employee of [a,b]){
  const transcript=await rpc('session.transcript',{employee:employee.id}),notice=transcript.items.find(item=>item.role==='user'&&item.text.startsWith(body))
  assert.ok(notice);assert.ok(notice.text.includes('[User uploaded shared files]'));for(const name of [photo,photo2,brief,empty])assert.ok(notice.text.includes(name))
  assert.equal(notice.images?.length??0,0);assert.equal(notice.files?.length??0,0)
  const work=JSON.parse(fs.readFileSync(path.join(f.control,employee.id+'-work.json'),'utf8'));assert.ok(work.text.includes(employee.cwd));assert.ok(work.text.includes('Group files are shared conversation content'));assert.ok(work.text.includes('conversation.file'));assert.ok(work.text.includes('workspace.catalog'))
 }
 assert.deepEqual(fs.readdirSync(a.cwd).sort(),personalFiles);assert.deepEqual((await rpc('direct.history',{employee:a.id})).items,[])
 assert.equal((await rpc('chat.send',{id:group.id,text:body,images:[photo,photo2],files:[brief,empty],mentions:'all',clientMessageId:'shared-attachments-once'})).id,message.id)
 assert.equal((await rpc('chat.history',{id:group.id})).messages.length,1)
 checks.push('Multi-image/file + user text becomes one text-only employee notification; originals stay in group, no automatic copy or private unread; retry does not redispatch')
 const channelFile='research.txt';await file(channelRef,'write',{path:channelFile,content:'Explicit user download.',create:true})
 await denied('channel.message-send',{id:channel.id,text:'A channel is not a group'},ta)
 await denied('conversation.file',{conversation:channelRef,operation:'read',path:channelFile},ta)
 checks.push('Channels keep explicit user downloads without employee membership, group messaging or shared work injection')
 const references=['employee:'+a.id,ref,channelRef]
 await rpc('messenger.conversation',{conversations:references,patch:{archived:true}})
 for(const key of references)assert.equal((await rpc('messenger.state')).conversations[key].archived,true)
 await f.stop();await f.start()
 for(const key of references)assert.equal((await rpc('messenger.state')).conversations[key].archived,true)
 assert.equal((await file(channelRef,'read',{path:channelFile})).content,'Explicit user download.')
 await rpc('messenger.conversation',{conversations:references,patch:{archived:false}})
 for(const key of references)assert.equal((await rpc('messenger.state')).conversations[key].archived,false)
 await rpc('chat.update',{id:group.id,members:[a.id],name:'Release room renamed'})
 await denied('conversation.file',{conversation:ref,operation:'read',path:brief},tb)
 assert.equal((await rpc('conversation.workspace',{conversation:ref},ta)).root,wa.root)
 assert.ok(fs.existsSync(path.join(wa.root,peerFolder)));assert.equal(fs.readFileSync(path.join(wa.root,'brief.txt'),'utf8'),'Original brief — immutable for employees.')
 checks.push('Unified archive state and files survive restart; restoring all types preserves content; removed members lose API access without deleting their output')
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-scenarios.json'),JSON.stringify({passed:true,checks,modelCalls:0,productionData:false},null,2));console.log('PASS '+checks.join('\nPASS '))
}finally{await f.close()}
