// Mission Super-Notion UI tests (hidden desktop or headless Web): manual import of existing saved schedules into multi-database-view page, creating once/repeat/event/mission tasks into both existing-page database views and new-page multi-database views, multiple database views per page, Workflow buttons & ACL grants; disposable data and 0 paid model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/mission-notebook/'+mode)
fs.mkdirSync(out,{recursive:true})
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-mission-nb-ui-')))
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))

let f,page,app,browser
const checks=[],errors=[]
const pass=text=>{checks.push(text);console.log('PASS '+mode+': '+text)}

try{
  const application=process.env.AGENTS_COMPANY_TEST_APP
  f=await fixtureCore({
    ...(application?{AGENTS_COMPANY_BUILTIN_PLUGINS:path.join(application,'Contents/Resources/plugins')}:{}),
    ...(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{}),
  })
  const core=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
  await core('settings.set',{language:'en'})
  const worker=await core('card.create',{title:'Workflow Analyst',folderName:'workflow-analyst',engine:'codex',model:'gpt-6-luna',effort:'low'})
  await f.ready(worker.id)

  // Seed an already-saved Core scheduled task to test explicit manual import into a new multi-view page
  const legacyJob=await core('schedule.create',{
    spec:{
      name:'Saved Morning Briefing',
      enabled:false,
      action:{type:'agent',employeeId:worker.id,prompt:'Compile daily morning briefing without running in test'},
      rule:{kind:'weekly',days:[1,2,3,4,5],time:'08:30',timezone:'Asia/Shanghai'},
      plan:{priority:'high',tags:['briefing'],notes:'Pre-existing saved schedule'},
    },
  })

  if(web){
    browser=await chromium.launch({headless:true,...(process.env.AGENTS_BROWSER_CHANNEL?{channel:process.env.AGENTS_BROWSER_CHANNEL}:process.platform==='darwin'?{channel:'chrome'}:{})})
    page=await browser.newPage({viewport:{width:1440,height:960}})
    await page.goto('http://127.0.0.1:'+port)
    await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim())
    await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
  }else{
    await f.stop()
    const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'960'}
    delete env.ELECTRON_RUN_AS_NODE
    app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env})
    page=await app.firstWindow()
  }

  page.setDefaultTimeout(25000)
  page.on('pageerror',err=>errors.push(err.message))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('.company-navigation').waitFor()
  const rpc=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(error){throw Error(cmd+': '+(error?.message??JSON.stringify(error)))}},{cmd,args})

  // 1. Launcher excludes retired built-in plugins
  await expect(page.locator('.application-plugins [data-plugin]')).toHaveCount(0)
  const listed=await rpc('plugin.list')
  assert.deepEqual(listed,[])
  pass('Application launcher excludes retired built-in plugins')

  // 2. Mission opens 100% into the Super-Notion Notebook (zero legacy PlanView / stiff PageAgentPlanner)
  await page.locator('.company-navigation .plan-view-trigger').click()
  const iframeEl=page.locator('iframe.mission-notebook-frame')
  await expect(iframeEl).toBeVisible()
  await expect(page.locator('.plan-view')).toHaveCount(0)

  const frame=page.frameLocator('iframe.mission-notebook-frame')
  await expect(frame.locator('.app-shell')).toBeVisible()
  await expect(frame.locator('.sidebar')).toBeVisible()
  await expect(frame.locator('[data-page-planner]')).toHaveCount(0)
  await rpc('view.open',{kind:'plan',planViewId:'table'})
  await expect(iframeEl).toBeVisible()
  await expect(page.locator('.plan-view')).toHaveCount(0)
  pass('Mission renders 100% Super-Notion Notebook with zero legacy PlanView or bolted-on card boxes')

  // 3. Explicit Manual Save of Existing Scheduled Tasks into a New Multi-Database-View Page
  await frame.locator('[data-mission-tasks="true"]').click()
  const hub=frame.locator('.agent-tasks-hub-modal')
  await expect(hub).toBeVisible()
  await expect(hub).toContainText('Saved Morning Briefing')
  await expect(hub.locator('[data-save-tasks-to-page="true"]')).toBeVisible()
  await hub.getByRole('textbox',{name:'导入页面标题',exact:true}).fill('历史定时任务归档页')
  await hub.locator('[data-save-tasks-to-page="true"]').click()
  await expect(hub).toHaveCount(0)

  const titleInput=frame.getByRole('textbox',{name:'页面标题',exact:true})
  await expect(titleInput).toHaveValue('历史定时任务归档页')
  // Verify the single imported page embeds MULTIPLE database views (Table + Calendar + Board = 3 inline-database blocks!)
  await expect(frame.locator('.inline-database')).toHaveCount(3)
  await expect(frame.locator('.inline-database').first()).toContainText('Saved Morning Briefing')
  assert.equal((await rpc('schedule.get',{id:legacyJob.id})).enabled,false,'Manual import must preserve paused state without running')
  await page.screenshot({path:path.join(out,'mission-imported-multiview.png'),animations:'disabled'})
  pass('Manual Save action creates a new Notion page with 3 rich database views (Table + Calendar + Kanban Board) containing pre-existing schedules')

  // 4. Create clean document page, write rich BlockNote text & workflow button
  await frame.locator('.sidebar-add').click()
  await expect(titleInput).toBeVisible()
  await titleInput.fill('Mission Super-Notion Spec')
  await frame.locator('.bn-editor').click()
  await frame.locator('.bn-editor').pressSequentially('MISSION_SUPER_NOTION_BODY',{delay:1})

  await expect.poll(async()=>{
    const pages=await rpc('notebook.call',{method:'page.list'})
    return pages.find(p=>p.title==='Mission Super-Notion Spec')||null
  },{timeout:15000}).toBeTruthy()
  const createdPage=(await rpc('notebook.call',{method:'page.list'})).find(p=>p.title==='Mission Super-Notion Spec')

  await rpc('notebook.call',{
    method:'button.create',
    params:{
      pageId:createdPage.id,
      label:'AI Dispatch Button',
      actions:[{id:'step_init',type:'agent',employeeId:worker.id,deliveryMode:'direct',grantPageAccess:'read',prompt:'Initial {{title}}'}],
    },
  })
  await expect(frame.locator('.note-action-button .button-main')).toContainText('AI Dispatch Button')
  await frame.getByRole('button',{name:'配置按钮',exact:true}).click()
  const btnDialog=frame.getByRole('dialog',{name:'配置按钮',exact:true})
  await expect(btnDialog).toBeVisible()
  const actionType=btnDialog.getByLabel('动作类型').first()
  for(const typeValue of ['agent','mission','schedule']){
    await expect(actionType.locator(`option[value="${typeValue}"]`)).toHaveCount(1)
  }
  await btnDialog.getByRole('textbox',{name:'派发指令',exact:true}).fill('UI Dispatched {{title}}')
  await btnDialog.getByRole('button',{name:'保存按钮',exact:true}).click()
  await expect(btnDialog).toHaveCount(0)
  pass('Workflow ActionEditor exposes agent, mission, and schedule workflow steps cleanly')

  // 5. Save once, repeat, and event-driven tasks into EXISTING page's Database Views
  const expectedTag='p:'+createdPage.id
  await frame.locator('[data-topbar-tasks="true"]').click()
  const composer=frame.locator('.agent-task-composer-modal')
  await expect(composer).toBeVisible()
  await expect(composer.locator('[data-dest-mode="existing-page"]')).toHaveAttribute('aria-pressed','true')
  await composer.locator('[name="plan-name"]').fill('One-Shot Page Plan')
  await composer.locator('[name="plan-prompt"]').fill('Summarize the page cleanly')
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)

  // Verify the existing page now embeds multiple database views (Table + Calendar + Board) containing One-Shot Page Plan!
  await expect(frame.locator('.inline-database')).toHaveCount(3)
  await expect(frame.locator('.inline-database').first()).toContainText('One-Shot Page Plan')
  await expect(frame.locator('[data-page-planner]')).toHaveCount(0)

  // Add Repeat task directly into that inline Task Database via its header "布置任务" button
  await frame.locator('[data-db-add-task]').first().click()
  await expect(composer).toBeVisible()
  await composer.locator('[data-planner-tab="repeat"]').click()
  await composer.locator('[name="plan-name"]').fill('Recurring Page Review')
  await composer.locator('[name="plan-prompt"]').fill('Weekly status check for this page')
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)
  await expect(frame.locator('.inline-database').first()).toContainText('Recurring Page Review')

  // Add Event-driven task into a SECOND new inline Task Database on the SAME page to verify multiple independent databases on one page!
  await frame.locator('[data-topbar-tasks="true"]').click()
  await expect(composer).toBeVisible()
  await composer.locator('[data-planner-tab="event"]').click()
  await composer.getByRole('button',{name:'选择目标数据库视图',exact:true}).click()
  await frame.locator('.app-select-menu [role="option"]').filter({hasText:'在该页面新增一个任务数据库视图块'}).click()
  await composer.getByRole('button',{name:'可视化视图组合',exact:true}).click()
  await frame.locator('.app-select-menu [role="option"]').filter({hasText:'状态看板与类型统计双视图'}).click()
  await composer.locator('[name="plan-name"]').fill('Event Reactive Watcher')
  await composer.locator('[name="plan-prompt"]').fill('React on incoming reply without model call')
  await composer.getByRole('button',{name:'监听会话',exact:true}).click()
  await frame.locator('.app-select-menu [role="option"]').filter({hasText:'Workflow Analyst'}).click()
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)

  // Now the single page has 5 embedded databaseView blocks (3 from DB #1 + 2 from DB #2)!
  await expect(frame.locator('.inline-database')).toHaveCount(5)
  await expect(frame.locator('.page-scroll')).toContainText('Event Reactive Watcher')
  await page.screenshot({path:path.join(out,'mission-task-db-views.png'),animations:'disabled'})
  pass('Existing Notion page hosts multiple independent & linked Task Database Views (Table, Calendar, Board, Chart) for once, repeat, and event tasks')

  // 6. Create persistent Mission task choosing "New Page + Multi-Database Views" ([data-dest-mode="new-page"])
  await frame.locator('[data-topbar-tasks="true"]').click()
  await expect(composer).toBeVisible()
  const submitBtnBox=await composer.getByRole('button',{name:'布置任务',exact:true}).boundingBox()
  assert.ok(submitBtnBox&&submitBtnBox.y+submitBtnBox.height<=956,`Expected sticky composer footer inside viewport (<=956), got ${submitBtnBox?submitBtnBox.y+submitBtnBox.height:'null'}`)
  await page.screenshot({path:path.join(out,'mission-composer-modal.png'),animations:'disabled'})
  await composer.locator('[data-planner-tab="mission"]').click()
  await composer.locator('[data-dest-mode="new-page"]').click()
  await composer.locator('[name="plan-new-page-title"]').fill('专项持续督办看板页')
  await composer.locator('[name="plan-name"]').fill('Persistent Page Goal')
  await composer.locator('[name="plan-prompt"]').fill('Track goal deliverables until explicitly completed')
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)

  await expect(titleInput).toHaveValue('专项持续督办看板页')
  await expect(frame.locator('.inline-database')).toHaveCount(3)
  await expect(frame.locator('.inline-database').first()).toContainText('Persistent Page Goal')

  // Clicking primary "新建" button on a Task Database opens AgentTaskComposerModal (not an untyped row!)
  await frame.locator('.inline-database').first().getByRole('button',{name:'新建记录',exact:true}).click()
  await expect(composer).toBeVisible()
  await composer.getByRole('button',{name:'取消',exact:true}).click()
  await expect(composer).toHaveCount(0)

  // Opening task row in Side Peek shows TaskRecordControlBar and hides internal task_ref property!
  await frame.locator('.inline-database').first().locator('.database-row-title',{hasText:'Persistent Page Goal'}).click()
  const peekPanel=frame.locator('.peek-panel')
  await expect(peekPanel).toBeVisible()
  await expect(peekPanel.locator('.task-record-control-bar')).toContainText('持续督办目标已关联')
  await expect(peekPanel.locator('.page-properties')).not.toContainText('任务关联ID')
  await page.screenshot({path:path.join(out,'mission-row-sidepeek.png'),animations:'disabled'})
  await peekPanel.getByRole('button',{name:'关闭预览',exact:true}).click()
  await expect(peekPanel).toHaveCount(0)

  await expect.poll(async()=>{
    const pages=await rpc('notebook.call',{method:'page.list'})
    return pages.find(p=>p.title==='专项持续督办看板页')||null
  },{timeout:15000}).toBeTruthy()
  const newMissionPage=(await rpc('notebook.call',{method:'page.list'})).find(p=>p.title==='专项持续督办看板页')
  assert.ok(newMissionPage,'Expected newly created Mission task page')

  const jobs=await rpc('schedule.list')
  for(const jobTitle of ['One-Shot Page Plan','Recurring Page Review','Event Reactive Watcher']){
    const j=jobs.find(item=>item.name===jobTitle)
    assert.ok(j,'Missing scheduled job: '+jobTitle)
    assert.ok(j.plan?.tags?.includes(expectedTag),'Job missing p:pageId binding tag')
    assert.equal(j.enabled,false)
  }
  assert.equal(jobs.find(item=>item.name==='Event Reactive Watcher')?.rule.kind,'event')

  const missions=await rpc('mission.list',{archived:'active'})
  const pageMission=missions.find(m=>m.name==='Persistent Page Goal')
  assert.ok(pageMission,'Missing bound Mission')
  assert.ok(pageMission.plan?.tags?.includes('p:'+newMissionPage.id),'Mission should bind to the newly created Notion page')
  await rpc('mission.complete',{id:pageMission.id,result:'Verified in UI test',expectedRevision:pageMission.revision})
  pass('Creating a task in New-Page mode opens a new multi-database-view Notion page and binds Core execution + tags cleanly')

  // 7. Auto-granted page ACL + NotebookAccessDialog upgrade to create
  const autoGrants=await rpc('notebook.access')
  const workerGrant=autoGrants.grants.find(g=>g.employeeId===worker.id&&g.resourceId===createdPage.id)
  assert.ok(workerGrant?.read&&workerGrant?.write,'Creating page task automatically granted read+write ACL on the bound Notion page')

  await frame.locator('[data-topbar-access="true"]').click()
  const aclDialog=frame.getByRole('dialog',{name:'🔐 Mission 笔记本页面授权',exact:true})
  await expect(aclDialog).toBeVisible()
  const createCheckbox=aclDialog.getByRole('checkbox',{name:'Workflow Analyst create',exact:true})
  await expect(createCheckbox).toBeVisible()
  await createCheckbox.check()
  await aclDialog.getByRole('button',{name:'保存授权',exact:true}).click()
  await expect(aclDialog.getByRole('status')).toContainText('页面授权已原子保存')
  await aclDialog.getByRole('button',{name:'关闭',exact:true}).last().click()
  await expect(aclDialog).toHaveCount(0)
  const finalGrants=await rpc('notebook.access')
  assert.ok(finalGrants.grants.some(g=>g.employeeId===worker.id&&g.resourceId===newMissionPage.id&&g.create===true))
  pass('Auto-granted page write access works seamlessly alongside NotebookAccessDialog')

  await page.screenshot({path:path.join(out,'mission-notebook.png'),animations:'disabled'})
  assert.deepEqual(errors,[],'zero page errors')
  if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())),'all desktop windows stayed hidden')
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,errors,paidModelCalls:0},null,2)+'\n')
}catch(error){
  console.error(error)
  await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{})
  throw error
}finally{
  if(app){
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.forcefullyCrashRenderer()}).catch(()=>{})
    await app.close()
  }
  await browser?.close()
  await f?.close()
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
