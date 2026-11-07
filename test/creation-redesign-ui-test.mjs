// Real creation forms/Core, hidden desktop or headless Web; synthetic accounts and model peers.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_CREATION_ARTIFACTS||path.join(root,'artifacts/creation-redesign',mode)),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
let f,app,browser,page
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
 await rpc('settings.set',{language:'en',theme:'white'});await rpc('group.add',{name:'Studio',mode:'build'})
 const host=await rpc('host.create',{name:'Fixture cloud',host:'fixture.invalid',os:'linux',defaultDirectory:'/srv/projects'})
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1280,height:800}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1280',AGENTS_COMPANY_HEIGHT:'800'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,800))}
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.infinite-canvas')).toBeVisible()
 const choose=async(name,value)=>{const select=page.locator('select[name="'+name+'"]');await expect(select.locator('option[value="'+value+'"]')).toHaveCount(1);const label=await select.locator('option').evaluateAll((items,value)=>items.find(item=>item.value===value)?.textContent,value);assert.ok(label);await select.locator('..').locator('.app-select-trigger').click();await page.getByRole('option',{name:label,exact:true}).click();await expect(select).toHaveValue(value)}
 const fit=async()=>{const panel=page.locator('.creation-panel'),save=panel.locator('.form-footer .primary');assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}),'primary action must remain in the viewport')}
 await page.locator('.add-team').click();await expect(page.locator('.save-team')).toBeDisabled();await page.locator('input[name="team-name"]').fill('Research')
 const types=page.getByRole('group',{name:'Team type',exact:true});await expect(types.locator('button')).toHaveCount(2)
 for(const theme of ['white','black']){
  await rpc('settings.set',{theme})
  for(const kind of ['build','cloud']){
   await types.locator('[data-mode="'+kind+'"]').click();await expect(types.locator('[aria-pressed="true"]')).toHaveCount(1);await expect(types.locator('[data-mode="'+kind+'"]')).toHaveAttribute('aria-pressed','true')
   await expect(page.locator('select[name="cloud-host-id"]')).toHaveCount(kind==='cloud'?1:0);await expect(page.locator('select[name="team-plugin"]')).toHaveCount(0)
   if(kind==='build'){const fills=await page.locator('input[name="team-name"],input[name="team-root"]').evaluateAll(inputs=>inputs.map(input=>getComputedStyle(input).backgroundColor));assert.notEqual(fills[0],fills[1],'readonly paths must differ from editable name fields')}
   if(kind==='cloud'){await choose('cloud-host-id',host.id);await expect(page.locator('input[name="remote-directory"]')).toHaveValue('/srv/projects');await expect(page.locator('.remote-fields fieldset,.remote-fields legend')).toHaveCount(0)}
   const colors=await types.locator('button').evaluateAll(buttons=>buttons.map(b=>({chosen:b.getAttribute('aria-pressed')==='true',color:getComputedStyle(b).backgroundColor})));assert.ok(colors.filter(c=>!c.chosen).every(c=>c.color!==colors.find(c=>c.chosen).color))
   assert.ok((await page.locator('.creation-panel').innerText()).length<600,'creation copy should stay concise');await expect(page.locator('.creation-panel .workspace-note,.creation-panel .name-lock-note')).toHaveCount(0)
   await fit();await page.locator('.creation-panel').screenshot({path:path.join(out,'team-'+kind+'-'+theme+'.png'),animations:'disabled'})
  }
 }
 checks.push('Two local/cloud project choices; plugins use content grants rather than Team bindings; no paragraphs; clear selection in both themes')
 await types.locator('[data-mode="build"]').click();await page.locator('input[name="team-name"]').fill('Created in UI');await page.locator('.save-team').click();await expect(page.locator('.team-form')).toHaveCount(0);assert.equal((await rpc('session.list')).teamSettings['Created in UI'].mode,'build')
 await page.locator('.add-employee').click();await expect(page.locator('.save-employee')).toBeDisabled();await page.locator('input[name="title"]').fill('Mira');await choose('group','Studio');await choose('managementRole','manager')
 await expect(page.locator('.employee-form select[name="managementRole"] + .app-select-trigger')).toBeVisible();await expect(page.locator('.employee-form select[name="model"] + .app-select-trigger')).toBeVisible();await expect(page.locator('.employee-advanced-settings')).not.toHaveAttribute('open','');await expect(page.locator('.avatar-options')).toHaveCount(0);await expect(page.locator('.engine-choices button')).toHaveCount(4)
 for(const [theme,language] of [['white','zh-CN'],['black','en']]){
  await rpc('settings.set',{theme,language});await fit();const colors=await page.locator('.creation-panel').evaluate(el=>({form:getComputedStyle(el).backgroundColor,advanced:getComputedStyle(el.querySelector('.employee-advanced-settings')).backgroundColor,selected:getComputedStyle(el.querySelector('.engine-choices .selected')).backgroundColor,field:getComputedStyle(el.querySelector('input[name="title"]')).backgroundColor}));assert.notEqual(colors.advanced,colors.field);assert.notEqual(colors.selected,colors.field)
  await page.locator('.creation-panel').screenshot({path:path.join(out,'employee-'+theme+'-'+language+'.png'),animations:'disabled'})
 }
 await page.locator('.employee-advanced-settings>summary').click();await expect(page.locator('select[name="permissionMode"] + .app-select-trigger')).toBeVisible();await choose('permissionMode','acceptEdits');await fit();await page.locator('.employee-advanced-settings>summary').click()
 if(web){await page.setViewportSize({width:420,height:780});await fit();await page.locator('.creation-panel').screenshot({path:path.join(out,'employee-narrow.png'),animations:'disabled'});await page.setViewportSize({width:1280,height:800})}
 await page.locator('.save-employee').click();await expect(page.locator('.employee-form')).toHaveCount(0);const card=(await rpc('session.list')).sessions.find(c=>c.title==='Mira');assert.ok(card);assert.equal(card.group,'Studio');assert.equal(card.engine,'codex');assert.equal(card.managementRole,'manager');assert.equal(card.permissionMode,'acceptEdits');await f.ready(card.id)
 checks.push('Name/team/role/engine/model visible; appearance and advanced options collapsed; distinct fields, readonly sections and selected controls; actual UI creates the intended Manager with unchanged execution semantics')
 if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n');for(const check of checks)console.log('PASS '+mode+': '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
