// The native engine can recover a disconnected stream without ending its turn.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const temp=fs.mkdtempSync(path.resolve('artifacts/codex-retry-'))
process.env.AGENTS_COMPANY_HOME=path.join(temp,'core')
const binary=path.join(temp,'codex.cjs'),entry=path.join(temp,'native.cjs')
fs.writeFileSync(binary,`#!/usr/bin/env node
const readline=require('node:readline'),send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params:p={}}=JSON.parse(line),reply=result=>send({id,result});
 if(method==='initialize')return reply({});
 if(method==='config/read')return reply({config:{model:'fixture'}});
 if(method==='thread/start')return reply({thread:{id:'retry-thread'}});
 if(method==='turn/start'){
  const terminal=p.input[0].text==='terminal',turnId=terminal?'failed':'recoverable';
  reply({turn:{id:turnId,status:'inProgress'}});
  send({method:'turn/started',params:{threadId:'retry-thread',turn:{id:turnId}}});
  send({method:'error',params:{threadId:'retry-thread',turnId,willRetry:!terminal,error:{message:terminal?'terminal failure':'Stream disconnected; reconnecting (1/5)'}}});
  setTimeout(()=>send({method:'turn/completed',params:{threadId:'retry-thread',turn:{id:turnId,status:terminal?'failed':'completed',error:terminal?{message:'terminal failure'}:null}}}),150);
  return;
 }
 if(id!==undefined)reply({});
});
process.on('SIGTERM',()=>process.exit(0));
`,{mode:0o700})
await build({entryPoints:['src/main/codex-native.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'})
const {runNativeCodexTurn,nativeCodexBusy,closeNativeCodexSession}=await import(pathToFileURL(entry))
const connectionId='retry-fixture',events=[]
const run=prompt=>runNativeCodexTurn(binary,{connectionId,prompt,cwd:temp,model:'fixture',sandbox:'danger-full-access',signal:AbortSignal.timeout(10000),onEvent:event=>{
 events.push(event)
 if(event.kind==='notice'&&event.level==='info')assert.equal(nativeCodexBusy(connectionId),true,'a retry keeps the current native turn busy')
}})
try{
 await run('recover')
 assert.ok(events.some(e=>e.kind==='notice'&&e.level==='info'&&e.text.includes('reconnecting (1/5)')))
 assert.equal(events.some(e=>e.kind==='notice'&&e.level==='error'),false,'recoverable disconnect must not fail a successful turn')
 assert.equal(nativeCodexBusy(connectionId),false)
 await run('terminal')
 assert.ok(events.some(e=>e.kind==='notice'&&e.level==='error'&&e.text==='terminal failure'),'terminal errors remain failures')
 assert.equal(nativeCodexBusy(connectionId),false)
 console.log('PASS native retry is visible, preserves busy state, recovers successfully, and terminal failures remain errors')
}finally{
 await closeNativeCodexSession(connectionId)
 fs.rmSync(temp,{recursive:true,force:true})
}
