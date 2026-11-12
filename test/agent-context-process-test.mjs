// Native ACP/RPC processes over the real Core, using disposable Cline/Pi protocol fixtures.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {writeNativeProfiles} from './fixtures/native-profiles.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-context-process-')),entry=path.join(temp,'daemon.cjs'),fixture=path.join(root,'test/fixtures/process-adapter.cjs'),checks=[]
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');let f
try{
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'});f=await fixtureCore({CLINE_BIN:fixture,PI_BIN:fixture},process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??entry);writeNativeProfiles(f.env,{engines:['cline','pi']})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data},saved=id=>JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'))).sessions.find(card=>card.id===id)
 await rpc('group.add',{name:'Protocol context'})
 for(const engine of ['cline','pi']){
  const person=await rpc('card.create',{title:engine+' context',group:'Protocol context',engine});await f.ready(person.id);const initial=JSON.parse(fs.readFileSync(path.join(f.control,person.id+'-initializing.json'))).text,key=saved(person.id).instructionContext
  assert.equal((initial.match(/你是 Aexus Bot 的员工/g)||[]).length,1);assert.ok(key.nativeId.startsWith(engine+':'))
  const send=async marker=>{await rpc('session.send',{employee:person.id,text:marker});await f.until(async()=>!(await f.status(person.id)).busy,'native '+engine+' idle');const text=JSON.parse(fs.readFileSync(path.join(f.control,person.id+'-work.json'))).text;assert.ok(text.includes(marker));assert.ok(!text.includes('你是 Aexus Bot 的员工')&&!text.includes('[Aexus context update]')&&!text.includes('delivery contract'));return text}
  await send('CONTEXT_'+engine+'_FIRST');await send('CONTEXT_'+engine+'_SECOND');await rpc('session.close',{id:(await f.status(person.id)).sessionId});await send('CONTEXT_'+engine+'_REOPEN');assert.deepEqual(saved(person.id).instructionContext,key)
  await f.stop();await f.start();await send('CONTEXT_'+engine+'_RESTART');assert.deepEqual(saved(person.id).instructionContext,key);checks.push(engine+': router is supplied exactly once to the native session; regular turns, reconnect and Core restart retain its delivery cache')
 }
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/agent-context/process-context');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,providerCalls:0},null,2)+'\n');console.log(checks.map(check=>'PASS '+check).join('\n'))
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
