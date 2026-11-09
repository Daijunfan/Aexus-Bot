import {openApplicationSettings} from './fixtures/application-menu.mjs'
// Real hidden installed/source app, authentic Core, synthetic retained news; no platform/model calls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {TELEGRAM_WALLPAPERS} from '../src/shared/telegram-wallpapers.ts'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/telegram-reader/source-ui')),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});let f,app
try{
 f=await fixtureCore();await f.stop();const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor()
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'})})
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),sources=[]
 await call('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'}}})
 for(const[name,locator]of [['Alpha','reader_alpha'],['Beta','reader_beta'],['Gamma','reader_gamma']])sources.push(await call('channel.source-add',{plugin:'telegram',locator,name}))
 const other=await call('channel.source-add',{plugin:'x',locator:'@unrelatedreader',name:'Other platform'}),youtube=await call('channel.source-add',{plugin:'youtube',locator:'@palettevideo',name:'Video palette'}),id=sources[0].channelId,posts=[],stamp=Date.now()-500000
 const publish=(source,externalId,publishedAt,title)=>call('channel.publish',{sourceId:source.id,externalId,publishedAt,title,body:'Readable news content. '.repeat(20)})
 for(let i=0;i<120;i++)posts.push(await publish(sources[i%3],'p'+i,stamp+i*1000,'Story '+i))
 await publish(other,'foreign',stamp,'Other platform remains unread')
 const count=async channel=>(await call('channel.get',{id:channel})).unreadCount,badge=channel=>page.locator(`[data-channel="${channel}"] .message-unread-badge`),feed=page.locator('.channel-feed'),arrow=page.locator('.channel-jump-latest')
 await call('messenger.conversation',{conversations:['channel:'+id],patch:{unread:true}})
 await call('view.open',{kind:'messages',channelId:id});await expect(page.locator('.channel-news-card')).toHaveCount(24);await expect(badge(id)).toHaveText('120');assert.equal(await count(id),120)
 await arrow.click();await expect(page.locator('.channel-inline-error')).toContainText('Activate this window');assert.equal(await count(id),120);assert.equal((await call('messenger.state')).conversations['channel:'+id].unread,true)
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];globalThis.restoreTelegramTestFocus=()=>{delete win.isVisible;delete win.isFocused;delete win.isMinimized;delete win.webContents.isFocused};win.isVisible=()=>true;win.isFocused=()=>true;win.isMinimized=()=>false;win.webContents.isFocused=()=>true})
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>count(id)).toBe(0);await expect(badge(id)).toHaveCount(0);await expect(page.locator('.channel-earlier-unread')).toHaveCount(0);await expect(page.locator('.channel-news-card')).toHaveCount(24)
 assert.ok((await call('channel.read-state',{id,entryIds:[posts[0].id,posts[60].id]})).entries.every(e=>e.state==='read'));assert.equal(await count(other.channelId),1)
 assert.equal((await call('messenger.state')).conversations['channel:'+id].unread,false)
 checks.push('Actual down-arrow clears all120 retained unread items including unloaded history and the manual reminder, without loading extra bodies or touching another platform')
 const fresh=[];for(let i=0;i<6;i++)fresh.push(await publish(sources[i%3],'fresh'+i,stamp+130000+i,'Fresh '+i))
 await expect(badge(id)).toHaveText('6')
 await page.locator(`[data-source-key="telegram:${sources[0].id}"]`).click();await page.locator(`[data-source-key="telegram:${sources[1].id}"]`).click()
 await expect(arrow).toBeVisible();await arrow.click();await expect.poll(()=>count(id)).toBe(2);await expect(page.locator('.channel-earlier-unread')).toHaveCount(0)
 const partial=await call('channel.read-state',{id,entryIds:fresh.map(p=>p.id)});assert.equal(partial.entries.filter(e=>e.state==='unread').length,2)
 await page.getByRole('button',{name:/All sources/}).click();await expect(arrow).toBeVisible();await arrow.click();await expect.poll(()=>count(id)).toBe(0)
 checks.push('Multiple selected authors are marked together; unselected authors retain unread state; returning to All sources clears the remaining scope')
 for(const theme of ['white','black']){
  await call('settings.set',{viewAppearance:{messages:{theme}}})
  for(const preset of TELEGRAM_WALLPAPERS){await call('settings.set',{messageWallpaper:{palette:preset.id,pattern:'telegram',opacity:37.5}});await expect(page.locator('.channel-wallpaper')).toHaveAttribute('data-wallpaper-colors',preset.colors.join(','));const canvas=page.locator('.channel-wallpaper canvas');if(preset.colors.length>1){await expect(canvas).toHaveAttribute('width','64');await expect(canvas).toHaveAttribute('height','64')}else await expect(canvas).toHaveCount(0)}
  for(const preset of ['pink-gradient','purple-gradient','blue-gradient','gray']){await call('settings.set',{messageWallpaper:{palette:preset}});await expect(page.locator('.channel-wallpaper')).toHaveAttribute('data-wallpaper-colors',TELEGRAM_WALLPAPERS.find(p=>p.id===preset).colors.join(','));await page.screenshot({path:path.join(out,theme+'-'+preset+'.png'),animations:'disabled'})}
 }
 for(const channelId of [other.channelId,youtube.channelId]){await call('view.open',{kind:'messages',channelId});await expect(page.locator('.channel-wallpaper')).toHaveAttribute('data-wallpaper-colors','#e6ebee')}
 checks.push('All22 palettes render in light/dark modes, on Telegram/X/YouTube; gradients use only fixed64px canvases, solid colors allocate no canvas')
 await call('view.open',{kind:'messages',channelId:id});await openApplicationSettings(page);const panel=page.locator('.view-preferences-panel');await panel.getByRole('tab',{name:'Messages',exact:true}).click();const settings=panel.locator('.wallpaper-settings')
 await expect(settings.locator('[data-wallpaper-palette-option]')).toHaveCount(24);await settings.locator('[data-wallpaper-palette-option=pink]').click();await expect.poll(async()=>(await call('settings.get')).messageWallpaper.palette).toBe('pink');await expect(settings.locator('.wallpaper-preview .telegram-wallpaper')).toHaveAttribute('data-wallpaper-colors','#f2c9df');await panel.getByRole('button',{name:'Close settings',exact:true}).click();await call('view.open',{kind:'messages',channelId:id});await expect(page.locator('.channel-wallpaper')).toHaveAttribute('data-wallpaper-colors','#f2c9df');await openApplicationSettings(page);await panel.getByRole('tab',{name:'Messages',exact:true}).click()
 await settings.locator('[data-wallpaper-palette-option=custom]').click();const hex=settings.getByRole('textbox',{name:'Color 1 hex value',exact:true});await hex.fill('#ab12ef');await hex.press('Enter');await expect.poll(async()=>(await call('settings.get')).messageWallpaper.colors).toEqual(['#ab12ef'])
 await settings.getByRole('button',{name:'Add color',exact:true}).click();await expect.poll(async()=>(await call('settings.get')).messageWallpaper.colors.length).toBe(2);await settings.locator('[name=wallpaper-rotation]').press('End');await expect.poll(async()=>(await call('settings.get')).messageWallpaper.rotation).toBe(360)
 await page.screenshot({path:path.join(out,'wallpaper-picker-custom.png'),animations:'disabled'});await settings.getByRole('button',{name:'Reset wallpaper',exact:true}).click();await expect.poll(async()=>(await call('settings.get')).messageWallpaper.palette).toBe('theme');await panel.getByRole('button',{name:'Close settings',exact:true}).click();await call('view.open',{kind:'messages',channelId:id})
 await call('settings.set',{messageWallpaper:{palette:'purple-gradient',pattern:'telegram',opacity:37.5},language:'zh-CN'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,900));await page.screenshot({path:path.join(out,'purple-narrow-zh.png'),animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await app.evaluate(()=>globalThis.restoreTelegramTestFocus?.());assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocused())))
 assert.deepEqual(await call('session.status'),[]);assert.deepEqual(await call('schedule.list'),[])
 checks.push('Actual settings swatches, hex editing, adding a gradient color, angle, reset, Chinese narrow layout and hidden-window behavior pass; no native work is started')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks,errors,modelCalls:0,productionDataUsed:false},null,2));checks.forEach(c=>console.log('PASS '+c))
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{try{await app?.evaluate(()=>globalThis.restoreTelegramTestFocus?.()).catch(()=>{});await app?.close()}finally{await f?.close()}}
