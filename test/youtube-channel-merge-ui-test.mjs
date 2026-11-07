// Real Core/CLI and hidden desktop, with isolated subscriptions and synthetic news only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {_electron as electron,expect} from '@playwright/test'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-youtube-merge-')))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),AGENTS_COMPANY_HIDDEN:'1'}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['ELECTRON_RUN_AS_NODE','AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_URL','AGENTS_COMPANY_PORT','AGENTS_COMPANY_CLIENT'].includes(key))delete env[key]
const application=process.env.AGENTS_COMPANY_TEST_APP,out=process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/youtube-merge-ui')
fs.mkdirSync(out,{recursive:true})
const app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env}),page=await app.firstWindow(),checks=[],errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
const row=key=>page.locator(`[data-conversation-key="${key}"]`),sources=[]
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'})
 for(const [plugin,locator,name,enabled] of [['youtube','@mergealpha','Video Alpha',true],['youtube','@mergebeta','Video Beta',true],['youtube','@mergedisabled','Disabled creator',false],['x','@mergexalpha','X Alpha',true],['x','@mergexbeta','X Beta',true],['telegram','merge-news','Telegram news',true]])sources.push(await call('channel.source-add',{plugin,locator,name,enabled}))
 const [a,b,disabled,x1,x2,tg]=sources,channelId=a.channelId,key='channel:'+channelId
 assert.equal(b.channelId,channelId);assert.equal(disabled.channelId,channelId)
 const posts=[]
 for(const [source,title] of [[a,'Alpha video summary'],[b,'Beta video summary']])posts.push({...await call('channel.publish',{sourceId:source.id,externalId:'merge-'+source.id,publishedAt:Date.now()-1000,title,body:'Only a concise summary from '+source.name}),title})
 await call('channel.save',{id:posts[1].id,saved:true})
 const beforeSources=await call('channel.sources',{plugin:'youtube',includeDisabled:true}),beforeReads=await call('channel.read-state',{id:channelId,entryIds:posts.map(post=>post.id)})
 await call('view.open',{kind:'messages',sourceId:a.id})
 assert.equal((await call('view.get')).sourceId,undefined)
 await expect(row(key)).toHaveCount(1);await expect(row(key).locator('.message-contact')).toHaveAttribute('aria-current','true')
 for(const source of [a,b,disabled])await expect(row('source:'+source.id)).toHaveCount(0)
 await expect(row('source:'+x1.id)).toHaveCount(1);await expect(row('source:'+x2.id)).toHaveCount(1)
 await expect(page.locator('.channel-person strong')).toHaveText('YouTube');await expect(page.locator('.channel-news-item')).toHaveCount(2)
 for(const post of posts)await expect(page.locator(`[data-news-id="${post.id}"]`)).toContainText(post.title)
 pass('All YouTube authors share one selected channel and one combined feed; X authors remain separate')
 const cli=JSON.parse((await promisify(execFile)(process.execPath,[path.join(root,'bin/agents'),'messenger','directory','--type','youtube','--json'],{env,timeout:15000})).stdout)
 assert.equal(cli.ok,true);assert.deepEqual(cli.data.entries.map(entry=>entry.key),[key]);assert.equal(cli.data.counts.youtube,1)
 await page.getByRole('button',{name:'Filter',exact:true}).click();await page.getByRole('button',{name:'Conversation type'}).click();await page.getByRole('option',{name:'YouTube channel',exact:true}).click()
 await expect(page.locator('.message-contact-wrap')).toHaveCount(1);await expect(row(key)).toHaveCount(1)
 await page.getByRole('button',{name:'Filter',exact:true}).click()
 pass('The CLI directory and the Messages type filter both return one YouTube channel')
 await page.getByRole('button',{name:'Create category',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Create category',exact:true})
 await dialog.getByRole('button',{name:'Social platform',exact:true}).click();await dialog.getByRole('combobox',{name:'Social platform',exact:true}).selectOption('youtube')
 await expect(dialog.locator('input[type=checkbox]')).toHaveCount(1);await expect(dialog.getByRole('checkbox',{name:'Include YouTube'})).toBeChecked()
 await dialog.locator('[name=conversation-folder-name]').fill('Merged videos');await dialog.getByRole('button',{name:'Create category',exact:true}).click();await expect(dialog).toHaveCount(0)
 await expect(page.locator('.message-contact-wrap')).toHaveCount(1);await expect(row(key)).toHaveCount(1)
 const manual=await call('messenger.folder-save',{name:'Legacy source selection',conversations:['source:'+a.id,'source:'+b.id]})
 const folder=manual.folders.find(value=>value.name==='Legacy source selection');assert.deepEqual(folder.conversations,[key]);assert.equal((await call('messenger.directory',{folder:folder.id})).total,1)
 await call('messenger.conversation',{conversations:['source:'+a.id],patch:{favorite:true}});assert.equal((await call('messenger.state')).conversations[key].favorite,true)
 pass('The category picker contains one YouTube entry; source-based selections and preferences resolve to the same channel')
 await call('messenger.conversation',{conversations:[key],patch:{archived:true}});await expect(row(key)).toHaveCount(0)
 assert.equal((await call('messenger.directory',{type:'youtube'})).total,0);assert.equal((await call('messenger.directory',{type:'youtube',archived:'only'})).total,1)
 await call('messenger.conversation',{conversations:[key],patch:{archived:false}});await expect(row(key)).toHaveCount(1)
 await call('view.select',{id:'company'});await call('view.select',{id:'messages'});assert.equal((await call('view.get')).sourceId,undefined)
 assert.deepEqual(await call('channel.sources',{plugin:'youtube',includeDisabled:true}),beforeSources)
 assert.deepEqual(await call('channel.read-state',{id:channelId,entryIds:posts.map(post=>post.id)}),beforeReads)
 const feed=await call('channel.posts',{channelId});assert.deepEqual(new Set(feed.posts.map(post=>post.id)),new Set(posts.map(post=>post.id)));assert.equal(feed.posts.find(post=>post.id===posts[1].id).saved,true)
 assert.equal((await call('channel.posts',{sourceId:a.id})).total,1);assert.equal((await call('messenger.social',{platform:'youtube',includeDisabled:true})).length,3)
 pass('Archive, navigation and restoration keep one identity; subscriptions, disabled state, post IDs, saved news and read receipts are preserved')
 await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:path.join(out,'youtube-merged.png'),animations:'disabled'});assert.deepEqual(errors,[])
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks,errors,providerCalls:0},null,2)+'\n')
}finally{await app.close();fs.rmSync(temp,{recursive:true,force:true})}
