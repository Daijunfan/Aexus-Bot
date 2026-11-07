// Actual hidden desktop UI/Core/CLI. Isolated people, grants and synthetic news only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=path.resolve(import.meta.dirname,'..'),f=await fixtureCore(),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/secretary-channel-access/ui'));fs.mkdirSync(out,{recursive:true});let app
try{
 await f.cli('group','add','News desk');const lancer=await f.create('lancer','News desk'),other=await f.create('reader two','News desk'),secretary=await f.create('Secretary','News desk','secretary'),token=await f.token(lancer.id),secretaryToken=await f.token(secretary.id),sources=[]
 for(const plugin of ['telegram','x','youtube'])sources.push(await f.cli('channel','source-add','--data',JSON.stringify({plugin,locator:'@accessui'+plugin,name:plugin})))
 await f.stop();const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1420',AGENTS_COMPANY_HEIGHT:'1050'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(20000)
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),agent=async(cmd,args,auth)=>{const r=await f.request(auth,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'});await call('view.open',{kind:'messages',channelId:sources[1].channelId})
 const accessButton=page.getByRole('button',{name:'Channel access',exact:true});await expect(accessButton).toHaveCount(1);await expect(accessButton).toBeEnabled();await accessButton.click()
 const dialog=page.getByRole('dialog',{name:'Channel access',exact:true}),row=name=>dialog.locator('.channel-admin-options>label').filter({hasText:name}),lancerBox=()=>row('lancer').locator('input'),secBox=()=>row('Secretary').locator('input')
 await expect(lancerBox()).toBeEnabled();await expect(lancerBox()).not.toBeChecked();await expect(secBox()).toBeChecked();await expect(secBox()).toBeDisabled();await expect(dialog).toContainText('Secretary always has access')
 await lancerBox().check();await dialog.screenshot({path:path.join(out,'authorization-white.png'),animations:'disabled'});await dialog.getByRole('button',{name:'Save access',exact:true}).click();await expect(dialog).toHaveCount(0)
 assert.deepEqual((await call('channel.access',{id:sources[1].channelId})).employeeIds,[lancer.id]);assert.deepEqual((await agent('channel.list',{},token)).map(c=>c.id),[sources[1].channelId])
 const post=await call('channel.publish',{sourceId:sources[1].id,externalId:'ui-news',publishedAt:Date.now()-1000,title:'Frontier news fixture',body:'Actual grant through the UI; actual native fetch through Core.'})
 assert.equal((await agent('channel.fetch-text',{id:sources[1].channelId,limit:1},token)).messages[0].id,post.id);assert.ok((await call('session.status')).every(p=>!p.busy))
 const wanted=[sources[2],sources[0],sources[1]].map(s=>'channel:'+s.channelId),state=await agent('messenger.state',{},secretaryToken)
 await agent('messenger.reorder',{scope:'all',order:wanted,expectedOrder:state.orders?.all??[]},secretaryToken)
 await expect.poll(()=>page.locator('.message-contacts [data-sort-key]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sortKey).filter(k=>k.startsWith('channel:')))).toEqual(wanted)
 await accessButton.click();await expect(lancerBox()).toBeEnabled();await lancerBox().uncheck();await dialog.getByRole('button',{name:'Save access',exact:true}).click();await expect(dialog).toHaveCount(0)
 assert.equal((await f.request(token,'channel.fetch-text',{id:sources[1].channelId})).ok,false);assert.equal((await agent('channel.list',{},secretaryToken)).length,3)
 await accessButton.click();await expect(lancerBox()).toBeEnabled();const current=await call('channel.access',{id:sources[1].channelId});await call('channel.access',{id:sources[1].channelId,employeeIds:[other.id],expectedRevision:current.revision});await lancerBox().check();await dialog.getByRole('button',{name:'Save access',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Channel changed');assert.deepEqual((await call('channel.access',{id:sources[1].channelId})).employeeIds,[other.id])
 await dialog.getByRole('button',{name:'Load latest',exact:true}).click();await expect(lancerBox()).not.toBeChecked();await expect(row('reader two').locator('input')).toBeChecked()
 await call('settings.set',{theme:'black'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,900));await dialog.screenshot({path:path.join(out,'authorization-black-narrow.png'),animations:'disabled'});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 const channel=page.locator('.channel-conversation');assert.equal(await channel.locator('.channel-composer,.group-thinking-members').count(),0)
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks:['Enabled channel access button and actual checkbox/save path','Secretary automatic access, no explicit grant','Actual employee discovery and full text after UI authorization','Immediate UI revocation and API denial','Secretary API ordering updates the user’s actual rendered channel list','Concurrent grant conflict does not overwrite another edit; reload recovers','Readable light/dark/narrow dialog and no restored group/composer/task controls'],modelCalls:0},null,2)+'\n');console.log('PASS actual hidden channel authorization UI, native API permission changes, global Secretary order rendered immediately, optimistic conflict/reload and both themes')
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}finally{await app?.close();await f.close()}
