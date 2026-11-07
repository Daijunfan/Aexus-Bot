// Hidden actual desktop, synthetic subscriptions/articles only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-platform-ui-'))),require=createRequire(import.meta.url)
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1'}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/channel-aggregation/ui');fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[],checks=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'})
 for(const plugin of ['telegram','youtube','x']){
  const sources=[];for(const suffix of ['alpha','beta','empty'])sources.push(await call('channel.source-add',{plugin,locator:plugin==='telegram'?'tabs_'+suffix:'@tabs'+suffix,name:plugin+' '+suffix}))
  const[a,b,empty]=sources;assert.ok(sources.every(s=>s.channelId===a.channelId));for(const source of [a,b])await call('channel.publish',{sourceId:source.id,externalId:'story-'+source.id,publishedAt:Date.now()-1000,title:source.name+' story',body:'Readable platform content from '+source.name})
  await call('view.open',{kind:'messages',channelId:a.channelId});await expect(page.locator(`[data-conversation-key="channel:${a.channelId}"]`)).toHaveCount(1)
  for(const source of sources)await expect(page.locator(`[data-conversation-key="source:${source.id}"]`)).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Channel administrators',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Conversation administration',exact:true})).toHaveCount(0);await expect(page.locator('.channel-composer,.channel-admin-dialog,.conversation-selection-bar,.pinned-messages')).toHaveCount(0);await expect(page.locator('.channel-person')).not.toHaveAttribute('role','button');assert.equal(await page.locator('.channel-person').evaluate(el=>el.tagName),'DIV')
  const tabs=page.locator('.channel-source-tabs'),allSources=tabs.locator('.channel-all-sources'),selectSource=source=>tabs.locator(`.channel-source-select[data-source-key="${plugin}:${source.id}"]`)
  await expect(tabs.locator('.channel-source-select')).toHaveCount(3);await expect(allSources).toHaveCount(1)
  for(const source of sources)await expect(selectSource(source)).toHaveCount(1)
  await tabs.getByRole('button',{name:'Search sources',exact:true}).click();const sourceSearch=tabs.getByRole('searchbox',{name:'Search sources',exact:true});await sourceSearch.fill(empty.name);await expect(tabs.locator('.channel-source-select')).toHaveCount(1);await expect(selectSource(empty)).toHaveCount(1);await page.keyboard.press('Escape');await expect(tabs.locator('.channel-source-select')).toHaveCount(3)
  const header=await page.locator('.channel-conversation>.message-thread-header').boundingBox(),bar=await tabs.boundingBox();assert.ok(bar.y-header.y-header.height<=2,'source row must directly follow header');const mode=await page.locator('.channel-view-switch').boundingBox(),firstTab=await allSources.boundingBox();assert.ok(firstTab.y-mode.y-mode.height<=16,'source choices must be close to the view controls')
  await expect(page.locator('.channel-feed-caption,.channel-post-toolbar,.channel-post-count')).toHaveCount(0)
  await tabs.getByRole('button',{name:'Author information '+a.name,exact:true}).click();await expect(page.getByRole('dialog',{name:'Author information',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close information',exact:true}).click();await expect(page.getByRole('dialog',{name:'Author information',exact:true})).toHaveCount(0)
  for(const [label,selector] of [['Channel view','.channel-news-item'],['Board view','.channel-post-card'],['Posts view','.channel-posts-item']]){
   await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('button',{name:'Reply to message',exact:true})).toHaveCount(0)
   await selectSource(a).click();await expect(selectSource(a)).toHaveAttribute('aria-pressed','true');await expect(page.locator(selector)).toHaveCount(1);await expect(page.locator(selector)).toContainText(a.name+' story')
   await selectSource(b).click();await expect(selectSource(b)).toHaveAttribute('aria-pressed','true');await expect(page.locator(selector)).toHaveCount(2)
   await selectSource(b).click();await expect(selectSource(b)).toHaveAttribute('aria-pressed','false');await expect(page.locator(selector)).toHaveCount(1);await expect(page.locator(selector)).toContainText(a.name+' story')
   await allSources.click();await expect(allSources).toHaveAttribute('aria-pressed','true');await expect(page.locator(selector)).toHaveCount(2)
   await allSources.click();await expect(selectSource(a)).toHaveAttribute('aria-pressed','true');await expect(allSources).toHaveAttribute('aria-pressed','false');await expect(page.locator(selector)).toHaveCount(1)
   await selectSource(empty).click();await expect(page.locator(selector)).toHaveCount(1)
   await selectSource(a).click();await expect(page.locator(selector)).toHaveCount(0)
   await selectSource(empty).click();await expect(page.locator(selector)).toHaveCount(2)
  }
  await page.getByRole('button',{name:'Board view',exact:true}).click();await page.screenshot({path:path.join(out,plugin+'-compact.png'),animations:'disabled'})
  await page.getByRole('button',{name:'Downloaded files',exact:true}).click();await expect(page.getByRole('dialog',{name:'Downloaded files',exact:true})).toBeVisible();await expect(page.locator('.conversation-workspace-locations')).toHaveCount(0);await page.getByRole('button',{name:'Close downloaded files',exact:true}).click()
  await page.getByRole('button',{name:'Manage channels and authors',exact:true}).click();await page.getByRole('button',{name:'Channel settings',exact:true}).click();await expect(page.getByRole('button',{name:'Configure engine',exact:true})).toBeVisible();await page.getByRole('button',{name:'Configure engine',exact:true}).click();await expect(page.locator('.channel-publisher-picker,input[name="channel-publishing-engine"]')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Process name',exact:true})).toBeVisible();await page.keyboard.press('Escape')
  pass(plugin+': one compact channel, searchable multi-select source chips in all views; no membership/governance/reply/composer UI, downloads have no member folders, settings only configure external collectors')
 }
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,modelCalls:0,application:application||'source'},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
