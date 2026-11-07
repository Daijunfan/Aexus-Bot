// Deterministic rendering regression supplements (does not replace) actual-model logical acceptance.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/message-speech/ui')),require=createRequire(import.meta.url),f=await fixtureCore();fs.mkdirSync(out,{recursive:true});let app,page
try{
 await f.cli('group','add','Speech rendering');const card=await f.create('Mira','Speech rendering'),at=Date.now()
 await f.stop();const original=[
  {role:'user',id:'u-question',text:'Please inspect the invoice.',createdAt:at},
  {role:'assistant',id:'a-mixed',createdAt:at+1,blocks:[{kind:'text',text:'The net amount is 359.5.'},{kind:'thinking',id:'reasoning',text:'HIDDEN_REASONING',done:true},{kind:'tool',id:'call',name:'Bash',input:{command:'HIDDEN_COMMAND'},result:'HIDDEN_TOOL_RESULT',running:false}]},
  {role:'assistant',id:'a-tool-only',createdAt:at+2,blocks:[{kind:'tool',id:'only',name:'Read',input:{path:'HIDDEN_FILE'},result:'HIDDEN_FILE_BODY',running:false}]},
  {role:'notice',id:'notice',text:'HIDDEN_SYSTEM_NOTICE',tone:'info'},
  {role:'assistant',id:'a-json',createdAt:at+3,blocks:[{kind:'text',text:'{"command":"chat.post","text":"This is quoted speech, not publication"}'}]}
 ]
 const dir=path.join(f.env.AGENTS_COMPANY_HOME,'transcripts');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,card.id+'.json'),JSON.stringify(original))
 const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1280',AGENTS_COMPANY_HEIGHT:'900'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'no-preference'})
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'});await call('view.open',{kind:'messages',employee:card.id})
 await expect(page.locator('.message-conversation .transcript .turn.assistant')).toHaveCount(2)
 const area=page.locator('.message-conversation .transcript');await expect(area).toContainText('The net amount is 359.5.');await expect(area).toContainText('This is quoted speech, not publication')
 await expect(area.locator('.thinking,.tool,.notice,.command-data')).toHaveCount(0);assert.ok(!(await area.innerText()).includes('HIDDEN_'));await expect(area.locator('[data-chat-item="a-tool-only"]')).toHaveCount(0)
 const native=(await call('session.transcript',{employee:card.id})).items;assert.deepEqual(native,original)
 await call('view.open',{kind:'conversation',employee:card.id});await expect(page.locator('.transcript .tool')).toHaveCount(2);await expect(page.locator('.transcript .thinking')).toHaveCount(1);await expect(page.locator('.transcript .notice')).toHaveCount(1)
 await call('view.open',{kind:'messages',employee:card.id});fs.writeFileSync(path.join(f.control,card.id+'.hold-user'),'');await call('session.send',{employee:card.id,text:'Held deterministic work'})
 await expect(page.locator('.private-working')).toBeVisible();await expect(page.locator('.private-working .group-typing-dots i')).toHaveCount(3);await page.waitForTimeout(2300);await expect(page.locator('.private-working')).toBeVisible()
 await page.locator('.message-conversation').screenshot({path:path.join(out,'private-working.png'),animations:'disabled'})
 fs.rmSync(path.join(f.control,card.id+'.hold-user'));await expect(page.locator('.private-working')).toHaveCount(0)
 await page.locator('.message-conversation').screenshot({path:path.join(out,'private-speech.png'),animations:'disabled'})
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks:['Messages shows only speech/quoted JSON without empty debug rows','Company/native history remains byte-for-byte complete','Busy indicator persists past2.3seconds and ends on completion'],modelCalls:0},null,2)+'\n')
 console.log('PASS hidden private speech/JSON projection, unchanged native history, full Company details, durable working dots and completion cleanup')
}finally{await app?.close();await f.close()}
