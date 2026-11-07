// Actual hidden desktop. Synthetic platform content only; no platform/network/model requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import sharp from 'sharp'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-channel-views-')))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_HIDDEN:'1'}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/channel-redesign/ui');fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[],checks=[]
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'})
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));await call('channel.settings',{patch:{enabled:true,port}})
 const issued=await call('channel.collector-add',{name:'Fixture publishers',sourceIds:'all'}),pixel=(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#08665b"/><circle cx="40" cy="30" r="14" fill="#f6d9b7"/><circle cx="40" cy="80" r="29" fill="#ef935c"/></svg>')).png().toBuffer()).toString('base64')
 const covers=await Promise.all(['#2153a5','#a63a60','#167c71'].map(async(color,index)=>(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${320+index*120}"><rect width="100%" height="100%" fill="${color}"/><circle cx="340" cy="150" r="130" fill="#ffffff" opacity=".12"/><rect x="45" y="80" width="260" height="135" rx="16" fill="#ffffff" opacity=".15"/><text x="45" y="120" fill="white" font-size="27" font-family="sans-serif">Technology update</text><text x="45" y="165" fill="white" font-size="19" font-family="sans-serif">Channel visual fixture ${index+1}</text></svg>`)).png().toBuffer()).toString('base64')))
 const publish=async(cmd,args)=>{const response=await fetch(`http://127.0.0.1:${port}/api/channels/collector`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data}
 const sources=[]
 for(const [plugin,locator,name] of [['x','@viewalpha','Alice'],['x','@viewbeta','Bob'],['youtube','@viewvideo','Video creator'],['telegram','view_news','Telegram publisher']]){const source=await call('channel.source-add',{plugin,locator,name});sources.push(source);await publish('channel.source-avatar-put',{sourceId:source.id,name:'Native platform avatar',mimeType:'image/png',data:pixel})}
 const [x1,x2,yt,tg]=sources
 for(let i=0;i<15;i++)for(const source of [x1,x2,yt,tg]){const externalId='item-'+i,publishedAt=Date.now()-i*1000,media=i%3!==2?await publish('channel.media-put',{sourceId:source.id,externalId,publishedAt,mediaKey:'cover',name:'Technology.png',mimeType:'image/png',data:covers[i%3]}):null;await publish('channel.publish',{sourceId:source.id,externalId,publishedAt,title:source.name+' update '+i,body:'Platform content with a native author identity. '+('Readable channel news. '.repeat(i%3+1)),...(source.plugin==='x'?{authorUrl:'https://x.com/'+source.locator.split('/').at(-1)}:{}),mediaIds:media?[media.media.id]:[]})}
 const future=await call('channel.create',{name:'Future platform',engine:{kind:'external',location:'local',name:'Future process'}})
 for(const channelId of [x1.channelId,yt.channelId,tg.channelId,future.id]){
  await call('view.open',{kind:'messages',channelId})
  for(const label of ['Channel view','Board view','Posts view'])await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(1)
 }
 await call('view.open',{kind:'messages',channelId:x1.channelId})
 await expect(page.locator(`[data-conversation-key="channel:${x1.channelId}"]`)).toHaveCount(1)
 for(const source of [x1,x2,yt])await expect(page.locator(`[data-conversation-key="source:${source.id}"]`)).toHaveCount(0)
 await page.getByRole('button',{name:'Board view',exact:true}).click();await expect(page.locator('[data-feed-view=board] .channel-post-card')).toHaveCount(24)
 await expect(page.locator('.channel-post-author [data-avatar-state=ready]').first()).toBeVisible()
 await expect(page.locator('.channel-post-author img').first()).toHaveAttribute('src',/^data:image\/png;base64,/)
 await page.screenshot({path:path.join(out,'board-light.png'),animations:'disabled'})
 pass('X and YouTube each have one channel; every platform and a future channel expose Channel/Board/Posts; Board uses original author image bytes')
 await page.getByRole('button',{name:'Posts view',exact:true}).click();await expect(page.locator('.channel-posts-item')).toHaveCount(24)
 const first=await page.locator('.channel-posts-item .channel-news-card').first().getAttribute('data-news-id')
 await page.getByRole('button',{name:'Refresh posts',exact:true}).click()
 await expect.poll(async()=>page.locator('.channel-posts-item .channel-news-card').first().getAttribute('data-news-id')).not.toBe(first)
 const before=await page.locator('.channel-posts-item .channel-news-card').evaluateAll(items=>items.map(item=>item.getAttribute('data-news-id')))
 await page.locator('.channel-posts-sentinel').scrollIntoViewIfNeeded();await expect(page.locator('.channel-posts-item')).toHaveCount(30)
 const after=await page.locator('.channel-posts-item .channel-news-card').evaluateAll(items=>items.map(item=>item.getAttribute('data-news-id')));assert.deepEqual(after.slice(0,before.length),before);assert.equal(new Set(after).size,30)
 await page.locator('.channel-feed').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(out,'posts-light.png'),animations:'disabled'})
 await call('settings.set',{theme:'black'});await page.screenshot({path:path.join(out,'posts-dark.png'),animations:'disabled'})
 pass('Posts refresh changes the top item and infinite scrolling appends stable nonduplicated items, with native-avatar timeline styling')
 const marker='UNSAVED_RENDERER_'+Date.now();await publish('channel.publish',{sourceId:yt.id,externalId:'disk-probe',publishedAt:Date.now()-10,title:'Disk privacy check',body:marker})
 await call('view.open',{kind:'messages',channelId:yt.channelId});await page.getByRole('button',{name:'Posts view',exact:true}).click();await expect(page.locator('.channel-posts-item').filter({hasText:marker})).toHaveCount(1)
 const files=[];const walk=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,item.name);if(item.isDirectory())walk(target);else if(item.isFile())files.push(target)}};walk(env.AGENTS_COMPANY_HOME)
 for(const file of files)if(fs.statSync(file).size<30*1024*1024)assert.equal(fs.readFileSync(file).includes(Buffer.from(marker)),false,'unsaved renderer payload was persisted: '+file)
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 pass('Browsing the real renderer writes no unsaved message marker into the Mac data/profile files')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,modelCalls:0,application:application||'source'},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
