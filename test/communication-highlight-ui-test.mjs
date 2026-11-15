// Real current Board status plus isolated retained OfficeCanvas; cue deadlines are unchanged.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import platform from '../bin/platform.cjs'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {retainedOffice} from './fixtures/retained-office.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),output=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/communication-highlight');fs.mkdirSync(output,{recursive:true})
let f,app,page,component;const errors=[],followers=[]
const cli=(...args)=>f.cli(...args),call=(auth,...args)=>f.call(auth,...args),status=async card=>(await cli('session','status','--employee',card.id))[0]
const create=async(title,group,role='employee')=>{const card=await cli('card','create','--title',title,'--group',group,'--management-role',role,'--engine','codex','--model','gpt-6-luna');await f.ready(card.id);return card}
const line=(a,b)=>page.locator('#retained-office-fixture .management-connection[data-manager="'+a.id+'"][data-employee="'+b.id+'"]')
const follow=async(auth,employee)=>{const socket=net.connect(platform.controlEndpoint(f.env.AGENTS_COMPANY_HOME));followers.push(socket);await new Promise((resolve,reject)=>{socket.once('error',reject);socket.once('connect',()=>socket.write(JSON.stringify({cmd:'session.follow',args:{employee},auth})+'\n'));socket.once('data',resolve)});return socket}
try{
 component=await retainedOffice(false);f=await fixtureCore();await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1500',AGENTS_COMPANY_HEIGHT:'1050'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))

 await page.locator('.agent-board').waitFor();await cli('group','add','Workers');await cli('group','add','Governors')
 const manager=await create('Manager','Workers','manager'),governor=await create('Governor','Governors','governor'),worker=await create('Bound Employee','Workers'),unbound=await create('Unbound Employee','Workers')
 const mt=(await cli('auth','agent-token',manager.id)).token,gt=(await cli('auth','agent-token',governor.id)).token
 await cli('management','bind','--manager',manager.id,'--employee',worker.id);await cli('management','bind','--manager',governor.id,'--employee',manager.id)
 const geometry=()=>cli('session','list').then(store=>({rooms:store.rooms,positions:store.sessions.map(card=>[card.id,card.position])})),before=await geometry()
 const relations=(await cli('management','topology')).edges
 const targets=[manager,worker,unbound],pairs=[[mt,manager,worker],[gt,governor,manager],[gt,governor,unbound]]
 for(const card of targets)fs.writeFileSync(path.join(f.control,card.id+'.hold-user'),'')
 for(const card of [manager,governor,worker,unbound])await expect(page.locator('#root [data-employee="'+card.id+'"]>header h3')).toHaveText(card.title);await expect(page.locator('#root .characters-canvas')).toHaveCount(0);await component.attach(page);await page.evaluate(()=>window.retainedOfficeFixture.show());await expect(page.locator('#retained-office-fixture .characters-canvas')).toBeVisible()
 const measurements=[]
 for(const theme of ['white','black']){
  await cli('settings','set','--view','company','--theme',theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
  await page.evaluate(()=>{
   window.__highlightObserver?.disconnect();window.__highlightSamples=[]
   const active=new Map()
   window.__highlightObserver=new MutationObserver(()=>{
    const now=performance.now(),shown=new Set()
    for(const node of document.querySelectorAll('#retained-office-fixture .management-connection[data-active=true]')){const key=node.getAttribute('data-manager')+'>'+node.getAttribute('data-employee');shown.add(key);if(!active.has(key))active.set(key,now)}
    for(const [key,start] of active)if(!shown.has(key)){window.__highlightSamples.push(now-start);active.delete(key)}
   });window.__highlightObserver.observe(document.querySelector('#retained-office-fixture .canvas-world'),{attributes:true,attributeFilter:['data-active'],childList:true,subtree:true})
  })
  const start=performance.now()
  await Promise.all(pairs.map(([auth,,target])=>call(auth,'session','send','--employee',target.id,'--text','Held communication fixture')))
  for(const [,source,target] of pairs)await expect(line(source,target)).toHaveAttribute('data-active','true')
  await expect(line(governor,unbound)).toHaveAttribute('data-temporary','true')
  await expect(line(manager,worker).locator('.management-line')).toHaveCSS('stroke',theme==='black'?'rgb(99, 223, 160)':'rgb(20, 122, 78)')
  await expect(page.locator('#retained-office-fixture .office-connections')).toHaveCSS('animation-name','management-flow')
  await expect(page.locator('#retained-office-fixture .management-connection[data-active=true]')).toHaveCount(0,{timeout:2000})
  const elapsedMs=Math.round(performance.now()-start);assert.ok(elapsedMs<1500,'communication cue exceeded its bounded display window')
  const highlightMs=await page.evaluate(()=>window.__highlightSamples.map(Math.round))
  assert.equal(highlightMs.length,3);assert.ok(highlightMs.every(ms=>ms<900),'rendered cue outlived its deadline')
  await expect(line(manager,worker)).toHaveAttribute('data-active','false');await expect(line(governor,manager)).toHaveAttribute('data-active','false');await expect(line(governor,unbound)).toHaveCount(0)
  const live=(await cli('management','activity')).interactions
  assert.equal(live.length,3);assert.ok(live.every(item=>item.kind==='task'&&item.highlighted===false))
  for(const card of targets){assert.equal((await status(card)).busy,true);await expect(page.locator(`#retained-office-fixture [data-card-id="${card.id}"]`)).toHaveAttribute('data-state','working')}
  const layout=await cli('office','layout');assert.equal(layout.connections.length,2);assert.ok(layout.connections.every(edge=>!edge.active))
  assert.deepEqual((await cli('management','topology')).edges,relations);assert.deepEqual(await geometry(),before)
  await page.evaluate(()=>window.retainedOfficeFixture.hide());for(const card of targets)await expect(page.locator('#root [data-employee="'+card.id+'"]')).toHaveAttribute('data-working','true');await page.reload();await page.locator('.agent-board').waitFor();await component.attach(page);await page.evaluate(()=>window.retainedOfficeFixture.show());await expect(line(manager,worker)).toHaveAttribute('data-active','false');await expect(line(governor,unbound)).toHaveCount(0)
  const subscription=await follow(gt,manager.id)
  await expect(line(governor,manager)).toHaveAttribute('data-active','true')
  await expect(line(governor,manager)).toHaveAttribute('data-active','false',{timeout:1500})
  assert.equal(subscription.destroyed,false);assert.equal((await status(manager)).busy,true)
  subscription.destroy()
  await page.screenshot({path:path.join(output,'expired-'+theme+'.png')})
  measurements.push({theme,elapsedMs,highlightMs,remainingTasks:live.length})
  for(const card of targets)await cli('session','interrupt','--employee',card.id)
  await expect.poll(async()=>(await cli('management','activity')).interactions.length).toBe(0)
 }
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(win=>!win.isVisible())))
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,scope:'current Board working state + isolated retained OfficeCanvas',measurements,errors,productionDataUsed:false,modelCalls:0},null,2)+'\n')
 console.log('PASS 600ms cues: Manager->Employee, Governor->Employee/Manager; long tasks and subscriptions remain alive, bound arrows return, temporary arrows vanish, reload does not replay, both themes; '+JSON.stringify(measurements))
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors},null,2)+'\n');throw error}finally{followers.forEach(socket=>socket.destroy());await page?.evaluate(()=>window.retainedOfficeFixture?.unmount()).catch(()=>{});await app?.close();await f?.close();component?.dispose()}
