// Large coding prompt plus a noisy native terminal must make progress in both directions.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),script=path.join(f.temp,'loud-native.cjs'),capture=path.join(f.temp,'received.json')
fs.writeFileSync(script,`#!/usr/bin/env node
const fs=require('node:fs'),crypto=require('node:crypto');let received=Buffer.alloc(0);process.stdin.setRawMode(true);if(fs.existsSync('pause-input')){process.stdout.write('LARGE_INPUT_READY\\r\\n');setInterval(()=>{},1000);return}process.stdin.resume();process.stdout.write('LARGE_INPUT_READY\\r\\n');process.stdin.on('data',data=>{received=Buffer.concat([received,data]);const echo=Buffer.alloc(data.length*4,46);let offset=0;while(offset<echo.length)offset+=fs.writeSync(1,echo,offset,echo.length-offset);if(received.includes(Buffer.from('\\x1eEND_OF_INPUT\\x1e'))){fs.writeFileSync(process.env.NATIVE_LARGE_CAPTURE,JSON.stringify({bytes:received.length,sha256:crypto.createHash('sha256').update(received).digest('hex')}));process.stdout.write('\\r\\nLARGE_INPUT_COMPLETE\\r\\n')}})
`,{mode:0o755});f.env.CODEX_BIN=script;f.env.NATIVE_LARGE_CAPTURE=capture;await f.stop();await f.start()
const call=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
try{
 const worker=await call('worker.create',{engine:'codex',cwd:f.temp}),started=await call('worker.start',{id:worker.id})
 await f.until(async()=>(await call('worker.read',{id:worker.id})).output.includes('LARGE_INPUT_READY'),'native ready')
 const text='codeLineHere\n'.repeat(6000)+'中文🙂'.repeat(3000)+'\x1eEND_OF_INPUT\x1e',bytes=Buffer.from(text)
 await call('worker.input',{id:worker.id,terminal:started.terminal,data:text})
 await f.until(()=>fs.existsSync(capture),'complete large input under output backpressure')
 const actual=JSON.parse(fs.readFileSync(capture,'utf8'));assert.equal(actual.bytes,bytes.length);assert.equal(actual.sha256,createHash('sha256').update(bytes).digest('hex'))
 await f.until(async()=>(await call('worker.read',{id:worker.id})).output.includes('LARGE_INPUT_COMPLETE'),'visible final output')
 const paused=path.join(f.temp,'paused');fs.mkdirSync(paused);fs.writeFileSync(path.join(paused,'pause-input'),'')
 const stuck=await call('worker.create',{engine:'codex',cwd:paused}),live=await call('worker.start',{id:stuck.id});await f.until(async()=>(await call('worker.read',{id:stuck.id})).output.includes('LARGE_INPUT_READY'),'paused native ready')
 let settled=false;const waiting=f.request(null,'worker.input',{id:stuck.id,terminal:live.terminal,data:'x'.repeat(2*1024*1024)}).then(value=>{settled=true;return value});await new Promise(resolve=>setTimeout(resolve,150));assert.equal(settled,false,'input is not acknowledged before it reaches the native PTY')
 await call('worker.stop',{id:stuck.id});const interrupted=await waiting;assert.equal(interrupted.ok,false);assert.match(interrupted.error,/closed before input completed/)
 fs.mkdirSync('artifacts/product-polish-v2',{recursive:true});fs.writeFileSync('artifacts/product-polish-v2/large-input.json',JSON.stringify({passed:true,inputBytes:bytes.length,checks:['large Unicode input delivered without truncation','simultaneous native output does not deadlock input','final output remains readable in bounded terminal history','stopping a blocked sender rejects its pending input instead of clearing a draft as sent'],paidModelCalls:0,productionDataUsed:false},null,2));console.log('PASS native large input: '+bytes.length+' exact bytes, simultaneous output and bounded terminal history')
}finally{await f.close()}
