// Unified Library UI tests (hidden Electron desktop or headless Web): single explorer sidebar, embedded Study Reader, in-place PDF opening, Super Search jump to Mission, passive Cloud Host creation, ACL dialogs & Message group round-trip.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {chromium,_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'

const root=process.cwd(),require=createRequire(import.meta.url),web=process.argv.includes('--web'),mode=web?'web':'desktop'
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/library/'+mode)
fs.mkdirSync(out,{recursive:true})
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-library-ui-')))
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))

let f,page,app,browser
const checks=[],errors=[]
const pass=text=>{checks.push(text);console.log('PASS '+mode+': '+text)}

try{
  const application=process.env.AGENTS_COMPANY_TEST_APP
  f=await fixtureCore({
    ...(application?{AGENTS_COMPANY_BUILTIN_PLUGINS:path.join(application,'Contents/Resources/plugins')}:{}),
    ...(web?{AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)}:{}),
  })
  const core=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data}
  await core('settings.set',{language:'en'})

  const pdfLib=require('pdf-lib')
  const doc=await pdfLib.PDFDocument.create()
  doc.addPage([420,560]).drawText('IN_PLACE_LIBRARY_PDF_PAGE_1',{x:36,y:480,size:18})
  doc.addPage([420,560]).drawText('IN_PLACE_LIBRARY_PDF_PAGE_2',{x:36,y:480,size:18})
  const pdfBytes=Buffer.from(await doc.save())
  fs.mkdirSync(f.env.AGENTS_COMPANY_SHARED_DIR,{recursive:true})
  fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_SHARED_DIR,'InPlacePaper.pdf'),pdfBytes)

  const worker=await core('card.create',{title:'Library Research Agent',folderName:'library-research',engine:'codex',model:'gpt-6-luna',effort:'low'})
  await f.ready(worker.id)

  const group=await core('chat.create',{name:'PDF Roundtrip Group',members:[worker.id]})
  const groupWs=await core('conversation.workspace',{conversation:'group:'+group.id})
  fs.writeFileSync(path.join(groupWs.root,'GroupBrief.pdf'),pdfBytes)
  await core('chat.post',{id:group.id,text:'Group PDF fixture ready'})

  const nbTarget=await core('notebook.call',{method:'page.create',params:{title:'Unified Search Target',color:'white'}})
  await core('notebook.call',{method:'page.write-markdown',params:{pageId:nbTarget.id,markdown:'# Unified Target\n\nUNIFIED_JUMP_BODY'}})

  if(web){
    browser=await chromium.launch({headless:true,...(process.env.AGENTS_BROWSER_CHANNEL?{channel:process.env.AGENTS_BROWSER_CHANNEL}:process.platform==='darwin'?{channel:'chrome'}:{})})
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
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())),true,'Desktop window must stay hidden')
  }

  page.setDefaultTimeout(25000)
  page.on('pageerror',err=>errors.push(err.message))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('.company-navigation').waitFor()
  const rpc=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(error){throw Error(cmd+': '+(error?.message??JSON.stringify(error)))}},{cmd,args})

  // 1. Open Library: unified explorer sidebar only (zero .library-rail), default Study Library bookshelf with embedded=1
  await page.locator('.company-navigation .library-view-trigger').click()
  await expect(page.locator('aside.library-explorer-sidebar')).toBeVisible()
  await expect(page.locator('.library-rail')).toHaveCount(0)

  const readerIframeEl=page.locator('iframe.library-reader-frame')
  await expect(readerIframeEl).toBeVisible()
  const readerFrame=page.frameLocator('iframe.library-reader-frame')
  await expect(readerFrame.locator('html')).toHaveAttribute('data-embedded','1',{timeout:15000})
  await expect(readerFrame.locator('.app-bar')).toBeHidden()
  await expect(readerFrame.locator('#workspace > .explorer')).toBeHidden()
  pass('Library renders unified single sidebar without rail and embeds Study Reader without duplicate header/explorer')

  // 2. Create Study Set from sidebar & open it
  await page.locator('[data-library-create-study="true"]').click()
  await expect(readerFrame.locator('#dialog-fields')).toBeVisible()
  await readerFrame.locator('#dialog-fields input[name="title"]').fill('Unified UI Study Set')
  await readerFrame.locator('#dialog-submit').click()
  await expect(readerFrame.locator('#study-title')).toContainText('Unified UI Study Set')
  await expect(page.locator('[data-study-set-nav]')).toHaveCount(1)
  pass('Study Set created and opened seamlessly inside embedded Study Reader')

  // 3. Switch to Storage Overview via header meter pill (7 domains)
  await page.locator('[data-library-overview-trigger="true"]').click()
  await expect(page.locator('.library-domains-grid [data-domain]')).toHaveCount(7)
  pass('Storage Overview displays all 7 domains')

  // 4. Open Shared space and open InPlacePaper.pdf in place (0 duplicate PDF copies in APP_HOME/library-reader)
  const sharedTreeBtn=page.locator('aside.library-explorer-sidebar [role="tree"] .library-nav-btn',{hasText:'Shared'}).first()
  await sharedTreeBtn.click()
  const pdfCard=page.locator('.asset-gallery-grid .asset-entry[aria-label="InPlacePaper.pdf"]')
  await expect(pdfCard).toBeVisible()
  await pdfCard.dblclick()
  await expect(readerIframeEl).toBeVisible()
  await expect(readerFrame.locator('#document-title')).toContainText('InPlacePaper',{timeout:15000})
  const readerDirFiles=fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'library-reader')).filter(n=>n.endsWith('.pdf'))
  assert.equal(readerDirFiles.length,0,'In-place PDF open must not duplicate file into APP_HOME/library-reader')
  pass('Software Space PDF opens in place inside Study Reader with zero duplicate copies')

  // 5. Super Search -> Mission Notebook page deep-link jump
  await page.locator('[data-library-quick-search="true"]').fill('Unified Search Target')
  const nbResult=page.locator('.library-search-item[data-domain="notebook"] .library-search-item-title',{hasText:'Unified Search Target'}).first()
  await expect(nbResult).toBeVisible({timeout:15000})
  await nbResult.click()
  const missionFrameEl=page.locator('iframe.mission-notebook-frame')
  await expect(missionFrameEl).toBeVisible()
  await expect(page.frameLocator('iframe.mission-notebook-frame').getByRole('textbox',{name:'页面标题',exact:true})).toHaveValue('Unified Search Target',{timeout:15000})
  pass('Super Search locates Mission Notebook page and jumps directly into Mission view')

  // 6. Add Cloud Host passively (0 SSH probes) & test Authorized People dialogs
  await page.locator('.company-navigation .library-view-trigger').click()
  await page.locator('[data-library-add-host="true"]').click()
  await page.getByLabel('Host name',{exact:true}).fill('Staging VM')
  await page.getByLabel('SSH target (user@host)',{exact:true}).fill('ubuntu@10.0.0.88')
  await page.getByLabel('Default directory',{exact:true}).fill('/home/ubuntu')
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  await expect(page.locator('[data-library-host-nav]')).toHaveCount(1)
  const hostsAfterAdd=await rpc('host.list')
  assert.equal(hostsAfterAdd.length,1)
  assert.equal(hostsAfterAdd[0].status,undefined,'Adding host must not auto-probe SSH')
  pass('Cloud Host saved passively from unified sidebar with zero SSH probes')

  for(const trigger of ['[data-library-reader-access="true"]','[data-library-host-access="true"]']){
    await page.locator(trigger).click()
    await expect(page.locator('.library-access-dialog')).toBeVisible()
    await page.locator('.library-access-dialog').getByRole('button',{name:'Cancel',exact:true}).click()
    await expect(page.locator('.library-access-dialog')).toHaveCount(0)
  }
  pass('Reader and Cloud Host Authorized People modals open and close cleanly')

  // 7. Message group PDF -> Library Study Reader -> Back to conversation round-trip
  await page.locator('.company-navigation .messages-view-trigger').click()
  const grpFiles=await rpc('conversation.files',{conversation:'group:'+group.id})
  const groupPdf=grpFiles.files.find(file=>file.name==='GroupBrief.pdf')
  assert.ok(groupPdf,'GroupBrief.pdf should be indexed in group files')
  await rpc('conversation.file-open',{conversation:'group:'+group.id,path:groupPdf.path,version:groupPdf.version})
  await expect(page.locator('iframe.library-reader-frame')).toBeVisible()
  const backBtn=page.getByRole('button',{name:'Back to conversation',exact:true})
  await expect(backBtn).toBeVisible()
  await backBtn.click()
  await expect.poll(async()=>(await rpc('view.get')).kind).toBe('messages')
  pass('Group PDF opens in Library Study Reader and Back to conversation restores Message view')

  await page.screenshot({path:path.join(out,'library-unified.png')})
  if(!web){
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())),true,'Desktop window stayed hidden throughout test')
  }
  assert.deepEqual(errors,[],'Expected zero uncaught page errors: '+errors.join('; '))
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,checks,paidModelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{
  await app?.close()
  await browser?.close()
  await f?.close()
  fs.rmSync(temp,{recursive:true,force:true})
}
