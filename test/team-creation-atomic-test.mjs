import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),call=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 await call('group.add',{name:'Existing'});const before=await call('session.list'),layoutBefore=await call('room.layout',{name:'Existing'}),directories=fs.readdirSync(f.env.AGENTS_COMPANY_PROJECTS).sort()
 for(const [name,appearance] of [['Invalid design',{design:{background:'invalid'}}],['Invalid frame',{bounds:{width:1,height:1}}]]){const r=await f.request(null,'group.add',{name,...appearance});assert.equal(r.ok,false);assert.equal((await call('session.list')).groups.includes(name),false);assert.deepEqual(fs.readdirSync(f.env.AGENTS_COMPANY_PROJECTS).sort(),directories)}
 const args={name:'Atomic Team',mode:'build',design:{background:'#e7edf7',subtitle:'Atomic project'},clientRequestId:'atomic-team-create'}
 const result=await f.cli('group','add',args.name,'--mode','build','--design',JSON.stringify(args.design),'--client-request-id',args.clientRequestId)
 assert.equal(result.revision,before.revision+1,'Team, frame, design and retry receipt use one state commit');assert.equal(result.teamCreations,undefined)
 assert.equal(result.rooms[args.name].design.background,args.design.background);assert.equal(result.rooms[args.name].design.subtitle,args.design.subtitle);assert.equal(result.rooms[args.name].bounds.shape,'rounded');assert.equal(result.rooms[args.name].bounds.width,760)
 const layoutAfter=await call('room.layout',{name:'Existing'});for(const key of ['x','y','width','height'])assert.equal(layoutAfter.bounds[key],layoutBefore.bounds[key],'existing Team frame stays in place')
 const replay=await call('group.add',args);assert.equal(replay.revision,result.revision);assert.equal(replay.groups.filter(name=>name===args.name).length,1)
 assert.equal((await f.request(null,'group.add',{...args,design:{...args.design,subtitle:'Different intent'}})).ok,false)
 await call('group.add',{name:'Automatic frame',clientRequestId:'wide-auto'});const automatic=await call('room.layout',{name:'Automatic frame'});for(const name of ['Existing',args.name]){const previous=await call('room.layout',{name});assert.ok(automatic.bounds.x+automatic.bounds.width<=previous.bounds.x||previous.bounds.x+previous.bounds.width<=automatic.bounds.x||automatic.bounds.y+automatic.bounds.height<=previous.bounds.y||previous.bounds.y+previous.bounds.height<=automatic.bounds.y,'automatic creation does not overlap '+name)}
 const root=replay.teamRoots[args.name];fs.writeFileSync(path.join(root,'retain.txt'),'Keep user work')
 await call('group.rename',{name:args.name,nextName:'Renamed Team'});assert.equal((await call('group.add',args)).teamRoots['Renamed Team'],root)
 await f.stop();await f.start();assert.equal((await call('group.add',args)).groups.includes('Renamed Team'),true);assert.equal(fs.readFileSync(path.join(root,'retain.txt'),'utf8'),'Keep user work')
 fs.mkdirSync('artifacts/product-polish-v2',{recursive:true});fs.writeFileSync('artifacts/product-polish-v2/team-atomic.json',JSON.stringify({passed:true,checks:['invalid appearance creates neither a Team nor workspace','one atomic state commit creates Team/frame/design/retry identity','existing Team geometry stays stable','unchanged CLI/API retry never duplicates or rewrites the Team','retry identity survives rename and Core restart','user work files remain unchanged'],paidModelCalls:0,productionDataUsed:false},null,2))
 console.log('PASS Team creation: one atomic commit, preflight validation, durable retry, stable geometry and retained files')
}finally{await f.close()}
