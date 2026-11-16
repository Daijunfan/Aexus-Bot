import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createRequire} from 'node:module'
const {controlEndpoint}=createRequire(import.meta.url)('../bin/platform.cjs')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-cli-response-')),credential='disposable-cli-response',env={...process.env,AGENTS_COMPANY_HOME:temp,AGENTS_COMPANY_TOKEN:credential}
for(const key of ['AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_TOKEN_FILE','AGENTS_COMPANY_PARSE_ONLY'])delete env[key]
const text='Original PDF information · 外刊🙂\u2028'.repeat(4000),response=Buffer.from(JSON.stringify({ok:true,data:{pageCount:6,text}})+'\n'),split=response.indexOf(Buffer.from('外'))+1
let mode,requests=0
const server=net.createServer(socket=>{socket.on('error',()=>{});socket.once('data',request=>{
 requests++;assert.equal(JSON.parse(request.toString()).auth,credential)
 if(mode==='empty'){socket.end();return}
 if(mode==='partial'){socket.end('{"ok":true,"data":');return}
 if(mode==='denied'){socket.end(JSON.stringify({ok:false,error:'Permission denied',code:'FORBIDDEN'})+'\n');return}
 socket.write(response.subarray(0,split));setTimeout(()=>socket.end(response.subarray(split)),20)
})})
const run=async()=>{try{const result=await promisify(execFile)(process.execPath,['bin/agents','status','--json'],{env,maxBuffer:4e6,timeout:10000});return {code:0,...result}}catch(error){return error}}
try{
 for(const transport of ['ipc','tcp']){
  await new Promise(resolve=>server.listen(transport==='ipc'?controlEndpoint(temp):{host:'127.0.0.1',port:0},resolve))
  if(transport==='tcp')env.AGENTS_COMPANY_PORT=String(server.address().port);else delete env.AGENTS_COMPANY_PORT
  for(const interrupted of ['empty','partial']){mode=interrupted;const before=requests,result=await run();assert.equal(result.code,1);const reply=JSON.parse(result.stdout);assert.equal(reply.ok,false);assert.match(reply.error,/before the response.*result is unknown/);assert.equal(requests,before+1,'An interrupted operation must never be retried automatically')}
  mode='complete';const complete=await run();assert.equal(complete.code,0);assert.deepEqual(JSON.parse(complete.stdout),{ok:true,data:{pageCount:6,text}},'A complete split UTF-8 frame must remain byte-faithful')
  mode='denied';const denied=await run();assert.equal(denied.code,1);assert.deepEqual(JSON.parse(denied.stdout),{ok:false,error:'Permission denied',code:'FORBIDDEN'})
  await new Promise(resolve=>server.close(resolve));console.log('PASS '+transport+': empty/truncated replies fail with JSON, no automatic retry, complete UTF-8 and permission replies remain intact')
 }
}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
