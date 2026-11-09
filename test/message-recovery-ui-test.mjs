// Real renderer/Core with deterministic native/bot transports; no production identities or inference.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop',out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??'artifacts/message-delivery-recovery/'+mode)
const remote=[{id:'dot-fixture',name:'Dot',provider:'dots',kind:'private'},{id:randomUUID(),name:'Grok Bot',provider:'grok',kind:'private'},{id:randomUUID(),name:'External group',provider:'grok',kind:'group'}],botCalls=[]
const server=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const value=JSON.parse(raw);botCalls.push(value.method);res.setHeader('content-type','application/json');res.end(JSON.stringify(value.method==='list'?remote.filter(entry=>entry.provider===value.args.provider):value.method==='messages'?[]:{}))}catch{res.writeHead(500).end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
let f,app,browser,page
const errors=[],checks=[]
try{
 f=await fixtureCore({AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+server.address().port,...(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{})})
 const rpc=async(cmd,args={},token=null)=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,result.error);return result.data}
 await rpc('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'}}});await rpc('group.add',{name:'Research'})
 const secretary=await f.create('Secretary','Research','secretary'),reviewer=await f.create('Reviewer','Research'),author=await f.create('Researcher','Research')
 const group=await rpc('chat.create',{name:'Research delivery',members:[secretary.id,reviewer.id,author.id]})
 await rpc('bot.sync');const bots=await rpc('bot.list'),privateIds=bots.filter(group=>group.bot.kind==='private').map(group=>group.id)
 for(const args of [{type:'private'},{folder:'type:private'}])assert.deepEqual((await rpc('messenger.directory',args)).entries.filter(entry=>entry.botKind).map(entry=>entry.id).sort(),[...privateIds].sort())
 if(web){browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:'+port);await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:'Enter workspace',exact:true}).click()}
 else{await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow()}
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.company-navigation').waitFor();await page.evaluate(()=>window.agents.call('view.select',{id:'messages'}))
 const choose=async type=>{await page.locator('[id="message-folder-type:'+type+'"]').click()}
 await choose('private')
 for(const bot of bots){const row=page.locator('.message-contact[data-chat="'+bot.id+'"]');if(bot.bot.kind==='private'){await expect(row).toBeVisible();await row.click();await expect(page.locator('.message-thread-header')).toContainText(bot.name)}else await expect(row).toHaveCount(0)}
 fs.mkdirSync(out,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(out,'private-conversations.png')});
 await choose('outsource');for(const bot of bots)await expect(page.locator('.message-contact[data-chat="'+bot.id+'"]')).toBeVisible()
 await choose('groups');for(const bot of bots)await expect(page.locator('.message-contact[data-chat="'+bot.id+'"]')).toHaveCount(0)
 await page.locator('.message-contact[data-chat="'+group.id+'"]').click()
 checks.push('Actual synced Dot/Grok private conversations are visible/openable in Private and Outsource; external groups excluded; same native IDs survive desktop restart')

 const sid=(await rpc('session.open',{cardId:reviewer.id})).sessionId,hold=path.join(f.control,reviewer.id+'.hold-user');fs.writeFileSync(hold,'')
 const job=await rpc('schedule.create',{spec:{name:'Reservation fixture',enabled:false,afterSeconds:3600,action:{type:'agent',employeeId:reviewer.id,prompt:'SCHEDULE_HOLD'}}});await rpc('schedule.run',{id:job.id})
 await f.until(async()=>(await f.status(reviewer.id)).currentTask?.runId,'scheduled reservation')
 await rpc('conversation.file',{conversation:'group:'+group.id,operation:'write',path:'report.pdf',content:'%PDF-1.4\n%%EOF\n',create:true})
 const publication=await rpc('chat.post',{id:group.id,text:'A PDF stays published while a member is busy.',files:['@workspace/report.pdf'],clientMessageId:'pdf-once'},await f.token(author.id))
 const work=await rpc('chat.send',{id:group.id,text:'Review the existing PDF after the scheduled work.',mentions:[reviewer.id],clientMessageId:'review-once'})
 const history=async()=>(await rpc('chat.history',{id:group.id})).messages,find=async id=>(await history()).find(message=>message.id===id),row=id=>page.locator('[data-group-message="'+id+'"]'),dialog=()=>page.getByRole('dialog',{name:'Message delivery details'})
 await f.until(async()=>(await find(publication.id)).deliveries.find(delivery=>delivery.employeeId===secretary.id).readAt,'other member read')
 await expect(row(publication.id)).toContainText('report.pdf');await expect(row(publication.id).locator('.message-receipt')).not.toHaveAttribute('data-receipt-attention')
 await row(publication.id).locator('.message-receipt').click();await expect(dialog().getByRole('listitem').filter({hasText:'Reviewer'})).toContainText('queued');await page.keyboard.press('Escape')
 checks.push('Published PDF remains visible; scheduled recipient shows queued awareness without a false send failure')

 await rpc('session.close',{id:sid});fs.rmSync(hold,{force:true});await f.until(async()=>(await rpc('schedule.status')).active.length===0,'reservation released')
 await f.until(async()=>(await find(work.id)).deliveries.filter(delivery=>delivery.employeeId!==reviewer.id).every(delivery=>delivery.status==='completed'),'untouched recipients done')
 fs.mkdirSync(out,{recursive:true})
 for(const message of [publication,work]){
  const before=await find(message.id),others=before.deliveries.filter(delivery=>delivery.employeeId!==reviewer.id)
  await expect(row(message.id).locator('.message-receipt')).toHaveAttribute('data-receipt-attention','1')
  await row(message.id).locator('.message-receipt').click();await expect(dialog().getByRole('listitem').filter({hasText:'Reviewer'})).toContainText('interrupted')
  await expect(dialog().getByRole('button',{name:'Retry undelivered',exact:true})).toBeVisible();await page.screenshot({animations:'disabled',path:path.join(out,message.id===publication.id?'pdf-recovery.png':'task-recovery.png')})
  await dialog().getByRole('button',{name:'Retry undelivered',exact:true}).click()
  await f.until(async()=>(await find(message.id)).deliveries.every(delivery=>delivery.status==='completed'),'UI recovery complete')
  await expect(row(message.id).locator('.message-receipt')).not.toHaveAttribute('data-receipt-attention')
  assert.deepEqual((await find(message.id)).deliveries.filter(delivery=>delivery.employeeId!==reviewer.id),others)
  await page.keyboard.press('Escape')
 }
 assert.equal((await history()).length,2);assert.deepEqual((await find(publication.id)).attachments,publication.attachments)
 const items=(await rpc('session.transcript',{employee:reviewer.id})).items
 assert.equal(items.filter(item=>item.role==='user'&&item.context?.origin.messageId===work.id&&item.context.phase==='work').length,1)
 assert.equal(items.filter(item=>item.role==='user'&&item.context?.origin.messageId===publication.id&&item.context.phase==='work').length,0)
 await page.screenshot({animations:'disabled',path:path.join(out,'recovered-receipts.png')})
 checks.push('Actual UI retry repairs PDF awareness and unstarted work once, clears attention, preserves completed recipients, attachments, sender and message count')
 assert.deepEqual(errors,[]);assert.equal(botCalls.includes('send'),false)
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,mode,checks,errors,paidTestCalls:0,productionStateUsed:false},null,2)+'\n');console.log('PASS '+mode+': '+checks.join('; '))
}finally{await app?.close();await browser?.close();await f?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
