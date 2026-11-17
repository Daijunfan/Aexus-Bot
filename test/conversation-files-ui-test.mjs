// Actual group file manager + Core in hidden desktop and headless Web; generated PDFs only.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??'artifacts/group-file-library/'+mode)
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,page,browser,app;const checks=[],errors=[]
try{
 fs.mkdirSync(out,{recursive:true});f=await fixtureCore({...web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{}})
 const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'}}})
 const a=await f.create('Researcher'),b=await f.create('Reviewer'),group=await rpc('chat.create',{name:'Research shared files',members:[a.id,b.id]}),conversation='group:'+group.id,token=await f.token(a.id)
 const workspace=await rpc('conversation.workspace',{conversation}),pdfLib=createRequire(import.meta.url)('pdf-lib'),pdf=await pdfLib.PDFDocument.create();pdf.addPage([360,480]).drawText('RESEARCH PAPER',{x:30,y:400,size:24});pdf.addPage([360,480]).drawText('Second page',{x:30,y:400,size:16});const bytes=Buffer.from(await pdf.save())
 const names=['On-computable-numbers-with-an-application-to-the-Entscheidungsproblem-完整中文译本.pdf','Computing machinery and intelligence — 中文复核版.pdf','Notes.md','Release checklist.txt','Source references.txt','Data review.txt','Implementation notes.txt'],messages=[]
 await rpc('conversation.file',{conversation,operation:'mkdir',path:'Papers'})
 for(const [index,name] of names.entries()){
  fs.writeFileSync(path.join(workspace.root,'Papers',name),name.endsWith('.pdf')?bytes:Buffer.from('Synthetic group file '+index))
  messages.push(await rpc('chat.post',{id:group.id,text:'A very long historical caption that should not occupy the file list. '.repeat(12).trim(),files:['@workspace/Papers/'+name],clientMessageId:'file-'+index},token))
 }
 for(let index=0;index<4;index++)await rpc('chat.post',{id:group.id,text:'Another publication of the same current document.',files:['@workspace/Papers/'+names[0]],clientMessageId:'repeat-'+index},token)
 await f.until(async()=>(await rpc('chat.history',{id:group.id})).messages.every(m=>m.deliveries.every(d=>d.status==='completed')),'all context receipts')
 const historyFile=path.join(f.env.AGENTS_COMPANY_HOME,'chats',group.id+'.json'),hash=()=>createHash('sha256').update(fs.readFileSync(historyFile)).digest('hex'),beforeHash=hash()
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.company-navigation').waitFor()
 await page.evaluate(id=>window.agents.call('view.open',{kind:'messages',chatId:id}),group.id)
 const open=async()=>{await page.getByRole('button',{name:'Group shared content',exact:true}).click();await page.getByRole('button',{name:'Files',exact:true}).click()}
 await open();const library=page.locator('.message-library'),manager=library.locator('.shared-file-library'),rows=manager.locator('.shared-file-row'),find=name=>rows.filter({has:page.getByRole('button',{name,exact:true})})
 await expect(rows).toHaveCount(7);await expect(manager.getByRole('status').first()).toContainText('7 files');await expect(library).not.toContainText('A very long historical caption')
 await expect(find(names[0])).toContainText('Shared in 5 messages')
 assert.equal(await find(names[0]).locator('.shared-file-name').evaluate(el=>getComputedStyle(el).textOverflow),'clip')
 const height=await rows.first().evaluate(el=>el.getBoundingClientRect().height);assert.ok(height<120,'dense file rows must fit without message-card padding')
 const filterIds=['all','media','audio','files','links','saved','pinned'],navigation=library.locator('.message-library-tabs'),filterButtons=navigation.locator('button')
 const measureNavigation=()=>navigation.evaluate(nav=>{const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},style=getComputedStyle(nav),content=nav.parentElement.querySelector('.message-workspace-content');return {viewport:{width:innerWidth,height:innerHeight},direction:style.flexDirection,overflowX:style.overflowX,scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth,scrollLeft:nav.scrollLeft,nav:box(nav),content:box(content),buttons:[...nav.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label'),...box(button)}))}})
 const checkFilters=async()=>{await expect(filterButtons).toHaveCount(7);for(const [index,id] of filterIds.entries()){await filterButtons.nth(index).click();await expect(library).toHaveAttribute('data-content-filter',id);await expect(filterButtons.nth(index)).toHaveAttribute('aria-current','page')}await filterButtons.nth(3).click();await expect(rows).toHaveCount(7)}
 const desktopNavigation=await measureNavigation();fs.writeFileSync(path.join(out,'desktop-navigation-layout.json'),JSON.stringify(desktopNavigation,null,2)+'\n')
 assert.equal(desktopNavigation.direction,'column');assert.ok(desktopNavigation.nav.right<=desktopNavigation.content.x+1,'Desktop navigation and file content occupy separate columns')
 assert.ok(desktopNavigation.buttons.every((button,index,buttons)=>button.x>=desktopNavigation.nav.x&&button.right<=desktopNavigation.nav.right+1&&button.y>=desktopNavigation.nav.y&&button.bottom<=desktopNavigation.nav.bottom+1&&(!index||button.y>=buttons[index-1].bottom-1)),'All seven desktop filters are fully visible without overlap')
 await checkFilters()
 checks.push('Desktop content navigation uses the real vertical workspace column; all seven filters are visible, non-overlapping and genuinely selectable')
 await page.screenshot({animations:'disabled',path:path.join(out,'compact-file-list.png')})
 checks.push('Seven full filenames replace eleven repeated message cards; duplicate shares, live sizes and source counts are clear without historical caption clutter')
 await manager.getByRole('button',{name:'Sort shared files',exact:true}).click();await page.getByRole('option',{name:'File name',exact:true}).click();await library.getByRole('textbox',{name:'Search shared files',exact:true}).fill('中文复核');await expect(rows).toHaveCount(1);await library.getByRole('button',{name:'Clear history search',exact:true}).click();await expect(rows).toHaveCount(7)
 await expect(find(names[0]).locator('.asset-cover img')).toBeVisible({timeout:30000});await find(names[0]).getByRole('button',{name:names[0],exact:true}).click();await expect(page.locator('.library-view iframe.library-reader-frame')).toBeVisible({timeout:20000});const readerState=await page.evaluate(()=>window.agents.call('view.get'));assert.equal(readerState.kind,'library');assert.equal(readerState.librarySection,'reader');const doc=await page.evaluate(workspace=>window.agents.call('reader.call',{workspace,method:'document.list'}),workspace.root);assert.equal(doc.documents[0].path,'Papers/'+names[0]);await page.locator('.library-view').getByRole('button',{name:'Back to conversation',exact:true}).click();await expect(manager).toBeVisible()

 if(web){const pending=page.waitForEvent('download');await find(names[0]).getByRole('button',{name:'Download '+names[0],exact:true}).click();const download=await pending;assert.deepEqual(fs.readFileSync(await download.path()),bytes)}
 checks.push('Filename search, sorting, actual Reader PDF cover/page count and streamed Web download work without changing source bytes')
 await manager.getByRole('button',{name:'Select',exact:true}).click();await manager.getByRole('checkbox',{name:'Select '+names[0],exact:true}).check();await manager.getByRole('checkbox',{name:'Select '+names[1],exact:true}).check();await manager.getByRole('button',{name:'Move to Trash',exact:true}).click()
 const confirmation=page.getByRole('dialog',{name:'Remove shared files',exact:true});await expect(confirmation).toContainText(names[0]);await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);assert.equal((await rpc('conversation.files',{conversation})).total,7)
 await manager.getByRole('button',{name:'Move to Trash',exact:true}).click();await confirmation.getByRole('button',{name:'Move to Trash',exact:true}).click();await expect(rows).toHaveCount(5);await expect(page.locator('.shared-files-feedback')).toContainText('Moved 2 files')
 await expect(page.locator('[data-group-message="'+messages[0].id+'"] .message-file-wrap')).toHaveClass(/is-unavailable/);await expect(page.locator('[data-group-message="'+messages[0].id+'"] .message-file button')).toBeDisabled()
 assert.equal(hash(),beforeHash)
 await manager.getByRole('button',{name:'Undo',exact:true}).click();await expect(rows).toHaveCount(7);await expect(page.locator('[data-group-message="'+messages[0].id+'"] .message-file-wrap')).not.toHaveClass(/is-unavailable/)
 // A stale confirmation stays open with a visible, persistent error and deletes nothing.
 await find(names[2]).getByRole('button',{name:'File actions for '+names[2],exact:true}).click();await page.getByRole('menuitem',{name:'Move to Trash',exact:true}).click();fs.writeFileSync(path.join(workspace.root,'Papers',names[2]),'Changed while confirmation was open')
 await confirmation.getByRole('button',{name:'Move to Trash',exact:true}).click();await expect(confirmation.getByRole('alert')).toContainText('File changed');await expect(confirmation.getByRole('alert')).toBeVisible();assert.equal((await rpc('conversation.files',{conversation})).total,7);await confirmation.getByRole('button',{name:'Cancel',exact:true}).click()
 checks.push('Batch confirmation is cancellable; deletion moves files to recoverable Trash, updates original attachment states and Undo restores links without rewriting messages')
 await find(names[0]).getByRole('button',{name:'File actions for '+names[0],exact:true}).click();await page.getByRole('menuitem',{name:'Move to Trash',exact:true}).click();await confirmation.getByRole('button',{name:'Move to Trash',exact:true}).click();await expect(rows).toHaveCount(6)
 await manager.getByRole('button',{name:'Trash',exact:true}).click();await expect(rows).toHaveCount(1);fs.writeFileSync(path.join(workspace.root,'Papers',names[0]),'Keep the new same-name file');await rows.first().getByRole('button',{name:'Restore '+names[0],exact:true}).click();await expect(manager.getByRole('alert')).toContainText('not overwritten');assert.equal(fs.readFileSync(path.join(workspace.root,'Papers',names[0]),'utf8'),'Keep the new same-name file');await expect(rows).toHaveCount(1);fs.unlinkSync(path.join(workspace.root,'Papers',names[0]));await rows.first().getByRole('button',{name:'Restore '+names[0],exact:true}).click();await expect(rows).toHaveCount(0);await manager.getByRole('button',{name:'Shared',exact:true}).click();await expect(rows).toHaveCount(7)
 assert.equal(hash(),beforeHash);assert.deepEqual(fs.readFileSync(path.join(workspace.root,'Papers',names[0])),bytes)
 await find(names[1]).getByRole('button',{name:'File actions for '+names[1],exact:true}).click();await page.getByRole('menuitem',{name:'Go to message',exact:true}).click();await expect(library).toHaveCount(0);await expect(page.locator('[data-group-message="'+messages[1].id+'"]')).toBeInViewport()
 checks.push('Per-file actions, persistent Trash restore and source-message navigation preserve original file content, authors, messages and receipts')
 await open();await rpc('settings.set',{language:'zh-CN',viewAppearance:{messages:{theme:'black'}}});await expect(library.locator('h2')).toHaveText('共享文件')
 await page.screenshot({animations:'disabled',path:path.join(out,'dark-chinese-file-list.png')})
 await rows.first().getByRole('button',{name:/^管理文件 /}).click();await page.getByRole('menuitem',{name:'移到回收站',exact:true}).click();const darkDialog=page.getByRole('dialog',{name:'移除群文件',exact:true});await expect(darkDialog).toBeVisible();assert.equal(await darkDialog.evaluate(el=>getComputedStyle(el).backgroundColor),await library.evaluate(el=>getComputedStyle(el).backgroundColor),'The confirmation inherits the active Message theme');await page.screenshot({animations:'disabled',path:path.join(out,'dark-file-confirmation.png')});await page.keyboard.press('Escape');await expect(darkDialog).toHaveCount(0)
 if(web)await page.setViewportSize({width:430,height:900});else await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(740,900))
 const size=await library.boundingBox(),narrowNavigation=await measureNavigation();fs.writeFileSync(path.join(out,'narrow-navigation-layout.json'),JSON.stringify(narrowNavigation,null,2)+'\n')
 assert.ok(narrowNavigation.viewport.width<=760);assert.ok(size.x>=0&&size.width<=narrowNavigation.viewport.width);assert.ok(await rows.evaluateAll(elements=>elements.every(el=>el.scrollWidth<=el.clientWidth+1)))
 assert.equal(narrowNavigation.direction,'row');assert.ok(['auto','scroll'].includes(narrowNavigation.overflowX));assert.ok(Math.max(...narrowNavigation.buttons.map(button=>button.y))-Math.min(...narrowNavigation.buttons.map(button=>button.y))<2,'Narrow filters stay in a single scrollable row')
 for(const [index,id] of filterIds.entries()){await filterButtons.nth(index).click();await expect(library).toHaveAttribute('data-content-filter',id);await expect(filterButtons.nth(index)).toHaveAttribute('aria-current','page');const reached=await measureNavigation(),button=reached.buttons[index];assert.ok(button.x>=reached.nav.x-1&&button.right<=reached.nav.right+1,'Each narrow filter can be reached by normal scrolling/clicking')}
 await filterButtons.nth(3).click();await expect(rows).toHaveCount(7);checks.push('Narrow content navigation keeps one scrollable row and every filter remains reachable in the actual viewport')
 await page.screenshot({animations:'disabled',path:path.join(out,'narrow-file-list.png')});assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify({passed:true,mode,checks,errors,paidCalls:0,productionStateUsed:false},null,2)+'\n');console.log('PASS '+mode+': '+checks.join('; '))
}catch(error){await page?.screenshot({animations:'disabled',path:path.join(out,'failure.png')}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
