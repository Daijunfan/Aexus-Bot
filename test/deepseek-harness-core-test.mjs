// Registry, authority, installer and credential-failure boundaries; no installed Harness/model needed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-harness-contract-')),native=path.join(temp,'dsh'),workspace=path.join(temp,'workspace');fs.mkdirSync(native);fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'keep.txt'),'keep')
const f=await fixtureCore({HOME:temp,USERPROFILE:temp,DSH_HOME:native,XDG_CONFIG_HOME:path.join(temp,'config'),XDG_DATA_HOME:path.join(temp,'data'),DEEPSEEK_BIN:path.join(temp,'must-not-run')})
try{
 const rpc=async(cmd,args={})=>{const response=await f.request(null,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data}
 let engines=await rpc('engine.list');assert.equal(engines.length,8);assert.ok(engines.some(engine=>engine.engine==='deepseek'&&engine.label==='DeepSeek Harness'))
 const capability=await rpc('engine.capabilities',{engine:'deepseek'});assert.deepEqual(capability.workspaceModes,['build','work']);assert.deepEqual(capability.employeeKinds,['worker']);for(const key of ['images','plan','clone','background','steer'])assert.equal(capability.capabilities[key],false);assert.equal(capability.capabilities.effort,true)
 assert.equal((await f.request(null,'engine.models',{engine:'deepseek',kind:'cloud-native-worker'})).ok,false)
 assert.equal((await f.request(null,'engine.configure',{engine:'deepseek',patch:{apiKey:'not-a-real-key'}})).ok,false)
 const description=await rpc('api.describe',{command:'worker.create',all:true});assert.ok(JSON.stringify(description).includes('deepseek'))
 const plan=await rpc('engine.install-plan',{engine:'deepseek'});assert.equal(plan.package,'@deepseek-ai/dsh');assert.equal(plan.version,'0.2.2-rc.1');assert.match(plan.url,/^https:\/\/registry\.npmjs\.org\//);assert.match(plan.integrity,/^sha512-/);assert.equal(plan.runsPackageScripts,false);assert.equal(plan.changesGlobalPath,false);assert.ok(plan.requires.some(requirement=>requirement.includes('24.9')))
 const lock=fs.readFileSync(path.join(process.cwd(),plan.dependencyLock));assert.equal(createHash('sha256').update(lock).digest('hex'),plan.dependencyLockSha256)
 assert.equal((await rpc('worker.engines')).some(engine=>engine.engine==='chatgpt'),false)
 assert.equal((await f.request(null,'worker.create',{engine:'chatgpt',cwd:workspace})).ok,false)
 const worker=await f.cli('worker','create','--engine','deepseek','--cwd',workspace);assert.equal(worker.engine,'deepseek');assert.equal(worker.employee,undefined);assert.equal((await rpc('session.list')).sessions.length,0);await rpc('worker.remove',{id:worker.id});assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'keep')
 const secret='private-fixture-deepseek-key-not-real',file=path.join(native,'.credentials.yaml');fs.writeFileSync(file,'env:\n  DEEPSEEK_API_KEY: '+secret+'\n malformed: [\n',{mode:0o600})
 engines=await rpc('engine.list');assert.equal(engines.length,8);assert.equal(engines.find(engine=>engine.engine==='deepseek').configuration.hasApiKey,false);assert.ok(!JSON.stringify(engines).includes(secret))
 const broken=await f.request(null,'engine.providers',{engine:'deepseek'});assert.equal(broken.ok,false);assert.ok(broken.error.includes('Cannot read native DeepSeek Harness configuration'));assert.ok(!broken.error.includes(secret))
 fs.writeFileSync(file,JSON.stringify({env:{DEEPSEEK_API_KEY:secret}}),{mode:0o600});engines=await rpc('engine.list');assert.equal(engines.find(engine=>engine.engine==='deepseek').configuration.hasApiKey,true);assert.ok(!JSON.stringify(engines).includes(secret))
 console.log('PASS Harness registry/CLI/capabilities, native-only credentials, pinned installer/lock, independent Worker creation, unsupported remote rejection, and malformed credential isolation without disclosure; no model calls')
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true})}
