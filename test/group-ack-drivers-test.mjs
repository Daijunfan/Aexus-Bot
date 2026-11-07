// Source Core plus all four real adapter protocols; only deterministic model/SDK fixtures.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {writeNativeProfiles} from './fixtures/native-profiles.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-reading-drivers-')),entry=path.join(temp,'daemon.cjs'),claude=path.join(root,'test/fixtures/discussion-claude-sdk.mjs'),processFixture=path.join(root,'test/fixtures/process-adapter.cjs'),out=path.join(root,'artifacts/group-ack-drivers')
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');let f
const allEngines=['codex','cline','pi','claude'],flag=process.argv.indexOf('--engines'),engines=flag<0?allEngines:process.argv[flag+1]?.split(','),evidence=[]
assert.ok(engines?.length&&engines.every(engine=>allEngines.includes(engine)))
try{
 await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},plugins:[{name:'fixture-sdk',setup(build){build.onLoad({filter:/src\/main\/engines\/claude-sdk\.ts$/},()=>({contents:'export function claudeSdkPath(){return '+JSON.stringify(claude)+'};export function exposeClaudeSdk(){};export async function loadClaudeSdk(){return import('+JSON.stringify('file://'+claude)+')}',loader:'ts'}))}}],logLevel:'silent'})
 // Synthetic native profiles only ever land in this disposable, isolated environment.
 const nativeEnv={CLAUDE_CONFIG_DIR:path.join(temp,'claude-profile'),CLINE_DATA_DIR:path.join(temp,'native-cline/data'),PI_CODING_AGENT_DIR:path.join(temp,'native-pi')}
 writeNativeProfiles(nativeEnv,{engines:engines.filter(engine=>['cline','pi'].includes(engine))})
 f=await fixtureCore({CLINE_BIN:processFixture,PI_BIN:processFixture,CLAUDE_BIN:processFixture,ANTHROPIC_API_KEY:'fixture-only-no-network',ANTHROPIC_AUTH_TOKEN:'',...nativeEnv},entry)
 const rpc=async(cmd,args={},auth=null)=>{const reply=await f.request(auth,cmd,args);assert.ok(reply.ok,reply.error);return reply.data}
 await f.cli('group','add','Reading studio')
 for(const engine of engines){
  const card=await rpc('card.create',{title:engine,group:'Reading studio',engine,model:engine==='codex'?'gpt-6-luna':engine==='claude'?'fixture-claude':'deepseek-flash',permissionMode:'bypassPermissions'});await f.ready(card.id)
  const group=await rpc('chat.create',{name:engine+' publication',members:[card.id]}),token=await f.token(card.id),checks=[]
  const file=suffix=>path.join(f.control,card.id+suffix),read=kind=>JSON.parse(fs.readFileSync(file('-'+kind+'.json'),'utf8')),put=(suffix,text)=>fs.writeFileSync(file(suffix),text),remove=suffix=>fs.rmSync(file(suffix),{force:true})
  const history=async()=>(await rpc('chat.history',{id:group.id,limit:100})).messages,delivery=async id=>(await history()).find(message=>message.id===id).deliveries[0],transcript=()=>rpc('session.transcript',{employee:card.id}),directItems=async()=>(await rpc('direct.history',{employee:card.id,limit:500})).items
  const done=(id,expected='completed')=>f.until(async()=>{const d=await delivery(id);if(['failed','interrupted'].includes(d.status)&&d.status!==expected)throw Error(engine+': '+JSON.stringify(d));return d.status===expected&&d},engine+' '+expected)
  const idle=()=>f.until(async()=>!(await f.status(card.id)).busy&&!((await f.status(card.id)).pendingMessages?.length),engine+' idle')
  const send=(text,key)=>rpc('chat.send',{id:group.id,text,mentions:[card.id],clientMessageId:engine+'-'+key})
  await rpc('session.send',{employee:card.id,text:'A private question before group work.'});await f.received(card.id,'A private question before group work.');await idle()
  const activityReceipt=(await f.status(card.id)).lastReply;assert.ok(activityReceipt&&!activityReceipt.readAt)
  const native=engine==='codex'?read('work').thread:read('work').sessionId
  // Plain reading has no publisher and cannot use workspace tools, even with Full access.
  put('.ack-output.txt','{"text":null}');put('.hold-ack','');put('.work-post.json',JSON.stringify({text:'A useful response from '+engine}))
  const first=await send('ACK_TOOL_FIXTURE WRITE_FIXTURE','explicit')
  await f.until(()=>fs.existsSync(file('-ack.json')),'reading starts');assert.equal((await delivery(first.id)).readAt,undefined)
  if(engine==='codex'){assert.deepEqual(read('ack').environments,[]);assert.equal(read('ack').readingTools,false);assert.equal(read('ack').documentationTools,false)}
  else{await f.until(()=>fs.existsSync(file('-ack-tool-result.json')),'reading workspace denial');assert.equal(read('ack-tool-result').allowed,false);assert.ok(!fs.existsSync(path.join(card.cwd,'ack-forbidden.txt')))}
  remove('.hold-ack');const received=await done(first.id);await idle()
  const published=(await history()).filter(item=>item.author.kind==='agent');assert.equal(published.length,1);assert.equal(published[0].text,'A useful response from '+engine);assert.equal(published[0].replyTo,first.id);assert.equal(published[0].acknowledgmentOf,undefined)
  assert.ok(received.readAt&&read('work').at>=received.readAt);assert.equal(engine==='codex'?read('work').thread:read('work').sessionId,native)
  if(engine==='codex')assert.ok(read('work').environments.some(value=>value.environmentId==='local'))
  else assert.equal(fs.readFileSync(path.join(card.cwd,'approval.txt'),'utf8'),'approved')
  assert.notEqual((await f.status(card.id)).lastReply.id,activityReceipt.id);assert.deepEqual(await directItems(),[],'group work never writes a Direct message')
  const progress=(await transcript()).items.filter(item=>item.role==='user'&&item.context?.origin?.messageId===first.id)
  assert.equal(progress.filter(item=>item.context.phase==='work').length,1,'group work records one work context');assert.equal(progress.filter(item=>item.context.phase==='read').length,1,'the same input records one read context')
  remove('.work-post.json')
  checks.push('Reading has no publisher/workspace access; response-stage tool posts once in the same native identity; formal native output updates the Team activity receipt without a Direct row')
  for(const [label,text] of [['plain','PRIVATE_READING_NOTE'],['null','null'],['json-null','{"text":null}'],['json-text','{"text":"PRIVATE_READING_JSON"}'],['empty','']]){
   put('.ack-output.txt',text);const before=(await history()).length,beforeItems=(await transcript()).items.length,request=await send('READ_FORMAT_'+label,label);const d=await done(request.id);await idle()
   assert.ok(d.readAt);assert.equal(d.ackMessageId,undefined);assert.equal((await history()).length,before+1)
   const appended=(await transcript()).items.slice(beforeItems)
   if(text.includes('PRIVATE_READING_'))assert.ok(appended.some(item=>JSON.stringify(item).includes('PRIVATE_READING_')),'quiet reading output stays visible in Team')
   assert.deepEqual(await directItems(),[],'reading output never creates a Direct message');assert.notEqual((await f.status(card.id)).lastReply.id,activityReceipt.id)
  }
  checks.push('Plain, null, JSON and empty final notes finish reading without public confirmations; reading text stays only in Team while formal output updates the activity receipt')
  // A forced tool attempt in reading fails; it cannot turn into a hidden publication.
  put('.ack-tool.json',JSON.stringify({text:'FORBIDDEN_READING_POST'}));const previous=fs.readFileSync(file('-work.json'),'utf8'),bad=await send('FORCED_READING_PUBLICATION','bad-tool');await done(bad.id,'failed');await idle()
  assert.equal((await delivery(bad.id)).readAt,undefined);assert.equal(fs.readFileSync(file('-work.json'),'utf8'),previous);assert.ok(!(await history()).some(item=>item.text==='FORBIDDEN_READING_POST'));remove('.ack-tool.json')
  put('.ack-fail','');const failure=await send('NATIVE_READING_FAILURE','failure');await done(failure.id,'failed');await idle();assert.equal((await delivery(failure.id)).readAt,undefined);remove('.ack-fail')
  put('.hold-ack','');const stopped=await send('STOP_DURING_READING','stop');await f.until(async()=>(await f.status(card.id)).acknowledging,'held reading');await rpc('session.interrupt',{employee:card.id});await done(stopped.id,'interrupted');await idle();assert.equal((await delivery(stopped.id)).readAt,undefined);remove('.hold-ack')
  checks.push('Forced reading publications, native errors and Stop cannot publish or release the work task')
  await rpc('chat.mute',{id:group.id,member:card.id,muted:true});const muted=await send('MUTED_PRIVATE_WORK','muted');await done(muted.id);await idle();assert.equal((await f.request(token,'chat.post',{id:group.id,text:'Muted public reply'})).ok,false);await rpc('chat.mute',{id:group.id,member:card.id,muted:false})
  for(const text of [null,'',' ','null','undefined','None'])assert.equal((await f.request(token,'chat.post',{id:group.id,text})).ok,false)
  await rpc('session.send',{employee:card.id,text:'Private conversation after shared work'});await f.received(card.id,'Private conversation after shared work');await idle();assert.notEqual((await f.status(card.id)).lastReply.id,activityReceipt.id)
  const latest=(await f.status(card.id)).lastReply;assert.equal(latest.readAt,undefined);assert.deepEqual(await directItems(),[],'native private work does not write the Direct ledger')
  checks.push('Muted employees still read and work in their own Team conversation; all sentinel publications fail; later native work updates the Team activity receipt without Direct rows')
  const channel=await rpc('channel.create',{name:engine+' news',engine:{kind:'external',location:'local',name:'Fixture publisher'}}),source=await rpc('channel.source-add',{plugin:'x',locator:'reader_'+engine,channelId:channel.id})
  assert.equal((await f.request(null,'channel.update',{id:channel.id,adminIds:[card.id]})).ok,false)
  const priorTranscript=(await transcript()).items,priorWork=fs.readFileSync(file('-work.json'),'utf8');await rpc('channel.publish',{sourceId:source.id,externalId:'news',publishedAt:Date.now(),title:'Actual retained article',body:'A reference, not a work request.'});await idle()
  assert.equal(fs.readFileSync(file('-work.json'),'utf8'),priorWork);assert.deepEqual((await transcript()).items,priorTranscript)
  assert.equal((await f.request(null,'channel.message-send',{id:channel.id,text:'No channel discussion'})).ok,false);assert.deepEqual((await f.status(card.id)).lastReply,latest)
  checks.push('Channels remain read-only and do not route employee work or discussion')
  await rpc('session.close',{employee:card.id});evidence.push({engine,checks});console.log('PASS '+engine+': '+checks.length+' shared-reading/publication/isolation scenarios')
 }
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,engines.length===4?'verification.json':'subset-'+engines.join('-')+'.json'),JSON.stringify({passed:true,evidence,providerCalls:0,scope:'Real Core and four adapter protocols; deterministic native/SDK fixtures'},null,2))
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
