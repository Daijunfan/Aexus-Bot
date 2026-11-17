// Library Core tests: legacy MarginReader / CloudHosts migration, decoupled Mac-local direct storage, 7-domain overview, 6-domain search & ACL enforcement. Disposable Core; 0 billed model calls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'

let f
try{
  f=await fixtureCore()
  const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
  const deny=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' must reject');return r}

  const a=await f.create('Reader Alpha','employee')
  const b=await f.create('Reader Beta','employee')
  const secretary=await f.create('Chief Secretary','secretary')

  // 1. Auto-migration of legacy MarginReader workspace & plugin-access grants
  await f.stop()
  const readerRoot=path.join(f.env.AGENTS_COMPANY_HOME,'library-reader')
  const legacyReaderDir=path.join(f.env.AGENTS_COMPANY_HOME,'workspaces','margin-reader-workspace','default')
  fs.rmSync(readerRoot,{recursive:true,force:true})
  fs.rmSync(path.join(f.env.AGENTS_COMPANY_HOME,'library-reader-access.json'),{force:true})
  fs.rmSync(path.join(f.env.AGENTS_COMPANY_HOME,'host-access.json'),{force:true})
  fs.mkdirSync(legacyReaderDir,{recursive:true})
  fs.writeFileSync(path.join(legacyReaderDir,'MigratedGuide.md'),'# Migrated Study Guide\n\nMIGRATED_READER_TOKEN')
  fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'plugin-access.json'),JSON.stringify({
    '/legacy/margin-reader':{
      plugin:'margin-reader',
      workspace:'/legacy/workspaces/margin-reader-workspace/default',
      revision:3,
      grants:[{employeeId:a.id,resourceId:'@root',read:true,write:false,create:true}],
    },
    'cloud-hosts':{
      plugin:'cloud-hosts',
      revision:2,
      grants:[{employeeId:a.id,resourceId:'@root',read:false,write:false,create:true}],
    },
  }))

  await f.start()
  const at=await f.token(a.id),bt=await f.token(b.id),st=await f.token(secretary.id)

  const readerSt=await rpc('reader.status')
  assert.equal(path.basename(readerSt.root),'library-reader')
  assert.ok(fs.existsSync(path.join(readerSt.root,'MigratedGuide.md')),'Migrated Study Reader file must exist')
  assert.match(fs.readFileSync(path.join(readerSt.root,'MigratedGuide.md'),'utf8'),/MIGRATED_READER_TOKEN/)

  const readerAcl=await rpc('reader.access')
  assert.ok(fs.existsSync(path.join(f.env.AGENTS_COMPANY_HOME,'library-reader-access.json')),'library-reader-access.json must be written')
  assert.ok(readerAcl.grants.some(g=>g.employeeId===a.id&&g.resourceId==='@root'&&g.read&&g.create),'migrated reader grant preserved')

  const hostAcl=await rpc('host.access')
  assert.ok(fs.existsSync(path.join(f.env.AGENTS_COMPANY_HOME,'host-access.json')),'host-access.json must be written')
  assert.ok(hostAcl.grants.some(g=>g.employeeId===a.id&&g.resourceId==='@root'&&g.create),'migrated host grant preserved')
  console.log('PASS legacy MarginReader + CloudHosts storage and ACL migration preserved grants')

  // 2. Decoupled Mac-local private chat storage
  fs.writeFileSync(path.join(a.cwd,'workspace-keep.md'),'AGENT_WORKSPACE_STAY_INTACT')
  fs.writeFileSync(path.join(a.cwd,'DirectNote.txt'),'DIRECT_CHAT_ATTACHMENT_BYTES')
  const posted=await rpc('direct.post',{text:'PRIVATE_STORAGE_MSG_TOKEN',files:['DirectNote.txt'],clientMessageId:'lib-core-direct-1'},at)
  assert.equal(posted.sent,true)

  const dFiles=await rpc('direct.files',{employee:a.id})
  assert.equal(dFiles.storageLocation,'mac-local')
  assert.equal(dFiles.workspaceDecoupled,true)
  assert.equal(dFiles.total,1)

  const dStorage=await rpc('direct.storage',{employee:a.id})
  assert.equal(dStorage.storageLocation,'mac-local')
  assert.equal(dStorage.workspaceDecoupled,true)
  assert.equal(dStorage.messageCount,1)
  assert.equal(dStorage.fileCount,1)

  const cleared=await rpc('direct.clear',{employee:a.id,scope:'all'})
  assert.equal(cleared.cleared,true)
  assert.equal(cleared.workspaceUntouched,true)
  assert.equal(fs.readFileSync(path.join(a.cwd,'workspace-keep.md'),'utf8'),'AGENT_WORKSPACE_STAY_INTACT')
  assert.equal(fs.readFileSync(path.join(a.cwd,'DirectNote.txt'),'utf8'),'DIRECT_CHAT_ATTACHMENT_BYTES')
  assert.equal((await rpc('direct.storage',{employee:a.id})).messageCount,0)
  console.log('PASS direct private chat storage is Mac-local and completely decoupled from agent cwd')

  // 3. Seed Study Set, Mission Notebook page, Shared file & Cloud Host (0 SSH probes)
  const studySet=await rpc('reader.call',{method:'study.create',params:{title:'Core Research Graph',description:'CORE_STUDY_SEARCH_TOKEN'}})
  assert.ok(studySet.id)
  const indexed=await rpc('reader.call',{method:'library.index',params:{}})
  assert.ok(indexed.total>=1)

  const nbPage=await rpc('notebook.call',{method:'page.create',params:{title:'Core Architecture Memo',color:'white'}})
  await rpc('notebook.call',{method:'page.write-markdown',params:{pageId:nbPage.id,markdown:'# Core Memo\n\nUNIFIED_NOTEBOOK_SEARCH_TOKEN'}})

  fs.mkdirSync(f.env.AGENTS_COMPANY_SHARED_DIR,{recursive:true})
  fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_SHARED_DIR,'SharedSpec.md'),'# Shared Spec\n\nSHARED_SPEC_CONTENT_TOKEN')

  const host=await rpc('host.create',{
    name:'Prod Linux',
    os:'linux',
    distribution:'ubuntu',
    host:'10.0.0.42',
    port:22,
    username:'ops',
    defaultDirectory:'/srv/app',
    notes:'PROD_HOST_SEARCH_TOKEN',
  })
  assert.equal(host.status,undefined,'Creating host must not trigger auto SSH probe')
  const listedHosts=await rpc('host.list')
  assert.equal(listedHosts.length,1)
  assert.equal(listedHosts[0].status,undefined)

  // 4. 7-domain library.overview & 6-domain library.search
  const overview=await rpc('library.overview')
  const domainIds=new Set(overview.domains.map(d=>d.id))
  for(const expected of ['employees','privateChats','groupsAndChannels','reader','notebook','shared','hosts']){
    assert.ok(domainIds.has(expected),'missing overview domain: '+expected)
  }
  assert.equal(overview.domains.length,7)
  assert.ok(overview.reader.studySetCount>=1)
  assert.ok(overview.notebook.pageCount>=1)
  assert.equal(overview.hosts.total,1)

  const searchNb=await rpc('library.search',{query:'UNIFIED_NOTEBOOK_SEARCH_TOKEN'})
  assert.ok(searchNb.items.some(i=>i.domain==='notebook'&&i.pageId===nbPage.id),'notebook hit with pageId missing')
  const searchStudy=await rpc('library.search',{query:'Core Research Graph'})
  assert.ok(searchStudy.items.some(i=>i.domain==='reader'&&i.studySetId===studySet.id),'study set hit missing')
  const searchGuide=await rpc('library.search',{query:'MigratedGuide'})
  assert.ok(searchGuide.items.some(i=>i.domain==='reader'),'reader document hit missing')
  const searchShared=await rpc('library.search',{query:'SHARED_SPEC_CONTENT_TOKEN'})
  assert.ok(searchShared.items.some(i=>i.domain==='content'||i.domain==='files'),'shared content hit missing')
  const searchHost=await rpc('library.search',{query:'Prod Linux'})
  assert.ok(searchHost.items.some(i=>i.domain==='hosts'&&i.hostId===host.id),'host hit missing')
  console.log('PASS 7-domain library.overview and 6-domain library.search return accurate hits without SSH probes')

  // 5. ACL enforcement for Study Reader & Cloud Hosts
  await deny('library.overview',{},at)
  await deny('library.search',{query:'Core'},at)
  await deny('reader.access',{},at)
  await deny('host.access',{},at)
  await deny('reader.call',{method:'study.create',params:{title:'Denied Study'}},bt)
  await deny('host.get',{id:host.id},bt)

  // Secretary has automatic access
  const secSet=await rpc('reader.call',{method:'study.create',params:{title:'Secretary Study'}},st)
  assert.ok(secSet.id)
  const secHost=await rpc('host.get',{id:host.id},st)
  assert.equal(secHost.id,host.id)

  // Grant b access via reader.access and host.access
  const rAcl=await rpc('reader.access')
  await rpc('reader.access',{
    resourceIds:['@root'],
    employees:[{employeeId:b.id,read:false,write:false,create:true}],
    expectedRevision:rAcl.revision,
  })
  const grantedSet=await rpc('reader.call',{method:'study.create',params:{title:'Granted Beta Study'}},bt)
  assert.ok(grantedSet.id)

  const hAcl=await rpc('host.access')
  await rpc('host.access',{
    resourceIds:[`host:${host.id}`],
    employees:[{employeeId:b.id,read:true,write:false,create:false}],
    expectedRevision:hAcl.revision,
  })
  const bHost=await rpc('host.get',{id:host.id},bt)
  assert.equal(bHost.id,host.id)
  console.log('PASS Study Reader and Cloud Hosts ACLs enforce employee denial/allow, user-only boundaries, and Secretary auto-access')
}finally{
  await f?.close()
}
