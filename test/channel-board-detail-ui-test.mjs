// Board reading on real desktop/Web surfaces with temporary content and no model calls.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import sharp from 'sharp'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),web=process.argv.includes('--web'),probeOnly=process.argv.includes('--probe-close')
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/channel-board-detail-2026-11-06/'+(web?'web':'desktop')),errors=[],checks=[]
fs.mkdirSync(out,{recursive:true})
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
let fixture,app,browser,page
try{
 fixture=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 if(web){
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1450,height:960}})
  await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(fixture.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
 }else{
  await fixture.stop();const env={...fixture.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1450',AGENTS_COMPANY_HEIGHT:'960'};delete env.ELECTRON_RUN_AS_NODE
  const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()
 }
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.infinite-canvas').waitFor()
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await rpc('settings.set',{language:'en',theme:'white',messageWallpaper:{palette:'purple-gradient',pattern:'telegram'}})
 const png=await sharp({create:{width:640,height:420,channels:3,background:'#b6c6dd'}}).png().toBuffer()
 for(const plugin of probeOnly?['x']:['telegram','x','youtube']){
  const source=await rpc('channel.source-add',{plugin,locator:plugin==='telegram'?'board_detail':'@board_detail',name:plugin+' design notes'}),publishedAt=Date.now()-60000,mediaIds=[]
  for(let i=0;i<6;i++)mediaIds.push((await rpc('channel.media-put',{sourceId:source.id,externalId:'album',publishedAt,mediaKey:'photo-'+i,name:'Photo '+(i+1)+'.png',mimeType:'image/png',data:png.toString('base64')})).media.id)
  const tail='COMPLETE ARTICLE END '+plugin,body=Array.from({length:90},(_,i)=>'## Section '+(i+1)+'\n\nA useful story keeps every original paragraph and its context.').join('\n\n')+'\n\n'+tail
  const album=await rpc('channel.publish',{sourceId:source.id,externalId:'album',publishedAt,title:'A complete illustrated story',body,mediaIds})
  const text=await rpc('channel.publish',{sourceId:source.id,externalId:'text',publishedAt:publishedAt-1000,title:'Text-only title',body:'Text-only content starts here. A compact card should not create an empty photo box.'})
  const captionMedia=await rpc('channel.media-put',{sourceId:source.id,externalId:'caption',publishedAt:publishedAt-2000,mediaKey:'caption-photo',name:'Caption photo.png',mimeType:'image/png',data:png.toString('base64')})
  const caption=await rpc('channel.publish',{sourceId:source.id,externalId:'caption',publishedAt:publishedAt-2000,title:'',body:'A photograph with its caption underneath.',mediaIds:[captionMedia.media.id]})
  await rpc('view.open',{kind:'messages',channelId:source.channelId});const pane=page.locator('.channel-conversation');await pane.getByRole('button',{name:'Board view',exact:true}).click()
  const card=id=>pane.locator('.channel-post-card[data-news-id="'+id+'"]'),detail=page.getByRole('dialog',{name:'Post details',exact:true}),gallery=page.getByRole('dialog',{name:'Image preview',exact:true})
  await expect(card(album.id).locator('.channel-post-cover img')).toHaveCount(1);await expect(card(album.id).locator('.channel-post-cover img')).toHaveAttribute('alt','Photo 1.png');await card(album.id).locator('.channel-post-open').click();await expect(detail).toBeVisible()
  await detail.locator('.channel-news-images>button').first().click();await expect(gallery).toBeVisible();await expect.poll(()=>gallery.locator('.message-image-viewport>img:not([data-gallery-exit])').evaluateAll(images=>images.some(image=>image.complete&&image.naturalWidth>0))).toBe(true)
  await gallery.getByRole('button',{name:'Close image preview',exact:true}).click();await expect(gallery).toHaveCount(0);await expect(detail).toBeVisible()
  if(probeOnly){
   for(const state of ['opening','zoomed','zero-size']){
    await detail.locator('.channel-news-images>button').first().click();await expect(gallery).toBeVisible()
    if(state==='zoomed')await gallery.getByRole('button',{name:'Zoom in',exact:true}).click()
    if(state==='zero-size')await gallery.locator('.message-image-viewport>img').evaluate(image=>{image.style.width='0px';image.style.height='0px'})
    await gallery.getByRole('button',{name:'Close image preview',exact:true}).click({force:state==='opening'});await expect(gallery).toHaveCount(0);await expect(detail).toBeVisible()
   }
   checks.push('Close image preview returns to the Board detail while opening, zoomed and without image dimensions');break
  }
  await expect(detail.locator('.channel-news-body')).toContainText(tail);await expect(detail.locator('.channel-news-body.collapsed,.channel-read-more')).toHaveCount(0);await expect(detail.locator('.channel-news-images>button')).toHaveCount(6)
  await expect(page.locator('[data-message-image-exit]')).toHaveCount(0);const imageBlock=await detail.locator('.channel-news-images').boundingBox(),bodyBlock=await detail.locator('.channel-news-body').boundingBox();assert.ok(bodyBlock.y>=imageBlock.y+imageBlock.height,'The complete detail also puts photos before the text');await detail.locator('.channel-post-detail-scroll').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(out,plugin+'-detail.png')})
  await detail.locator('.channel-news-images>button').last().click();await expect(gallery.getByLabel('Image position',{exact:true})).toHaveText('Image 6 of 6');await gallery.getByRole('button',{name:'Previous image',exact:true}).click();await expect(gallery.getByLabel('Image position',{exact:true})).toHaveText('Image 5 of 6');await gallery.getByRole('button',{name:'Close image preview',exact:true}).click();await expect(gallery).toHaveCount(0)
  await detail.locator('.channel-news-images>button').first().click();await page.keyboard.press('Escape');await expect(gallery).toHaveCount(0);await expect(detail).toBeVisible();await detail.getByRole('button',{name:'Close post',exact:true}).click();await expect(detail).toHaveCount(0);await expect(page.locator('.message-image-overlay')).toHaveCount(0);await expect(pane).toHaveAttribute('data-feed-view','board');await expect(card(album.id).locator('.channel-post-open')).toBeFocused()
  const cover=await card(album.id).locator('.channel-post-cover').boundingBox(),heading=await card(album.id).locator('.channel-post-details').boundingBox();assert.ok(heading.y>=cover.y+cover.height-1,'The photograph precedes the card heading')
  await expect(card(text.id)).toContainText('Text-only content starts here.');await expect(card(text.id).locator('.channel-post-cover img,.channel-post-text svg,.channel-post-text .icon')).toHaveCount(0);const textBox=await card(text.id).locator('.channel-post-open').boundingBox();assert.ok(textBox.height<200,'Text-only cards size to their text instead of a fake cover')
  await card(text.id).locator('.channel-post-open').click();await expect(detail.locator('.channel-news-body')).toContainText('empty photo box');await detail.getByRole('button',{name:'Close post',exact:true}).click()
  await expect(card(caption.id)).toContainText('A photograph with its caption underneath.')
  await page.screenshot({path:path.join(out,plugin+'-board.png')});checks.push(plugin+': first-image preview, compact text-only cards, full long body and six photos, image X/Escape and detail X return to the same Board')
 }
 if(!probeOnly){
  await rpc('group.add',{name:'Gallery checks'});const employee=await fixture.create('Gallery reader','Gallery checks'),token=await fixture.token(employee.id)
  await rpc('workspace.write',{employee:employee.id,path:'media/photo.png',contentBase64:png.toString('base64'),create:true})
  const published=await fixture.request(token,'direct.post',{text:'An explicitly shared photograph.',images:['media/photo.png'],clientMessageId:'gallery-private'});assert.ok(published.ok,published.error)
  const group=await rpc('chat.create',{name:'Gallery checks',members:[employee.id]}),upload=await rpc('messenger.upload-begin',{conversation:'group:'+group.id,name:'shared.png',bytes:png.length})
  await rpc('transfer.upload-chunk',{id:upload.id,offset:0,data:png.toString('base64')});const file=(await rpc('transfer.upload-commit',{id:upload.id})).destination
  await rpc('chat.post',{id:group.id,text:'A shared group photograph.',images:[file],clientMessageId:'gallery-group'})
  for(const [name,view]of [['private',{employee:employee.id}],['group',{chatId:group.id}]]){
   await rpc('view.open',{kind:'messages',...view});const opener=page.locator('.message-stage .message-photo').first(),gallery=page.getByRole('dialog',{name:'Image preview',exact:true})
   for(const scale of [1,1.25,.8]){
    await rpc('settings.set',{pageZoom:scale});await expect.poll(()=>web?page.evaluate(()=>Number(getComputedStyle(document.documentElement).zoom)):app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(scale);await opener.click();await expect(gallery).toBeVisible();await gallery.getByRole('button',{name:'Close image preview',exact:true}).click();await expect(gallery).toHaveCount(0);await expect(opener).toBeFocused()
   }
   await expect(page.locator('.message-image-overlay')).toHaveCount(0);checks.push(name+': shared image viewer closes by X at 80/100/125 percent and restores focus')
  }
 }
 assert.deepEqual(errors,[]);if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:process.env.AGENTS_COMPANY_TEST_APP||'source',mode:web?'web':'desktop',checks,errors,modelCalls:0,productionDataUsed:false},null,2));for(const check of checks)console.log('PASS '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,errors},null,2));throw error}
finally{await app?.close();await browser?.close();await fixture?.close()}
