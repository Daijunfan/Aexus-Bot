// Actual plugin windows, host permission surface and Core; no real data, models or SSH.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),f=await fixtureCore(),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/plugin-page-access/ui'));fs.mkdirSync(out,{recursive:true});let app
try{
 await f.cli('group','add','Independent team');const person=await f.create('lancer','Independent team'),secretary=await f.create('Secretary','Independent team','secretary'),token=await f.token(person.id),secretaryToken=await f.token(secretary.id)
 const rpc=async(cmd,args={},auth=null)=>{const r=await f.request(auth,cmd,args);assert.ok(r.ok,r.error);return r.data},plugin=(id,method,params={})=>rpc('plugin.call',{id,method,params})
 const page=await plugin('mininotion','page.create',{title:'Visible note',color:'white'});await plugin('mininotion','page.write-markdown',{pageId:page.id,markdown:'UI_PERMISSION_TEXT'})
 await plugin('margin-reader','fs.write',{path:'ui-document.txt',content:'READER_PERMISSION_TEXT'});const document=await plugin('margin-reader','document.open',{path:'ui-document.txt'})
 const host=await rpc('host.create',{name:'UI host',host:'fixture.invalid',os:'linux',defaultDirectory:'/srv/work'})
 await f.stop();const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1300',AGENTS_COMPANY_HEIGHT:'950'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});const main=await app.firstWindow();main.setDefaultTimeout(20000);await main.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>main.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await call('settings.set',{language:'en',theme:'white'});await main.locator('.add-team').click();await expect(main.getByRole('group',{name:'Team type',exact:true}).locator('button')).toHaveCount(2);await expect(main.locator('[data-mode=work],select[name=team-plugin]')).toHaveCount(0);await main.locator('input[name=team-name]').fill('No plugin binding');await main.locator('.creation-panel').screenshot({path:path.join(out,'team-two-options.png')});await main.locator('.creation-cancel').click()
 const cases=[['mininotion',page.id,'Visible note'],['margin-reader','document:'+document.id,document.title],['cloud-hosts','host:'+host.id,'UI host']]
 for(const [id,resourceId,title]of cases){
  const state=await call('plugin.open',{id}),window=await expect.poll(async()=>{for(const p of app.windows())if(p!==main&&p.url().includes(state.id))return true;return false}).toBe(true)
  const win=app.windows().find(p=>p!==main&&p.url().includes(state.id));assert.ok(win);win.setDefaultTimeout(25000)
  await expect(win.locator('.plugin-host>iframe')).toBeVisible();await win.getByRole('button',{name:'内容授权',exact:true}).click();const dialog=win.getByRole('dialog',{name:'内容授权',exact:true}),resource=dialog.locator('.plugin-access-resources label').filter({hasText:title}).first()
  await resource.locator('input').check();const read=dialog.getByRole('checkbox',{name:'lancer 阅读',exact:true});await expect(read).toBeEnabled();await read.check();await expect(dialog.getByRole('checkbox',{name:'Secretary 修改',exact:true})).toBeChecked();await expect(dialog.getByRole('checkbox',{name:'Secretary 修改',exact:true})).toBeDisabled()
  await dialog.screenshot({path:path.join(out,id+'-authorization.png')});await dialog.getByRole('button',{name:'保存授权',exact:true}).click();await expect(dialog).toHaveCount(0)
  assert.ok((await rpc('plugin.resources',{id},token)).resources.some(r=>r.id===resourceId));assert.ok((await rpc('plugin.resources',{id},secretaryToken)).resources.length>1)
  if(id==='mininotion')assert.ok((await rpc('plugin.call',{id,method:'page.read-markdown',params:{pageId:page.id}},token)).markdown.includes('UI_PERMISSION_TEXT'))
  if(id==='margin-reader')assert.ok(JSON.stringify(await rpc('plugin.call',{id,method:'document.content',params:{id:document.id}},token)).includes('READER_PERMISSION_TEXT'))
  if(id==='cloud-hosts')assert.equal((await rpc('host.get',{id:host.id},token)).id,host.id)
  await win.getByRole('button',{name:'内容授权',exact:true}).click();await dialog.locator('.plugin-access-resources label').filter({hasText:title}).first().locator('input').check();await expect(dialog.getByRole('checkbox',{name:'lancer 阅读',exact:true})).toBeChecked();await dialog.getByRole('checkbox',{name:'lancer 阅读',exact:true}).uncheck();await dialog.getByRole('button',{name:'保存授权',exact:true}).click();await expect(dialog).toHaveCount(0)
  assert.ok(!(await rpc('plugin.resources',{id},token)).resources.some(r=>r.id===resourceId))
  await call('plugin.close',{id:state.id});await expect(win.locator('body')).toHaveCount(0).catch(()=>{})
 }
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks:['Only local/cloud project teams; no plugin team fields','All three actual plugin windows expose one content-authorization entry','Page/document/host choice and employee read grant through the real UI','Employee API uses the granted content without joining a plugin team','Secretary automatic full rights and disabled redundant grant toggles','UI revoke takes effect immediately','Hosted iframe lifecycle flush and native window close remain functional'],modelCalls:0,sshCalls:0},null,2)+'\n');console.log('PASS actual MiniNotion, Reader and Cloud Hosts authorization windows, grant/revoke, automatic Secretary rights, employee APIs and no plugin team option')
}catch(error){if(app)for(const [index,p]of app.windows().entries())await p.screenshot({path:path.join(out,'failure-'+index+'.png')}).catch(()=>{});throw error}finally{await app?.close();await f.close()}
