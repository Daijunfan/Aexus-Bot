// Native account inference is deliberately absent. Actual native transports have a separate opt-in acceptance.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-bot-hosts-')),require=createRequire(import.meta.url),oldHome=process.env.AGENTS_COMPANY_HOME,checks=[]
process.env.AGENTS_COMPANY_HOME=path.join(temp,'state');fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const until=async check=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0))}throw Error('Fixture did not reach the requested lifecycle boundary')}
try{
 const file=path.join(temp,'hosts.cjs');await build({entryPoints:[path.join(root,'src/main/bot-bridge/local-hosts.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},outfile:file,logLevel:'silent'});const {createBotLocalHosts,localBotHosts}=require(file)
 await localBotHosts.ensure(['dots','grok']);assert.equal(localBotHosts.status('dots').state,'stopped');assert.equal(localBotHosts.status('grok').state,'stopped');await localBotHosts.close();checks.push('An isolated Core cannot start real Mac executors or read native account credentials by default')
 const starts=[],stops=[],ready=new Map(),updates=new Map(),changes=[]
 const hosts=createBotLocalHosts(async(provider,signal,update)=>{starts.push(provider);updates.set(provider,update);const pending=gate();ready.set(provider,pending);signal.addEventListener('abort',pending.resolve,{once:true});await pending.promise;let active=true;return {running:()=>active,close:async()=>{if(active){active=false;stops.push(provider)}}}},provider=>changes.push(provider))
 const connecting=Array.from({length:20},()=>hosts.ensure(['dots','grok','grok']));await until(()=>starts.length===2);assert.deepEqual(starts.sort(),['dots','grok']);assert.equal(hosts.status('dots').state,'starting');ready.get('dots').resolve();ready.get('grok').resolve();await Promise.all(connecting)
 assert.equal(hosts.status('dots').state,'starting','Spawn success must not pretend that rendezvous succeeded');updates.get('dots')('connected');assert.equal(hosts.status('dots').state,'connected');assert.ok(hosts.status('dots').connectedAt);await hosts.ensure(['dots','grok']);assert.equal(starts.length,2);await hosts.ensure(['grok']);assert.deepEqual(stops,['dots']);updates.get('dots')('connected');assert.equal(hosts.status('dots').state,'stopped');await hosts.close();assert.deepEqual(stops,['dots','grok']);await hosts.ensure(['dots']);assert.equal(starts.length,2);checks.push('Concurrent startup is coalesced; native acknowledgement alone marks connected; removal closes only that provider and ignores late callbacks; shutdown cannot reopen')
 let attempts=0,clock=1000,active=false;const now=Date.now;Date.now=()=>clock
 try{
  const retry=createBotLocalHosts(async(_provider,_signal,update)=>{attempts++;if(attempts===1)throw Error('Login failed: Bearer private-fixture-token');active=true;update('connected');return {running:()=>active,close:async()=>{active=false}}})
  await retry.ensure(['dots']);assert.equal(retry.status('dots').state,'error');assert.ok(!retry.status('dots').error.includes('private-fixture-token'));await retry.ensure(['dots']);assert.equal(attempts,1);clock+=31000;await retry.ensure(['dots']);assert.equal(attempts,2);assert.equal(retry.status('dots').state,'connected');active=false;await retry.ensure(['dots']);assert.equal(attempts,3);await retry.close();checks.push('Startup failure is reported without credentials, retries are bounded, and a crashed owned process can reconnect without dispatching a model turn')
 }finally{Date.now=now}
 const closing=gate();let total=0,open=0,maxOpen=0
 const rapid=createBotLocalHosts(async(provider,_signal,update)=>{total++;open++;maxOpen=Math.max(maxOpen,open);update('connected');let active=true;return {running:()=>active,close:async()=>{if(!active)return;active=false;if(total===1)await closing.promise;open--}}})
 await rapid.ensure(['dots']);const first=rapid.ensure(['grok']);await until(()=>rapid.status('dots').state==='stopped');const latest=rapid.ensure(['dots']);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(total,1,'A replacement must wait for the previous native process to exit');closing.resolve();await Promise.all([first,latest]);assert.equal(total,2);assert.equal(maxOpen,1);assert.equal(rapid.status('dots').state,'connected');assert.equal(rapid.status('grok').state,'stopped');await rapid.close();checks.push('Rapid provider removal/restoration waits for actual close and discards an outdated requested provider set')
 const started=gate(),aborted=gate();let closed=0
 const late=createBotLocalHosts(async(_provider,signal,update)=>{started.resolve();await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted.resolve();resolve()},{once:true}));update('connected');let active=true;return {running:()=>active,close:async()=>{if(active){active=false;closed++}}}})
 const opening=late.ensure(['dots']);await started.promise;await late.close();await opening;await aborted.promise;assert.equal(closed,1);assert.equal(late.status('dots').state,'stopped');checks.push('Closing during asynchronous startup aborts the start and closes the late process exactly once')
 console.log(checks.map(check=>'PASS '+check).join('\n'))
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/bot-local-host/core');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,paidModelCalls:0,realUserStateUsed:false},null,2)+'\n')
}finally{if(oldHome===undefined)delete process.env.AGENTS_COMPANY_HOME;else process.env.AGENTS_COMPANY_HOME=oldHome;fs.rmSync(temp,{recursive:true,force:true})}
