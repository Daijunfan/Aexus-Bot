// Opt-in. Creates native Grok conversations requested by the user, retained for normal use.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Requires --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/bot-workers'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-providers-live-')),recordFile=path.join(out,'live-provider-conversations.json'),records=fs.existsSync(recordFile)?JSON.parse(fs.readFileSync(recordFile,'utf8')):{workerRequestId:randomUUID(),groupRequestId:randomUUID()},report={passed:false,realProviderCalls:true,cases:[],retainedNativeConversations:true};fs.mkdirSync(out,{recursive:true});fs.writeFileSync(recordFile,JSON.stringify(records,null,2))
let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');const entry=path.join(temp,'daemon.cjs');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={})=>{let timer;const r=await Promise.race([f.request(null,cmd,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Core API deadline: '+cmd)),65000)})]).finally(()=>clearTimeout(timer));assert.ok(r.ok,r.error);return r.data},until=async(check,label)=>{const start=Date.now();while(Date.now()-start<360000){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,1000))}throw Error('Timeout '+label)}
 const sync=await rpc('bot.sync');assert.ok(sync.providers.every(p=>p.connected),JSON.stringify(sync.providers));const dot=sync.conversations.find(b=>b.bot.provider==='dots')
 const worker=await rpc('bot.create',{name:'Grok Worker',clientRequestId:records.workerRequestId});records.workerRemoteId=worker.bot.remoteId;fs.writeFileSync(recordFile,JSON.stringify(records,null,2));assert.equal(worker.bot.role,'worker');assert.equal(worker.bot.kind,'private')
 const group=await rpc('bot.group-create',{name:'Grok Group',members:[worker.id],clientRequestId:records.groupRequestId});records.groupRemoteId=group.bot.remoteId;fs.writeFileSync(recordFile,JSON.stringify(records,null,2));assert.equal(group.bot.kind,'group');report.cases.push('Native Grok Worker and native group created through the actual application protocol; stable UUID identities retained')
 console.log('PASS native Grok Worker/group creation')
 const nonce=randomUUID().slice(0,8),marker='BRIDGE_OK_'+nonce,file='proof-'+nonce+'.txt',content='ATTACHMENT_'+nonce,workspace=await rpc('conversation.workspace',{conversation:'group:'+worker.id})
 await rpc('conversation.file',{conversation:'group:'+worker.id,operation:'write',path:file,content,create:true})
 const send=await rpc('direct.send',{employee:worker.id,text:'请读取附件，回复它的完整内容，再加上 '+marker+'。只要一句话。',files:['@workspace/'+file],clientMessageId:'live-grok-file-'+nonce})
 assert.equal(send.status,'accepted');console.log('PASS native Grok attachment upload/send accepted')
 const dotMarker='DOT_OK_'+nonce,dotSend=await rpc('direct.send',{employee:dot.id,text:'这是一条独立连通检查。请只回复 '+dotMarker+'，不执行其他操作。',clientMessageId:'live-dot-'+nonce});assert.equal(dotSend.status,'accepted');console.log('PASS native Dot send accepted')
 const groupMarker='GROUP_OK_'+nonce,groupSend=await rpc('chat.send',{id:group.id,text:'请只回复 '+groupMarker+'，不执行其他操作。',clientMessageId:'live-grok-group-'+nonce});assert.equal(groupSend.bot.delivery,'accepted');console.log('PASS native Grok group send accepted')
 const results=await Promise.allSettled([
  until(async()=>{const h=await rpc('chat.history',{id:worker.id});return h.messages.find(m=>m.author.kind==='agent'&&m.author.employeeId===worker.id&&m.text.includes(marker)&&m.text.includes(content))},'Grok attachment response'),
  until(async()=>{const h=await rpc('chat.history',{id:dot.id});return h.messages.find(m=>m.author.kind==='agent'&&m.author.employeeId===dot.id&&m.text.includes(dotMarker))},'Dot native response'),
  until(async()=>{const h=await rpc('chat.history',{id:group.id});return h.messages.find(m=>m.author.kind==='agent'&&m.author.employeeId===group.id&&m.text.includes(groupMarker))},'Grok group native response')
 ])
 for(let i=0;i<results.length;i++){const r=results[i];report.cases.push({name:['Native Grok attachment reply','Native Dot reply','Native Grok group reply'][i],passed:r.status==='fulfilled',...(r.status==='fulfilled'?{messageId:r.value.id}:{error:String(r.reason)})});console.log((r.status==='fulfilled'?'PASS ':'FAIL ')+report.cases.at(-1).name)}
 if(results.some(r=>r.status!=='fulfilled'))report.groupDiagnostics=(await rpc('chat.history',{id:group.id})).messages.map(m=>({id:m.id,author:m.author,text:m.text,bot:m.bot}));assert.ok(results.every(r=>r.status==='fulfilled'),'Provider reply acceptance failed; inspect the retained report')
 assert.equal((await rpc('direct.send',{employee:worker.id,text:'请读取附件，回复它的完整内容，再加上 '+marker+'。只要一句话。',files:['@workspace/'+file],clientMessageId:'live-grok-file-'+nonce})).directMessageId,send.directMessageId)
 report.passed=true
}catch(error){report.error=String(error);throw error}
finally{await f?.close();fs.writeFileSync(path.join(out,'providers-live-result.json'),JSON.stringify(report,null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true})}
