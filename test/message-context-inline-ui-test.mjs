// Actual Mac/Web UI; external bots and engines are deterministic local fixtures.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),web=process.argv.includes('--web'),checks=[],errors=[]
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/message-context-inline-2026-11-07/'+(web?'web':'desktop'));fs.mkdirSync(out,{recursive:true})
const body=Array.from({length:18},(_,i)=>'Paragraph '+(i+1)+': a complete message keeps its context and can be managed with a right click.').join('\n\n')
const nativeBots=[{id:'dot',name:'Dot',provider:'dots',kind:'private'},{id:'grok',name:'Grok Bot',provider:'grok',kind:'private'},{id:'grok-room',name:'Grok Room',provider:'grok',kind:'group'}]
const provider=http.createServer(async(req,res)=>{let bytes='';for await(const part of req)bytes+=part;const request=JSON.parse(bytes);res.setHeader('content-type','application/json');res.end(JSON.stringify(request.method==='list'?nativeBots.filter(bot=>bot.provider===request.args.provider):request.method==='messages'?[{id:'reply-'+request.args.binding.remoteId,revision:'1',cursor:'1',role:'assistant',text:body,createdAt:Date.now()-100000,files:[]}]:[]))});await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve))
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
let fixture,app,browser,page
try{
 fixture=await fixtureCore({AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+provider.address().port,...(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})})
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1380,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(fixture.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await fixture.stop();const env={...fixture.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1380',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.infinite-canvas').waitFor()
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 // Clipboard writes are observed at the browser API boundary; never replace the Mac clipboard.
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedText=value}}}))
 await rpc('settings.set',{language:'en'});await rpc('group.add',{name:'Studio'});const a=await fixture.create('小花','Studio'),b=await fixture.create('小王','Studio'),token=await fixture.token(a.id),group=await rpc('chat.create',{name:'Research room',members:[a.id,b.id]})
 await rpc('view.open',{kind:'messages',chatId:group.id});const composer=page.getByRole('textbox',{name:'Group message',exact:true})
 await composer.fill('小花，你和去调研一下');await composer.evaluate(el=>el.setSelectionRange(5,5));await composer.pressSequentially('@');await page.getByRole('option').filter({hasText:'小王'}).click();await composer.pressSequentially('一起')
 const expected='小花，你和@小王 一起去调研一下';await expect(composer).toHaveValue(expected);await expect(page.locator('.group-recipient-chips,.group-mention-menu')).toHaveCount(0)
 await page.getByRole('button',{name:'Send group message',exact:true}).click();await fixture.until(async()=>{const history=await rpc('chat.history',{id:group.id});return history.messages.some(message=>message.text===expected&&message.deliveries.every(delivery=>delivery.status==='completed'))},'inline mention delivery')
 const sent=(await rpc('chat.history',{id:group.id})).messages.find(message=>message.text===expected);assert.deepEqual(sent.mentions,[b.id]);assert.equal(sent.deliveries.find(delivery=>delivery.employeeId===b.id).mode,'work');assert.equal(sent.deliveries.find(delivery=>delivery.employeeId===a.id).mode,'awareness')
 await expect(page.locator('[data-chat-item="'+sent.id+'"]')).toContainText(expected);await expect(page.locator('.group-message-mentions')).toHaveCount(0);assert.equal((await rpc('direct.history',{employee:b.id})).items.length,0)
 const native=await fixture.cli('session','transcript',b.id);assert.ok(native.items.some(item=>item.role==='user'&&item.text?.includes(expected)),'The native employee sees the mention in its original sentence position')
 await composer.fill('稍后@');await page.getByRole('option').filter({hasText:'小王'}).click();await expect(composer).toHaveValue('稍后@小王 ');await composer.fill('稍后再说');await fixture.until(async()=>{const draft=(await rpc('messenger.state')).drafts['group:'+group.id];return draft?.text==='稍后再说'&&draft.mentions.length===0},'removed mention target')
 await page.getByRole('button',{name:'@ All',exact:true}).click();await expect(composer).toHaveValue('稍后再说@all ');await composer.fill('');checks.push('A caret-position @mention keeps the sentence suffix, routes to the chosen stable ID, reaches native context inline, and disappears from routing when deleted; @all is inline')
 const privatePost=await fixture.request(token,'direct.post',{text:body,clientMessageId:'private-context'});assert.ok(privatePost.ok,privatePost.error)
 const groupPost=await fixture.request(token,'chat.post',{id:group.id,text:body,clientMessageId:'group-context'});assert.ok(groupPost.ok,groupPost.error)
 const noRails=()=>expect(page.locator('.message-view .message-actions,.message-view .message-action-rail,.channel-news-actions')).toHaveCount(0)
 const context=async(target,label,shot,edge=false)=>{
  await target.scrollIntoViewIfNeeded();await target.hover();await noRails()
  const point=await target.evaluate((el,edge)=>{const r=el.getBoundingClientRect(),v=(el.closest('.transcript,.group-transcript,.channel-feed,.channel-post-detail-scroll')??el).getBoundingClientRect();return edge?{x:Math.min(r.right,v.right)-18,y:Math.min(r.bottom,v.bottom)-18}:{x:Math.max(r.left,v.left)+12,y:Math.max(r.top,v.top)+12}},edge)
  await page.mouse.click(point.x,point.y,{button:'right'});const menu=page.getByRole('menu',{name:label,exact:true});await expect(menu).toBeVisible();await expect.poll(()=>menu.evaluate(el=>el.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0)
  const box=await menu.boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'Context menu stays in the viewport')
  if(point.x+4+box.width<viewport.width-10)assert.ok(Math.abs(box.x-point.x-4)<2,'Menu is immediately to the right of the cursor')
  if(point.y+4+box.height<viewport.height-10)assert.ok(Math.abs(box.y-point.y-4)<2,'Menu is immediately below the cursor')
  await expect(menu.getByRole('menuitem',{name:/Report|Copy.*Link/i})).toHaveCount(0);await expect(menu.getByRole('menuitem',{name:'Copy text',exact:true})).toBeVisible();if(shot)await page.screenshot({path:path.join(out,shot+'.png')});return menu
 }
 for(const [name,view,id]of [['private',{employee:a.id},privatePost.data.id],['group',{chatId:group.id},groupPost.data.id]]){
  await rpc('view.open',{kind:'messages',...view});const target=page.locator('[data-chat-item="'+id+'"]')
  for(const scale of [1,1.25,.8]){await rpc('settings.set',{pageZoom:scale});await expect.poll(()=>web?page.evaluate(()=>Number(getComputedStyle(document.documentElement).zoom)):app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(scale);const menu=await context(target,'Message options',scale===1?name+'-menu':undefined);await menu.getByRole('menuitem',{name:'Copy text',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.copiedText)).toBe(body)}
  checks.push(name+': no hover toolbar; context Copy works at 80/100/125 percent and follows the cursor')
 }
 await rpc('settings.set',{pageZoom:1});await rpc('view.open',{kind:'messages',chatId:group.id});const groupTarget=page.locator('[data-chat-item="'+groupPost.data.id+'"]')
 let actions=await context(groupTarget,'Message options');await actions.getByRole('menuitem',{name:'Save message',exact:true}).click();await expect.poll(async()=>(await rpc('messenger.state')).messages['group:'+group.id+'/'+groupPost.data.id]?.saved).toBe(true)
 actions=await context(groupTarget,'Message options');await actions.getByRole('menuitem',{name:'Remove from saved',exact:true}).click()
 actions=await context(groupTarget,'Message options');await actions.getByRole('menuitem',{name:'Reply',exact:true}).click();await expect(page.locator('.group-replying')).toBeVisible();await page.getByRole('button',{name:'Cancel group reply',exact:true}).click()
 actions=await context(groupTarget,'Message options');await actions.getByRole('menuitem',{name:'Select message',exact:true}).click();await expect(groupTarget.getByRole('checkbox',{name:'Select this message',exact:true})).toBeChecked();await page.getByRole('button',{name:'Cancel message selection',exact:true}).click()
 actions=await context(groupTarget,'Message options');await actions.getByRole('menuitem',{name:'Forward message',exact:true}).click();await expect(page.getByRole('dialog',{name:'Forward messages',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close forwarding',exact:true}).click();await expect(page.getByRole('dialog',{name:'Forward messages',exact:true})).toHaveCount(0)
 checks.push('Context actions actually save/unsave, open a reply, select the message and open forwarding')
 await rpc('settings.set',{pageZoom:1});await rpc('bot.sync');for(const bot of await rpc('bot.list')){await rpc('view.open',{kind:'messages',chatId:bot.id});const menu=await context(page.locator('.group-message').first(),'Message options',bot.name.replaceAll(' ','-'));await page.keyboard.press('Escape');await expect(menu).toHaveCount(0)}
 checks.push('Dot, Grok private bots and Grok rooms use the same cursor-anchored menu without top-right controls')
 for(const plugin of ['telegram','x','youtube']){
  const source=await rpc('channel.source-add',{plugin,locator:plugin==='telegram'?'context_news':'@context_news',name:plugin+' original author'}),post=await rpc('channel.publish',{sourceId:source.id,externalId:'context',publishedAt:Date.now()-60000,title:'A complete article',body:body.repeat(4)+'\n\nEND '+plugin,url:'https://example.invalid/original'})
  await rpc('view.open',{kind:'messages',channelId:source.channelId});const pane=page.locator('.channel-conversation')
  for(const [view,selector]of [['Channel view','.channel-news-card'],['Board view','.channel-post-card'],['Posts view','.channel-news-card']]){
   await pane.getByRole('button',{name:view,exact:true}).click();const menu=await context(pane.locator(selector).first(),'Article actions');await menu.getByRole('menuitem',{name:'Copy text',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.copiedText)).toBe('A complete article\n\n'+body.repeat(4)+'\n\nEND '+plugin);await expect(pane.locator('.channel-news-card>footer')).toHaveCount(0)
  }
  let articleMenu=await context(pane.locator('.channel-news-card').first(),'Article actions');await articleMenu.getByRole('menuitem',{name:'Save article',exact:true}).click();await expect.poll(async()=>(await rpc('channel.post',{id:post.id})).saved).toBe(true);articleMenu=await context(pane.locator('.channel-news-card').first(),'Article actions');await articleMenu.getByRole('menuitem',{name:'Remove from saved',exact:true}).click();await expect.poll(async()=>(await rpc('channel.post',{id:post.id})).saved).toBe(false)
  checks.push(plugin+': Channel, Board and Posts share complete-article context actions, with no message toolbar or footer action strip')
 }
 await rpc('view.open',{kind:'messages',chatId:group.id});await page.setViewportSize({width:720,height:900});const menu=await context(page.locator('[data-chat-item="'+groupPost.data.id+'"]'),'Message options','narrow-menu',true);await page.keyboard.press('Escape');await expect(menu).toHaveCount(0)
 assert.deepEqual(errors,[]);if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:process.env.AGENTS_COMPANY_TEST_APP||'source',mode:web?'web':'desktop',checks,errors,productionDataUsed:false,modelCalls:0,clipboard:'isolated in-memory browser adapter'},null,2));for(const check of checks)console.log('PASS '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,errors},null,2));throw error}
finally{await app?.close();await browser?.close();await fixture?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve))}
