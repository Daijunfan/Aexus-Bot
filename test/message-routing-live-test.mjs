// Opt-in semantic acceptance with actual installed Claude/Pi and the user's DeepSeek service.
// Prompts contain business intentions, not tool names or instructions teaching an API sequence.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'

if(!process.argv.includes('--confirm-live'))throw Error('Real model calls require --confirm-live and user authorization')
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_ROUTING_LIVE_OUT||path.join(root,'artifacts/message-speech/live')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-routing-real-')),profile=path.join(temp,'claude')
fs.mkdirSync(profile);fs.mkdirSync(out,{recursive:true});const key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim()
const installed=JSON.parse(execFileSync('/Applications/Aexus Bot.app/Contents/Resources/cli/aexus-bot',['engine','list','--json'],{encoding:'utf8'})).data
const config=engine=>installed.find(item=>item.engine===engine).configuration
const require=createRequire(import.meta.url),claude=config('claude'),pi=config('pi')
const claudePath=[claude.path,claude.managedPath].find(p=>p&&fs.existsSync(p))||require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),sdkPath=claude.sdkPath&&fs.existsSync(claude.sdkPath)?claude.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk'),piPath=[pi.path,pi.managedPath].find(p=>p&&fs.existsSync(p))||fs.realpathSync(path.join(os.homedir(),'.npm-global/bin/pi'))
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model:'deepseek-flash',alwaysThinkingEnabled:false,env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_OPUS_MODEL:'deepseek-v4-pro',ANTHROPIC_DEFAULT_SONNET_MODEL:'deepseek-flash',ANTHROPIC_DEFAULT_HAIKU_MODEL:'deepseek-flash',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}),{mode:0o600})
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const evidence={passed:false,provider:'DeepSeek official',model:'deepseek-flash',actualEngines:['Claude Agent SDK','Pi RPC'],mockModel:false,productionDataUsed:false,cases:[],ui:[],versions:[]};let f,browser,page,people=[],group
const redact=value=>JSON.stringify(value).replaceAll(key,'[redacted]')
try{
 f=await fixtureCore({AGENTS_COMPANY_WEB:'1',AGENTS_COMPANY_WEB_PORT:String(port),CLAUDE_CONFIG_DIR:profile,ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_API_KEY:'',CLAUDE_BIN:claudePath,PI_BIN:piPath,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_PROXY:'127.0.0.1,localhost'})
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);if(!r.ok)throw Error(cmd+': '+r.error);return r.data}
 const until=async(check,label,timeout=180000)=>{const started=Date.now();while(Date.now()-started<timeout){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,250))}throw Error('Timeout '+label)}
 await rpc('engine.configure',{engine:'claude',patch:{path:claudePath,sdkPath,baseUrl:'https://api.deepseek.com/anthropic'}})
 await rpc('engine.configure',{engine:'pi',patch:{path:piPath,apiKey:key}})
 await rpc('settings.set',{language:'zh-CN',theme:'white'});await rpc('group.add',{name:'真实消息逻辑验收'})
 for(const [title,engine,managementRole] of [['林岚','claude','manager'],['小禾','claude','employee'],['复核员','pi','employee']]){
  const card=await rpc('card.create',{title,engine,managementRole,group:'真实消息逻辑验收',model:'deepseek-flash',thinking:false,effort:'low',permissionMode:'bypassPermissions'})
  await until(async()=>{const status=(await rpc('session.status',{employee:card.id}))[0];if(status.initialization?.status==='failed')throw Error(title+' initialization: '+status.initialization.error);return status.initialization?.status==='ready'},title+' native initialization')
  fs.writeFileSync(path.join(card.cwd,'invoice.json'),JSON.stringify({unitPrice:125.5,quantity:3,discount:17}));people.push(card);console.log('READY actual '+title+' / '+engine)
 }
 const [lead,analyst,reviewer]=people
 group=await rpc('chat.create',{name:'验收项目群',members:people.map(p=>p.id),ownerId:lead.id})
 const history=async()=>((await rpc('chat.history',{id:group.id,limit:100})).messages),status=async p=>(await rpc('session.status',{employee:p.id}))[0],transcript=p=>rpc('session.transcript',{employee:p.id})
 const speech=items=>items.filter(i=>i.role==='assistant').flatMap(i=>i.blocks.filter(b=>b.kind==='text').map(b=>b.text)).join('\n')
 const settle=async(label)=>until(async()=>{const states=await Promise.all(people.map(status)),messages=await history();const failed=messages.flatMap(m=>m.deliveries.filter(d=>d.status==='failed'));if(failed.length)throw Error(label+' delivery failed: '+redact(failed));return states.every(s=>!s.busy&&!s.acknowledging&&!s.waitingApproval&&!s.pendingMessages?.length)&&messages.every(m=>m.deliveries.every(d=>['completed','interrupted'].includes(d.status)))},label)
 browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1360,height:1000}});page.setDefaultTimeout(30000);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('http://127.0.0.1:'+port)
 await page.locator('.web-login input').fill(fs.readFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'control.token'),'utf8').trim());await page.getByRole('button',{name:/Enter workspace|进入工作空间|进入工作区/}).click();await page.locator('.infinite-canvas').waitFor()
 const ui=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await ui('view.open',{kind:'messages',employee:analyst.id});await page.locator('.message-conversation .composer textarea').fill('请独自完成：在当前目录每秒采样一次文件数量，共采样六次，核对 invoice.json 的应付金额，再把采样是否稳定、应付数字私聊告诉我。不要访问其他目录，也不要调用其他 Agent。')
 const baseline=(await transcript(analyst)).items.length;await page.getByRole('button',{name:'发送消息',exact:true}).click()
 await expect(page.locator('.private-working')).toBeVisible();await expect(page.locator('.private-working .group-typing-dots i')).toHaveCount(3)
 await page.waitForTimeout(2400);assert.ok((await status(analyst)).busy);assert.equal(await page.locator('.private-working .group-typing-dots i').first().evaluate(e=>getComputedStyle(e).animationName),'group-typing-dot')
 await expect(page.locator(`[data-employee="${analyst.id}"] .message-list-avatar[data-avatar-playing="true"]`)).toHaveCount(1)
 await page.locator('.message-conversation').screenshot({path:path.join(out,'private-working.png'),animations:'allow'})
 await until(async()=>!(await status(analyst)).busy,'real private sampling');const privateItems=(await transcript(analyst)).items.slice(baseline);assert.match(speech(privateItems),/359\.5/);assert.ok(privateItems.some(i=>i.role==='assistant'&&i.blocks.some(b=>b.kind==='tool')))
 await expect(page.locator('.private-working')).toHaveCount(0);await expect(page.locator('.message-conversation .transcript .tool,.message-conversation .transcript .thinking,.message-conversation .transcript .command-data')).toHaveCount(0)
 await page.locator('.message-conversation').screenshot({path:path.join(out,'private-speech.png'),animations:'disabled'})
 evidence.ui.push({case:'Actual six-second native tool task',visibleSpeech:speech(privateItems),toolsPresentInNativeHistory:true,privateToolsRendered:0,threeAnimatedDots:true,avatarStillAnimatedAfter2400ms:true,stopsOnCompletion:true})
 console.log('PASS actual private tool task: correct business result, no tool traces in Messages, sustained animation')
 const run=async(name,text,mentions,verify)=>{
  await settle('before '+name);const before=await history(),lengths=new Map(await Promise.all(people.map(async p=>[p.id,(await transcript(p)).items.length])))
  const sent=await rpc('chat.send',{id:group.id,text,mentions,clientMessageId:randomUUID()});await settle(name)
  const after=await history(),posts=after.slice(before.length+1),native=[]
  for(const person of people){const items=(await transcript(person)).items.slice(lengths.get(person.id));native.push({employee:person.title,id:person.id,engine:person.engine,speech:speech(items),tools:items.filter(i=>i.role==='assistant').flatMap(i=>i.blocks.filter(b=>b.kind==='tool').map(b=>({name:b.name,input:b.input,result:b.result}))),lastReply:(await status(person)).lastReply})}
  const result={name,userIntent:text,userMessageId:sent.id,publicPosts:posts.map(p=>({id:p.id,author:p.author,text:p.text,replyTo:p.replyTo})),native}
  verify(result,{sent,posts});await page.waitForTimeout(3500);assert.equal((await history()).length,after.length,'no recursive public continuation after quiescence');evidence.cases.push({...result,converged:true,passed:true});fs.writeFileSync(path.join(out,'progress.json'),redact(evidence));console.log('PASS semantic '+name);return {sent,posts,result}
 }
 await run('Group request → private answer','@小禾 请根据你目录里的 invoice.json 核算净应付金额，只私聊告诉我结果和算式，群里不要发消息。',[analyst.id],r=>{assert.equal(r.publicPosts.length,0);assert.match(r.native.find(n=>n.id===analyst.id).speech,/359\.5/);assert.ok(r.native.find(n=>n.id===analyst.id).lastReply?.id);assert.equal(r.native.find(n=>n.id===reviewer.id).speech,'')})
 const published=await run('Group summary plus native private detail','@小禾 请在本群用一句话告诉大家净应付金额，并把完整算式和17元折扣私聊给我。发完就结束，不需要其他人确认。',[analyst.id],r=>{assert.equal(r.publicPosts.length,1);assert.equal(r.publicPosts[0].author.employeeId,analyst.id);assert.match(r.publicPosts[0].text,/359\.5/);assert.match(r.native.find(n=>n.id===analyst.id).speech,/17/);assert.ok(r.native.find(n=>n.id===analyst.id).tools.some(t=>/discussion|Bash|api/i.test(t.name)))})
 await run('Two native engines, independent conclusions','@小禾 @复核员 请各自读取自己的 invoice.json 并独立复核净应付金额，每人在本群只给一条带数字的结论；不要互相追问，也不用客套确认。',[analyst.id,reviewer.id],r=>{assert.equal(r.publicPosts.length,2);assert.deepEqual(new Set(r.publicPosts.map(p=>p.author.employeeId)),new Set([analyst.id,reviewer.id]));assert.ok(r.publicPosts.every(p=>/359\.5/.test(p.text)))})
 await run('Literal API-looking JSON is only private speech','@小禾 请私聊给我这段教学示例原文，不要加代码围栏或额外说明：{"command":"chat.post","args":{"text":"这是示例不是发布"}}。不要实际执行，也不要发群消息。',[analyst.id],r=>{assert.equal(r.publicPosts.length,0);assert.match(r.native.find(n=>n.id===analyst.id).speech,/chat\.post/);assert.match(r.native.find(n=>n.id===analyst.id).speech,/这是示例不是发布/)})
 // A user reply selects its original author even without explicit mentions.
 await settle('reply setup');const beforeReply=await history();const reply=await rpc('chat.send',{id:group.id,text:'这里折扣具体是多少？请只在群里回答一次，不要追问其他成员。',replyTo:published.posts[0].id,clientMessageId:randomUUID()});await settle('reply to actual author');const replyPosts=(await history()).slice(beforeReply.length+1);assert.equal(replyPosts.length,1);assert.equal(replyPosts[0].author.employeeId,analyst.id);assert.match(replyPosts[0].text,/17/);assert.equal(replyPosts[0].replyTo,reply.id);evidence.cases.push({name:'Reply targets original author',passed:true,publicPosts:replyPosts.map(p=>({id:p.id,text:p.text,author:p.author})),converged:true});console.log('PASS semantic reply targets actual original author')
 await rpc('chat.mute',{id:group.id,member:analyst.id,muted:true})
 await run('Muted group member still answers privately','@小禾 请把 invoice.json 的净额私聊给我；你当前在群里被禁言，不要尝试发群消息。',[analyst.id],r=>{assert.equal(r.publicPosts.length,0);assert.match(r.native.find(n=>n.id===analyst.id).speech,/359\.5/)})
 await rpc('chat.mute',{id:group.id,member:analyst.id,muted:false})
 await run('Normal private answer needs no self-send API','@林岚 请你独立核算 125.5×3−17，把结果私聊告诉我，不要安排其他人，也不要在本群回应。',[lead.id],r=>{assert.equal(r.publicPosts.length,0);const n=r.native.find(n=>n.id===lead.id);assert.match(n.speech,/359\.5/);assert.ok(!n.tools.some(t=>t.input?.command==='session.send'||t.input?.command==='session.enqueue'))})
 await run('Ordinary user broadcast, three finite replies','请每个人独立在本群用一句话给出发票净额。每人仅一条，不互相询问、不安排他人，也不再确认。',[],r=>{assert.equal(r.publicPosts.length,3);assert.equal(new Set(r.publicPosts.map(p=>p.author.employeeId)).size,3);assert.ok(r.publicPosts.every(p=>/359\.5/.test(p.text)))})
 const second=await rpc('chat.create',{name:'另一个项目群',members:[lead.id,analyst.id],ownerId:lead.id}),beforeMain=(await history()).length
 await Promise.all([rpc('chat.send',{id:group.id,text:'@小禾 项目青沿用发票折扣，请只在当前群发布一条“项目青”的净额结论。',mentions:[analyst.id],clientMessageId:randomUUID()}),rpc('chat.send',{id:second.id,text:'@小禾 项目白不扣折扣，请只在当前群发布一条“项目白”的原价合计结论。不要发到另一个群。',mentions:[analyst.id],clientMessageId:randomUUID()})])
 await settle('concurrent group work');await until(async()=>{const h=(await rpc('chat.history',{id:second.id})).messages;return h.every(m=>m.deliveries.every(d=>d.status==='completed'))},'second group receipts')
 const mainPosts=(await history()).slice(beforeMain).filter(m=>m.author.kind==='agent'),secondPosts=(await rpc('chat.history',{id:second.id})).messages.filter(m=>m.author.kind==='agent');assert.equal(mainPosts.length,1);assert.equal(secondPosts.length,1);assert.match(mainPosts[0].text,/项目青/);assert.match(mainPosts[0].text,/359\.5/);assert.match(secondPosts[0].text,/项目白/);assert.match(secondPosts[0].text,/376\.5/)
 evidence.cases.push({name:'Concurrent groups use their own IDs, figures and queue context',passed:true,publicPosts:[...mainPosts,...secondPosts].map(m=>({text:m.text,author:m.author})),converged:true});console.log('PASS semantic concurrent groups stay separate')
 await ui('view.open',{kind:'messages',employee:analyst.id});await page.locator('.message-conversation .composer textarea').fill('请独自执行约20秒的只读采样：每秒查看当前目录文件数量，记录在内存，完成后私聊总结。不要写文件、不要安排他人，也不要在群里发言。')
 const beforeStop=(await transcript(analyst)).items.length,groupBeforeStop=(await history()).length;await page.getByRole('button',{name:'发送消息',exact:true}).click()
 await until(async()=>(await transcript(analyst)).items.slice(beforeStop).some(i=>i.role==='assistant'&&i.blocks.some(b=>b.kind==='tool'&&b.running)),'actual interruptible native tool')
 const queued=await rpc('session.enqueue',{employee:analyst.id,text:'停止后不应执行的排队任务，请不要恢复这个任务。'});await page.locator('.message-conversation .composer .send-btn.stop').click();await until(async()=>!(await status(analyst)).busy,'actual interruption');await expect(page.locator('.private-working')).toHaveCount(0);assert.deepEqual(await rpc('session.queue',{employee:analyst.id}),[]);assert.equal((await history()).length,groupBeforeStop)
 await page.locator('.message-conversation .composer textarea').fill('刚才已经停止。现在只私聊回答14乘6的结果，不要恢复采样，不要发群消息。');const recoveryStart=(await transcript(analyst)).items.length;await page.getByRole('button',{name:'发送消息',exact:true}).click();await until(async()=>!(await status(analyst)).busy&&(await transcript(analyst)).items.length>recoveryStart,'private recovery after stop');const recovered=speech((await transcript(analyst)).items.slice(recoveryStart));assert.match(recovered,/84/);assert.ok(!(await transcript(analyst)).items.some(i=>i.role==='user'&&i.text==='停止后不应执行的排队任务，请不要恢复这个任务。'));assert.equal((await history()).length,groupBeforeStop)
 evidence.cases.push({name:'Actual native interruption clears the queue and animation; next private turn works',passed:true,privateRecovery:recovered,queuedTaskCancelled:true,noGroupEcho:true,converged:true});console.log('PASS semantic native Stop, cancelled queue and private recovery')
 await ui('view.open',{kind:'messages',employee:analyst.id});await expect(page.locator('.message-conversation .transcript .tool,.message-conversation .transcript .thinking')).toHaveCount(0)
 await ui('view.open',{kind:'conversation',employee:analyst.id});await expect(page.locator('.transcript .tool').first()).toBeVisible();evidence.ui.push({case:'Company retains full work history',toolsVisibleInCompany:true,toolHistoryNotDeleted:true})
 for(const person of people){evidence.versions.push({employee:person.title,engine:person.engine,model:(await status(person)).model})}
 evidence.passed=true;fs.writeFileSync(path.join(out,'result.json'),redact(evidence));fs.writeFileSync(path.join(out,'progress.json'),redact(evidence));for(const file of ['failure.json','failure.png'])fs.rmSync(path.join(out,file),{force:true});console.log('PASS real-model logical acceptance: '+evidence.cases.length+' semantic cases and '+evidence.ui.length+' UI observations')
}catch(error){evidence.error=String(error.message).replaceAll(key,'[redacted]');fs.writeFileSync(path.join(out,'failure.json'),redact(evidence));await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{});throw Error(evidence.error)}finally{await browser?.close();await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
