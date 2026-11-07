// Installed/source desktop + real scoped HTTP protocol. Isolated data, no external news/model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-subscriptions-')))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_HIDDEN:'1'}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/subscription-management/ui')
fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),checks=[],errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
const deny=async(cmd,args)=>{let error;try{await call(cmd,args)}catch(e){error=e}assert.ok(error,cmd+' must reject')}
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'})
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 await call('channel.settings',{patch:{enabled:true,port}})
 const a=await call('channel.source-add',{plugin:'youtube',locator:'@subscriptionalpha',name:'AI Alpha'}),b=await call('channel.source-add',{plugin:'youtube',locator:'@subscriptionbeta',name:'AI Beta'})
 const news=await call('channel.publish',{sourceId:a.id,externalId:'keep',publishedAt:Date.now()-1000,title:'Existing summary',body:'Retain this item.'});await call('channel.save',{id:news.id,saved:true})
 const issued=await call('channel.collector-add',{name:'bupt208 fixture',sourceIds:'all'}),other=await call('channel.collector-add',{name:'Other fixture',sourceIds:[b.id]})
 const endpoint=`http://127.0.0.1:${port}/api/channels/collector`
 const request=async(cmd,args={},token=issued.token)=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({cmd,args})});return {status:response.status,...await response.json()}}
 const receive=async()=>{const value=await request('channel.collector-config');assert.ok(value.ok,value.error);return value.data}
 const confirm=async config=>{const value=await request('channel.collector-ack',{revision:config.revision});assert.ok(value.ok,value.error);return value.data}
 const state=()=>call('channel.subscription-status',{channelId:a.channelId})
 const receipt=()=>page.locator(`[data-collector-id="${issued.collector.id}"]`)
 await call('view.open',{kind:'messages',channelId:a.channelId});await page.getByRole('button',{name:'Conversation list options',exact:true}).click();await page.getByRole('menuitem',{name:'Manage channels and authors',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Manage channels and authors',exact:true})
 await dialog.locator('.channel-platform-tabs').getByRole('button',{name:/YouTube/}).click()
 await expect(dialog.locator('.channel-source-row')).toHaveCount(2);await expect(receipt()).toHaveAttribute('data-sync-state','offline')
 const first=await receive();await expect(receipt()).toHaveAttribute('data-sync-state','pending');await confirm(first);await expect(receipt()).toHaveAttribute('data-sync-state','synced')
 assert.equal((await state()).revision,first.revision,'receipts must not change the subscription version')
 pass('Mac management distinguishes disconnected, delivered-but-pending and server-applied configurations')
 await dialog.locator(`[data-source-id="${a.id}"]`).getByRole('button',{name:'Manage author AI Alpha',exact:true}).click();await dialog.getByRole('button',{name:'Unfollow AI Alpha',exact:true}).click()
 await expect(dialog.locator(`[data-source-id="${a.id}"]`)).toHaveCount(0);await expect(receipt()).toHaveAttribute('data-sync-state','pending')
 const rejected=await request('channel.publish',{sourceId:a.id,externalId:'must-not-arrive',publishedAt:Date.now()-1000,title:'Disabled',body:'Rejected after unfollow'});assert.equal(rejected.code,'SOURCE_DISABLED');
 const disabled=await receive();assert.equal(disabled.targets.find(t=>t.sourceId===a.id).enabled,false);assert.equal(disabled.targets.find(t=>t.sourceId===b.id).enabled,true)
 assert.equal((await state()).collectors.find(c=>c.id===issued.collector.id).state,'pending');await confirm(disabled);await expect(receipt()).toHaveAttribute('data-sync-state','synced')
 pass('Unfollow in the real Mac UI is sent over the collector connection; it is not marked applied before acknowledgment')
 await dialog.getByRole('button',{name:'Not following',exact:true}).click()
 await expect(dialog.locator('.channel-source-row')).toHaveCount(1);const restoreRow=dialog.locator(`[data-source-id="${a.id}"]`).getByRole('button',{name:'Manage author AI Alpha',exact:true});if(await restoreRow.getAttribute('aria-expanded')!=='true')await restoreRow.click();await dialog.getByRole('button',{name:'Follow AI Alpha',exact:true}).click()
 const restored=await receive();assert.equal(restored.targets.find(t=>t.sourceId===a.id).enabled,true);await confirm(restored)
 await dialog.getByRole('button',{name:'Add subscription',exact:true}).click();await dialog.getByRole('button',{name:'Platform',exact:true}).click();await page.getByRole('option',{name:'YouTube',exact:true}).click();await dialog.getByRole('textbox',{name:'Subscription address',exact:true}).fill('@subscriptiongamma');await dialog.getByRole('button',{name:'Follow author',exact:true}).click()
 await expect(dialog.locator('.channel-source-row')).toHaveCount(3)
 const added=await receive();assert.equal(added.targets.filter(t=>t.plugin==='youtube'&&t.enabled).length,3);await confirm(added);await expect(receipt()).toHaveAttribute('data-sync-state','synced')
 assert.equal((await call('channel.post',{id:news.id})).saved,true)
 pass('Mac UI restores and adds subscriptions, defaults to followed authors and preserves saved news and stable identities')
 assert.equal((await request('channel.collector-ack',{revision:added.revision+1})).status,409)
 assert.equal((await request('channel.collector-ack',{revision:added.revision},other.token)).status,409)
 assert.equal((await request('channel.collector-ack',{revision:added.revision,collectorId:other.collector.id})).ok,false)
 await deny('channel.collector-ack',{revision:added.revision})
 const stale=await confirm(first);assert.equal(stale.revision,added.revision)
 assert.equal((await request('card.create',{title:'forbidden'})).status,403)
 const unchanged=await request('channel.collector-config',{sinceRevision:added.revision});assert.equal(unchanged.data.changed,false)
 await call('channel.collector-revoke',{id:other.collector.id});assert.equal((await request('channel.collector-ack',{revision:added.revision},other.token)).status,401)
 pass('Receipts are collector-bound, monotonic and authenticated; operator forgery, future/undelivered revisions, extra fields and revoked credentials are rejected')
 await confirm(await receive());await expect(receipt()).toHaveAttribute('data-sync-state','synced');await page.screenshot({path:path.join(out,'subscriptions-applied.png'),animations:'disabled'});assert.deepEqual(errors,[])
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,providerCalls:0,application:application||'source'},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
