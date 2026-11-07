import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fixtureCore} from './fixtures/headless-core.mjs'

const require=createRequire(import.meta.url),{_electron:electron,expect}=require('@playwright/test')
const f=await fixtureCore(),output=path.join(f.root,'artifacts/channel-restoration/wallpaper')
fs.mkdirSync(output,{recursive:true})
await f.stop()
const env={...f.env,AGENTS_COMPANY_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:process.env.AGENTS_COMPANY_TEST_APP||require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[f.root],env})
const page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(e){throw new Error(e?.message||JSON.stringify(e))}},{cmd,args})
 const channels=[]
 for(const plugin of ['telegram','youtube','x']){
  const source=await call('channel.source-add',{plugin,locator:plugin==='youtube'?'https://www.youtube.com/@WallpaperFixture':'wallpaperlab',name:'Wallpaper '+plugin})
  channels.push({plugin,id:source.channelId})
 }
 for(const theme of ['white','black']){
  await call('settings.set',{theme})
  for(const channel of channels){
   await call('view.open',{kind:'messages',channelId:channel.id})
   const wallpaper=page.locator('.channel-wallpaper')
   await expect(wallpaper).toHaveCount(1)
   await expect(wallpaper).toHaveCSS('background-color',theme==='white'?'rgb(153, 186, 146)':'rgb(0, 0, 0)')
   const style=await wallpaper.evaluate(el=>{const s=getComputedStyle(el,'::after');return {image:s.maskImage,size:s.maskSize,repeat:s.maskRepeat}})
   assert.match(style.image,/telegram-document-pattern/)
   assert.equal(style.size,'430px auto');assert.equal(style.repeat,'repeat')
   await expect(page.locator('.channel-feed')).toHaveCSS('background-image','none')
   await page.screenshot({path:path.join(output,theme+'-'+channel.plugin+'.png')})
  }
 }
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 assert.deepEqual(errors,[])
 console.log('PASS all three channel platforms share the original Telegram wallpaper in both themes; no renderer errors or visible windows')
}finally{await app.close();await f.close()}
