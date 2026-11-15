// Exercise the real current Board and its full conversation; both inline and dialog transcripts exist.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=process.cwd(),require=createRequire(import.meta.url),output=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/chat-scroll');fs.mkdirSync(output,{recursive:true})
let f,app,page;const errors=[]
const cli=(...args)=>f.cli(...args),status=id=>f.status(id),create=async title=>{const card=await cli('card','create','--title',title,'--group','Team','--model','gpt-6-luna','--effort','low');await f.ready(card.id);return card}
const transcript=()=>page.locator('.conversation-dialog .transcript'),top=()=>transcript().evaluate(e=>e.scrollTop),gap=()=>transcript().evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop),frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const open=async card=>{await page.getByRole('button',{name:'Focus '+card.title,exact:true}).click();await page.locator('#root [data-employee="'+card.id+'"]').getByRole('button',{name:'Open full conversation with '+card.title,exact:true}).click();await expect(page.locator('.conversation-dialog')).toBeVisible()}
try{
 f=await fixtureCore();await f.stop();const env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1400',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE;const application=process.env.AGENTS_COMPANY_TEST_APP;app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))

 await page.locator('.agent-board').waitFor();await cli('group','add','Team');const card=await create('Reader')
 const reply=path.join(f.control,card.id+'.reply.txt'),stream=path.join(f.control,card.id+'.stream.txt'),hold=path.join(f.control,card.id+'.hold-user')
 fs.writeFileSync(reply,Array.from({length:90},(_,i)=>`历史段落 ${i}：这里是需要向上阅读的内容。`).join('\n\n'))
 await cli('session','send','--employee',card.id,'--text','第一轮');await expect.poll(async()=>(await status(card.id)).busy).toBe(false)
 await open(card);await expect(transcript()).toContainText('历史段落 89');await expect.poll(gap).toBeLessThan(4)
 fs.writeFileSync(hold,'');let text='正在处理，实时更新。\n\n'.repeat(15);fs.writeFileSync(stream,text)
 await cli('session','send','--employee',card.id,'--text','继续处理');await expect(transcript()).toContainText('正在处理');await expect.poll(gap).toBeLessThan(4)
 const box=await transcript().boundingBox(),initialTop=await top();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-650)
 await expect.poll(top).toBeLessThan(initialTop-200);await frame();let reading=await top()
 for(let i=0;i<3;i++){text+=`新的实时输出 ${i}\n\n`.repeat(8);fs.writeFileSync(stream,text);await expect(transcript()).toContainText(`新的实时输出 ${i}`);assert.ok(Math.abs(await top()-reading)<3,'streaming pulled the reader away from history')}
 await cli('settings','set','--view','company','--theme','space');await frame();assert.ok(Math.abs(await top()-reading)<3,'configuration refresh moved history')
 await transcript().evaluate(e=>{e.scrollTop=320});await frame();reading=await top()
 text+='拖动滚动条后仍有新内容\n\n';fs.writeFileSync(stream,text);await expect(transcript()).toContainText('拖动滚动条后仍有新内容');assert.ok(Math.abs(await top()-reading)<3)
 fs.writeFileSync(reply,text);fs.unlinkSync(hold);await expect.poll(async()=>(await status(card.id)).busy).toBe(false);await frame();assert.ok(Math.abs(await top()-reading)<3,'turn completion moved history')
 await page.screenshot({path:path.join(output,'chat-reading-during-updates.png')})
 await transcript().evaluate(e=>{e.scrollTop=e.scrollHeight});await frame();await expect.poll(gap).toBeLessThan(4)
 fs.writeFileSync(hold,'');text='回到底部后继续跟随\n\n'.repeat(15);fs.writeFileSync(stream,text)
 await cli('session','send','--employee',card.id,'--text','第三轮');await expect(transcript()).toContainText('回到底部后继续跟随');await expect.poll(gap).toBeLessThan(4)
 text+='最后一段跟随更新\n\n'.repeat(12);fs.writeFileSync(stream,text);await expect(transcript()).toContainText('最后一段跟随更新');await expect.poll(gap).toBeLessThan(4)
 fs.writeFileSync(reply,text);fs.unlinkSync(hold);await expect.poll(async()=>(await status(card.id)).busy).toBe(false)
 const other=await create('Other');fs.writeFileSync(path.join(f.control,other.id+'.reply.txt'),'另一名员工的历史\n\n'.repeat(90));await cli('session','send','--employee',other.id,'--text','你好');await expect.poll(async()=>(await status(other.id)).busy).toBe(false)
 await transcript().evaluate(e=>{e.scrollTop=0});await frame();await page.locator('.conversation-dialog').getByRole('button',{name:'Close conversation',exact:true}).click();await expect(page.locator('.conversation-dialog')).toHaveCount(0);await open(other);await expect(transcript()).toContainText('另一名员工的历史');await expect.poll(gap).toBeLessThan(4)
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'current Board to full conversation',thresholds:{historyDriftPx:3,bottomGapPx:4,wheelTravelPx:200},streamUpdateRounds:3,errors,paidModelCalls:0,productionDataUsed:false},null,2)+'\n');assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 console.log('PASS hidden live stream: bottom follows new output, wheel/scrollbar history stays fixed through updates and completion, rendering stays live, bottom follow resumes, switching employees resets correctly')
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors},null,2)+'\n');throw error}finally{await app?.close();await f?.close()}
