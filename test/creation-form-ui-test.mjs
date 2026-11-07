import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-creation-ui-'))),control=path.join(temp,'fixture')
fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'')
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_HIDDEN:'1',CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:control}
delete env.ELECTRON_RUN_AS_NODE
const require=createRequire(import.meta.url),{_electron:electron,expect}=require('@playwright/test'),run=promisify(execFile)
const app=await electron.launch({executablePath:process.env.AGENTS_COMPANY_TEST_APP?desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP):require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env}),page=await app.firstWindow()
const cli=async(...args)=>{const response=JSON.parse((await run(process.execPath,[root+'/bin/agents',...args,'--json'],{env,timeout:20000})).stdout);assert.ok(response.ok,response.error);return response.data}
try{
  await page.locator('.infinite-canvas').waitFor()
  await cli('group','add','Alpha')
  const card=await cli('card','create','--title','Original','--group','Alpha','--avatar','rocky','--engine','codex','--model','gpt-6-luna','--effort','low')
  await expect.poll(async()=>(await cli('session','status','--employee',card.id))[0].initialization.status).toBe('ready')
  await cli('room','design','Alpha','--theme','rose');await cli('room','bounds','Alpha','--width','900','--height','640','--shape','ellipse')
  assert.equal((await cli('room','layout','Alpha')).bounds.width,900)
  await page.locator('.add-team').click()
  await expect(page.locator('.team-form select[name="shape"],.team-form input[name="width"],.team-form input[name="subtitle"],.team-form .room-theme-options')).toHaveCount(0)
  await expect(page.locator('.team-form input[name="team-name"]')).toHaveValue('')
  const environment=page.getByRole('group',{name:'Team type'}),local=environment.locator('[data-mode="build"]'),cloud=environment.locator('[data-mode="cloud"]')
  for(const theme of ['white','black']){
    await cli('settings','set','--theme',theme)
    for(const [chosen,other,mode] of [[cloud,local,'cloud'],[local,cloud,'local']]){
      await chosen.click();await expect(chosen).toHaveAttribute('aria-pressed','true');await expect(other).toHaveAttribute('aria-pressed','false')
      await expect(chosen.locator('.codicon-check')).toHaveCount(1);await expect(other.locator('.codicon-check')).toHaveCount(0)
      assert.notEqual(await chosen.evaluate(e=>getComputedStyle(e).backgroundColor),await other.evaluate(e=>getComputedStyle(e).backgroundColor),'selected environment has a visibly distinct fill')
      await expect(page.locator('select[name="cloud-host-id"]')).toHaveCount(mode==='cloud'?1:0)
      await environment.screenshot({path:path.join(root,`artifacts/team-environment-${mode}-${theme}.png`)})
    }
  }
  await page.locator('.panel-close').click()
  await page.locator('.add-employee').click()
  await expect(page.locator('.employee-form select[name="group"]')).toHaveValue('Alpha')
  await expect(page.locator('.employee-form select[name="model"]')).toHaveValue('gpt-6-luna')
  await expect(page.locator('.employee-form .avatar-options')).toHaveCount(0)
  await expect(page.locator('.employee-advanced-settings')).not.toHaveAttribute('open','')
  await expect(page.locator('.employee-form .random-appearance')).toBeVisible()
  await expect(page.locator('.employee-form input[name="title"]')).toHaveValue('')
  await page.locator('.panel-close').click()
  const originalRoot=(await cli('session','list')).teamRoots.Alpha
  await cli('view','open','team','--name','Alpha')
  await expect(page.locator('.team-mode-options')).toHaveCount(0)
  await expect(page.locator('.team-form input[name="team-name"]')).toBeEditable()
  await page.locator('.team-form input[name="team-name"]').fill('Renamed Team')
  await page.locator('.save-team').click()
  await expect(page.locator('.team-form')).toHaveCount(0)
  const renamedTeam=await cli('session','list')
  assert.equal(renamedTeam.teamRoots['Renamed Team'],originalRoot)
  assert.equal(renamedTeam.sessions.find(value=>value.id===card.id).cwd,card.cwd)
  await cli('view','open','conversation','--employee',card.id)
  await page.getByRole('button',{name:'Employee details',exact:true}).click()
  await page.getByRole('button',{name:'Edit profile',exact:true}).click()
  await expect(page.locator('.employee-form input[name="title"]')).toBeEditable()
  await expect(page.locator('.employee-form select[name="group"]')).toBeDisabled()
  await expect(page.getByRole('button',{name:'Remove employee',exact:true})).toHaveCount(0)
  await page.locator('.employee-form input[name="title"]').fill('Renamed')
  await page.locator('.save-employee').click()
  await cli('view','open','conversation','--employee',card.id)
  await expect(page.locator('.session-heading')).toContainText('Renamed')
  const saved=(await cli('session','list')).sessions.find(value=>value.id===card.id)
  assert.equal(saved.cwd,card.cwd)
  await page.locator('.employee-more summary').click()
  await page.getByRole('button',{name:'Delete conversation',exact:true}).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button',{name:'cancel',exact:true}).click()
  assert.ok((await cli('session','list')).sessions.some(value=>value.id===card.id))
  await cli('view','close');await cli('card','remove',card.id)
  await page.locator('.add-employee').click()
  await expect(page.locator('.employee-form select[name="model"]')).toHaveValue('gpt-6-luna')
  await expect(page.locator('.employee-form .avatar-options')).toHaveCount(0)
  await expect(page.locator('.employee-advanced-settings')).not.toHaveAttribute('open','')
  await expect(page.locator('.employee-form .random-appearance')).toBeVisible()
  await page.locator('.panel-close').click()
  await cli('group','remove','Renamed Team')
  await page.locator('.add-team').click()
  await expect(page.locator('.team-form input[name="width"],.team-form .room-theme-options')).toHaveCount(0)
  await page.locator('input[name=team-name]').fill('Fresh One');await page.locator('.save-team').click()
  await page.locator('.add-team').click();await page.locator('input[name=team-name]').fill('Fresh Two');await page.locator('.save-team').click()
  const designs=(await cli('session','list')).rooms
  assert.notEqual(designs['Fresh One'].design.theme,designs['Fresh Two'].design.theme)
  await page.locator('.add-employee').click();await page.locator('input[name=title]').fill('Compact employee')
  await page.locator('.appearance-actions button[aria-expanded]').click()
  await expect(page.locator('.avatar-options')).toBeVisible()
  await page.locator('.avatar-options button').filter({has:page.locator('[data-avatar=rocky]')}).click()
  await page.locator('.appearance-actions button[aria-expanded]').click()
  await expect(page.locator('.avatar-options')).toHaveCount(0)
  await page.locator('.save-employee').click();await expect(page.locator('.employee-form')).toHaveCount(0)
  const compact=(await cli('session','list')).sessions.find(c=>c.title==='Compact employee')
  assert.equal(compact.avatar,'rocky');assert.equal(compact.managementRole??'employee','employee')
  assert.equal(compact.kind??'worker','worker')
  await expect.poll(async()=>(await cli('session','status','--employee',compact.id))[0].initialization.status).toBe('ready')
  assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
  console.log('PASS hidden compact forms: essentials only, varied Team colors, collapsed advanced settings, random appearance control, optional character picker, real fixture employee creation and editable details')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
