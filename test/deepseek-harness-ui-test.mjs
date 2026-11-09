import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-ui-'))
let f,app
try{
 f=await fixtureCore({DSH_HOME:temp,DEEPSEEK_BIN:process.env.AGENTS_TEST_DSH_BIN||'/missing/dsh',DEEPSEEK_API_KEY:''});await f.stop()
 const env={...f.env,AGENTS_COMPANY_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:require('electron'),args:[root],env})
 const page=await app.firstWindow();page.setDefaultTimeout(20000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await call('settings.set',{language:'en'});await call('group.add',{name:'Local',mode:'build'})
 await call('view.open',{kind:'settings'})
 const section=page.locator('.settings-engines');if(!await section.evaluate(el=>el.open))await section.locator(':scope > summary').click()
 const card=page.locator('[data-engine-health="deepseek"]');await card.scrollIntoViewIfNeeded();await expect(card).toContainText('DeepSeek Harness')
 await call('view.open',{kind:'home'});await page.locator('.add-employee').click()
 const choice=page.locator('.engine-choices button[data-engine="deepseek"]');await expect(choice).toBeVisible();await expect(choice).toContainText('DeepSeek Harness');await choice.click();await expect(choice).toHaveAttribute('aria-pressed','true')
 assert.deepEqual(errors,[])
 console.log('PASS hidden macOS UI: Harness settings card and employee engine choice; no inference')
}finally{await app?.close();await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
