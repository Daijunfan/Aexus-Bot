import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
const portProbe=net.createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r))
const bots=[{id:'dot',name:'Dot',provider:'dots',kind:'private'},{id:'grok',name:'Grok Bot',provider:'grok',kind:'private',grokShape:'blob',grokColor:'black'}],history=new Map(bots.map(b=>[b.id,[]])),errors=[]
const issues=new Map()
const source=http.createServer(async(req,res)=>{try{let text='';for await(const b of req)text+=b;const q=JSON.parse(text),a=q.args;let result;if(q.method==='list')result=bots.filter(b=>b.provider===a.provider);else if(q.method==='status')result={issue:issues.get(a.binding.remoteId)??null,checkedAt:Date.now()};else if(q.method==='messages')result=history.get(a.binding.remoteId);else if(q.method==='send'){history.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:Date.now(),files:[]});result={id:a.requestId,accepted:true}}else throw Error('Unexpected appearance fixture method');res.setHeader('content-type','application/json');res.end(JSON.stringify(result))}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}))}});await new Promise(r=>source.listen(0,'127.0.0.1',r))
let f,browser
try{
 f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port),AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+source.address().port})
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/dot-native/web');fs.mkdirSync(out,{recursive:true})
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('settings.set',{language:'en'});await rpc('bot.sync');const list=await rpc('bot.list'),dot=list.find(b=>b.bot.provider==='dots'),grok=list.find(b=>b.bot.provider==='grok')
 browser=await chromium.launch({headless:true,...(!fs.existsSync(chromium.executablePath())?{channel:'chrome'}:{})});const page=await browser.newPage({viewport:{width:1350,height:1000},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await page.locator('.company-navigation').waitFor()
 await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.locator(`.message-contact[data-chat="${grok.id}"]`).click()
 await expect(page.locator('.bot-header-avatar .grok-native-avatar svg')).toBeVisible()
 const idlePixels=await page.locator('.bot-header-avatar .grok-native-avatar').screenshot(),{data:pixels,info}=await sharp(idlePixels).removeAlpha().raw().toBuffer({resolveWithObject:true});let left=info.width,right=0
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;if((pixels[i]+pixels[i+1]+pixels[i+2])/3<130){left=Math.min(left,x);right=Math.max(right,x)}}
 assert.ok((right-left+1)/info.width>.86,'The actual Grok figure must fill the avatar, not just its SVG element')
 await page.locator('.group-compose-box textarea').fill('A synthetic animation test.');await page.locator('.group-compose-box textarea').press('Enter')
 await expect(page.locator('.bot-header-avatar .grok-native-avatar')).toHaveAttribute('data-native-state','thinking')
 const avatar=page.locator('.bot-header-avatar .grok-native-avatar'),first=await avatar.screenshot();await page.waitForTimeout(700);const second=await avatar.screenshot();assert.notEqual(createHash('sha256').update(first).digest('hex'),createHash('sha256').update(second).digest('hex'),'Native Grok thinking animation must advance')
 await page.screenshot({path:path.join(out,'grok-native-thinking.png')})
 await page.locator('.message-contact[data-chat="'+dot.id+'"]').click();const native=page.locator('.bot-header-avatar .dot-native-avatar');await expect(native).toHaveAttribute('data-native-character','codey');assert.equal((await rpc('bot.appearance',{id:dot.id})).editable,false)
 const saved=await rpc('avatar.get',{id:'codex'});await rpc('avatar.update',{id:'codex',enabled:false,expectedRevision:saved.revision});await expect(native).toHaveAttribute('data-native-character','codey')
 await page.locator('.group-compose-box textarea').fill('A native Dot animation test.');await page.locator('.group-compose-box textarea').press('Enter');await expect(native).toHaveAttribute('data-native-state','working');const frame=await native.getAttribute('data-native-frame');await expect.poll(()=>native.getAttribute('data-native-frame')).not.toBe(frame);const firstDot=await native.screenshot();await page.waitForTimeout(280);const secondDot=await native.screenshot();assert.notEqual(createHash('sha256').update(firstDot).digest('hex'),createHash('sha256').update(secondDot).digest('hex'));await page.screenshot({path:path.join(out,'dot-native-codey.png')})
 await page.emulateMedia({reducedMotion:'reduce'});await expect(native).not.toHaveAttribute('data-native-playing','true');const still=await native.getAttribute('data-native-frame');await page.waitForTimeout(300);assert.equal(await native.getAttribute('data-native-frame'),still);await page.emulateMedia({reducedMotion:'no-preference'})
 await page.getByRole('button',{name:'Dot native appearance',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Dot native appearance',exact:true});await expect(dialog.locator('.dot-native-avatar')).toBeVisible();await expect(dialog).toContainText('Codey');assert.equal(await dialog.locator('.character-picker').count(),0);await page.screenshot({path:path.join(out,'dot-native-preview.png')});await page.keyboard.press('Escape')
 await page.reload();await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.locator('.message-contact[data-chat="'+dot.id+'"]').click();await expect(native).toHaveAttribute('data-native-character','codey')
 await page.setViewportSize({width:720,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'narrow-dot.png')});assert.deepEqual(errors,[])
 const quota={code:'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT',message:'Your Grok Bot usage limit has been reached',at:Date.now(),retryAt:Date.now()+86400000};issues.set(grok.bot.remoteId,quota);await rpc('bot.sync')
 const grokContact=page.locator('.message-contact[data-chat="'+grok.id+'"]');if(!await grokContact.isVisible())await page.locator('.message-back').click();await grokContact.click()
 const notice=page.locator('.group-conversation>.bot-issue-notice');await expect(notice).toContainText('Grok usage limit reached');await expect(notice.locator('time')).toHaveAttribute('datetime',new Date(quota.retryAt).toISOString());await expect(page.locator('.bot-waiting')).toHaveCount(0)
 const draft='Web quota draft stays here';await page.locator('.group-compose-box textarea').fill(draft);await page.locator('.group-compose-box textarea').press('Enter');await expect(page.locator('.group-error[role=alert]')).toContainText('usage limit');await expect(page.locator('.group-compose-box textarea')).toHaveValue(draft)
 await page.reload();await page.locator('.company-navigation').waitFor();await expect(notice).toBeVisible();await expect(page.locator('.group-compose-box textarea')).toHaveValue(draft)
 await rpc('settings.set',{language:'zh-CN',viewAppearance:{messages:{theme:'violet'}}});await expect(notice).toContainText('Grok 本期额度已用尽');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'grok-quota-web.png')})
 issues.clear();await rpc('bot.sync');await expect(notice).toHaveCount(0)
 await page.locator('.group-compose-box textarea').press('Enter');await expect(page.locator('.group-compose-box textarea')).toHaveValue('');assert.equal(history.get(grok.bot.remoteId).filter(m=>m.text===draft).length,1)
 console.log('PASS Web: Grok quota/reset state, preserved draft after rejected dispatch and reload, no endless waiting, recovery, localized narrow layout')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,actualBrowser:true,originalGrokRenderer:true,thinkingFramesChanged:true,nativeDotCodeySurvivedReload:true,grokQuotaRecovery:true,reducedMotionVerified:true,catalogIndependent:true,narrowWidth:720,errors,productionDataUsed:false},null,2));console.log('PASS actual authenticated Web: original Grok and Codey animation frames advance, native Dot survives catalog archiving/reload, reduced motion pauses playback, and 720px layout fits')
}finally{await browser?.close();await f?.close();source.closeAllConnections();await new Promise(r=>source.close(r))}
