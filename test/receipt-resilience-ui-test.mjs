// Actual work/private receipt lifecycle, disposable Core and hidden renderer; no model calls.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
import {acceptedMessage} from './fixtures/ui-contracts.mjs'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/receipt-resilience')
fs.mkdirSync(out,{recursive:true})
const f=await fixtureCore();await f.stop()
const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1168',AGENTS_COMPANY_HEIGHT:'850'};delete env.ELECTRON_RUN_AS_NODE
const application=process.env.AGENTS_COMPANY_TEST_APP,app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),errors=[],checks=[]
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),status=async id=>(await call('session.status',{employee:id}))[0]
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pass=text=>{checks.push(text);console.log('PASS '+text)}
// Simulate native event ordering, not authorization; the actual IPC guard still runs.
const native=async active=>app.evaluate(({BrowserWindow},active)=>{const win=BrowserWindow.getAllWindows()[0];if(!globalThis.restoreReceipts)globalThis.restoreReceipts=()=>{delete win.isVisible;delete win.isFocused;delete win.isMinimized;delete win.webContents.isFocused};win.isVisible=()=>active;win.isFocused=()=>active;win.isMinimized=()=>false;win.webContents.isFocused=()=>active},active)
const documentFocus=async active=>page.evaluate(active=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>active});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>active?'visible':'hidden'});window.dispatchEvent(new Event(active?'focus':'blur'));document.dispatchEvent(new Event('visibilitychange'))},active)
const post=async(token,text)=>{const response=await f.request(token,'direct.post',{text,clientMessageId:crypto.randomUUID()});assert.ok(response.ok,response.error);return response.data}
try{
 await page.locator('.agent-board').waitFor();await page.emulateMedia({reducedMotion:'reduce'});await call('settings.set',{language:'en',boardMaxColumns:1});await call('group.add',{name:'Receipt fixture'})
 const a=await f.create('Reader A','Receipt fixture'),b=await f.create('Reader B','Receipt fixture'),tokens={a:await f.token(a.id),b:await f.token(b.id)}
 await documentFocus(false)
 for(const person of [a,b]){fs.writeFileSync(path.join(f.control,person.id+'.reply.txt'),'WORK_ONLY_'+person.title);await call('session.send',{employee:person.id,text:'Reply for work reading',sourceView:'company'});await acceptedMessage(call,person.id,'Reply for work reading');await expect.poll(async()=>!!(await status(person.id)).lastReply).toBe(true)}
 await call('view.open',{kind:'conversation',employee:a.id});await page.locator('.conversation-dialog .reply-seen-marker').waitFor({state:'attached'});await wait(800);assert.equal((await status(a.id)).lastReply.readAt,undefined,'hidden renderer cannot acknowledge work')
 await native(true);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('api:event',{channel:'desktop:visibility',payload:{active:false,visible:true}}));await documentFocus(true)
 await expect.poll(async()=>!!(await status(a.id)).lastReply.readAt,{timeout:3500,message:'A stale blur must not block a foreground receipt'}).toBe(true)
 await call('view.select',{id:'company'});await expect(page.locator('.conversation-dialog')).toHaveCount(0)
 const unread=id=>page.locator(`.board-roster-row[data-member-key="employee:${id}"] .unread-dot`)
 await expect(unread(a.id)).toHaveCount(0);await expect(unread(b.id)).toHaveCount(1);await page.getByRole('button',{name:'Hide agents sidebar',exact:true}).click();await expect(unread(b.id)).toBeVisible()
 pass('Work replies have a visible Team unread marker, including the avatar rail; reading one reply leaves the offscreen employee unread')
 await native(false);await call('view.open',{kind:'conversation',employee:b.id});await page.locator('.conversation-dialog .reply-seen-marker').waitFor({state:'attached'});await wait(900);assert.equal((await status(b.id)).lastReply.readAt,undefined)
 await native(true);await expect.poll(async()=>!!(await status(b.id)).lastReply.readAt,{timeout:3500}).toBe(true)
 await documentFocus(false);fs.writeFileSync(path.join(f.control,a.id+'.reply.txt'),Array.from({length:50},(_,i)=>'WORK_PARAGRAPH_'+i+'. Content remains in the actual work conversation.').join('\n\n'))
 await call('session.send',{employee:a.id,text:'Long work reply',sourceView:'company'});await acceptedMessage(call,a.id,'Long work reply');await call('view.open',{kind:'conversation',employee:a.id});const work=page.locator('.conversation-dialog .transcript');await work.locator('.reply-seen-marker').waitFor({state:'attached'});await work.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});await documentFocus(true);await wait(900);assert.equal((await status(a.id)).lastReply.readAt,undefined,'unseen end of a long work reply remains unread');await work.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});await expect.poll(async()=>!!(await status(a.id)).lastReply.readAt).toBe(true)
 pass('Native background denial, regained-focus retry and exact long-work-reply visibility retain the real guard')
 const workReply=(await status(a.id)).lastReply.id;await documentFocus(false)
 const privateA=await post(tokens.a,Array.from({length:45},(_,i)=>'PRIVATE_PARAGRAPH_'+i+'. Explicit private content has its own read sequence.').join('\n\n')),privateB=await post(tokens.b,'PRIVATE_BELOW_DIALOG · Closing the dialog resumes observation.')
 const history=id=>call('direct.history',{employee:id})
 await call('view.open',{kind:'messages',employee:b.id});await page.locator(`.message-conversation [data-reply-id="${privateB.id}"]`).waitFor({state:'attached'});await expect(page.locator('.message-contact[data-employee="'+a.id+'"] .message-unread-dot')).toHaveCount(1)
 await page.getByRole('button',{name:'Conversation list options',exact:true}).click();await page.getByRole('menuitem',{name:'New group',exact:true}).click();await expect(page.getByRole('dialog',{name:'New group',exact:true})).toBeVisible();await documentFocus(true);await wait(900);assert.equal((await history(b.id)).readSequence,0,'covering dialog prevents private reading')
 await native(false);await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'New group',exact:true})).toHaveCount(0);await wait(900);assert.equal((await history(b.id)).readSequence,0,'native background protection remains after dialog close');await native(true);await expect.poll(async()=>(history(b.id)).then(value=>value.readSequence),{timeout:3500}).toBe(privateB.sequence)
 assert.equal((await history(a.id)).readSequence,0,'another private conversation stays unread');assert.equal((await status(a.id)).lastReply.id,workReply)
 await documentFocus(false);await call('view.open',{kind:'messages',employee:a.id});const privateArea=page.locator('.message-conversation .transcript');await privateArea.locator(`[data-reply-id="${privateA.id}"]`).waitFor({state:'attached'});await privateArea.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});await documentFocus(true);await wait(900);assert.equal((await history(a.id)).readSequence,0,'unseen private tail stays unread');await privateArea.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});await expect.poll(async()=>(await history(a.id)).readSequence).toBe(privateA.sequence);await expect(page.locator('.message-contact[data-employee="'+a.id+'"] .message-unread-dot')).toHaveCount(0);await expect(privateArea).not.toContainText('WORK_ONLY_');await expect(privateArea).not.toContainText('WORK_PARAGRAPH_')
 pass('Private read sequences stay separate from work; modal close and exact visibility recover without leaking native work into private history')
 assert.deepEqual(errors,[]);await app.evaluate(()=>globalThis.restoreReceipts?.());assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(win=>!win.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,modelCalls:0,productionStateUsed:false},null,2)+'\n')
}catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),String(error.stack??error));throw error}
finally{await app.evaluate(()=>globalThis.restoreReceipts?.()).catch(()=>{});await app.close();await f.close()}
