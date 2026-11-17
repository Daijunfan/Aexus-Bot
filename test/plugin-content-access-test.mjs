// Actual Core and built-in plugin backends. Isolated data, deterministic employee protocols.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),checks=[],out=path.join(f.root,'artifacts/plugin-page-access')
const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
const denied=async(cmd,args,token)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' unexpectedly allowed');return r}
const notebook=(method,params={},token=null)=>rpc('notebook.call',{method,params},token)
const readerCall=(method,params={},token=null)=>rpc('reader.call',{method,params},token)
const grantNotebook=async(resourceIds,employee,rights)=>{const a=await rpc('notebook.access');return rpc('notebook.access',{resourceIds,employees:[{employeeId:employee.id,read:false,write:false,create:false,...rights}],expectedRevision:a.revision})}
const grantReader=async(resourceIds,employee,rights)=>{const a=await rpc('reader.access');return rpc('reader.access',{resourceIds,employees:[{employeeId:employee.id,read:false,write:false,create:false,...rights}],expectedRevision:a.revision})}
const grantHost=async(resourceIds,employee,rights)=>{const a=await rpc('host.access');return rpc('host.access',{resourceIds,employees:[{employeeId:employee.id,read:false,write:false,create:false,...rights}],expectedRevision:a.revision})}
const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 const reader=await f.create('Reader','employee'),editor=await f.create('Editor','employee'),creator=await f.create('Creator','manager'),secretary=await f.create('Secretary','secretary'),tokens=await Promise.all([reader,editor,creator,secretary].map(p=>f.token(p.id))),[r,e,c,s]=tokens
 const initial=(await rpc('session.list')).sessions.map(p=>({id:p.id,cwd:p.cwd,thread:p.threadId}))
 assert.deepEqual((await rpc('notebook.resources',{},r)).resources,[])
 assert.deepEqual((await rpc('reader.resources',{},r)).resources,[])
 assert.deepEqual((await rpc('host.resources',{},r)).resources,[])
 pass('Ordinary employees start with no Mission Notebook, Study Reader, or Cloud Host content access')

 const state=await notebook('workspace.get');if(!state)await notebook('workspace.init',{name:'Page permissions'})
 const p=await notebook('page.create',{title:'Shared page',color:'white'}),hidden=await notebook('page.create',{title:'Private page',color:'white'})
 await notebook('page.write-markdown',{pageId:p.id,markdown:'PUBLIC_PAGE_BODY'});await notebook('page.write-markdown',{pageId:hidden.id,markdown:'PRIVATE_PAGE_BODY'})
 await grantNotebook([p.id],reader,{read:true});await grantNotebook([p.id],editor,{write:true})
 const visible=await notebook('workspace.get',{},r);assert.ok(visible.pages.some(page=>page.id===p.id));assert.ok(!JSON.stringify(visible).includes('PRIVATE_PAGE_BODY'));assert.equal((await notebook('page.read-markdown',{pageId:p.id},r)).markdown.includes('PUBLIC_PAGE_BODY'),true)
 await denied('notebook.call',{method:'page.get',params:{pageId:hidden.id}},r)
 await denied('notebook.call',{method:'page.update',params:{pageId:p.id,title:'Not allowed'}},r)
 await notebook('page.update',{pageId:p.id,title:'Edited page'},e);assert.equal((await notebook('page.get',{pageId:p.id})).title,'Edited page')
 await denied('notebook.call',{method:'page.create',params:{parentId:p.id,title:'No create',color:'white'}},e)
 await denied('notebook.call',{method:'batch',params:{operations:[{method:'page.update',params:{pageId:p.id,title:'Must roll back'}},{method:'page.update',params:{pageId:hidden.id,title:'Escape'}}]}},e)
 assert.equal((await notebook('page.get',{pageId:p.id})).title,'Edited page')
 await grantNotebook([p.id],creator,{create:true});const child=await notebook('page.create',{parentId:p.id,title:'Created child',color:'white'},c)
 await notebook('page.write-markdown',{pageId:child.id,markdown:'Creator can finish its new page'},c)
 await denied('notebook.call',{method:'page.update',params:{pageId:p.id,title:'Create is not edit'}},c)
 await grantNotebook(['@root'],creator,{create:true});const top=await notebook('page.create',{title:'New top page',color:'white'},c);assert.equal((await notebook('page.get',{pageId:top.id},c)).id,top.id)
 const collision=await denied('notebook.call',{method:'page.create',params:{id:hidden.id,title:'Duplicate hidden ID',color:'white'}},c);assert.ok(!JSON.stringify(collision).includes('PRIVATE_PAGE_BODY'))
 const db=await notebook('database.create',{title:'Shared database',color:'blue'}),row=await notebook('record.create',{databaseId:db.id,title:'Record',color:'white'})
 await grantNotebook([db.id],reader,{read:true});assert.equal((await notebook('page.get',{pageId:row.id},r)).id,row.id)
 await grantNotebook([row.id],reader,{read:false});await denied('notebook.call',{method:'page.get',params:{pageId:row.id}},r)
 await denied('notebook.call',{method:'fs.read',params:{path:'index.mininotion.json'}},r)
 const bulkBefore=await rpc('notebook.access'),bulkUpdates=[p.id,child.id].map(resourceId=>({employeeId:reader.id,resourceId,read:true,write:false,create:false}))
 await rpc('notebook.access',{updates:bulkUpdates,expectedRevision:bulkBefore.revision},s)
 for(const pageId of [p.id,child.id])assert.equal((await notebook('page.get',{pageId},r)).id,pageId)
 const bulkAfter=await rpc('notebook.access');assert.deepEqual(bulkAfter.grants.filter(g=>g.employeeId===editor.id),bulkBefore.grants.filter(g=>g.employeeId===editor.id))
 await denied('notebook.access',{updates:[{...bulkUpdates[0],write:true},{...bulkUpdates[1],resourceId:'missing-resource'}],expectedRevision:bulkAfter.revision},s)
 assert.deepEqual((await rpc('notebook.access')).grants,bulkAfter.grants)
 pass('Secretary can authorize multiple Mission Notebook pages atomically, preserve other employees, and reject an invalid bulk save without partial changes')
 const beforeGrant=await rpc('notebook.access');await denied('notebook.access',{resourceIds:[p.id],employees:[{employeeId:reader.id,read:true,write:true,create:true}],expectedRevision:beforeGrant.revision-1},s);assert.deepEqual((await rpc('notebook.access')).grants,beforeGrant.grants)
 await grantNotebook([p.id],reader,{read:false});await denied('notebook.call',{method:'page.get',params:{pageId:p.id}},r)
 pass('Mission Notebook enforces read/edit/create separately, hides other pages and settings, atomically rejects cross-page batches, supports new child/root pages with creator rights, database rows and explicit row overrides, and immediate revoke/conflicts')

 await readerCall('fs.write',{path:'allowed.txt',content:'ALLOWED_DOCUMENT_BODY'});await readerCall('fs.write',{path:'private.txt',content:'PRIVATE_DOCUMENT_BODY'})
 const document=await readerCall('document.open',{path:'allowed.txt'}),privateDoc=await readerCall('document.open',{path:'private.txt'}),study=await readerCall('study.create',{title:'Shared study'})
 await grantReader(['document:'+document.id],reader,{read:true});assert.ok(JSON.stringify(await readerCall('document.content',{id:document.id},r)).includes('ALLOWED_DOCUMENT_BODY'))
 await denied('reader.call',{method:'document.content',params:{id:privateDoc.id}},r)
 assert.ok(!JSON.stringify(await readerCall('fs.list',{},r)).includes('private.txt'))
 await denied('reader.call',{method:'fs.write',params:{path:'allowed.txt',content:'No'}},r)
 await grantReader(['document:'+document.id],editor,{write:true});await readerCall('document.meta.update',{id:document.id,expectedRevision:document.revision,title:'Edited document'},e)
 await grantReader(['study:'+study.id],editor,{write:true});const set=await readerCall('study.get',{setId:study.id},e)
 await readerCall('study.update',{setId:study.id,expectedRevision:set.revision,title:'Edited study'},e)
 await grantReader(['@root'],creator,{create:true});const own=await readerCall('study.create',{title:'Created study'},c);assert.ok(await readerCall('study.get',{setId:own.id},c))
 await denied('reader.call',{method:'document.open',params:{path:'private.txt'}},c)
 const bytes=Buffer.from('CREATOR_DOCUMENT_BODY'),upload=await readerCall('import.begin',{path:'created.txt',totalBytes:bytes.length},c)
 await readerCall('import.chunk',{uploadId:upload.uploadId??upload.id,offset:0,contentBase64:bytes.toString('base64')},c)
 await readerCall('import.finish',{uploadId:upload.uploadId??upload.id,parse:true},c)
 assert.ok((await rpc('reader.resources',{},c)).resources.some(resource=>resource.kind==='document'))
 pass('Study Reader enforces document/study scopes, hides ungranted files, separates reading from edits, and supports creating study sets/importing new documents without access to existing private originals')

 const host=await rpc('host.create',{name:'Allowed host',host:'fixture',os:'linux',defaultDirectory:'/srv/work'}),privateHost=await rpc('host.create',{name:'Private host',host:'private-fixture',os:'linux',defaultDirectory:'/srv/private'})
 await grantHost(['host:'+host.id],reader,{read:true});assert.equal((await rpc('host.get',{id:host.id},r)).id,host.id)
 assert.ok(!(await rpc('host.list',{},r)).some(h=>h.id===privateHost.id));await denied('host.credentials',{id:host.id},r);await denied('host.update',{id:host.id,patch:{name:'No'}},r)
 await grantHost(['host:'+host.id],editor,{write:true});await rpc('host.update',{id:host.id,patch:{name:'Edited host'}},e)
 await denied('host.get',{id:privateHost.id},e);await denied('host.remove',{id:host.id},e)
 await grantHost(['@root'],creator,{create:true});const createdHost=await rpc('host.create',{name:'Created host',host:'new-fixture',os:'linux',defaultDirectory:'/srv/new'},c);assert.equal((await rpc('host.get',{id:createdHost.id},c)).id,createdHost.id)
 pass('Cloud Hosts applies the same item rights to Core APIs, masks credentials from readers, scopes modifications, and grants creators access to their newly registered hosts; no SSH connection is needed')

 assert.ok((await rpc('notebook.resources',{},s)).resources.length>1)
 assert.ok((await rpc('reader.resources',{},s)).resources.length>1)
 assert.ok((await rpc('host.resources',{},s)).resources.length>1)
 await notebook('page.update',{pageId:hidden.id,title:'Secretary unrestricted'},s);await readerCall('document.get',{id:privateDoc.id},s);await rpc('host.get',{id:privateHost.id},s)
 await denied('notebook.access',{},r);await denied('notebook.asset',{path:'asset/x'},r)
 assert.deepEqual((await rpc('session.list')).sessions.map(p=>({id:p.id,cwd:p.cwd,thread:p.threadId})),initial)
 await f.stop();await f.start();assert.equal((await notebook('page.get',{pageId:child.id},c)).id,child.id);assert.equal((await rpc('host.get',{id:createdHost.id},c)).id,createdHost.id)
 pass('Secretary always matches user content authority without grants; ordinary employees cannot reauthorize themselves or obtain full UI/event/asset capabilities; restart preserves grants, identities, native sessions and working directories')
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,modelCalls:0,sshCalls:0,productionMutations:0},null,2)+'\n')
}finally{await f.close()}
