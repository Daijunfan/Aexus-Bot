// Real long-history gestures; all employees, messages and native profiles are disposable.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),web=process.argv.includes('--web'),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/message-context-history/'+(web?'web':'desktop'))
fs.mkdirSync(out,{recursive:true});const checks=[],errors=[],probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,app,browser,page
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const core=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
 await f.cli('group','add','History QA');const a=await f.create('Aster','History QA'),b=await f.create('Rowan','History QA'),group=await core('chat.create',{name:'Long reading context',members:[a.id,b.id]})
 await core('settings.set',{language:'en',viewAppearance:{messages:{theme:'violet'}}})
 for(let i=0;i<215;i++)await core('chat.post',{id:group.id,text:'Note '+String(i+1).padStart(3,'0')+'. A useful message keeps its identity while history is paged, the window is resized and a reaction is selected.',clientMessageId:'history-menu-'+i})
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1380,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1380',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.agent-board').waitFor();const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await rpc('view.open',{kind:'messages',chatId:group.id});const feed=page.locator('.group-transcript'),viewport=page.locator('.message-viewport');await expect(feed).toHaveAttribute('aria-busy','false');await expect(page.locator('.group-message').first()).toBeVisible()
 for(let i=0;i<3;i++){const older=page.getByRole('button',{name:'Load earlier messages',exact:true});if(!await older.count())break;const count=Number(await viewport.getAttribute('data-message-count'));await older.click();await expect.poll(async()=>Number(await viewport.getAttribute('data-message-count'))).toBeGreaterThan(count)}
 await expect(viewport).toHaveAttribute('data-message-count','215');await expect.poll(()=>page.locator('.group-message').count()).toBeLessThan(80);checks.push('215 real messages load through paged history and keep fewer than 80 message elements mounted')
 const selected=await page.locator('.group-message').evaluateAll(nodes=>{const bounds=nodes[0].closest('.group-transcript').getBoundingClientRect(),visible=nodes.filter(el=>{const r=el.getBoundingClientRect();return r.top>=bounds.top+8&&r.bottom<=bounds.bottom-8});return visible[Math.floor(visible.length/2)]?.getAttribute('data-chat-item')});assert.ok(selected)
 const row=page.locator('[data-chat-item="'+selected+'"]'),scrollBefore=await feed.evaluate(el=>el.scrollTop);await row.getByRole('button',{name:'Message options',exact:true}).focus();await page.keyboard.press('Enter');const menu=page.getByRole('menu',{name:'Message options',exact:true});await expect(menu).toBeVisible();await menu.getByRole('menuitem',{name:'More reactions',exact:true}).click();const picker=page.getByRole('menu',{name:'Emoji picker',exact:true});await expect(picker).toBeVisible();await expect(row).toHaveAttribute('data-message-context','true')
 const resize=(width,height)=>web?page.setViewportSize({width,height}):app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height])
 await resize(1380,450);await expect(picker).toBeVisible();await expect(row).toBeAttached();await picker.getByRole('textbox',{name:'Search emoji',exact:true}).fill('rocket');await picker.locator('[data-emoji="🚀"]').click();await expect(picker).toHaveCount(0)
 const history=await rpc('chat.history',{id:group.id,around:selected,limit:1});assert.equal(history.messages[0].id,selected);assert.ok(history.messages[0].reactions.some(reaction=>reaction.emoji==='🚀'&&reaction.my));await expect(page.locator('[data-message-context=true]')).toHaveCount(0);checks.push('Keyboard context actions and the full emoji picker keep their original message through a live viewport resize, then write the real shared reaction to that ID')
 await resize(1380,1000);await expect.poll(()=>page.locator('.group-message').count()).toBeLessThan(80);await page.screenshot({path:path.join(out,'long-history.png'),animations:'disabled'});assert.deepEqual(errors,[])
 if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode:web?'web':'desktop',checks,errors,initialScrollTop:scrollBefore,productionDataUsed:false,paidModelCalls:0},null,2)+'\n');for(const check of checks)console.log('PASS '+check)
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}finally{await app?.close();await browser?.close();await f?.close()}
