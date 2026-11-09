// Real Core membership changes and rendered portrait geometry; disposable state only.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/group-avatar-grid/'+mode)
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'verification.json'),{force:true})
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,app,browser,page;const checks=[],errors=[],measurements=[]
try{
 f=await fixtureCore(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})
 const core=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
 await core('settings.set',{language:'en',viewAppearance:{messages:{theme:'violet'}},messageWallpaper:{palette:'theme',pattern:'telegram'}});await core('group.add',{name:'Studio'})
 const cards=[],avatars=(await core('avatar.list')).slice(0,5).map(item=>item.id);assert.equal(avatars.length,5)
 for(const [index,name] of ['Mira','Rowan','Lin','Aster','Jules'].entries()){const card=await f.create(name,'Studio');await core('card.avatar',{id:card.id,avatar:avatars[index]});cards.push(card)}
 for(const session of await core('session.status'))if(session.sessionId)await core('session.close',{id:session.sessionId})
 let group=await core('chat.create',{name:'Team portraits',members:cards.map(card=>card.id)})
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.company-navigation')).toBeVisible()
 const rpc=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args}),shot=async name=>page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'})
 await rpc('view.open',{kind:'messages',chatId:group.id})
 const measure=async(locator,count,label)=>{
  const expected=Math.min(count,4);await expect(locator.locator('[data-group-avatar-member]')).toHaveCount(expected)
  await expect.poll(()=>locator.locator('img').evaluateAll(images=>images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true)
  const value=await locator.evaluate(node=>{const box=node.getBoundingClientRect();return {box:{left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height},cells:[...node.querySelectorAll(':scope>.group-avatar-cell')].map(cell=>{const rect=cell.getBoundingClientRect(),portrait=cell.querySelector('.message-avatar').getBoundingClientRect();return {id:cell.dataset.groupAvatarMember,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,portrait:{left:portrait.left,top:portrait.top,right:portrait.right,bottom:portrait.bottom},avatar:cell.querySelector('[data-portrait]').dataset.portrait}})}})
  assert.deepEqual(value.cells.map(cell=>cell.id),cards.slice(0,expected).map(card=>card.id),label+' uses actual group members in their stable order')
  for(const cell of value.cells){assert.ok(cell.width>0&&cell.height>0);assert.ok(cell.left>=value.box.left-1&&cell.top>=value.box.top-1&&cell.right<=value.box.right+1&&cell.bottom<=value.box.bottom+1,label+' cell stays inside avatar');assert.ok(cell.portrait.left>=cell.left-1&&cell.portrait.top>=cell.top-1&&cell.portrait.right<=cell.right+1&&cell.portrait.bottom<=cell.bottom+1,label+' portrait never grows to single-person size');if(expected>1)assert.ok(cell.width<=value.box.width/2+1&&cell.height<=value.box.height/2+1)}
  for(let i=0;i<value.cells.length;i++)for(let j=i+1;j<value.cells.length;j++){const a=value.cells[i],b=value.cells[j];assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,label+' portraits never overlap')}
  if(expected===4){assert.equal(new Set(value.cells.map(cell=>Math.round(cell.left))).size,2);assert.equal(new Set(value.cells.map(cell=>Math.round(cell.top))).size,2)}
  measurements.push({label,count,...value})
 }
 for(const count of [1,2,3,4,5,2]){
  group=await rpc('chat.update',{id:group.id,members:cards.slice(0,count).map(card=>card.id),expectedRevision:group.revision})
  await measure(page.locator('.message-contact[data-chat="'+group.id+'"]>.group-avatar'),count,'sidebar-'+count)
  await measure(page.locator('.message-thread-header .group-avatar'),count,'header-'+count)
  await measure(page.locator('.group-empty>.group-avatar'),count,'welcome-'+count)
  await shot('members-'+count)
 }
 checks.push('One member uses their own portrait; two, three and four show separate faces; larger groups show exactly four in a 2×2 grid; membership changes refresh all sizes')
 group=await rpc('chat.update',{id:group.id,members:cards.slice(0,4).map(card=>card.id),expectedRevision:group.revision});await rpc('card.avatar',{id:cards[0].id,avatar:avatars[2]});await expect(page.locator('.message-thread-header [data-group-avatar-member="'+cards[0].id+'"] [data-portrait]')).toHaveAttribute('data-portrait',avatars[2]);checks.push('Changing an employee portrait updates the composite without replacing member identities')
 await shot('group-grid-final');if(web){await page.setViewportSize({width:420,height:900});await measure(page.locator('.message-thread-header .group-avatar'),4,'narrow-header');await shot('group-grid-narrow')}
 assert.deepEqual(errors,[]);if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,mode,checks,measurements,errors,paidModelCalls:0,productionDataUsed:false},null,2));checks.forEach(text=>console.log('PASS '+mode+': '+text))
}catch(error){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error}finally{await app?.close();await browser?.close();await f?.close()}
