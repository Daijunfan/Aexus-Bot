// All picker checks run in an isolated hidden desktop, with fixture-only employees.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-picker-ui-'))),fixture=path.join(temp,'fixture')
fs.mkdirSync(fixture);fs.writeFileSync(path.join(fixture,'release-all'),'')
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_HIDDEN:'1',CODEX_HOME:path.join(temp,'codex'),CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),AC_INIT_FIXTURE:fixture}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/channel-performance/pickers');fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[],checks=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'})
 for(const team of ['Design','Operations'])await call('group.add',{name:team})
 const alice=await call('card.create',{title:'Alice',group:'Design',engine:'codex',model:'gpt-6-luna',effort:'low'}),bob=await call('card.create',{title:'Bob',group:'Operations',engine:'codex',model:'gpt-6-luna',effort:'low'})
 await expect.poll(async()=>(await call('session.status',{})).every(x=>x.initialization?.status==='ready')).toBe(true)
 await call('view.open',{kind:'messages'});await page.getByRole('button',{name:'New group',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'New group',exact:true}),team=dialog.locator('.app-select:has(select[name="chat-team"]) .app-select-trigger')
 await expect(dialog).toBeVisible();await expect(dialog.locator('select[name="chat-team"]')).toHaveAttribute('aria-hidden','true');assert.equal(await dialog.locator('select[name="chat-team"]').evaluate(el=>el.inert),true)
 await team.click();const menu=page.getByRole('listbox');await expect(menu).toBeVisible();await page.getByRole('option',{name:'Design',exact:true}).click()
 await expect(dialog.locator('select[name="chat-owner"]')).toHaveValue(alice.id)
 await team.click();await page.getByRole('option',{name:'Operations',exact:true}).click()
 const owner=dialog.locator('.app-select:has(select[name="chat-owner"]) .app-select-trigger');await owner.click();await page.getByRole('option',{name:'Bob',exact:true}).click();await expect(dialog.locator('select[name="chat-owner"]')).toHaveValue(bob.id)
 await owner.click();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(dialog).toBeVisible()
 pass('New group Team/Owner use app-rendered menus; import/owner selection and Escape work without a native macOS popup')
 const colors=[]
 for(const theme of ['white','black']){await call('settings.set',{theme});await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await team.click();await expect(menu).toBeVisible();colors.push(await menu.evaluate(el=>getComputedStyle(el).backgroundColor));await page.screenshot({path:path.join(out,'group-'+theme+'.png'),animations:'disabled'});await page.keyboard.press('Escape')}
 assert.notEqual(colors[0],colors[1]);await expect(dialog.locator('select:not(.app-select-native)')).toHaveCount(0)
 pass('Picker menus follow both application themes and retain the dialog keyboard/focus boundary')
 const files=[];const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else if(p.endsWith('.tsx'))files.push(p)}};walk(path.join(root,'src/renderer/src'))
 const raw=files.filter(p=>path.basename(p)!=='AppSelect.tsx'&&/<select\b|<datalist\b/.test(fs.readFileSync(p,'utf8')));assert.deepEqual(raw,[])
 pass('All main-app selects and suggestion lists use the shared styled picker, across group, message, plan, settings and Worker forms')
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 const source=await call('channel.source-add',{plugin:'x',locator:'virtualfeed',name:'Virtual feed'})
 for(let i=0;i<120;i++)await call('channel.publish',{sourceId:source.id,externalId:'virtual-'+i,publishedAt:Date.now()-i*1000,title:'Lightweight item '+i,body:'A deterministic scrolling fixture. '.repeat(4)})
 await call('view.open',{kind:'messages',channelId:source.channelId});await page.getByRole('button',{name:'Posts view',exact:true}).click()
 const viewport=page.locator('.channel-posts-timeline .message-viewport')
 await expect(viewport).toHaveAttribute('data-message-count','24')
 for(const count of [48,72,96,120]){await page.locator('.channel-feed').evaluate(el=>el.scrollTop=el.scrollHeight);await expect.poll(async()=>Number(await viewport.getAttribute('data-message-count'))).toBeGreaterThanOrEqual(count)}
 assert.ok(await page.locator('.channel-posts-item').count()<60,'offscreen posts must be recycled')
 await page.locator('.channel-feed').evaluate(el=>el.scrollTop=0);await expect(page.locator('.channel-posts-item').first()).toBeVisible()
 pass('Long Posts feeds recycle offscreen rows while retaining scrolling history; 120 entries do not create 120 mounted cards')
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,application:application||'source',modelCalls:0},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
