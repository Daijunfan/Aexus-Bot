// Opt-in native inference in the signed-in Ego Browser, with isolated Aexus state.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'

if(process.env.AEXUS_CHATGPT_LIVE!=='1')throw Error('Set AEXUS_CHATGPT_LIVE=1 to authorize the native ChatGPT smoke test')
const root=path.resolve(import.meta.dirname,'..')
const require=createRequire(import.meta.url)
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??path.join(root,'artifacts/chatgpt-live'))
fs.mkdirSync(out,{recursive:true})
let fixture,app
try{
  fixture=await fixtureCore({AGENTS_COMPANY_PACKAGE_ROOT:root})
  await fixture.stop()
  const env={...fixture.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'}
  delete env.ELECTRON_RUN_AS_NODE
  app=await electron.launch({executablePath:require('electron'),args:[root],env})
  const page=await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror',error=>console.error('Renderer:',error.message))
  const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
  await page.locator('.infinite-canvas').waitFor()
  await call('settings.set',{language:'en',theme:'white'})
  await call('group.add',{name:'ChatGPT Test',mode:'build'})
  await call('view.open',{kind:'home'})
  await page.locator('.add-employee').click()
  const form=page.locator('.employee-form')
  await form.locator('button[data-engine="chatgpt"]').click()
  await form.locator('input[name="title"]').fill('ChatGPT Native Test')
  await expect(form.locator('button[data-engine="chatgpt"]')).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:path.join(out,'create-chatgpt.png')})
  await form.locator('.save-employee').click()
  await expect(form).toHaveCount(0)
  const employee=(await call('session.list')).sessions.find(row=>row.title==='ChatGPT Native Test')
  assert.equal(employee?.engine,'chatgpt')
  await call('view.open',{kind:'messages',employee:employee.id})
  const composer=page.locator('.composer textarea')
  const marker='NATIVE-'+randomUUID().slice(0,8)
  await composer.fill('Reply with exactly '+marker+'. Do not call tools.')
  const observeTiming=async(expected)=>page.evaluate(expected=>{
    const transcript=document.querySelector('.transcript')
    const composer=document.querySelector('.composer textarea')
    const timing=window.chatgptTiming={firstMs:null,fullMs:null,updates:0,streamBeforeFinal:false}
    let started,last
    const observer=new MutationObserver(()=>{
      if(started===undefined)return
      const partial=transcript.querySelector('[data-chatgpt-progress]')?.innerText?.trim()
      const replies=[...transcript.querySelectorAll('.turn.assistant[data-chat-item]')]
      const final=replies.at(-1)?.innerText?.includes(expected)
      const elapsed=performance.now()-started
      if(partial&&partial!==last){timing.firstMs??=elapsed;timing.updates++;timing.streamBeforeFinal||=!final;last=partial}
      if(final){timing.firstMs??=elapsed;timing.fullMs=elapsed;observer.disconnect()}
    })
    composer.addEventListener('keydown',()=>{started=performance.now()},{once:true,capture:true})
    observer.observe(transcript,{subtree:true,childList:true,characterData:true})
  },expected)
  await observeTiming(marker)
  await composer.press('Enter')
  console.log('Submitted first message from Aexus Messages')
  const history=()=>call('direct.history',{employee:employee.id})
  const pending=path.join(fixture.env.AGENTS_COMPANY_HOME,'chatgpt',employee.id+'.json')
  await expect.poll(async()=>{
    const data=await history()
    if(data.items[0]?.delivery?.state==='failed')throw Error(data.items[0].delivery.error)
    return data.items.find(row=>row.role==='assistant')?.blocks?.map(x=>x.text).join('')
  },{timeout:190000}).toBe(marker).catch(async error=>{
    const info=await call('session.status',{employee:employee.id}).catch(()=>null)
    console.error(JSON.stringify({info,history:await history(),pending:fs.existsSync(pending+'.pending')}))
    throw error
  })
  assert.ok(fs.existsSync(pending))
  const bound=JSON.parse(fs.readFileSync(pending,'utf8'))
  await expect(page.locator('.transcript')).toContainText(marker)
  await page.waitForFunction(()=>window.chatgptTiming.fullMs!==null)
  const shortTiming=await page.evaluate(()=>window.chatgptTiming)
  console.log('Short reply timing:',JSON.stringify(shortTiming))
  const second='REPLY-'+randomUUID().slice(0,8)
  const story=process.env.AEXUS_CHATGPT_FORMAT==='1'?'Write a 300-word lighthouse story with a level-2 Markdown heading called Lighthouse, a bold phrase, a two-row Markdown table, a bullet list and a fenced JavaScript code block.':'Write a 300-word fictional story about a lighthouse.'
  await composer.fill(story+' Do not call tools. End with exactly this standalone marker: '+second+'\n\nThis is a multiline delivery check.\n'+('Ignore this padding. '.repeat(65)).trim())
  const cold=process.env.AEXUS_CHATGPT_COLD==='1'
  const egoPid=()=>{try{return Number(execFileSync('/usr/bin/pgrep',['-x','ego lite'],{encoding:'utf8'}).trim())||0}catch{return 0}}
  if(cold){
    const pid=egoPid()
    assert.ok(pid)
    execFileSync('/usr/bin/osascript',['-e','tell application id "com.citrolabs.ego.lite" to quit'],{timeout:7000})
    for(let i=0;i<25&&egoPid();i++)await delay(200)
    if(egoPid()===pid)process.kill(pid,'SIGTERM')
    for(let i=0;i<25&&egoPid();i++)await delay(200)
    assert.equal(egoPid(),0,'Ego must be stopped before Send')
    console.log('Ego Lite is closed; sending through Aexus only')
  }
  await observeTiming(second)
  await composer.press('Enter')
  await expect.poll(async()=>{
    const data=await history()
    const last=data.items.at(-1)
    if(last?.delivery?.state==='failed')throw Error(last.delivery.error)
    return data.items.filter(row=>row.role==='assistant').at(-1)?.blocks?.map(x=>x.text).join('')
  },{timeout:190000}).toContain(second)
  await expect(page.locator('.transcript')).toContainText(second)
  await page.waitForFunction(()=>window.chatgptTiming.fullMs!==null)
  if(cold)assert.ok(egoPid(),'Aexus should launch Ego Lite automatically')
  const longTiming=await page.evaluate(()=>window.chatgptTiming)
  console.log('Long reply timing:',JSON.stringify(longTiming))
  assert.ok(longTiming.streamBeforeFinal&&longTiming.updates>1,'Expected multiple streamed updates before the committed reply')
  await expect(page.locator('[data-chatgpt-progress]')).toHaveCount(0)
  if(process.env.AEXUS_CHATGPT_FORMAT==='1'){
    const answer=page.locator('.transcript .turn.assistant[data-chat-item]').last()
    await expect(answer.locator('h2')).toContainText('Lighthouse')
    for(const selector of ['strong','table','ul','pre'])await expect(answer.locator(selector).first()).toBeVisible()
  }
  const current=JSON.parse(fs.readFileSync(pending,'utf8'))
  assert.equal(current.url,bound.url)
  assert.notEqual(current.answerId,bound.answerId)
  const ledger=(await history()).items
  assert.equal(ledger.length,4)
  assert.ok(ledger.filter(row=>row.role==='assistant').every(row=>row.author?.employeeId===employee.id))
  await page.screenshot({path:path.join(out,'chatgpt-messages.png')})
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({engine:employee.engine,conversation:current.url,timing:{short:shortTiming,long:longTiming,cold},ledger},null,2))
  console.log('PASS employee creation and two native ChatGPT replies in Aexus Messages')
}finally{
  await app?.close()
  await fixture?.close()
}
