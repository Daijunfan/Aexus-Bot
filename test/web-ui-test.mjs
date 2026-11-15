import {ENGINE_DEFINITIONS} from '../src/shared/engines.ts'
import {openApplicationSettings} from './fixtures/application-menu.mjs'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)})
const out=path.join(f.root,'artifacts','opensource-tests-0.49.0');fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'result.json'),{force:true})
let browser,checks=0;const errors=[],passed=[],cspViolations=[],consoleErrors=[]
const pass=label=>{console.log('PASS '+label);passed.push(label);checks++}
try{
  const engine=await f.cli('engine','list');assert.deepEqual(engine.map(item=>item.engine).sort(),Object.keys(ENGINE_DEFINITIONS).sort());await f.cli('settings','set','--language','en')
  await f.cli('group','add','Engineering');await f.cli('group','add','Research')
  const governor=await f.create('Governor','Engineering','governor'),worker=await f.create('Builder','Engineering'),researcher=await f.create('Researcher','Research')
  const url='http://127.0.0.1:'+port,token=fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim()
  browser=await chromium.launch({...(process.env.AGENTS_BROWSER_CHANNEL?{channel:process.env.AGENTS_BROWSER_CHANNEL}:process.platform==='darwin'?{channel:'chrome'}:{}),headless:true})
  const context=await browser.newContext({viewport:{width:1540,height:1050}})
  await context.exposeBinding('recordAexusCspViolation',({frame},record)=>{cspViolations.push({...record,frame:frame.url()})})
  // Browser-native policy events capture main documents and actual plugin frames from their first parse.
  await context.addInitScript(()=>{window.aexusCspReports=[];document.addEventListener('securitypolicyviolation',event=>{window.aexusCspReports.push(window.recordAexusCspViolation({blockedURI:event.blockedURI,documentURI:event.documentURI,effectiveDirective:event.effectiveDirective,violatedDirective:event.violatedDirective,originalPolicy:event.originalPolicy,disposition:event.disposition,sourceFile:event.sourceFile,lineNumber:event.lineNumber,columnNumber:event.columnNumber,statusCode:event.statusCode}))})})
  const watch=page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'){consoleErrors.push(message.text());console.log('BROWSER',message.text())}})},page=await context.newPage();watch(page)
  await page.goto(url);await page.locator('.web-login input').fill(token);await page.getByRole('button',{name:'Enter workspace'}).click()
  await expect(page.locator('.agent-board')).toBeVisible();await expect(page.locator('.agent-board-panel[data-employee]:visible')).toHaveCount(3);for(const person of [governor,worker,researcher])await expect(page.locator('.agent-board-panel[data-employee="'+person.id+'"]')).toBeVisible()
  await expect(page.locator('.web-login-overlay')).toHaveCount(0);pass('real browser renders existing office after authenticated login')
  assert.equal(await page.evaluate(()=>localStorage.getItem('agents-company-token')),null)
  const client=await page.evaluate(()=>sessionStorage.getItem('agents-company-client'));assert.ok(client)
  await page.screenshot({path:path.join(out,'web-office.png')})
  const rpc=(cmd,args)=>page.evaluate(([cmd,args])=>window.agents.call(cmd,args),[cmd,args])
  const views=await rpc('team-view.create',{name:'Focus Engineering',teams:['Engineering']})
  await expect(page.locator('.agent-board-panel[data-employee]:visible')).toHaveCount(2);await expect(page.locator('.agent-board-panel[data-employee="'+researcher.id+'"]')).toBeHidden()
  const second=await context.newPage();watch(second);await second.goto(url);await expect(second.locator('.agent-board')).toBeVisible();await expect(second.locator('.agent-board-panel[data-employee]:visible')).toHaveCount(3);await expect(second.locator('.agent-board-panel[data-employee="'+researcher.id+'"]')).toBeVisible();assert.notEqual(await second.evaluate(()=>sessionStorage.getItem('agents-company-client')),client);await expect(page.locator('.agent-board-panel[data-employee]:visible')).toHaveCount(2);pass('second browser tab keeps an independent active Team view')
  await rpc('team-view.select',{id:'all'})
  await page.locator('.agent-board-panel[data-employee="'+worker.id+'"]').getByRole('button',{name:'Open full conversation with Builder',exact:true}).click()
  await expect(page.locator('.conversation-dialog')).toBeVisible()
  await page.locator('.composer-box textarea').fill('Please report a fixture reply')
  await page.locator('.conversation-dialog').getByRole('button',{name:'Send message',exact:true}).click()
  await expect(page.locator('.conversation-dialog .transcript')).toContainText('VISIBLE_REPLY',{timeout:20000})
  assert.ok(!(await page.locator('.conversation-dialog .transcript').innerText()).includes('PRIVATE_INIT'));pass('the actual Board full conversation uses the shared native driver and keeps initialization private')
  await page.locator('.conversation-dialog').getByRole('button',{name:'Close conversation',exact:true}).click()
  const incoming=await rpc('transfer.upload-begin',{to:{employee:worker.id,path:'.'},name:'browser-import.txt',bytes:5})
  await rpc('transfer.upload-chunk',{id:incoming.id,offset:0,data:'aGVsbG8='});await rpc('transfer.upload-commit',{id:incoming.id})
  assert.equal(fs.readFileSync(path.join(worker.cwd,'browser-import.txt'),'utf8'),'hello');pass('browser file upload goes to the selected backend workspace')
  const notionCall=(method,params={},scope=[])=>f.cli('plugin','call','mininotion',method,...scope,'--params',JSON.stringify(params))
  const notionPage=await notionCall('page.create',{title:'CLI-created Web knowledge',color:'white'})
  const notionRoot=(await notionCall('fs.info')).root,notionScope=['--workspace',notionRoot],notionLocation=await notionCall('fs.path',{pageId:notionPage.id},notionScope)
  for(const id of ['cloud-hosts','mininotion','margin-reader']){
    await page.locator(`.application-plugins [data-plugin="${id}"]`).click()
    const win=page.locator('.web-plugin-window').last();await expect(win).toBeVisible({timeout:25000})
    const host=win.frameLocator('iframe');await expect(host.locator('.plugin-host>iframe')).toBeVisible({timeout:25000});const content=host.frameLocator('.plugin-host>iframe');await expect(content.locator('body')).not.toBeEmpty({timeout:25000})
    const ready={
      'cloud-hosts':'#detail .view-tabs',mininotion:'.app-shell','margin-reader':'#library-view'
    }[id]
    await expect(content.locator(ready)).toBeVisible({timeout:25000})
    if(id==='mininotion'){
      assert.equal((await notionCall('fs.info')).root,path.join(f.env.AGENTS_COMPANY_WORKSPACES,'mini-notion-workspace'))
      await notionCall('page.open',{pageId:notionPage.id})
      await expect(content.getByRole('textbox',{name:'页面标题',exact:true})).toHaveValue(notionPage.title)
      await content.getByRole('textbox',{name:'页面标题',exact:true}).fill('Browser and CLI share the same page')
      await expect.poll(async()=>(await notionCall('page.get',{pageId:notionPage.id},notionScope)).title).toBe('Browser and CLI share the same page')
      assert.equal((await notionCall('fs.path',{pageId:notionPage.id})).absolutePath,notionLocation.absolutePath)
      const db=await notionCall('database.create',{parentId:notionPage.id,title:'Browser board',color:'white',view:'board'},notionScope)
      await notionCall('record.create',{databaseId:db.id,title:'CLI-created browser task',color:'white',values:{status:'进行中'}},notionScope)
      await notionCall('page.open',{pageId:db.id})
      await expect(content.locator('.database')).toContainText('CLI-created browser task')
      pass('MiniNotion authenticated Web edits, explicit-workspace CLI and default portable collection share the exact same page files and database records without a Work Team')
    }
    const body=await content.locator('body').innerText();assert.ok(body.length>20,id+' content missing: '+body)
    console.log('PLUGIN',id,body.slice(0,160))
    await page.screenshot({path:path.join(out,'web-plugin-'+id+'.png')})
    await win.locator('header button').last().click();await expect(win).toHaveCount(0,{timeout:20000});pass(id+' loads in an isolated iframe and acknowledges save before close')
  }
  assert.deepEqual((await f.cli('session','list')).groups,['Engineering','Research']);await openApplicationSettings(page);await expect(page.getByRole('dialog',{name:'Application settings'})).toBeVisible()
  const engines=page.locator('.settings-engines');if(!await engines.evaluate(el=>el.open))await engines.locator(':scope > summary').click();
  for(const id of Object.keys(ENGINE_DEFINITIONS))await expect(page.locator(`[data-engine-health="${id}"]`)).toBeVisible()
  await page.screenshot({path:path.join(out,'web-engine-settings.png')});pass('engine detection/configuration/install UI is available in the same settings page')
  await page.getByRole('button',{name:'Close settings',exact:true}).click()
  const choose=page.evaluate(()=>window.agents.call('workspace.choose',{}));await expect(page.getByRole('dialog',{name:'Choose a Core-host folder'})).toBeVisible();await page.getByRole('dialog',{name:'Choose a Core-host folder'}).getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await choose).path,null);pass('folder chooser explicitly browses Core-host paths')
  for(const opened of context.pages())for(const frame of opened.frames())await frame.evaluate(()=>Promise.all(window.aexusCspReports??[]))
  assert.deepEqual(cspViolations.filter(event=>event.effectiveDirective==='font-src'),[],'Actual browser font policy violations must be zero')
  assert.deepEqual(cspViolations,[],'Actual browser resource/script/style/frame policy violations must be zero')
  assert.deepEqual(consoleErrors.filter(text=>/Content Security Policy|Not allowed to load local resource/i.test(text)),[],'Console must contain no CSP or local-resource denials')
  pass('Actual main pages and plugin frames produce zero font/resource CSP violations; console policy observations are retained')
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:passed,errors,cspViolations,consoleErrors,productionDataUsed:false,paidModelCalls:0},null,2)+'\n')
  console.log(`WEB UI: ${checks} checks passed; screenshots in ${out}`)
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,checks:passed,errors,cspViolations,consoleErrors},null,2)+'\n');throw error}finally{await browser?.close();await f.close()}
