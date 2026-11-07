// Real desktop/Web interactions and Core data, using isolated homes and deterministic engines.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),web=process.argv.includes('--web'),errors=[],checks=[]
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/message-category-multi-2026-11-06/'+(web?'web':'desktop'));fs.mkdirSync(out,{recursive:true})
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve))
let fixture,app,browser,page
try{
 fixture=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 if(web){
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1380,height:960}})
  await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(fixture.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
 }else{
  await fixture.stop();const env={...fixture.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1380',AGENTS_COMPANY_HEIGHT:'960'};delete env.ELECTRON_RUN_AS_NODE
  const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()
 }
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.infinite-canvas').waitFor()
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await rpc('settings.set',{language:'en'});await rpc('group.add',{name:'Studio'})
 const a=await fixture.create('Alice','Studio'),b=await fixture.create('Bob','Studio'),c=await fixture.create('Cedar','Studio'),group=await rpc('chat.create',{name:'Team Room',members:[a.id,b.id]})
 const sources={};for(const plugin of ['telegram','x','youtube'])sources[plugin]=await rpc('channel.source-add',{plugin,locator:plugin==='telegram'?'category_news':'@category_news',name:plugin+' source'})
 const keyA='employee:'+a.id,keyB='employee:'+b.id,keyC='employee:'+c.id,keyGroup='group:'+group.id,keyX='channel:'+sources.x.channelId,keyTG='channel:'+sources.telegram.channelId,keyYT='channel:'+sources.youtube.channelId,allKeys=[keyA,keyB,keyC,keyGroup,keyX,keyTG,keyYT]
 await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click()
 const bar=page.locator('.message-category-bar'),all=bar.getByRole('button',{name:'All conversations',exact:true}),rows=page.locator('.message-contacts>.message-contact-wrap'),row=key=>rows.locator('[data-conversation-key="'+key+'"]'),chip=id=>bar.locator('#message-folder-'+id)
 const expectRows=async keys=>{await expect(rows).toHaveCount(keys.length);const actual=await rows.evaluateAll(nodes=>nodes.map(node=>node.dataset.conversationKey));assert.equal(new Set(actual).size,actual.length,'Every conversation is displayed once');assert.deepEqual(actual.sort(),[...keys].sort())}
 const create=async(name,names=[])=>{await bar.getByRole('button',{name:'Create category',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create category',exact:true});await dialog.locator('[name=conversation-folder-name]').fill(name);for(const item of names)await dialog.getByRole('checkbox',{name:'Include '+item,exact:true}).check();await dialog.getByRole('button',{name:'Create category',exact:true}).click();await expect(dialog).toHaveCount(0);return (await rpc('messenger.state')).folders.find(folder=>folder.name===name)}
 const save=async(name,conversations,include)=>{const id='mf_'+randomUUID();await rpc('messenger.folder-save',{id,name,conversations,expectedRevision:0,...(include?{include}:{})});await expect(chip(id)).toBeVisible();return id}
 const openMenu=()=>page.getByRole('button',{name:'Conversation list options',exact:true}).click(),listMenu=()=>page.getByRole('menu',{name:'Conversation list options',exact:true})
 await expect(page.locator('.message-directory-controls,.message-filter-toggle,.message-list-caption')).toHaveCount(0);await expect(all).toHaveAttribute('aria-pressed','true');await expectRows(allKeys)
 const first=await create('Research',['Alice','Team Room','X']);await expectRows([keyA,keyGroup,keyX]);await all.click();await expectRows(allKeys);await expect(all).toHaveAttribute('aria-pressed','true');await all.click();await expectRows([keyA,keyGroup,keyX]);await expect(chip(first.id)).toHaveAttribute('aria-pressed','true')
 checks.push('A freshly created category always has a visible All route back to the complete inbox; All restores its remembered selection')
 const second=await save('Daily',[keyA,keyB,keyX]),dynamic=await save('People',[],'private');await chip(second).click();await expectRows([keyA,keyB,keyGroup,keyX]);await expect(chip(first.id)).toHaveAttribute('aria-pressed','true');await expect(chip(second)).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('menu',{name:'Category options',exact:true})).toHaveCount(0)
 await chip(dynamic).click();await expectRows([keyA,keyB,keyC,keyGroup,keyX]);await all.click();await expectRows(allKeys);await expect(chip(first.id)).toHaveAttribute('aria-pressed','false');await expect(chip(second)).toHaveAttribute('aria-pressed','false');await all.click();await expectRows([keyA,keyB,keyC,keyGroup,keyX]);await chip(dynamic).click();await expectRows([keyA,keyB,keyGroup,keyX])
 await page.reload();await expect(page.locator('.message-sidebar')).toBeVisible();await expectRows([keyA,keyB,keyGroup,keyX]);await expect(chip(first.id)).toHaveAttribute('aria-pressed','true');await expect(chip(second)).toHaveAttribute('aria-pressed','true')
 await page.locator('.company-navigation').getByRole('button',{name:'Team',exact:true}).click();await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await expectRows([keyA,keyB,keyGroup,keyX])
 checks.push('Overlapping explicit and dynamic categories form a deduplicated union; multiple selection survives reload and navigation')
 const initialOrder=[keyC,keyA,keyYT,keyB,keyTG,keyGroup,keyX],state=await rpc('messenger.state');await rpc('messenger.reorder',{scope:'all',order:initialOrder,expectedOrder:state.orders?.all??[]})
 await rows.filter({has:page.locator('[data-employee="'+a.id+'"]')}).locator('.message-contact').focus();await page.keyboard.press('Alt+ArrowDown');const expectedOrder=[keyC,keyB,keyYT,keyA,keyTG,keyGroup,keyX];await expect.poll(async()=>(await rpc('messenger.state')).orders.all).toEqual(expectedOrder)
 await chip(first.id).focus();const categoryOrder=await bar.locator('.message-category-chip').evaluateAll(nodes=>nodes.map(node=>node.dataset.sortKey)),position=categoryOrder.indexOf(first.id),reordered=[...categoryOrder];reordered.splice(position+1,0,reordered.splice(position,1)[0]);await page.keyboard.press('Alt+ArrowRight');await expect.poll(async()=>(await rpc('messenger.state')).orders.categories).toEqual(reordered)
 checks.push('Combined-category sorting preserves hidden conversation positions; category sorting keeps All fixed')
 await bar.getByRole('button',{name:'Category options for Research',exact:true}).click();await page.getByRole('menuitem',{name:'Edit category',exact:true}).click();const editor=page.getByRole('dialog',{name:'Edit category',exact:true});await editor.locator('[name=conversation-folder-name]').fill('Research notes');await editor.getByRole('button',{name:'Save category',exact:true}).click();await expect(editor).toHaveCount(0);await expect(chip(first.id)).toHaveText('Research notes');await expect(chip(second)).toHaveAttribute('aria-pressed','true');await expectRows([keyA,keyB,keyGroup,keyX])
 await expect(page.locator('[data-message-exit]')).toHaveCount(0);await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'01-multiple-categories.png')})
 await bar.getByRole('button',{name:'Category options for Research notes',exact:true}).click();await page.getByRole('menuitem',{name:'Delete category',exact:true}).click();await expect(chip(first.id)).toHaveCount(0);await expectRows([keyA,keyB,keyX]);await expect(chip(second)).toHaveAttribute('aria-pressed','true')
 await chip(second).click();await expectRows(allKeys);await expect(all).toHaveAttribute('aria-pressed','true');await chip(second).click();await expectRows([keyA,keyB,keyX]);await all.click();await expectRows(allKeys)
 const current=(await rpc('messenger.state')).folders.find(folder=>folder.id===second);await rpc('messenger.folder-delete',{id:second,expectedRevision:current.revision});await expect(chip(second)).toHaveCount(0);await all.click();await expectRows(allKeys)
 checks.push('Editing retains other selections; deselecting the last category and deleting selected/remembered categories safely return to All')
 const empty=await create('Empty');await expectRows([]);await expect(all).toBeVisible();await all.click();await expectRows(allKeys);await bar.getByRole('button',{name:'Category options for Empty',exact:true}).click();await page.getByRole('menuitem',{name:'Delete category',exact:true}).click();await expect(chip(empty.id)).toHaveCount(0)
 // An old client may have left its disabled category behind a Groups-only filter.
 await page.evaluate(id=>{const key=Object.keys(localStorage).find(key=>key.startsWith('agents-company-message-directory-')&&!key.endsWith('-feeds'));localStorage.setItem(key,JSON.stringify({scope:'all',folderId:id,query:'',filterEnabled:true,conversationType:'groups'}))},dynamic)
 await page.reload();await expect(page.locator('.message-sidebar')).toBeVisible();await expectRows([keyA,keyB,keyC]);await expect(page.locator('.message-directory-controls')).toHaveCount(0);await all.click();await expectRows(allKeys)
 await rpc('messenger.conversation',{conversations:[keyB],patch:{favorite:true}});await openMenu();await listMenu().getByRole('menuitem',{name:'Favorites',exact:true}).click();await expectRows([keyB]);await expect(all).toHaveAttribute('aria-pressed','false');await all.click();await expectRows(allKeys)
 checks.push('Empty categories are escapable; legacy single-category/Filter state migrates cleanly and All also exits Favorites')
 await page.setViewportSize({width:720,height:960});await expect(all).toBeVisible();assert.ok((await all.boundingBox()).width<=38);assert.ok((await bar.boundingBox()).height<=44);await bar.locator('.message-category-tabs').evaluate(node=>node.scrollLeft=10000);await expect(all).toBeVisible();await expect(page.locator('[data-message-exit]')).toHaveCount(0);await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'02-narrow-all.png')})
 assert.deepEqual(errors,[]);if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:process.env.AGENTS_COMPANY_TEST_APP||'source',mode:web?'web':'desktop',checks,errors,modelCalls:0,productionDataUsed:false},null,2));for(const check of checks)console.log('PASS '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,errors},null,2));throw error}
finally{await app?.close();await browser?.close();await fixture?.close()}
