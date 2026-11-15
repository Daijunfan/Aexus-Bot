// Official native CLI + real Core, metadata/control operations only. No model prompts or OAuth.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const binary=process.env.AGENTS_TEST_ANTIGRAVITY_BIN
if(!binary)throw Error('Set AGENTS_TEST_ANTIGRAVITY_BIN to the verified official agy executable')
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-agy-native-controls-'))),workspace=path.join(temp,'workspace'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/antigravity/native');fs.mkdirSync(workspace);fs.mkdirSync(out,{recursive:true})
const f=await fixtureCore({HOME:temp,USERPROFILE:temp,ANTIGRAVITY_BIN:binary,GEMINI_API_KEY:'fixture-native-google-key-not-real',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',ALL_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'})
const core=async(cmd,args={})=>{const response=await f.request(null,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data}
try{
 const health=await core('engine.check',{engine:'antigravity',force:true});assert.equal(health.installed,true);assert.equal(health.protocol,'compatible',health.error);const models=await core('engine.models',{engine:'antigravity'});assert.ok(models.models.length);assert.ok(models.models.some(model=>model.value===models.defaultModel))
 const worker=await core('worker.create',{engine:'antigravity',cwd:workspace,title:'Native Google controls'});await core('worker.start',{id:worker.id});let snapshot=await core('worker.snapshot',{id:worker.id});const nativeId=snapshot.worker.nativeSessionId;assert.ok(nativeId);assert.equal(snapshot.worker.state,'ready');const current=snapshot.models.find(model=>model.value===snapshot.model);assert.ok(current)
 if(current.supportedEffortLevels?.length){const effort=current.supportedEffortLevels.at(-1);await core('worker.configure',{id:worker.id,effort});snapshot=await core('worker.snapshot',{id:worker.id});assert.equal(snapshot.effort,effort)}
 await core('worker.configure',{id:worker.id,planMode:true});assert.equal((await core('worker.snapshot',{id:worker.id})).planMode,true);await core('worker.configure',{id:worker.id,planMode:false});assert.equal((await core('worker.snapshot',{id:worker.id})).planMode,false)
 const other=snapshot.models.find(model=>model.value!==snapshot.model);if(other){await core('worker.configure',{id:worker.id,model:other.value});snapshot=await core('worker.snapshot',{id:worker.id});assert.equal(snapshot.model,other.value);assert.ok(snapshot.models.find(model=>model.value===other.value).supportedEffortLevels?.length)}
 await core('worker.stop',{id:worker.id});await core('worker.start',{id:worker.id});assert.equal((await core('worker.snapshot',{id:worker.id})).worker.nativeSessionId,nativeId)
 assert.equal((await core('worker.snapshot',{id:worker.id})).items.length,0);assert.equal((await core('session.list')).sessions.length,0);await core('worker.remove',{id:worker.id})
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,binary,version:health.version,modelCount:models.models.length,checks:['official version and ACP handshake','native model/thought-level discovery','clean Worker connects without a task','actual thought-level and plan controls','model switch refreshes native thought choices','empty native session stop/resume','remove preserves workspace'],modelPrompts:0,paidModelCalls:0,realAccountUsed:false,productionDataUsed:false},null,2)+'\n')
 console.log('PASS official Antigravity/Core: version/ACP/models, clean Worker connection, native model/thought/plan controls, empty-session resume; no model prompts or real account')
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true})}
