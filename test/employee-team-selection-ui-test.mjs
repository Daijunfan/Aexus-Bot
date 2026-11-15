import {profileApplication} from './fixtures/profile-application.mjs'
import {createReady,readyEmployee} from './fixtures/ui-contracts.mjs'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {chooseOption} from './fixtures/app-select.mjs'
// Isolated hidden desktop; view membership and deletion never use real user data/models.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
const root=process.cwd(),require=createRequire(import.meta.url),built=process.env.AGENTS_COMPANY_TEST_APP?null:await profileApplication(),f=await fixtureCore({},built?path.join(built.directory,'out/main/daemon.js'):undefined),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/deleted-teams');fs.mkdirSync(out,{recursive:true});await f.stop()
const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1100'};delete env.ELECTRON_RUN_AS_NODE
const application=process.env.AGENTS_COMPANY_TEST_APP,app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[built.directory],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
const team=page.locator('select[name="group"]'),save=page.locator('.save-employee')
const choices=()=>team.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean))
try{
 await page.locator('.agent-board').waitFor();await call('settings.set',{language:'en'})
 const all=['Hidden A','Hidden B','Hidden C','Visible A','Visible B','Visible C']
 for(const name of all)await call('group.add',{name})
 const hidden=await createReady(call,{title:'Preserved employee',group:'Hidden A',engine:'codex',avatar:'fate-gilgamesh-chibi'})
 const focus=await call('team-view.create',{name:'Three teams',teams:all.slice(3)})
 await expect(page.locator('.company-view-trigger')).toHaveAttribute('title','Team');await expect(page.locator('.board-directory-scope')).toContainText('Three teams');await expect(page.locator('.team-subviews,.characters-canvas')).toHaveCount(0)
 await page.locator('.add-employee').click()
 await expect.poll(choices).toEqual(all.slice(3));await expect(team).toHaveValue('Visible A')
 await expect(page.locator('.board-directory-scope')).toContainText('Three teams')
 await team.locator('..').locator('.app-select-trigger').click()
 await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Choose Team',...all.slice(3)])
 await page.screenshot({path:path.join(out,'three-team-picker.png')})
 await page.getByRole('listbox').getByRole('option',{name:'Visible A',exact:true}).click()
 // Rename invalidates an open selection, instead of submitting the previous name.
 await call('group.rename',{name:'Visible A',nextName:'Renamed A'})
 await expect.poll(choices).toEqual(['Renamed A','Visible B','Visible C']);await expect(team).toHaveValue('');await expect(save).toBeDisabled()
 await chooseOption(page,team,'Visible B');await page.locator('input[name="title"]').fill('New colleague');await save.click();await expect(page.locator('.employee-form')).toHaveCount(0)
 const created=(await call('session.list')).sessions.find(c=>c.title==='New colleague');assert.equal(created.group,'Visible B');await readyEmployee(call,created.id);fs.writeFileSync(path.join(created.cwd,'keep.txt'),'original colleague file')
 await call('group.rename',{name:'Visible B',nextName:'Renamed B'});assert.equal((await call('session.list')).lastEmployeeTemplate.group,'Renamed B')
 await page.locator('.add-employee').click();await expect(team).toHaveValue('Renamed B')
 await page.locator('input[name="title"]').fill('Draft preserved')
 await assert.rejects(()=>call('group.remove',{name:'Renamed B'}));await expect(page.locator('.creation-discard')).toContainText('Discard unsaved form changes');await page.locator('.creation-discard').getByRole('button',{name:'Keep editing',exact:true}).click();await expect(page.locator('input[name=title]')).toHaveValue('Draft preserved');const guarded=await f.request(null,'group.remove',{name:'Renamed B'});assert.equal(guarded.ok,false,'Destructive operations from another client also respect the unsaved form');await page.locator('.creation-discard').getByRole('button',{name:'Keep editing',exact:true}).click();await page.locator('.employee-form').getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.add-employee').click();await expect(team).toHaveValue('Renamed B');await expect(page.locator('input[name=title]')).toHaveValue('');const deleted=await f.request(null,'group.remove',{name:'Renamed B'});assert.ok(deleted.ok,deleted.error)
 await expect.poll(choices).toEqual(['Renamed A','Visible C']);await expect(team).toHaveValue('');await expect(save).toBeDisabled();await expect(page.locator('input[name="title"]')).toHaveValue('');await page.locator('input[name=title]').fill('Draft preserved')
 await expect(page.locator('[data-default-cwd]')).not.toContainText(created.cwd)
 const removed=await call('session.list');assert.equal(removed.lastEmployeeTemplate.group,undefined);assert.equal(removed.lastEmployeeTemplate.avatar,created.avatar)
 for(const key of ['rooms','teamRoots','teamSettings'])assert.ok(!Object.hasOwn(removed[key],'Renamed B'))
 assert.ok(removed.teamViews.every(v=>!v.teams.includes('Renamed B')));assert.ok(fs.existsSync(created.cwd),'keep-files deletion preserves workspaces');assert.equal(fs.readFileSync(path.join(created.cwd,'keep.txt'),'utf8'),'original colleague file')
 // Removing a Team from a view clears selection but preserves the actual Team/member.
 await chooseOption(page,team,'Renamed A');await call('team-view.update',{id:focus.id,patch:{teams:['Visible C']}})
 await expect.poll(choices).toEqual(['Visible C']);await expect(team).toHaveValue('');await expect(save).toBeDisabled()
 await call('team-view.update',{id:focus.id,patch:{teams:[]}});await expect.poll(choices).toEqual([]);await expect(save).toBeDisabled();await expect(page.locator('.office-panel .workspace-note').first()).toContainText('This view has no teams')
 await call('team-view.select',{id:'all'});await expect.poll(choices).toEqual(['Hidden A','Hidden B','Hidden C','Renamed A','Visible C'])
 await chooseOption(page,team,'Hidden A');await save.click();await expect(page.locator('.employee-form')).toHaveCount(0)
 const store=await call('session.list');assert.ok(store.sessions.some(c=>c.id===hidden.id));assert.equal(store.sessions.find(c=>c.title==='Draft preserved').group,'Hidden A')
 await page.reload();await page.locator('.agent-board').waitFor();await call('settings.set',{language:'en'});await page.locator('.add-employee').click();await expect.poll(choices).toEqual(['Hidden A','Hidden B','Hidden C','Renamed A','Visible C'])
 await page.locator('.employee-form').getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.employee-form')).toHaveCount(0);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['six real Teams with three selected scope choices','visible dropdown and hidden-template fallback','rename/remove invalidates open choice','keep-files deletion preserves original','empty scope explanation and recovery','real current Board navigation and reload'],errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n');assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));assert.deepEqual(errors,[])
 console.log('PASS 6 real Teams / 3 view choices, styled dropdown, hidden-template fallback, rename/delete cleanup, open-form invalidation, view-only removal, empty view, All Team creation and reload persistence; no model calls')
}catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,errors},null,2)+'\n');throw error}finally{const discard=page.locator('.creation-discard').getByRole('button',{name:'Discard changes',exact:true});if(await discard.isVisible().catch(()=>false))await discard.click({timeout:3000}).catch(()=>{});if(await page.locator('.employee-form').isVisible().catch(()=>false))await page.locator('.employee-form').getByRole('button',{name:'Cancel',exact:true}).click({timeout:3000}).catch(()=>{});await app.close();await f.close();built?.dispose()}
