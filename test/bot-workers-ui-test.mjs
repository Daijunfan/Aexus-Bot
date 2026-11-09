import {desktopExecutable} from './fixtures/desktop-app.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bot-workers-ui-')),control=path.join(temp,'fixture'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/bot-workers/ui'),bots=[{id:'dot',name:'Dot',provider:'dots',kind:'private'},{id:'grok',name:'Grok Bot',provider:'grok',kind:'private'}],history=new Map(bots.map(b=>[b.id,[]])),calls=[],checks=[],errors=[]
for(const d of [control,out])fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(control,'release-all'),'')
const documentBytes=Buffer.from('BOT_UI_DOWNLOAD_BYTES\n')
const issues=new Map()
const server=http.createServer(async(req,res)=>{let data='';for await(const c of req)data+=c;try{const q=JSON.parse(data),a=q.args;calls.push(q);let value
 if(q.method==='list')value=bots.filter(b=>b.provider===a.provider)
 else if(q.method==='status')value={issue:issues.get(a.binding.remoteId)??null,checkedAt:Date.now()}
 else if(q.method==='messages')value=history.get(a.binding.remoteId)??[]
 else if(q.method==='create'){value={id:a.id,name:a.name,provider:'grok',kind:a.members?'group':'private',participantIds:a.members};bots.push(value);history.set(value.id,[])}
 else if(q.method==='send'){value={id:a.requestId,accepted:true};history.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:Date.now(),files:[]})}
 else if(q.method==='read'){value={data:documentBytes.subarray(a.offset,a.offset+a.length).toString('base64'),totalSize:documentBytes.length,mimeType:'text/plain'}}
 else throw Error('Unexpected UI provider method '+q.method)
 res.setHeader('content-type','application/json');res.end(JSON.stringify(value))
 }catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}))}});await new Promise(r=>server.listen(0,'127.0.0.1',r))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+server.address().port,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000',CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:control};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP)||require('electron'),args:process.env.AGENTS_COMPANY_TEST_APP?[]:[root],env}),page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
const rpc=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(e){throw Error(e?.message??e?.error??JSON.stringify(e))}},{cmd,args}),pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 await page.locator('.company-navigation').waitFor();await rpc('settings.set',{language:'en'});await rpc('group.add',{name:'Studio'})
 const employee=await rpc('card.create',{title:'Aster',group:'Studio',engine:'codex',model:'gpt-6-luna'}),secretary=await rpc('card.create',{title:'Secretary',group:'Studio',engine:'codex',model:'gpt-6-luna',managementRole:'secretary'})
 await expect.poll(async()=>(await rpc('session.status')).every(s=>s.initialization?.status==='ready')).toBe(true)
 await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.getByRole('button',{name:'Bots',exact:true}).first().click()
 const dialog=page.locator('.bot-workers-dialog');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:/Connect|Refresh/}).first().click();await expect(dialog).toContainText('Dot');await expect(dialog).toContainText('Grok Bot')
 let list=await rpc('bot.list'),dot=list.find(b=>b.bot.provider==='dots'),grok=list.find(b=>b.bot.provider==='grok')
 await dialog.getByRole('button',{name:'New Grok bot',exact:true}).click();await dialog.locator('input').first().fill('Research Worker');await dialog.getByRole('button',{name:'Create bot',exact:true}).click();await expect(dialog).toHaveCount(0)
 list=await rpc('bot.list');const created=list.find(b=>b.name==='Research Worker');assert.ok(created);await expect(page.locator('.group-conversation')).toContainText('Research Worker')
 assert.equal(calls.filter(c=>c.method==='create').length,1)
 const toolbar=page.locator('.group-conversation .message-thread-actions');for(const [label,icon] of [['Shared workspace','folder-opened'],['Search conversation','search'],['Group shared content','library'],['Authorized people','organization']]){const button=toolbar.getByRole('button',{name:label,exact:true});await expect(button.locator('.codicon-'+icon+' svg')).toBeVisible();await expect(button).toHaveAttribute('title',/.+/)}
 await toolbar.getByRole('button',{name:'Group shared content',exact:true}).click();await expect(page.getByRole('dialog',{name:'Conversation content',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close message library',exact:true}).click();pass('Folder, search, content library and employee access use distinct round-stroke icons with meaningful tooltips and the correct content action')

 // The dedicated access sheet grants employees; Secretary is automatically authorized.
 await page.getByRole('button',{name:'Authorized people',exact:true}).click();const access=page.locator('.bot-access-dialog');await expect(access).toBeVisible();await expect(access).toContainText('Secretary');await expect(access.locator('input[type=checkbox]')).toHaveCount(1)
 await access.locator('input[type=checkbox]').check();await access.getByRole('button',{name:/Save/}).click();await expect(access).toContainText('Access saved');await access.getByRole('button',{name:'Close',exact:true}).click();await expect(access).toHaveCount(0);assert.deepEqual((await rpc('bot.access',{id:created.id})).employeeIds,[employee.id])
 await page.locator('.message-back').click();await page.getByRole('button',{name:'Bots',exact:true}).first().click();await dialog.getByRole('button',{name:'New Grok group',exact:true}).click();await dialog.locator('input:not([type=checkbox])').first().fill('Research Room');await dialog.locator('input[type=checkbox]').first().check()
 await expect(dialog.getByRole('heading',{name:'New Grok group',exact:true})).toBeVisible()
 const choices=await dialog.locator('.bot-check').evaluateAll(rows=>rows.map(row=>{const label=row.lastElementChild;return {checkbox:row.querySelector('input').getBoundingClientRect().width,avatar:row.querySelector('.bot-avatar').getBoundingClientRect().width,labelClipped:label.scrollWidth>label.clientWidth+1,overflow:row.scrollWidth>row.clientWidth}}))
 assert.ok(choices.length>0&&choices.every(row=>row.checkbox<=20&&row.avatar>=24&&!row.labelClipped&&!row.overflow),'Grok group choices keep a compact checkbox, visible native avatar and readable name: '+JSON.stringify(choices))
 await dialog.getByRole('button',{name:'Create Grok group',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.group-conversation')).toContainText('Research Room')
 pass('Real hidden Message UI connects providers, creates native bot/group through Core, grants one employee and keeps Secretary automatic')
 await page.locator(`.message-contact[data-chat="${dot.id}"]`).click()
 await expect(page.locator('.group-conversation')).toContainText('Dot')
 await rpc('conversation.file',{conversation:'group:'+dot.id,operation:'write',path:'worker-notes.txt',content:'Shared Worker notes\n',create:true})
 await page.getByRole('button',{name:'Shared workspace',exact:true}).click()
 const shared=page.getByRole('dialog',{name:'Shared workspace',exact:true})
 await expect(shared).toBeVisible();await expect(shared).toContainText('worker-notes.txt')
 await shared.getByRole('button',{name:'Close shared workspace',exact:true}).click();await expect(shared).toHaveCount(0)
 await expect(page.locator('.group-title strong')).toHaveText('Dot')
 pass('External Worker shared files open through the actual header button, display the authenticated conversation workspace and return to the same conversation')
 await expect(page.locator('.bot-header-avatar .dot-native-avatar[data-native-character="codey"]')).toBeVisible()
 await page.getByRole('button',{name:'Dot native appearance',exact:true}).click();const appearance=page.locator('.dot-native-preview');await expect(appearance).toBeVisible();await expect(appearance.locator('.dot-native-avatar[data-native-character="codey"]')).toBeVisible();assert.equal((await rpc('bot.appearance',{id:dot.id})).editable,false);await page.screenshot({path:path.join(out,'dot-native-preview.png')});await appearance.getByRole('button',{name:'Close',exact:true}).click()
 assert.ok(await page.locator('.grok-native-avatar svg').count()>0)
 const framing=await page.locator('.message-contact[data-chat="'+grok.id+'"] .bot-avatar').evaluate(el=>{const parent=el.parentElement.getBoundingClientRect(),child=el.getBoundingClientRect(),svg=el.querySelector('svg').getBoundingClientRect();return {ratio:child.width/parent.width,svg:svg.width/child.width,padding:getComputedStyle(el.parentElement).padding}});assert.ok(framing.ratio>.98&&framing.svg>.98);assert.equal(framing.padding,'0px')
 pass('Dot keeps its fixed native OpenAI animation and opens its native preview; the Grok SVG fills its avatar without a padded tile')
 const composer=page.locator('.group-compose-box textarea');await composer.fill('Please continue this task.');await composer.press('Enter');await expect(page.locator('.bot-waiting')).toBeVisible()
 history.get('dot').push({id:'dot-reply',revision:'v1',cursor:'1',role:'assistant',text:'The result is ready.\n\n- Sources checked\n- Follow-up work prepared\n\nA later reply can still arrive.',createdAt:Date.now(),files:[]});await rpc('bot.sync');await expect(page.locator('.bot-waiting')).toHaveCount(0);await expect(page.locator('.group-message-row.is-incoming')).toContainText('The result is ready.')
 await expect(page.getByRole('button',{name:'Mention a member'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit group'})).toHaveCount(0)
 pass('Bot UI uses native icons, explicit text send, smooth waiting dots, late reply rendering and no employee mention/governance controls')
 for(const width of [1440,760])for(const language of ['en','zh-CN'])for(const theme of ['white','black']){
  await rpc('settings.set',{language,viewAppearance:{messages:{theme},company:{theme},plan:{theme}}});await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setBounds({width,height:960}),width)
  await expect.poll(()=>page.locator('html').getAttribute('lang')).toBe(language);await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
  const bounds=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,header:[...document.querySelectorAll('.message-thread-header button')].map(e=>{const b=e.getBoundingClientRect();return {x:b.x,right:b.right,top:b.top,width:b.width}}),icons:[...document.querySelectorAll('.bot-avatar img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.clientWidth}))}))
  assert.ok(bounds.document<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.icons.every(i=>i.loaded));assert.ok(bounds.header.every(b=>b.right<=bounds.width+1&&b.x>=-1))
  await page.screenshot({path:path.join(out,`thread-${width}-${language}-${theme}.png`)})
 }
 await rpc('settings.set',{language:'en'});await expect(page.locator('html')).toHaveAttribute('lang','en')
 history.get('dot').push({id:'dot-file',revision:'f1',cursor:'2',role:'assistant',text:'',createdAt:Date.now(),files:[{id:'document',remotePath:'document',name:'worker-result.txt',bytes:documentBytes.length,mimeType:'text/plain'}]});await rpc('bot.sync')
 const destination=path.join(temp,'worker-result-saved.txt');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},destination)
 await page.getByRole('button',{name:'Download worker-result.txt',exact:true}).click();await expect.poll(()=>fs.existsSync(destination)).toBe(true);assert.deepEqual(fs.readFileSync(destination),documentBytes)
 pass('The actual external Worker file Download button saves exact bytes to the selected Mac path through the ordinary authenticated transfer API')
 const quota={code:'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT',message:'Your Grok Bot usage limit has been reached',at:Date.now(),retryAt:Date.now()+86400000}
 issues.set(grok.bot.remoteId,quota);await rpc('bot.sync');if(!await page.locator(`.message-contact[data-chat="${grok.id}"]`).isVisible())await page.locator(".message-back").click();await page.locator(`.message-contact[data-chat="${grok.id}"]`).click()
 const quotaNotice=page.locator('.group-conversation>.bot-issue-notice');await expect(quotaNotice).toContainText('Grok usage limit reached');await expect(quotaNotice.locator('time')).toHaveAttribute('datetime',new Date(quota.retryAt).toISOString());await expect(page.locator('.bot-waiting')).toHaveCount(0)
 const sendsBefore=calls.filter(c=>c.method==='send').length,draft='Keep my message while Grok has no usage.'
 await page.locator('.group-compose-box textarea').fill(draft);await page.locator('.group-compose-box textarea').press('Enter');await expect(page.locator('.group-error[role=alert]')).toContainText('usage limit');await expect(page.locator('.group-compose-box textarea')).toHaveValue(draft);assert.equal(calls.filter(c=>c.method==='send').length,sendsBefore)
 await page.reload();await page.locator('.company-navigation').waitFor();await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();if(!await page.locator(`.message-contact[data-chat="${grok.id}"]`).isVisible())await page.locator(".message-back").click();await page.locator(`.message-contact[data-chat="${grok.id}"]`).click();await expect(quotaNotice).toBeVisible();await expect(page.locator('.group-compose-box textarea')).toHaveValue(draft)
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('shell:openExternal');ipcMain.handle('shell:openExternal',(_event,url)=>{globalThis.__openedUsage=url})});await quotaNotice.getByRole('button',{name:'View account usage',exact:true}).click();await expect.poll(()=>app.evaluate(()=>globalThis.__openedUsage)).toBe('https://cursor.com/dashboard/spending')
 for(const [width,theme] of [[1440,'violet'],[760,'black']]){await rpc('settings.set',{language:'zh-CN',viewAppearance:{messages:{theme}}});await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setBounds({width,height:960}),width);await expect(quotaNotice).toContainText('Grok 本期额度已用尽');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,`grok-quota-${width}-${theme}.png`)})}
 issues.delete(grok.bot.remoteId);await rpc('bot.sync');await expect(quotaNotice).toHaveCount(0)
 await page.locator('.group-compose-box textarea').press('Enter');await expect(page.locator('.group-compose-box textarea')).toHaveValue('');assert.equal(calls.filter(c=>c.method==='send').length,sendsBefore+1)
 pass('Native quota failure shows the reset time, stops indefinite waiting, preserves the draft across reload, opens usage only on an explicit click, and clears after recovery')
 await rpc('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'}}});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1440,height:1000}));await page.getByRole('button',{name:'Authorized people',exact:true}).click();await page.screenshot({path:path.join(out,'access.png')})
 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 pass('Wide/narrow, English/Chinese and light/dark layouts have loaded icons, no page overflow or offscreen header actions; screenshots saved for visual inspection')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,productionDataUsed:false},null,2))
}catch(e){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e),checks,errors},null,2));throw e}
finally{await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
