// Exercise Windows taskkill ordering with real disposable processes and pipes.
// The taskkill protocol fixture is portable; actual Windows execution is covered
// separately by worker-removal-core and worker-workbench-core on Windows CI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {once} from 'node:events'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-worker-close-')),source=path.resolve('src/main/worker-processes.ts'),killer=path.join(temp,'taskkill.cjs'),trees=[]
const alive=pid=>{try{process.kill(pid,0);return process.platform==='win32'||!execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).trim().startsWith('Z')}catch{return false}}
const until=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10))}throw Error('Disposable process state did not settle')}
const grandchild=path.join(temp,'grandchild.cjs'),child=path.join(temp,'child.cjs'),native=path.join(temp,'native.cjs')
fs.writeFileSync(grandchild,"const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000)\n")
fs.writeFileSync(child,"const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const grandchild=spawn(process.execPath,[process.argv[2],process.argv[4]],{detached:true,windowsHide:true,stdio:['ignore','inherit','inherit']});fs.writeFileSync(process.argv[3],JSON.stringify([process.ppid,process.pid,grandchild.pid]));setInterval(()=>{},1000)\n")
fs.writeFileSync(native,"const{spawn}=require('node:child_process');spawn(process.execPath,[process.argv[2],process.argv[3],process.argv[4],process.argv[5]],{detached:true,windowsHide:true,stdio:['ignore','inherit','inherit']});process.stdin.resume();process.stdin.on('end',()=>process.exit(0));setInterval(()=>{},1000)\n")
// Capture only the explicitly supplied isolated tree, while its root still lives.
fs.writeFileSync(killer,"const fs=require('node:fs');setTimeout(()=>{const data=JSON.parse(fs.readFileSync(process.argv[2])),root=+process.argv[process.argv.indexOf('/PID')+1];let present=true;try{process.kill(root,0)}catch{present=false}fs.writeFileSync(process.argv[3],JSON.stringify({present,root,protocolClosed:fs.existsSync(process.argv[4])}));if(process.argv[5]==='fail')process.exit(5);if(!present)process.exit(128);for(const pid of data.reverse())try{process.kill(pid,'SIGKILL')}catch{}},100)\n")
const makeTree=async name=>{const directory=path.join(temp,name);fs.mkdirSync(directory);const actors=path.join(directory,'actors.json'),ready=path.join(directory,'ready'),closed=path.join(directory,'protocol-closed'),capture=path.join(directory,'capture.json'),process=spawn(globalThis.process.execPath,[native,child,grandchild,actors,ready],{windowsHide:true,stdio:['pipe','pipe','pipe']});process.stdout.resume();process.stderr.resume();const done=once(process,'close');const tree={process,done,actors,ready,closed,capture,pids:[]};trees.push(tree);await until(()=>fs.existsSync(ready));tree.pids=JSON.parse(fs.readFileSync(actors));assert.ok(tree.pids.every(alive));return tree}
try{
 for(const mode of ['success','rejected-control','fail']){
  const target=await makeTree(mode),peer=await makeTree(mode+'-peer'),module=path.join(temp,mode+'.mjs')
  await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',outfile:module,define:{'process.platform':'"win32"'},plugins:[{name:'isolated-taskkill',setup(builder){
   builder.onResolve({filter:/^node:child_process$/},args=>args.namespace==='taskkill-fixture'?{path:args.path,external:true}:{path:args.path,namespace:'taskkill-fixture'})
   builder.onLoad({filter:/.*/,namespace:'taskkill-fixture'},()=>({contents:`import{spawn as actual}from'node:child_process';export{execFile}from'node:child_process';export const spawn=(command,args,options)=>{if(command!=='taskkill.exe')throw Error('Unexpected fixture process');return actual(process.execPath,${JSON.stringify([killer,target.actors,target.capture,target.closed,mode])}.concat(args),options)}` ,loader:'js'}))
  }}]})
  const {closeWorkerProcesses}=await import(pathToFileURL(module).href),close=async()=>{fs.writeFileSync(target.closed,'');target.process.stdin.end();await target.done;if(mode==='rejected-control')throw Error('Native control pipe is already closed')}
  if(mode==='fail'){
   await assert.rejects(closeWorkerProcesses([target.process],close),/Worker processes have not exited/);assert.equal(fs.existsSync(target.closed),false,'A failed tree termination must retain its protocol and record');assert.ok(target.pids.every(alive))
  }else{
   let timer;try{await Promise.race([closeWorkerProcesses([target.process],close),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native pipes remained open after tree termination')),4000)})])}finally{clearTimeout(timer)}
   await until(()=>target.pids.every(pid=>!alive(pid)));assert.equal(fs.existsSync(target.closed),true)
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(target.capture)),{present:true,root:target.process.pid,protocolClosed:false},'taskkill must discover its live root before protocol close')
  assert.ok(peer.pids.every(alive),'Only the selected native tree may be affected')
  console.log('PASS Windows taskkill '+mode+' ordering: live root captured before protocol close; real inherited pipes and unrelated process tree preserved')
 }
 if(process.platform!=='win32'){
  const targets=await Promise.all(Array.from({length:6},(_,index)=>makeTree('posix-'+index))),peer=await makeTree('posix-peer'),module=path.join(temp,'posix.mjs');globalThis.workerPsReads=0
  await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',outfile:module,plugins:[{name:'observe-actual-ps',setup(builder){builder.onResolve({filter:/^node:child_process$/},args=>args.namespace==='ps-observer'?{path:args.path,external:true}:{path:args.path,namespace:'ps-observer'});builder.onLoad({filter:/.*/,namespace:'ps-observer'},()=>({contents:"import{execFile as actual}from'node:child_process';export{spawn}from'node:child_process';export const execFile=(...args)=>{if(args[0]==='ps')globalThis.workerPsReads++;return actual(...args)}",loader:'js'}))}}]})
  const {closeWorkerProcesses}=await import(pathToFileURL(module).href)
  await Promise.all(targets.map(tree=>closeWorkerProcesses([tree.process],async()=>{tree.process.stdin.end();await tree.done})))
  await until(()=>targets.every(tree=>tree.pids.every(pid=>!alive(pid))));assert.ok(peer.pids.every(alive),'Parallel POSIX cleanup never owns the peer tree');assert.ok(globalThis.workerPsReads<targets.length*3,'Concurrent ownership scans and rechecks must share in-flight reads rather than scan once per connection')
  const firstWaveReads=globalThis.workerPsReads,later=await makeTree('posix-later');await closeWorkerProcesses([later.process],async()=>{later.process.stdin.end();await later.done});await until(()=>later.pids.every(pid=>!alive(pid)));assert.ok(globalThis.workerPsReads>firstWaveReads,'A later close must read the current OS table, never a retained snapshot');assert.ok(peer.pids.every(alive))
  console.log('PASS POSIX parallel process ownership and escalation: '+targets.length+' real trees, '+firstWaveReads+' actual ps reads, independent peer retained and later snapshot refreshed')
 }
}finally{
 for(const tree of trees)for(const pid of [...tree.pids].reverse())try{process.kill(pid,'SIGKILL')}catch{}
 await Promise.all(trees.map(tree=>tree.done.catch(()=>{})));fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
