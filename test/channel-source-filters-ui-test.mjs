// Real Mac/Web surfaces and Core; synthetic sources only, no models or production data.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),web=process.argv.includes('--web'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/channel-sources',web?'web':'ui')),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
let f,app,browser,page
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1450,height:940}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1450',AGENTS_COMPANY_HEIGHT:'940'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1450,940))}
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor()
 const rpc=async(cmd,args={})=>{if(cmd==='view.open')return page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args});const result=await f.request(null,cmd,args);assert.ok(result.ok,result.error);return result.data}
 await rpc('settings.set',{language:'en',theme:'white',messageWallpaper:{palette:'purple',pattern:'telegram',opacity:16}})
 const platforms=[]
 for(const plugin of ['telegram','youtube','x']){
  const sources=[];for(const [suffix,name]of [['alpha','Alpha author'],['beta','Beta author'],['gamma','Gamma channel']])sources.push(await rpc('channel.source-add',{plugin,locator:plugin==='telegram'?'filters_'+suffix:'@filters'+suffix,name:plugin+' '+name}))
  const [a,b,c]=sources;for(const source of sources)for(let i=0;i<3;i++)await rpc('channel.publish',{sourceId:source.id,externalId:'filter-'+i,publishedAt:Date.now()-i*1000,title:source.name+' story '+i,body:(plugin==='youtube'?'## 视频总结\n\n':'')+'OpenAI and financial technology news '+i,authorName:source.name})
  await rpc('view.open',{kind:'messages',channelId:a.channelId});const pane=page.locator('.channel-conversation'),bar=pane.locator('.channel-source-tabs'),all=bar.getByRole('button',{name:'All sources',exact:true}),chip=id=>bar.locator(`[data-source-key="${plugin}:${id}"]`)
  for(const [label,selector]of [['Channel view','.channel-news-item'],['Board view','.channel-post-card'],['Posts view','.channel-posts-item']]){
   await pane.getByRole('button',{name:label,exact:true}).click();await expect(all).toHaveAttribute('aria-pressed','true');await expect(pane.locator(selector)).toHaveCount(9)
   const searchButton=bar.getByRole('button',{name:'Search sources',exact:true}),searchbox=bar.getByRole('searchbox',{name:'Search sources',exact:true}),strip=bar.locator('.channel-source-strip')
   await expect(all).toHaveText('All');await expect(searchbox).toHaveCount(0);assert.ok((await all.boundingBox()).width<=38);assert.ok((await searchButton.boundingBox()).width<=36)
   assert.equal(await bar.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');await expect(pane.locator('>.channel-wallpaper')).toBeVisible();await expect(pane.locator('>.channel-wallpaper')).toHaveAttribute('data-wallpaper-palette','purple')
   const wideStrip=(await strip.boundingBox()).width;await searchButton.click();await expect(searchbox).toBeFocused();await expect.poll(async()=>(await strip.boundingBox()).width).toBeLessThan(wideStrip-40);await searchbox.fill('beta');await expect(bar.locator('.channel-source-chip')).toHaveCount(1)
   await chip(b.id).click();await expect(searchbox).toHaveCount(0);await expect(bar.locator('.channel-source-chip')).toHaveCount(3);await expect(pane.locator(selector)).toHaveCount(3);await all.click();await expect(pane.locator(selector)).toHaveCount(9)
   await searchButton.click();await searchbox.fill('no matching author');await expect(bar.locator('.channel-source-chip')).toHaveCount(0);await pane.locator('.channel-person>span').click();await expect(searchbox).toHaveCount(0);await expect(bar.locator('.channel-source-chip')).toHaveCount(3);await expect(searchButton).toHaveAttribute('aria-expanded','false')
   await searchButton.click();await searchbox.fill('beta');await page.keyboard.press('Escape');await expect(searchbox).toHaveCount(0);await expect(searchButton).toBeFocused();await expect(bar.locator('.channel-source-chip')).toHaveCount(3)
   await chip(a.id).click();await expect(pane.locator(selector)).toHaveCount(3);await chip(b.id).click();await expect(pane.locator(selector)).toHaveCount(6);await expect(chip(a.id)).toHaveAttribute('aria-pressed','true');await expect(chip(b.id)).toHaveAttribute('aria-pressed','true')
   await all.click();await expect(pane.locator(selector)).toHaveCount(9);await expect(chip(a.id)).toHaveAttribute('aria-pressed','false');await expect(chip(b.id)).toHaveAttribute('aria-pressed','false');await all.click();await expect(pane.locator(selector)).toHaveCount(6)
   await chip(a.id).click();await expect(pane.locator(selector)).toHaveCount(3);await chip(b.id).click();await expect(all).toHaveAttribute('aria-pressed','true');await expect(pane.locator(selector)).toHaveCount(9)
   const article=pane.locator(selector).first();await article.locator(label==='Board view'?'.channel-post-author':'.channel-author').click();const info=page.getByRole('dialog',{name:'Author information',exact:true});await expect(info).toBeVisible();await expect(info.locator('.channel-profile-locator')).toBeVisible();await expect(info).toContainText('Published articles');await expect(page.locator('.channel-sources-dialog')).toHaveCount(0);await info.getByRole('button',{name:'Close information',exact:true}).click()
   if(label==='Channel view')await expect(pane.getByRole('button',{name:/^Refresh (board|posts)$/})).toHaveCount(0)
   else{const button=pane.getByRole('button',{name:label==='Board view'?'Refresh board':'Refresh posts',exact:true});await expect(button).toBeEnabled();const first=await pane.locator(selector).first().getAttribute(label==='Board view'?'data-news-id':'data-chat-item');await button.click();await expect(button).toBeEnabled();await expect(pane.locator(selector)).toHaveCount(9);if(label==='Posts view')await expect.poll(()=>pane.locator(selector).first().getAttribute('data-chat-item')).not.toBe(first)}
   if(plugin==='youtube')assert.ok(!(await pane.locator('.channel-feed').innerText()).includes('视频总结'))
   await page.screenshot({path:path.join(out,plugin+'-'+label.split(' ')[0].toLowerCase()+'.png'),animations:'disabled'})
  }
  await bar.getByRole('button',{name:'Search sources',exact:true}).click();await bar.getByRole('searchbox',{name:'Search sources',exact:true}).fill('beta');await expect(bar.locator('.channel-source-chip')).toHaveCount(1);await expect(chip(b.id)).toBeVisible();await expect(all).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape')
  await chip(b.id).locator('..').dragTo(chip(a.id).locator('..'),{targetPosition:{x:2,y:10}});await expect.poll(async()=>(await rpc('channel.source-order',{id:a.channelId})).sourceIds[0]).toBe(b.id)
  await pane.getByRole('button',{name:'Board view',exact:true}).click();const header=await pane.locator('>.message-thread-header').boundingBox(),bounds=await pane.boundingBox(),row=await bar.boundingBox();assert.ok(Math.abs(header.x-bounds.x)<3&&Math.abs(header.width-bounds.width)<4,'toolbar spans the pane');assert.ok(header.height<=58,'wide toolbar is compact');assert.ok(row.y-header.y-header.height<=2,'sources directly follow toolbar')
  const style=await bar.locator('.channel-source-strip').evaluate(el=>({scrollbar:getComputedStyle(el).scrollbarWidth,overflow:getComputedStyle(el).overflowX}));assert.equal(style.scrollbar,'none');assert.equal(style.overflow,'auto')
  if(plugin==='telegram')await expect(pane.locator('.channel-header-avatar .channel-brand-icon')).toBeVisible()
  await page.screenshot({path:path.join(out,plugin+'-compact.png'),animations:'disabled'});platforms.push({plugin,id:a.channelId,sources});checks.push(plugin+': compact All and search, click-away/Escape reset, shared wallpaper in all three views; multi-source selection, order, profiles and refresh retained')
 }
 const sample=platforms[0];await rpc('view.open',{kind:'messages',channelId:sample.id});await expect(page.locator('.channel-source-chip').first().locator('[data-source-key]')).toHaveAttribute('data-source-key','telegram:'+sample.sources[1].id)
 const pane=page.locator('.channel-conversation');for(const theme of ['white','black']){await rpc('settings.set',{theme});await page.screenshot({path:path.join(out,'header-'+theme+'.png'),animations:'disabled'})}
 if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,800));else await page.setViewportSize({width:760,height:800});await pane.getByRole('button',{name:'Posts view',exact:true}).click();const dimensions=await pane.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));assert.ok(dimensions.scroll<=dimensions.width+1);await page.screenshot({path:path.join(out,'narrow.png'),animations:'disabled'})
 if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())));assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:process.env.AGENTS_COMPANY_TEST_APP||'source',mode:web?'web':'desktop',checks,errors,modelCalls:0,productionDataUsed:false},null,2)+'\n');checks.forEach(check=>console.log('PASS '+check))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
