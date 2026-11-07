// Real-model semantic acceptance. Business requests never teach API names or parameters.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import sharp from 'sharp'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Explicit authorization required: --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/explicit-private-messages/live'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-direct-real-')),profile=path.join(temp,'claude'),require=createRequire(import.meta.url)
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile)
const key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim(),model='deepseek-flash',sanitize=value=>String(value).replaceAll(key,'[redacted]')
const engines=JSON.parse(execFileSync('/Applications/Aexus Bot.app/Contents/Resources/cli/agents',['engine','list','--json'],{encoding:'utf8'})).data,configuration=engines.find(e=>e.engine==='claude').configuration
const executable=[configuration.path,configuration.managedPath].find(p=>p&&fs.existsSync(p))||require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),sdkPath=configuration.sdkPath&&fs.existsSync(configuration.sdkPath)?configuration.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk')
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model,alwaysThinkingEnabled:false,effortLevel:'low',env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}),{mode:0o600})
const report={passed:false,realModel:true,mockedEngine:false,model,effort:'low',productionDataUsed:false,cases:[]};let f
try{
 f=await fixtureCore({CLAUDE_CONFIG_DIR:profile,CLAUDE_BIN:executable,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_PROXY:'127.0.0.1,localhost'})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,sanitize(value.error));return value.data}
 const until=async(check,label)=>{const start=Date.now();while(Date.now()-start<150000){if(await check())return;await new Promise(r=>setTimeout(r,200))}throw Error('Timed out: '+label)}
 const idle=employee=>until(async()=>{const status=(await rpc('session.status',{employee}))[0];if(status.initialization?.status==='failed')throw Error(status.initialization.error);return status.initialization?.status==='ready'&&!status.busy&&!status.acknowledging},'native employee ready/idle')
 const items=async employee=>(await rpc('direct.history',{employee})).items
 await rpc('group.add',{name:'Explicit private semantic test'});await rpc('engine.configure',{engine:'claude',patch:{sdkPath,path:executable}})
 const a=await rpc('card.create',{title:'晴岚',group:'Explicit private semantic test',engine:'claude',model,effort:'low',thinking:false,permissionMode:'bypassPermissions'}),b=await rpc('card.create',{title:'青禾',group:'Explicit private semantic test',engine:'claude',model,effort:'low',thinking:false,permissionMode:'bypassPermissions'})
 await idle(a.id);await idle(b.id)
 const png=(await sharp({create:{width:180,height:110,channels:3,background:'#526bc3'}}).png().toBuffer()).toString('base64')
 await rpc('workspace.write',{employee:a.id,path:'diagram.png',contentBase64:png,create:true});await rpc('workspace.write',{employee:a.id,path:'brief.txt',content:'PRIVATE_ATTACHMENT_FIXTURE',create:true})
 const beforeRaw=(await items(a.id)).length
 await rpc('session.send',{employee:a.id,sourceView:'company',text:'本次只在完整原生会话中输出 RAW_COMPANY_ONLY_73，不要发私聊，不要发群聊。'})
 await idle(a.id);assert.equal((await items(a.id)).length,beforeRaw)
 report.cases.push({name:'Company native response remains native only',privateMessagesAdded:0})
 const prompt='工作目录里已有 diagram.png 和 brief.txt。请在私聊里分三次发给我：先单独发一句“资料已经准备好了”，再单独发图片，最后单独发文件。不要合并成一条，也不要发群消息。'
 const started=Date.now();await rpc('direct.send',{employee:a.id,text:prompt,clientMessageId:'semantic-private-multipart'});await idle(a.id)
 const first=await items(a.id),posts=first.filter(i=>i.role==='assistant');assert.equal(posts.length,3,'The Agent must explicitly publish three separate messages')
 assert.ok(posts[0].blocks.some(block=>block.kind==='text'&&block.text.includes('资料已经准备好了')));assert.equal(posts[1].images.length,1);assert.equal(posts[2].files[0].name,'brief.txt')
 assert.equal(first.filter(i=>i.role==='user').length,1)
 const full=(await rpc('session.transcript',{employee:a.id,thinking:true})).items,context=full.find(i=>i.role==='user'&&i.text===prompt)?.context
 assert.equal(context.origin.kind,'direct');assert.ok(context.prompt.includes(prompt));assert.ok(context.prompt.includes('[Agents Company message source]'))
 const tools=full.flatMap(i=>i.role==='assistant'?i.blocks.filter(b=>b.kind==='tool'):[]).filter(t=>/agents_company_api/.test(t.name))
 assert.ok(tools.some(t=>JSON.stringify(t.input).includes('direct.post')))
 report.cases.push({name:'Natural private request independently publishes text → image → file',prompt,elapsedMs:Date.now()-started,messages:posts.map(p=>({id:p.id,text:p.blocks.filter(b=>b.kind==='text').map(b=>b.text).join(''),images:p.images?.length??0,files:p.files?.map(f=>f.name)??[]})),apiTools:tools.map(t=>t.input)})
 const group=await rpc('chat.create',{name:'群聊来源验证',members:[a.id,b.id]}),prior=posts.length
 const groupPrompt='请私聊告诉我 17+26 的结果，群里不要发言。青禾只需要知晓，不用回应。'
 const shared=await rpc('chat.send',{id:group.id,text:groupPrompt,mentions:[a.id],clientMessageId:'semantic-group-private'})
 await until(async()=>{const page=await rpc('chat.history',{id:group.id}),message=page.messages.find(m=>m.id===shared.id);return message.deliveries.every(d=>d.status==='completed')},'shared work and silent awareness')
 await idle(a.id);await idle(b.id)
 const after=await items(a.id),newPosts=after.filter(i=>i.role==='assistant').slice(prior);assert.ok(newPosts.length>=1);assert.ok(newPosts.some(p=>p.blocks.some(block=>block.kind==='text'&&block.text.includes('43'))));assert.ok(after.every(i=>i.role!=='user'||i.text!==groupPrompt));assert.equal((await items(b.id)).length,0)
 assert.equal((await rpc('chat.history',{id:group.id})).messages.length,1,'No automatic or accidental group answer')
 const native=(await rpc('session.transcript',{employee:a.id,thinking:true})).items,reading=native.find(i=>i.role==='user'&&i.context?.origin.kind==='group'&&i.context.phase==='read'),working=native.find(i=>i.role==='user'&&i.context?.origin.kind==='group'&&i.context.phase==='work')
 assert.equal(reading.context.origin.name,'群聊来源验证');assert.ok(reading.context.prompt.includes(groupPrompt));assert.ok(working.context.prompt.includes(groupPrompt))
 report.cases.push({name:'Group work privately publishes; awareness stays silent; full read/work wrappers stay Company',prompt:groupPrompt,privatePosts:newPosts.length,silentEmployeeMessages:0,groupMessages:1,companyReadAndWorkContexts:true})
 const opened=(await rpc('session.status',{employee:a.id}))[0].sessionId;await rpc('config.plan',{id:opened,enabled:true});const count=(await items(a.id)).filter(i=>i.role==='assistant').length
 await rpc('direct.send',{employee:a.id,text:'现在只分析，不改任何文件，请在私聊里告诉我 8×9 等于多少。',clientMessageId:'semantic-plan-private'});await idle(a.id)
 const plan=(await items(a.id)).filter(i=>i.role==='assistant').slice(count);assert.ok(plan.some(p=>p.blocks.some(block=>block.kind==='text'&&block.text.includes('72'))),'Planning must still allow communication to the user')
 report.cases.push({name:'Native Plan mode can explicitly reply privately',privatePosts:plan.length})
 report.passed=true;fs.writeFileSync(path.join(out,'result.json'),sanitize(JSON.stringify(report,null,2))+'\n');console.log('PASS real native Claude/DeepSeek: native-only text, independent multi-part private posts, group→private, silent awareness, exact Company contexts and Plan reply')
}catch(error){report.error=sanitize(error);fs.writeFileSync(path.join(out,'failure.json'),sanitize(JSON.stringify(report,null,2))+'\n');throw error}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
