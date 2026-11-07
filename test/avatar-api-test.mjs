import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),{cli,create,token,request}=f
const rpc=async(auth,cmd,args={})=>{const r=await request(auth,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 await cli('group','add','A');await cli('group','add','B')
 const manager=await create('Fresh Manager','A','manager'),governor=await create('Fresh Governor','A','governor'),employee=await create('Ordinary','A'),outside=await create('Outside','B')
 const m=await token(manager.id),g=await token(governor.id),e=await token(employee.id)
 assert.equal((await request(e,'avatar.get',{})).ok,false)
 const catalog=await rpc(m,'avatar.list');assert.equal(catalog.length,21);assert.ok((await rpc(e,'avatar.list')).length===21)
 assert.equal((await rpc(m,'avatar.list',{query:'英雄王',style:'chibi'}))[0].id,'fate-gilgamesh-chibi')
 assert.equal((await rpc(g,'avatar.list',{query:'吉尔伽美什 可爱版'})).length,1)
 assert.equal((await rpc(m,'avatar.list',{all:true})).length,76)
 for(const auth of [m,g]){
  const docs=(await rpc(auth,'api.docs',{document:'core/api'})).markdown;assert.match(docs,/character.*avatarStyle/);assert.match(docs,/profession/);assert.match(docs,/card avatar/)
  const schema=await rpc(auth,'api.describe',{command:'card.create'});assert.ok(schema.inputSchema.properties.character&&schema.inputSchema.properties.profession&&schema.inputSchema.properties.managementRole)
 }
 let created=0
 for(const [auth,supervisor,group] of [[m,manager,'A'],[g,governor,'B']])for(const [index,appearance] of catalog.entries()){
  const card=await rpc(auth,'card.create',{title:supervisor.managementRole+'-'+index,group,...(supervisor.managementRole==='manager'?{character:appearance.characterId,avatarStyle:appearance.style}:{avatar:appearance.id}),profession:'测试职责',managementRole:'employee',engine:'codex',model:'gpt-6-luna',effort:'low'});created++
  assert.equal(card.avatar,appearance.id);assert.equal(card.role,'测试职责');assert.equal(card.createdBy.employeeId,supervisor.id)
  const read=(await rpc(auth,'session.status',{employee:card.id}))[0];assert.equal(read.avatar,appearance.id);assert.equal(read.avatarName,appearance.name);assert.equal(read.profession,'测试职责')
 }
 const hero=await rpc(m,'card.create',{title:'Unrelated display name',group:'A',character:'英雄王',avatarStyle:'chibi',profession:'代码审查',managementRole:'employee',engine:'codex'})
 assert.equal(hero.avatar,'fate-gilgamesh-chibi');assert.equal(hero.title,'Unrelated display name')
 const cliHero=await f.call(m,'card','create','--title','CLI character','--character','吉尔伽美什','--avatar-style','可爱版','--profession','Reviewer','--engine','codex','--management-role','employee','--thinking','off');assert.equal(cliHero.avatar,'fate-gilgamesh-chibi');assert.equal(cliHero.role,'Reviewer');assert.equal(cliHero.thinking,false)
 for(const args of [{thinking:'off'},{character:'not-a-real-character',avatarStyle:'chibi'},{avatar:'wrong-id'},{avatar:'fate-saber-anime',character:'英雄王',avatarStyle:'chibi'},{character:'英雄王',avatarStyle:'chibi',profession:'Reviewer',role:'Conflicting description'}]){
  const title='Rejected '+JSON.stringify(args),before=(await cli('session','list')).sessions.length,r=await request(m,'card.create',{title,group:'A',engine:'codex',...args});assert.equal(r.ok,false);assert.equal((await cli('session','list')).sessions.length,before);assert.ok(!fs.existsSync(path.join(f.env.AGENTS_COMPANY_PROJECTS,'A',title)))
 }
 await f.ready(hero.id)
 const before=(await cli('session','list')).sessions.find(c=>c.id===hero.id)
 await cli('avatar','update','fate-rin-anime','--enabled','true')
 await f.call(m,'card','avatar',hero.id,'--character','远坂凛','--avatar-style','anime')
 const after=(await cli('session','list')).sessions.find(c=>c.id===hero.id);assert.equal(after.avatar,'fate-rin-anime');for(const key of ['title','engine','cwd','group','position','managementRole','createdBy','role'])assert.deepEqual(after[key],before[key])
 const info=await rpc(m,'session.info',{employee:hero.id});assert.equal(info.character,'远坂凛')
 await rpc(m,'session.open',{employee:hero.id});assert.equal((await rpc(m,'session.info',{employee:hero.id})).avatar,'fate-rin-anime')
 for(const [auth,cmd,args] of [[m,'card.avatar',{id:outside.id,avatar:'fate-saber-chibi'}],[m,'card.avatar',{id:governor.id,avatar:'codex'}],[m,'card.create',{title:'Forbidden Manager',group:'A',managementRole:'manager',engine:'codex'}],[m,'card.create',{title:'Wrong Team',group:'B',avatar:'codex'}],[g,'card.create',{title:'Forbidden Governor',group:'B',managementRole:'governor'}],[e,'card.avatar',{id:employee.id,avatar:'codex'}]])assert.equal((await request(auth,cmd,args)).ok,false)
 await rpc(g,'card.avatar',{id:outside.id,character:'韦伯',avatarStyle:'chibi'})
 await rpc(null,'avatar.update',{id:'fate-saber-anime',enabled:true})
 const lead=await rpc(g,'card.create',{title:'Cross Team Manager',group:'B',managementRole:'manager',character:'Saber',avatarStyle:'anime',profession:'团队管理',engine:'codex',model:'gpt-6-luna',effort:'low'});await f.ready(lead.id);assert.equal(lead.avatar,'fate-saber-anime');assert.equal(lead.managementRole,'manager')
 const topology=await rpc(g,'management.topology');assert.equal(topology.nodes.find(c=>c.id===outside.id).avatar,'fate-waver-chibi')
 // Availability is independent of assigned identities and may change while clients stay open.
 const secretary=await create('Catalog Secretary','A','secretary'),sec=await token(secretary.id)
 const catalogItem=await rpc(e,'avatar.get',{id:'fate-rin-anime'});assert.equal(catalogItem.enabled,true);assert.ok(catalogItem.usageCount>=1)
 assert.equal((await request(m,'avatar.update',{id:catalogItem.id,enabled:false})).ok,false)
 assert.equal((await request(e,'avatar.update',{id:catalogItem.id,enabled:false})).ok,false)
 const identities=JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'))).sessions
 const archived=await rpc(sec,'avatar.update',{id:catalogItem.id,enabled:false,expectedRevision:catalogItem.revision});assert.equal(archived.status,'archived');assert.equal(archived.displayId,'fate-rin-chibi');assert.equal(archived.usageCount,0);assert.equal(archived.inUse,false);assert.ok(archived.assignedCount>=1)
 assert.equal((await request(sec,'avatar.update',{id:catalogItem.id,enabled:true,expectedRevision:catalogItem.revision})).ok,false)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'))).sessions,identities)
 assert.equal((await rpc(e,'avatar.list',{status:'archived'})).some(item=>item.id===catalogItem.id),true)
 assert.equal((await request(m,'card.avatar',{id:hero.id,avatar:catalogItem.id})).ok,false)
 await rpc(sec,'avatar.update',{id:catalogItem.id,enabled:true,expectedRevision:archived.revision})
 const noChange=await rpc(sec,'avatar.get',{id:catalogItem.id}),same=await rpc(sec,'avatar.update',{id:catalogItem.id,enabled:true,expectedRevision:noChange.revision});assert.equal(same.revision,noChange.revision)
 assert.match((await rpc(e,'api.docs',{document:'core/avatars'})).markdown,/random.*enabled/s)
 assert.equal((await rpc(e,'api.describe',{command:'avatar.get'})).readOnly,true)
 // Reduce the pool through the actual API and prove omitted choices use it, never retired defaults.
 for(const item of await rpc(null,'avatar.list'))if(item.id!=='fate-saber-chibi')await rpc(null,'avatar.update',{id:item.id,enabled:false})
 const random=await rpc(m,'card.create',{title:'Default appearance','group':'A',engine:'codex'});assert.equal(random.avatar,'fate-saber-chibi');await f.ready(random.id)
 assert.equal((await rpc(m,'card.avatar',{id:hero.id})).avatar,'fate-saber-chibi')
 assert.equal((await request(null,'avatar.update',{id:'fate-saber-chibi',enabled:false})).ok,false)
 assert.equal((await rpc(e,'avatar.list')).length,1)
 await f.stop();await f.start();assert.deepEqual((await rpc(e,'avatar.list')).map(x=>x.id),['fate-saber-chibi'])
 const omittedStyle=await rpc(m,'card.create',{title:'Character name only',group:'A',character:'Saber',engine:'codex'});assert.equal(omittedStyle.avatar,'fate-saber-chibi')
 console.log('PASS '+created+' Manager/Governor creations covering every picker appearance; named/style CLI parameters, readback, explicit errors with no workspace side effects, scoped appearance repair, live enable/archive with role and revision boundaries, persisted availability and current-pool random defaults; no paid model calls')
}finally{await f.close()}
