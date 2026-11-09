import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/team-resize-anchor/'+mode);fs.mkdirSync(out,{recursive:true})
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,app,browser,page;const errors=[],checks=[]
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const core=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await core('settings.set',{language:'en'});for(const name of ['One','Two','Three','Four'])await core('group.add',{name})
 await f.create('Mira','One');await f.create('Rowan','Three')
 if(web){browser=await chromium.launch({headless:true,channel:'chrome'});page=await browser.newPage({viewport:{width:2000,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'2000',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(2000,1000))}
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'})
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),canvas=page.locator('.characters-canvas')
 await expect(canvas).toBeVisible();await page.evaluate(()=>{window.resizeRequests=[];const call=window.agents.call.bind(window.agents);window.agents.call=(cmd,args)=>{if(cmd==='room.place'||cmd==='room.bounds')window.resizeRequests.push({cmd,args});return call(cmd,args)}})
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 for(const [name,edge] of [['Two','e'],['Three','se'],['Four','s']]){
  const room=page.locator('[data-department="'+name+'"]'),handle=room.locator('[data-resize-edge="'+edge+'"]')
  await handle.scrollIntoViewIfNeeded();await settle()
  const original=await rpc('room.layout',{name}),rect=await room.boundingBox(),control=await handle.boundingBox(),zoom=await canvas.getAttribute('data-zoom')
  assert.equal(await handle.locator('i,svg,img').count(),0,'resize hit areas contain no persistent arrow or graphic')
  const visual=await handle.evaluate(element=>{const s=getComputedStyle(element);return {background:s.backgroundColor,shadow:s.boxShadow,cursor:s.cursor}});assert.equal(visual.background,'rgba(0, 0, 0, 0)');assert.equal(visual.shadow,'none');assert.equal(visual.cursor,edge==='e'?'ew-resize':edge==='s'?'ns-resize':'nwse-resize')
  await page.mouse.move(control.x+control.width/2,control.y+control.height/2);await page.mouse.down()
  for(const fraction of [.35,.7,1]){
   await page.mouse.move(control.x+control.width/2+(edge!=='s'?125*fraction:0),control.y+control.height/2+(edge!=='e'?155*fraction:0),{steps:4});await settle()
   const during=await room.boundingBox();assert.ok(Math.abs(during.x-rect.x)<1&&Math.abs(during.y-rect.y)<1,name+' origin must stay fixed during resize');assert.equal(await canvas.getAttribute('data-zoom'),zoom)
  }
  await page.mouse.up();const wanted={columns:original.seating.columns+(edge!=='s'?1:0),rows:original.seating.rows+(edge!=='e'?1:0)}
  await expect.poll(async()=>(await rpc('room.layout',{name})).seating).toEqual(wanted);await expect(room).toHaveAttribute('data-columns',String(wanted.columns));await expect(room).toHaveAttribute('data-rows',String(wanted.rows));await settle()
  const after=await rpc('room.layout',{name}),paint=await room.boundingBox();assert.equal(after.bounds.x,original.bounds.x);assert.equal(after.bounds.y,original.bounds.y);assert.equal(after.slot,original.slot);assert.ok(Math.abs(paint.x-rect.x)<1&&Math.abs(paint.y-rect.y)<1,name+' origin must stay fixed after commit')
  checks.push(name+' / '+edge+': invisible cursor-only handle, anchored live preview and saved origin')
 }
 const requests=await page.evaluate(()=>window.resizeRequests);if(web){assert.ok(requests.length>=3);assert.ok(requests.every(request=>request.cmd==='room.bounds'),'resize never dispatches room.place')}
 // A second pointer must never replace an active resize with a Team move.
 const room=page.locator('[data-department=Three]'),handle=room.locator('[data-resize-edge=se]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox(),before=(await rpc('session.list')).revision
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await room.locator('.team-title').dispatchEvent('pointerdown',{pointerId:99,button:0,isPrimary:false});await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+90,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await rpc('session.list')).revision,before);assert.equal(await canvas.getAttribute('data-gesture'),null)
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+95,{steps:5});await canvas.evaluate(element=>element.releasePointerCapture(1));await page.mouse.move(box.x+box.width/2+91,box.y+box.height/2+96);await expect(canvas).not.toHaveAttribute('data-gesture','resize');await page.mouse.up();assert.equal((await rpc('session.list')).revision,before)
 assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('room-resize-handle')),false,'pointer gestures leave no focused resize marker')
 checks.push('resize and movement remain exclusive; secondary pointers, Escape and lost pointer capture cannot move or save the Team')
 await page.mouse.move(10,70);await page.screenshot({path:path.join(out,'clean-characters.png'),animations:'disabled'});if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())));assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,requests,errors,productionDataUsed:false,paidModelCalls:0},null,2));checks.forEach(value=>console.log('PASS '+value))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
