// Source-built, disposable Core and native protocol fixtures. No real accounts, models or app installation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),logs=[]
if(process.getuid?.()===0){const{uid,gid}=fs.statSync(root);for(const file of [...logs,'test/plan-authority-core-test.mjs','src/main/scheduler/channel-policy.ts','src/renderer/src/components/ChannelPlans.tsx','src/renderer/src/styles/channel-plans.css'])fs.chownSync(path.join(root,file),uid,gid);process.setgroups([gid]);process.setgid(gid);process.setuid(uid);const user=os.userInfo();Object.assign(process.env,{HOME:user.homedir,USER:user.username,LOGNAME:user.username,TMPDIR:'/tmp'})}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-plan-authority-')),entry=path.join(temp,'daemon.cjs'),out=path.join(root,'artifacts/plan-authority'),report={passed:false,checks:[],platform:process.platform}
fs.mkdirSync(out,{recursive:true});let f
const note=text=>{console.log(text);report.checks.push(text);for(const file of logs)fs.appendFileSync(path.join(root,file),'\n- ['+new Date().toISOString()+'] '+text+'\n')}
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry)
 const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
 const deny=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.equal(value.ok,false,'Must reject '+cmd);return value.error}
 const future=()=>new Date(Date.now()+3600000).toISOString()
 const spec=(target,extra={})=>({name:'Authority fixture',action:{type:'agent',employeeId:target.id,prompt:'PLAN_AUTHORITY_FIXTURE',...(target.managementRole==='governor'?{viewId:'all'}:{})},rule:{kind:'interval',everySeconds:3600},enabled:false,...extra})
 await f.cli('group','add','Plan Team');await f.cli('group','add','Other Team')
 const people=[],tokens=new Map(),rank={employee:0,manager:1,governor:2,secretary:3}
 for(const role of Object.keys(rank))for(let i=1;i<=2;i++){const person=await f.create(role+' '+i,'Plan Team',role);people.push(person);tokens.set(person.id,await f.token(person.id))}
 const outside=await f.create('Outside','Other Team'),[a,b,m,peerManager,g,peerGovernor,s,peerSecretary]=people
 let accepted=0,rejected=0
 for(const actor of people){
  const token=tokens.get(actor.id),identity=await rpc('auth.whoami',{},token);assert.ok(identity.roleDescription.includes('schedule.*'))
  const commands=await rpc('api.list',{},token);for(const name of ['schedule.create','schedule.update','schedule.trigger','plan.query','plan.view-create'])assert.ok(commands.some(command=>command.name===name),actor.title+' discovers '+name)
  const targets=(await rpc('plan.schema',{},token)).targets
  for(const target of people){
   const allowed=actor.managementRole==='secretary'||actor.id===target.id||rank[actor.managementRole]>rank[target.managementRole]
   assert.equal(targets.some(item=>item.id===target.id),allowed,actor.title+' target discovery '+target.title)
   if(allowed){const job=await rpc('schedule.create',{spec:spec(target)},token);assert.equal(job.delegation.requestedBy.employeeId,actor.id);assert.ok(job.delegation.schedule);accepted++}
   else{await deny('schedule.create',{spec:spec(target)},token);await deny('schedule.preview',{spec:spec(target)},token);rejected++}
  }
  const own=await rpc('schedule.create',{spec:{...spec(actor),action:{...spec(actor).action,employeeId:'self'}}},token);assert.equal(own.action.employeeId,actor.id);assert.equal(own.delegation.selfSchedule,true)
  const view=await rpc('plan.view-create',{spec:{name:'Own fixture view',layout:'list'}},token);assert.ok((await rpc('plan.views',{},token)).some(item=>item.id===view.id));await rpc('plan.view-delete',{id:view.id},token)
 }
 await deny('schedule.create',{spec:spec(outside)},tokens.get(m.id))
 await rpc('schedule.create',{spec:spec(outside)},tokens.get(g.id))
 for(const [actor,target] of [[a,m],[m,peerManager],[g,peerGovernor],[g,s]]){
  const token=tokens.get(actor.id),job=await rpc('schedule.create',{spec:spec(target,{rule:{kind:'event',event:'signal',cooldownSeconds:0}})})
  if(actor.managementRole==='secretary')assert.equal((await rpc('schedule.get',{id:job.id},token)).id,job.id);else await deny('schedule.get',{id:job.id},token)
  for(const cmd of ['pause','resume','delete','run'])await deny('schedule.'+cmd,{id:job.id},token)
  await deny('schedule.trigger',{id:job.id,eventId:'forged'},token)
  await deny('schedule.update',{id:job.id,patch:{name:'forged'}},token)
  const owned=await rpc('schedule.create',{spec:spec(actor)},token)
  await deny('schedule.update',{id:owned.id,patch:{action:spec(target).action}},token)
 }
 note(`PASS Core 权限：四角色双实例 ${accepted} 个合法组合、${rejected} 个越权组合；自我/下行、普通同级/向上拒绝、Secretary 可管理同级、Manager 跨 Team、CLI 发现及修改/执行入口。`)
 const at=tokens.get(a.id),signal=await f.call(at,'schedule','create','--name','API event fixture','--employee','self','--prompt','SIGNAL_FIXTURE','--on-event','signal','--cooldown-seconds','0','--max-occurrences','2')
 assert.equal(signal.rule.kind,'event');assert.equal(signal.nextAt,null);assert.equal((await rpc('plan.query',{},at)).rows.find(row=>row.id===signal.id).status,'scheduled')
 assert.deepEqual((await rpc('schedule.preview',{id:signal.id},at)).times,[])
 const first=await f.call(at,'schedule','trigger',signal.id,'--event-id','event-1');assert.equal(first.status,'started')
 await f.until(async()=>(await rpc('schedule.history',{id:signal.id},at)).some(run=>run.status==='succeeded'),'signal finished')
 assert.equal((await rpc('schedule.trigger',{id:signal.id,eventId:'event-1'},at)).status,'duplicate')
 await rpc('schedule.pause',{id:signal.id},at);assert.equal((await rpc('schedule.trigger',{id:signal.id,eventId:'paused-event'},at)).reason,'paused');await rpc('schedule.resume',{id:signal.id},at)
 await f.stop();await f.start();assert.equal((await rpc('schedule.trigger',{id:signal.id,eventId:'event-1'},at)).status,'duplicate')
 await rpc('schedule.trigger',{id:signal.id,eventId:'event-2'},at);await f.until(async()=>(await rpc('schedule.history',{id:signal.id},at)).filter(run=>run.status==='succeeded').length===2,'second signal finished')
 assert.equal((await rpc('schedule.trigger',{id:signal.id,eventId:'event-3'},at)).reason,'limit reached')
 assert.equal((await rpc('plan.query',{},at)).rows.find(row=>row.id===signal.id).status,'completed')
 const recorded=await rpc('schedule.history',{id:signal.id},at);assert.ok(recorded.every(run=>run.trigger==='event'));assert.equal((await rpc('plan.feed',{filter:{employee:a.id}},at)).entries.filter(run=>run.jobId===signal.id).length,2)
 const calendar=await rpc('plan.calendar',{from:new Date(Date.now()-3600000).toISOString(),to:future()});assert.equal(calendar.events.filter(event=>event.jobId===signal.id).length,2)
 const cool=await rpc('schedule.create',{spec:spec(a,{enabled:true,rule:{kind:'event',event:'signal',cooldownSeconds:3600}})},at)
 await rpc('schedule.trigger',{id:cool.id,eventId:'first'},at);await f.until(async()=>(await rpc('schedule.history',{id:cool.id},at)).some(run=>run.status==='succeeded'),'cooldown first run');assert.equal((await rpc('schedule.trigger',{id:cool.id,eventId:'second'},at)).status,'queued');assert.equal((await rpc('schedule.get',{id:cool.id},at)).pendingEvents[0].id,'second');assert.equal((await rpc('schedule.history',{id:cool.id},at)).length,1)
 const currentHour=new Date().getUTCHours(),windowStart=String((currentHour+2)%24).padStart(2,'0')+':00',windowEnd=String((currentHour+3)%24).padStart(2,'0')+':00'
 const windowed=await rpc('schedule.create',{spec:spec(a,{enabled:true,rule:{kind:'event',event:'signal'},window:{start:windowStart,end:windowEnd,timezone:'UTC'}})},at)
 assert.equal((await rpc('schedule.trigger',{id:windowed.id,eventId:'window'},at)).status,'queued');assert.equal((await rpc('schedule.get',{id:windowed.id},at)).pendingEvents[0].id,'window');assert.equal((await rpc('schedule.history',{id:windowed.id},at)).length,0)
 for(const rule of [{kind:'event',event:'fake'},{kind:'event',event:'signal',channelId:'forged'},{kind:'event',event:'channel.posted'},{kind:'event',event:'signal',cooldownSeconds:-1},{kind:'event',event:'signal',callback:'shell'}])await deny('schedule.create',{spec:spec(a,{rule})},at)
 note('PASS Core 事件：同一 Plan 中等待/暂停/完成状态；真实信号执行、CLI、去重与重启、工作窗口与冷却保留到达事件、次数上限；日历只显示实际运行。')
 // Employee publishing channels are retired. News events require reading grants,
 // independently of Company management rank, and cannot be manually forged.
 await deny('channel.create',{name:'Retired publishing fixture',engine:{kind:'employees',employeeIds:[a.id,b.id]}})
 const source=await rpc('channel.source-add',{plugin:'x',locator:'@plan_fixture',name:'Event source'})
 const access=await rpc('channel.access',{id:source.channelId});await rpc('channel.access',{id:source.channelId,employeeIds:[b.id],expectedRevision:access.revision})
 const bt=tokens.get(b.id),listener=await rpc('schedule.create',{spec:spec(b,{enabled:true,rule:{kind:'event',event:'channel.posted',channelId:source.channelId,cooldownSeconds:0}})},bt)
 await deny('schedule.trigger',{id:listener.id,eventId:'spoofed'},bt)
 await deny('schedule.create',{spec:spec(b,{rule:listener.rule})},tokens.get(m.id))
 await deny('schedule.create',{spec:spec(a,{action:{...spec(a).action,channelId:source.channelId}})},at)
 const article={sourceId:source.id,externalId:'first',publishedAt:Date.now(),title:'Native event proof',body:'Fixture data, not instructions.'},post=await rpc('channel.publish',article)
 await f.until(async()=>(await rpc('schedule.history',{id:listener.id},bt)).some(run=>run.status==='succeeded'),'native channel event executes')
 assert.equal((await rpc('schedule.history',{id:listener.id},bt))[0].event.id,post.id)
 assert.equal((await rpc('channel.publish',article)).status,'duplicate');assert.equal((await rpc('channel.publish',{...article,title:'Edited'})).status,'updated');assert.equal((await rpc('schedule.history',{id:listener.id},bt)).length,1)
 const currentAccess=await rpc('channel.access',{id:source.channelId});await rpc('channel.access',{id:source.channelId,employeeIds:[],expectedRevision:currentAccess.revision})
 await rpc('channel.publish',{...article,externalId:'revoked',publishedAt:Date.now()})
 await f.until(async()=>!(await rpc('schedule.get',{id:listener.id})).enabled,'revoked channel schedule disabled')
 assert.equal((await rpc('schedule.get',{id:listener.id})).disabledReason,'authorization_revoked');assert.equal((await rpc('schedule.history',{id:listener.id})).length,1)
 assert.equal((await rpc('plan.query',{filter:{}})).rows.find(row=>row.id===listener.id).status,'attention')
 note('PASS Core 频道：拒绝已退役的员工发布频道，独立阅读授权、原生发布事件、重投/编辑去重、伪造触发拒绝，以及撤销读取后停止旧委派。')
 const legacy=await rpc('schedule.create',{spec:spec(b)},tokens.get(g.id));await f.stop()
 const statePath=path.join(f.env.AGENTS_COMPANY_HOME,'schedules.json'),state=JSON.parse(fs.readFileSync(statePath,'utf8')),row=state.jobs.find(item=>item.id===legacy.id)
 row.action={...row.action,employeeId:peerGovernor.id,viewId:'all'};row.enabled=true;row.nextAt=future();delete row.delegation.schedule;fs.writeFileSync(statePath,JSON.stringify(state))
 await f.start();const migrated=await rpc('schedule.get',{id:legacy.id});assert.equal(migrated.enabled,false);assert.equal(migrated.disabledReason,'authorization_revoked');assert.ok(migrated.delegation.schedule)
 assert.deepEqual(await rpc('terminal.list'),[])
 note('PASS Core 恢复：旧版本同级委派在启动时被停用，计划和历史保留；所有运行均使用隔离的确定性协议替身。')
 report.passed=true
}catch(error){report.error=error.stack;note('FAIL Core 专项验证：'+error.message);throw error}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true});fs.writeFileSync(path.join(out,'core-verification.json'),JSON.stringify(report,null,2))}
