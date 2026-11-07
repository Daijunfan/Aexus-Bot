// Real group routing and native protocol fixtures; no model inference or user data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url)
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-thinking-'))),control=path.join(temp,'fixture')
fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'')
const output=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/group-thinking')
fs.mkdirSync(output,{recursive:true})
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1',CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:control}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const app=await electron.launch({executablePath:process.env.AGENTS_COMPANY_TEST_APP?desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP):require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env})
const page=await app.firstWindow(),errors=[],checks=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
const status=async id=>(await call('session.status',{employee:id}))[0]
const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{theme:'white',language:'en'})
 await call('group.add',{name:'Thinking fixture'})
 const employees=[]
 for(const [title,avatar] of [['Aster','fate-saber-chibi'],['Byte','byte'],['Private worker','rocky']])employees.push(await call('card.create',{title,avatar,group:'Thinking fixture',engine:'codex',model:'gpt-6-luna'}))
 for(const employee of employees)await expect.poll(async()=>(await status(employee.id)).initialization.status).toBe('ready')
 const [a,b,c]=employees,group=await call('chat.create',{name:'Thinking room',members:employees.map(e=>e.id)}),other=await call('chat.create',{name:'Other room',members:[a.id]})
 for(const employee of employees)fs.writeFileSync(path.join(control,employee.id+'.hold-user'),'')
 for(const employee of [a,b])fs.writeFileSync(path.join(control,employee.id+'.hold-ack'),'')
 await call('session.send',{employee:c.id,text:'Unrelated private work'})
 await expect.poll(async()=>(await status(c.id)).busy).toBe(true)
 await call('view.open',{kind:'messages',chatId:group.id})
 await expect(page.locator('.group-typing-row')).toHaveCount(0)
 await call('chat.send',{id:group.id,text:'Review the fixture together',mentions:[a.id,b.id],clientMessageId:'thinking-ui'})
 for(const employee of [a,b])await expect.poll(async()=>(await status(employee.id)).acknowledging).toBe(true)
 await expect(page.locator('.group-typing-row')).toHaveCount(2)
 for(const employee of [a,b])fs.unlinkSync(path.join(control,employee.id+'.hold-ack'))
 pass('Thinking appears during native group acknowledgment before the main response starts')
 for(const employee of [a,b])await expect.poll(async()=>{const s=await status(employee.id);return s.busy&&s.currentTask?.chat?.groupId===group.id}).toBe(true)
 await expect(page.locator('.group-typing-row')).toHaveCount(2)
 await expect(page.locator(`[data-typing-employee="${c.id}"]`)).toHaveCount(0)
 for(const employee of [a,b])await expect(page.locator(`[data-typing-employee="${employee.id}"] .group-typing-dots>i`)).toHaveCount(3)
 const dots=page.locator(`[data-typing-employee="${a.id}"] .group-typing-dots>i`)
 assert.deepEqual(await dots.evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).animationDelay)),['0s','0.16s','0.32s'])
 const before=await dots.evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).transform));await page.waitForTimeout(210)
 assert.notDeepEqual(await dots.evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).transform)),before)
 await page.waitForTimeout(2100)
 await expect(page.locator(`[data-typing-employee="${a.id}"] .message-list-avatar`)).toHaveAttribute('data-avatar-playing','true')
 await page.screenshot({path:path.join(output,'thinking-light.png')})
 pass('Two genuinely running group members have moving three-dot bubbles and continuously working characters; unrelated private work stays out')
 await call('view.open',{kind:'messages',chatId:other.id});await expect(page.locator('.group-typing-row')).toHaveCount(0)
 await call('view.open',{kind:'messages',chatId:group.id});await expect(page.locator('.group-typing-row')).toHaveCount(2)
 await page.getByRole('button',{name:'Company Views',exact:true}).click()
 await expect(page.locator(`.employee[data-card-id="${a.id}"]`)).toHaveAttribute('data-state','working')
 await call('view.open',{kind:'messages',chatId:group.id})
 pass('Activity is scoped to its own group and the same employee is working on the Company canvas')
 await call('settings.set',{theme:'black'});await page.screenshot({path:path.join(output,'thinking-dark.png')})
 await page.emulateMedia({reducedMotion:'reduce'})
 await expect(page.locator('.group-thinking-members')).toHaveAttribute('data-animate','false')
 await expect(dots.first()).toHaveCSS('animation-name','none')
 await expect(page.locator(`[data-typing-employee="${a.id}"] .message-list-avatar`)).not.toHaveAttribute('data-avatar-playing','true')
 assert.equal((await status(a.id)).busy,true)
 await page.emulateMedia({reducedMotion:'no-preference'})
 await expect(page.locator('.group-thinking-members')).toHaveAttribute('data-animate','true')
 pass('Both themes render correctly; reduced motion stops visual playback without interrupting work')
 fs.unlinkSync(path.join(control,a.id+'.hold-user'))
 await expect.poll(async()=>(await status(a.id)).busy).toBe(false)
 await expect(page.locator(`[data-typing-employee="${a.id}"]`)).toHaveCount(0)
 await expect(page.locator(`[data-typing-employee="${b.id}"]`)).toHaveCount(1)
 await call('session.interrupt',{id:(await status(b.id)).sessionId})
 await expect(page.locator('.group-typing-row')).toHaveCount(0)
 assert.equal((await status(c.id)).busy,true)
 assert.equal((await call('chat.history',{id:group.id})).messages.length,1,'thinking bubbles are transient UI, never chat records')
 pass('Completion and interruption remove only the matching indicators; queued members never pretend to be thinking and no fake messages are persisted')
 assert.deepEqual(errors,[])
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,rendererErrors:errors,modelCalls:0,productionDataUsed:false},null,2)+'\n')
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error}
finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
