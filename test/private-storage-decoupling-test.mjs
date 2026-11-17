import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {profileApplication} from './fixtures/profile-application.mjs'

const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
const application=await profileApplication(),f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port)},path.join(application.directory,'out/main/daemon.js'))
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/private-storage-decoupling');fs.mkdirSync(out,{recursive:true})
const rpc=async(cmd,args={},token=null)=>{const res=await f.request(token,cmd,args);assert.ok(res.ok,cmd+' failed: '+(res.error??'unknown'));return res.data}
const upload=async(conversation,name,bytes,scope)=>{
 const begin=await rpc('messenger.upload-begin',{conversation,name,bytes:bytes.length,...(scope?{scope}:{})})
 for(let offset=0;offset<bytes.length;offset+=begin.chunkBytes)await rpc('transfer.upload-chunk',{id:begin.id,offset,data:bytes.subarray(offset,offset+begin.chunkBytes).toString('base64')})
 return (await rpc('transfer.upload-commit',{id:begin.id})).destination
}
const idle=async id=>f.until(async()=>!(await f.status(id)).busy,'agent idle')
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')
const noteBytes=Buffer.from('Private notes stored only on Mac.\nLine 2 for Agent read & download.\n','utf8')

let browser,page
try{
 const a=await f.create('Aster','employee'),other=await f.create('Rowan','employee'),secretary=await f.create('Kira','secretary')
 await f.cli('card','avatar',a.id,'fate-saber-chibi')
 await f.cli('card','avatar',other.id,'fate-gilgamesh-chibi')
 const keepFile=path.join(a.cwd,'keep-me.txt');fs.writeFileSync(keepFile,'ASSIGNED_WORKSPACE_FILE')
 const aToken=await f.token(a.id),otherToken=await f.token(other.id),secToken=await f.token(secretary.id)

 // 1. Private upload (default scope) goes strictly to Mac-local direct/uploads, never cwd/.agents-attachments.
 const shotPath=await upload('employee:'+a.id,'shot.png',png)
 const notesPath=await upload('employee:'+a.id,'notes.txt',noteBytes)
 assert.ok(shotPath.startsWith('@direct-upload/'),shotPath)
 assert.ok(notesPath.startsWith('@direct-upload/'),notesPath)
 assert.equal(fs.existsSync(path.join(a.cwd,'.agents-attachments')),false,'private upload must not touch cwd/.agents-attachments')
 assert.ok(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'direct','uploads',a.id)).length===2)

 // Work upload (scope:'work') continues staging into cwd/.agents-attachments for Team workbench.
 const workStage=await upload('employee:'+a.id,'work-spec.txt',Buffer.from('Team spec'),'work')
 assert.match(workStage,/^\.agents-attachments\/[a-f0-9-]+\/work-spec\.txt$/)
 assert.equal(fs.existsSync(path.join(a.cwd,workStage)),true)

 // 2. Send private message with text + link + image + file, then publish assistant reply.
 await rpc('direct.send',{employee:a.id,text:'Review https://example.org/spec and notes.txt',images:[shotPath],files:[notesPath],clientMessageId:'decouple-dm-1'})
 await idle(a.id)
 await rpc('direct.post',{text:'Received both private attachments.',clientMessageId:'decouple-dm-reply-1'},aToken)
 const transcriptBefore=await rpc('session.transcript',{employee:a.id})
 assert.ok(transcriptBefore.items.some(item=>item.role==='user'&&item.text.includes('Review https://example.org/spec')))

 // 3. Employee Agent inspects its own Mac-local private files, searches history/links, checks storage, reads & downloads explicitly.
 const agentFiles=await rpc('direct.files',{},aToken)
 assert.equal(agentFiles.storageLocation,'mac-local')
 assert.equal(agentFiles.workspaceDecoupled,true)
 assert.equal(agentFiles.total,2)
 const notesEntry=agentFiles.files.find(file=>file.name==='notes.txt'),shotEntry=agentFiles.files.find(file=>file.name==='shot.png')
 assert.ok(notesEntry&&shotEntry)
 const readNotes=await rpc(notesEntry.read.command,notesEntry.read.args,aToken)
 assert.equal(readNotes.content,noteBytes.toString('utf8'))
 const readShot=await rpc(shotEntry.read.command,shotEntry.read.args,aToken)
 assert.equal(Buffer.from(readShot.data,'base64').equals(png),true)
 const searchLinks=await rpc('direct.search',{query:'example.org',filter:'links'},aToken)
 assert.equal(searchLinks.total,1)
 assert.deepEqual(searchLinks.items[0].links,['https://example.org/spec'])
 const stats=await rpc('direct.storage',{},aToken)
 assert.equal(stats.storageLocation,'mac-local')
 assert.equal(stats.workspaceDecoupled,true)
 assert.equal(stats.messageCount,2)
 assert.equal(stats.fileCount,2)
 assert.ok(stats.mediaBytes>0&&stats.uploadStagingBytes>0&&stats.ledgerBytes>0)

 // Explicit conversation.download copies from Mac-local storage into workspace on demand.
 const dl=await rpc('conversation.download',{...notesEntry.download.args,clientRequestId:'agent-explicit-copy-1'},aToken)
 const dlDone=await f.until(async()=>{const state=await rpc('conversation.download-status',{id:dl.id},aToken);if(state.state==='failed')throw Error(state.error);return state.state==='completed'&&state},'agent explicit copy completed')
 assert.equal(fs.readFileSync(dlDone.absolutePath,'utf8'),noteBytes.toString('utf8'))
 fs.unlinkSync(dlDone.absolutePath)

 // Authorization boundaries: agent and peer cannot call direct.clear; peer cannot read Aster's private files.
 assert.equal((await f.request(aToken,'direct.clear',{employee:a.id,scope:'all'})).ok,false)
 assert.equal((await f.request(otherToken,'direct.files',{employee:a.id})).ok,false)
 assert.equal((await f.request(otherToken,'direct.clear',{employee:a.id,scope:'all'})).ok,false)

 // 4. Headless Chromium UI: Agent conversation icon & embedded workbench + search & clear controls.
 browser=await chromium.launch({...(process.env.AGENTS_BROWSER_CHANNEL?{channel:process.env.AGENTS_BROWSER_CHANNEL}:process.platform==='darwin'?{channel:'chrome'}:{}),headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:960}})
 page=await context.newPage();page.setDefaultTimeout(15000)
 const errors=[];page.on('pageerror',err=>errors.push(err.message))
 await page.goto('http://127.0.0.1:'+port)
 await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim())
 await page.getByRole('button',{name:'Enter workspace',exact:true}).click()
 await expect(page.locator('.message-view')).toBeVisible()

 await rpc('settings.set',{theme:'white',viewAppearance:{messages:{theme:'white'},plan:{theme:'white'}}})
 await page.getByRole('button',{name:'Message Aster',exact:true}).click()
 await expect(page.locator('.message-conversation .transcript')).toContainText('Received both private attachments.')

 // Folder icon replaced by agent-conversation + Private files and history button visible.
 await expect(page.locator('.message-thread-actions .codicon-folder-opened')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Agent conversation',exact:true}).locator('.codicon-agent-conversation svg')).toBeVisible()
 await expect(page.getByRole('button',{name:'Private files and history',exact:true}).locator('.codicon-file-text svg')).toBeVisible()
 await page.screenshot({animations:'disabled',path:path.join(out,'private-header.png')})

 // Clicking Agent conversation embeds workbench directly inside MessageView while sidebar stays visible.
 await page.getByRole('button',{name:'Agent conversation',exact:true}).click()
 await expect(page.locator('.message-view .message-sidebar')).toBeVisible()
 await expect(page.locator('.message-stage .conversation-layer.message-agent-conversation .employee-workbench')).toBeVisible()
 await page.screenshot({animations:'disabled',path:path.join(out,'embedded-agent-conversation.png')})
 await page.getByRole('button',{name:'Close conversation',exact:true}).click()
 await expect(page.locator('.message-conversation .transcript')).toBeVisible()

 // Open Private files and history -> search -> Clear files only -> verify keep-me.txt & text messages survive.
 await page.getByRole('button',{name:'Private files and history',exact:true}).click()
 const library=page.locator('.message-library')
 await expect(library.locator('.private-storage-banner')).toContainText('Mac-local private storage')
 await expect(library.locator('[data-private-file]')).toHaveCount(2)
 await page.screenshot({animations:'disabled',path:path.join(out,'private-files-library.png')})

 await library.getByRole('textbox',{name:'Search shared files',exact:true}).fill('notes')
 await expect(library.locator('[data-private-file]')).toHaveCount(1)
 await expect(library.locator('[data-private-file]')).toContainText('notes.txt')
 await library.getByRole('button',{name:'Clear history search',exact:true}).click()
 await expect(library.locator('[data-private-file]')).toHaveCount(2)

 await library.getByRole('button',{name:'Clear private files…',exact:true}).click()
 const clearDialog=page.getByRole('dialog',{name:'Clear private chat history',exact:true})
 await expect(clearDialog).toContainText(a.cwd)
 await page.screenshot({animations:'disabled',path:path.join(out,'clear-private-dialog.png')})
 await clearDialog.getByRole('button',{name:'Clear files only',exact:true}).click()
 await expect(clearDialog).toHaveCount(0)
 await expect(library.locator('[data-private-file]')).toHaveCount(0)
 await expect(library.getByText('No private files yet',{exact:true})).toBeVisible()

 const afterFilesClear=await rpc('direct.storage',{employee:a.id})
 assert.equal(afterFilesClear.messageCount,2,'text messages stay after clearing files only')
 assert.equal(afterFilesClear.fileCount,0)
 assert.equal(afterFilesClear.mediaBytes,0)
 assert.equal(afterFilesClear.uploadStagingBytes,0)
 assert.equal(fs.readFileSync(keepFile,'utf8'),'ASSIGNED_WORKSPACE_FILE')
 assert.deepEqual((await rpc('session.transcript',{employee:a.id})).items,transcriptBefore.items)

 // Re-upload & send, test Chinese localization & Clear all.
 const shotPath2=await upload('employee:'+a.id,'second.png',png)
 await rpc('direct.send',{employee:a.id,text:'Second batch',images:[shotPath2],clientMessageId:'decouple-dm-2'})
 await idle(a.id)
 const transcriptBeforeAllClear=await rpc('session.transcript',{employee:a.id})
 await rpc('settings.set',{language:'zh-CN'})
 await expect(library.locator('.private-storage-banner')).toContainText('Mac 本机私聊存储')
 await library.getByRole('button',{name:'清空私聊记录…',exact:true}).click()
 const zhDialog=page.getByRole('dialog',{name:'清空私聊记录',exact:true})
 await expect(zhDialog).toContainText('不会受到任何影响')
 await zhDialog.getByRole('button',{name:'清空全部聊天记录与文件',exact:true}).click()
 await expect(zhDialog).toHaveCount(0)
 await rpc('settings.set',{language:'en'})

 const afterAllClear=await rpc('direct.storage',{employee:a.id})
 assert.equal(afterAllClear.messageCount,0)
 assert.equal(afterAllClear.fileCount,0)
 assert.equal(afterAllClear.mediaBytes,0)
 assert.equal(fs.existsSync(keepFile),true)
 assert.equal(fs.readFileSync(keepFile,'utf8'),'ASSIGNED_WORKSPACE_FILE')
 assert.deepEqual((await rpc('session.transcript',{employee:a.id})).items,transcriptBeforeAllClear.items)

 // Secretary can also call direct.clear.
 const secRes=await rpc('direct.clear',{employee:a.id,scope:'all'},secToken)
 assert.equal(secRes.cleared,true)
 assert.equal(secRes.workspaceUntouched,true)

 assert.deepEqual(errors,[])
 console.log('PASS private storage decoupling: Mac-local uploads/media, agent inspection APIs, embedded Agent conversation, private file search, and safe file/history clear leaving workspace untouched')
}catch(error){
 await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})
 throw error
}finally{
 await browser?.close().catch(()=>{})
 await f.close()
 application.dispose()
}
