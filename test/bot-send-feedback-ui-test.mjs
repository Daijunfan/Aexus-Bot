// Real Core and actual composer actions; only native bot transport and response timing are fixtures.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),native=process.argv.includes('--desktop'),baseline=process.argv.includes('--baseline'),mode=native?'desktop':'web'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||`artifacts/bot-send-feedback/${baseline?'baseline':mode}`),checks=[],errors=[],calls=[],gates=[]
fs.mkdirSync(out,{recursive:true})
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const history=new Map([['dot',[{id:'welcome',revision:'1',cursor:'welcome',role:'assistant',text:'Ready for your next message.',createdAt:Date.now(),files:[]}]],['grok',[]]])
let remoteGate,uncertain=false
const source=http.createServer(async(req,res)=>{try{
 let text='';for await(const chunk of req)text+=chunk;const q=JSON.parse(text),a=q.args;calls.push(q);let result
 if(q.method==='list')result=[{id:'dot',name:'Dot',provider:'dots',kind:'private'},{id:'grok',name:'Grok Bot',provider:'grok',kind:'private'}].filter(bot=>bot.provider===a.provider)
 else if(q.method==='status')result={issue:null,checkedAt:Date.now()}
 else if(q.method==='messages')result=history.get(a.binding.remoteId)
 else if(q.method==='send'){
  if(remoteGate){const gate=remoteGate;remoteGate=undefined;gate.entered.resolve();await gate.release.promise}
  if(uncertain){uncertain=false;throw Error('Bot transport disconnected before confirmation (fixture).')}
  history.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:Date.now(),files:[]});result={id:a.requestId,accepted:true}
 }else throw Error('Unexpected bot fixture method '+q.method)
 res.setHeader('content-type','application/json');res.end(JSON.stringify(result))
}catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}})
await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve))
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,browser,app,page
const report={passed:false,baseline,mode,checks,errors,productionDataUsed:false,paidModelCalls:0}
try{
 f=await fixtureCore({AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+source.address().port,...(!native?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
 await rpc('settings.set',{language:'en',viewAppearance:{messages:{theme:'violet'}}});await rpc('bot.sync');const dot=(await rpc('bot.list')).find(bot=>bot.bot.provider==='dots'),conversation='group:'+dot.id
 if(native){
  await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1280',AGENTS_COMPANY_HEIGHT:'940'};delete env.ELECTRON_RUN_AS_NODE
  app=await electron.launch({executablePath:desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP)||require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env});page=await app.firstWindow()
  assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
  await app.evaluate(({ipcMain})=>{
   const original=ipcMain._invokeHandlers.get('api:request');if(typeof original!=='function')throw Error('Real API handler unavailable')
   globalThis.botSendGates=[];ipcMain.removeHandler('api:request');ipcMain.handle('api:request',async(event,request)=>{
    const gate=globalThis.botSendGates.find(gate=>!gate.entered&&gate.command===request.cmd&&(gate.text===undefined?request.args?.text===''&&!!request.args?.expectedClientMessageId:request.args?.text===gate.text))
    const wait=async()=>{gate.entered=true;await new Promise(resolve=>gate.release=resolve)}
    if(gate&&!gate.after)await wait();const response=await original(event,request);if(gate&&gate.after)await wait();return response
   })
  })
 }else{
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1280,height:940},reducedMotion:'no-preference'})
  await page.route('**/api/rpc',async route=>{
   const request=route.request().postDataJSON(),gate=gates.find(gate=>!gate.entered&&gate.command===request.cmd&&(gate.text===undefined?request.args?.text===''&&!!request.args?.expectedClientMessageId:request.args?.text===gate.text))
   if(!gate){await route.continue();return}gate.entered=true
   if(!gate.after){gate.ready.resolve();await gate.release.promise}const response=await route.fetch();if(gate.after){gate.ready.resolve();await gate.release.promise}await route.fulfill({response})
  })
  await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
 }
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.company-navigation').waitFor()
 const hold=async(command,text,after=true)=>{const id=gates.length,gate={command,text,after,ready:deferred(),release:deferred(),entered:false};gates.push(gate);if(native)await app.evaluate((_,value)=>globalThis.botSendGates.push(value),{id,command,text,after});return {entered:()=>native?expect.poll(()=>app.evaluate((_,id)=>globalThis.botSendGates.find(gate=>gate.id===id)?.entered,id)).toBe(true):gate.ready.promise,release:()=>native?app.evaluate((_,id)=>globalThis.botSendGates.find(gate=>gate.id===id).release(),id):gate.release.resolve()}}
 const open=async()=>{await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.locator(`.message-contact[data-chat="${dot.id}"]`).click()}
 const input=page.locator('.group-compose-box textarea'),stored=async()=>(await rpc('messenger.state')).drafts[conversation],send=async text=>{await expect(input).toBeEnabled();await input.fill(text);await input.press('Enter')}
 const accepted=async text=>{await expect.poll(async()=>(await rpc('chat.history',{id:dot.id})).messages.find(message=>message.text===text)?.bot?.delivery).toBe('accepted')}
 await open();await expect(page.locator('.group-message-row.is-incoming')).toContainText('Ready for your next message.')
 const clear=await hold('messenger.draft');await send('First accepted message');await clear.entered();await accepted('First accepted message')
 report.beforeClearResponse={text:await input.inputValue(),disabled:await input.isDisabled(),avatar:await page.locator('.bot-message-avatar').first().evaluate(element=>({background:getComputedStyle(element).backgroundColor,border:getComputedStyle(element).borderWidth,shadow:getComputedStyle(element).boxShadow}))}
 if(baseline){await page.screenshot({path:path.join(out,'before.png')});await clear.release();report.passed=true;console.log('BASELINE '+JSON.stringify(report.beforeClearResponse))}
 else{
  await expect(input).toHaveValue('');await expect(input).toBeEnabled();await expect(input).toBeFocused();await page.keyboard.type('New draft while old clear is pending');await clear.release();await expect.poll(async()=>(await stored())?.text).toBe('New draft while old clear is pending')
  await page.reload();await page.locator('.company-navigation').waitFor();await open();await expect(input).toHaveValue('New draft while old clear is pending');checks.push('Accepted message clears immediately while draft storage response is delayed; new typing survives completion and reload')
  const slow=await hold('chat.send','Accepted with delayed response');await send('Accepted with delayed response');await slow.entered();await accepted('Accepted with delayed response');await expect(input).toHaveValue('');await expect(input).toBeEnabled()
  const waiting={entered:deferred(),release:deferred()};remoteGate=waiting;await send('Second send still awaiting acceptance');await waiting.entered.promise;await expect(input).toHaveValue('Second send still awaiting acceptance');await expect(input).toBeDisabled();await slow.release();await expect(input).toBeDisabled();await expect(input).toHaveValue('Second send still awaiting acceptance');waiting.release.resolve();await expect(input).toHaveValue('');await expect(input).toBeEnabled();checks.push('Committed accepted history releases composer before RPC response; a late first response cannot clear or unlock the next unaccepted send')
  const peerClear=await hold('messenger.draft',undefined,false);await send('Accepted before another client draft');await peerClear.entered();await expect(input).toHaveValue('');await rpc('messenger.draft',{conversation,text:'Draft from another client',mentions:[],clientMessageId:'peer-client-draft'});await peerClear.release();await expect(input).toHaveValue('Draft from another client');checks.push('A conditional clear cannot delete a newer peer draft, which remains visible after storage completes')
  uncertain=true;await send('Uncertain delivery keeps the draft');await expect(input).toBeEnabled();await expect(input).toHaveValue('Uncertain delivery keeps the draft');await expect(page.locator('.bot-delivery-uncertain')).toBeVisible();const count=calls.filter(call=>call.method==='send').length;await input.press('Enter');await expect(page.locator('.group-error[role=alert]')).toContainText('Delivery unconfirmed');await expect(input).toHaveValue('Uncertain delivery keeps the draft');assert.equal(calls.filter(call=>call.method==='send').length,count)
  const late=calls.filter(call=>call.method==='send').at(-1).args;await input.fill('Keep my newer unsent draft');history.get('dot').push({id:late.requestId,requestId:late.requestId,cursor:late.requestId,revision:late.requestId,role:'user',text:late.text,createdAt:Date.now(),files:[]});await rpc('bot.sync');await accepted(late.text);await expect(input).toHaveValue('Keep my newer unsent draft');await expect(page.locator('.group-error[role=alert]')).toHaveCount(0);checks.push('Unconfirmed transport retains draft and stable identity without replay; late acceptance preserves newer edits and clears the stale failure notice')
  const avatar=page.locator('.bot-message-avatar').first();await expect(avatar).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(avatar).toHaveCSS('box-shadow','none');await expect(avatar).toHaveCSS('border-width','0px')
  const working=page.locator('.bot-waiting .bot-message-avatar');await expect(working).toBeVisible();await expect(working).toHaveCSS('background-color','rgba(0, 0, 0, 0)');const frame=await working.locator('.dot-native-avatar').getAttribute('data-native-frame');await expect.poll(()=>working.locator('.dot-native-avatar').getAttribute('data-native-frame')).not.toBe(frame);checks.push('Dot incoming and working avatars have transparent frameless wrappers and retain original Codey animation')
  for(const theme of ['violet','black']){await rpc('settings.set',{viewAppearance:{messages:{theme}}});await page.screenshot({path:path.join(out,theme+'-dot.png')})}
  if(!native)await page.setViewportSize({width:720,height:850});else await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:720,height:850}));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'narrow.png')})
  await rpc('group.add',{name:'Feedback fixture'});const member=await f.create('Feedback member','Feedback fixture'),group=await rpc('chat.create',{name:'Ordinary group',members:[member.id]})
  const contact=page.locator(`.message-contact[data-chat="${group.id}"]`);if(!await contact.isVisible())await page.locator('.message-back').click();await contact.click()
  const groupClear=await hold('messenger.draft');await send('Ordinary group acceptance');await groupClear.entered();await expect(input).toHaveValue('');await expect(input).toBeEnabled();await expect(input).toBeFocused();await page.keyboard.type('Next ordinary group draft');await groupClear.release();await expect.poll(async()=>(await rpc('messenger.state')).drafts['group:'+group.id]?.text).toBe('Next ordinary group draft');assert.equal((await rpc('chat.history',{id:group.id})).messages.filter(message=>message.text==='Ordinary group acceptance').length,1);checks.push('Shared ordinary-group composer clears on acceptance, restores keyboard focus and preserves the next draft without duplicate publication')
  assert.deepEqual(errors,[]);assert.equal(calls.filter(call=>call.method==='send').length,5);report.passed=true;console.log('PASS '+mode+': '+checks.join('; '))
 }
}catch(error){report.error=error.message;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}
finally{
 for(const gate of gates)gate.release.resolve();remoteGate?.release.resolve();if(app)await app.evaluate(()=>{for(const gate of globalThis.botSendGates??[])gate.release?.()}).catch(()=>{});await browser?.close();await app?.close();await f?.close();source.closeAllConnections();await new Promise(resolve=>source.close(resolve));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n')
}
