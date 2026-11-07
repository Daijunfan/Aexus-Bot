// Actual Core/CLI and persisted permissions; isolated profiles, synthetic news, no inference.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore(),checks=[],out=path.join(f.root,'artifacts/secretary-channel-access')
const rpc=async(command,args={},token=null)=>{const r=await f.request(token,command,args);assert.ok(r.ok,command+': '+r.error);return r.data}
const deny=async(command,args,token)=>{const r=await f.request(token,command,args);assert.equal(r.ok,false,command+' unexpectedly allowed');return r}
const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await rpc('group.add',{name:'Access fixtures'})
 const people=[];for(const role of ['employee','employee','manager','governor','secretary','secretary'])people.push(await f.create(role+' '+people.length,'Access fixtures',role))
 const [a,b,manager,governor,secretary,peer]=people,tokens=await Promise.all(people.map(p=>f.token(p.id))),[aToken,bToken,managerToken,governorToken,secretaryToken]=tokens
 const sources=[];for(const plugin of ['x','youtube','telegram'])sources.push(await rpc('channel.source-add',{plugin,locator:'@accessfixture'+plugin,name:plugin==='telegram'?'科技圈在花频道':plugin+' source'}))
 const [x,youtube,telegram]=sources,png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP+kAAAAASUVORK5CYII=',stamp=Date.now()-1000
 const image=(await rpc('channel.media-put',{sourceId:x.id,externalId:'news',publishedAt:stamp,mediaKey:'original',name:'original.png',mimeType:'image/png',data:png})).media
 const posts=[];for(const source of sources)posts.push(await rpc('channel.publish',{sourceId:source.id,externalId:'news',publishedAt:stamp,title:'Frontier AI news',body:'Verified synthetic source: '+source.name,mediaIds:source===x?[image.id]:[]}))
 const unchanged=people.map(p=>({id:p.id,session:p.threadId,native:p.nativeSessions})),unread=await rpc('channel.read-state',{id:x.channelId,entryIds:[posts[0].id]})
 for(const token of tokens.slice(0,4)){
  assert.deepEqual(await rpc('channel.list',{},token),[])
  for(const [cmd,args]of [['channel.get',{id:x.channelId}],['channel.context',{id:x.channelId}],['channel.fetch-text',{id:x.channelId}],['channel.fetch-images',{id:x.channelId}],['channel.search',{id:x.channelId,query:'AI'}]])await deny(cmd,args,token)
 }
 assert.equal((await rpc('channel.list',{},secretaryToken)).length,3)
 for(const source of sources)assert.equal((await rpc('channel.fetch-text',{id:source.channelId,limit:1},secretaryToken)).messages.length,1)
 assert.equal((await rpc('channel.posts',{channelId:x.channelId},secretaryToken)).posts[0].id,posts[0].id)
 assert.equal((await rpc('channel.post',{id:posts[0].id},secretaryToken)).id,posts[0].id)
 assert.equal((await rpc('channel.timeline',{id:x.channelId,kind:'news'},secretaryToken)).entries[0].id,posts[0].id)
 pass('Employee/Manager/Governor require a channel grant; Secretary sees and reads every unsaved channel without membership or a grant')

 let access=await rpc('channel.access',{id:x.channelId},secretaryToken)
 access=await rpc('channel.access',{id:x.channelId,employeeIds:[a.id],expectedRevision:access.revision},secretaryToken)
 const granted=await rpc('channel.get',{id:x.channelId},aToken);assert.deepEqual(granted.readerIds,[a.id]);assert.deepEqual(granted.memberIds,[]);await deny('conversation.workspace',{conversation:'channel:'+x.channelId},aToken)
 assert.deepEqual(access.employeeIds,[a.id]);assert.deepEqual((await rpc('channel.list',{},aToken)).map(c=>c.id),[x.channelId])
 const context=await rpc('channel.context',{id:x.channelId},aToken);assert.equal(context.reading.text,'channel.fetch-text');assert.equal(context.sources[0].id,x.id)
 assert.equal((await rpc('channel.fetch-text',{id:x.channelId,limit:1},aToken)).messages[0].id,posts[0].id)
 assert.equal((await rpc('channel.fetch-images',{id:x.channelId,limit:1},aToken)).messages[0].images[0].data,png)
 assert.equal((await rpc('channel.search',{id:x.channelId,query:'Frontier'},aToken)).total,1)
 assert.equal((await rpc('channel.image',{channelId:x.channelId,postId:posts[0].id,mediaId:image.id},aToken)).data,png)
 await deny('channel.fetch-text',{id:youtube.channelId},aToken)
 await deny('channel.fetch-text',{id:x.channelId,sourceId:telegram.id},aToken)
 for(const token of [aToken,managerToken,governorToken])await deny('channel.access',{id:x.channelId,employeeIds:[b.id],expectedRevision:access.revision},token)
 await deny('channel.access',{id:x.channelId,employeeIds:[b.id],expectedRevision:access.revision-1},secretaryToken)
 assert.deepEqual((await rpc('channel.access',{id:x.channelId})).employeeIds,[a.id])
 await rpc('channel.access',{id:x.channelId,employeeIds:[],expectedRevision:access.revision},secretaryToken)
 await deny('channel.fetch-text',{id:x.channelId},aToken);assert.deepEqual(await rpc('channel.list',{},aToken),[])
 access=await rpc('channel.access',{id:x.channelId});await rpc('channel.access',{id:x.channelId,employeeIds:[a.id],expectedRevision:access.revision})
 assert.deepEqual((await rpc('channel.read-state',{id:x.channelId,entryIds:[posts[0].id]})).entries,unread.entries)
 assert.equal((await rpc('session.status')).filter(p=>p.busy).length,0)
 pass('Grant and revoke take effect immediately across discovery, full text, native images and search; stale revisions, self-grants and cross-channel source IDs fail atomically; reading starts no work and marks no user receipt')

 const order=['channel:'+telegram.channelId,'channel:'+youtube.channelId,'channel:'+x.channelId],state=await rpc('messenger.state',{},secretaryToken)
 await rpc('messenger.reorder',{scope:'all',order,expectedOrder:state.orders?.all??[]},secretaryToken)
 assert.deepEqual((await rpc('messenger.state')).orders.all,order)
 await deny('messenger.reorder',{scope:'all',order:[...order].reverse(),expectedOrder:[]},secretaryToken)
 await deny('messenger.reorder',{scope:'all',order},governorToken)
 await rpc('messenger.conversation',{conversations:[order[0]],patch:{pinned:true}},secretaryToken)
 assert.equal((await rpc('messenger.state')).conversations[order[0]].pinned,true)
 const profile=await rpc('messenger.profile',{image:{name:'fixture.png',mimeType:'image/png',data:png}},secretaryToken);assert.ok((await rpc('messenger.profile-image',{sha256:profile.profile.image.sha256},secretaryToken)).data)
 await rpc('channel.source-update',{id:telegram.id,patch:{name:'科技圈在花频道 · verified'}},secretaryToken)
 assert.ok((await rpc('channel.sources',{channelId:telegram.channelId},secretaryToken)).some(s=>s.name.endsWith('verified')))
 pass('Secretary manages the user’s channel ordering, optimistic conflicts, pinning, profile and subscriptions through the same real APIs and persistent state')

 const group=await rpc('chat.create',{name:'Not joined by Secretary',members:[a.id,b.id],ownerId:a.id}),conversation='group:'+group.id
 assert.ok((await rpc('chat.list',{},secretaryToken)).some(g=>g.id===group.id))
 await rpc('chat.update',{id:group.id,name:'Secretary administered group',expectedRevision:group.revision},secretaryToken)
 assert.ok((await rpc('conversation.policy',{conversation},secretaryToken)).allowedActions.includes('roles'))
 const policy=await rpc('conversation.policy',{conversation},secretaryToken);await rpc('conversation.role',{conversation,employee:b.id,role:'admin',expectedRevision:policy.revision},secretaryToken)
 const note=await rpc('chat.post',{id:group.id,text:'Explicit Secretary publication',kind:'message',clientMessageId:'secretary-explicit'},secretaryToken)
 assert.deepEqual(note.author,{kind:'agent',employeeId:secretary.id})
 await f.until(async()=>{const d=(await rpc('chat.history',{id:group.id})).messages[0].deliveries;if(d.some(d=>d.status==='failed'))throw Error(JSON.stringify(d));return d.every(d=>d.status==='completed')},'silent nonmember Secretary publication delivered')
 assert.equal((await rpc('chat.history',{id:group.id})).messages.length,1)
 const sent=await rpc('chat.send',{id:group.id,text:'A delegated task, reply privately.',mentions:[a.id],clientMessageId:'secretary-delegate'},secretaryToken)
 await f.until(async()=>(await rpc('chat.history',{id:group.id})).messages.find(m=>m.id===sent.id).deliveries.every(d=>d.status==='completed'),'Secretary delegation completes')
 await f.until(async()=>(await rpc('session.status')).every(p=>!p.busy),'group work converges')
 assert.equal((await rpc('chat.history',{id:group.id})).messages.length,2)
 await rpc('chat.acknowledge',{id:group.id,messageId:sent.id},secretaryToken)
 pass('Secretary administers a group without joining, explicitly posts under its own identity and delegates work; awareness stays silent and normal replies stay private with no recursive group conversation')

 const workspace=await rpc('conversation.workspace',{conversation},secretaryToken),member=workspace.members.find(m=>m.employeeId===a.id)
 await rpc('conversation.file',{conversation,operation:'write',path:member.directory+'/secretary-note.txt',content:'Preserved native identities; delegated administration.'},secretaryToken)
 assert.match((await rpc('conversation.file',{conversation,operation:'read',path:member.directory+'/secretary-note.txt'},aToken)).content,/delegated administration/)
 await rpc('conversation.file',{conversation,operation:'write',path:member.directory+'/peer-edit.txt',content:'Shared group content is editable by every member.'},bToken)
 assert.match((await rpc('conversation.file',{conversation,operation:'read',path:member.directory+'/peer-edit.txt'},aToken)).content,/every member/)
 await rpc('conversation.file',{conversation,operation:'mkdir',path:'Secretary documents'},secretaryToken)
 await rpc('conversation.file',{conversation,operation:'write',path:'Secretary documents/note.md',content:'# Real file API'},secretaryToken)
 assert.ok(await rpc('assets.browse',{},secretaryToken));assert.ok((await rpc('workspace.catalog',{employee:a.id},secretaryToken)).workspaces.length)
 await rpc('channel.acknowledge',{id:x.channelId,entryIds:[posts[0].id]},secretaryToken)
 assert.equal((await rpc('channel.read-state',{id:x.channelId,entryIds:[posts[0].id]})).entries[0].state,'read')
 await rpc('channel.save',{id:posts[0].id,saved:true},secretaryToken);assert.equal((await rpc('channel.post',{id:posts[0].id})).saved,true)
 const exported=await rpc('channel.export',{id:posts[0].id},secretaryToken);assert.ok(fs.statSync(exported.download.path).size)
 const forwarded=await rpc('messenger.forward',{to:conversation,messages:[{conversation:'channel:'+x.channelId,id:posts[0].id}],clientMessageId:'secretary-forward'},secretaryToken);assert.equal(forwarded.status,'posted');const forwardFile=path.join(f.env.AGENTS_COMPANY_HOME,'message-forwards.json'),receipts=JSON.parse(fs.readFileSync(forwardFile));assert.deepEqual(receipts['forward:secretary-forward'].author,{kind:'agent',employeeId:secretary.id});receipts['forward:secretary-forward'].status='uncertain';delete receipts['forward:secretary-forward'].result;fs.writeFileSync(forwardFile,JSON.stringify(receipts));assert.equal((await rpc('messenger.forward-status',{clientMessageId:'secretary-forward'},secretaryToken)).status,'sent');assert.equal((await rpc('chat.history',{id:group.id})).messages.length,3);await f.until(async()=>(await rpc('session.status')).every(p=>!p.busy),'forwarded work finishes')
 await deny('channel.message-post',{id:x.channelId,text:'Channels remain clean'},secretaryToken)
 await deny('auth.agent-token',{id:a.id},secretaryToken)
 assert.deepEqual((await rpc('auth.whoami',{},secretaryToken)).principal,{kind:'agent',employeeId:secretary.id})
 pass('Secretary uses real shared/peer file APIs, assets, explicit user read/save/export workflows without joining or impersonating the user; ordinary group members share content rights while channel grant boundaries remain enforced')

 const worker=await rpc('worker.create',{employee:a.id,engine:'codex',title:'Admin managed native Worker'},secretaryToken);assert.equal(worker.employee,a.id);assert.ok((await rpc('worker.list',{},secretaryToken)).some(w=>w.id===worker.id));await deny('worker.list',{employee:a.id},governorToken)
 const peerJob=await rpc('schedule.create',{spec:{name:'Secretary peer plan',enabled:false,rule:{kind:'interval',everySeconds:3600},action:{type:'agent',employeeId:peer.id,prompt:'Synthetic plan, never run'}}},secretaryToken);assert.equal((await rpc('schedule.get',{id:peerJob.id},secretaryToken)).action.employeeId,peer.id);await rpc('schedule.delete',{id:peerJob.id,expectedRevision:peerJob.revision},secretaryToken)
 pass('Secretary globally administers peer plans and directly owned Worker records while preserving each Worker’s original owner; Governor cannot use the administrative exception')
 await rpc('card.management-role',{id:secretary.id,role:'governor'})
 assert.deepEqual(await rpc('channel.list',{},secretaryToken),[]);await deny('messenger.state',{},secretaryToken);await deny('channel.access',{id:x.channelId},secretaryToken);await deny('worker.list',{employee:a.id},secretaryToken)
 await rpc('card.management-role',{id:secretary.id,role:'secretary'});assert.equal((await rpc('channel.list',{},secretaryToken)).length,3);await rpc('worker.remove',{id:worker.id},secretaryToken)
 await f.stop();const db=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'));db.prepare('INSERT INTO channel_aliases VALUES(?,?)').run('legacy_x',x.channelId);db.close();await f.start()
 assert.equal((await f.call(aToken,'channel','get','legacy_x')).id,x.channelId)
 assert.deepEqual((await f.call(secretaryToken,'channel','access',x.channelId)).employeeIds,[a.id]);assert.deepEqual((await rpc('messenger.state')).orders.all,order)
 const ids=(await rpc('session.list')).sessions.map(p=>p.id);assert.deepEqual(ids,unchanged.map(p=>p.id));assert.equal((await rpc('session.list',{live:true})).length,0)
 await rpc('auth.revoke',{id:a.id},secretaryToken);await deny('channel.get',{id:x.channelId},aToken)
 pass('Downgrade/re-promotion, credential revocation, restart, legacy aliases and actual CLI all recheck current authority; grants/order persist without starting native sessions')
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,providerCalls:0,productionMutations:0},null,2)+'\n')
}finally{await f.close()}
