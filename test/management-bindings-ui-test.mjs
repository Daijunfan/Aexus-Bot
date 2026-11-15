// The actual Board identity is checked separately from the retained SVG component.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {retainedOffice} from './fixtures/retained-office.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),output=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/management-bindings');fs.mkdirSync(output,{recursive:true})
let f,app,page,component;const errors=[]
const call=(token,...args)=>f.call(token,...args),cli=(...args)=>f.cli(...args),status=async card=>(await cli('session','status','--employee',card.id))[0]
const create=async(title,group,role='employee',token=null)=>{const card=await call(token,'card','create','--title',title,'--group',group,'--engine','codex','--model','gpt-6-luna','--management-role',role);await f.ready(card.id);return card}
const line=(source,target)=>page.locator('#retained-office-fixture .management-connection[data-manager="'+source.id+'"][data-employee="'+target.id+'"]')
const mutate=(token,operation,source,target)=>call(token,'management',operation,'--manager',source.id,'--employee',target.id)
const normal=async source=>{await expect(source).toHaveCount(1);await expect(source).toHaveAttribute('data-active','false');await expect(source).toHaveAttribute('data-temporary','false');const style=await source.locator('.management-line').evaluate(el=>({stroke:getComputedStyle(el).stroke,dash:getComputedStyle(el).strokeDasharray,marker:el.getAttribute('marker-end'),path:el.getAttribute('d')}));assert.notEqual(style.stroke,'rgb(20, 122, 78)');assert.equal(style.dash,'none');assert.match(style.marker,/^url\(#/);assert.ok(style.path)}
try{
 component=await retainedOffice(false);f=await fixtureCore();await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1600',AGENTS_COMPANY_HEIGHT:'1050'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))

 await page.locator('.agent-board').waitFor()
 await cli('group','add','Binding Team');await cli('group','add','Governor Team')
 const manager=await create('Manager A','Binding Team','manager'),peer=await create('Manager B','Binding Team','manager'),governor=await create('Governor','Governor Team','governor'),worker=await create('Shared Employee','Binding Team')
 const mt=(await cli('auth','agent-token',manager.id)).token,pt=(await cli('auth','agent-token',peer.id)).token,gt=(await cli('auth','agent-token',governor.id)).token
 const child=await create('Creator Employee','Binding Team','employee',mt)
 await cli('room','bounds','Binding Team','--columns','3','--rows','3');await cli('room','place','Governor Team','--column','5','--row','0');for(const [card,seat]of [[manager,1],[peer,3],[worker,6],[child,8],[governor,2]])await cli('card','place',card.id,'--seat',String(seat));for(const card of [manager,peer,worker,child,governor]){await expect(page.locator('#root [data-employee="'+card.id+'"]>header h3')).toHaveText(card.title);fs.writeFileSync(path.join(card.cwd,'binding-original.txt'),card.id)}await expect(page.locator('#root .characters-canvas')).toHaveCount(0);await component.attach(page);await page.evaluate(()=>window.retainedOfficeFixture.show())
 const before=await cli('session','list')
 await expect(line(manager,worker)).toHaveCount(0);await normal(line(manager,child))
 await mutate(mt,'bind',manager,worker);await mutate(pt,'bind',peer,worker);await mutate(gt,'bind',governor,worker)
 const after=await cli('session','list');assert.deepEqual(after.sessions,before.sessions);assert.deepEqual(after.rooms,before.rooms)
 for(const theme of ['white','black']){
  await cli('settings','set','--view','company','--theme',theme)
  for(const source of [manager,peer,governor])await normal(line(source,worker))
  assert.deepEqual((await cli('management','activity')).interactions,[])
  await page.screenshot({path:path.join(output,'persistent-'+theme+'.png')})
 }
 const creator=(await cli('management','topology')).edges.find(edge=>edge.employeeId===child.id)
 await call(mt,'management','unbind',creator.id);await expect(line(manager,child)).toHaveCount(0)
 await mutate(mt,'unbind',manager,worker);await expect(line(manager,worker)).toHaveCount(0)
 for(const source of [peer,governor])await normal(line(source,worker))
 await cli('settings','set','--view','company','--theme','white');await page.reload();await page.locator('.agent-board').waitFor();await component.attach(page);await page.evaluate(()=>window.retainedOfficeFixture.show())
 await expect(line(manager,child)).toHaveCount(0);await expect(line(manager,worker)).toHaveCount(0)
 for(const source of [peer,governor])await normal(line(source,worker))
 await cli('team-view','create','--name','One Team','--teams',JSON.stringify(['Binding Team']))
 await expect(line(governor,worker)).toHaveCount(0);await normal(line(peer,worker))
 await cli('team-view','select','all');await normal(line(governor,worker))
 // A real task retains its temporary green line when its persistent binding is removed.
 await mutate(mt,'bind',manager,worker)
 const hold=path.join(f.control,worker.id+'.hold-user');fs.writeFileSync(hold,'')
 await call(mt,'session','send','--employee',worker.id,'--text','Held fixture work')
 await expect(line(manager,worker)).toHaveAttribute('data-active','true');await expect(line(manager,worker)).toHaveAttribute('data-temporary','false')
 const task=(await cli('session','info','--employee',worker.id)).currentTask
 await mutate(mt,'unbind',manager,worker)
 await expect(line(manager,worker)).toHaveAttribute('data-temporary','true');await expect(line(manager,worker)).toHaveAttribute('data-active','true')
 await expect(line(manager,worker).locator('.management-line')).toHaveCSS('stroke','rgb(20, 122, 78)')
 assert.equal((await cli('session','info','--employee',worker.id)).currentTask.messageId,task.messageId)
 for(const source of [peer,governor])await normal(line(source,worker))
 fs.unlinkSync(hold);await expect.poll(async()=>(await status(worker)).busy).toBe(false)
 await expect(line(manager,worker)).toHaveCount(0)
 for(const source of [peer,governor])await normal(line(source,worker))
 await page.screenshot({path:path.join(output,'after-unbind.png')})
 const final=await cli('session','list');assert.deepEqual(final.rooms,before.rooms);const identity=items=>items.map(({id,cwd,engine,threadId,group})=>({id,cwd,engine,threadId,group}));assert.deepEqual(identity(final.sessions),identity(before.sessions));for(const card of [manager,peer,worker,child,governor])assert.equal(fs.readFileSync(path.join(card.cwd,'binding-original.txt'),'utf8'),card.id);await page.evaluate(()=>window.retainedOfficeFixture.hide());await expect(page.locator('#root .agent-board')).toBeVisible();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'real single Board identity + isolated retained bindings SVG',checks:['multiple sources','creator suppression','source-specific removal','two themes','scope and reload','genuine task transition','original files and stable identity'],errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n');assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(win=>!win.isVisible())))
 console.log('PASS hidden binding arrows: multiple idle solid directional arrows, two themes, source-specific removal, creator suppression, reload/views, genuine task green-to-removed transition and unchanged employees/geometry')
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors},null,2)+'\n');throw error}finally{await page?.evaluate(()=>window.retainedOfficeFixture?.unmount()).catch(()=>{});await app?.close();await f?.close();component?.dispose()}
