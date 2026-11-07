import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore()
const rpc=async(token,cmd,args={})=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,value.error);return value.data}
const deny=async(token,cmd,args={})=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,cmd+' must reject')}
const history=async(id,token=null)=>(await rpc(token,'direct.history',{employee:id,limit:500})).items
const inbox=async id=>(await f.cli('session','inbox')).find(item=>item.employeeId===id)
try{
 await f.cli('group','add','Studio');await f.cli('group','add','Engineering')
 const a=await f.create('Aster','Studio'),b=await f.create('Rowan','Studio'),c=await f.create('Cedar','Engineering'),m=await f.create('Manager','Studio','manager'),s=await f.create('Secretary','Studio','secretary')
 const at=await f.token(a.id),bt=await f.token(b.id),mt=await f.token(m.id),st=await f.token(s.id)
 const png=await sharp({create:{width:3,height:2,channels:3,background:'#336699'}}).png().toBuffer(),changed=await sharp({create:{width:5,height:2,channels:3,background:'#aa3311'}}).png().toBuffer()
 await rpc(at,'workspace.write',{employee:a.id,path:'media/photo.png',contentBase64:png.toString('base64'),create:true})
 await rpc(at,'workspace.write',{employee:a.id,path:'media/brief.txt',content:'ORIGINAL_BRIEF_CONTENT',create:true})
 // Native prompts, native output and group work never become private rows.
 await f.cli('session','send','--employee',a.id,'--text','RAW_NATIVE_SENTINEL');await f.until(async()=>!(await f.status(a.id)).busy,'raw native turn')
 assert.equal((await history(a.id)).length,0)
 assert.equal((await inbox(a.id)).hasMessages,false);assert.equal((await inbox(a.id)).text,'')
 assert.ok((await f.cli('session','transcript',a.id)).items.some(item=>item.role==='user'&&item.text==='RAW_NATIVE_SENTINEL'))
 const group=await f.cli('chat','create','--name','Private separation','--members',JSON.stringify([a.id,b.id]))
 const shared=await rpc(null,'chat.send',{id:group.id,text:'GROUP_ONLY_SENTINEL',mentions:[a.id],clientMessageId:'group-private-separation'})
 await f.until(async()=>{const message=(await rpc(null,'chat.history',{id:group.id})).messages.find(item=>item.id===shared.id);return message.deliveries.every(delivery=>delivery.status==='completed')&&!(await f.status(a.id)).busy},'group work completed')
 assert.equal((await history(a.id)).length,0);assert.ok((await f.cli('session','transcript',a.id)).text.includes('GROUP_ONLY_SENTINEL'))
 // direct.send is explicit user input and auto-enqueues behind existing native work.
 fs.writeFileSync(path.join(f.control,b.id+'.hold-user'),'')
 await f.cli('session','send','--employee',b.id,'--text','B_RAW_WORK');await f.until(async()=>(await f.status(b.id)).busy,'B held')
 assert.equal((await history(b.id)).length,0,'raw native input is not a private row')
 const userSend=await rpc(null,'direct.send',{employee:b.id,text:'USER_PRIVATE_ONLY',clientMessageId:'user-direct-1'})
 assert.equal(userSend.sent,true);assert.equal(userSend.status,'queued');assert.match(userSend.directMessageId,/^dm_/)
 assert.ok((await f.cli('session','queue','--employee',b.id)).some(item=>item.text==='USER_PRIVATE_ONLY'))
 let bHistory=await history(b.id);assert.equal(bHistory.length,1);assert.equal(bHistory[0].role,'user');assert.equal(bHistory[0].author.kind,'operator');assert.equal(bHistory[0].text,'USER_PRIVATE_ONLY')
 fs.unlinkSync(path.join(f.control,b.id+'.hold-user'))
 await f.until(async()=>{const items=(await f.cli('session','transcript',b.id)).items;return items.some(item=>item.text?.includes('USER_PRIVATE_ONLY'))&&!(await f.status(b.id)).busy},'queued private input delivered')
 bHistory=await history(b.id);assert.equal(bHistory.length,1,'delivery and native output add no rows')
 assert.equal((await inbox(b.id)).text,'USER_PRIVATE_ONLY');assert.equal((await inbox(b.id)).unread,false)
 // An employee publishes own text/image/file rows only, with durable idempotency.
 const p1=await rpc(at,'direct.post',{text:'AGENT_TEXT_1',clientMessageId:'agent-text-1'})
 await rpc(at,'direct.post',{images:['media/photo.png'],clientMessageId:'agent-image-1'})
 const fileOnly=await rpc(at,'direct.post',{files:['media/brief.txt'],clientMessageId:'agent-file-1'})
 const privateKey='employee:'+a.id
 const rawId=(await f.cli('session','transcript',a.id)).items.find(i=>i.role==='user'&&i.text==='RAW_NATIVE_SENTINEL').id
 for(const query of ['RAW_NATIVE_SENTINEL','GROUP_ONLY_SENTINEL'])assert.equal((await rpc(null,'messenger.search',{conversation:privateKey,query})).total,0,'private search cannot leak native/shared history')
 assert.equal((await rpc(null,'messenger.search',{conversation:privateKey,query:'AGENT_TEXT_1'})).total,1)
 const fileSearch=await rpc(null,'messenger.search',{conversation:privateKey,query:'brief',filter:'files'});assert.equal(fileSearch.total,1);assert.equal(fileSearch.messages[0].id,fileOnly.id);assert.equal(fileSearch.messages[0].files[0].name,'brief.txt')
 await deny(null,'messenger.reference',{conversation:privateKey,id:rawId})
 assert.equal((await rpc(null,'messenger.reference',{conversation:privateKey,id:p1.id})).text,'AGENT_TEXT_1')
 const gallery=await rpc(null,'messenger.gallery',{conversation:privateKey});assert.equal(gallery.images.length,1);assert.ok(gallery.images[0].path.startsWith('@direct/'))
 await rpc(null,'messenger.message',{conversation:privateKey,id:p1.id,patch:{saved:true}})
 assert.equal((await rpc(null,'messenger.search',{conversation:privateKey,filter:'saved'})).total,1)
 const [p4a,p4b]=await Promise.all([rpc(at,'direct.post',{text:'AGENT_ONCE',clientMessageId:'agent-once'}),rpc(at,'direct.post',{text:'AGENT_ONCE',clientMessageId:'agent-once'})])
 assert.equal(p4a.id,p4b.id);await deny(at,'direct.post',{text:'AGENT_ONCE_CHANGED',clientMessageId:'agent-once'})
 assert.equal((await rpc(at,'direct.post',{text:'AGENT_ONCE',clientMessageId:'agent-once'})).id,p4a.id)
 let ah=await history(a.id);assert.equal(ah.length,4);assert.equal(new Set(ah.map(item=>item.id)).size,4)
 for(const item of ah)assert.deepEqual(item.author,{kind:'agent',employeeId:a.id})
 assert.equal(ah[0].blocks[0].text,'AGENT_TEXT_1');assert.match(ah[1].images[0],/^@direct\//);assert.match(ah[2].files[0].path,/^@direct\//)
 assert.equal(ah[2].files[0].name,'brief.txt');assert.equal(ah[2].files[0].bytes,Buffer.byteLength('ORIGINAL_BRIEF_CONTENT'))
 assert.ok(!(await history(b.id)).some(item=>item.id===p1.id));assert.ok(!ah.some(item=>['RAW_NATIVE_SENTINEL','GROUP_ONLY_SENTINEL','USER_PRIVATE_ONLY'].some(text=>item.text?.includes(text))))
 // Authenticated identity and management bounds; no field can spoof an author.
 await deny(at,'direct.post',{employee:b.id,text:'spoof',clientMessageId:'spoof-employee'})
 await deny(at,'direct.post',{author:{kind:'operator'},text:'spoof',clientMessageId:'spoof-author'})
 await deny(at,'direct.send',{employee:a.id,text:'spoof',clientMessageId:'spoof-self'})
 await deny(bt,'direct.send',{employee:a.id,text:'spoof',clientMessageId:'spoof-peer'})
 await deny(mt,'direct.send',{employee:a.id,text:'spoof',clientMessageId:'spoof-manager'})
 await deny(mt,'direct.acknowledge',{employee:a.id,messageId:p1.id});await deny(bt,'direct.history',{employee:a.id})
 await rpc(mt,'direct.history',{employee:a.id});await deny(mt,'direct.history',{employee:c.id})
 const managerOwn=await rpc(mt,'direct.post',{text:'MANAGER_OWN_PRIVATE',clientMessageId:'manager-own'})
 const managerHistory=await rpc(mt,'direct.history',{employee:m.id});assert.ok(managerHistory.items.some(item=>item.id===managerOwn.id));assert.ok(!managerHistory.items.some(item=>item.id===p1.id))
 await deny(st,'direct.post',{employee:a.id,text:'spoof-secretary',clientMessageId:'spoof-secretary'})
 const secretaryOwn=await rpc(st,'direct.post',{text:'SECRETARY_OWN_PRIVATE',clientMessageId:'secretary-own'});assert.equal(secretaryOwn.conversation,'employee:'+s.id)
 assert.ok((await rpc(st,'direct.history',{employee:s.id})).items.some(item=>item.id===secretaryOwn.id));assert.ok(!(await history(a.id)).some(item=>item.id===secretaryOwn.id))
 const managed=await rpc(st,'direct.send',{employee:a.id,text:'SECRETARY_INPUT',clientMessageId:'secretary-input'});assert.ok(managed.directMessageId)
 await f.until(async()=>!(await f.status(a.id)).busy,'Secretary private input')
 ah=await history(a.id);assert.equal(ah.length,5);assert.equal(ah[4].role,'user');assert.deepEqual(ah[4].author,{kind:'agent',employeeId:s.id});assert.equal(ah[4].text,'SECRETARY_INPUT')
 assert.equal((await inbox(a.id)).text,'SECRETARY_INPUT')
 // Published local media are immutable copies pinned by @direct references.
 const imageRef=ah[1].images[0],fileRef=ah[2].files[0].path
 const imageBefore=await rpc(null,'workspace.image',{employee:a.id,path:imageRef});assert.equal(Buffer.from(imageBefore.data,'base64').equals(png),true)
 const infoBefore=await rpc(null,'transfer.download-info',{from:{employee:a.id,path:fileRef}});assert.equal(infoBefore.bytes,Buffer.byteLength('ORIGINAL_BRIEF_CONTENT'))
 await rpc(at,'workspace.write',{employee:a.id,path:'media/photo.png',contentBase64:changed.toString('base64')})
 await rpc(at,'workspace.write',{employee:a.id,path:'media/brief.txt',content:'CHANGED_SOURCE_BRIEF'})
 assert.notEqual((await rpc(null,'workspace.image',{employee:a.id,path:'media/photo.png'})).data,imageBefore.data,'source image really changed')
 assert.equal(Buffer.from((await rpc(null,'workspace.image',{employee:a.id,path:imageRef})).data,'base64').equals(png),true)
 const infoAfter=await rpc(null,'transfer.download-info',{from:{employee:a.id,path:fileRef}});assert.equal(infoAfter.bytes,infoBefore.bytes);assert.equal(infoAfter.modifiedAt,infoBefore.modifiedAt)
 const chunk=await rpc(null,'transfer.download-chunk',{from:{employee:a.id,path:fileRef},offset:0,modifiedAt:infoAfter.modifiedAt});assert.equal(Buffer.from(chunk.data,'base64').toString(),'ORIGINAL_BRIEF_CONTENT')
 assert.equal((await rpc(null,'transfer.download-info',{from:{employee:a.id,path:imageRef}})).bytes,png.length)
 await deny(null,'workspace.image',{employee:a.id,path:imageRef+'/../../escape.png'})
 await deny(null,'transfer.download-info',{from:{employee:a.id,path:fileRef+'/../outside.txt'}})
 await deny(null,'workspace.write',{employee:a.id,path:fileRef,content:'TAMPER'});await deny(null,'workspace.trash',{employee:a.id,path:imageRef})
 // Cursors are bounded, around is centered, and a stale acknowledgment never reads newer posts.
 const newer=await rpc(at,'direct.post',{text:'AGENT_NEWER',clientMessageId:'agent-newer'});ah=await history(a.id);assert.equal(ah.length,6);assert.match(ah[5].blocks[0].text,/AGENT_NEWER/)
 const staleSequence=ah[0].directSequence
 await rpc(st,'direct.acknowledge',{employee:a.id,messageId:ah[0].id})
 let h=await rpc(null,'direct.history',{employee:a.id});assert.equal(h.readSequence,staleSequence)
 let summary=await inbox(a.id);assert.equal(summary.latestIncoming.messageId,newer.id);assert.equal(summary.unread,true)
 await rpc(st,'direct.acknowledge',{employee:a.id,messageId:ah[0].id});h=await rpc(null,'direct.history',{employee:a.id});assert.equal(h.readSequence,staleSequence)
 assert.equal((await inbox(a.id)).unread,true,'stale ack cannot read a newer post');assert.equal(h.readSequence,staleSequence,'history queries do not mark read')
 const page=await rpc(null,'direct.history',{employee:a.id,limit:2});assert.deepEqual(page.items.map(item=>item.id),ah.slice(-2).map(item=>item.id));assert.equal(page.nextBefore,page.items[0].directSequence)
 const older=await rpc(null,'direct.history',{employee:a.id,limit:10,before:page.nextBefore});assert.deepEqual(older.items.map(item=>item.id),ah.slice(0,4).map(item=>item.id));assert.ok(older.items.every(item=>item.directSequence<page.nextBefore))
 const around=await rpc(null,'direct.history',{employee:a.id,limit:3,around:ah[2].id});assert.deepEqual(around.items.map(item=>item.id),ah.slice(1,4).map(item=>item.id))
 await rpc(st,'direct.acknowledge',{employee:a.id,messageId:newer.id});summary=await inbox(a.id);assert.equal(summary.unread,false);assert.equal(summary.readSequence,ah[5].directSequence)
 // Restart preserves identities, media and private data without replaying work.
 await f.until(async()=>(await f.cli('session','status')).every(item=>!item.busy),'all work settled')
 const finalA=await rpc(null,'direct.history',{employee:a.id,limit:500}),finalB=await rpc(null,'direct.history',{employee:b.id,limit:500}),transcriptCount=(await f.cli('session','transcript',a.id)).items.length
 await f.stop();await f.start()
 assert.deepEqual(await rpc(null,'direct.history',{employee:a.id,limit:500}),finalA);assert.deepEqual(await rpc(null,'direct.history',{employee:b.id,limit:500}),finalB)
 assert.equal((await f.cli('session','transcript',a.id)).items.length,transcriptCount,'restart starts no automatic work');assert.equal((await f.status(a.id)).busy,false)
 assert.equal((await rpc(null,'transfer.download-info',{from:{employee:a.id,path:fileRef}})).bytes,infoBefore.bytes)
 const report={test:'direct-messages-core',status:'passed',employees:5,cases:['native-and-group-isolation','explicit-user-input','agent-media-identity','auth-and-management-bounds','secretary-manage-without-spoof','idempotent-and-concurrent-posts','immutable-attachments','cursor-and-stale-ack','restart-preserves-data'],fixture:{imageBytes:png.length,fileBytes:infoBefore.bytes}}
 const artifact=path.join(f.root,'artifacts','explicit-private-messages','core-result.json');fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,JSON.stringify(report,null,2))
 console.log('PASS direct messages Core: native/group isolation, explicit user input with auto-enqueue, own-identity agent media, auth/spoof/Manager bounds, Secretary management, concurrent idempotency, immutable @direct copies, cursor/stale ack, restart preservation')
}finally{await f.close()}
