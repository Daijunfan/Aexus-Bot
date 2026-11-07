// Hidden actual Electron: explicit private Messages ledger versus the full Company context. No product model calls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import sharp from 'sharp'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/explicit-private-messages/ui')),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});const write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n')}
let f,app
try{
 f=await fixtureCore()
 const rpc=async(token,cmd,args={})=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,value.error);return value.data},transcript=async id=>(await rpc(null,'session.transcript',{id})).items,assistants=async id=>(await transcript(id)).filter(item=>item.role==='assistant').length,busy=async id=>{const card=(await rpc(null,'session.status',{employee:id}))[0];return card.busy||card.acknowledging}
 await f.cli('group','add','Studio');const a=await f.create('Aster','Studio'),b=await f.create('Rowan','Studio'),at=await f.token(a.id)
 const png=await sharp({create:{width:6,height:4,channels:3,background:'#2f6f8f'}}).png().toBuffer(),pdf=Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n')
 await rpc(at,'workspace.write',{employee:a.id,path:'media/photo.png',contentBase64:png.toString('base64'),create:true})
 await rpc(at,'workspace.write',{employee:a.id,path:'media/brief.pdf',content:pdf.toString('utf8'),create:true})
 // Native-only input/response and a group where A works while B only reads.
 const raw=await assistants(a.id)
 await f.cli('session','send','--employee',a.id,'--text','RAW_NATIVE_ONLY');await f.until(async()=>await assistants(a.id)>raw&&!(await busy(a.id)),'raw native turn')
 const group=await f.cli('chat','create','--name','Studio sync','--members',JSON.stringify([a.id,b.id])),grouped=await assistants(a.id)
 await rpc(null,'chat.send',{id:group.id,text:'GROUP_ONLY_BODY',mentions:[a.id],clientMessageId:'group-explicit-private'})
 await f.until(async()=>{const message=(await rpc(null,'chat.history',{id:group.id})).messages.find(item=>item.text==='GROUP_ONLY_BODY');return message.deliveries.every(delivery=>delivery.status==='completed')&&await assistants(a.id)>grouped&&!(await busy(a.id))&&!(await busy(b.id))},'group work and silent read')
 const aSeed=await transcript(a.id),bSeed=await transcript(b.id)
 assert.ok(aSeed.some(item=>item.role==='user'&&item.context?.origin.kind==='group'&&item.context.phase==='work'))
 assert.ok(bSeed.some(item=>item.role==='user'&&item.context?.origin.kind==='group'&&item.context.phase==='read'))
 assert.equal((await rpc(null,'direct.history',{employee:a.id,limit:500})).items.length,0);assert.equal((await rpc(null,'direct.history',{employee:b.id,limit:500})).items.length,0)
 // Explicit operator input, then three independent own-identity agent posts.
 const direct=await assistants(a.id),userSend=await rpc(null,'direct.send',{employee:a.id,text:'USER_PRIVATE_INPUT',clientMessageId:'user-private-ui-1'})
 assert.equal(userSend.sent,true);await f.until(async()=>await assistants(a.id)>direct&&!(await busy(a.id)),'private input native turn')
 const p1=await rpc(at,'direct.post',{text:'AGENT_TEXT_1',clientMessageId:'agent-text-ui-1'}),p2=await rpc(at,'direct.post',{images:['media/photo.png'],clientMessageId:'agent-image-ui-1'}),p3=await rpc(at,'direct.post',{files:['media/brief.pdf'],clientMessageId:'agent-file-ui-1'})
 let history=(await rpc(null,'direct.history',{employee:a.id,limit:500})).items
 assert.deepEqual(history.map(item=>item.id),[userSend.directMessageId,p1.id,p2.id,p3.id]);assert.equal(history[3].files[0].name,'brief.pdf')
 assert.ok(history.every(item=>!['RAW_NATIVE_ONLY','GROUP_ONLY_BODY','VISIBLE_REPLY'].some(text=>item.text?.includes(text)||item.blocks?.some(block=>block.text?.includes(text)))))
 checks.push('Core seed: native output and group work/silent reads stayed out of both private histories; direct.send plus three own-identity posts made four ordered rows')
 await f.stop()
 const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env})
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'})
 await page.locator('.infinite-canvas').waitFor();const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),theme=async value=>call('settings.set',{language:'en',viewAppearance:{company:{theme:value},messages:{theme:value}}})
 await theme('white');await call('view.open',{kind:'messages',employee:a.id})
 const messages=page.locator('.message-conversation'),composer=page.locator('.composer textarea');await messages.waitFor();await expect(composer).toBeEnabled()
 await expect(page.locator('.message-contact[data-employee="'+b.id+'"]')).not.toHaveAttribute('data-unread','true');await expect(page.locator('.message-contact[data-employee="'+b.id+'"] time')).toHaveText('');await expect(page.locator('.company-navigation .nav-unread')).toHaveText('1')
 checks.push('Native-only work and silent group reads create no private unread badges or timestamps; navigation counts the explicit private ledger')
 const photo=page.locator('.transcript .message-single-photo');await photo.scrollIntoViewIfNeeded();await expect(photo.locator('img')).toBeVisible();await expect(page.locator('.transcript .message-file strong')).toHaveText('brief.pdf')
 let text=await page.locator('.transcript').innerText();for(const value of ['USER_PRIVATE_INPUT','AGENT_TEXT_1'])assert.ok(text.includes(value))
 for(const value of ['RAW_NATIVE_ONLY','GROUP_ONLY_BODY','VISIBLE_REPLY'])assert.ok(!text.includes(value))
 assert.equal(await page.locator('.transcript .turn.user, .transcript .turn.assistant').count(),history.length)
 assert.equal(await page.locator('.transcript .tool, .transcript .thinking, .transcript .native-input-context').count(),0)
 checks.push('Messages showed only explicit user input and agent posts; photo and PDF rows loaded; native/group bodies, tools, thinking and wrapper context were absent')
 const live=await rpc(at,'direct.post',{text:'AGENT_LIVE_POST',clientMessageId:'agent-live-ui-1'});await expect(page.locator('.transcript')).toContainText('AGENT_LIVE_POST');await expect(page.locator('.message-contact[data-employee="'+a.id+'"] .message-snippet')).toContainText('AGENT_LIVE_POST')
 const uiBefore=await assistants(a.id);await composer.fill('UI_SENT_PRIVATE');await page.getByRole('button',{name:'Send message',exact:true}).click()
 await expect(page.locator('.transcript')).toContainText('UI_SENT_PRIVATE');await f.until(async()=>await assistants(a.id)>uiBefore&&!(await busy(a.id)),'UI private input native response')
 text=await page.locator('.transcript').innerText();assert.ok(!text.includes('VISIBLE_REPLY'));assert.equal(await page.locator('.transcript .native-input-context').count(),0)
 history=(await rpc(null,'direct.history',{employee:a.id,limit:500})).items;assert.ok(history.some(item=>item.text==='UI_SENT_PRIVATE'));assert.ok(history.some(item=>item.id===live.id))
 checks.push('f.request stayed live against the app socket: an agent post appeared while open; the real textarea/button sent explicit private input and its fake engine reply stayed in Company')
 await page.screenshot({path:path.join(out,'messages-light.png'),animations:'disabled'});await theme('black');await page.screenshot({path:path.join(out,'messages-dark.png'),animations:'disabled'})
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,900));await page.waitForTimeout(300)
 const narrow=selector=>page.locator(selector).evaluate(el=>{const box=el.getBoundingClientRect();return {width:innerWidth,page:document.documentElement.scrollWidth,left:box.left,right:box.right,composerRight:el.querySelector('.composer')?.getBoundingClientRect().right??null}})
 const messagesNarrow=await narrow('.message-conversation');assert.ok(messagesNarrow.page<=messagesNarrow.width+1);assert.ok(messagesNarrow.right<=messagesNarrow.width+1)
 await page.screenshot({path:path.join(out,'messages-narrow-720.png'),animations:'disabled'});await theme('white');await page.screenshot({path:path.join(out,'messages-narrow-light-720.png'),animations:'disabled'})
 await call('view.open',{kind:'conversation',employee:a.id})
 const dialog=page.locator('.conversation-layer .conversation-dialog');await dialog.waitFor()
 await expect(dialog.locator('.turn.assistant',{hasText:'VISIBLE_REPLY'}).first()).toBeVisible();const companyText=await dialog.innerText()
 for(const value of ['GROUP_ONLY_BODY','USER_PRIVATE_INPUT','UI_SENT_PRIVATE','VISIBLE_REPLY'])assert.ok(companyText.includes(value))
 assert.ok(await dialog.locator('.native-input-context').count()>0);assert.ok(await dialog.locator('.native-input-context-source',{hasText:'[Studio sync]'}).count()>0)
 assert.ok(await dialog.locator('.native-input-context-source',{hasText:'[Private · User]'}).count()>0);assert.ok(await dialog.locator('.native-input-context[data-phase="read"]').count()>0)
 const item=(await transcript(a.id)).find(entry=>entry.role==='user'&&entry.text==='UI_SENT_PRIVATE'&&entry.context?.origin.kind==='direct');assert.ok(item)
 const privateContext=dialog.locator('.turn.user',{hasText:'UI_SENT_PRIVATE'}).locator('.native-input-context');await privateContext.locator('summary').click()
 assert.equal(await privateContext.locator('pre.native-input-context-code').first().textContent(),item.context.prompt);assert.equal(await privateContext.locator('.native-input-context-source').innerText(),'from [Private · User]')
 checks.push('Company showed original group/private inputs plus native output; the expanded wrapper prompt matched context.prompt exactly, and [Studio sync], direct and phase=read provenance appeared only here')
 const companyNarrow=await narrow('.conversation-layer .conversation-dialog');assert.ok(companyNarrow.page<=companyNarrow.width+1);await page.screenshot({path:path.join(out,'company-narrow-light-720.png'),animations:'disabled'})
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await page.waitForTimeout(300)
 await page.screenshot({path:path.join(out,'company-light.png'),animations:'disabled'});await theme('black');await page.screenshot({path:path.join(out,'company-dark.png'),animations:'disabled'});await theme('white')
 await call('view.open',{kind:'messages',employee:a.id});await expect(page.locator('.message-conversation')).toBeVisible();assert.equal(await page.locator('.native-input-context').count(),0)
 assert.deepEqual(errors,[]);const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({visible:window.isVisible(),focused:window.isFocused()})))
 assert.ok(hidden.every(window=>window.visible===false&&window.focused===false),'windows stay hidden and unfocused');checks.push('Light/dark and 720px geometry passed in both views; the full context never entered Messages; every window stayed hidden and unfocused')
 write('result.json',{passed:true,application:application||'source',checks,privateRows:history.map(item=>({role:item.role,text:item.text??'',images:item.images?.length??0,files:item.files?.map(file=>file.name)??[]})),contexts:{groupSource:'[Studio sync]',directSource:'[Private · User]',phaseRead:true,promptMatch:true},geometry:{messages:messagesNarrow,company:companyNarrow},errors,modelCalls:0,productionDataUsed:false})
 checks.forEach(check=>console.log('PASS '+check))
}catch(error){if(app)await (await app.firstWindow().catch(()=>null))?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{try{await app?.close()}finally{await f?.close()}}
