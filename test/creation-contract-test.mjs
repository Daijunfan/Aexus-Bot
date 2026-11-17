import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore(),{cli,create}=f
try{
  // 1. Centralized local workspaces under AGENTS_COMPANY_EMPLOYEE_WORKSPACES by default + custom folderName.
  const employee=await create('First','employee')
  assert.equal(employee.cwd,path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'first'))
  assert.equal(fs.existsSync(employee.cwd),true)

  const customFolder=await cli('card','create','--title','Custom Folder Agent','--folder-name','my-custom-folder','--engine','codex','--model','gpt-6-luna','--effort','low')
  await f.ready(customFolder.id)
  assert.equal(customFolder.cwd,path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'my-custom-folder'))
  assert.equal(fs.existsSync(customFolder.cwd),true)

  // Customizing global unified workspaces root directs subsequent new local employees there.
  const customRoot=path.join(f.temp,'custom-workspaces-root')
  await cli('settings','set','--employee-workspaces-root',customRoot)
  assert.equal((await cli('settings','get')).employeeWorkspacesRoot,customRoot)
  assert.equal((await cli('workspace','suggest','--title','Root Tester')).path,path.join(customRoot,'root-tester'))
  const movedRootEmp=await cli('card','create','--title','Root Tester','--engine','codex','--model','gpt-6-luna','--effort','low')
  await f.ready(movedRootEmp.id)
  assert.equal(movedRootEmp.cwd,path.join(customRoot,'root-tester'))
  await cli('settings','set','--employee-workspaces-root','')
  await cli('card','remove',customFolder.id)
  await cli('card','remove',movedRootEmp.id)

  // 2. Engine immutability, role guards & name changes keeping folder path fixed.
  const session=await cli('session','open',employee.id)
  const original=(await cli('session','list')).sessions.find(card=>card.id===employee.id)
  for(const engine of ['claude','cline','pi']){
    for(const [cmd,args] of [['card.update',{id:employee.id,patch:{engine}}],['config.engine',{id:employee.id,engine}],['config.engine',{id:session.sessionId,engine}]]){
      const response=await f.request(null,cmd,args);assert.equal(response.ok,false);assert.match(response.error,/引擎创建后固定/)
    }
  }
  for(const role of ['manager','governor']){
    const supervisor=await create(role,role),token=await f.token(supervisor.id),response=await f.request(token,'card.update',{id:employee.id,patch:{engine:'claude'}})
    assert.equal(response.ok,false);assert.match(response.error,/引擎创建后固定|Forbidden: card.update/)
  }
  await cli('card','update',employee.id,'--title',employee.title,'--engine','codex') // Unchanged form engine is allowed alongside editable profile fields.
  const unchanged=(await cli('session','list')).sessions.find(card=>card.id===employee.id)
  for(const key of ['engine','threadId','nativeSessions','cwd','title'])assert.deepEqual(unchanged[key],original[key])
  assert.equal((await cli('session','status','--employee',employee.id))[0].sessionId,session.sessionId)
  await cli('card','rename',employee.id,'Display name')
  await cli('session','rename',session.sessionId,'Another display name')
  await cli('card','update',employee.id,'--title','Final name')
  const saved=(await cli('session','list')).sessions.find(card=>card.id===employee.id)
  assert.equal(saved.title,'Final name');assert.equal(saved.cwd,employee.cwd)
  assert.equal((await cli('session','snapshot',session.sessionId)).title,'Final name')
  assert.equal(fs.existsSync(path.join(employee.cwd,'.agents-company/employees',employee.id,'AGENTS.md')),false)
  assert.ok(fs.existsSync((await cli('api','docs')).path),'shared documentation replaces per-employee handbook copies')
  assert.ok(fs.existsSync(employee.cwd))
  await assert.rejects(()=>cli('card','update',employee.id,'--cwd','elsewhere'))

  // Retired Team commands reject cleanly.
  for(const [cmd,args] of [['group.add',{name:'Legacy'}],['group.list',{}],['room.layout',{}],['board.categories',{}],['team-view.list',{}]]){
    const res=await f.request(null,cmd,args);assert.equal(res.ok,false)
  }

  await cli('card','remove',employee.id)
  const defaults=await cli('session','list')
  assert.equal(defaults.lastEmployeeTemplate.engine,'codex')
  assert.equal(defaults.lastEmployeeTemplate.model,'gpt-6-luna')
  assert.equal(defaults.groups,undefined)
  assert.equal(defaults.teamRoots,undefined)

  // 3. Legacy sessions.json hydration preserves cloud employee hostId/remoteRoot while stripping Team keys on write.
  await f.stop()
  const storePath=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json')
  const legacyStore={
    revision:7,
    groups:['hihi','test1'],
    rooms:{hihi:{x:0,y:0}},
    teamRoots:{hihi:'/home/lab',test1:f.temp},
    teamSettings:{hihi:{mode:'cloud',hostId:'legacy-host-1',directory:'/home/lab'},test1:{mode:'build'}},
    sessions:[{id:'legacy-cloud-emp',title:'CloudOne',group:'hihi',engine:'claude',kind:'worker',cwd:'/home/lab/cloud-one',createdAt:1}]
  }
  fs.writeFileSync(storePath,JSON.stringify(legacyStore,null,2))
  await f.start()
  const hydrated=(await cli('session','list')).sessions.find(card=>card.id==='legacy-cloud-emp')
  assert.equal(hydrated.workspaceMode,'cloud')
  assert.equal(hydrated.hostId,'legacy-host-1')
  assert.equal(hydrated.remoteRoot,'/home/lab')
  assert.equal(hydrated.cwd,'/home/lab/cloud-one')
  // Trigger a persistence write and confirm Team top-level keys are stripped cleanly.
  await cli('settings','set','--language','en')
  const persisted=JSON.parse(fs.readFileSync(storePath,'utf8'))
  for(const dropped of ['groups','rooms','teamRoots','teamSettings','teamViews','activeTeamViewId','boardCategories']){
    assert.equal(dropped in persisted,false,dropped+' must be stripped from persisted sessions.json')
  }
  assert.equal(persisted.sessions.find(card=>card.id==='legacy-cloud-emp').hostId,'legacy-host-1')

  console.log('PASS centralized employee workspaces, engine immutability, rename stability, retired Team rejection and legacy cloud hydration; no model calls')
}finally{await f.close()}
