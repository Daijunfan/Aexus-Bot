import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {writeNativeProfiles} from './fixtures/native-profiles.mjs'
const root=process.cwd(),native=fs.mkdtempSync(path.join(os.tmpdir(),'worker-protocols-')),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/worker-conversations/protocols');fs.mkdirSync(out,{recursive:true});const processFixture=path.join(root,'test/fixtures/process-adapter.cjs'),acpFixture=path.join(root,'test/fixtures/worker-acp.cjs')
const content=JSON.stringify({model:'fixture/native-1',provider:{fixture:{options:{apiKey:'fixture-only-not-real'},models:{'native-1':{name:'Native One',variants:{low:{},high:{}}},'native-2':{name:'Native Two',variants:{low:{},high:{}}}}}}})
const f=await fixtureCore({AC_NATIVE_WORKER_FIXTURE:'1',CLINE_BIN:processFixture,PI_BIN:processFixture,OPENCODE_BIN:acpFixture,KILO_BIN:acpFixture,XDG_CONFIG_HOME:path.join(native,'config'),XDG_DATA_HOME:path.join(native,'data'),XDG_STATE_HOME:path.join(native,'state'),OPENCODE_CONFIG_CONTENT:content,KILO_CONFIG_CONTENT:content}),checks=[]
const core=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data},pass=value=>{checks.push(value);console.log('PASS '+value)}
try{
 writeNativeProfiles(f.env,{engines:['cline','pi']});await core('engine.configure',{engine:'claude',patch:{sdkPath:path.join(root,'test/fixtures/discussion-claude-sdk.mjs')}})
 for(const engine of ['codex','claude','cline','pi','opencode','kilo']){
  const cwd=path.join(f.temp,'worker-'+engine);fs.mkdirSync(cwd);const worker=await core('worker.create',{engine,cwd,title:engine+' graphical Worker'});await core('worker.start',{id:worker.id});let snapshot=await core('worker.snapshot',{id:worker.id});assert.equal(snapshot.worker.state,'ready');assert.ok(snapshot.models.length,engine+' model catalog');assert.equal(snapshot.items.length,0,'Connecting must not infer a reply')
  if(engine==='codex')fs.writeFileSync(path.join(f.control,'worker-codex.reply.txt'),'春\u2028雨\u2029秋');const text='UNICODE_FIXTURE\n春\u2028雨\u2029秋',key=engine+'-task';await core('worker.send',{id:worker.id,text,clientMessageId:key});await f.until(async()=>['completed','failed'].includes((await core('worker.snapshot',{id:worker.id})).receipts.find(receipt=>receipt.clientMessageId===key)?.state),'native '+engine+' response');snapshot=await core('worker.snapshot',{id:worker.id});assert.equal(snapshot.receipts.find(receipt=>receipt.clientMessageId===key).state,'completed',JSON.stringify(snapshot));assert.ok(snapshot.items.some(item=>item.role==='assistant'&&item.blocks.some(block=>block.kind==='text'&&block.text)));const reference=snapshot.worker.nativeSessionId;assert.ok(reference)
  await core('worker.configure',{id:worker.id,model:snapshot.models[0].value});assert.equal((await core('worker.snapshot',{id:worker.id})).worker.nativeSessionId,reference)
  await core('worker.configure',{id:worker.id,permissionMode:'bypassPermissions'});assert.equal((await core('worker.snapshot',{id:worker.id})).requiresReconnect,true);assert.equal((await f.request(null,'worker.send',{id:worker.id,text:'Blocked until reconnect',clientMessageId:engine+'-policy'})).ok,false)
  await core('worker.stop',{id:worker.id});await core('worker.start',{id:worker.id});assert.equal((await core('worker.snapshot',{id:worker.id})).worker.nativeSessionId,reference);assert.equal((await core('worker.snapshot',{id:worker.id})).requiresReconnect,false);await core('worker.remove',{id:worker.id});assert.equal((await core('worker.list')).some(value=>value.id===worker.id),false)
  pass(engine+': native transport, catalog, Unicode text/thoughts, identity, in-place model controls, staged permissions, stop/resume and remove')
 }
 assert.equal((await core('session.list')).sessions.length,0);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,protocolFixturesOnly:true,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{await f.close();fs.rmSync(native,{recursive:true,force:true})}
