// Real-model semantic acceptance for external Worker delegation. The business prompt never teaches API names, arguments or call order.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Explicit authorization required: --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),outDir=path.join(root,'artifacts/bot-workers'),resultFile=path.join(outDir,'natural-live-result.json'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-bot-natural-')),profile=path.join(temp,'claude'),require=createRequire(import.meta.url)
fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(profile)
const key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim(),model='deepseek-flash',sanitize=value=>String(value).replaceAll(key,'[redacted]')
const engines=JSON.parse(execFileSync('/Applications/Aexus Bot.app/Contents/Resources/cli/agents',['engine','list','--json'],{encoding:'utf8'})).data,configuration=engines.find(e=>e.engine==='claude').configuration
const executable=[configuration.path,configuration.managedPath].find(p=>p&&fs.existsSync(p))||require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),sdkPath=configuration.sdkPath&&fs.existsSync(configuration.sdkPath)?configuration.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk')
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model,alwaysThinkingEnabled:false,effortLevel:'low',env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}),{mode:0o600})
const prompt='老板这边有一个复杂问题要交给 Dot 处理。请把它转给 Dot：让它核算三批数据的汇总结果，最后把总数算出来。Dot 回复很慢，而且会分多条、间隔一段时间才陆续发来，第一条通常只是确认收到。请你从委派开始就持续跟踪它之后发来的每一条回复，不要因为一条确认或一段安静时间就以为结束了，也不要让我自己盯着或反复催你。等它发来明确最终结果后，把其中有用的结果单独私聊报告给我。中间需要安排后续处理时，你自己处理妥当即可。'
const report={passed:false,realModel:true,mockedEngine:false,model,effort:'low',productionDataUsed:false,fixture:{loopback:true,provider:'dots',remoteId:'primary-dot',realAccounts:false},prompt,checks:[],evidence:{},stage:'setup'}
const remote=[{id:'primary-dot',name:'Dot',provider:'dots',kind:'private'}],histories=new Map([['primary-dot',[]]]),fixtureCalls=[],delegationAttempts=[],fixtureErrors=[],files=new Map()
const message=(text)=>({id:randomUUID(),revision:randomUUID(),cursor:String(Date.now()),role:'assistant',text,createdAt:Date.now(),files:[]})
let coreHome,expectedConversation,secretaryId
const server=http.createServer(async(req,res)=>{let input;try{
 let bytes='';for await(const b of req)bytes+=b
 input=JSON.parse(bytes);const a=input.args??{};fixtureCalls.push(input);let result
 switch(input.method){
  case 'list':result=remote.filter(b=>b.provider===a.provider);break
  case 'status':result={issue:null,checkedAt:Date.now()};break;
  case 'messages':result=histories.get(a.binding.remoteId)??[];break
  case 'create':{let b=remote.find(b=>b.id===a.id);if(!b){b={id:a.id,name:a.name,provider:'grok',kind:a.members?'group':'private',participantIds:a.members};remote.push(b);histories.set(b.id,[])}result=b;break}
  case 'send':{
   let state={jobs:[]}
   try{if(coreHome)state=JSON.parse(fs.readFileSync(path.join(coreHome,'schedules.json'),'utf8'))}catch{}
   const at=Date.now(),matching=(state.jobs??[]).filter(j=>j.rule?.kind==='event'&&j.rule.event==='message.received'&&j.rule.conversation===expectedConversation&&j.action?.employeeId===secretaryId)
   delegationAttempts.push({at:new Date(at).toISOString(),requestId:a.requestId,text:a.text,argsKeys:Object.keys(a),schedules:matching.map(j=>({id:j.id,event:j.rule.event,conversation:j.rule.conversation,employeeId:j.action.employeeId,enabled:j.enabled,maxOccurrences:j.maxOccurrences??null,until:j.until??null,createdAt:j.createdAt,selfSchedule:!!j.delegation?.selfSchedule,cooldownSeconds:j.rule.cooldownSeconds}))})
   histories.get(a.binding.remoteId).push({id:a.requestId,requestId:a.requestId,cursor:a.requestId,revision:a.requestId,role:'user',text:a.text,createdAt:at,files:[]})
   result={id:a.requestId,accepted:true};break}
  case 'upload':result={path:'uploaded:'+a.sha256};break
  case 'read':{const b=files.get(a.file.remotePath);if(!b)throw Error('Unknown fixture file');result={data:b.subarray(a.offset,a.offset+a.length).toString('base64'),totalSize:b.length,mimeType:'text/plain'};break}
  default:throw Error('Unknown fixture operation '+input.method)
 }
 res.setHeader('content-type','application/json');res.end(JSON.stringify(result))
 }catch(error){fixtureErrors.push({method:input?.method,message:error.message});res.statusCode=400;res.end(JSON.stringify({error:error.message}))}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
let f,failure
const runEvents=run=>run.events??(run.event?[run.event]:[])
const until=async(check,label,timeout=180000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,250))}throw Error('Timed out after '+timeout+'ms: '+label)}
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs')
 if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:'+server.address().port,CLAUDE_CONFIG_DIR:profile,CLAUDE_BIN:executable,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_PROXY:'127.0.0.1,localhost'},entry)
 coreHome=f.env.AGENTS_COMPANY_HOME
 const rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,sanitize(value.error));return value.data}
 const items=async employee=>(await rpc('direct.history',{employee})).items
 const idle=async(employee,label)=>until(async()=>{const status=(await rpc('session.status',{employee}))[0];if(status?.initialization?.status==='failed')throw Error('Native initialization failed: '+status.initialization.error);return status?.initialization?.status==='ready'&&!status.busy&&!status.acknowledging},label)
 report.engine={engine:'claude',model,effort:'low',permissionMode:'bypassPermissions',realSdk:true,realExecutable:true,executableName:path.basename(executable),settingsMode:'0600',isolatedProfile:true}
 report.stage='secretary-created'
 await rpc('group.add',{name:'Natural worker test'})
 await rpc('engine.configure',{engine:'claude',patch:{sdkPath,path:executable}})
 const secretary=await rpc('card.create',{title:'Secretary',group:'Natural worker test',engine:'claude',model,effort:'low',thinking:false,managementRole:'secretary',permissionMode:'bypassPermissions'})
 secretaryId=secretary.id
 await idle(secretary.id,'Secretary initialized')
 const secretaryToken=await f.token(secretary.id)
 report.stage='dot-import'
 const synced=await rpc('bot.sync'),bots=await rpc('bot.list',{},secretaryToken),dot=bots.find(b=>b.bot?.provider==='dots')
 assert.ok(synced.providers.every(p=>p.connected),'Synthetic fixture providers must connect')
 assert.equal(bots[0]?.bot?.provider,'dots','The synthetic Dot must be the first imported Worker')
 assert.equal(dot.bot.remoteId,'primary-dot');assert.equal(dot.bot.kind,'private');assert.equal(dot.memberIds.length,0,'Secretary must not need a member grant')
 assert.match(dot.conversation,/^group:[a-zA-Z0-9_-]+$/)
 expectedConversation=dot.conversation
 report.checks.push({name:'bot.sync imports synthetic Dot first; Secretary lists it automatically without memberIds',conversation:dot.conversation,memberIds:dot.memberIds})
 report.stage='delegation-discovery'
 const started=Date.now()
 await rpc('direct.send',{employee:secretary.id,text:prompt,clientMessageId:'natural-bot-delegation'})
 const deployment=await until(()=>delegationAttempts[0],'Secretary delegates to the synthetic Dot')
 assert.ok(deployment.text.trim(),'Delegation must contain a real task')
 assert.ok(!/\[Agents Company|agents_company|AGENTS_COMPANY|Core Plan|system instruction|系统提示|You are an AI/i.test(deployment.text),'Delegated task must not contain Company routing wrappers or system instructions')
 assert.deepEqual([...deployment.argsKeys].sort(),['binding','files','requestId','text'],'Provider receives only the raw task contract')
 const watch=deployment.schedules[0]
 assert.ok(watch,'A matching message.received schedule must already be durable on disk when the delegation reaches the provider')
 assert.equal(watch.event,'message.received');assert.equal(watch.conversation,dot.conversation);assert.equal(watch.employeeId,secretary.id)
 assert.equal(watch.enabled,true);assert.equal(watch.selfSchedule,true);assert.notEqual(watch.maxOccurrences,1)
 assert.ok(watch.maxOccurrences===null||watch.maxOccurrences>1,'The reply watch must not stop after one occurrence')
 assert.ok(Date.parse(watch.createdAt)<=Date.parse(deployment.at))
 const apiWatch=(await rpc('schedule.list',{},secretaryToken)).find(j=>j.id===watch.id)
 assert.ok(apiWatch,'The saved watch must be readable through the real Core API');assert.equal(apiWatch.enabled,true);assert.equal(apiWatch.rule.kind,'event');assert.equal(apiWatch.rule.event,'message.received');assert.equal(apiWatch.action.employeeId,secretary.id)
 await idle(secretary.id,'Secretary idle after delegation')
 report.evidence.scheduleBeforeDelegation={delegationAt:deployment.at,delegationText:deployment.text,argsKeys:deployment.argsKeys,watch,elapsedMs:Date.now()-started}
 report.checks.push({name:'Persistent message.received watch for the canonical Dot conversation is on disk before delegation; raw task has no wrapper',elapsedMs:Date.now()-started,watchId:watch.id})
 report.stage='first-reply-wake'
 const ackText='已收到，仍在计算，后续还会继续发结果'
 histories.get('primary-dot').push(message(ackText))
 await rpc('bot.sync')
 const ackItem=await until(async()=>{const history=await items(dot.id);return history.find(item=>item.role==='assistant'&&item.blocks?.some(block=>block.kind==='text'&&block.text===ackText))},'first nonfinal acknowledgment ingested')
 const firstRun=await until(async()=>{const runs=await rpc('schedule.history',{id:watch.id,limit:100});return runs.find(run=>run.status!=='running'&&runEvents(run).some(event=>event.messageId===ackItem.id))},'scheduled wake for the first reply')
 assert.equal(firstRun.status,'succeeded','The real scheduled Secretary work must succeed')
 assert.equal(firstRun.trigger,'event');assert.ok(runEvents(firstRun).every(event=>event.type==='message.received'))
 await idle(secretary.id,'Secretary idle after first scheduled wake')
 const still=await rpc('schedule.get',{id:watch.id})
 assert.equal(still.enabled,true,'The watch must survive the first nonfinal acknowledgment')
 assert.notEqual(still.maxOccurrences,1)
 report.evidence.firstReply={entryId:ackItem.id,text:ackText,runId:firstRun.id,runStatus:firstRun.status,events:runEvents(firstRun),watchEnabledAfter:still.enabled}
 report.checks.push({name:'First nonfinal reply wakes a real scheduled run; the watch remains enabled',runId:firstRun.id})
 report.stage='final-reply-wake'
 await new Promise(r=>setTimeout(r,2000))
 const finalText='复杂问题已经全部计算完成：三批数据分别为 12、17、13，最终总数是 42。'
 histories.get('primary-dot').push(message(finalText))
 await rpc('bot.sync')
 const finalItem=await until(async()=>{const history=await items(dot.id);return history.find(item=>item.role==='assistant'&&item.blocks?.some(block=>block.kind==='text'&&block.text===finalText))},'separately delayed final reply ingested')
 const secondRun=await until(async()=>{const runs=await rpc('schedule.history',{id:watch.id,limit:100});return runs.find(run=>run.id!==firstRun.id&&run.status!=='running'&&runEvents(run).some(event=>event.messageId===finalItem.id))},'second real scheduled wake for the final reply')
 assert.equal(secondRun.status,'succeeded');assert.equal(secondRun.trigger,'event');assert.ok(runEvents(secondRun).every(event=>event.type==='message.received'))
 await idle(secretary.id,'Secretary idle after final scheduled wake')
 const publication=await until(async()=>{const history=await items(secretary.id);return history.filter(item=>item.role==='assistant').find(item=>item.createdAt>=finalItem.createdAt&&item.blocks?.some(block=>block.kind==='text'&&/42|四十二/.test(block.text)))},'explicit private publication of the final result')
 const transcript=(await rpc('session.transcript',{employee:secretary.id,thinking:true})).items
 const tools=transcript.flatMap(item=>item.role==='assistant'?item.blocks.filter(block=>block.kind==='tool'):[])
 const apiCalls=tools.filter(block=>/agents_company_api/.test(String(block.name??''))).map(block=>{let input=block.input;if(typeof input==='string'){try{input=JSON.parse(input)}catch{}}return {command:input?.command,args:input?.args}}).filter(call=>typeof call.command==='string')
 const commands=[...new Set(apiCalls.map(call=>call.command))]
 for(const required of ['bot.list','schedule.create','direct.send','direct.post'])assert.ok(commands.includes(required),'The Agent must independently discover and call '+required+' (saw: '+commands.join(', ')+')')
 assert.ok(tools.every(block=>!/^(Agent|Task)$/i.test(String(block.name??''))),'The Agent must not create artificial child agents')
 assert.ok(tools.filter(block=>/bash|shell|exec/i.test(String(block.name??''))).every(block=>!/\bsleep\s+\d/.test(JSON.stringify(block.input??''))),'The Agent must not fake delays with shell sleeps')
 const jobs=await rpc('schedule.list',{},secretaryToken)
 assert.ok(jobs.every(job=>job.action.employeeId===secretary.id),'The Agent must not create fake tasks for other employees')
 const sessions=(await rpc('session.list')).sessions
 assert.equal(sessions.length,1,'The Agent must not create artificial child employees')
 const sent=await items(secretary.id),userInputs=sent.filter(item=>item.role==='user')
 assert.equal(userInputs.length,1);assert.equal(userInputs[0].text,prompt)
 const postTool=apiCalls.filter(call=>call.command==='direct.post')
 assert.ok(postTool.length>=1,'The final publication must be an explicit direct.post tool call')
 const scheduleTool=apiCalls.filter(call=>call.command==='schedule.create')
 assert.ok(scheduleTool.some(call=>JSON.stringify(call.args??{}).includes('message.received')),'The schedule.create tool call must use a message.received event')
 report.evidence.finalReply={entryId:finalItem.id,text:finalText,runId:secondRun.id,runStatus:secondRun.status,events:runEvents(secondRun),distinctFromFirst:secondRun.id!==firstRun.id}
 report.evidence.publication={itemId:publication.id,createdAt:publication.createdAt,text:publication.blocks.filter(block=>block.kind==='text').map(block=>block.text).join(''),directPostCalls:postTool.length}
 report.evidence.apiCommands=commands
 report.evidence.realToolCalls=apiCalls.map(call=>call.command)
 report.evidence.secondRunAfterFirst=secondRun.id!==firstRun.id
 report.checks.push({name:'A separately delayed final reply wakes a second real run and is explicitly published to the user private ledger',runId:secondRun.id,publicationId:publication.id})
 report.checks.push({name:'Transcript shows real Core API calls; no child agents, shell sleeps or fake task targets',commands})
 report.passed=true
}catch(error){
 failure=error
 report.error={message:sanitize(error?.stack??error),classification:fixtureErrors.length?'fixture':report.stage==='setup'?'harness':'agent/product',stage:report.stage}
}finally{
 try{await f?.close()}catch(error){fixtureErrors.push({method:'close',message:error.message})}
 server.closeAllConnections();await new Promise(r=>server.close(r))
 report.evidence.delegationAttempts=delegationAttempts
 report.fixture.calls=fixtureCalls.map(call=>call.method);report.fixture.errors=fixtureErrors
 fs.writeFileSync(resultFile,sanitize(JSON.stringify(report,null,2))+'\n')
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
if(failure)throw failure
console.log('PASS real native Claude/DeepSeek Secretary: independent Dot discovery, durable persistent message.received watch before delegation, survival of a nonfinal reply, second wake and explicit private result publication')
