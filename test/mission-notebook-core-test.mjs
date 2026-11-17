// Mission Super-Notion Notebook Core, legacy migration, ACL & workflow orchestration tests; disposable Core & deterministic fixture only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore()
const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
const denied=async(cmd,args,token=null)=>{const r=await f.request(token,cmd,args);assert.equal(r.ok,false,cmd+' should have been denied');return r}
const notebook=(method,params={},token=null)=>rpc('notebook.call',{method,params},token)

try{
  // 1. Verify MiniNotion, MarginReader, and CloudHosts plugins are gone & create employees before legacy seeding test
  const plugins=await rpc('plugin.list')
  assert.deepEqual(plugins,[],'Retired built-in plugins removed cleanly')
  for(const removed of ['mininotion','margin-reader','cloud-hosts'])assert.equal((await f.request(null,'plugin.describe',{id:removed})).ok,false)

  const reader=await f.create('Reader','employee')
  const worker=await rpc('card.create',{title:'WorkflowBot',folderName:'workflow-bot',engine:'codex',model:'gpt-6-luna',effort:'low'})
  await f.ready(worker.id)
  const secretary=await f.create('ChiefSecretary','secretary')

  // 2. Seed legacy ~/workspaces/mini-notion-workspace + plugin-access.json and verify automatic migration on startup
  await f.stop()
  const notebookRoot=path.join(f.env.AGENTS_COMPANY_HOME,'mission-notebook')
  const legacyRoot=path.join(f.env.AGENTS_COMPANY_HOME,'workspaces','mini-notion-workspace')
  const legacyPageDir=path.join(legacyRoot,'Legacy Main')
  fs.rmSync(notebookRoot,{recursive:true,force:true})
  fs.mkdirSync(path.join(legacyRoot,'.agents-company'),{recursive:true})
  fs.writeFileSync(path.join(legacyRoot,'.agents-company','legacy-import.json'),JSON.stringify({version:1,completed:true}))
  fs.mkdirSync(legacyPageDir,{recursive:true})
  fs.writeFileSync(path.join(legacyPageDir,'index.mininotion.json'),JSON.stringify({
    format:'mininotion.page/v1',
    page:{
      id:'legacy_main',
      title:'Legacy Main',
      parentId:null,
      icon:'📄',
      color:'white',
      blocks:[{id:'b_legacy',type:'paragraph',props:{},content:[{type:'text',text:'LEGACY_MIGRATED_BODY',styles:{}}],children:[]}],
      values:{},
      createdAt:1000,
      updatedAt:1000,
    },
  }))
  fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'plugin-access.json'),JSON.stringify({
    '/legacy/mini-notion-workspace':{
      plugin:'mininotion',
      workspace:'/legacy/mini-notion-workspace',
      revision:4,
      grants:[{employeeId:reader.id,resourceId:'legacy_main',read:true,write:false,create:false}],
    },
  }))

  await f.start()
  const readerToken=await f.token(reader.id),workerToken=await f.token(worker.id),secretaryToken=await f.token(secretary.id)

  const st=await rpc('notebook.status')
  const migratedMd=await notebook('page.read-markdown',{pageId:'legacy_main'},readerToken)
  assert.match(migratedMd.markdown,/LEGACY_MIGRATED_BODY/,'migrated page & reader ACL intact')
  assert.equal(fs.existsSync(notebookRoot),true,'mission-notebook root migrated')
  assert.equal(fs.existsSync(path.join(notebookRoot,'.agents-company')),false,'legacy .agents-company cleaned on migration')
  assert.equal(fs.existsSync(path.join(f.env.AGENTS_COMPANY_HOME,'mission-notebook-access.json')),true,'mission-notebook-access.json migrated')
  console.log('PASS legacy mini-notion-workspace & plugin-access.json migrated cleanly into mission-notebook')

  // 3. Status, Guide, Methods, Page CRUD, 10-layout Database, Formulas & Audit
  assert.equal(path.resolve(st.root),path.resolve(notebookRoot))
  assert.ok(st.pageCount>=1)
  assert.match((await rpc('notebook.guide',{topic:'workflows'})).markdown,/button\.\*/)
  assert.ok((await rpc('notebook.methods',{query:'button'})).commands.some(c=>c.method==='button.create'))

  const mainPage=await notebook('page.create',{title:'Q4 Launch Spec',color:'white'})
  const childPage=await notebook('page.create',{title:'Release Checklist',parentId:mainPage.id,color:'white'})
  await notebook('page.write-markdown',{
    pageId:childPage.id,
    mode:'replace',
    markdown:'## Checklist\n\n| Item | Owner |\n| --- | --- |\n| Build | Core |\n',
  })
  const childMd=await notebook('page.read-markdown',{pageId:childPage.id})
  assert.match(childMd.markdown,/\|\s*Item\s*\|\s*Owner\s*\|/)

  const db=await notebook('database.create',{parentId:mainPage.id,title:'Delivery Tracker',color:'white'})
  const layouts=['table','board','gallery','list','calendar','timeline','chart','feed','form','plan']
  const existingViews=new Set((await notebook('view.list',{databaseId:db.id})).map(v=>v.type))
  for(const layout of layouts){
    if(!existingViews.has(layout))await notebook('view.create',{databaseId:db.id,type:layout,name:'View '+layout})
  }
  const allViews=await notebook('view.list',{databaseId:db.id})
  for(const layout of layouts)assert.ok(allViews.some(v=>v.type===layout),'missing layout '+layout)

  const amountCol=await notebook('property.add',{databaseId:db.id,name:'Amount',type:'number'})
  const doubleCol=await notebook('property.add',{databaseId:db.id,name:'Double',type:'formula',formula:'prop("Amount") * 2'})
  const rec=await notebook('record.create',{databaseId:db.id,title:'Release Candidate',color:'white',values:{[amountCol.id]:21}})
  const records=await notebook('record.list',{databaseId:db.id,viewId:allViews.find(v=>v.type==='table').id})
  const recRow=records.find(r=>r.id===rec.id)
  assert.equal(recRow?.computed?.[doubleCol.id],42,'formula evaluated correctly in record.list computed values')
  const renderedTable=await notebook('view.render',{databaseId:db.id,viewId:allViews.find(v=>v.type==='table').id})
  assert.ok(renderedTable&&JSON.stringify(renderedTable).includes('42'),'formula rendered in view.render')

  const audit=await notebook('fs.audit')
  assert.equal(audit.valid,true,JSON.stringify(audit.errors))
  assert.deepEqual(audit.errors,[])
  const pageAudit=await notebook('page.audit',{pageId:mainPage.id})
  assert.ok(pageAudit.pages.some(p=>p.id===childPage.id))
  console.log('PASS notebook status, guide, methods, markdown, 10-layout database, formula rollup & fs.audit')

  // 4. Per-page ACLs, Secretary automatic rights & atomic bulk updates
  await denied('notebook.call',{method:'page.get',params:{pageId:mainPage.id}},workerToken)
  assert.equal((await notebook('page.get',{pageId:mainPage.id},secretaryToken)).id,mainPage.id)
  const aclBefore=await rpc('notebook.access',{},secretaryToken)
  await denied('notebook.access',{
    updates:[
      {employeeId:worker.id,resourceId:mainPage.id,read:true,write:true,create:false},
      {employeeId:worker.id,resourceId:'nonexistent_resource',read:true,write:false,create:false},
    ],
    expectedRevision:aclBefore.revision,
  },secretaryToken)
  assert.deepEqual((await rpc('notebook.access',{},secretaryToken)).grants,aclBefore.grants,'atomic bulk access rollback')
  await rpc('notebook.access',{
    resourceIds:[mainPage.id],
    employees:[{employeeId:worker.id,read:true,write:false,create:true}],
    expectedRevision:aclBefore.revision,
  },secretaryToken)
  const workerChild=await notebook('page.create',{parentId:mainPage.id,title:'Worker Created Subpage',color:'white'},workerToken)
  assert.equal((await notebook('page.get',{pageId:workerChild.id},workerToken)).title,'Worker Created Subpage')
  console.log('PASS per-page read/create ACLs, Secretary global access, and atomic access rollback')

  // 5. Super-Notion Workflow Button orchestrating Agent (with grantPageAccess), Supervised Mission & Interval Schedule
  const wfPage=await notebook('page.create',{title:'AI Workflow Launchpad',color:'white'})
  const btn=await notebook('button.create',{
    pageId:wfPage.id,
    label:'Launch Pipeline',
    actions:[
      {
        id:'step_agent',
        type:'agent',
        employeeId:worker.id,
        deliveryMode:'direct',
        grantPageAccess:'write',
        prompt:'Inspect page {{title}} ({{pageId}})',
      },
      {
        id:'step_mission',
        type:'mission',
        employeeIds:[worker.id],
        missionType:'supervised',
        reminderSeconds:1800,
        grantPageAccess:'read',
        title:'Goal {{title}}',
        prompt:'Deliver review for {{title}}',
      },
      {
        id:'step_schedule',
        type:'schedule',
        employeeId:worker.id,
        scheduleKind:'interval',
        everySeconds:3600,
        grantPageAccess:'read',
        title:'Digest {{title}}',
        prompt:'Check updates for {{title}}',
      },
    ],
  })
  assert.ok(btn.blockId)

  const runResult=await notebook('button.run',{pageId:wfPage.id,blockId:btn.blockId})
  assert.ok(runResult,'button.run succeeded')

  // Verify auto page ACL elevation on wfPage for worker
  const wfRight=await notebook('page.get',{pageId:wfPage.id},workerToken)
  assert.equal(wfRight.title,'AI Workflow Launchpad')
  await notebook('page.update',{pageId:wfPage.id,title:'AI Workflow Updated'},workerToken)
  assert.equal((await notebook('page.get',{pageId:wfPage.id})).title,'AI Workflow Updated')

  // Verify mission created with supervised secretary
  const missions=await rpc('mission.list')
  const createdMission=missions.find(m=>m.name==='Goal AI Workflow Launchpad')
  assert.ok(createdMission,'supervised mission created by workflow button')
  assert.equal(createdMission.type,'supervised')
  assert.equal(createdMission.secretaryId,secretary.id)

  // Verify interval schedule created
  const schedules=await rpc('schedule.list')
  const createdSchedule=schedules.find(s=>s.name==='Digest AI Workflow Launchpad')
  assert.ok(createdSchedule,'interval schedule created by workflow button')
  assert.equal(createdSchedule.action.employeeId,worker.id)

  // Wait for direct message delivery on worker
  await f.until(async()=>{
    const hist=await rpc('direct.history',{employee:worker.id,limit:20})
    return hist.items?.some(m=>typeof m.text==='string'&&m.text.includes('Inspect page AI Workflow Launchpad ('+wfPage.id+')'))
  },'direct workflow prompt delivered to worker')
  console.log('PASS /workflow button orchestrates agent direct.send + grantPageAccess, supervised mission, and interval schedule')
}finally{
  await f.close()
}
