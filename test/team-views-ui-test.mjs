import {desktopExecutable} from './fixtures/desktop-app.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'

const require=createRequire(import.meta.url),{_electron:electron,expect}=require('@playwright/test'),run=promisify(execFile),root=path.resolve(import.meta.dirname,'..')
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-agents-nav-ui-')))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'960'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP)||require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env}),page=await app.firstWindow()
const cli=async(...args)=>{const reply=JSON.parse((await run(process.execPath,[root+'/bin/agents',...args,'--json'],{env,timeout:20000})).stdout);assert.ok(reply.ok,reply.error);return reply.data}
const errors=[];page.on('pageerror',error=>errors.push(error.message))
try{
  await page.locator('.infinite-canvas').waitFor()
  for(const name of ['Alpha','Beta'])await cli('group','add',name)
  await expect(page.locator('[data-department="Alpha"]')).toHaveCount(1)
  await expect(page.locator('[data-department="Beta"]')).toHaveCount(1)

  const agents=page.locator('.company-navigation').getByRole('button',{name:'Team',exact:true})
  const message=page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true})
  await expect(agents).toBeVisible();await expect(message).toBeVisible()
  await expect(page.locator('.company-navigation').getByRole('button',{name:'Messages',exact:true})).toHaveCount(0)
  await expect(page.locator('.company-view-menu')).toHaveCount(0)
  assert.equal(await agents.getAttribute('aria-haspopup'),null)
  assert.equal(await page.locator('.company-view-trigger').getAttribute('aria-expanded'),null)

  // A saved subview still exists, but the Agents tab never exposes or selects it.
  const focus=await cli('team-view','create','--name','Focus','--teams','["Alpha"]')
  await cli('team-view','select',focus.id)
  await expect(page.locator('[data-department="Beta"]')).toHaveCount(0)
  await expect(agents).toBeVisible()
  await expect(page.locator('.company-view-trigger')).toHaveAttribute('title','Agents')

  // Selecting Agents resolves the stable main view and keeps every saved view intact.
  await agents.click()
  await expect(page.locator('[data-department="Alpha"]')).toHaveCount(1)
  await expect(page.locator('[data-department="Beta"]')).toHaveCount(1)
  const saved=await cli('team-view','list')
  const kept=saved.views.find(view=>view.id===focus.id)
  assert.ok(kept,'saved team view identity is preserved')
  assert.deepEqual(kept.teams,['Alpha'])

  await message.click()
  await expect(page.locator('.message-view')).toBeVisible()
  await page.locator('.company-navigation').getByRole('button',{name:'Team',exact:true}).click()
  await expect(page.locator('.infinite-canvas')).toBeVisible()

  // Chinese labels stay singular/wording: 消息 and 员工, without the removed subview picker.
  await cli('settings','set','--language','zh-CN')
  await page.reload();await page.locator('.infinite-canvas').waitFor()
  await expect(page.locator('.company-navigation').getByRole('button',{name:'员工',exact:true})).toBeVisible()
  await expect(page.locator('.company-navigation').getByRole('button',{name:'消息',exact:true})).toBeVisible()
  await expect(page.locator('.company-view-menu')).toHaveCount(0)

  assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
  assert.deepEqual(errors,[])
  console.log('PASS Agents/Message navigation: single Agents entry, stable main view, saved views preserved, no subview picker')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
