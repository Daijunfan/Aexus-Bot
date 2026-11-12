// Real Core/UI, temporary state, hidden desktop or headless Web, deterministic native fixture.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import sharp from 'sharp'
import {profileApplication} from './fixtures/profile-application.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {TITAN_AVATARS,AVATAR_LABELS} from '../src/shared/office.ts'

const root=path.resolve(import.meta.dirname,'..'),native=process.argv.includes('--desktop'),mode=native?'desktop':'web',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??path.join(root,'artifacts/message-refinement',mode)),application=await profileApplication(),require=createRequire(import.meta.url),packaged=process.env.AGENTS_COMPANY_TEST_APP
fs.mkdirSync(out,{recursive:true});const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve))
let f,app,browser,page;const errors=[],checks=[],geometry=[]
try{
 f=await fixtureCore(native?{}:{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)},path.join(application.directory,'out/main/daemon.js'))
 const rpc=async(cmd,args={},token=null)=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,result.error);return result.data}
 await rpc('settings.set',{language:'en',theme:'violet'});await f.cli('group','add','Message studio')
 const employee=await f.create('Mira','Message studio'),agent=await f.token(employee.id)
 await rpc('card.avatar',{id:employee.id,avatar:'titan-mikasa-chibi'});await rpc('messenger.profile',{avatar:'titan-eren-chibi'})
 await rpc('direct.send',{employee:employee.id,text:'Let’s compare the sources.',clientMessageId:'private-user'})
 await f.until(async()=>!(await f.status(employee.id)).busy,'fixture response')
 await rpc('direct.post',{text:'I kept the original evidence and the open questions together.',clientMessageId:'private-agent'},agent)
 const sources=[]
 for(const [plugin,locator,name]of [['telegram','refinement_studio','Field Journal'],['x','@refinestudio','Research Notes'],['youtube','https://www.youtube.com/@RefinementFixture','Video Journal']])sources.push(await rpc('channel.source-add',{plugin,locator,name}))
 for(let i=0;i<8;i++)sources.push(await rpc('channel.source-add',{plugin:'telegram',locator:'refinement_author_'+i,name:'Journal '+i}))
 const cloud=path.join(f.temp,'cloud');fs.mkdirSync(cloud);const host=await rpc('host.create',{name:'Document fixture',host:'fixture',os:'linux',defaultDirectory:cloud}),collector=await rpc('channel.collector-add',{name:'Document fixture',sourceIds:sources.filter(source=>source.platform==='telegram'||source.channelId===sources[0].channelId).map(source=>source.id)})
 await rpc('channel.update',{id:sources[0].channelId,engine:{kind:'external',location:'remote',name:'Document fixture',host:'fixture',endpoint:'http://127.0.0.1:5152',collectorId:collector.collector.id,fileStorage:{hostId:host.id,directory:cloud}}})
 const photo=await sharp({create:{width:900,height:600,channels:4,background:'#7a9c91'}}).png().toBuffer(),posts=[]
 const seedPosts=async()=>{posts.length=0;for(let i=0;i<16;i++){
  const publishedAt=Date.now()-60000-i*1000,source=sources[i%3],externalId='refinement-'+i,mediaIds=[]
  if(i%3===1)mediaIds.push((await rpc('channel.media-put',{sourceId:source.id,externalId,publishedAt,mediaKey:'photo',name:'Field image.png',mimeType:'image/png',data:photo.toString('base64')})).media.id)
  posts.push(await rpc('channel.publish',{sourceId:source.id,externalId,publishedAt,title:i%3===0?'Research edition '+i+'.pdf':'Observation '+i,body:i%3===0?'':'**A closer look.**\n\nPreserve the context and make room for careful reading. '.repeat(i%2?6:2),mediaIds,...(i%3===0?{files:[{id:'edition',name:'Research edition '+i+'.pdf',mimeType:'application/pdf',bytes:6400000,deferred:true}],telegram:{views:128,reactions:[{emoji:'👍',count:3}]}}:{})}))
 }}
 if(!native)await seedPosts()
 if(native){await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1560',AGENTS_COMPANY_HEIGHT:'1050'};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:packaged?desktopExecutable(packaged):require('electron'),args:packaged?[]:[application.directory],env});page=await app.firstWindow();await page.locator('.company-navigation').waitFor();await seedPosts()}
 else{browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1560,height:1050}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.company-navigation').waitFor()
 await page.getByRole('button',{name:'Message',exact:true}).click()
 const contact=id=>page.locator('.message-contact[data-channel="'+id+'"]'),channel=page.locator('.channel-conversation'),feed=channel.locator('.channel-feed'),options=()=>page.getByRole('menu',{name:'Channel options',exact:true})
 await contact(sources[0].channelId).click();await expect(feed).toHaveAttribute('aria-busy','false')
 assert.equal(Math.round(await page.locator('.message-view').evaluate(el=>parseFloat(getComputedStyle(el).gridTemplateColumns))),390)
 assert.equal(await contact(sources[0].channelId).evaluate(el=>getComputedStyle(el).cursor),'pointer')
 assert.equal(await channel.locator('.message-thread-actions>button').count(),3)
 const glass=await channel.locator('.channel-reader-header>.message-thread-header').evaluate(el=>({border:getComputedStyle(el).borderBottomWidth,radius:getComputedStyle(el).borderRadius,blur:getComputedStyle(el).backdropFilter}));assert.equal(glass.border,'0px');assert.match(glass.blur,/blur/);assert.ok(parseFloat(glass.radius)>=20)
 await channel.getByRole('button',{name:'Channel options',exact:true}).click();await expect(options().getByRole('menuitem',{name:'Downloaded files',exact:true})).toBeVisible();await expect(options().getByRole('menuitem',{name:'Manage channels and authors',exact:true})).toBeVisible();await options().getByRole('menuitem',{name:'Channel access',exact:true}).click();await expect(page.getByRole('dialog',{name:'Channel access',exact:true})).toBeVisible();await page.getByRole('dialog',{name:'Channel access',exact:true}).getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('dialog',{name:'Channel access',exact:true})).toHaveCount(0)
 await channel.getByRole('button',{name:'Posts view',exact:true}).click();await expect(channel.locator('.channel-posts-item')).not.toHaveCount(0)
 const measure=()=>feed.evaluate(el=>{const r=el.getBoundingClientRect(),rows=[...el.querySelectorAll('.channel-posts-item')].map(node=>node.getBoundingClientRect()),avatars=[...el.querySelectorAll('.channel-posts-item .channel-author-avatar')].map(node=>node.getBoundingClientRect());return {width:el.clientWidth,scroll:el.scrollWidth,rows:rows.map(r=>({left:r.left,right:r.right,height:r.height})),avatarsInside:avatars.every(a=>a.left>=r.left&&a.right<=r.right),mask:getComputedStyle(el).maskImage,scale:getComputedStyle(el).getPropertyValue('--posts-zoom')}})
 let bounds=await measure();geometry.push(bounds);assert.ok(bounds.avatarsInside);assert.ok(bounds.scroll<=bounds.width+1);assert.ok(bounds.rows.every(row=>row.height<330));assert.match(bounds.mask,/gradient/)
 await page.screenshot({path:path.join(out,'01-posts.png'),animations:'disabled'})
 const navWidth=await page.locator('.message-sidebar').evaluate(el=>el.offsetWidth),box=await feed.boundingBox(),zoom=async delta=>{await page.mouse.move(box.x+box.width*.5,box.y+box.height*.65);await page.keyboard.down('Control');try{await page.mouse.wheel(0,delta)}finally{await page.keyboard.up('Control')};await expect.poll(()=>feed.evaluate(el=>Number(el.style.getPropertyValue('--posts-zoom')))).toBe(delta<0?1.5:1)}
 const anchor=()=>page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.channel-posts-item')?.dataset.chatItem,{x:box.x+box.width*.5,y:box.y+box.height*.65}),beforeZoom=await anchor();assert.ok(beforeZoom);
 await zoom(-Math.log(1.5)/.008);await expect.poll(anchor).toBe(beforeZoom);await page.waitForTimeout(220);bounds=await measure();geometry.push(bounds);assert.ok(bounds.scroll<=bounds.width+1&&bounds.avatarsInside);assert.equal(await page.locator('.message-sidebar').evaluate(el=>el.offsetWidth),navWidth)
 await channel.getByRole('button',{name:'Channel options',exact:true}).click();await expect(options().getByRole('button',{name:'Reset posts size',exact:true})).toHaveText('150%');await page.keyboard.press('Escape')
 await channel.getByRole('button',{name:'Board view',exact:true}).click();assert.equal(await channel.locator('.channel-posts-timeline').count(),0);await channel.getByRole('button',{name:'Posts view',exact:true}).click();await expect.poll(()=>feed.evaluate(el=>Number(el.style.getPropertyValue('--posts-zoom')))).toBe(1.5)
 await zoom(Math.log(1.5)/.008);await page.waitForTimeout(220)
 await channel.getByRole('button',{name:'Channel options',exact:true}).click();await options().getByRole('button',{name:'Zoom in posts',exact:true}).click();await expect(options().getByRole('button',{name:'Reset posts size',exact:true})).toHaveText('110%');await options().getByRole('button',{name:'Reset posts size',exact:true}).click();await expect(options().getByRole('button',{name:'Reset posts size',exact:true})).toHaveText('100%');await page.keyboard.press('Escape')
 checks.push('Navigation is 1.3x wider, rows use the native pointing hand, floating header has no divider, all management actions remain in a keyboard accessible menu, and Posts pinch/manual zoom is scoped, persistent and overflow-free.')
 // Only Category filters keep a moving highlight; conversations and source/view tabs select in place.
 await page.evaluate(()=>{window.selectionMoves=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,timing){if(this.matches('.message-selection-glider'))window.selectionMoves.push({parent:this.parentElement?.className,frames,timing});return animate.call(this,frames,timing)}})
 for(let i=0;i<3;i++){await contact(sources[1].channelId).click();await contact(sources[2].channelId).click();await contact(sources[0].channelId).click()}
 await expect(contact(sources[0].channelId)).toHaveAttribute('aria-current','true')
 await expect(page.locator('.message-contacts .message-selection-glider,.channel-source-strip .message-selection-glider,.channel-view-switch .message-selection-glider')).toHaveCount(0)
 await page.getByRole('button',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:'Private',exact:true}).click();await page.getByRole('button',{name:'All conversations',exact:true}).click()
 await expect(page.locator('.message-category-tabs .message-selection-glider')).toHaveCount(1)
 const moves=await page.evaluate(()=>window.selectionMoves);assert.ok(moves.every(move=>move.parent.includes('message-category-tabs')))
 if(!native)assert.ok(moves.length>0,'Category filters retain selection motion')
 checks.push('Conversation rows and channel source/view tabs select in place without moving highlights; Category alone retains the sliding highlight.')
 await page.getByRole('button',{name:'Message Mira',exact:true}).click();const transcript=page.getByLabel('Private messages',{exact:true})
 await expect(transcript.locator('.private-message-row.is-incoming [data-author-id="'+employee.id+'"] [data-portrait=titan-mikasa-chibi]')).toBeVisible();await expect(transcript.locator('.private-message-row.is-outgoing [data-user-avatar=titan-eren-chibi]')).toBeVisible()
 assert.ok(await transcript.locator('.private-message-row').first().evaluate(row=>{const avatar=row.querySelector('.message-author-avatar'),bubble=row.querySelector('.turn');return avatar&&!bubble.contains(avatar)}))
 await page.getByRole('button',{name:'Your message profile',exact:true}).click();const editor=page.getByRole('dialog',{name:'Your message profile',exact:true})
 await editor.getByLabel('Upload your avatar',{exact:true}).setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:photo});await expect(editor.getByLabel('Avatar zoom',{exact:true})).toBeEnabled();await editor.getByLabel('Avatar zoom',{exact:true}).fill('1.5');await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor).toHaveCount(0);await expect(transcript.locator('.is-outgoing [data-user-avatar=image] img')).toBeVisible()
 const profile=(await rpc('messenger.state')).profile,uploaded=await rpc('messenger.profile-image',{sha256:profile.image.sha256}),meta=await sharp(Buffer.from(uploaded.data,'base64')).metadata();assert.deepEqual([meta.width,meta.height],[512,512])
 await page.screenshot({path:path.join(out,'02-private-avatars.png'),animations:'disabled'})
 await page.getByRole('button',{name:'Your message profile',exact:true}).click();await editor.getByRole('button',{name:'Edit uploaded image',exact:true}).click();await expect(editor.getByLabel('Avatar zoom',{exact:true})).toBeEnabled();await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await rpc('messenger.state')).profile.image.sha256,profile.image.sha256)
 await page.getByRole('button',{name:'Your message profile',exact:true}).click();await editor.getByRole('button',{name:'Choose a character',exact:true}).click()
 for(const id of TITAN_AVATARS){await editor.getByRole('textbox',{name:'Search characters',exact:true}).fill(AVATAR_LABELS[id]);const choice=editor.locator('.message-profile-characters button').filter({has:page.locator('[data-portrait="'+id+'"]')});await choice.scrollIntoViewIfNeeded();await choice.click();const portrait=editor.locator('.message-profile-preview [data-user-avatar="'+id+'"] .portrait-image img');await expect(portrait).toBeVisible();assert.ok(await portrait.evaluate(img=>img.complete&&img.naturalWidth>0));assert.equal(await choice.locator('.employee-portrait').evaluate(el=>getComputedStyle(el).boxShadow),'none')}
 await page.screenshot({path:path.join(out,'03-characters.png'),animations:'disabled'});await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await rpc('messenger.state')).profile.image.sha256,profile.image.sha256)
 checks.push('Private messages show the real employee and user portraits outside bubbles; uploads support positioning/zoom and persist an exact 512px crop; cancel preserves the saved profile; all 19 new character portraits load without external frames.')
 if(!native){for(const width of [1024,800,420]){await page.setViewportSize({width,height:850});await page.getByRole('button',{name:'Back to conversations',exact:true}).click();await contact(sources[0].channelId).click();await channel.getByRole('button',{name:'Posts view',exact:true}).click();const small=await measure();geometry.push(small);assert.ok(small.scroll<=small.width+1&&small.avatarsInside,'Posts fit '+width);await page.screenshot({path:path.join(out,'posts-'+width+'.png'),animations:'disabled'})}}
 else assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,mode,checks,geometry,errors,paidModelCalls:0,productionDataUsed:false},null,2));console.log(checks.map(check=>'PASS '+check).join('\n'))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close();application.dispose()}
