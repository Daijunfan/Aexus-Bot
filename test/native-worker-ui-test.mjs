// Hidden real desktop, raw native CLI fixtures and real profile controls; no inference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-native-ui-'))),control=path.join(temp,'fixture'),capture=path.join(temp,'capture.jsonl')
fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'')
const fixture=path.join(root,'test/fixtures/native-worker.cjs');fs.chmodSync(fixture,0o755)
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1',CODEX_BIN:fixture,CLAUDE_BIN:fixture,CLINE_BIN:fixture,PI_BIN:fixture,CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:control,NATIVE_WORKER_CAPTURE:capture}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/native-workers-ui')
fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
const events=()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'});await call('group.add',{name:'Worker profile'})
 const employee=await call('card.create',{title:'Owner employee',group:'Worker profile',engine:'codex',model:'gpt-6-luna'})
 await expect.poll(async()=>(await call('session.status',{employee:employee.id}))[0].initialization.status).toBe('ready')
 await call('view.open',{kind:'employee',employee:employee.id});await page.getByRole('tab',{name:'Workers',exact:true}).click()
 const panel=page.locator('[data-native-workers]')
 for(const engine of ['codex','claude','cline','pi']){
  await panel.getByRole('button',{name:'创建 Worker',exact:true}).click();await panel.getByLabel('Worker engine').selectOption(engine);await panel.getByLabel('Worker name').fill(engine+' native Worker');await panel.getByRole('button',{name:'创建',exact:true}).click();await expect(panel.locator('[data-native-worker]')).toHaveCount(['codex','claude','cline','pi'].indexOf(engine)+1)
 }
 assert.equal(events().length,0);assert.equal((await call('session.list')).sessions.length,1)
 for(const engine of ['codex','claude','cline','pi'])await expect(panel.locator(`[data-engine-mark="${engine}"]`)).toHaveCount(1)
 await expect(panel.locator('.message-avatar,.canvas-avatar,.mascot')).toHaveCount(0)
 const tabBoxes=await page.locator('.profile-tabs>[role=tab]').evaluateAll(tabs=>tabs.map(tab=>({top:tab.getBoundingClientRect().top,width:tab.getBoundingClientRect().width})));assert.equal(new Set(tabBoxes.map(tab=>tab.top)).size,1);assert.ok(tabBoxes.every(tab=>tab.width>60))
 pass('Employee profile creates all four native engines as Worker records with engine icons, no animated character or employee onboarding')
 const first=panel.locator('[data-native-worker]').first();await first.getByRole('button',{name:'启动',exact:true}).click();await expect(panel.locator('.native-worker-terminal .xterm-screen')).toHaveCount(1)
 await expect.poll(()=>events().filter(event=>event.type==='start').length).toBe(1)
 const id=await first.getAttribute('data-native-worker');await expect.poll(async()=>(await call('worker.read',{id})).output).toContain('NATIVE WORKER READY')
 await panel.locator('.xterm-helper-textarea').focus();await page.keyboard.type('native task');await page.keyboard.press('Enter');await expect.poll(()=>events().filter(event=>event.type==='input').map(event=>event.text).join('')).toContain('native task\r')
 pass('The real xterm viewport controls the native process with literal keyboard input')
 await page.screenshot({path:path.join(out,'workers-light.png')});await call('settings.set',{theme:'black'});await page.screenshot({path:path.join(out,'workers-dark.png')})
 await first.getByRole('button',{name:'中断',exact:true}).click();await expect.poll(async()=>(await call('worker.list',{employee:employee.id}))[0].running).toBe(false)
 await first.getByRole('button',{name:'启动',exact:true}).click();await expect.poll(()=>events().filter(event=>event.type==='start').length).toBe(2)
 await first.getByRole('button',{name:'停止',exact:true}).click();await expect.poll(async()=>(await call('worker.list',{employee:employee.id}))[0].running).toBe(false)
 await first.getByRole('button',{name:'移除',exact:true}).click();await expect(panel.locator('[data-native-worker]')).toHaveCount(3)
 assert.ok(events().filter(event=>event.type==='start').every(event=>event.argv.length===0&&!event.keys.some(key=>/^(AGENTS_|AEXUS_)/.test(key))))
 pass('Native interrupt/restart/stop/remove work through UI; restarts receive no context or Company credentials')
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks,errors,providerCalls:0},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
