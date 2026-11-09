// Duplicating a browser tab copies sessionStorage. Each live page must retain its own navigation and guards.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
const f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/product-polish-v2/tabs');fs.mkdirSync(out,{recursive:true})
let browser,page,copy;const errors=[],closed=[]
try{
 await f.cli('settings','set','--language','en');await f.cli('group','add','Studio');const employee=await f.create('Mira','Studio')
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}})
 const watch=p=>{p.on('pageerror',error=>errors.push(error.message));p.on('websocket',socket=>socket.on('close',()=>closed.push(p===page?'original':'copy')));p.setDefaultTimeout(12000)}
 page=await context.newPage();watch(page);await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await expect(page.locator('.web-connection')).toContainText('Connected to Core')
 const rpc=(p,cmd,args={})=>p.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await rpc(page,'view.open',{kind:'employee',employee:employee.id});await page.getByRole('button',{name:'Edit profile',exact:true}).click();await page.locator('input[name=title]').fill('Unsaved original profile')
 const original=await page.evaluate(()=>sessionStorage.getItem('agents-company-client'))
 const popup=context.waitForEvent('page');await page.evaluate(()=>window.open(location.href,'aexus-duplicate-fixture'));copy=await popup;watch(copy);await copy.waitForLoadState();await expect(copy.locator('.web-connection')).toContainText('Connected to Core')
 await expect.poll(()=>copy.evaluate(()=>sessionStorage.getItem('agents-company-client')),{message:'duplicated live tabs must have separate client identities',timeout:6000}).not.toBe(original)
 await expect(page.locator('input[name=title]')).toHaveValue('Unsaved original profile');await expect(page.locator('.web-connection')).toContainText('Connected to Core');assert.equal(closed.filter(value=>value==='original').length,0,'the original page is never displaced')
 await copy.getByRole('button',{name:'Mission',exact:true}).click();await expect(copy.locator('.plan-view')).toBeVisible();await expect(page.locator('input[name=title]')).toHaveValue('Unsaved original profile')
 const rejected=await page.evaluate(async()=>{try{await window.agents.call('view.select',{id:'plan'});return ''}catch(error){return error.message}});assert.match(rejected,/profile|unsaved/i)
 const copyId=await copy.evaluate(()=>sessionStorage.getItem('agents-company-client'));await copy.reload();await expect(copy.locator('.plan-view')).toBeVisible();assert.equal(await copy.evaluate(()=>sessionStorage.getItem('agents-company-client')),copyId,'ordinary reload retains its client identity and route')
 assert.equal((await f.cli('session','list')).sessions.find(value=>value.id===employee.id).title,'Mira');assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['duplicated tabs acquire independent client identities without displacing the original','navigation and unsaved-profile guards stay with the intended page','ordinary reload retains its client identity and route'],errors,paidModelCalls:0,productionDataUsed:false},null,2));console.log('PASS Web tabs: independent identities, navigation, unsaved guards and stable reload')
}catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,closed,errors},null,2));throw error}finally{await browser?.close();await f.close()}
