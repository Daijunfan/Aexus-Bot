// Disposable source-built Core with the deterministic native fixture. No real models, SSH or user tasks.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-plan-self-access-'))),out=path.join(root,'artifacts/plan-self-access')
fs.mkdirSync(out,{recursive:true})
const report={passed:false,syntheticData:true,providerCalls:0,platform:process.platform,checks:[],matrix:[],startedAt:new Date().toISOString()}
let f
const note=text=>{report.checks.push(text);console.log(text)}
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=path.join(temp,'daemon.cjs')
 await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
 const deny=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,'Must reject '+cmd+' '+JSON.stringify(args));return value.error}
 const once=()=>({kind:'once',at:new Date(Date.now()+3600000).toISOString()})
 const interval=()=>({kind:'interval',everySeconds:7200,anchor:new Date(Date.now()+7200000).toISOString()})
 const spec=(target,rule=once(),extra={})=>({name:'Scope '+target.title,enabled:false,source:'plan-scope-fixture',action:{type:'agent',employeeId:target.id,prompt:'SCOPE_ONLY_FIXTURE',...(target.role==='governor'?{viewId:'all'}:{})},rule,...extra})
 const actionFor=target=>({type:'agent',employeeId:target.id,prompt:'SCOPE_ONLY_FIXTURE',...(target.role==='governor'?{viewId:'all'}:{})})
 await rpc('group.add',{name:'Alpha'});await rpc('group.add',{name:'Beta'})
 const cards=[await f.create('Employee A','Alpha','employee'),await f.create('Employee B','Alpha','employee'),await f.create('Employee C','Beta','employee'),await f.create('Manager Alpha','Alpha','manager'),await f.create('Manager Beta','Beta','manager'),await f.create('Governor One','Alpha','governor'),await f.create('Governor Two','Beta','governor'),await f.create('Secretary One','Alpha','secretary'),await f.create('Secretary Two','Beta','secretary')]
 const people=cards.map((card,index)=>({card,id:card.id,title:card.title,role:['employee','employee','employee','manager','manager','governor','governor','secretary','secretary'][index],team:['Alpha','Alpha','Beta','Alpha','Beta','Alpha','Beta','Alpha','Beta'][index]}))
 const [A,B,C,M1,M2,G1,G2,S1,S2]=people,role=new Map(people.map(p=>[p.id,p.role])),team=new Map(people.map(p=>[p.id,p.team])),tokens=new Map()
 for(const p of people)tokens.set(p.id,await f.token(p.id))
 const act=p=>tokens.get(p.id),createJob=async(actor,target,rule=once(),extra={})=>{const job=await rpc('schedule.create',{spec:spec(target,rule,extra)},actor?act(actor):null);report.matrix.push({created:job.id,actor:actor?.id??'user',target:target.id});return job}
 const expectedTargets=person=>people.filter(other=>{if(other.id===person.id)return true;const current=role.get(person.id);if(current==='secretary')return true;if(current==='governor')return ['employee','manager'].includes(role.get(other.id));if(current==='manager')return role.get(other.id)==='employee'&&team.get(other.id)===team.get(person.id);return false}).map(other=>other.id).sort()
 const checkScope=async person=>{const token=act(person),schema=await rpc('plan.schema',{},token),ids=schema.targets.map(item=>item.id),expected=expectedTargets(person),secretary=role.get(person.id)==='secretary'
  assert.deepEqual(ids.slice().sort(),expected,person.title+' target discovery')
  const all=await rpc('schedule.list',{},null),want=all.filter(job=>secretary||ids.includes(job.action.employeeId)).map(job=>job.id).sort(),query=await rpc('plan.query',{limit:500},token)
  assert.equal(query.total,query.rows.length,person.title+' query completeness')
  assert.deepEqual(query.rows.map(row=>row.id).sort(),want,person.title+' query scope must match schema targets')
  for(const row of query.rows){
   assert.ok(secretary||ids.includes(row.target.id),person.title+' row target outside schema targets')
   const required=row.target.exists?['get','update','pause','resume','delete','preview']:['get','update','delete']
   for(const name of required)assert.ok(row.allowedActions.includes('schedule.'+name),person.title+' '+row.id+' allowed '+name)
   if(!row.target.exists){assert.ok(row.blockedActions['schedule.run']);assert.ok(row.blockedActions['schedule.resume'])}
  }
  report.matrix.push({actor:person.id,role:role.get(person.id),targets:ids.sort(),rows:query.rows.length})
 }
 // User-created jobs plus manager/governor/secretary delegations, all paused with future rules.
 const userJobA=await createJob(null,A),userJobB=await createJob(null,B),userJobC=await createJob(null,C)
 const m1JobA=await createJob(M1,A,interval()),m1BJob=await createJob(M1,B,interval()),gJobA=await createJob(G1,A),cJobM2=await createJob(M2,C,interval())
 const s1ForS2=await createJob(S1,S2,interval()),s2ForS1=await createJob(S2,S1,interval()),s1ForG1=await createJob(S1,G1),s1ForA=await createJob(S1,A,interval())
 const moveAB=await createJob(M1,A,interval()),moveCross=await createJob(M1,A,interval()),gMove=await createJob(G1,A),deleteByM1=await createJob(M1,B,interval())
 const selfJobs=new Map()
 for(const person of [B,M1,G1,G2,S1,S2]){
  const job=await createJob(person,person,person.role==='governor'?once():interval()),current=await rpc('schedule.get',{id:job.id},act(person))
  const edited=await rpc('schedule.update',{id:job.id,expectedRevision:current.revision,patch:{name:'Own '+person.title+' edited'}},act(person))
  assert.equal(edited.action.employeeId,person.id);assert.equal(edited.name,'Own '+person.title+' edited');selfJobs.set(person.id,edited)
 }
 // Real CLI self scheduling by an ordinary employee; future interval never auto-runs.
 const cliSelf=await f.call(act(A),'schedule','create','--name','A CLI self interval','--employee','self','--prompt','SCOPE_ONLY_FIXTURE','--every-seconds','7200','--paused')
 assert.equal(cliSelf.action.employeeId,A.id);assert.equal(cliSelf.rule.kind,'interval');assert.equal(cliSelf.enabled,false)
 const cliEdited=await f.call(act(A),'schedule','update',cliSelf.id,'--patch',JSON.stringify({name:'A CLI self edited'}),'--expected-revision',String(cliSelf.revision))
 assert.equal(cliEdited.name,'A CLI self edited');assert.equal(cliEdited.action.employeeId,A.id)
 // A target edits the user-created and manager-created jobs assigned to itself; managers edit user/other-superior jobs for subordinates.
 const userOwned=await rpc('schedule.get',{id:userJobA.id},act(A));await rpc('schedule.update',{id:userJobA.id,expectedRevision:userOwned.revision,patch:{name:'User-created job edited by target'}},act(A))
 const assigned=await rpc('schedule.get',{id:m1JobA.id},act(A));await rpc('schedule.update',{id:m1JobA.id,expectedRevision:assigned.revision,patch:{name:'Boss-created job edited by target'}},act(A))
 for(const job of [userJobA,gJobA]){const current=await rpc('schedule.get',{id:job.id},act(M1));await rpc('schedule.update',{id:job.id,expectedRevision:current.revision,patch:{name:'Managed by team manager'}},act(M1))}
 for(const job of [s1ForS2,s2ForS1]){const peer=job===s1ForS2?S2:S1,current=await rpc('schedule.get',{id:job.id},act(peer));await rpc('schedule.update',{id:job.id,expectedRevision:current.revision,patch:{name:'Peer Secretary edit'}},act(peer))}
 // Target changes require both old and new target authority.
 const moved=await rpc('schedule.update',{id:moveAB.id,expectedRevision:moveAB.revision,patch:{action:actionFor(B)}},act(M1));assert.equal(moved.action.employeeId,B.id)
 const beforeCross=await rpc('schedule.get',{id:moveCross.id},null)
 await deny('schedule.update',{id:moveCross.id,expectedRevision:beforeCross.revision,patch:{action:actionFor(C)}},act(M1))
 const afterCross=await rpc('schedule.get',{id:moveCross.id},null);assert.equal(afterCross.revision,beforeCross.revision);assert.equal(afterCross.action.employeeId,A.id)
 const beforeOwn=await rpc('schedule.get',{id:userJobA.id},null)
 await deny('schedule.update',{id:userJobA.id,expectedRevision:beforeOwn.revision,patch:{action:actionFor(B)}},act(A))
 const afterOwn=await rpc('schedule.get',{id:userJobA.id},null);assert.equal(afterOwn.revision,beforeOwn.revision);assert.equal(afterOwn.action.employeeId,A.id)
 const governed=await rpc('schedule.update',{id:gMove.id,expectedRevision:gMove.revision,patch:{action:actionFor(M2)}},act(G1));assert.equal(governed.action.employeeId,M2.id)
 await deny('schedule.update',{id:gMove.id,expectedRevision:governed.revision,patch:{action:actionFor(G2)}},act(G1))
 const afterMove=await rpc('schedule.get',{id:gMove.id},null);assert.equal(afterMove.revision,governed.revision);assert.equal(afterMove.action.employeeId,M2.id)
 // Negative matrix: same rank, superior, peer, Secretary, and cross-Team targets.
 for(const [actor,target] of [[A,B],[A,M1],[A,G1],[A,S1],[M1,C],[M1,M2],[M1,G1],[M1,S1],[G1,G2],[G1,S1],[G2,G1],[M2,A]])await deny('schedule.create',{spec:spec(target)},act(actor))
 for(const cmd of ['get','update','pause','resume','delete'])await deny('schedule.'+cmd,{id:userJobB.id,...(cmd==='update'?{patch:{name:'same-rank colleague'}}:{})},act(A))
 for(const cmd of ['get','update','pause','resume','delete'])await deny('schedule.'+cmd,{id:selfJobs.get(M1.id).id,...(cmd==='update'?{patch:{name:'superior'}}:{})},act(A))
 for(const cmd of ['get','update','pause','resume','delete'])await deny('schedule.'+cmd,{id:selfJobs.get(G2.id).id,...(cmd==='update'?{patch:{name:'peer governor'}}:{})},act(G1))
 for(const cmd of ['get','update','delete'])await deny('schedule.'+cmd,{id:userJobC.id,...(cmd==='update'?{patch:{name:'cross-team manager'}}:{})},act(M1))
 for(const cmd of ['get','update','delete'])await deny('schedule.'+cmd,{id:userJobA.id,...(cmd==='update'?{patch:{name:'cross-team manager'}}:{})},act(M2))
 // Orphans are created while the targets still exist, then those employees are removed.
 const removedD=await f.create('Removed D','Alpha','employee'),removedE=await f.create('Removed E','Beta','employee')
 const orphanKeep=await createJob(null,{id:removedD.id,title:'Removed D',role:'employee'},once(),{name:'Detached keep'})
 const orphanDelete=await createJob(S1,{id:removedE.id,title:'Removed E',role:'employee'},interval(),{name:'Detached delete'})
 await rpc('card.remove',{ids:[removedD.id,removedE.id]},null)
 await f.until(async()=>{const rows=(await rpc('plan.query',{},null)).rows;return rows.some(row=>row.id===orphanKeep.id&&!row.target.exists)&&rows.some(row=>row.id===orphanDelete.id&&!row.target.exists)},'detached jobs')
 // Complete scope/action projection matches schema targets for every rank.
 for(const person of [A,B,C,M1,M2,G1,G2,S1,S2])await checkScope(person)
 note('PASS 权限矩阵：员工只发现自身；Manager 只发现本 Team Employee；Governor 可管理 Employee/Manager 及自身但不能同级 Governor/Secretary；Secretary 覆盖自身、同级 Secretary 与全部合法员工；schema.targets、plan.query 行与 allowedActions 一致。')
 // Pause/resume/delete share the same target authority.
 for(const [actor,job] of [[A,m1JobA],[M1,userJobA],[G1,gJobA],[S2,s1ForS2],[S1,s2ForS1]]){
  const current=await rpc('schedule.get',{id:job.id},act(actor));const paused=await rpc('schedule.pause',{id:job.id,expectedRevision:current.revision},act(actor));assert.equal(paused.enabled,false)
  const resumed=await rpc('schedule.resume',{id:job.id,expectedRevision:paused.revision},act(actor));assert.equal(resumed.enabled,true)
 }
 const ownPaused=await rpc('schedule.get',{id:m1JobA.id},act(A));await rpc('schedule.pause',{id:m1JobA.id,expectedRevision:ownPaused.revision},act(A))
 for(const cmd of ['pause','resume','delete'])await deny('schedule.'+cmd,{id:userJobB.id},act(A))
 await deny('schedule.delete',{id:userJobC.id},act(M1))
 const deleteTarget=await rpc('schedule.get',{id:deleteByM1.id},null);await rpc('schedule.delete',{id:deleteByM1.id,expectedRevision:deleteTarget.revision},act(M1))
 await deny('schedule.get',{id:deleteByM1.id},null)
 // Stale revisions never mutate the record.
 const stable=await rpc('schedule.get',{id:userJobB.id},null),beforeList=await rpc('schedule.list',{},null)
 await deny('schedule.update',{id:userJobB.id,expectedRevision:stable.revision+99,patch:{name:'STALE MUST NOT APPLY'}},act(M1))
 await deny('schedule.delete',{id:userJobB.id,expectedRevision:stable.revision+99},act(M1))
 await deny('schedule.pause',{id:userJobB.id,expectedRevision:stable.revision+99},act(M1))
 const unchanged=await rpc('schedule.get',{id:userJobB.id},null);assert.equal(unchanged.revision,stable.revision);assert.equal(unchanged.name,stable.name);assert.deepEqual(await rpc('schedule.list',{},null),beforeList)
 note('PASS CRUD：暂停、恢复、删除与创建/修改使用同一目标权限；stale expectedRevision 被拒绝且数据未变。')
 // Only the user and Secretaries maintain detached records; none can run a missing target.
 for(const cmd of ['get','update','delete'])await deny('schedule.'+cmd,{id:orphanKeep.id,...(cmd==='update'?{patch:{name:'forged orphan'}}:{})},act(M1))
 await deny('schedule.get',{id:orphanDelete.id},act(M2))
 const userOrphan=await rpc('schedule.get',{id:orphanKeep.id},null);await rpc('schedule.update',{id:orphanKeep.id,expectedRevision:userOrphan.revision,patch:{name:'Detached kept by user'}},null)
 const secretaryOrphan=await rpc('schedule.get',{id:orphanDelete.id},act(S1));await rpc('schedule.update',{id:orphanDelete.id,expectedRevision:secretaryOrphan.revision,patch:{name:'Detached edited by Secretary'}},act(S1))
 const secretaryOrphan2=await rpc('schedule.get',{id:orphanDelete.id},act(S1));await rpc('schedule.delete',{id:orphanDelete.id,expectedRevision:secretaryOrphan2.revision},act(S1))
 await deny('schedule.get',{id:orphanDelete.id},null)
 for(const token of [null,act(S1)]){await deny('schedule.run',{id:orphanKeep.id},token);await deny('schedule.resume',{id:orphanKeep.id},token)}
 note('PASS 孤儿：普通 Manager 无权查看/修改，user 与 Secretary 可维护元数据；缺失 target 只能维护不能运行或恢复。')
 const selfRecover=await createJob(M1,B,interval(),{name:'Subordinate may explicitly resume after old creator demotion'})
 // Role changes revoke target scope immediately.
 await rpc('card.management-role',{id:C.id,role:'manager'},null);role.set(C.id,'manager')
 await deny('schedule.get',{id:cJobM2.id},act(M2));await deny('schedule.update',{id:cJobM2.id,patch:{name:'revoked target'}},act(M2))
 const m2Targets=(await rpc('plan.schema',{},act(M2))).targets.map(item=>item.id);assert.ok(!m2Targets.includes(C.id));assert.ok(m2Targets.includes(M2.id))
 assert.ok(!(await rpc('plan.query',{limit:500},act(M2))).rows.some(row=>row.target.id===C.id))
 await rpc('card.management-role',{id:M1.id,role:'employee'},null);role.set(M1.id,'employee')
 for(const cmd of ['get','update','pause','resume','delete'])await deny('schedule.'+cmd,{id:m1BJob.id,...(cmd==='update'?{patch:{name:'revoked manager'}}:{})},act(M1))
 await deny('schedule.get',{id:userJobA.id},act(M1));await deny('schedule.run',{id:m1BJob.id},act(M1))
 const manual=await rpc('schedule.run',{id:m1BJob.id},null);assert.equal(manual.delegation.requestedBy.kind,'operator')
 await f.until(async()=>(await rpc('schedule.history',{id:m1BJob.id},null)).some(run=>run.id===manual.id&&run.status==='succeeded'),'explicit user reauthorization')
 const recovered=await rpc('schedule.resume',{id:selfRecover.id},act(B));assert.equal(recovered.delegation.requestedBy.employeeId,B.id);assert.equal(recovered.delegation.selfSchedule,true);assert.equal(recovered.createdBy.employeeId,M1.id)
 await rpc('schedule.pause',{id:selfRecover.id},act(B))
 await checkScope(M1);await checkScope(M2)
 note('PASS 撤权：目标升级 Manager 后原 Manager 立即失去；Manager 降级为 Employee 后只保留自身范围，旧调用者无权运行，用户显式手动运行使用本人新授权且不复活旧自动委派；schema/query 同步收紧。')
 // Restart preserves IDs, revisions, native workspace, roles and sources.
 const stableJob=await rpc('schedule.get',{id:userJobB.id},null),stableCli=await rpc('schedule.get',{id:cliSelf.id},null),stableOrphan=await rpc('schedule.get',{id:orphanKeep.id},null),workspace=(await f.cli('card','profile',A.id)).company.workspace
 await f.stop();await f.start()
 const restartedJob=await rpc('schedule.get',{id:stableJob.id},null),restartedCli=await rpc('schedule.get',{id:stableCli.id},null),restartedOrphan=await rpc('schedule.get',{id:orphanKeep.id},null)
 assert.equal(restartedJob.revision,stableJob.revision);assert.equal(restartedJob.source,'plan-scope-fixture');assert.equal(restartedJob.action.engine,stableJob.action.engine);assert.equal(restartedJob.action.employeeId,B.id)
 assert.equal(restartedCli.id,stableCli.id);assert.equal(restartedCli.revision,stableCli.revision);assert.equal(restartedCli.action.employeeId,A.id)
 assert.equal(restartedOrphan.revision,stableOrphan.revision)
 assert.equal((await f.cli('card','profile',A.id)).company.workspace,workspace)
 const row=(await rpc('plan.query',{limit:500},null)).rows.find(item=>item.id===stableJob.id);assert.equal(row.employee.role,'employee');assert.equal(row.target.role,'employee');assert.equal(row.source,'plan-scope-fixture')
 const orphanRow=(await rpc('plan.query',{limit:500},act(S1))).rows.find(item=>item.id===orphanKeep.id);assert.equal(orphanRow.target.exists,false);assert.equal(orphanRow.disabledReason,'employee_removed')
 const revokedJob=await rpc('schedule.get',{id:m1BJob.id},null);assert.equal(revokedJob.enabled,false);assert.equal(revokedJob.disabledReason,'authorization_revoked')
 note('PASS 重启：计划 ID、修订、目标、engine、source、员工 cwd/角色与孤儿状态保持；已撤权委派重启后仍为 authorization_revoked。')
 report.passed=true
}catch(error){report.error=error.stack;note('FAIL Plan target scope: '+error.message);throw error}
finally{
 try{fs.writeFileSync(path.join(out,'permission-result.json'),JSON.stringify(report,null,2))}catch{}
 await f?.close();fs.rmSync(temp,{recursive:true,force:true})
}
