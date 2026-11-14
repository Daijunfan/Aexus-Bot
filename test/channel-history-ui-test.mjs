// User browsing flows against an isolated authenticated Core, without collectors or model calls.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/channel-history/'+mode)
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'result.json'),{force:true})
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let fixture,app,browser,page;const checks=[],errors=[],posts=new Map(),requests=[]
const pass=text=>{checks.push(text);console.log('PASS '+mode+': '+text)}
try{
 fixture=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const core=async(cmd,args={})=>{const result=await fixture.request(null,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data}
 await core('settings.set',{language:'en',viewAppearance:{messages:{theme:'violet'}}})
 const sources=[]
 for(const [plugin,locator,name] of [['x','@history_one','History one'],['x','@history_two','History two'],['telegram','history_telegram','Magazine history'],['youtube','@HistoryVideo','Video history']])sources.push(await core('channel.source-add',{plugin,locator,name}))
 const stamp=Date.now()-3*86400000
 const publish=async(source,index,time=stamp+Math.floor(index/5)*60000)=>{
  const post=await core('channel.publish',{sourceId:source.id,externalId:'history-'+index,publishedAt:time,title:'History '+index,body:('Retained article '+index+'. Read the original publication in chronological order. ').repeat(4)})
  posts.set(post.id,{...post,publishedAt:time,sourceId:source.id});return post
 }
 // Arrival order deliberately differs from publication order; groups share exact timestamps.
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(fixture.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await fixture.stop();const env={...fixture.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 for(let i=0;i<96;i++)await publish(sources[i%2],(i*37)%96)
 for(const source of sources.slice(2))for(let i=0;i<29;i++)await publish(source,i)
 await core('channel.acknowledge',{id:sources[0].channelId,all:true})
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'})
 await page.locator('.company-navigation').waitFor()
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});const call=window.agents.call.bind(window.agents);window.historyRequests=[];window.agents.call=async(cmd,args)=>{if(cmd==='channel.posts')window.historyRequests.push(structuredClone(args));return call(cmd,args)}})
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),feed=page.locator('.channel-feed'),rows=page.locator('.channel-news-item[data-chat-item]')
 const open=async source=>{if(!await page.locator('.message-view').count())await rpc('view.open',{kind:'messages'});await page.locator('[data-channel="'+source.channelId+'"]').click();await expect(feed).toBeVisible();await expect.poll(()=>rows.count()).toBeGreaterThan(0)}
 const ordered=async(descending=false)=>{
  const ids=await page.locator(descending?'.channel-posts-item[data-chat-item]':'.channel-news-item[data-chat-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.chatItem))
  assert.equal(new Set(ids).size,ids.length,'no duplicate publications')
  for(let i=1;i<ids.length;i++){const a=posts.get(ids[i-1]),b=posts.get(ids[i]);assert.ok(a&&b);assert.ok(descending?a.publishedAt>=b.publishedAt:a.publishedAt<=b.publishedAt,'publication timestamps must be monotonic');if(a.publishedAt===b.publishedAt)assert.ok(descending?ids[i-1]>ids[i]:ids[i-1]<ids[i],'equal timestamps use the same stable ID order as the cursor')}
  return ids
 }
 const wheelUp=async()=>{const box=await feed.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100000);await page.waitForTimeout(180)}
 const readingGeometry=async anchorId=>page.evaluate(anchorId=>{const area=document.querySelector('.channel-feed'),header=document.querySelector('.channel-reader-header'),anchor=area.querySelector('[data-chat-item="'+anchorId+'"]'),style=getComputedStyle(area);return {scrollTop:area.scrollTop,offsetHeight:area.offsetHeight,cssHeight:style.height,padding:style.padding,readInset:style.getPropertyValue('--message-read-inset'),area:area.getBoundingClientRect().toJSON(),headerHeight:header.offsetHeight,anchor:anchor?.getBoundingClientRect().toJSON(),dividers:[...area.querySelectorAll('[data-channel-unread]')].map(node=>({id:node.dataset.channelUnread,box:node.getBoundingClientRect().toJSON()})),rows:[...area.querySelectorAll('[data-chat-item]')].map(node=>({id:node.dataset.chatItem,y:node.getBoundingClientRect().y,height:node.getBoundingClientRect().height,text:node.querySelector('h2,h3')?.textContent})),storage:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('/timeline/')))}} ,anchorId)
 const xCount=()=>[...posts.values()].filter(post=>sources.slice(0,2).some(source=>source.id===post.sourceId)).length
 await open(sources[0]);await expect.poll(()=>feed.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(6);const initialCount=await rows.count();await ordered()
 if(web){
  let failed=false;const interrupt=async route=>{const request=route.request().postDataJSON();if(!failed&&request.cmd==='channel.posts'&&request.args.channelId===sources[0].channelId&&request.args.cursor){failed=true;await route.abort('failed')}else await route.continue()}
  await page.route('**/api/rpc',interrupt);await wheelUp();await expect(page.locator('.channel-inline-error')).toBeVisible();await page.unroute('**/api/rpc',interrupt);await page.locator('.channel-inline-error').getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>rows.count()).toBeGreaterThan(initialCount);await expect(page.locator('.channel-inline-error')).toHaveCount(0)
  pass('A failed history request keeps loaded articles and retries that same page')
  let release;const gate=new Promise(resolve=>release=resolve);let held=false
  const delay=async route=>{const request=route.request().postDataJSON();if(!held&&request.cmd==='channel.posts'&&request.args.channelId===sources[0].channelId&&request.args.cursor){held=true;const response=await route.fetch();await gate;await route.fulfill({response})}else await route.continue()}
  await page.route('**/api/rpc',delay);const requested=page.waitForRequest(request=>request.url().endsWith('/api/rpc')&&request.postDataJSON()?.cmd==='channel.posts'&&!!request.postDataJSON()?.args.cursor)
  await wheelUp();const request=await requested,cursor=request.postDataJSON().args.cursor
  try{await wheelUp();await wheelUp();assert.equal(await page.evaluate(cursor=>window.historyRequests.filter(args=>args.cursor===cursor).length,cursor),1);await publish(sources[0],902,stamp+3600000);await page.waitForTimeout(250)}finally{release();await (await request.response())?.finished();await page.unroute('**/api/rpc',delay)}
  pass('Repeated wheel gestures share one pending page; a publication arriving during paging is retained')
 }
 await wheelUp();await expect.poll(()=>rows.count(),{timeout:4000}).toBeGreaterThan(initialCount)
 pass('Scrolling upward loads earlier X publications without clicking a hidden pagination button')
 for(let pageNumber=0;pageNumber<5&&await rows.count()<xCount();pageNumber++){await wheelUp();await page.waitForTimeout(300)}
 await expect(rows).toHaveCount(xCount());const complete=await ordered();assert.equal(complete.length,xCount());await expect(page.getByRole('button',{name:'Load earlier articles',exact:true})).toHaveCount(0)
 pass('Every retained page is reachable, including timestamp ties, without duplicates or arrival-order sorting')
 // An ordinary reader stays on the same visible article while new or backfilled news arrives.
 const anchor=rows.nth(35);await anchor.scrollIntoViewIfNeeded();const anchorId=await anchor.getAttribute('data-chat-item'),before=await anchor.boundingBox()
 await publish(sources[0],900,stamp+86400000);await publish(sources[1],901,stamp-60000)
 await expect(rows).toHaveCount(xCount());await ordered();await expect.poll(async()=>Math.abs((await page.locator('[data-chat-item="'+anchorId+'"]').boundingBox()).y-before.y)).toBeLessThan(4)
 pass('New arrivals and older backfills keep their publication time and preserve the visible reading anchor')
 fs.writeFileSync(path.join(out,'reading-before.json'),JSON.stringify(await readingGeometry(anchorId),null,2))
 await page.locator('.channel-conversation').screenshot({path:path.join(out,'chronological-history.png'),animations:'disabled'})
 // Switching away must preserve the loaded history and the reader's location.
 await open(sources[2]);await open(sources[0]);await expect(rows).toHaveCount(xCount())
 fs.writeFileSync(path.join(out,'reading-after.json'),JSON.stringify(await readingGeometry(anchorId),null,2))
 await expect.poll(async()=>Math.abs((await page.locator('[data-chat-item="'+anchorId+'"]').boundingBox()).y-before.y)).toBeLessThan(4)
 pass('Returning to X restores the loaded historical range and the same article position')
 await rpc('view.open',{kind:'home'});await open(sources[0]);await expect(rows).toHaveCount(xCount());await expect.poll(async()=>Math.abs((await page.locator('[data-chat-item="'+anchorId+'"]').boundingBox()).y-before.y)).toBeLessThan(4)
 pass('Programmatic navigation retains the same reading point without relying on a sidebar pointer event')
 if(web){
  let release,held=false;const gate=new Promise(resolve=>release=resolve)
  const delay=async route=>{const request=route.request().postDataJSON();if(!held&&request.cmd==='channel.posts'&&request.args.sourceIds?.length===1&&request.args.sourceIds[0]===sources[0].id){held=true;const response=await route.fetch();await gate;await route.fulfill({response})}else await route.continue()}
  await page.route('**/api/rpc',delay);const requested=page.waitForRequest(request=>request.url().endsWith('/api/rpc')&&request.postDataJSON()?.cmd==='channel.posts'&&request.postDataJSON()?.args.sourceIds?.length===1&&request.postDataJSON()?.args.sourceIds[0]===sources[0].id)
  await page.getByRole('button',{name:sources[0].name,exact:true}).click();const request=await requested
  let fresh
  try{await page.getByRole('button',{name:sources[1].name,exact:true}).click();await page.getByRole('button',{name:sources[0].name,exact:true}).click();await expect.poll(async()=>{const ids=await ordered();return ids.length>0&&ids.every(id=>posts.get(id).sourceId===sources[1].id)}).toBe(true);fresh=await publish(sources[0],903,stamp+7200000);await page.getByRole('button',{name:sources[0].name,exact:true}).click();await page.getByRole('button',{name:sources[1].name,exact:true}).click();await expect(page.locator('[data-chat-item="'+fresh.id+'"]')).toHaveCount(1)}finally{release();await (await request.response())?.finished();await page.unroute('**/api/rpc',delay)}
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.ok((await ordered()).every(id=>posts.get(id).sourceId===sources[0].id));await expect(page.locator('[data-chat-item="'+fresh.id+'"]')).toHaveCount(1);await page.getByRole('button',{name:'All sources',exact:true}).click();await expect(rows).toHaveCount(xCount());await ordered()
  pass('A delayed response from a previous source filter cannot overwrite the currently selected source or its cursor')
 }
 for(const source of sources.slice(2)){await open(source);for(let attempt=0;attempt<3&&await rows.count()<29;attempt++){await wheelUp();await page.waitForTimeout(200)}await expect(rows).toHaveCount(29);await ordered()}
 pass('Telegram and YouTube use the same chronological history paging')
 await open(sources[0]);await page.getByRole('button',{name:'Posts view',exact:true}).click();await expect(page.locator('.channel-posts-item')).not.toHaveCount(0);await ordered(true)
 await page.getByRole('button',{name:'Channel options',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh posts',exact:true}).click();await expect(page.locator('.channel-posts-item').first()).toHaveAttribute('data-chat-item',[...posts.values()].filter(post=>post.sourceId===sources[0].id||post.sourceId===sources[1].id).sort((a,b)=>b.publishedAt-a.publishedAt)[0].id);await ordered(true)
 pass('Posts and refresh show newest publications first instead of a random discovery mix')
 if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 requests.push(...await page.evaluate(()=>window.historyRequests));assert.deepEqual(errors,[]);assert.deepEqual(await core('session.list',{live:true}),[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,requests,errors,productionDataUsed:false,modelCalls:0},null,2)+'\n')
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await fixture?.close()}
