// Anonymous layout, private state, hidden rendering, no engine/model/SSH requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
const require=createRequire(import.meta.url),root=process.cwd(),label=process.env.AGENTS_NAV_LABEL||'after'
const output=path.join(root,'artifacts/navigation-performance');fs.mkdirSync(output,{recursive:true})
const scene=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/navigation-scene.json')))
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-nav-')),home=path.join(temp,'state');fs.mkdirSync(home)
const sessions=scene.sessions.map(c=>{const cwd=path.join(temp,c.id);fs.mkdirSync(cwd);return {...c,cwd}})
assert.ok(sessions.every(card=>card.engine==='codex'&&!card.remote),'this navigation fixture has only local Codex employees')
const engineLog=path.join(temp,'engine-requests.jsonl'),engineBin=path.join(temp,'unexpected-engine.cjs')
fs.writeFileSync(engineBin,'#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.AGENTS_NAV_ENGINE_LOG,"unexpected engine request\\n");process.exit(91)\n',{mode:0o755})
const view={x:-420,y:850,zoom:.36}
const store={...scene,sessions,fullAccessDefaultApplied:true,access:{version:2,revision:1,relations:scene.relations,globalManagerIds:[]},teamRoots:Object.fromEntries(scene.groups.map(g=>[g,temp])),preferences:{theme:'white',showTeamOverview:false},viewport:view,teamViews:[{id:'nav-all',name:'Navigation All',teams:scene.groups,viewport:view},{id:'nav-half',name:'Navigation Half',teams:scene.groups.slice(0,7),viewport:view}],activeTeamViewId:'nav-all'}
fs.writeFileSync(path.join(home,'sessions.json'),JSON.stringify(store))
const env={...process.env,AGENTS_COMPANY_HOME:home,AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:1',AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1400',AGENTS_COMPANY_HEIGHT:'1000',CODEX_BIN:engineBin,CODEX_HOME:path.join(temp,'codex'),AGENTS_NAV_ENGINE_LOG:engineLog,PYTHONDONTWRITEBYTECODE:'1'}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_WEB_URL','ELECTRON_RUN_AS_NODE'].includes(key))delete env[key]
const started=performance.now(),app=await electron.launch({executablePath:process.env.AGENTS_NAV_APP||require('electron'),args:process.env.AGENTS_NAV_APP?[]:[root],env}),page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message))
try{
 // Observe the original authenticated handler, without replacing Core results or permissions.
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('api:request');if(typeof original!=='function')throw Error('Real API handler unavailable')
  globalThis.navPerformance={original,calls:[]};ipcMain.removeHandler('api:request')
  ipcMain.handle('api:request',async(event,request)=>{globalThis.navPerformance.calls.push(request.cmd);return original(event,request)})
 })
 await page.locator('.agent-board-panel').first().waitFor()
 const startupMs=performance.now()-started,call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 const original=await call('session.list'),geometry=await call('office.layout',{viewId:'nav-all'})
 assert.deepEqual(original.groups,scene.groups)
 // Current Core derives provenance IDs/timestamps from createdBy; retain every original edge and its state.
 const edges=relations=>relations.map(({managerId,employeeId,state})=>({managerId,employeeId,state}))
 assert.deepEqual(edges(original.access.relations),edges(scene.relations))
 assert.deepEqual(original.sessions.map(card=>card.id),sessions.map(card=>card.id),'the full anonymous scene survives startup')
 assert.equal((await call('view.get')).teamTab,'board');assert.equal(await page.locator('.infinite-canvas').count(),0,'the retired Canvas is not a primary Team view')
 const panelIds=()=>page.locator('.agent-board-panel:not([hidden])').evaluateAll(nodes=>nodes.map(node=>node.dataset.employee).sort())
 const expectMembers=async cards=>{const ids=cards.map(card=>card.id).sort();await expect.poll(panelIds).toEqual(ids);await expect.poll(()=>page.locator('.board-roster-row').evaluateAll(nodes=>nodes.map(node=>node.dataset.memberKey.replace(/^employee:/,'')).sort())).toEqual(ids)}
 await expectMembers(sessions)
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('api:event',{channel:'desktop:visibility',payload:{active:false,visible:true}}))
 await page.evaluate(()=>{window.navLong=[];new PerformanceObserver(list=>window.navLong.push(...list.getEntries().map(e=>e.duration))).observe({entryTypes:['longtask']})})
 const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(null)))))
 const measure=async(name,work)=>{const before=performance.now();await work();await frame();return {name,ms:+(performance.now()-before).toFixed(1)}}
 const timings=[]
 for(let i=0;i<4;i++)timings.push(await measure('team-scope-'+i,async()=>{const all=i%2;await call('team-view.select',{id:all?'nav-all':'nav-half'});await expect(page.locator('.board-directory-scope > span[title]')).toHaveText(all?'Navigation All':'Navigation Half');await expectMembers(all?sessions:sessions.filter(card=>scene.groups.slice(0,7).includes(card.group)))}))
 const search=page.getByRole('textbox',{name:'Search agents',exact:true})
 for(const query of ['nav-1','Team 8','no-such-teammate'])timings.push(await measure('filter-'+query,async()=>{await search.fill(query);await expectMembers(sessions.filter(card=>[card.title,card.group,'Codex'].join(' ').toLowerCase().includes(query.toLowerCase())))}))
 timings.push(await measure('filter-clear',async()=>{await page.getByRole('button',{name:'Clear search',exact:true}).click();await expectMembers(sessions)}))
 const reads=()=>app.evaluate(()=>globalThis.navPerformance.calls.filter(cmd=>['session.transcript','session.snapshot'].includes(cmd)).length)
 const resetCalls=()=>app.evaluate(()=>{globalThis.navPerformance.phaseStart=globalThis.navPerformance.calls.length})
 const phaseReads=()=>app.evaluate(()=>globalThis.navPerformance.calls.slice(globalThis.navPerformance.phaseStart).filter(cmd=>['session.transcript','session.snapshot'].includes(cmd)).length)
 // Exercise the real refresh consumer with a controlled notification; every resulting read still reaches Core.
 const refresh=()=>app.evaluate(({BrowserWindow})=>{for(let i=0;i<3;i++)BrowserWindow.getAllWindows()[0].webContents.send('api:event',{channel:'session:changed',payload:{}})})
 await expect.poll(reads).toBeGreaterThan(0);await page.waitForTimeout(180);await resetCalls();await refresh();await expect.poll(phaseReads).toBeGreaterThan(0)
 const polling=[{phase:'visible',reads:await phaseReads()}]
 for(let i=0;i<3;i++){
  const employee=sessions[i]
  timings.push(await measure('profile-open-'+i,async()=>{await call('view.open',{kind:'employee',employee:employee.id});await expect(page.locator('.employee-profile-page')).toHaveAttribute('data-profile-employee',employee.id);await expect(page.locator('.profile-hero-copy h1')).toHaveText(employee.title);await expect(page.locator('.profile-scroll[role=tabpanel]')).toHaveAttribute('aria-busy','false')}))
  await page.waitForTimeout(180);await resetCalls();await refresh();await page.waitForTimeout(240)
  polling.push({phase:'profile-'+i,reads:await phaseReads()});assert.equal(polling.at(-1).reads,0,'occluded Board panels stop transcript/snapshot refreshes')
  timings.push(await measure('profile-close-'+i,async()=>{await page.getByRole('button',{name:'Back to company',exact:true}).click();await expect(page.locator('.employee-profile-page')).toHaveCount(0);await expectMembers(sessions)}))
  await page.waitForTimeout(180);await resetCalls();await refresh();await expect.poll(phaseReads).toBeGreaterThan(0);polling.push({phase:'resumed-'+i,reads:await phaseReads()})
 }
 const scroll=page.locator('.agent-board-scroll'),scrollFrames=[]
 await scroll.evaluate(element=>element.scrollTo({top:0,left:0}));const box=await scroll.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width-12,box.y+box.height/2)
 timings.push(await measure('board-scroll-60',async()=>{for(let i=0;i<60;i++){await page.mouse.wheel(0,100);scrollFrames.push(await scroll.evaluate(element=>new Promise(resolve=>requestAnimationFrame(time=>resolve({time,top:element.scrollTop})))))}await expect.poll(()=>scroll.evaluate(element=>element.scrollTop)).toBeGreaterThan(0)}))
 assert.ok(new Set(scrollFrames.map(frame=>frame.top)).size>30,'native wheel input advances the Board continuously')
 await page.screenshot({path:path.join(output,label+'-board.png')})
 // Browser navigation may change a saved scope, never employee identity, authority or shared geometry.
 const final=await call('session.list')
 for(const key of ['groups','sessions','rooms','access','teamRoots','teamViews','activeTeamViewId'])assert.deepEqual(final[key],original[key],key+' remains unchanged by navigation')
 const finalGeometry=await call('office.layout',{viewId:'nav-all'}),{revision:beforeRevision,...beforeGeometry}=geometry,{revision:afterRevision,...afterGeometry}=finalGeometry
 assert.deepEqual(afterGeometry,beforeGeometry,'shared room/employee/relation geometry remains unchanged; scope selection advances the global revision')
 assert.deepEqual(await call('session.list',{live:true}),[],'read-only navigation starts no native sessions')
 const requests=await app.evaluate(()=>globalThis.navPerformance.calls),executionRequests=requests.filter(cmd=>/^(session\.(open|start|send|enqueue|steer)|worker\.(start|send|input)|terminal\.(open|input)|host\.check|remote\.check)$/.test(cmd))
 assert.deepEqual(executionRequests,[]);assert.equal(fs.existsSync(engineLog)?fs.readFileSync(engineLog,'utf8'):'','','no engine executable was invoked')
 const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(output,label+'.cpuprofile'),JSON.stringify(profile))
 const hits=new Map(profile.nodes.map(n=>[n.id,{name:n.callFrame.functionName||'(anonymous)',url:n.callFrame.url,line:n.callFrame.lineNumber,us:0}]))
 profile.samples?.forEach((id,i)=>hits.get(id).us+=profile.timeDeltas?.[i]??0)
 const hot=[...hits.values()].sort((a,b)=>b.us-a.us).slice(0,15)
 const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible()))
 assert.deepEqual(errors,[]);assert.ok(hidden)
 const report={passed:true,label,surface:'single Team Board',startupMs:+startupMs.toFixed(1),teams:scene.groups.length,employees:sessions.length,relations:scene.relations.length,timings,polling,scrollFrames,longTasks:await page.evaluate(()=>window.navLong),hot,errors,engineRequests:0,sshRequests:0,hiddenWindowsOnly:hidden,identitiesAndGeometryUnchanged:true,storeRevision:{before:beforeRevision,after:afterRevision},productionDataUsed:false}
 fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await app.evaluate(({ipcMain})=>{if(globalThis.navPerformance){ipcMain.removeHandler('api:request');ipcMain.handle('api:request',globalThis.navPerformance.original)}}).catch(()=>{});await app.close();fs.rmSync(temp,{recursive:true,force:true})}
