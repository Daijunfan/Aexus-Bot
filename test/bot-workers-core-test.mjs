import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-bot-workers-')),checks=[],calls=[],remote=[{id:'primary-dot',name:'Dot',provider:'dots',kind:'private'},{id:randomUUID(),name:'Grok sample',provider:'grok',kind:'private'}],histories=new Map(remote.map(b=>[b.id,[]])),blob=Buffer.from('Synthetic external shared document\n'),fileId='fixture-file',files=new Map([[fileId,blob]])
const message=(text,attachments=[])=>({id:randomUUID(),revision:randomUUID(),cursor:String(Date.now()),role:'assistant',text,createdAt:Date.now(),files:attachments})
let heldList
const server=http.createServer(async(req,res)=>{try{let bytes='';for await(const b of req)bytes+=b;const input=JSON.parse(bytes);calls.push(input);const a=input.args;let result
 switch(input.method){
  case 'list':if(a.provider==='grok'&&heldList){const held=heldList;heldList=null;held.started();await held.wait}result=remote.filter(b=>b.provider===a.provider);break
  case 'status':result={issue:null,checkedAt:Date.now()};break;
  case 'messages':result=histories.get(a.binding.remoteId)??[];break
  case 'create':{let b=remote.find(b=>b.id===a.id);if(!b){b={id:a.id,name:a.name,provider:'grok',kind:a.members?'group':'private',participantIds:a.members};remote.push(b);histories.set(b.id,[])}result=b;break}
  case 'send':{histories.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:Date.now(),files:[]});result={id:a.requestId,accepted:true};break}
  case 'upload':result={path:'uploaded:'+a.sha256};break
  case 'read':{const b=files.get(a.file.remotePath);if(!b)throw Error('Unknown fixture file');result={data:b.subarray(a.offset,a.offset+a.length).toString('base64'),totalSize:b.length,mimeType:'text/plain'};break}
  default:throw Error('Unknown fixture operation '+input.method)
 }
 res.setHeader('content-type','application/json');res.end(JSON.stringify(result))
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}))}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs')
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 const codex=path.join(temp,'guarded-codex.cjs'),fixture=fs.readFileSync(path.join(root,'test/fixtures/initialization-codex.cjs'),'utf8'),workMarker='async function readWorkDocument(text){'
 assert.ok(fixture.includes(workMarker))
 fs.writeFileSync(codex,fixture.replace(workMarker,workMarker+`if(text.includes('self-delete-probe')){const ask=async(command,args)=>{const r=await nativeTool('agents_company_api',{command,args});return r.result};const listed=await ask('schedule.list',{employee}),job=JSON.parse(listed.content[0].text).data.find(j=>j.name==='Self-delete guard');const deletion=await ask('schedule.delete',{id:job.id});note('guard-deletion',deletion);await ask('direct.post',{text:'SELF_DELETE_GUARD_COMPLETED',clientMessageId:'guard-completed'});return}\n`),{mode:0o755})
 f=await fixtureCore({CODEX_BIN:codex,AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+server.address().port},entry)
 const rpc=async(command,args={},token=null)=>{const r=await f.request(token,command,args);assert.ok(r.ok,r.error);return r.data},deny=async(command,args,token)=>{const r=await f.request(token,command,args);assert.equal(r.ok,false,command+' should fail');return r.error},pass=s=>{checks.push(s);console.log('PASS '+s)},finish=async(id,token)=>f.until(async()=>{const d=await rpc('conversation.download-status',{id},token);if(d.state==='failed')throw Error(d.error);return d.state==='completed'&&d},'attachment download')
 await rpc('group.add',{name:'A'});const a=await f.create('Alice'),b=await f.create('Blake'),secretary=await f.create('Secretary','A','secretary'),ta=await f.token(a.id),tb=await f.token(b.id),ts=await f.token(secretary.id)
 let synced=await rpc('bot.sync');assert.ok(synced.providers.every(p=>p.connected));let bots=await rpc('bot.list'),dot=bots.find(g=>g.bot.provider==='dots'),grok=bots.find(g=>g.bot.provider==='grok')
 const dotAppearance=await rpc('bot.appearance',{id:dot.id},ts);assert.equal(dotAppearance.avatar,'codex');assert.equal(dotAppearance.native,true);assert.equal(dotAppearance.editable,false)
 const dotAppearanceNext=await rpc('bot.appearance',{id:dot.id,avatar:'codex',expectedRevision:dotAppearance.revision},ts);assert.equal(dotAppearanceNext.avatar,'codex')
 await deny('bot.appearance',{id:dot.id,avatar:'fate-rin-chibi',expectedRevision:dotAppearanceNext.revision},ta)
 await deny('bot.appearance',{id:dot.id,avatar:'missing-character',expectedRevision:dotAppearanceNext.revision},ts)
 await deny('bot.appearance',{id:dot.id,avatar:'fate-rin-chibi',expectedRevision:dotAppearance.revision},ts)
 await deny('bot.appearance',{id:grok.id,avatar:'fate-rin-chibi',expectedRevision:1},ts)
 await rpc('bot.sync');assert.equal((await rpc('bot.appearance',{id:dot.id},ts)).avatar,'codex')
 pass('Dot uses fixed original Codey across sync and rejects employee character overrides; Grok keeps its original visual identity')
 assert.equal(dot.bot.role,'worker');assert.equal(dot.bot.kind,'private');assert.equal(dot.memberIds.length,0);assert.ok((await rpc('messenger.directory',{type:'outsource'})).entries.some(e=>e.id===dot.id));assert.ok((await rpc('messenger.directory',{type:'private'})).entries.some(e=>e.id===dot.id));assert.ok(!(await rpc('messenger.directory',{type:'groups'})).entries.some(e=>e.id===dot.id))
 assert.deepEqual(await rpc('bot.list',{},ta),[]);await deny('direct.send',{employee:dot.id,text:'denied',clientMessageId:'denied'},ta);await deny('chat.history',{id:dot.id},ta)
 const access=await rpc('bot.access',{id:dot.id});await rpc('bot.access',{id:dot.id,employeeIds:[a.id],expectedRevision:access.revision})
 assert.ok((await rpc('api.list',{},ta)).some(c=>c.name==='direct.send'));assert.equal((await rpc('bot.list',{},ta)).length,1)
 const raw='Please perform the delegated task. No application context.',sent=await rpc('direct.send',{employee:dot.id,text:raw,clientMessageId:'one-delegation'},ta)
 assert.equal(sent.status,'accepted');assert.equal(calls.filter(c=>c.method==='send').at(-1).args.text,raw);assert.equal(Object.keys(calls.find(c=>c.method==='send').args).some(k=>/credential|token|system|prompt/.test(k)),false)
 assert.equal((await rpc('direct.send',{employee:dot.id,text:raw,clientMessageId:'one-delegation'},ta)).directMessageId,sent.directMessageId)
 await deny('direct.send',{employee:dot.id,text:'changed retry',clientMessageId:'one-delegation'},ta)
 assert.equal(calls.filter(c=>c.method==='send').length,1)
 await deny('direct.send',{employee:b.id,text:'unrelated native private input',clientMessageId:'native'},ta)
 await deny('direct.send-status',{employee:b.id,clientMessageId:'native'},ta)
 await deny('auth.agent-token',{employee:dot.id},null);await deny('session.open',{cardId:dot.id},null)
 assert.equal((await rpc('session.list')).sessions.length,3)
 pass('External Workers have no employee credentials or native contexts; exact raw delegation, grants, same direct/chat APIs and durable send deduplication are enforced')
 const reply=message('A first reply',[{id:fileId,remotePath:fileId,name:'report.txt',bytes:blob.length,mimeType:'text/plain'}]);histories.get('primary-dot').push(reply);await rpc('bot.sync')
 const history=await rpc('direct.history',{employee:dot.id},ta),incoming=history.items.find(m=>m.role==='assistant');assert.equal(incoming.blocks[0].text,'A first reply')
 assert.equal((await rpc('chat.history',{id:dot.id},ta)).messages.find(m=>m.id===incoming.id).text,'A first reply')
 const library=await rpc('conversation.files',{conversation:'group:'+dot.id},ta);assert.equal(library.readOnly,true);assert.ok(library.files.every(file=>!file.canTrash&&file.state==='external'));await deny('conversation.file-trash',{conversation:'group:'+dot.id,files:[{path:library.files[0].path,version:library.files[0].version}]},ta)
 const pub=await rpc('conversation.entry',{conversation:'employee:'+dot.id,id:incoming.id},ta),download=await rpc('conversation.download',{conversation:'employee:'+dot.id,entryId:incoming.id,attachmentId:pub.attachments[0].id,clientRequestId:'bot-own-copy'},ta),done=await finish(download.id,ta)
 assert.ok(fs.readFileSync(path.join(a.cwd,done.name)).equals(blob))
 const local=path.join(temp,'secretary-save.txt');await rpc('conversation.download-local',{conversation:'group:'+dot.id,entryId:incoming.id,attachmentId:pub.attachments[0].id,path:local},ts);assert.ok(fs.readFileSync(local).equals(blob))
 await deny('conversation.download-local',{conversation:'group:'+dot.id,entryId:incoming.id,attachmentId:pub.attachments[0].id,path:path.join(temp,'no.txt')},ta)
 await rpc('direct.acknowledge',{employee:dot.id,messageId:incoming.id});assert.equal((await rpc('chat.get',{id:dot.id})).unread,false)
 const next=message('An independently delayed follow-up');histories.get('primary-dot').push(next);await rpc('bot.sync');assert.equal((await rpc('chat.get',{id:dot.id})).unread,true)
 await rpc('direct.acknowledge',{employee:dot.id,messageId:incoming.id});assert.equal((await rpc('chat.get',{id:dot.id})).unread,true)
 pass('Native bot attachments use the ordinary entry/download API into own workspace or Secretary-selected Mac path; read markers never clear a newer late reply')
 await rpc('workspace.write',{employee:a.id,path:'edited.txt',content:'an edited local copy',create:true},ta)
 const upload=await rpc('conversation.upload',{conversation:'group:'+dot.id,from:{path:'edited.txt'},path:'edited.txt',clientRequestId:'bot-share-copy'},ta)
 await f.until(async()=>{const d=await rpc('conversation.upload-status',{id:upload.id},ta);if(d.state==='failed')throw Error(d.error);return d.state==='completed'},'uploaded shared copy')
 await rpc('chat.send',{id:dot.id,text:'Use the updated document',files:['@workspace/edited.txt'],clientMessageId:'bot-uploaded-message'},ta)
 const up=calls.filter(c=>c.method==='upload').at(-1);assert.equal(up.args.sha256,createHash('sha256').update('an edited local copy').digest('hex'));assert.equal(calls.filter(c=>c.method==='send').at(-1).args.files[0].name,'edited.txt')
 const createdId=randomUUID(),created=await rpc('bot.create',{name:'New native bot',clientRequestId:createdId},ts);assert.equal(created.bot.remoteId,createdId);assert.equal((await rpc('bot.create',{name:'New native bot',clientRequestId:createdId},ts)).id,created.id);await deny('bot.create',{name:'Changed',clientRequestId:createdId},ts);await deny('bot.create',{name:'Forbidden',clientRequestId:randomUUID()},ta)
 const nativeGroup=await rpc('bot.group-create',{name:'Native group',members:[grok.id,created.id],clientRequestId:randomUUID()},ts);assert.equal(nativeGroup.bot.kind,'group');assert.deepEqual(nativeGroup.memberIds,[]);assert.equal(nativeGroup.bot.participantIds.length,2)
 const originalNativeName=remote.find(bot=>bot.id===createdId).name
 await rpc('bot.update',{id:created.id,name:'Local display alias',expectedRevision:1},ts);await rpc('bot.sync');assert.equal((await rpc('bot.list')).find(bot=>bot.id===created.id).name,'Local display alias');assert.equal(remote.find(bot=>bot.id===createdId).name,originalNativeName)
 await deny('bot.update',{id:created.id,name:'stale',expectedRevision:1},ts);await deny('bot.update',{id:created.id,name:'forbidden',expectedRevision:2},ta)
 const beforeRemove=await rpc('bot.access',{id:created.id},ts);await rpc('bot.access',{id:created.id,employeeIds:[a.id],expectedRevision:beforeRemove.revision},ts)
 await deny('bot.delete',{id:created.id},ta)
 let releaseList,listStarted;const started=new Promise(resolve=>{listStarted=resolve});heldList={started:listStarted,wait:new Promise(resolve=>{releaseList=resolve})};const syncing=rpc('bot.sync');await started;await rpc('bot.delete',{id:created.id},ts);releaseList();await syncing;await rpc('bot.sync');assert.ok(!(await rpc('bot.list')).some(bot=>bot.id===created.id));await deny('chat.history',{id:created.id},ta)
 assert.ok((await rpc('bot.list',{includeRemoved:true},ts)).some(bot=>bot.id===created.id&&bot.removed));await deny('bot.list',{includeRemoved:true},ta);assert.ok(remote.some(bot=>bot.id===createdId))
 const reconnected=await rpc('bot.restore',{id:created.id},ts);assert.equal(reconnected.id,created.id);assert.equal(reconnected.name,'Local display alias');assert.deepEqual(reconnected.memberIds,[]);await deny('chat.history',{id:created.id},ta)
 pass('Bot editing changes only its local alias; removal revokes access and survives sync; explicit restoration retains identity/history without reviving employee grants')
 const ga=await rpc('bot.access',{id:nativeGroup.id},ts);await rpc('bot.access',{id:nativeGroup.id,employeeIds:[b.id],expectedRevision:ga.revision},ts)
 const post=await rpc('chat.post',{id:nativeGroup.id,text:'Explicit native group delegation',clientMessageId:'grok-group-explicit'},tb);assert.ok(post.id);assert.equal(post.text,'Explicit native group delegation');await deny('chat.history',{id:nativeGroup.id},ta)
 const quoted=await rpc('direct.send',{employee:dot.id,text:'Review this excerpt',replyTo:incoming.id,replyQuote:{text:'A first reply',offset:0},clientMessageId:'quoted-same-bot'},ta);assert.ok(quoted.directMessageId);assert.ok(calls.filter(c=>c.method==='send').at(-1).args.text.startsWith('> A first reply'))
 const cross=await rpc('direct.send',{employee:grok.id,text:'Review the selected Dot reply',replyTo:incoming.id,replyConversation:'employee:'+dot.id,replyTextOnly:true,clientMessageId:'cross-bot-excerpt'},ts);assert.ok(cross.directMessageId);assert.ok(calls.filter(c=>c.method==='send').at(-1).args.text.includes('A first reply'));assert.equal(cross.message.reply.conversation,'group:'+dot.id)
 pass('Ordinary shared upload sends edited files to bots; Grok bot/group creation is retry-safe, separately authorized and independent of local employee membership')
 // Do not lose multiple replies while a worker is busy, cooling down or Core restarts.
 const job=await rpc('schedule.create',{spec:{name:'Persistent Dot reply watch',action:{type:'agent',employeeId:'self',prompt:'Review the new replies and continue the delegated work.'},rule:{kind:'event',event:'message.received',conversation:'group:'+dot.id,cooldownSeconds:1},timeoutSeconds:15}},ta)
 fs.writeFileSync(path.join(f.control,a.id+'.hold-user'),'');const live=await rpc('session.open',{cardId:a.id});await rpc('session.send',{id:live.sessionId,text:'A held manual turn'});await f.until(async()=>(await f.status(a.id)).busy,'manual busy')
 const late1=message('Part one while busy'),late2=message('Part two at a separate time');histories.get('primary-dot').push(late1);await rpc('bot.sync');histories.get('primary-dot').push(late2);await rpc('bot.sync')
 assert.equal((await rpc('schedule.get',{id:job.id},ta)).pendingEvents.length,2);await rpc('bot.sync');assert.equal((await rpc('schedule.get',{id:job.id},ta)).pendingEvents.length,2)
 await f.stop();fs.rmSync(path.join(f.control,a.id+'.hold-user'));await f.start()
 const first=await f.until(async()=>{const runs=await rpc('schedule.history',{id:job.id},ta);return runs.find(r=>r.status==='succeeded')},'persisted reply wake')
 assert.equal(first.events.length,2);assert.equal((await rpc('schedule.get',{id:job.id},ta)).pendingEvents.length,0)
 const late3=message('Part three after the initial reply');histories.get('primary-dot').push(late3);await rpc('bot.sync')
 await f.until(async()=>(await rpc('schedule.history',{id:job.id},ta)).filter(r=>r.status==='succeeded').length===2,'later reply wakes again')
 assert.equal((await rpc('schedule.get',{id:job.id},ta)).enabled,true)
 let revoked=await rpc('bot.access',{id:dot.id});await rpc('bot.access',{id:dot.id,employeeIds:[],expectedRevision:revoked.revision});await deny('chat.history',{id:dot.id},ta);assert.equal((await rpc('schedule.get',{id:job.id})).enabled,false);assert.equal((await rpc('schedule.status')).running,true)
 assert.ok((await rpc('direct.history',{employee:dot.id},ts)).items.length>0)
 pass('Spaced Dot replies persist during busy turns and restart, coalesce without loss, wake again later, deduplicate, and revoke one watch without stopping the scheduler')
 // Core-owned program supervision, no Core identity in the child, own-owner boundaries.
 const monitorProgram=path.join(a.cwd,'watch.cjs');fs.writeFileSync(monitorProgram,`console.log(JSON.stringify({id:'one',type:'channel.posted',data:{coreIdentity:!!process.env.AGENTS_COMPANY_TOKEN||!!process.env.AGENTS_COMPANY_SOCKET}}));console.log(JSON.stringify({id:'one',data:{duplicate:true}}));setTimeout(()=>console.log(JSON.stringify({id:'two',data:{value:2}})),1200);setTimeout(()=>process.exit(0),1800)`)
 const monitor=await rpc('monitor.create',{name:'Synthetic source monitor',program:[process.execPath,'watch.cjs'],restartOnLaunch:true},ta)
 await deny('monitor.start',{id:monitor.id},tb)
 const manager=await f.create('Monitor manager','A','manager'),tm=await f.token(manager.id);assert.ok((await rpc('monitor.list',{employee:a.id},tm)).some(m=>m.id===monitor.id));await rpc('monitor.read',{id:monitor.id},tm);await deny('monitor.start',{id:monitor.id},tm)
 const delegated=await rpc('schedule.create',{spec:{name:'Managed monitor watch',action:{type:'agent',employeeId:a.id,prompt:'Handle the owned monitor event.'},rule:{kind:'event',event:'monitor.output',monitorId:monitor.id,cooldownSeconds:0},enabled:false}},tm);assert.equal(delegated.action.employeeId,a.id)
 const mj=await rpc('schedule.create',{spec:{name:'Script events',action:{type:'agent',employeeId:'self',prompt:'Review the monitor source event.'},rule:{kind:'event',event:'monitor.output',monitorId:monitor.id,cooldownSeconds:0},timeoutSeconds:15}},ta)
 const exitJob=await rpc('schedule.create',{spec:{name:'Script exit',action:{type:'agent',employeeId:'self',prompt:'Review the monitor exit.'},rule:{kind:'event',event:'monitor.exited',monitorId:monitor.id,cooldownSeconds:0},timeoutSeconds:15}},ta)
 await rpc('monitor.start',{id:monitor.id},ta)
 await f.until(async()=>(await rpc('monitor.list',{},ta))[0]?.state==='exited','monitor finishes')
 const runs=await f.until(async()=>{const runs=await rpc('schedule.history',{id:mj.id},ta);return runs.filter(r=>r.status==='succeeded').length===2&&runs},'script output wakes twice')
 assert.equal(runs.flatMap(r=>r.events??[]).length,2);assert.ok(runs.flatMap(r=>r.events??[]).every(e=>e.type==='monitor.output'));assert.equal(runs.flatMap(r=>r.events??[]).find(e=>e.id==='one').data.coreIdentity,false)
 await f.until(async()=>(await rpc('schedule.history',{id:exitJob.id},ta)).some(r=>r.status==='succeeded'),'script exit wakes')
 await rpc('monitor.remove',{id:monitor.id},ts);assert.equal((await rpc('schedule.get',{id:mj.id})).enabled,false);assert.deepEqual(await rpc('monitor.list',{},ta),[]);assert.ok(fs.existsSync(monitorProgram));assert.equal((await rpc('schedule.status')).running,true)
 await deny('monitor.create',{name:'Escape',program:['true'],cwd:'../../outside'},ta)
 pass('Owned monitored programs emit durable namespaced JSON events, duplicate IDs do not wake twice, exit wakes separately, no app credentials enter child env, and removal preserves scripts')
 const sid=(await rpc('session.open',{cardId:a.id})).sessionId;await rpc('config.permission',{id:sid,mode:'bypassPermissions'})
 const guard=await rpc('schedule.create',{spec:{name:'Self-delete guard',action:{type:'agent',employeeId:'self',prompt:'self-delete-probe'},rule:{kind:'event',event:'signal',cooldownSeconds:0}}},ta)
 await rpc('schedule.trigger',{id:guard.id,eventId:'guard-event'},ta)
 await f.until(async()=>(await rpc('schedule.history',{id:guard.id},ta)).some(r=>r.status==='succeeded'),'self-delete guard work completes')
 const deletion=JSON.parse(fs.readFileSync(path.join(f.control,a.id+'-guard-deletion.json'),'utf8'));assert.ok(!deletion.isError);assert.equal(JSON.parse(deletion.content[0].text).data.continuingRunIds.length,1)
 await deny('schedule.get',{id:guard.id},ta);assert.ok((await rpc('direct.history',{employee:a.id})).items.some(m=>m.role==='assistant'&&JSON.stringify(m.blocks).includes('SELF_DELETE_GUARD_COMPLETED')))
 await deny('schedule.get',{id:guard.id},null)
 pass('Self-deleting an active trigger removes future wakes without interrupting that same turn; the Agent publishes its result and completes successfully')
 const out=path.join(root,'artifacts/bot-workers');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,realModelCalls:0,remoteNetworkCalls:0,fixtureCalls:calls.length},null,2)+'\n')
}finally{await f?.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true})}
