// Native Grok JSON/Connect protocol against a disposable local server.
// No native credentials, real model calls or production state are used.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {randomUUID} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'grok-execution-')),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/grok-recovery/core')
fs.mkdirSync(out,{recursive:true})
const agentId=randomUUID(),rows=[],streams=new Set(),calls=[],checks=[],reset=Date.now()+86400000
let quota=false,failNext=true,watches=0,sequence=0,f
const frame=(value,flag=0)=>{const bytes=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(5);head[0]=flag;head.writeUInt32BE(bytes.length,1);return Buffer.concat([head,bytes])}
const broadcast=value=>{for(const stream of streams)stream.write(frame(value))}
const append=body=>{const entry={seq:String(++sequence),updatedSeq:String(sequence),entryId:body.id,entryKind:body.kind,body:Buffer.from(JSON.stringify(body)).toString('base64')};rows.push(entry);broadcast({rows:{agentId,generation:0,entries:[entry]}})}
const server=http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const method=req.url.slice(1),raw=Buffer.concat(chunks)
  if(method==='WatchGrokBotTranscripts'){
   assert.equal(raw[0],0);const payload=JSON.parse(raw.subarray(5));assert.equal(payload.cursors[0].agentId,agentId)
   watches++;res.writeHead(200,{'content-type':'application/connect+json'});res.write(frame({connected:{streamId:String(watches)}}));streams.add(res);res.on('close',()=>streams.delete(res));return
  }
  const body=JSON.parse(raw||'{}');calls.push({method,body});let value={}
  switch(method){
   case 'ListGrokBotAgents':value={agents:[{agentId,name:'Grok fixture',harness:'temporal',kind:'GROK_BOT_AGENT_KIND_AGENT'}]};break
   case 'GetSandUsageStatus':value={usagePercent:quota?100:10,hasAvailableUsage:true,onDemandSettings:{eligible:true},nextResetTimestampUtc:new Date(reset).toISOString()};break
   case 'EnsureSandBox':assert.equal(body.wake,true);value={runState:'SAND_BOX_RUN_STATE_RUNNING'};break
   case 'ListGrokBotTranscriptEntries':value={entries:[...rows].reverse().slice(0,body.limit)};break
   case 'SendGrokBotUserMessage':{
    assert.equal(body.source,'GROK_BOT_CLIENT_SURFACE_DESKTOP');assert.equal(body.initiator,'GROK_BOT_USER_MESSAGE_INITIATOR_USER');assert.equal(body.sendSource,'GROK_BOT_SEND_SOURCE_CHAT')
    const turnId=randomUUID();append({kind:'message',id:'echo-'+body.messageId,role:'user',content:body.text,clientNonce:body.messageId,requestId:turnId,timestampMs:Date.now()})
    if(failNext){quota=true;failNext=false;broadcast({turnFailed:{agentId,turnId,code:'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT',summary:'Your usage limit has been reached',failedAtMs:String(Date.now()),errorDetails:{details:{additionalInfo:{nextResetAt:new Date(reset).toISOString()}}}}})}
    else append({kind:'send-message',id:'reply-'+body.messageId,message:{type:'text',content:'GROK_FIXTURE_OK'},requestId:turnId,timestampMs:Date.now()})
    // Let the user echo and failure arrive before the RPC acknowledgment.
    await new Promise(resolve=>setTimeout(resolve,150));value={dispatched:true,delivery:'GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_TEMPORAL'};break
   }
   default:throw Error('Unexpected native RPC '+method)
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))
 }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=path.join(temp,'daemon.cjs'),transport=path.join(root,'src/main/bot-bridge/http.ts')
 await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent',plugins:[{name:'isolated-grok-protocol',setup(b){
  b.onResolve({filter:/^\.\/credentials$/},args=>args.importer.includes('/bot-bridge/')?{path:'credentials',namespace:'grok-test'}:undefined)
  b.onLoad({filter:/.*/,namespace:'grok-test'},()=>({contents:`export class CredentialError extends Error{};export function getGrokAuth(){return {accountId:'fixture',accessToken:'fixture-not-a-credential',expired:false}};export function getChatGptAuth(){throw new CredentialError('Dot excluded from Grok protocol test')}`,loader:'js'}))
  b.onResolve({filter:/^\.\/http$/},args=>/bot-bridge\/(grok|client)\.ts$/.test(args.importer)?{path:'transport',namespace:'grok-wire'}:undefined)
  b.onLoad({filter:/.*/,namespace:'grok-wire'},()=>({contents:`import * as wire from ${JSON.stringify(transport)};const target=url=>process.env.AC_GROK_PROTOCOL_URL+'/'+new URL(url).pathname.split('/').at(-1);export const httpJson=(url,opts)=>wire.httpJson(target(url),opts);export const httpStream=(url,opts)=>wire.httpStream(target(url),opts);`,loader:'js',resolveDir:root}))
 }}]})
 f=await fixtureCore({AC_GROK_PROTOCOL_URL:'http://127.0.0.1:'+server.address().port},entry)
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data},pass=text=>{checks.push(text);console.log('PASS '+text)}
 await rpc('bot.sync');const bot=(await rpc('bot.list')).find(bot=>bot.bot.provider==='grok');assert.ok(bot)
 await Promise.all([rpc('bot.sync'),rpc('bot.sync')]);assert.equal(watches,1)
 pass('Concurrent refreshes await one native subscription')
 const sent=await rpc('direct.send',{employee:bot.id,text:'one real protocol fixture turn',clientMessageId:'quota-race'})
 assert.equal(sent.status,'accepted')
 const failed=await f.until(async()=>{const h=await rpc('chat.history',{id:bot.id});return h.messages.find(m=>m.id===sent.directMessageId&&m.bot.failure)},'durable native failure')
 assert.equal(failed.bot.failure.code,'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT');assert.equal(failed.bot.failure.retryAt,reset)
 assert.equal(failed.bot.remoteId,'echo-'+failed.bot.requestId);assert.ok(failed.bot.turnId)
 const receipt=await rpc('direct.send-status',{employee:bot.id,clientMessageId:'quota-race'});assert.equal(receipt.status,'accepted');assert.equal(receipt.executionFailure.code,failed.bot.failure.code)
 pass('Accepted delivery remains separate from execution failure, correlated by native turn ID even before acknowledgment')
 const sends=calls.filter(c=>c.method==='SendGrokBotUserMessage').length
 const blocked=await f.request(null,'direct.send',{employee:bot.id,text:'must not dispatch',clientMessageId:'quota-blocked'});assert.equal(blocked.ok,false);assert.match(blocked.error,/usage limit/)
 assert.equal(calls.filter(c=>c.method==='SendGrokBotUserMessage').length,sends)
 assert.equal((await rpc('chat.history',{id:bot.id})).messages.length,1)
 assert.equal((await rpc('direct.send',{employee:bot.id,text:'one real protocol fixture turn',clientMessageId:'quota-race'})).directMessageId,sent.directMessageId)
 pass('100% usage blocks a new dispatch despite hasAvailableUsage=true; accepted retries never replay a failed turn')
 await f.stop();await f.start()
 const restored=await rpc('direct.send-status',{employee:bot.id,clientMessageId:'quota-race'});assert.deepEqual(restored.executionFailure,receipt.executionFailure)
 assert.equal((await rpc('bot.list'))[0].bot.issue.code,failed.bot.failure.code)
 pass('Restart preserves failure, original send identity, history and account reset time')
 quota=false;await rpc('bot.sync');await f.until(async()=>!(await rpc('bot.list'))[0].bot.issue,'account recovery')
 const recovered=await rpc('direct.send',{employee:bot.id,text:'new explicit attempt after recovery',clientMessageId:'recovered'})
 await f.until(async()=>(await rpc('chat.history',{id:bot.id})).messages.some(m=>m.text==='GROK_FIXTURE_OK'),'native reply')
 assert.equal(recovered.status,'accepted');assert.equal(calls.filter(c=>c.method==='SendGrokBotUserMessage').length,sends+1)
 assert.equal(calls.findIndex(c=>c.method==='EnsureSandBox')<calls.findIndex(c=>c.method==='SendGrokBotUserMessage'),true)
 pass('Availability recovery permits a new explicit turn, wakes the native environment and receives a genuine protocol reply')
 for(const stream of streams)stream.end(frame({},2))
 await new Promise(resolve=>setTimeout(resolve,100));const previous=watches
 await Promise.all([rpc('bot.sync'),rpc('bot.sync')]);assert.equal(watches,previous+1)
 pass('Disconnect reconnects once without resending previous messages')
 quota=true;const oldTurn=randomUUID();append({kind:'message',id:'legacy-user',role:'user',content:'An unanswered turn from before this update',clientNonce:'legacy-client',requestId:oldTurn,timestampMs:Date.now()})
 append({kind:'send-message',id:'unrelated-late-reply',message:{type:'text',content:'An older turn finally replied'},requestId:failed.bot.turnId,timestampMs:Date.now()})
 await rpc('bot.sync');const legacy=(await rpc('chat.history',{id:bot.id})).messages.find(m=>m.bot?.remoteId==='legacy-user');assert.equal(legacy.bot.failure.code,'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT')
 quota=false;await rpc('bot.sync');assert.equal((await rpc('chat.history',{id:bot.id})).messages.find(m=>m.id===legacy.id).bot.failure.code,'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT')
 append({kind:'send-message',id:'legacy-reply',message:{type:'text',content:'Late actual reply'},requestId:oldTurn,timestampMs:Date.now()});await rpc('bot.sync')
 await f.until(async()=>!(await rpc('chat.history',{id:bot.id})).messages.find(m=>m.id===legacy.id).bot.failure,'late real reply clears its own failure')
 pass('Previously unanswered accepted messages stay blocked after quota reset; a late native reply clears only its own failure')
 assert.ok(calls.every(c=>!/Set|Update|Payment|Spend/.test(c.method)))
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,cases:checks,realModelCalls:false},null,2)+'\n')
}finally{await f?.close();for(const stream of streams)stream.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
