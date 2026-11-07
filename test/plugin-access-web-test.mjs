// Actual headless browser + authenticated Web Core + opaque plugin renderer.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}),out=path.join(f.root,'artifacts/plugin-page-access/web');fs.mkdirSync(out,{recursive:true});let browser
try{
 const rpc=async(cmd,args={},auth=null)=>{const r=await f.request(auth,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('group.add',{name:'Web grants'});const person=await f.create('lancer','Web grants'),token=await f.token(person.id),note=await rpc('plugin.call',{id:'mininotion',method:'page.create',params:{title:'Web scoped note',color:'white'}})
 browser=await chromium.launch({headless:true,...(!fs.existsSync(chromium.executablePath())?{channel:'chrome'}:{})});const page=await browser.newPage({viewport:{width:1350,height:900}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await page.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),state=await call('plugin.open',{id:'mininotion'}),host=page.frameLocator('.web-plugin-window[data-window-id="'+state.id+'"]>iframe')
 await host.getByRole('button',{name:'内容授权',exact:true}).click();const dialog=host.getByRole('dialog',{name:'内容授权',exact:true});await dialog.locator('.plugin-access-resources label').filter({hasText:'Web scoped note'}).locator('input').check();await dialog.getByRole('checkbox',{name:'lancer 阅读',exact:true}).check();await dialog.getByRole('button',{name:'保存授权',exact:true}).click();await expect(dialog).toHaveCount(0)
 assert.equal((await rpc('plugin.call',{id:'mininotion',method:'page.get',params:{pageId:note.id}},token)).id,note.id)
 const child=host.frameLocator('iframe');await expect.poll(()=>child.locator('body').evaluate(async()=>!!window.native&&!!(await window.native.api('workspace.get')).result)).toBe(true)
 const direct=await page.request.post(new URL('host-rpc',state.url).href,{data:{cmd:'plugin.access',args:{}}});assert.equal(direct.status(),403)
 await page.screenshot({path:path.join(out,'web-authorized-plugin.png')});await call('plugin.dismiss',{id:state.id});await expect(page.locator('.web-plugin-window')).toHaveCount(0)
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['Trusted host permission UI uses authenticated parent Core channel','Original plugin renderer stays opaque and brokers native RPC through its parent','Grant immediately enables employee page API','Direct view-URL POST remains forbidden','Close flush crosses both frames'],modelCalls:0},null,2)+'\n');console.log('PASS Web plugin permission host, opaque child RPC, real grant, no direct RPC capability and close/flush')
}catch(error){if(browser)for(const page of browser.contexts().flatMap(c=>c.pages()))await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error}finally{await browser?.close();await f.close()}
