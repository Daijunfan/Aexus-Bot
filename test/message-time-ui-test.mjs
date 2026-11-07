// Actual hidden app: UTC publication instants, viewer timezones, 24-hour clocks and original dates.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/message-time/source-ui')),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});let f,app
try{
 f=await fixtureCore({TZ:'UTC'})
 const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await f.cli('group','add','Time fixtures');const employee=await f.create('Clock employee','Time fixtures'),token=await f.token(employee.id)
 const direct=await rpc('direct.post',{text:'PRIVATE_CLOCK',clientMessageId:'time-direct'},token),group=await rpc('chat.create',{name:'Time group',members:[employee.id]})
 const shared=await rpc('chat.post',{id:group.id,text:'GROUP_CLOCK',clientMessageId:'time-group'},token)
 await f.until(async()=>!(await f.status(employee.id)).busy,'idle')
 const source=await rpc('channel.source-add',{plugin:'telegram',locator:'time_fixture',name:'Publication clock'}),posts={}
 const cases={original:'2026-11-05T04:04:08.000Z',midnight:'2026-11-05T16:00:08.000Z',dstBefore:'2026-03-08T06:59:00.000Z',dstAfter:'2026-03-08T07:00:00.000Z',year:'2025-12-31T16:00:00.000Z'}
 await f.stop();const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),cdp=await page.context().newCDPSession(page)
 const timezone=async(zone,language='en')=>{await cdp.send('Emulation.setTimezoneOverride',{timezoneId:zone});await call('settings.set',{language:language==='en'?'zh-CN':'en'});await call('settings.set',{language})}
 for(const[key,iso]of Object.entries(cases))posts[key]=await rpc('channel.publish',{sourceId:source.id,externalId:key,publishedAt:Date.parse(iso),title:'TIME_'+key,body:'Synthetic publication timestamp fixture.'})
 await timezone('Asia/Shanghai');await call('settings.set',{viewAppearance:{messages:{theme:'white'}}});await call('view.open',{kind:'messages',channelId:source.channelId})
 const card=key=>page.locator('.channel-news-card[data-news-id="'+posts[key].id+'"]'),clock=key=>card(key).locator('header time')
 await expect(clock('original')).toHaveText(/Nov 5(?:, 2026)?, 12:04/);await expect(clock('original')).toHaveAttribute('datetime',cases.original);await expect(clock('original')).toHaveAttribute('title',/2026.*12:04:08.*GMT\+8/)
 await expect(clock('midnight')).toHaveText(/Nov 6(?:, 2026)?, 00:00/);await expect(clock('year')).toHaveText(/Jan 1(?:, 2026)?, 00:00/)
 await card('original').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'channel-24h-light.png'),animations:'disabled'})
 checks.push('Original 04:04:08Z instant displays 12:04 in Shanghai; midnight is 00:00 on the next date; full hover shows year, seconds and UTC offset without changing datetime')
 for(const[zone,expected,before,after,offset]of [['UTC','Nov 5, 04:04','06:59','07:00','GMT'],['America/New_York','Nov 4, 23:04','01:59','03:00','GMT-5']]){
  await timezone(zone);await expect(clock('original')).toHaveText(new RegExp(expected.replace(', ', '(?:, 2026)?, ')));await expect(clock('original')).toHaveAttribute('datetime',cases.original);await expect(clock('dstBefore')).toContainText(before);await expect(clock('dstAfter')).toContainText(after);await expect(clock('original')).toHaveAttribute('title',new RegExp(offset.replace('-','\\-')))
  if(zone==='America/New_York'){await expect(clock('dstBefore')).toHaveAttribute('title',/GMT-5/);await expect(clock('dstAfter')).toHaveAttribute('title',/GMT-4/);await expect(clock('year')).toContainText('2025')}
 }
 checks.push('Viewer timezone conversion preserves UTC instants; New York crosses to the prior date, skips the DST gap, and labels previous-year posts')
 await timezone('Asia/Shanghai','zh-CN');await expect(clock('original')).toContainText('12:04');assert.ok(!/AM|PM|上午|下午/.test(await clock('original').innerText()))
 await call('settings.set',{language:'en'});await page.getByRole('button',{name:'Board view',exact:true}).click();const board=page.locator('.channel-post-card').filter({hasText:'TIME_original'}).locator('time');await expect(board).toHaveAttribute('datetime',cases.original);await expect(board).toHaveAttribute('title',/12:04:08.*GMT\+8/)
 await page.getByRole('button',{name:'Posts view',exact:true}).click();await expect(clock('original')).toHaveAttribute('datetime',cases.original);await expect(clock('original')).toHaveAttribute('title',/12:04:08.*GMT\+8/)
 checks.push('Channel, Board and Posts share complete 24-hour publication details; Chinese and English render the same local hour')
 await call('view.open',{kind:'messages',employee:employee.id});await expect(page.locator('.transcript')).toContainText('PRIVATE_CLOCK')
 const assertClock=async locator=>{const values=await locator.evaluateAll(items=>items.map(item=>({text:item.textContent,title:item.title,iso:item.getAttribute('datetime'),expected:String(new Date(item.getAttribute('datetime')).getHours()).padStart(2,'0')+':'+String(new Date(item.getAttribute('datetime')).getMinutes()).padStart(2,'0')})));assert.ok(values.length);for(const value of values){assert.equal(value.text,value.expected);assert.ok(!/AM|PM|24:/.test(value.text));assert.match(value.title,/2026.*GMT\+8/)}return values}
 const privateTimes=await assertClock(page.locator('.transcript time.message-time,.transcript .message-time>time'))
 await call('view.open',{kind:'messages',chatId:group.id});await expect(page.locator('.group-message')).toContainText('GROUP_CLOCK');const groupTimes=await assertClock(page.locator('.group-message .message-time>time:not(.message-edited)'))
 const inbox=page.locator('.message-contact[data-employee="'+employee.id+'"] .message-contact-line>time');const inboxTime=await inbox.innerText();assert.match(inboxTime,/^\d{2}:\d{2}$/);assert.ok(!/AM|PM|24:/.test(inboxTime));await expect(inbox).toHaveAttribute('title',/GMT\+8/)
 checks.push('Private, group and inbox clocks use the same 00–23 local hour and full timestamp hover')
 await call('view.open',{kind:'messages',channelId:source.channelId});await page.getByRole('button',{name:'Channel view',exact:true}).click();await call('settings.set',{viewAppearance:{messages:{theme:'black'}}});await expect(clock('original')).toHaveText(/Nov 5(?:, 2026)?, 12:04/);await card('original').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'channel-24h-dark.png'),animations:'disabled'})
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,900));await page.screenshot({path:path.join(out,'channel-24h-narrow.png'),animations:'disabled'});const width=await page.evaluate(()=>({width:innerWidth,page:document.documentElement.scrollWidth}));assert.ok(width.page<=width.width+1)
 for(const[key,iso]of Object.entries(cases))assert.equal((await rpc('channel.post',{id:posts[key].id})).publishedAt,Date.parse(iso))
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks,originalUTC:cases.original,privateTimes,groupTimes,errors,modelCalls:0,productionDataUsed:false},null,2));checks.forEach(c=>console.log('PASS '+c))
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{try{await app?.close()}finally{await f?.close()}}
