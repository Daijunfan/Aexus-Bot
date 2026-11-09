// Real Core/CLI, isolated state. Display configuration never starts task execution.
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),checks=[],pass=text=>{checks.push(text);console.log('PASS '+text)},rpc=async(cmd,args={},token=null)=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data}
try{
 await rpc('group.add',{name:'Design'});await rpc('group.add',{name:'Operations'});const a=await f.create('Alex','Design'),b=await f.create('Alex','Operations'),ta=await f.token(a.id)
 const make=(name,employee,priority,tags,enabled=true)=>rpc('schedule.create',{spec:{name,enabled,action:{type:'agent',employeeId:employee.id,prompt:'Future fixture; do not execute automatically.'},rule:{kind:'once',at:'2099-01-02T10:00:00Z'},plan:{priority,tags,notes:'Retain all task metadata.'}}})
 const high=await make('High release',a,'high',['review','release']),normal=await make('Normal review',b,'normal',['review']),urgent=await make('Urgent release',b,'urgent',['release'],false),low=await make('Low archived review',a,'low',['review'])
 await rpc('plan.archive',{id:low.id,archived:true,expectedRevision:low.revision});const combined={allOf:[{priorities:['high','normal']},{tags:['review']}]}
 assert.deepEqual((await rpc('plan.query',{filter:combined,sort:'name'})).rows.map(row=>row.id),[high.id,normal.id]);assert.equal((await rpc('plan.analytics',{filter:combined})).total,2)
 assert.equal((await rpc('plan.query',{filter:{allOf:[{priorities:['high']},{priorities:['low']}]}})).total,0,'Conflicting scopes cannot broaden a saved view')
 assert.equal((await rpc('plan.query',{filter:{archived:'all',allOf:[{tags:['review']}]}})).total,3,'Archive mode is inherited by combined clauses')
 assert.equal((await rpc('plan.query',{filter:{archived:'all',allOf:[{archived:'active'},{archived:'archived'}]}})).total,0)
 const own=await rpc('plan.query',{filter:{allOf:[{employee:'self'},{priorities:['high','normal']}]}},ta);assert.deepEqual(own.rows.map(row=>row.id),[high.id])
 const events=await rpc('plan.timeline',{from:'2099-01-02T00:00:00Z',to:'2099-01-03T00:00:00Z',filter:combined});assert.deepEqual(new Set(events.events.map(event=>event.jobId)),new Set([high.id,normal.id]))
 const cli=await f.cli('plan','query','--filter',JSON.stringify(combined),'--sort','name');assert.deepEqual(cli.rows.map(row=>row.id),[high.id,normal.id]);pass('Saved-view and global clauses intersect without overriding each other; arrays, archive inheritance, self scope, analytics, timeline and real CLI agree')
 const spec={name:'Review desk',layout:'table',filter:combined,sort:'name',direction:'desc',options:{hiddenProperties:['employee','lastRun'],density:'compact'}},view=await rpc('plan.view-create',{spec})
 assert.deepEqual(view.options,spec.options);assert.deepEqual(view.filter,combined);assert.equal((await f.request(ta,'plan.view-update',{id:view.id,patch:{name:'Borrowed'},expectedRevision:view.revision})).ok,false)
 const changed=await rpc('plan.view-update',{id:view.id,expectedRevision:view.revision,patch:{options:{density:'comfortable',hiddenProperties:['tags']}}});assert.equal(changed.revision,view.revision+1)
 assert.equal((await f.request(null,'plan.view-update',{id:view.id,expectedRevision:view.revision,patch:{options:{density:'compact'}}})).ok,false)
 for(const options of [{hiddenProperties:['name']},{hiddenProperties:['employee','employee']},{hiddenProperties:['made-up']},{density:'tiny'}])assert.equal((await f.request(null,'plan.view-create',{spec:{...spec,name:'Invalid',options}})).ok,false)
 const row=(await rpc('plan.query',{filter:{search:high.id}})).rows[0];assert.ok(row.name&&row.action.prompt&&row.employee&&row.plan.tags.length);pass('Property visibility and density save through existing view APIs with current revisions; hidden identity/duplicate fields, unknown values, unauthorized and stale writes are rejected without hiding Core data')
 const mission=await rpc('mission.create',{spec:{name:'Joint acceptance',prompt:'Verify the future project.',employeeIds:[a.id,b.id],type:'independent',reminderSeconds:86400,plan:{priority:'high',tags:['joint'],notes:'Both people own this outcome.'}}})
 const joint=(await rpc('plan.query',{filter:{search:mission.id,team:'Operations'}})).rows[0];assert.deepEqual(joint.assignees.map(person=>[person.id,person.title,person.team]),[[a.id,'Alex','Design'],[b.id,'Alex','Operations']]);assert.equal(joint.action.employeeId,a.id)
 let preferences=await rpc('plan.preferences');preferences=await rpc('plan.preferences',{expectedRevision:preferences.revision,patch:{filter:{states:['scheduled','paused'],priorities:['high','urgent'],tags:['release']}}});assert.deepEqual(preferences.filter.tags,['release'])
 const joined=await rpc('plan.query',{filter:{allOf:[...combined.allOf,preferences.filter]}});assert.deepEqual(joined.rows.map(row=>row.id),[high.id])
 assert.equal((await rpc('plan.query',{filter:{allOf:Array.from({length:22},()=>({priorities:['high']}))}})).rows.length,2)
 for(const filter of [{allOf:[]},{allOf:[{allOf:[{}]}]},{allOf:Array.from({length:33},()=>({}))}])assert.equal((await f.request(null,'plan.query',{filter})).ok,false)
 pass('Multi-assignee missions expose every real person and Team; global state/priority/tag settings persist without changing tasks, and combined filter limits reject invalid structures')
 const before=(await rpc('session.list')).sessions.map(({id,engine,cwd})=>({id,engine,cwd}));await f.stop();await f.start();assert.deepEqual((await rpc('plan.views')).find(item=>item.id===view.id),changed);assert.deepEqual((await rpc('plan.preferences')).filter,preferences.filter);assert.deepEqual((await rpc('session.list')).sessions.map(({id,engine,cwd})=>({id,engine,cwd})),before);assert.equal((await rpc('schedule.history')).length,0);assert.equal((await rpc('mission.get',{id:mission.id})).status,'open');pass('Saved layout/options, combined filters, global preferences and employee identities survive Core restart; no scheduled work or completion is fabricated')
}finally{await f.close()}
