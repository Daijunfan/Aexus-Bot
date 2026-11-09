import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),call=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 await call('group.add',{name:'Hire recovery'});const args={title:'Stable hire',group:'Hire recovery',engine:'codex',model:'gpt-6-luna',clientRequestId:'stable-hire'}
 const first=await f.cli('card','create','--title',args.title,'--group',args.group,'--engine',args.engine,'--model',args.model,'--client-request-id',args.clientRequestId);await f.ready(first.id)
 const ready=(await call('session.list')).sessions.find(card=>card.id===first.id),directories=fs.readdirSync(f.env.AGENTS_COMPANY_PROJECTS).sort(),retry=await call('card.create',args)
 assert.equal(retry.id,first.id);assert.equal(retry.cwd,ready.cwd);assert.equal(retry.engine,ready.engine);assert.equal(retry.avatar,ready.avatar);assert.deepEqual(retry.initialization,ready.initialization);assert.equal((await call('session.list')).employeeCreations,undefined);assert.equal((await call('session.list')).sessions.length,1)
 assert.equal((await f.request(null,'card.create',{...args,title:'Changed intent'})).ok,false)
 await f.stop();await f.start();assert.equal((await call('card.create',args)).id,first.id);assert.deepEqual(fs.readdirSync(f.env.AGENTS_COMPANY_PROJECTS).sort(),directories)
 assert.equal((await call('session.list')).sessions.length,1)
 fs.mkdirSync('artifacts/product-polish-v2',{recursive:true});fs.writeFileSync('artifacts/product-polish-v2/employee-retry.json',JSON.stringify({passed:true,checks:['stable CLI/API retry recovers the accepted employee','initialization, engine, avatar and workspace identity remain unchanged','changed creation data cannot reuse the key','restart never creates another employee or folder','creation bookkeeping is not projected to clients'],paidModelCalls:0,productionDataUsed:false},null,2));console.log('PASS employee creation recovery: one employee and workspace, stable initialization, caller-bound retry and restart')
}finally{await f.close()}
