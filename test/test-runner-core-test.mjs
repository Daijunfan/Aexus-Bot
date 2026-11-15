// Exercise the real release runner against a disposable, stubborn process tree.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {pathToFileURL} from 'node:url'
import {closeWorkerProcesses} from '../src/main/worker-processes.ts'

const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-test-deadline-')),source=fs.readFileSync(path.join(root,'scripts/run-tests.mjs'),'utf8')
const entries=[...source.match(/core:\[(.*?)\]/s)[1].matchAll(/'([^']+)'/g),...source.match(/suites\.core\.unshift\((.*?)\)/s)[1].matchAll(/'([^']+)'/g)].map(match=>match[1])
const actors=path.join(temp,'actors.json'),guard=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})
let owned=[]
try{
 for(const directory of ['scripts','src/main','test'])fs.mkdirSync(path.join(temp,directory),{recursive:true})
 fs.writeFileSync(path.join(temp,'scripts/run-tests.mjs'),source)
 fs.copyFileSync(path.join(root,'src/main/worker-processes.ts'),path.join(temp,'src/main/worker-processes.ts'))
 for(const entry of entries)fs.writeFileSync(path.join(temp,'test',entry.split(':')[0]+'-test.mjs'),'// Disposable runner case, not a product test.\n')
 fs.writeFileSync(path.join(temp,'test/toolchain-compatibility-test.mjs'),`import fs from 'node:fs';import {spawn} from 'node:child_process';process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(actors)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)\n`)
 const bootstrap=path.join(temp,'deadline.mjs')
 // Only shorten the runner's existing deadline, leaving its cleanup clock intact.
 fs.writeFileSync(bootstrap,'const original=setTimeout;globalThis.setTimeout=(callback,ms,...args)=>original(callback,ms===180000?2500:ms,...args)\n')
 let failure
 try{await promisify(execFile)(process.execPath,['--import',pathToFileURL(bootstrap).href,path.join(temp,'scripts/run-tests.mjs'),'core'],{cwd:temp,timeout:45000,maxBuffer:2e6})}catch(error){failure=error}
 assert.equal(failure?.code,1,'A timed-out case must fail the suite')
 const results=JSON.parse(fs.readFileSync(path.join(temp,'artifacts/release-tests/core/results.json'),'utf8')),expired=results.find(row=>row.test==='toolchain-compatibility')
 assert.equal(expired.status,124);assert.ok(expired.ms<10000,'The deadline must terminate an ignored SIGTERM')
 assert.equal(results.length,entries.length);assert.ok(results.filter(row=>row!==expired).every(row=>row.status===0),'The runner must continue through its remaining cases')
 assert.match(fs.readFileSync(path.join(temp,expired.log),'utf8'),/owned process tree/)
 owned=JSON.parse(fs.readFileSync(actors,'utf8'))
 for(const pid of owned)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'Every owned actor must exit')
 process.kill(guard.pid,0)
 console.log('PASS release timeout stops an ignored-SIGTERM child and its descendant, records124, continues the suite and preserves an unrelated process')
}finally{
 if(fs.existsSync(actors))owned=JSON.parse(fs.readFileSync(actors,'utf8'))
 for(const pid of owned)try{await closeWorkerProcesses([{pid,exitCode:null,signalCode:null}],async()=>{try{process.kill(pid,'SIGTERM')}catch{}})}catch{}
 await closeWorkerProcesses([guard],async()=>{guard.kill('SIGTERM')})
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
