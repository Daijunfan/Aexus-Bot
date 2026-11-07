// Actual hidden Electron controls, isolated state, byte-verified private/group downloads.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import sharp from 'sharp'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/shared-files/ui')),require=createRequire(import.meta.url),checks=[],errors=[]
fs.mkdirSync(out,{recursive:true});let f,app
try{
 f=await fixtureCore()
 const rpc=async(token,cmd,args={})=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,r.error);return r.data}
 await f.cli('group','add','Studio');const a=await f.create('Aster','Studio'),b=await f.create('Rowan','Studio'),ta=await f.token(a.id),tb=await f.token(b.id)
 const png=await sharp({create:{width:120,height:70,channels:3,background:'#4d72c2'}}).png().toBuffer(),original='A shared project brief.\n'
 await rpc(ta,'workspace.write',{employee:a.id,path:'photo.png',contentBase64:png.toString('base64'),create:true});await rpc(ta,'workspace.write',{employee:a.id,path:'brief.txt',content:original,create:true})
 await rpc(ta,'direct.post',{files:['brief.txt'],images:['photo.png'],clientMessageId:'ui-private-media'})
 const group=await rpc(null,'chat.create',{name:'Project files',members:[a.id,b.id]}),conversation='group:'+group.id,shared=await rpc(null,'conversation.workspace',{conversation})
 const upload=async(source,target)=>{const job=await rpc(ta,'conversation.upload',{conversation,from:{path:source},path:target,clientRequestId:'ui-upload-'+target});await f.until(async()=>{const s=await rpc(ta,'conversation.upload-status',{id:job.id});if(s.state==='failed')throw Error(s.error);return s.state==='completed'},'shared upload')}
 await upload('brief.txt','brief.txt');await upload('photo.png','photo.png')
 const published=await rpc(ta,'chat.post',{id:group.id,files:['@workspace/brief.txt'],images:['@workspace/photo.png'],clientMessageId:'ui-group-media'})
 await f.until(async()=>!(await f.status(a.id)).busy&&!(await f.status(b.id)).busy,'idle')
 await f.stop();const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env})
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.infinite-canvas').waitFor()
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await call('settings.set',{language:'en',viewAppearance:{messages:{theme:'white'}}});await call('view.open',{kind:'messages',employee:a.id})
 await expect(page.locator('.transcript .message-file strong')).toHaveText('brief.txt');await expect(page.locator('.transcript .message-photo img')).toBeVisible()
 const destination=path.join(f.temp,'Mac chosen location');fs.mkdirSync(destination)
 const saveClick=async(button,name,expected)=>{const target=path.join(destination,name);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},target);await button.click();await expect.poll(()=>fs.existsSync(target)).toBe(true);assert.deepEqual(fs.readFileSync(target),expected)}
 await saveClick(page.locator('.transcript').getByRole('button',{name:'Download brief.txt',exact:true}),'private file.txt',Buffer.from(original))
 const direct=(await rpc(null,'direct.history',{employee:a.id})).items[0],entry=await rpc(null,'conversation.entry',{conversation:'employee:'+a.id,id:direct.id}),image=entry.attachments.find(f=>f.kind==='image')
 const privateImage=path.join(destination,'private picture.png');await rpc(null,'conversation.download-local',{conversation:'employee:'+a.id,entryId:direct.id,attachmentId:image.id,path:privateImage});assert.deepEqual(fs.readFileSync(privateImage),png)
 checks.push('Private file/image cards render; the actual Download button saves exact file bytes to the chosen Mac path; image API saves original image bytes')
 await call('view.open',{kind:'messages',chatId:group.id});await expect(page.locator('.group-message')).toHaveCount(1);await expect(page.locator('.group-message .message-photo img')).toBeVisible()
 await saveClick(page.locator('.group-message').getByRole('button',{name:'Download brief.txt',exact:true}),'group file.txt',Buffer.from(original))
 await page.getByRole('button',{name:'Shared workspace',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Shared workspace',exact:true});await expect(dialog.locator('.file-row[data-file="brief.txt"]')).toBeVisible()
 for(const member of shared.members){await expect(dialog.getByRole('button',{name:'Rename '+member.directory,exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Delete '+member.directory,exact:true})).toBeDisabled()}
 await expect(dialog.getByRole('button',{name:'Rename brief.txt',exact:true})).toBeEnabled()
 await dialog.locator('.file-row[data-file="brief.txt"] .file-open').click();await dialog.getByRole('textbox',{name:'File content',exact:true}).fill('My unsaved edit')
 await rpc(tb,'conversation.file',{conversation,operation:'write',path:'new-by-peer.txt',content:'Peer file',create:true})
 await expect(dialog.locator('.file-row[data-file="new-by-peer.txt"]')).toBeVisible({timeout:1800});await expect(dialog.getByRole('textbox',{name:'File content',exact:true})).toHaveValue('My unsaved edit')
 await dialog.getByRole('button',{name:'Save file',exact:true}).click();assert.equal(fs.readFileSync(path.join(shared.root,'brief.txt'),'utf8'),'My unsaved edit')
 await page.screenshot({path:path.join(out,'shared-workspace-light.png'),animations:'disabled'});await dialog.getByRole('button',{name:'Close shared workspace',exact:true}).click()
 const changed='Updated by another group member.\n'.repeat(1024);await rpc(tb,'conversation.file',{conversation,operation:'write',path:'brief.txt',content:changed})
 await expect(page.locator('.group-message .message-file-info small')).toContainText('KB')
 await saveClick(page.locator('.group-message').getByRole('button',{name:'Download brief.txt',exact:true}),'updated group file.txt',Buffer.from(changed))
 assert.equal((await rpc(null,'chat.history',{id:group.id})).messages[0].id,published.id)
 checks.push('Group attachment-only post renders and downloads; current members edit root files; shared refresh preserves unsaved drafts; protected member-folder identities are visibly locked; file cards and downloads use updated content')
 for(const theme of ['white','black']){await call('settings.set',{viewAppearance:{messages:{theme}}});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'group-'+theme+'.png'),animations:'disabled'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,900));await page.waitForTimeout(150);const geometry=await page.evaluate(()=>({width:innerWidth,page:document.documentElement.scrollWidth,right:document.querySelector('.group-conversation').getBoundingClientRect().right}));assert.ok(geometry.page<=geometry.width+1&&geometry.right<=geometry.width+1);await page.screenshot({path:path.join(out,'group-'+theme+'-720.png'),animations:'disabled'})}
 assert.deepEqual(errors,[]);assert.ok((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()})))).every(w=>!w.visible&&!w.focused))
 checks.push('Light/dark and 720px rendering has no horizontal overflow or renderer errors; all test windows stayed hidden and unfocused')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks,errors,modelCalls:0,productionDataUsed:false},null,2));checks.forEach(c=>console.log('PASS '+c))
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw error}finally{try{await app?.close()}finally{await f?.close()}}
