// Real Core + registered SDK API: autonomous native turns retain work scope, Stop revokes it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-native-continuation-')),sdk=path.join(temp,'sdk.mjs'),trigger=path.join(temp,'trigger.json'),source=pathToFileURL(path.resolve('test/fixtures/discussion-claude-sdk.mjs')).href
fs.writeFileSync(sdk,`import fs from 'node:fs';import {query as base} from ${JSON.stringify(source)};export {tool,createSdkMcpServer} from ${JSON.stringify(source)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function query(args){const q=base(args),iterate=q[Symbol.asyncIterator].bind(q),close=q.close.bind(q);let closed=false;q.close=()=>{closed=true;close()};q[Symbol.asyncIterator]=async function*(){for await(const msg of {[Symbol.asyncIterator]:iterate}){yield msg;if(msg.type!=='result'||!fs.existsSync(${JSON.stringify(trigger)}))continue;const id=JSON.parse(fs.readFileSync(${JSON.stringify(trigger)})).id;fs.unlinkSync(${JSON.stringify(trigger)});fs.writeFileSync(${JSON.stringify(temp)}+'/'+id+'.idle','');await sleep(500);if(closed)return;yield {type:'stream_event',event:{type:'message_start',message:{id:'native-'+id,role:'assistant',content:[]}},session_id:msg.session_id};const api=args.options.mcpServers.agents_company.tools.find(t=>t.name==='agents_company_api'),reply=await api.handler({command:'system.info'},{requestId:'native-'+id,signal:new AbortController().signal});fs.writeFileSync(${JSON.stringify(temp)}+'/'+id+'.reply',JSON.stringify(reply));while(!closed&&!fs.existsSync(${JSON.stringify(temp)}+'/'+id+'.release'))await sleep(20);if(closed)return;yield {type:'result',subtype:'success',is_error:false,session_id:msg.session_id};}};return q}`)
let f
try{
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs');if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:['src/main/daemon.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(path.resolve('.'))},logLevel:'silent'});fs.symlinkSync(path.resolve('node_modules'),path.join(temp,'node_modules'),'dir')
 f=await fixtureCore({},entry);const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('engine.configure',{engine:'claude',patch:{sdkPath:sdk}});await rpc('group.add',{name:'Continuation'})
 const card=await rpc('card.create',{title:'Native worker',group:'Continuation',engine:'claude',permissionMode:'bypassPermissions'});await f.ready(card.id);const {sessionId}=await rpc('session.open',{cardId:card.id})
 for(const id of ['allowed','stopped']){
  fs.writeFileSync(trigger,JSON.stringify({id}));await rpc('session.send',{id:sessionId,text:'Start native background work '+id})
  await f.until(()=>fs.existsSync(path.join(temp,id+'.idle')),'foreground result')
  if(id==='stopped')await rpc('session.interrupt',{id:sessionId})
  await f.until(()=>fs.existsSync(path.join(temp,id+'.reply')),'native callback')
  const result=JSON.parse(fs.readFileSync(path.join(temp,id+'.reply')))
  if(id==='allowed'){assert.ok(!result.isError,JSON.stringify(result));assert.equal((await rpc('session.info',{id:sessionId})).busy,true)}
  else{assert.equal(result.isError,true);assert.match(result.content[0].text,/current employee work turn/)}
  fs.writeFileSync(path.join(temp,id+'.release'),'');await f.until(async()=>!(await rpc('session.info',{id:sessionId})).busy,'native result')
 }
 console.log('PASS native continuation API and busy state restored; explicit Stop still denies later background API calls; isolated data, no inference')
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
