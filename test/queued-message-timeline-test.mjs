// Authenticated Core, deterministic fixture and real Electron/Web renderer; zero paid model calls.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/queued-message-timeline/'+mode)
fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'result.json'),{force:true})
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))

let f,app,browser,page
const errors=[],checks=[]
const pass=label=>{checks.push(label);console.log('PASS '+mode+': '+label)}

try{
  const application=process.env.AGENTS_COMPANY_TEST_APP
  f=await fixtureCore({
    ...(application?{AGENTS_COMPANY_BUILTIN_PLUGINS:path.join(application,'Contents/Resources/plugins')}:{}),
    ...(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{}),
  })
  const core=async(cmd,args={},auth=null)=>{const value=await f.request(auth,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
  await core('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'},plan:{theme:'white'}}})
  const employee=await core('card.create',{title:'Queue Timeline',folderName:'queue-timeline',engine:'codex',model:'gpt-6-luna',effort:'low'})
  await f.ready(employee.id)
  const employeeToken=await f.token(employee.id)
  for(const row of await core('session.status'))if(row.sessionId)await core('session.close',{id:row.sessionId})

  if(web){
    browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})})
    page=await browser.newPage({viewport:{width:1440,height:960}})
    await page.goto('http://127.0.0.1:'+port)
    await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim())
    await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
  }else{
    await f.stop()
    const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'960'}
    delete env.ELECTRON_RUN_AS_NODE
    app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env})
    page=await app.firstWindow()
  }

  page.setDefaultTimeout(20000)
  page.on('pageerror',error=>errors.push(error.message))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('.company-navigation').waitFor()

  const rpc=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(error){throw Error(cmd+': '+(error?.message??JSON.stringify(error)))}},{cmd,args})
  const input=page.locator('.message-conversation .composer textarea')
  const transcript=page.locator('.message-conversation .transcript')
  const queue=page.locator('.message-conversation .task-queue')
  const rows=queue.locator('li')
  const snippet=page.locator('.message-contact[data-employee="'+employee.id+'"] .message-snippet')
  const inboxText=async()=>((await core('session.inbox')).find(item=>item.employeeId===employee.id))?.text

  await rpc('view.open',{kind:'messages',employee:employee.id})
  await expect(input).toBeEnabled()

  // 1. Send Message 1 while holding execution busy.
  fs.writeFileSync(path.join(f.control,employee.id+'.hold-user'),'')
  await input.fill('Message 1')
  await page.locator('.message-conversation').getByRole('button',{name:'Send message',exact:true}).click()
  await expect(input).toHaveValue('')
  await expect(transcript.locator('.turn.user')).toHaveCount(1)
  await expect(transcript.locator('.turn.user').first()).toContainText('Message 1')
  await expect(page.locator('.message-conversation .send-btn.stop')).toBeVisible()
  await expect.poll(inboxText).toBe('Message 1')
  pass('Initial direct message appears in timeline and inbox summary while employee stays busy')

  // 2. Queue Message 2 and Message 3 while busy: show only in Up next, never as sent bubbles.
  await input.fill('Message 2')
  await page.locator('.message-conversation').getByRole('button',{name:'Queue message',exact:true}).click()
  await expect(input).toHaveValue('')
  await input.fill('Message 3')
  await page.locator('.message-conversation').getByRole('button',{name:'Queue message',exact:true}).click()
  await expect(input).toHaveValue('')
  await expect(queue.locator('.task-queue-count')).toHaveText('2')
  await expect(rows.nth(0)).toContainText('Message 2')
  await expect(rows.nth(1)).toContainText('Message 3')
  await expect(transcript.locator('.turn.user')).toHaveCount(1)
  await expect(transcript.locator('.direct-delivery[data-state="queued"]')).toHaveCount(0)
  await expect(transcript).not.toContainText('Message 2')
  await expect(transcript).not.toContainText('Message 3')
  assert.equal(await inboxText(),'Message 1')
  pass('Queued follow-up messages appear only in Up next and never render as sent bubbles or inbox snippets')

  // 3. Cancel Message 3 from Up next: stays hidden in UI timeline while direct.history records interrupted.
  await rows.nth(1).getByRole('button',{name:'Remove queued message',exact:true}).click()
  await expect(queue.locator('.task-queue-count')).toHaveText('1')
  await expect(rows).toHaveCount(1)
  await expect(transcript.locator('.turn.user')).toHaveCount(1)
  await expect(transcript.locator('.direct-delivery[data-state="interrupted"]')).toHaveCount(0)
  await expect(transcript).not.toContainText('Message 3')
  assert.equal(await inboxText(),'Message 1')
  await expect.poll(async()=>{
    const history=await core('direct.history',{employee:employee.id,limit:50})
    return history.items.find(item=>item.text==='Message 3')?.delivery?.state
  }).toBe('interrupted')
  pass('Removing queued message drops it from Up next without leaving an interrupted bubble in timeline')

  // 4. Publish Reply 1 while Message 2 is still queued.
  await core('direct.post',{text:'Reply 1',clientMessageId:'reply-1'},employeeToken)
  await expect(transcript.locator('.turn')).toHaveCount(2)
  await expect(transcript.locator('.turn').nth(0)).toContainText('Message 1')
  await expect(transcript.locator('.turn').nth(1)).toContainText('Reply 1')
  await expect(queue.locator('.task-queue-count')).toHaveText('1')
  await expect.poll(inboxText).toBe('Reply 1')
  pass('Published reply renders after Message 1 while Message 2 remains solely in Up next')

  // 5. Release Message 1 while holding Message 2 on execution so Message 2 dispatches in chronological order.
  fs.writeFileSync(path.join(f.control,employee.id+'.hold-text'),'Message 2')
  fs.unlinkSync(path.join(f.control,employee.id+'.hold-user'))
  await expect(queue).toHaveCount(0)
  await expect(transcript.locator('.turn')).toHaveCount(3)
  await expect(transcript.locator('.turn').nth(0)).toContainText('Message 1')
  await expect(transcript.locator('.turn').nth(1)).toContainText('Reply 1')
  await expect(transcript.locator('.turn').nth(2)).toContainText('Message 2')
  await expect.poll(inboxText).toBe('Message 2')

  const orderedHistory=await core('direct.history',{employee:employee.id,limit:50})
  const replyEntry=orderedHistory.items.find(item=>item.role==='assistant'&&item.blocks?.some(b=>b.text==='Reply 1'))
  const dispatchedEntry=orderedHistory.items.find(item=>item.role==='user'&&item.text==='Message 2')
  assert.ok(replyEntry&&dispatchedEntry)
  assert.equal(dispatchedEntry.delivery?.state,'accepted')
  assert.ok(dispatchedEntry.directSequence>replyEntry.directSequence,'dispatched sequence must advance past Reply 1')
  assert.ok(dispatchedEntry.createdAt>=replyEntry.createdAt,'dispatched createdAt must advance past Reply 1')
  pass('Dispatched queued message moves into timeline and inbox after Reply 1 in exact chronological order')

  // 6. Queue Message 4 while Message 2 is held running, then click Stop.
  await input.fill('Message 4')
  await page.locator('.message-conversation').getByRole('button',{name:'Queue message',exact:true}).click()
  await expect(queue.locator('.task-queue-count')).toHaveText('1')
  await expect(transcript.locator('.turn')).toHaveCount(3)
  await page.locator('.message-conversation .send-btn.stop').click()
  await expect(queue).toHaveCount(0)
  await expect(page.locator('.message-conversation .send-btn.stop')).toHaveCount(0)
  await expect(transcript.locator('.turn')).toHaveCount(3)
  await expect(transcript).not.toContainText('Message 4')
  await expect(snippet).toContainText('Message 2')
  assert.equal(await inboxText(),'Message 2')
  await expect.poll(async()=>(await core('direct.history',{employee:employee.id,limit:50})).items.find(item=>item.text==='Message 4')?.delivery?.state).toBe('interrupted')
  const searchRemoved=await core('direct.search',{employee:employee.id,query:'Message 3'})
  assert.equal(searchRemoved.total,0)
  const searchStopped=await core('direct.search',{employee:employee.id,query:'Message 4'})
  assert.equal(searchStopped.total,0)
  pass('Stop clears the queue without showing cancelled items as chat bubbles or search hits')

  fs.rmSync(path.join(f.control,employee.id+'.hold-text'),{force:true})
  if(app)assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
  assert.deepEqual(errors,[])
  await page.screenshot({path:path.join(out,'queued-timeline.png'),animations:'disabled'})
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,errors,paidModelCalls:0},null,2)+'\n')
}catch(error){
  await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{})
  throw error
}finally{
  await app?.close()
  await browser?.close()
  await f?.close()
}
