// Actual Core and built-in plugin backends. Isolated data, deterministic employee protocols.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),checks=[],out=path.join(f.root,'artifacts/plugin-page-access')
const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
const denied=async(cmd,args,token)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' unexpectedly allowed');return r}
const plugin=(id,method,params={},token=null)=>rpc('plugin.call',{id,method,params},token)
const grant=async(id,resourceIds,employee,rights)=>{const a=await rpc('plugin.access',{id});return rpc('plugin.access',{id,resourceIds,employees:[{employeeId:employee.id,read:false,write:false,create:false,...rights}],expectedRevision:a.revision})}
const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await rpc('group.add',{name:'Independent teams'});const reader=await f.create('Reader','Independent teams'),editor=await f.create('Editor','Independent teams'),creator=await f.create('Creator','Independent teams','manager'),secretary=await f.create('Secretary','Independent teams','secretary'),tokens=await Promise.all([reader,editor,creator,secretary].map(p=>f.token(p.id))),[r,e,c,s]=tokens
 const initial=(await rpc('session.list')).sessions.map(p=>({id:p.id,cwd:p.cwd,thread:p.threadId}))
 await denied('group.add',{name:'No plugin Team',mode:'work',pluginId:'mininotion'},null)
 await denied('group.configure',{name:'Independent teams',mode:'work',pluginId:'mininotion'},null)
 for(const id of ['mininotion','margin-reader','cloud-hosts'])assert.deepEqual((await rpc('plugin.resources',{id},r)).resources,[])
 pass('New teams do not bind plugins; ordinary employees in a normal local team start with no plugin content access')

 const state=await plugin('mininotion','workspace.get');if(!state)await plugin('mininotion','workspace.init',{name:'Page permissions'})
 const p=await plugin('mininotion','page.create',{title:'Shared page',color:'white'}),hidden=await plugin('mininotion','page.create',{title:'Private page',color:'white'})
 await plugin('mininotion','page.write-markdown',{pageId:p.id,markdown:'PUBLIC_PAGE_BODY'});await plugin('mininotion','page.write-markdown',{pageId:hidden.id,markdown:'PRIVATE_PAGE_BODY'})
 await grant('mininotion',[p.id],reader,{read:true});await grant('mininotion',[p.id],editor,{write:true})
 const visible=await plugin('mininotion','workspace.get',{},r);assert.ok(visible.pages.some(page=>page.id===p.id));assert.ok(!JSON.stringify(visible).includes('PRIVATE_PAGE_BODY'));assert.equal((await plugin('mininotion','page.read-markdown',{pageId:p.id},r)).markdown.includes('PUBLIC_PAGE_BODY'),true)
 await denied('plugin.call',{id:'mininotion',method:'page.get',params:{pageId:hidden.id}},r)
 await denied('plugin.call',{id:'mininotion',method:'page.update',params:{pageId:p.id,title:'Not allowed'}},r)
 await plugin('mininotion','page.update',{pageId:p.id,title:'Edited page'},e);assert.equal((await plugin('mininotion','page.get',{pageId:p.id})).title,'Edited page')
 await denied('plugin.call',{id:'mininotion',method:'page.create',params:{parentId:p.id,title:'No create',color:'white'}},e)
 await denied('plugin.call',{id:'mininotion',method:'batch',params:{operations:[{method:'page.update',params:{pageId:p.id,title:'Must roll back'}},{method:'page.update',params:{pageId:hidden.id,title:'Escape'}}]}},e)
 assert.equal((await plugin('mininotion','page.get',{pageId:p.id})).title,'Edited page')
 await grant('mininotion',[p.id],creator,{create:true});const child=await plugin('mininotion','page.create',{parentId:p.id,title:'Created child',color:'white'},c)
 await plugin('mininotion','page.write-markdown',{pageId:child.id,markdown:'Creator can finish its new page'},c)
 await denied('plugin.call',{id:'mininotion',method:'page.update',params:{pageId:p.id,title:'Create is not edit'}},c)
 await grant('mininotion',['@root'],creator,{create:true});const top=await plugin('mininotion','page.create',{title:'New top page',color:'white'},c);assert.equal((await plugin('mininotion','page.get',{pageId:top.id},c)).id,top.id)
 const collision=await denied('plugin.call',{id:'mininotion',method:'page.create',params:{id:hidden.id,title:'Duplicate hidden ID',color:'white'}},c);assert.ok(!JSON.stringify(collision).includes('PRIVATE_PAGE_BODY'))
 const db=await plugin('mininotion','database.create',{title:'Shared database',color:'blue'}),row=await plugin('mininotion','record.create',{databaseId:db.id,title:'Record',color:'white'})
 await grant('mininotion',[db.id],reader,{read:true});assert.equal((await plugin('mininotion','page.get',{pageId:row.id},r)).id,row.id)
 await grant('mininotion',[row.id],reader,{read:false});await denied('plugin.call',{id:'mininotion',method:'page.get',params:{pageId:row.id}},r)
 await denied('plugin.call',{id:'mininotion',method:'fs.read',params:{path:'index.mininotion.json'}},r)
 const bulkBefore=await rpc('plugin.access',{id:'mininotion'}),bulkUpdates=[p.id,child.id].map(resourceId=>({employeeId:reader.id,resourceId,read:true,write:false,create:false}))
 await rpc('plugin.access',{id:'mininotion',updates:bulkUpdates,expectedRevision:bulkBefore.revision},s)
 for(const pageId of [p.id,child.id])assert.equal((await plugin('mininotion','page.get',{pageId},r)).id,pageId)
 const bulkAfter=await rpc('plugin.access',{id:'mininotion'});assert.deepEqual(bulkAfter.grants.filter(g=>g.employeeId===editor.id),bulkBefore.grants.filter(g=>g.employeeId===editor.id))
 await denied('plugin.access',{id:'mininotion',updates:[{...bulkUpdates[0],write:true},{...bulkUpdates[1],resourceId:'missing-resource'}],expectedRevision:bulkAfter.revision},s)
 assert.deepEqual((await rpc('plugin.access',{id:'mininotion'})).grants,bulkAfter.grants)
 pass('Secretary can authorize multiple pages atomically, preserve other employees, and reject an invalid bulk save without partial changes')
 const beforeGrant=await rpc('plugin.access',{id:'mininotion'});await denied('plugin.access',{id:'mininotion',resourceIds:[p.id],employees:[{employeeId:reader.id,read:true,write:true,create:true}],expectedRevision:beforeGrant.revision-1},s);assert.deepEqual((await rpc('plugin.access',{id:'mininotion'})).grants,beforeGrant.grants)
 await grant('mininotion',[p.id],reader,{read:false});await denied('plugin.call',{id:'mininotion',method:'page.get',params:{pageId:p.id}},r)
 pass('MiniNotion enforces read/edit/create separately, hides other pages and engine settings, atomically rejects cross-page batches, supports new child/root pages with creator rights, database rows and explicit row overrides, and immediate revoke/conflicts')

 await plugin('margin-reader','fs.write',{path:'allowed.txt',content:'ALLOWED_DOCUMENT_BODY'});await plugin('margin-reader','fs.write',{path:'private.txt',content:'PRIVATE_DOCUMENT_BODY'})
 const document=await plugin('margin-reader','document.open',{path:'allowed.txt'}),privateDoc=await plugin('margin-reader','document.open',{path:'private.txt'}),study=await plugin('margin-reader','study.create',{title:'Shared study'})
 await grant('margin-reader',['document:'+document.id],reader,{read:true});assert.ok(JSON.stringify(await plugin('margin-reader','document.content',{id:document.id},r)).includes('ALLOWED_DOCUMENT_BODY'))
 await denied('plugin.call',{id:'margin-reader',method:'document.content',params:{id:privateDoc.id}},r)
 assert.ok(!JSON.stringify(await plugin('margin-reader','fs.list',{},r)).includes('private.txt'))
 await denied('plugin.call',{id:'margin-reader',method:'fs.write',params:{path:'allowed.txt',content:'No'}},r)
 await grant('margin-reader',['document:'+document.id],editor,{write:true});await plugin('margin-reader','document.meta.update',{id:document.id,expectedRevision:document.revision,title:'Edited document'},e)
 await grant('margin-reader',['study:'+study.id],editor,{write:true});const set=await plugin('margin-reader','study.get',{setId:study.id},e)
 await plugin('margin-reader','study.update',{setId:study.id,expectedRevision:set.revision,title:'Edited study'},e)
 await grant('margin-reader',['@root'],creator,{create:true});const own=await plugin('margin-reader','study.create',{title:'Created study'},c);assert.ok(await plugin('margin-reader','study.get',{setId:own.id},c))
 await denied('plugin.call',{id:'margin-reader',method:'document.open',params:{path:'private.txt'}},c)
 const bytes=Buffer.from('CREATOR_DOCUMENT_BODY'),upload=await plugin('margin-reader','import.begin',{path:'created.txt',totalBytes:bytes.length},c)
 await plugin('margin-reader','import.chunk',{uploadId:upload.uploadId??upload.id,offset:0,contentBase64:bytes.toString('base64')},c)
 await plugin('margin-reader','import.finish',{uploadId:upload.uploadId??upload.id,parse:true},c)
 assert.ok((await rpc('plugin.resources',{id:'margin-reader'},c)).resources.some(resource=>resource.kind==='document'))
 pass('Margin Reader enforces document/study scopes, hides ungranted files, separates reading from edits, and supports creating study sets/importing new documents without access to existing private originals')

 const host=await rpc('host.create',{name:'Allowed host',host:'fixture',os:'linux',defaultDirectory:'/srv/work'}),privateHost=await rpc('host.create',{name:'Private host',host:'private-fixture',os:'linux',defaultDirectory:'/srv/private'})
 await grant('cloud-hosts',['host:'+host.id],reader,{read:true});assert.equal((await plugin('cloud-hosts','hosts.get',{id:host.id},r)).id,host.id)
 assert.ok(!(await plugin('cloud-hosts','hosts.list',{},r)).some(h=>h.id===privateHost.id));await denied('host.credentials',{id:host.id},r);await denied('host.update',{id:host.id,patch:{name:'No'}},r)
 await grant('cloud-hosts',['host:'+host.id],editor,{write:true});await plugin('cloud-hosts','hosts.update',{id:host.id,patch:{name:'Edited host'}},e)
 await denied('host.get',{id:privateHost.id},e);await denied('host.remove',{id:host.id},e)
 await grant('cloud-hosts',['@root'],creator,{create:true});const createdHost=await rpc('host.create',{name:'Created host',host:'new-fixture',os:'linux',defaultDirectory:'/srv/new'},c);assert.equal((await rpc('host.get',{id:createdHost.id},c)).id,createdHost.id)
 pass('Cloud Hosts applies the same item rights to plugin and direct Core APIs, masks credentials from readers, scopes modifications, and grants creators access to their newly registered hosts; no SSH connection is needed')

 for(const id of ['mininotion','margin-reader','cloud-hosts'])assert.ok((await rpc('plugin.resources',{id},s)).resources.length>1)
 await plugin('mininotion','page.update',{pageId:hidden.id,title:'Secretary unrestricted'},s);await plugin('margin-reader','document.get',{id:privateDoc.id},s);await rpc('host.get',{id:privateHost.id},s)
 await denied('plugin.access',{id:'mininotion'},r);await denied('plugin.view',{id:'mininotion'},r)
 assert.deepEqual((await rpc('session.list')).sessions.map(p=>({id:p.id,cwd:p.cwd,thread:p.threadId})),initial)
 await f.stop();await f.start();assert.equal((await plugin('mininotion','page.get',{pageId:child.id},c)).id,child.id);assert.equal((await rpc('host.get',{id:createdHost.id},c)).id,createdHost.id)
 pass('Secretary always matches user content authority without grants; ordinary employees cannot reauthorize themselves or obtain full UI/event/asset capabilities; restart preserves grants, identities, native sessions and working directories')
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,modelCalls:0,sshCalls:0,productionMutations:0},null,2)+'\n')
}finally{await f.close()}
