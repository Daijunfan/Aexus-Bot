import {fixtureCore} from './fixtures/headless-core.mjs'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),{_electron:electron,expect}=require('@playwright/test'),f=await fixtureCore(),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/creation-forms');fs.mkdirSync(out,{recursive:true});await f.stop()
const env={...f.env,AGENTS_COMPANY_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE
const application=process.env.AGENTS_COMPANY_TEST_APP,app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message))
const cli=(...args)=>f.cli(...args)
try{
  // Message view opens directly; Team navigation and canvas/team forms are absent.
  await page.locator('.message-view').waitFor()
  await expect(page.locator('.company-navigation').getByRole('button',{name:'Team',exact:true})).toHaveCount(0)
  await expect(page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true})).toBeVisible()
  await expect(page.locator('.company-navigation').getByRole('button',{name:'Mission',exact:true})).toBeVisible()
  await expect(page.locator('.agent-board,.add-team,.team-form')).toHaveCount(0)

  await cli('avatar','update','rocky','--enabled','true')

  // Open employee creation from Message view sidebar.
  await page.getByRole('button',{name:'Conversation list options',exact:true}).click()
  await page.getByRole('menuitem',{name:'Add Employee',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Create employee',exact:true})
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.employee-form select[name="group"]')).toHaveCount(0)
  await expect(dialog.locator('.employee-form .avatar-options')).toHaveCount(0)
  await expect(dialog.locator('.employee-advanced-settings')).not.toHaveAttribute('open','')
  await expect(dialog.locator('.employee-form .random-appearance')).toBeVisible()
  await expect(dialog.locator('.workspace-unified-root code')).toHaveText(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES)

  // Local unified folder vs Cloud host toggle + live path preview.
  const locationGroup=dialog.getByRole('group',{name:'Workspace location',exact:true})
  await expect(locationGroup.getByRole('button',{name:'Local unified folder',exact:true})).toHaveAttribute('aria-pressed','true')
  await locationGroup.getByRole('button',{name:'Cloud host',exact:true}).click()
  await expect(locationGroup.getByRole('button',{name:'Cloud host',exact:true})).toHaveAttribute('aria-pressed','true')
  await locationGroup.getByRole('button',{name:'Local unified folder',exact:true}).click()
  await expect(locationGroup.getByRole('button',{name:'Local unified folder',exact:true})).toHaveAttribute('aria-pressed','true')

  await dialog.locator('input[name="title"]').fill('Compact employee')
  await expect(dialog.locator('[data-default-cwd]')).toHaveText(path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'compact-employee'))
  await dialog.locator('input[name="folderName"]').fill('custom-compact')
  await expect(dialog.locator('[data-default-cwd]')).toHaveText(path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'custom-compact'))
  await dialog.locator('input[name="folderName"]').fill('')
  await expect(dialog.locator('[data-default-cwd]')).toHaveText(path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'compact-employee'))

  await dialog.locator('.appearance-actions button[aria-expanded]').click()
  const picker=page.getByRole('dialog',{name:'Choose character',exact:true});await expect(picker).toBeVisible();await picker.locator('[data-character=rocky]').click();await picker.getByRole('button',{name:'Use character',exact:true}).click();await expect(picker).toHaveCount(0)
  await dialog.locator('input[name="folderName"]').fill('custom-compact')
  await dialog.locator('.save-employee').click()
  await expect(dialog).toHaveCount(0)

  const compact=(await cli('session','list')).sessions.find(c=>c.title==='Compact employee')
  assert.ok(compact,'Created employee saved in Store')
  assert.equal(compact.avatar,'rocky');assert.equal(compact.managementRole??'employee','employee')
  assert.equal(compact.kind??'worker','worker')
  assert.equal(compact.cwd,path.join(f.env.AGENTS_COMPANY_EMPLOYEE_WORKSPACES,'custom-compact'))
  await expect.poll(async()=>(await cli('session','status','--employee',compact.id))[0].initialization.status).toBe('ready')
  await page.screenshot({path:path.join(out,'message-created-employee.png'),animations:'disabled'})

  // Rename via profile keeps centralized folder fixed; delete dialog cancel keeps employee & workspace.
  await cli('view','open','employee','--employee',compact.id)
  const profileDialog=page.getByRole('dialog',{name:'Employee details',exact:true})
  await expect(profileDialog).toBeVisible()
  await profileDialog.getByRole('button',{name:'Edit profile',exact:true}).click()
  await expect(profileDialog.locator('.employee-form input[name="title"]')).toBeEditable()
  await expect(profileDialog.locator('.employee-form select[name="group"]')).toHaveCount(0)
  await profileDialog.locator('.employee-form input[name="title"]').fill('Renamed Compact')
  await profileDialog.locator('.save-employee').click()
  const afterRename=(await cli('session','list')).sessions.find(value=>value.id===compact.id)
  assert.equal(afterRename.title,'Renamed Compact')
  assert.equal(afterRename.cwd,compact.cwd)

  // Embedded native conversation delete button opens confirm dialog & cancel keeps record.
  await cli('view','open','conversation','--employee',compact.id)
  await page.locator('.employee-more summary').click()
  await page.getByRole('button',{name:'Delete conversation',exact:true}).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button',{name:'cancel',exact:true}).click()
  assert.ok((await cli('session','list')).sessions.some(value=>value.id===compact.id))
  await cli('view','close')
  assert.equal(fs.existsSync(compact.cwd),true,'Workspace remains after cancel')
  await cli('card','remove',compact.id)
  assert.equal(fs.existsSync(compact.cwd),true,'Removing employee preserves workspace by default')

  assert.deepEqual(errors,[])
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['no Team tab or form','Message Add Employee trigger','local unified vs Cloud host toggle','live unified folder preview','character picker & creation','rename keeps centralized folder','delete cancel safety'],errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
  assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
  console.log('PASS Message-first creation forms: no Team UI, centralized workspace preview, optional folderName, rename stability, delete cancel safety')
}catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,errors},null,2)+'\n');throw error}finally{const discard=page.locator('.creation-discard').getByRole('button',{name:'Discard changes',exact:true});if(await discard.isVisible().catch(()=>false))await discard.click({timeout:3000}).catch(()=>{});const cancel=page.locator('.office-panel form').getByRole('button',{name:'Cancel',exact:true});if(await cancel.isVisible().catch(()=>false))await cancel.click({timeout:3000}).catch(()=>{});await app.close();await f.close()}
