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
const source=http.createServer(async(req,res)=>{try{let text='';for await(const b of req)text+=b;const q=JSON.parse(text),a=q.args;let result;if(q.method==='list')result=bots.filter(b=>b.provider===a.provider);else if(q.method==='messages')result=history.get(a.binding.remoteId);else if(q.method==='send'){history.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:Date.now(),files:[]});result={id:a.requestId,accepted:true}}else throw Error('Unexpected appearance fixture method');res.setHeader('content-type','application/json');res.end(JSON.stringify(result))}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}))}});await new Promise(r=>source.listen(0,'127.0.0.1',r))
let f,browser
try{
 f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port),AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+source.address().port})
 const out=path.join(f.root,'artifacts/native-engine-audit-2026-11-06/web');fs.mkdirSync(out,{recursive:true})
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await rpc('settings.set',{language:'en'});await rpc('bot.sync');const list=await rpc('bot.list'),dot=list.find(b=>b.bot.provider==='dots'),grok=list.find(b=>b.bot.provider==='grok')
 browser=await chromium.launch({headless:true,...(!fs.existsSync(chromium.executablePath())?{channel:'chrome'}:{})});const page=await browser.newPage({viewport:{width:1350,height:1000},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click();await page.locator('.infinite-canvas').waitFor()
 await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.locator(`.message-contact[data-chat="${grok.id}"]`).click()
 await expect(page.locator('.bot-header-avatar .grok-native-avatar svg')).toBeVisible()
 const idlePixels=await page.locator('.bot-header-avatar .grok-native-avatar').screenshot(),{data:pixels,info}=await sharp(idlePixels).removeAlpha().raw().toBuffer({resolveWithObject:true});let left=info.width,right=0
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;if((pixels[i]+pixels[i+1]+pixels[i+2])/3<130){left=Math.min(left,x);right=Math.max(right,x)}}
 assert.ok((right-left+1)/info.width>.86,'The actual Grok figure must fill the avatar, not just its SVG element')
 await page.locator('.group-compose-box textarea').fill('A synthetic animation test.');await page.locator('.group-compose-box textarea').press('Enter')
 await expect(page.locator('.bot-header-avatar .grok-native-avatar')).toHaveAttribute('data-native-state','thinking')
 const avatar=page.locator('.bot-header-avatar .grok-native-avatar'),first=await avatar.screenshot();await page.waitForTimeout(700);const second=await avatar.screenshot();assert.notEqual(createHash('sha256').update(first).digest('hex'),createHash('sha256').update(second).digest('hex'),'Native Grok thinking animation must advance')
 await page.screenshot({path:path.join(out,'grok-native-thinking.png')})
 await page.locator(`.message-contact[data-chat="${dot.id}"]`).click();await page.getByRole('button',{name:'Change bot character',exact:true}).click();const dialog=page.locator('.character-picker')
 await expect(dialog.locator('.character-stage .fate-pet')).toBeVisible();assert.ok(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+8,r.top+r.height/2)?.closest('.character-picker')===el}),'The whole character dialog must sit above the sidebar');await dialog.getByRole('button',{name:'远坂凛 · 可爱版',exact:true}).click();await dialog.getByRole('button',{name:'Use character',exact:true}).click();await expect(dialog).toHaveCount(0)
 await page.reload();await page.locator('.company-navigation').getByRole('button',{name:'Message',exact:true}).click();await page.locator(`.message-contact[data-chat="${dot.id}"]`).click();await expect(page.locator('.bot-header-avatar [data-portrait="fate-rin-chibi"]')).toBeVisible()
 await page.getByRole('button',{name:'Change bot character',exact:true}).click();await expect(dialog.getByRole('button',{name:'远坂凛 · 可爱版',exact:true})).toHaveAttribute('aria-pressed','true');await page.screenshot({path:path.join(out,'dot-character-picker.png')});await dialog.getByRole('button',{name:'Close character picker',exact:true}).click()
 await page.setViewportSize({width:720,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'narrow-dot.png')});assert.deepEqual(errors,[])
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,actualBrowser:true,originalGrokRenderer:true,thinkingFramesChanged:true,dotSelectionSurvivedReload:true,narrowWidth:720,errors,productionDataUsed:false},null,2));console.log('PASS actual authenticated Web: original Grok animation advances, Dot character changes persist after reload, and 720px layout stays within the viewport')
}finally{await browser?.close();await f?.close();source.closeAllConnections();await new Promise(r=>source.close(r))}
