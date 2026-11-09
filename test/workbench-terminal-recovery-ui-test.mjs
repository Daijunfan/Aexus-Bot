import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
const home=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-shell-home-')),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/product-polish-v2/shell');fs.mkdirSync(out,{recursive:true})
const f=await fixtureCore({HOME:home,SHELL:'/bin/bash',HISTFILE:'/dev/null',BASH_SILENCE_DEPRECATION_WARNING:'1',AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)})
let browser,page;const errors=[],checks=[],pass=value=>{checks.push(value);console.log('PASS '+value)}
try{
 await f.cli('settings','set','--language','en');await f.cli('group','add','Studio');const employee=await f.create('Mira','Studio')
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
 await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await expect(page.locator('.web-connection')).toContainText('Connected to Core')
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await rpc('view.open',{kind:'conversation',employee:employee.id});const shell=page.locator('.employee-terminal'),keyboard=shell.locator('.xterm-helper-textarea');await expect(keyboard).toBeAttached();await expect(shell.locator('.xterm-screen')).toContainText('$')
 const geometry=()=>shell.locator('.terminal-screen').evaluate(element=>{const screen=element.querySelector('.xterm-screen').getBoundingClientRect(),box=element.getBoundingClientRect();return {fits:screen.bottom<=box.bottom+1&&screen.right<=box.right+1,height:screen.height,available:box.height}});await expect.poll(async()=>(await geometry()).fits).toBe(true)
 let release,arrive;const wait=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>arrive=resolve),packets=[]
 const gate=async route=>{const request=route.request().postDataJSON();if(request.cmd==='terminal.input'){packets.push(request.args.data);if(request.args.data==='p'){arrive();await wait}}await route.continue()};await page.route('**/api/rpc',gate)
 await keyboard.focus();const command='printf abc > shell-order.txt';await page.keyboard.type(command);await page.keyboard.press('Enter');await entered;assert.deepEqual(packets,['p']);assert.equal(fs.existsSync(path.join(employee.cwd,'shell-order.txt')),false)
 const prior=await rpc('terminal.list',{employee:employee.id});await shell.getByRole('button',{name:'New terminal',exact:true}).click();assert.equal((await rpc('terminal.list',{employee:employee.id})).length,prior.length,'changing tabs waits for pending keyboard input')
 release();await expect.poll(()=>fs.existsSync(path.join(employee.cwd,'shell-order.txt'))&&fs.readFileSync(path.join(employee.cwd,'shell-order.txt'),'utf8')).toBe('abc');await expect(shell.locator('nav button')).toHaveCount(2);assert.equal(packets.join(''),command+'\r');await page.unroute('**/api/rpc',gate);pass('Workbench input is ordered and acknowledged; opening another terminal waits for the full command')
 await expect(keyboard).toBeAttached();let lose=true;const delivered=[]
 const lost=async route=>{const request=route.request().postDataJSON();if(request.cmd==='terminal.input'){delivered.push(request.args.data);if(lose){lose=false;await route.fetch();await route.fulfill({status:503,json:{ok:false,error:'Shell acknowledgement lost'}});return}}await route.continue()};await page.route('**/api/rpc',lost)
 await keyboard.focus();await page.keyboard.type('xyz');await expect(shell.locator('.native-terminal-error')).toContainText('Input could not be confirmed');assert.deepEqual(delivered,['x']);await shell.getByRole('button',{name:'Reconnect terminal',exact:true}).click();await expect(shell.locator('.native-terminal-error')).toHaveCount(0);assert.deepEqual(delivered,['x'],'reconnect never replays uncertain input');await page.unroute('**/api/rpc',lost)
 await keyboard.focus();await page.keyboard.press('Control+u');await page.keyboard.type('printf recovered > shell-recovered.txt');await page.keyboard.press('Enter');await expect.poll(()=>fs.existsSync(path.join(employee.cwd,'shell-recovered.txt'))&&fs.readFileSync(path.join(employee.cwd,'shell-recovered.txt'),'utf8')).toBe('recovered');pass('Uncertain shell input pauses later keys; reconnect permits deliberate recovery without replay')
 await expect.poll(async()=>(await geometry()).fits).toBe(true);await page.screenshot({path:path.join(out,'completed.png'),animations:'disabled'});pass('The actual terminal rows fit inside the viewport with the native footer visible')
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,paidModelCalls:0,productionDataUsed:false},null,2))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error}finally{await browser?.close();await f.close();fs.rmSync(home,{recursive:true,force:true})}
