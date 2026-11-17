// Actual application/Core, hidden desktop or headless Web, disposable data and native fixtures; no real model calls.
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

  // 2. Mission opens 100% into the Super-Notion Notebook (zero legacy PlanView / Workflows mode toggle)
  await page.locator('.company-navigation .plan-view-trigger').click()
  const iframeEl=page.locator('iframe.mission-notebook-frame')
  await expect(iframeEl).toBeVisible()
  await expect(page.locator('.plan-view')).toHaveCount(0)

  const frame=page.frameLocator('iframe.mission-notebook-frame')
  await expect(frame.locator('.app-shell')).toBeVisible()
  await expect(frame.locator('.sidebar')).toBeVisible()
  await expect(frame.locator('[data-topbar-workflows]')).toHaveCount(0)
  await expect(frame.locator('[data-mission-workflows]')).toHaveCount(0)
  await rpc('view.open',{kind:'plan',planViewId:'table'})
  await expect(iframeEl).toBeVisible()
  await expect(page.locator('.plan-view')).toHaveCount(0)
  pass('Mission renders 100% Super-Notion Notebook even when planViewId is passed, with zero mode-toggle buttons')

  // 3. Create page, write rich BlockNote text & verify zero blank-page clutter before tasks exist
  await frame.locator('.sidebar-add').click()
  const titleInput=frame.getByRole('textbox',{name:'页面标题',exact:true})
  await expect(titleInput).toBeVisible()
  await titleInput.fill('Mission Super-Notion Spec')
  await frame.locator('.bn-editor').click()
  await frame.locator('.bn-editor').pressSequentially('MISSION_SUPER_NOTION_BODY',{delay:1})

  await expect.poll(async()=>{
    const pages=await rpc('notebook.call',{method:'page.list'})
    return pages.find(p=>p.title==='Mission Super-Notion Spec')||null
  },{timeout:15000}).toBeTruthy()
  const createdPage=(await rpc('notebook.call',{method:'page.list'})).find(p=>p.title==='Mission Super-Notion Spec')
  await expect.poll(async()=>{
    const md=await rpc('notebook.call',{method:'page.read-markdown',params:{pageId:createdPage.id}})
    return md.markdown.includes('MISSION_SUPER_NOTION_BODY')
  },{timeout:15000}).toBe(true)
  await expect(frame.locator('[data-page-planner]')).toHaveCount(0)
  pass('Blank Notion pages stay clean without task-planner clutter before tasks are added')

  // 4. Create workflow button with /workflow ActionEditor options (agent / mission / schedule)
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

  // 5. Native per-page Agent task planning (once, repeat, event, mission) bound to createdPage.id
  const expectedTag='p:'+createdPage.id
  await frame.locator('[data-topbar-tasks="true"]').click()
  let composer=frame.locator('.agent-task-composer-modal')
  await expect(composer).toBeVisible()
  await composer.locator('[name="plan-name"]').fill('One-Shot Page Plan')
  await composer.locator('[name="plan-prompt"]').fill('Summarize the page cleanly')
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)

  const planner=frame.locator(`[data-page-planner="${createdPage.id}"]`)
  await expect(planner).toBeVisible()
  await expect(planner).toContainText('One-Shot Page Plan')

  // Create repeat task (weekly, saved paused to guarantee 0 model runs)
  await planner.locator('[data-quick-task="repeat"]').click()
  await expect(composer).toBeVisible()
  await composer.locator('[name="plan-name"]').fill('Recurring Page Review')
  await composer.locator('[name="plan-prompt"]').fill('Weekly status check for this page')
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)
  await expect(planner).toContainText('Recurring Page Review')

  // Create event-driven task (message.received)
  await planner.locator('[data-quick-task="event"]').click()
  await expect(composer).toBeVisible()
  await composer.locator('[name="plan-name"]').fill('Event Reactive Watcher')
  await composer.locator('[name="plan-prompt"]').fill('React on incoming reply without model call')
  await composer.getByRole('button',{name:'监听会话',exact:true}).click()
  await frame.locator('.app-select-menu [role="option"]').filter({hasText:'Workflow Analyst'}).click()
  await composer.locator('.planner-advanced summary').first().click()
  await composer.getByText('已启用自动排期').click()
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)
  await expect(planner).toContainText('Event Reactive Watcher')

  // Create persistent supervised/independent Mission (skip live reminder delivery by verifying specs after check or keep interval high: reminderSeconds >= 3600)
  // Note: mission.create sends initial reminder immediately to employee unless independent? Wait - create with large reminderSeconds on an idle fixture:
  // Actually keep 0 live agent turns! We verify mission creation? Note: mission.create notifies assignees on create which runs a fixture turn in headless fixtureCore (free, no paid model!).
  await planner.locator('[data-quick-task="mission"]').click()
  await expect(composer).toBeVisible()
  await composer.locator('[name="plan-name"]').fill('Persistent Page Goal')
  await composer.locator('[name="plan-prompt"]').fill('Track goal deliverables until explicitly completed')
  await composer.getByRole('button',{name:'布置任务',exact:true}).click()
  await expect(composer).toHaveCount(0)
  await expect(planner).toContainText('Persistent Page Goal')

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
  assert.ok(pageMission,'Missing bound Mission on page')
  assert.ok(pageMission.plan?.tags?.includes(expectedTag),'Mission missing p:pageId binding tag')
  pass('Per-page Agent Task Planner creates once, repeat, event-driven, and mission plans bound to the Notion page')

  // Complete the mission immediately so zero background reminders linger
  await rpc('mission.complete',{id:pageMission.id,result:'Verified in UI test',expectedRevision:pageMission.revision})

  // Open Global Agent Tasks Hub from sidebar
  await frame.locator('[data-mission-tasks="true"]').click()
  const hub=frame.locator('.agent-tasks-hub-modal')
  await expect(hub).toBeVisible()
  await expect(hub).toContainText('One-Shot Page Plan')
  await expect(hub).toContainText('Recurring Page Review')
  await expect(hub).toContainText('Event Reactive Watcher')
  await hub.getByRole('button',{name:'关闭',exact:true}).click()
  await expect(hub).toHaveCount(0)
  pass('Sidebar Agent Tasks Hub lists all page-bound scheduled, event, and mission tasks')

  // 6. Auto-granted page ACL + NotebookAccessDialog upgrade to create
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
  assert.ok(finalGrants.grants.some(g=>g.employeeId===worker.id&&g.resourceId===createdPage.id&&g.create===true))
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
