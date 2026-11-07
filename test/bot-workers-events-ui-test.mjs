import {desktopExecutable} from './fixtures/desktop-app.mjs'
// Event-only Plan editor against a disposable Core and a hidden Electron window.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-events-ui-'))),control=path.join(temp,'fixture'),output=path.join(root,'artifacts/bot-workers')
fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'');fs.mkdirSync(output,{recursive:true})
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1200',AGENTS_COMPANY_HEIGHT:'1000',CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:control}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_PORT','AGENTS_COMPANY_URL','AGENTS_COMPANY_CLIENT','AGENTS_COMPANY_WEB_URL'].includes(key))delete env[key]
const app=await electron.launch({executablePath:desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP)||require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(e){throw Error(e?.message??e?.error??JSON.stringify(e))}},{cmd,args})
try{
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',viewAppearance:{plan:{theme:'white'}}})
 await call('group.add',{name:'Studio'})
 const a=await call('card.create',{title:'Aster',group:'Studio',engine:'codex',model:'gpt-6-luna',avatar:'fate-saber-anime'}),b=await call('card.create',{title:'Byte',group:'Studio',engine:'codex',model:'gpt-6-luna',avatar:'byte'})
 await expect.poll(async()=>(await call('session.status')).every(card=>card.initialization?.status==='ready')).toBe(true)
 const chat=await call('chat.create',{name:'Release watch',members:[a.id,b.id]}),channel=await call('channel.create',{name:'Release desk',engine:{kind:'external',location:'local',name:'Fixture publisher'}}),monitor=await call('monitor.create',{name:'Release feed',program:[process.execPath,'-e','process.exit(0)'],employee:a.id})
 const ca=await call('channel.access',{id:channel.id});await call('channel.access',{id:channel.id,employeeIds:[a.id,b.id],expectedRevision:ca.revision})
 const spec=(name,rule)=>({name,action:{type:'agent',employeeId:a.id,prompt:'Review the event and keep the team informed.'},rule})
 const signal=await call('schedule.create',{spec:spec('Legacy signal watch',{kind:'event',event:'signal',cooldownSeconds:7})})
 const posted=await call('schedule.create',{spec:spec('Legacy channel watch',{kind:'event',event:'channel.posted',channelId:channel.id,cooldownSeconds:30})})
 await page.getByRole('button',{name:'Mission',exact:true}).click();await expect(page.locator('.plan-view')).toBeVisible()
 const editor=page.locator('.plan-editor'),field=name=>editor.locator('[name=plan-'+name+']'),open=async id=>{await page.locator(`.plan-table [data-plan-id="${id}"]`).click();await expect(editor).toBeVisible()},save=async()=>{await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor).toHaveCount(0)}
 // Existing signal and channel.posted schedules keep their exact source and cooldown.
 await open(signal.id);await expect(field('event')).toHaveValue('signal');await expect(field('cooldown')).toHaveValue('7');assert.equal(await field('event-conversation').count(),0);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
 await open(posted.id);await expect(field('event')).toHaveValue('channel.posted');await expect(field('event-channel')).toHaveValue(channel.id);await expect(field('cooldown')).toHaveValue('30');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
 // New editor exposes six events and only the matching source field.
 await page.getByRole('button',{name:'New schedule',exact:true}).click();await expect(editor).toBeVisible();await field('name').fill('Release reply watch');await field('employee').selectOption(a.id);await field('prompt').fill('Review each release reply and continue the delegated work.');await field('mode').selectOption('event')
 await expect(field('event').locator('option')).toHaveCount(6);assert.deepEqual(await field('event').locator('option').evaluateAll(nodes=>nodes.map(node=>node.textContent)),['API signal','Channel post','Message received','Session completed','Monitor output','Monitor exit'])
 await field('event').selectOption('message.received');await expect(field('event-conversation').locator(`option[value="group:${chat.id}"]`)).toHaveCount(1);await expect(field('event-conversation').locator(`option[value="employee:${a.id}"]`)).toHaveCount(1);await field('event-conversation').selectOption('group:'+chat.id);await field('cooldown').fill('0');await editor.getByRole('button',{name:'Validate event rule',exact:true}).click();await expect(editor.locator('.plan-preview-empty')).toContainText('Event rule valid')
 await editor.getByRole('button',{name:'Create schedule',exact:true}).click();await expect(editor).toHaveCount(0)
 const watch=(await call('schedule.list')).find(job=>job.name==='Release reply watch');assert.deepEqual(watch.rule,{kind:'event',event:'message.received',conversation:'group:'+chat.id,cooldownSeconds:0});await expect(page.locator(`.plan-table [data-plan-id="${watch.id}"]`)).toContainText('On message received')
 // Switching the saved watch to a session source omits the conversation, then a monitor source omits the employee.
 await open(watch.id);await field('event').selectOption('session.completed');assert.equal(await field('event-conversation').count(),0);await field('event-employee').selectOption(a.id);await save();assert.deepEqual((await call('schedule.get',{id:watch.id})).rule,{kind:'event',event:'session.completed',employeeId:a.id,cooldownSeconds:0})
 await open(watch.id);await field('event').selectOption('monitor.output');await expect(field('event-monitor').locator(`option[value="${monitor.id}"]`)).toHaveCount(1);await field('event-monitor').selectOption(monitor.id);await save();assert.deepEqual((await call('schedule.get',{id:watch.id})).rule,{kind:'event',event:'monitor.output',monitorId:monitor.id,cooldownSeconds:0});await expect(page.locator(`.plan-table [data-plan-id="${watch.id}"]`)).toContainText('On monitor output')
 // A removed source stays visible instead of being silently replaced; no monitors shows the compact CLI/API placeholder.
 await call('monitor.remove',{id:monitor.id});await open(watch.id);await expect(field('event-monitor')).toHaveValue(monitor.id);await expect(field('event-monitor').locator('option:checked')).toContainText('Unavailable source');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
 await page.getByRole('button',{name:'New schedule',exact:true}).click();await field('mode').selectOption('event');await field('event').selectOption('monitor.exited');await expect(field('event-monitor').locator('option').first()).toContainText('No monitors · create one via CLI/API');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0)
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(win=>!win.isVisible())))
 console.log('PASS event-only Plan editor: six sources, canonical group/employee refs, monitor name/status and placeholder, missing-source preservation, source-specific rule fields, legacy signal/channel edits intact; disposable Core and hidden Electron only')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
