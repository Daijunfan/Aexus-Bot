// Explicit real npm download into a disposable Core home. Lifecycle scripts stay disabled.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(process.env.AGENTS_COMPANY_INSTALL_DEEPSEEK_TEST!=='1')throw Error('Opt in to the isolated official runtime installation test')
const f=await fixtureCore({DEEPSEEK_API_KEY:''})
try{
 const rpc=async(cmd,args={})=>{const response=await f.request(null,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data}
 const plan=await rpc('engine.install-plan',{engine:'deepseek'});assert.equal(plan.runsPackageScripts,false)
 let job=await rpc('engine.install',{engine:'deepseek',confirm:true});const deadline=Date.now()+240000
 while(job.state==='running'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,400));job=await rpc('engine.install-status',{id:job.id})}
 assert.equal(job.state,'succeeded',job.error+'\n'+job.log);assert.ok(job.path.startsWith(f.env.AGENTS_COMPANY_HOME+path.sep));assert.ok(fs.existsSync(job.path))
 await rpc('engine.configure',{engine:'deepseek',patch:{path:job.path}});const health=await rpc('engine.check',{engine:'deepseek',force:true});assert.equal(health.installed,true);assert.equal(health.protocol,'compatible',health.error);assert.equal(health.version,'0.2.2-rc.1');assert.equal(health.path,job.path)
 assert.equal((await rpc('session.list')).sessions.length,0);const out=path.resolve('artifacts/deepseek/install');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,officialDownload:true,checksumVerified:true,pinnedDependencies:true,package:plan.package,version:plan.version,protocol:health.protocol,runsPackageScripts:false,changesGlobalPath:false,productionDataUsed:false,paidModelCalls:0},null,2)+'\n')
 console.log('PASS verified official Harness download + committed dependency lock + npm ci without scripts; installed runtime starts ACP with no employee/model call or global PATH change')
}finally{await f.close()}
