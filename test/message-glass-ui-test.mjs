// Real scroll, pointer and draft gestures; disposable Core, hidden desktop or headless Web.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),native=process.argv.includes('--desktop'),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??'artifacts/message-glass/'+(native?'desktop':'web'))
fs.mkdirSync(out,{recursive:true});const checks=[],errors=[],measurements=[],probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,app,browser,page
try{
 f=await fixtureCore(native?{}:{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)})
 const core=async(cmd,args={},auth=null)=>{const r=await f.request(auth,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
 await core('settings.set',{language:'en',viewAppearance:{messages:{theme:'violet'}}});await f.cli('group','add','Glass studio');const employee=await f.create('Mira','Glass studio'),token=await f.token(employee.id),group=await core('chat.create',{name:'Field notes',members:[employee.id]})
 const text=Array.from({length:70},(_,i)=>'Paragraph '+(i+1)+'. Keep the evidence in view, including the corners behind the floating controls. 浮动栏两侧仍然可见消息，正文保持清晰。').join('\n\n')
 await core('direct.post',{text,clientMessageId:'glass-private'},token);await core('chat.post',{id:group.id,text,clientMessageId:'glass-group'},token)
 const source=await core('channel.source-add',{plugin:'telegram',locator:'glass_fixture',name:'Everything English fixture'})
 if(native){await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 else{browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.company-navigation').waitFor();const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await core('channel.publish',{sourceId:source.id,externalId:'glass-news',publishedAt:Date.now(),title:'A reading surface',body:text})
 for(const kind of ['private','group','channel']){
  await rpc('view.open',{kind:'messages',...(kind==='private'?{employee:employee.id}:kind==='group'?{chatId:group.id}:{channelId:source.channelId})})
  const pane=page.locator(kind==='private'?'.message-conversation .session-main':kind==='group'?'.group-conversation':'.channel-conversation'),area=pane.locator(kind==='private'?'.transcript':kind==='group'?'.group-transcript':'.channel-feed'),row=area.locator('[data-chat-item]').first()
  await expect(row).toBeVisible();await expect(area).toHaveAttribute('aria-busy','false')
  if(kind==='channel')await pane.getByRole('button',{name:'Read more',exact:true}).click()
  await area.focus();await area.press('End');await expect.poll(()=>area.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(6)
  const box=await area.boundingBox();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5);await page.mouse.wheel(0,-650);await expect.poll(()=>area.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeGreaterThan(300);await page.waitForTimeout(220)
  const measure=()=>pane.evaluate((el,kind)=>{const area=el.querySelector(kind==='private'?'.transcript':kind==='group'?'.group-transcript':'.channel-feed'),r=el.getBoundingClientRect(),a=area.getBoundingClientRect(),header=el.querySelector('.message-thread-header').getBoundingClientRect(),footer=el.querySelector('.composer,.group-composer')?.getBoundingClientRect(),row=area.querySelector('[data-chat-item]').getBoundingClientRect(),style=getComputedStyle(area),top=getComputedStyle(el,'::before'),bottom=getComputedStyle(el,'::after');return {root:r.toJSON(),area:a.toJSON(),header:header.toJSON(),footer:footer?.toJSON(),row:row.toJSON(),topBlur:top.backdropFilter,bottomBlur:bottom.backdropFilter,topMask:top.maskImage,bottomMask:bottom.maskImage,feedMask:style.maskImage,inset:parseFloat(style.getPropertyValue('--message-read-inset')),bottomInset:parseFloat(style.getPropertyValue('--message-read-bottom-inset')),scroll:area.scrollTop}},kind)
  const before=await measure();measurements.push({kind,...before});assert.ok(Math.abs(before.area.top-before.root.top)<2&&Math.abs(before.area.bottom-before.root.bottom)<2,kind+' feed reaches both edges');assert.match(before.topBlur,/blur/);assert.match(before.bottomBlur,/blur/);assert.match(before.topMask,/gradient/);assert.match(before.bottomMask,/gradient/);assert.match(before.feedMask,/gradient/);assert.ok(before.row.top<before.header.bottom&&before.row.bottom>before.root.bottom)
  // Pointer hit-testing proves the side gutters show the actual message, not a cloned screenshot.
  const hit=await pane.evaluate((el,kind)=>{const area=el.querySelector(kind==='private'?'.transcript':kind==='group'?'.group-transcript':'.channel-feed'),box=el.getBoundingClientRect(),row=area.querySelector('[data-chat-item]').getBoundingClientRect(),x=Math.max(row.left+18,box.left+8);return {top:!!document.elementFromPoint(x,box.top+4)?.closest('[data-chat-item]'),bottom:!!document.elementFromPoint(x,box.bottom-4)?.closest('[data-chat-item]')}},kind)
  assert.ok(hit.top&&hit.bottom,kind+' exposes real message corners at both edges')
  await page.screenshot({path:path.join(out,kind+'-glass.png'),animations:'disabled'})
  const search=pane.getByRole('button',{name:kind==='channel'?'Search channel':'Search conversation',exact:true});await search.click();await expect(pane.getByRole('textbox',{name:kind==='channel'?'Search channel articles':'Find in conversation',exact:true})).toBeFocused();await page.keyboard.press('Escape')
  if(kind!=='channel'){
   const input=pane.locator('.composer textarea,.group-composer textarea');await input.click();await expect(input).toBeFocused();await input.fill(Array.from({length:9},(_,i)=>'Draft line '+i).join('\n'));await page.waitForTimeout(250);const expanded=await measure();assert.ok(expanded.bottomInset>before.bottomInset+50);assert.ok(Math.abs(expanded.row.top-before.row.top)<3,'expanding a draft preserves the paragraph being read')
   await input.fill('');await area.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForTimeout(200);const end=await measure();assert.ok(end.row.bottom<=end.footer.top-7,'latest message ends above the composer');await input.fill('A taller draft\nkeeps the last message\nfully above the input.');await page.waitForTimeout(220);const followed=await measure();assert.ok(followed.row.bottom<=followed.footer.top-7);await input.fill('')
  }
  checks.push(kind+': actual messages extend behind both rounded edges, retain gradient glass, allow pointer/keyboard controls and preserve readable draft spacing')
 }
 if(!native){await page.setViewportSize({width:420,height:850});await rpc('view.open',{kind:'messages',chatId:group.id});const area=page.locator('.group-transcript');await expect(area).toHaveAttribute('aria-busy','false');await area.evaluate(el=>{el.scrollTop=500});await page.screenshot({path:path.join(out,'mobile-glass.png'),animations:'disabled'});assert.ok(await area.evaluate(el=>el.scrollWidth<=el.clientWidth+1));checks.push('420px layout keeps the same floating feed without horizontal overflow')}
 if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(win=>!win.isVisible())));assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,mode:native?'hidden macOS desktop':'headless Web',checks,measurements,errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n');checks.forEach(check=>console.log('PASS '+check))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}finally{await app?.close();await page?.close({runBeforeUnload:false}).catch(()=>{});await browser?.close();await f?.close()}
