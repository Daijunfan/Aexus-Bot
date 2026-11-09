// Reproduce the user's eight-person geometry in disposable state, never mutate their staff/data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/characters-fit/'+mode),source=path.resolve('artifacts/characters-fit/source-scene.json')
const fallback={groups:['Studio','Research','Office'],rooms:{Studio:{col:0,row:0,w:1,h:1,bounds:{x:-480,y:470,width:760,height:792,shape:'rounded',arrangement:'free',pinned:true}},Research:{col:0,row:0,w:1,h:1,bounds:{x:432,y:909,width:760,height:520,shape:'rounded',arrangement:'free',pinned:true}},Office:{col:0,row:0,w:1,h:1,bounds:{x:925,y:314,width:760,height:520,shape:'rounded',arrangement:'free',pinned:true}}},employees:Array.from({length:8},(_,i)=>({id:'source-'+i,title:'Companion '+i,group:i<6?'Studio':i===6?'Research':'Office',managementRole:i===7?'secretary':'employee',position:{x:i<6?48+(i%3)*216:48,y:i<6?206+Math.floor(i/3)*288:206},unread:i>2})),relations:[]}
const scene=fs.existsSync(source)?JSON.parse(fs.readFileSync(source,'utf8')):fallback
assert.equal(scene.employees.length,8);assert.equal(scene.groups.length,3);fs.mkdirSync(out,{recursive:true})
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
let f,app,browser,page;const errors=[],checks=[]
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const core=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
 await core('settings.set',{language:'en',snapEmployees:false,showTeamOverview:false})
 for(const name of scene.groups)await core('group.add',{name})
 const ids=new Map()
 for(const person of scene.employees){const card=await f.create(person.title,person.group,person.managementRole??'employee');ids.set(person.id,card.id);if(person.unread){fs.writeFileSync(path.join(f.control,card.id+'.reply.txt'),'A completed work update. Open the conversation to read the full response. '.repeat(5));await core('session.enqueue',{employee:card.id,text:'A disposable unread reply'});await f.until(async()=>(await core('session.status',{employee:card.id}))[0].busy===false&&(await core('session.list')).sessions.find(value=>value.id===card.id).lastReply,'unread fixture')}}
 for(const relation of scene.relations??[])if(ids.has(relation.managerId)&&ids.has(relation.employeeId))await core('management.bind',{manager:ids.get(relation.managerId),employee:ids.get(relation.employeeId)})
 await f.stop();const stateFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.rooms=scene.rooms
 for(const person of scene.employees){const card=state.sessions.find(card=>card.id===ids.get(person.id));for(const field of ['avatar','color','accessory','position'])if(person[field]!==undefined)card[field]=person[field]}
 fs.writeFileSync(stateFile,JSON.stringify(state));let geometry
 if(web){await f.start();browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1406,height:1056}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1406',AGENTS_COMPANY_HEIGHT:'1056'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.employee')).toHaveCount(8)
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 geometry=JSON.stringify((await core('session.list')).rooms)
 const resize=async(width,height)=>web?page.setViewportSize({width,height}):app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows()[0].setSize(width,height),[width,height])
 const fit=()=>page.locator('.characters-canvas').evaluate(canvas=>{const bounds=canvas.getBoundingClientRect();return [...canvas.querySelectorAll('.world-room')].every(room=>{const box=room.getBoundingClientRect();return box.left>=bounds.left+3&&box.top>=bounds.top+3&&box.right<=bounds.right-3&&box.bottom<=bounds.bottom-24})})
 for(const [width,height] of [[1406,1056],[1168,1056],[1440,960]]){
  await resize(width,height);await page.locator('.characters-canvas').evaluate(node=>node.scrollTo(0,0));if(width>=1400)await expect.poll(fit).toBe(true);else{const frame=page.locator('.world-room').last();await frame.scrollIntoViewIfNeeded();await expect(frame).toBeInViewport();await page.locator('.characters-canvas').evaluate(node=>node.scrollTo(0,0));}await expect(page.locator('.employee')).toHaveCount(8)
  const sizes=await page.locator('.employee').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect(),name=node.querySelector('.employee-name'),zoom=Number(node.closest('.characters-canvas').dataset.zoom);return {width:b.width,height:b.height,font:parseFloat(getComputedStyle(name).fontSize)*zoom}}))
  assert.ok(sizes.every(size=>size.width<=125&&size.height<=164&&size.font>=11.8),JSON.stringify(sizes));await page.screenshot({path:path.join(out,'eight-'+width+'.png'),animations:'disabled'})
 }
 assert.ok(await page.locator('.employee').evaluateAll(nodes=>nodes.every(node=>{const dot=node.querySelector('.badge-light').getBoundingClientRect(),role=node.querySelector('.employee-management').getBoundingClientRect(),name=node.querySelector('.employee-name').getBoundingClientRect();return dot.top>=role.top&&dot.bottom<=role.bottom+1&&dot.bottom<name.top})))
 checks.push('At 1406/1440 all Teams fit; at 1168 finite scrolling reaches every anchored Team without shrinking or reflowing them')
 assert.equal(JSON.stringify((await core('session.list')).rooms),geometry,'Fitting must not rewrite shared geometry')
 const canvas=page.locator('.characters-canvas'),beforeZoom=await canvas.getAttribute('data-zoom');await canvas.hover();await page.keyboard.down('Control');await page.mouse.wheel(0,-300);await page.keyboard.up('Control');await expect(canvas).toHaveAttribute('data-zoom',beforeZoom)
 const bubble=page.locator('.activity-bubble').first();if(await bubble.count()){assert.equal(await bubble.locator('.activity-text').evaluate(node=>getComputedStyle(node).display),'none');await bubble.locator('..').hover();await expect(bubble.locator('.activity-text')).toBeVisible();await page.mouse.move(10,10)}
 checks.push('Automatic fitting does not enable manual zoom; full reply previews appear on hover instead of covering the overview')
 const target=scene.employees.find(person=>person.group===scene.groups[0]),id=ids.get(target.id),node=page.locator('.employee[data-card-id="'+id+'"]'),original=(await core('session.list')).sessions.find(card=>card.id===id).seatNumber,box=await node.boundingBox(),zoom=Number(await canvas.getAttribute('data-zoom'))
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-10,box.y+box.height/2+6,{steps:5});await page.mouse.up()
 assert.equal((await core('session.list')).sessions.find(card=>card.id===id).seatNumber,original)
 assert.equal(JSON.stringify((await core('session.list')).rooms),geometry);await node.click();await expect(page.locator('.conversation-dialog')).toBeVisible();await rpc('view.close')
 checks.push('Dragging within one numbered seat preserves fixed scale and Team bounds; opening and closing a conversation still works')
 await rpc('settings.set',{viewAppearance:{company:{theme:'black'}}});await expect(page.locator('html')).toHaveAttribute('data-theme','black');await page.screenshot({path:path.join(out,'eight-dark.png'),animations:'disabled'})
 await page.getByRole('tab',{name:'Board',exact:true}).click();await expect(page.locator('.agent-board-panel[data-employee]')).toHaveCount(8);await page.getByRole('tab',{name:'Characters',exact:true}).click();await expect.poll(fit).toBe(true)
 if(web){await resize(420,900);await expect(page.locator('.characters-canvas')).toBeVisible();const board=await core('office.layout'),limit=board.board.slots*(Math.max(711,...board.rooms.map(room=>room.bounds.height))+60)*Number(await canvas.getAttribute('data-zoom'))+80;assert.ok(await canvas.evaluate((node,limit)=>node.scrollWidth<2000&&node.scrollHeight<=limit,limit));await page.screenshot({path:path.join(out,'eight-narrow.png'),animations:'disabled'})}
 assert.deepEqual(errors,[]);if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,teams:3,employees:8,sourceGeometry:fs.existsSync(source)?'Read-only snapshot of current eight-person layout':'Eight-person regression fixture',checks,errors,productionDataMutated:false,paidModelCalls:0},null,2)+'\n');for(const check of checks)console.log('PASS '+mode+': '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
