// Native SDK extension events cross the real Core, command dispatcher and session metadata.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-goal-state-')),sdk=path.join(temp,'sdk.mjs'),goalFile=path.join(temp,'goal.json'),source=pathToFileURL(path.resolve('test/fixtures/discussion-claude-sdk.mjs')).href
fs.writeFileSync(sdk,`import fs from 'node:fs';import {query as base} from ${JSON.stringify(source)};export {tool,createSdkMcpServer} from ${JSON.stringify(source)};
export function query(args){const q=base(args),iterate=q[Symbol.asyncIterator].bind(q);q.supportedCommands=async()=>[{name:'goal',description:'Native Goal',argumentHint:''}];q[Symbol.asyncIterator]=async function*(){for await(const msg of {[Symbol.asyncIterator]:iterate}){if(msg.type==='result'&&fs.existsSync(${JSON.stringify(goalFile)}))yield {type:'active_goal',value:JSON.parse(fs.readFileSync(${JSON.stringify(goalFile)})),session_id:msg.session_id};yield msg}};return q}`)
let f
try{
 const entry=path.join(temp,'daemon.cjs');await build({entryPoints:['src/main/daemon.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(path.resolve('.'))},logLevel:'silent'})
 fs.symlinkSync(path.resolve('node_modules'),path.join(temp,'node_modules'),'dir')
 f=await fixtureCore({},entry);const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('engine.configure',{engine:'claude',patch:{sdkPath:sdk}});await rpc('group.add',{name:'Secretary'})
 const card=await rpc('card.create',{title:'Goal verifier',group:'Secretary',engine:'claude',managementRole:'secretary'});await f.ready(card.id)
 const {sessionId}=await rpc('session.open',{cardId:card.id});await f.until(async()=>(await rpc('commands.list',{id:sessionId})).some(c=>c.name==='goal'),'native goal command')
 const goal={condition:'Complete the real deliverables',iterations:2,set_at:42,tokens_at_start:100};fs.writeFileSync(goalFile,JSON.stringify(goal))
 await rpc('commands.run',{id:sessionId,text:'/goal Complete the real deliverables'});await f.until(async()=>!(await rpc('session.info',{id:sessionId})).busy,'goal command')
 assert.deepEqual((await rpc('session.info',{id:sessionId})).goal,goal)
 assert.match(JSON.parse(fs.readFileSync(path.join(f.control,card.id+'-work.json'),'utf8')).text,/^\/goal Complete the real deliverables$/,'native commands must reach Claude without a role/routing wrapper')
 fs.writeFileSync(goalFile,'null');await rpc('commands.run',{id:sessionId,text:'/goal clear'});await f.until(async()=>!(await rpc('session.info',{id:sessionId})).busy,'clear goal')
 assert.equal((await rpc('session.info',{id:sessionId})).goal,null)
 console.log('PASS native Goal command dispatch and active/cleared metadata through real Core; isolated data, no inference')
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
