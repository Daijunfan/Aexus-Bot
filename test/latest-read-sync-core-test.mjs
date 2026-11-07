// Latest-reply / group-read synchronization through the real Core and CLI.
// Synthetic Team, employees and groups only; the Codex protocol fixture is
// deterministic. No model calls, SSH, real workspace or private data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore()
const {cli,request,status,until,create,token,control,root}=f
const rpc=async(auth,cmd,args={})=>{const result=await request(auth,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data}
const deny=async(auth,cmd,args)=>assert.equal((await request(auth,cmd,args)).ok,false,cmd+' must reject this caller')
const checks=[]

try{
 await cli('group','add','Studio')
 const a=await create('Aster','Studio'),b=await create('Byte','Studio'),c=await create('Cinder','Studio'),secretary=await create('Scribe','Studio','secretary')
 const [at,bt,ct,st]=await Promise.all([token(a.id),token(b.id),token(c.id),token(secretary.id)])
 const roomA=await rpc(null,'chat.create',{name:'Read sync A',members:[a.id]})
 const roomAlt=await rpc(null,'chat.create',{name:'Read sync A alternate',members:[a.id]})
 const roomB=await rpc(null,'chat.create',{name:'Read sync B',members:[b.id]})
 const roomC=await rpc(null,'chat.create',{name:'Read sync C',members:[c.id]})
 const shared=await rpc(null,'chat.create',{name:'Read sync shared',members:[a.id,b.id]})
 const groupList=[roomA,roomAlt,roomB,roomC,shared]
 const privateText='一致的最终答复。',publicText='同一条公开更新。'
 const replyFile=id=>path.join(control,id+'.reply.txt'),holdFile=id=>path.join(control,id+'.hold-user')
 const groupView=id=>rpc(null,'chat.get',{id})
 const latestReply=async person=>(await status(person.id)).lastReply
 const transcript=person=>rpc(null,'session.transcript',{employee:person.id})
 const identity=async()=>(await rpc(null,'session.list')).sessions.map(card=>({id:card.id,group:card.group,cwd:card.cwd,role:card.managementRole,createdBy:card.createdBy}))
 const conversationRoles=async group=>(await groupView(group.id)).members.map(member=>({id:member.id,role:member.conversationRole}))
 const initialIdentity=await identity(),initialRoles=await conversationRoles(shared)
 const states=()=>Promise.all([a,b,c,secretary].map(person=>status(person.id)))
 const histories=()=>Promise.all(groupList.map(group=>rpc(null,'chat.history',{id:group.id,limit:100})))
 const settled=()=>until(async()=>{
  const people=await states(),pages=await histories()
  const failed=pages.flatMap(page=>page.messages.flatMap(message=>message.deliveries)).find(delivery=>delivery.status==='failed'||delivery.status==='interrupted')
  if(failed)throw Error('Shared delivery failed: '+JSON.stringify(failed))
  return people.every(person=>!person.busy&&!person.acknowledging&&!(person.pendingMessages?.length))&&pages.every(page=>page.messages.every(message=>message.deliveries.every(delivery=>['completed','failed','interrupted'].includes(delivery.status))))
 },'all synthetic sessions and deliveries settle')
 const startHeld=async(person,label)=>{
  fs.writeFileSync(replyFile(person.id),privateText);fs.writeFileSync(holdFile(person.id),'')
  await rpc(null,'session.send',{employee:person.id,text:label})
  await until(async()=>{const state=await status(person.id);return state.busy&&state.currentTask?.messageId},'held work turn: '+label)
 }
 const finishHeld=async person=>{
  fs.rmSync(holdFile(person.id),{force:true})
  await until(async()=>{const state=await status(person.id);return !state.busy&&!state.acknowledging},'held work turn ends')
 }
 const post=(auth,groupId,text=publicText)=>rpc(auth,'chat.post',{id:groupId,text})

 // A private read advances only the group publication linked to that exact lastReply.
 await startHeld(a,'Synthetic A work one')
 const a1=await post(at,roomA.id)
 await finishHeld(a);await settled()
 const aReply1=await latestReply(a)
 assert.equal(aReply1.text,privateText)
 assert.deepEqual(aReply1.groupReply,{groupId:roomA.id,messageId:a1.id,sequence:a1.sequence})
 assert.equal(aReply1.readAt,undefined)
 await deny(at,'session.acknowledge',{employee:a.id,replyId:aReply1.id})
 await deny(at,'chat.acknowledge',{id:roomA.id,messageId:a1.id})
 assert.equal((await groupView(roomA.id)).unread,true)
 const nativeBody=await transcript(a)
 const privateRead=await rpc(st,'session.acknowledge',{employee:a.id,replyId:aReply1.id})
 assert.equal(privateRead.acknowledged,true);assert.ok(privateRead.readAt)
 assert.ok((await latestReply(a)).readAt,'a Secretary may mark the exact reply read')
 assert.equal((await groupView(roomA.id)).readSequence,a1.sequence)
 assert.equal((await groupView(roomA.id)).unread,false)
 assert.equal((await rpc(null,'session.inbox')).find(item=>item.employeeId===a.id).unread,false)
 assert.deepEqual((await transcript(a)).items,nativeBody.items,'reading a linked reply must not edit the native transcript')
 const storeRevision=(await rpc(null,'session.list')).revision,groupRevision=(await groupView(roomA.id)).revision
 await rpc(st,'session.acknowledge',{employee:a.id,replyId:aReply1.id})
 assert.equal((await rpc(null,'session.list')).revision,storeRevision,'duplicate private read does not write')
 assert.equal((await groupView(roomA.id)).revision,groupRevision,'duplicate private read does not advance the watermark')
 checks.push('Secretary private read advances exactly the linked group watermark; agents cannot read; duplicate reads are no-ops')

 // A group read marks the current lastReply with that exact group publication.
 await startHeld(a,'Synthetic A work two')
 const a2=await post(at,roomA.id)
 await finishHeld(a);await settled()
 const aReply2=await latestReply(a)
 assert.notEqual(aReply2.id,aReply1.id,'identical text in a later turn is a distinct reply')
 assert.deepEqual(aReply2.groupReply,{groupId:roomA.id,messageId:a2.id,sequence:a2.sequence})
 assert.equal(aReply2.readAt,undefined)
 const stale=await rpc(null,'session.acknowledge',{employee:a.id,replyId:aReply1.id})
 assert.equal(stale.acknowledged,false)
 assert.equal((await latestReply(a)).readAt,undefined,'an old reply id cannot clear the newer reply')
 const groupBody=await transcript(a),historyBefore=(await rpc(null,'chat.history',{id:roomA.id,limit:100})).messages
 await rpc(null,'chat.acknowledge',{id:roomA.id,messageId:a2.id})
 assert.ok((await latestReply(a)).readAt)
 assert.equal((await groupView(roomA.id)).readSequence,a2.sequence)
 assert.deepEqual((await rpc(null,'chat.history',{id:roomA.id,limit:100})).messages,historyBefore,'a user read does not rewrite published messages')
 assert.deepEqual((await transcript(a)).items,groupBody.items,'a user read neither edits the transcript nor dispatches work')
 const readRevision=(await rpc(null,'session.list')).revision,readGroupRevision=(await groupView(roomA.id)).revision
 await rpc(null,'chat.acknowledge',{id:roomA.id,messageId:a2.id})
 assert.equal((await rpc(null,'session.list')).revision,readRevision,'repeated group read does not write')
 assert.equal((await groupView(roomA.id)).revision,readGroupRevision)
 checks.push('A group read marks the matching current lastReply in the shared Company inbox; stale reply IDs and repeated reads change nothing')

 // Only the final explicit publication of a native work turn is linked.
 await startHeld(a,'Synthetic A work three')
 const earlyPost=await post(at,roomA.id)
 const latePost=await post(at,roomAlt.id)
 await finishHeld(a);await settled()
 const aReply3=await latestReply(a)
 assert.notEqual(aReply3.id,aReply2.id)
 assert.deepEqual(aReply3.groupReply,{groupId:roomAlt.id,messageId:latePost.id,sequence:latePost.sequence},'only the last publication of the turn is linked')
 assert.equal(aReply3.readAt,undefined)
 assert.equal((await groupView(roomA.id)).readSequence,a2.sequence)
 assert.equal((await groupView(roomA.id)).unread,true)
 assert.equal((await groupView(roomAlt.id)).unread,true)

 // Same text in a different employee and group never merges with A's unread reply.
 await startHeld(b,'Synthetic B work one')
 const b1=await post(bt,roomB.id)
 await finishHeld(b);await settled()
 const bReply1=await latestReply(b)
 assert.notEqual(bReply1.id,aReply3.id)
 assert.equal(bReply1.text,aReply3.text)
 assert.deepEqual(bReply1.groupReply,{groupId:roomB.id,messageId:b1.id,sequence:b1.sequence})
 assert.equal(bReply1.readAt,undefined)
 await rpc(null,'chat.acknowledge',{id:roomB.id,messageId:b1.id})
 assert.ok((await latestReply(b)).readAt)
 assert.equal((await latestReply(a)).readAt,undefined,'another employee/group read cannot clear A by text')
 assert.deepEqual((await latestReply(a)).groupReply,aReply3.groupReply)
 assert.equal((await groupView(roomAlt.id)).readSequence,0)
 await rpc(null,'chat.acknowledge',{id:roomA.id,messageId:earlyPost.id})
 assert.equal((await latestReply(a)).readAt,undefined,'another group with identical text cannot clear the linked reply')
 assert.equal((await groupView(roomAlt.id)).readSequence,0)
 await rpc(null,'session.acknowledge',{employee:a.id,replyId:aReply3.id})
 assert.ok((await latestReply(a)).readAt)
 assert.equal((await groupView(roomAlt.id)).readSequence,latePost.sequence)
 assert.equal((await groupView(roomA.id)).readSequence,earlyPost.sequence,'the earlier publication in the same turn is not bound')
 checks.push('Identical text never merges turns, employees or groups; a private read advances only the final publication\'s group')

 // A pure private reply has no groupReply and is independent of group reads.
 const c0=await rpc(null,'chat.post',{id:roomC.id,text:publicText,kind:'message'})
 await settled()
 await startHeld(c,'Synthetic C private work')
 await finishHeld(c);await settled()
 const cReply1=await latestReply(c)
 assert.equal(cReply1.groupReply,undefined)
 assert.equal(cReply1.readAt,undefined)
 assert.equal((await rpc(null,'chat.history',{id:roomC.id,limit:100})).messages.length,1,'a private answer is never published automatically')
 await rpc(null,'chat.acknowledge',{id:roomC.id,messageId:c0.id})
 assert.equal((await latestReply(c)).readAt,undefined,'a group read cannot mark a reply without a group publication')
 assert.equal((await latestReply(c)).id,cReply1.id)
 const cWatermark=(await groupView(roomC.id)).readSequence
 await rpc(null,'session.acknowledge',{employee:c.id,replyId:cReply1.id})
 assert.ok((await latestReply(c)).readAt)
 assert.equal((await groupView(roomC.id)).readSequence,cWatermark,'a private read without a binding leaves the group watermark alone')
 checks.push('A pure private reply carries no groupReply: group reads leave it unread, private reads leave the group watermark alone, nothing is auto-published')

 // A group read that happens before native turn end marks the late lastReply immediately.
 await startHeld(c,'Synthetic C late work')
 const cLate=await post(ct,roomC.id)
 await rpc(null,'chat.acknowledge',{id:roomC.id,messageId:cLate.id})
 assert.ok((await groupView(roomC.id)).readSequence>=cLate.sequence)
 await finishHeld(c);await settled()
 const cReply2=await latestReply(c)
 assert.deepEqual(cReply2.groupReply,{groupId:roomC.id,messageId:cLate.id,sequence:cLate.sequence})
 assert.ok(cReply2.readAt,'an already-read group publication makes the arriving lastReply read immediately')
 assert.equal((await groupView(roomC.id)).unread,false)
 checks.push('When the group publication is already read, the arriving turn-end lastReply is marked read immediately')

 // Company-shared read covers each current lastReply; delivery receipts stay separate.
 await startHeld(a,'Synthetic A shared one')
 const sA1=await post(at,shared.id)
 await finishHeld(a);await settled()
 const aShared=await latestReply(a)
 assert.deepEqual(aShared.groupReply,{groupId:shared.id,messageId:sA1.id,sequence:sA1.sequence})
 assert.equal(aShared.readAt,undefined)
 await startHeld(b,'Synthetic B shared one')
 const sB1=await post(bt,shared.id)
 await finishHeld(b);await settled()
 const bShared=await latestReply(b)
 assert.deepEqual(bShared.groupReply,{groupId:shared.id,messageId:sB1.id,sequence:sB1.sequence})
 assert.equal(bShared.readAt,undefined)
 assert.notEqual(aShared.id,bShared.id)
 assert.equal(aShared.text,bShared.text)
 assert.notEqual(aShared.groupReply.messageId,bShared.groupReply.messageId)
 const sharedBefore=(await rpc(null,'chat.history',{id:shared.id,limit:100})).messages
 const modelReceipt=sharedBefore.find(message=>message.id===sB1.id).deliveries.find(delivery=>delivery.employeeId===a.id)
 assert.ok(modelReceipt?.readAt,'the recipient delivery readAt is model-read evidence, not the user read')
 assert.equal((await latestReply(a)).readAt,undefined)
 const bodyA=await transcript(a),bodyB=await transcript(b)
 await rpc(null,'chat.acknowledge',{id:shared.id,messageId:sB1.id})
 assert.ok((await latestReply(a)).readAt,'one shared read covers every current lastReply up to that sequence')
 assert.ok((await latestReply(b)).readAt)
 assert.deepEqual((await rpc(null,'chat.history',{id:shared.id,limit:100})).messages,sharedBefore,'a user read leaves delivery read receipts untouched')
 assert.deepEqual((await transcript(a)).items,bodyA.items)
 assert.deepEqual((await transcript(b)).items,bodyB.items)
 assert.equal((await rpc(null,'session.inbox')).find(item=>item.employeeId===a.id).unread,false)
 assert.equal((await rpc(null,'session.inbox')).find(item=>item.employeeId===b.id).unread,false)
 const sharedRevision=(await rpc(null,'session.list')).revision,sharedGroupRevision=(await groupView(shared.id)).revision
 await rpc(null,'chat.acknowledge',{id:shared.id,messageId:sB1.id})
 assert.equal((await rpc(null,'session.list')).revision,sharedRevision,'repeated shared read does not write')
 assert.equal((await groupView(shared.id)).revision,sharedGroupRevision)
 checks.push('One Company-shared group read covers covered current lastReplies; model delivery receipts and transcripts stay independent')

 // An older group message cannot clear a publication that arrived in a later turn.
 await startHeld(b,'Synthetic B shared two')
 const sB2=await post(bt,shared.id)
 await finishHeld(b);await settled()
 const bShared2=await latestReply(b)
 assert.notEqual(bShared2.id,bShared.id)
 assert.deepEqual(bShared2.groupReply,{groupId:shared.id,messageId:sB2.id,sequence:sB2.sequence})
 assert.equal(bShared2.readAt,undefined)
 assert.equal((await latestReply(a)).id,aShared.id,'another employee turn cannot replace A\'s lastReply')
 assert.ok((await latestReply(a)).readAt)
 const oldRevision=(await rpc(null,'session.list')).revision,oldGroupRevision=(await groupView(shared.id)).revision
 await rpc(null,'chat.acknowledge',{id:shared.id,messageId:sB1.id})
 assert.equal((await latestReply(b)).readAt,undefined,'an older group message cannot clear a later groupReply')
 assert.equal((await groupView(shared.id)).readSequence,sB1.sequence)
 assert.equal((await groupView(shared.id)).unread,true)
 assert.equal((await rpc(null,'session.list')).revision,oldRevision,'re-acknowledging an old message does not write')
 assert.equal((await groupView(shared.id)).revision,oldGroupRevision)
 await rpc(null,'chat.acknowledge',{id:shared.id,messageId:sB2.id})
 assert.ok((await latestReply(b)).readAt)
 assert.equal((await groupView(shared.id)).readSequence,sB2.sequence)
 assert.equal((await groupView(shared.id)).unread,false)
 checks.push('An older group message never clears a later groupReply; the newer message marks it only when read')

 // Reads change neither identity, transcript bodies, group roles nor scheduling.
 assert.deepEqual(await identity(),initialIdentity,'reads keep Team, cwd, management role and creator identity')
 assert.deepEqual(await conversationRoles(shared),initialRoles,'reads do not alter group conversation roles')
 assert.ok((await states()).every(person=>!person.busy&&!person.acknowledging),'reads dispatch no new work')

 const replySnapshot=()=>Promise.all([a,b,c].map(async person=>({id:person.id,lastReply:(await status(person.id)).lastReply})))
 const groupSnapshot=async()=>{const snapshot={};for(const group of groupList){const view=await groupView(group.id);snapshot[group.id]={readSequence:view.readSequence,unread:view.unread}}return snapshot}
 const beforeRestart={replies:await replySnapshot(),groups:await groupSnapshot(),shared:(await rpc(null,'chat.history',{id:shared.id,limit:100})).messages,transcripts:(await Promise.all([a,b,c].map(person=>transcript(person)))).map(value=>value.text),identity:await identity()}
 await f.stop();await f.start()
 assert.deepEqual(await replySnapshot(),beforeRestart.replies,'restart preserves lastReply bindings and read timestamps')
 assert.deepEqual(await groupSnapshot(),beforeRestart.groups,'restart preserves group watermarks and unread projection')
 assert.deepEqual((await rpc(null,'chat.history',{id:shared.id,limit:100})).messages,beforeRestart.shared,'restart preserves shared history')
 assert.deepEqual((await Promise.all([a,b,c].map(person=>transcript(person)))).map(value=>value.text),beforeRestart.transcripts,'restart preserves private transcript bodies')
 assert.deepEqual(await identity(),beforeRestart.identity,'restart preserves employee identity')
 for(const person of await replySnapshot()){assert.ok(person.lastReply?.groupReply);assert.ok(person.lastReply?.readAt)}
 checks.push('Restart preserves every binding and read state; transcripts, identities and history are unchanged')

 const output=path.join(root,'artifacts/read-sync');fs.mkdirSync(output,{recursive:true})
 fs.writeFileSync(path.join(output,'core-result.json'),JSON.stringify({passed:true,synthetic:true,modelCalls:0,employees:4,groups:groupList.length,checks},null,2))
 console.log('PASS latest reply/group read sync: '+checks.join('; '))
}finally{await f.close()}
