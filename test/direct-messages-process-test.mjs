// Cline/Pi native adapter RPC/ACP plumbing, deterministic peers only; no paid provider.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'direct-process-')),checks=[];let f
try{
 let fixture=fs.readFileSync(path.join(root,'test/fixtures/process-adapter.cjs'),'utf8'),marker=' const post=control&&employee?workPostArgs(text,control,employee):undefined'
 fixture=fixture.replace("title:name==='agents_company_documentation'?'Agents Company documentation':'Agents Company discussion'","title:name==='agents_company_documentation'?'Agents Company documentation':name==='agents_company_api'?'Agents Company API':'Agents Company discussion'")
 assert.equal(fixture.split(marker).length,2)
 fixture=fixture.replace(marker,`
 const apiFile=control&&employee?path.join(control,employee+'.api-request.json'):undefined;
 if(apiFile&&fs.existsSync(apiFile)){try{const response=await nativeTool('agents_company_api',JSON.parse(fs.readFileSync(apiFile,'utf8')));const envelope=acp?JSON.parse(response.result.content[0].text):response.result;note('api-result',envelope);finish('RAW_NATIVE_ONLY_AFTER_API')}catch(error){note('api-result',{ok:false,error:error.message});finish('RAW_NATIVE_ONLY_ERROR')}return}
 `+marker)
 const binary=path.join(temp,'api-fixture.cjs');fs.writeFileSync(binary,fixture,{mode:0o755});f=await fixtureCore({CLINE_BIN:binary,PI_BIN:binary})
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data};await rpc('group.add',{name:'Private transports'})
 for(const engine of ['cline','pi']){
  await rpc('engine.configure',{engine,patch:{apiKey:'fixture-only'}})
  const card=await rpc('card.create',{title:engine,group:'Private transports',engine});await f.ready(card.id);const session=(await rpc('session.open',{cardId:card.id})).sessionId
  const request=path.join(f.control,card.id+'.api-request.json'),result=path.join(f.control,card.id+'-api-result.json')
  const publish=async label=>{fs.rmSync(result,{force:true});fs.writeFileSync(request,JSON.stringify({command:'direct.post',args:{text:label,clientMessageId:label}}));await rpc('session.send',{id:session,text:'TRANSPORT_REPLY'});await f.until(()=>fs.existsSync(result),'native API result');await f.until(async()=>!(await f.status(card.id)).busy,'settled');const answer=JSON.parse(fs.readFileSync(result));assert.equal(answer.ok,true,answer.error);assert.ok(answer.data.id.startsWith('dm_'));return answer.data}
  await publish(engine+'-ask')
  await rpc('config.permission',{id:session,mode:'dontAsk'});await publish(engine+'-dontAsk')
  if(engine==='cline'){await rpc('config.plan',{id:session,enabled:true});await publish(engine+'-plan');await rpc('config.plan',{id:session,enabled:false})}
  const history=await rpc('direct.history',{employee:card.id});assert.equal(history.items.length,engine==='cline'?3:2);assert.ok(history.items.every(i=>i.role==='assistant'&&i.author.employeeId===card.id));assert.ok(history.items.every(i=>!JSON.stringify(i).includes('RAW_NATIVE_ONLY')))
  checks.push({engine,published:history.items.length,askAndDontAskAllowed:true,planReplyAllowed:engine==='cline'})
 }
 fs.writeFileSync(path.join(root,'artifacts/explicit-private-messages/process-result.json'),JSON.stringify({passed:true,checks,providerCalls:0},null,2)+'\n');console.log('PASS Cline/Pi explicit private replies over native adapter transports in Ask/dontAsk and Cline Plan, with no ordinary-output publication')
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
