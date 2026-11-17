// Real native keyboard input and shutdown, using hidden windows and isolated data.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/quit-fix/ui');fs.mkdirSync(out,{recursive:true})
if(process.platform!=='darwin')throw Error('This acceptance test exercises the macOS Command+Q chord')
const timings=[],checks=[],pass=message=>{checks.push(message);console.log('PASS '+message)}

async function launch(withEmployee=false){
 const f=await fixtureCore({AC_NATIVE_WORKER_FIXTURE:'1'});await f.cli('settings','set','--language','en')
 let employee
 if(withEmployee){
  employee=await f.create('Active employee')
  fs.writeFileSync(path.join(employee.cwd,'notes.md'),'# Keep my work\n')
 }
 await f.stop()
 const env={...f.env,AGENTS_COMPANY_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE
 const application=process.env.AGENTS_COMPANY_TEST_APP
 const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),child=app.process(),page=await app.firstWindow(),errors=[]
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.dismiss().catch(()=>{}));await page.locator('.company-navigation').waitFor();await page.emulateMedia({reducedMotion:'reduce'})
 const uiTimes=[];let output=''
 child.stdout?.on('data',data=>{output+=data;let index;while((index=output.indexOf('\n'))>=0){const line=output.slice(0,index);output=output.slice(index+1);const match=/QUIT_UI_HIDDEN:(\d+)/.exec(line);if(match)uiTimes.push(Number(match[1]))}})
 await app.evaluate(({app,BrowserWindow})=>{
  const watch=window=>{const hide=window.hide.bind(window);window.hide=()=>{console.log('QUIT_UI_HIDDEN:'+Date.now());hide()};window.on('closed',()=>console.log('QUIT_UI_HIDDEN:'+Date.now()))}
  for(const window of BrowserWindow.getAllWindows())watch(window)
  app.on('browser-window-created',(_event,window)=>watch(window))
 })
 const closed=new Promise(resolve=>child.once('exit',code=>resolve(code))),rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 const chord=async(modifiers,keyCode='Q',windowPage=page)=>app.evaluate(({BrowserWindow},{url,modifiers,keyCode})=>{
  const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url);if(!window)throw Error('Native test window not found')
  window.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers})
  window.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})
 },{url:windowPage.url(),modifiers,keyCode})
 const quit=async(target,windowPage=page,maxElapsedMs=2500,maxWindowMs=500)=>{
  if(target&&!target.keyboard)await target.focus()
  const started=Date.now();await chord(['meta'],'Q',windowPage)
  const code=await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Command+Q did not stop the native application')),10000);timer.unref()})])
  const elapsedMs=Date.now()-started
  const hiddenAt=uiTimes.find(time=>time>=started),windowResponseMs=hiddenAt===undefined?null:hiddenAt-started
  timings.push({scenario:checks.length,elapsedMs,windowResponseMs});fs.writeFileSync(path.join(out,'timings.json'),JSON.stringify(timings,null,2))
  assert.equal(code,0)
  assert.ok(elapsedMs<maxElapsedMs,`bounded native process cleanup (${elapsedMs}ms < ${maxElapsedMs}ms)`)
  assert.ok(windowResponseMs!==null&&windowResponseMs<maxWindowMs,`quit window response (${windowResponseMs}ms < ${maxWindowMs}ms)`)
  assert.deepEqual(errors,[])
 }
 const hidden=async()=>assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 const close=async()=>{
  if(child.exitCode===null){
   if(employee){
    const tools=path.join(f.control,employee.id+'-tools.json')
    if(fs.existsSync(tools)){const tree=JSON.parse(fs.readFileSync(tools,'utf8'));for(const pid of [tree.child,tree.grandchild])try{process.kill(pid,'SIGKILL')}catch{}}
    const file=path.join(f.control,employee.id+'-process.json')
    if(fs.existsSync(file)){try{process.kill(JSON.parse(fs.readFileSync(file,'utf8')).pid,'SIGTERM')}catch{}}
   }
   await app.evaluate(({app})=>app.exit(1)).catch(()=>{})
  }
  await f.close()
 }
 return {f,app,child,page,employee,uiTimes,closed,rpc,chord,quit,hidden,close}
}

async function startActiveEmployee(test){
 const {f,employee,rpc}=test
 fs.writeFileSync(path.join(f.control,employee.id+'.hold-user'),'')
 fs.writeFileSync(path.join(f.control,employee.id+'.spawn-tools'),'')
 await rpc('session.enqueue',{employee:employee.id,text:'Running task before native quit',sourceView:'messages'})
 await f.until(async()=>(await rpc('session.status',{employee:employee.id}))[0].busy,'employee active')
 await f.until(()=>fs.existsSync(path.join(f.control,employee.id+'-tools.json.grandchild-ready')),'employee tools ready')
 const tree=JSON.parse(fs.readFileSync(path.join(f.control,employee.id+'-tools.json'),'utf8'))
 const rolePid=JSON.parse(fs.readFileSync(path.join(f.control,employee.id+'-process.json'),'utf8')).pid
 return [rolePid,tree.child,tree.grandchild]
}

const dead=pids=>{for(const pid of pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'})}
let test
try{
 if(!process.argv.includes('--active-employee-only')){
  // 1. Idle quit after visiting Library (Study Reader iframe), Mission (Notebook iframe), and Message
  test=await launch()
  const nav=test.page.locator('.company-navigation')
  await nav.getByRole('button',{name:'Library',exact:true}).click()
  await expect(test.page.frameLocator('.library-view iframe.library-reader-frame').locator('body[data-ready="true"]')).toBeAttached({timeout:15000})
  await nav.getByRole('button',{name:'Mission',exact:true}).click()
  await expect(test.page.frameLocator('.mission-workspace iframe.mission-notebook-frame').locator('.app-shell')).toBeVisible()
  await nav.getByRole('button',{name:'Message',exact:true}).click()
  await test.hidden()
  await test.quit(test.page,test.page,1500,400)
  await test.close();test=undefined
  pass('Command+Q after loading Library Study Reader and Mission Notebook exits promptly without waiting on read-only iframes')

  // 2. Quit from an open file editor + unsent workbench draft + active employee with detached grandchild tools
  test=await launch(true)
  let pids=await startActiveEmployee(test)
  await test.rpc('view.open',{kind:'conversation',employee:test.employee.id})
  await test.page.locator('.composer textarea').fill('Keep this unsent employee draft')
  await test.page.locator('.file-row[data-file="notes.md"] .file-open').click()
  const editor=test.page.getByRole('textbox',{name:'File content',exact:true})
  await editor.fill('# Saved by Command+Q\n')
  await test.hidden()
  await test.quit(editor)
  assert.equal(fs.readFileSync(path.join(test.employee.cwd,'notes.md'),'utf8'),'# Saved by Command+Q\n')
  const messengerState=JSON.parse(fs.readFileSync(path.join(test.f.env.AGENTS_COMPANY_HOME,'messenger.json'),'utf8'))
  assert.equal(messengerState.drafts['work:employee:'+test.employee.id]?.text,'Keep this unsent employee draft')
  dead(pids);await test.close();test=undefined
  pass('Command+Q from an editor saves the file and unsent draft, stops active native work and owned detached tools, and exits with code 0')

  // 3. Manual save/discard guard (SettingsPanel dirty employee defaults) blocks quit without hiding window
  test=await launch(true)
  pids=await startActiveEmployee(test)
  await test.page.locator('.application-settings-trigger').click()
  await test.page.getByRole('menuitem',{name:'Settings',exact:true}).click()
  const settingsDialog=test.page.getByRole('dialog',{name:'Application settings',exact:true})
  await expect(settingsDialog).toBeVisible()
  await settingsDialog.locator('.settings-employee-defaults summary').click()
  const wsInput=settingsDialog.getByRole('textbox',{name:'Unified workspaces folder',exact:true})
  await wsInput.fill('/tmp/unsaved-workspaces-root')
  await wsInput.focus()
  await test.chord(['meta'])
  await expect(test.page.locator('.desktop-quit-notice[data-phase=blocked]')).toContainText('Could not quit Aexus Bot')
  assert.equal(test.child.exitCode,null)
  assert.equal(test.uiTimes.length,0,'save guards do not hide a blocked quit')
  assert.equal((await test.rpc('session.status',{employee:test.employee.id}))[0].busy,true)
  assert.ok(process.kill(pids[0],0))
  assert.equal((await test.rpc('status')).running,true)
  await expect(wsInput).toHaveValue('/tmp/unsaved-workspaces-root')
  await test.hidden()
  await test.page.screenshot({path:path.join(out,'blocked-quit-preserves-work.png'),animations:'disabled'})
  await test.page.locator('.desktop-quit-notice[data-phase=blocked]').getByRole('button',{name:'Dismiss',exact:true}).click()
  await settingsDialog.getByRole('button',{name:'Discard changes',exact:true}).click()
  await settingsDialog.getByRole('button',{name:'Close settings',exact:true}).click()
  await expect(settingsDialog).toHaveCount(0)
  await test.quit(test.page)
  dead(pids);await test.close();test=undefined
  pass('A manual save/discard guard explains a blocked quit, preserves the form and keeps Core and running work usable; retry after discard exits')

  // 4. Real terminal focus + zoom shortcut + Control+Q ignored
  test=await launch(true)
  await test.rpc('view.open',{kind:'conversation',employee:test.employee.id})
  const terminal=test.page.locator('.xterm-helper-textarea')
  await expect(terminal).toBeAttached()
  await terminal.focus()
  await test.chord(['control'])
  assert.equal(test.child.exitCode,null)
  await test.chord(['meta'],'=')
  await expect.poll(async()=>(await test.rpc('settings.get')).pageZoom).toBeGreaterThan(1)
  await test.hidden()
  await test.quit(terminal)
  await test.close();test=undefined
  pass('Command+Q works while a real terminal has focus and after a zoom shortcut; plain Control+Q does not quit on macOS')

  // 5. Mission Notebook iframe conflict guard & auto-save on Command+Q
  test=await launch(true)
  pids=await startActiveEmployee(test)
  const nbRoot=path.join(test.f.env.AGENTS_COMPANY_HOME,'mission-notebook')
  await test.page.locator('.company-navigation').getByRole('button',{name:'Mission',exact:true}).click()
  const frame=test.page.frameLocator('.mission-workspace iframe.mission-notebook-frame')
  await expect(frame.locator('.sidebar')).toBeVisible()
  const nbCall=(method,params={})=>test.rpc('notebook.call',{method,params})
  await nbCall('fs.write',{path:'draft.md',content:'# Original file'})
  const note=(await nbCall('page.list')).find(n=>n.sourceFile?.path==='draft.md')
  assert.ok(note)
  await expect.poll(async()=>{try{await nbCall('page.open',{pageId:note.id});return true}catch{return false}},{timeout:10000}).toBe(true)
  await expect(frame.locator('.folder-markdown')).toBeVisible()
  await frame.getByRole('button',{name:'编辑文件',exact:true}).click()
  await frame.getByRole('textbox',{name:'文件内容'}).fill('# Local unsaved edit')
  fs.writeFileSync(path.join(nbRoot,'draft.md'),'# External change')
  await frame.getByRole('textbox',{name:'文件内容'}).focus()
  await test.chord(['meta'],'Q')
  await expect(test.page.locator('.desktop-quit-notice[data-phase=blocked]')).toBeVisible()
  assert.equal(fs.readFileSync(path.join(nbRoot,'draft.md'),'utf8'),'# External change')
  assert.equal((await test.rpc('session.status',{employee:test.employee.id}))[0].busy,true)
  assert.equal((await test.rpc('status')).running,true)
  await test.hidden()
  await test.page.screenshot({path:path.join(out,'notebook-conflict-keeps-core-running.png'),animations:'disabled'})
  await test.page.locator('.desktop-quit-notice[data-phase=blocked]').getByRole('button',{name:'Dismiss',exact:true}).click()
  await frame.getByRole('button',{name:'取消编辑',exact:true}).click()
  await expect(frame.locator('.folder-markdown')).toContainText('External change')
  await frame.getByRole('button',{name:'编辑文件',exact:true}).click()
  await frame.getByRole('textbox',{name:'文件内容'}).fill('# Saved when quitting from Mission Notebook iframe')
  await test.quit(frame.getByRole('textbox',{name:'文件内容'}))
  assert.equal(fs.readFileSync(path.join(nbRoot,'draft.md'),'utf8'),'# Saved when quitting from Mission Notebook iframe')
  dead(pids);await test.close();test=undefined
  pass('Command+Q in Mission Notebook iframe shares the native exit path; file conflicts leave Core alive, and a resolved retry saves the file and stops owned work')

  // 6. Stale beforeunload cannot cancel saved native quit
  test=await launch()
  await test.page.evaluate(()=>window.addEventListener('beforeunload',event=>{event.preventDefault();event.returnValue=''}))
  await test.quit(test.page)
  await test.close();test=undefined
  pass('A stale browser beforeunload guard cannot silently cancel an already saved native quit')

  // 7. Unavailable / crashed renderer exits promptly
  test=await launch()
  await test.app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.webContents.forcefullyCrashRenderer()})
  await expect.poll(()=>test.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.isCrashed())).toBe(true)
  const started=Date.now();await test.app.evaluate(({app})=>app.quit())
  const code=await Promise.race([test.closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Crashed renderer blocked quit')),4000))])
  assert.equal(code,0);assert.ok(Date.now()-started<2000)
  await test.close();test=undefined
  pass('An unavailable renderer exits promptly through the native application quit entry')
 }

 // 8. Active employee ignoring interrupt + detached grandchild tools exit promptly
 test=await launch(true)
 const role=test.employee
 fs.writeFileSync(path.join(test.f.control,role.id+'.ignore-interrupt'),'')
 const activePids=await startActiveEmployee(test)
 await test.hidden()
 await test.quit(test.page)
 dead(activePids);await test.close();test=undefined
 pass('An active employee and its detached tools exit promptly even when native cancellation is ignored')

 if(!process.argv.includes('--active-employee-only')){
  // 9. Active scheduled task cancelled without inventing succeeded status
  test=await launch(true)
  const scheduledRole=test.employee
  fs.writeFileSync(path.join(test.f.control,scheduledRole.id+'.hold-user'),'')
  fs.writeFileSync(path.join(test.f.control,scheduledRole.id+'.ignore-interrupt'),'')
  const job=await test.rpc('schedule.create',{spec:{name:'Quit during scheduled work',enabled:false,action:{type:'agent',employeeId:scheduledRole.id,prompt:'Hold this deterministic scheduled task'},rule:{kind:'once',at:'2099-01-01T12:00:00Z'}}})
  const scheduled=test.rpc('schedule.run',{id:job.id}).catch(()=>{})
  await test.f.until(async()=>(await test.rpc('session.status',{employee:scheduledRole.id}))[0].busy,'scheduled employee active')
  await test.hidden()
  await test.quit(test.page)
  await scheduled
  const saved=JSON.parse(fs.readFileSync(path.join(test.f.env.AGENTS_COMPANY_HOME,'schedules.json'),'utf8'))
  assert.equal(saved.jobs.find(value=>value.id===job.id).enabled,false)
  assert.ok(saved.runs.every(run=>run.status!=='succeeded'))
  await test.close();test=undefined
  pass('Quit cancels an active schedule and its engine together without changing its definition or inventing a successful result')
 }

 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,platform:'macOS',checks,timings,windowsHidden:true,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}catch(error){await test?.page.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await test?.close()}
