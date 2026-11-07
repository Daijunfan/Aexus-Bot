// Optional real SSH PTY acceptance against a disposable, non-model native CLI fixture.
// Configure remote + root via NATIVE_WORKER_REMOTE_JSON; fixture emits NATIVE_REMOTE=JSON.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {StringDecoder} from 'node:string_decoder'

const target=JSON.parse(process.env.NATIVE_WORKER_REMOTE_JSON),root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-worker-ssh-')),checks=[]
async function broker(directory,exercise){
 const file=path.join(temp,'terminal.json');fs.writeFileSync(file,JSON.stringify({cwd:root,remote:{...target.remote,directory},root:target.root,program:['codex'],cols:100,rows:28}))
 const process_=spawn(process.env.AGENTS_COMPANY_PYTHON||'python3',['-B',path.join(root,'Modules/Tunnel/terminal.py'),file],{stdio:['pipe','pipe','pipe']})
 let output='',stderr='',exitCode;const decoder=new StringDecoder('utf8')
 const ended=new Promise(resolve=>process_.once('close',resolve))
 createInterface({input:process_.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.data)output+=decoder.write(Buffer.from(event.data,'base64'));if(event.exitCode!==undefined)exitCode=event.exitCode})
 process_.stderr.on('data',data=>stderr+=data)
 const wait=async(check,label)=>{for(let i=0;i<300;i++){if(check())return;if(process_.exitCode!==null)throw Error(label+' exited '+output+stderr);await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timeout '+label+' '+output+stderr)}
 try{
  if(exercise){process_.stdin.write(JSON.stringify({op:'input',data:'early native input\r'})+'\n');await wait(()=>output.includes('NATIVE_REMOTE_READY'),'ready');await wait(()=>output.includes('NATIVE_REMOTE_INPUT=early native input'),'queued startup input');const detail=JSON.parse(output.match(/NATIVE_REMOTE=(\{[^\r\n]+\})/)[1]);assert.deepEqual(detail.argv,[]);assert.equal(detail.cwd,directory);assert.ok(!detail.keys.some(key=>/^(AGENTS_|AEXUS_)/.test(key)));process_.stdin.write(JSON.stringify({op:'input',data:'native remote input\r'})+'\n');await wait(()=>output.includes('NATIVE_REMOTE_INPUT=native remote input'),'literal input');process_.stdin.write(JSON.stringify({op:'input',data:'\x03'})+'\n');if(target.remote.os==='windows'){await wait(()=>exitCode!==undefined||/终止批处理|Terminate batch job/i.test(output),'native batch confirmation');if(exitCode===undefined)process_.stdin.write(JSON.stringify({op:'input',data:'Y\r'})+'\n')}await wait(()=>exitCode!==undefined,'native exit');if(target.remote.os==='windows')assert.ok(Number.isInteger(exitCode));else assert.equal(exitCode,0)}
  else{await wait(()=>exitCode!==undefined,'directory boundary');assert.notEqual(exitCode,0);assert.match(output,/Worker directory escapes owner workspace/);assert.doesNotMatch(output,/NATIVE_REMOTE_READY/)}
  await ended
 }finally{if(process_.exitCode===null){process_.kill('SIGTERM');await ended}}
}
try{
 await broker(target.remote.directory,true);checks.push('Real SSH native PTY: empty argv, exact cwd, clean remote environment, literal input and Ctrl-C')
 await broker(target.escape,false);checks.push('Real remote symlink escape is rejected before native process launch')
 const out=path.join(root,'artifacts/native-workers');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'remote-'+target.remote.os+'-result.json'),JSON.stringify({passed:true,host:target.remote.host,checks,providerCalls:0},null,2)+'\n');for(const check of checks)console.log('PASS '+check)
}finally{fs.rmSync(temp,{recursive:true,force:true})}
