// Opt-in semantic acceptance: real Claude Code + DeepSeek, disposable employees/data only.
// User-facing requests below contain business intent, not API names or call instructions.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {Temporal} from '@js-temporal/polyfill'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Explicit authorization required: --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/plan-self-access/live'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-plan-real-')),profile=path.join(temp,'claude'),require=createRequire(import.meta.url)
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile);const key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim(),model='deepseek-flash'
const engines=JSON.parse(execFileSync('/Applications/Aexus Bot.app/Contents/Resources/cli/agents',['engine','list','--json'],{encoding:'utf8'})).data,configuration=engines.find(e=>e.engine==='claude').configuration
const executable=[configuration.path,configuration.managedPath].find(p=>p&&fs.existsSync(p))||require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),sdkPath=configuration.sdkPath&&fs.existsSync(configuration.sdkPath)?configuration.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk')
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model,alwaysThinkingEnabled:false,effortLevel:'low',env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}),{mode:0o600})
const report={passed:false,realModel:true,mockedEngine:false,provider:'Existing DeepSeek official route',model,effort:'low',productionDataUsed:false,cases:[]};let f
const sanitize=text=>String(text).replaceAll(key,'[redacted]')
try{
 f=await fixtureCore({CLAUDE_CONFIG_DIR:profile,ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_API_KEY:'',CLAUDE_BIN:executable,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_PROXY:'127.0.0.1,localhost'})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);if(!value.ok)throw Error(cmd+': '+sanitize(value.error));return value.data}
 const until=async(check,label,ms=180000)=>{const start=Date.now();while(Date.now()-start<ms){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,250))}throw Error('Timed out: '+label)}
 await rpc('engine.configure',{engine:'claude',patch:{path:executable,sdkPath,baseUrl:'https://api.deepseek.com/anthropic'}})
 await rpc('group.add',{name:'计划自然语言验收'})
 const people={}
 for(const [name,role]of [['小禾','employee'],['林岚','manager'],['远舟','governor'],['知夏','secretary']]){
  const card=await rpc('card.create',{title:name,managementRole:role,group:'计划自然语言验收',engine:'claude',model,effort:'low',thinking:false,permissionMode:'bypassPermissions'});people[role]=card
  await until(async()=>{const state=(await rpc('session.status',{employee:card.id}))[0];if(state.initialization?.status==='failed')throw Error(name+': '+sanitize(state.initialization.error));return state.initialization?.status==='ready'},name+' real initialization')
  fs.writeFileSync(path.join(card.cwd,'notes.txt'),'合成验收资料：复核材料是否齐全、日期是否一致。此文件不含用户数据。')
  console.log('READY actual '+role+' / Claude Code / '+model)
 }
 const peer=await f.create('沈舟','计划自然语言验收','secretary'),employee=people.employee,manager=people.manager,governor=people.governor,secretary=people.secretary
 const rows=async()=>((await rpc('plan.query',{limit:500})).rows),tomorrow=(hour,minute=0)=>Temporal.Now.zonedDateTimeISO('Asia/Shanghai').add({days:1}).with({hour,minute,second:0,millisecond:0,microsecond:0,nanosecond:0}).toInstant().epochMilliseconds
 const job=async(name,target)=>(await rows()).find(row=>row.name===name&&row.action.employeeId===target.id)
 const ask=async(person,name,prompt,check)=>{
  const before=(await rpc('session.transcript',{employee:person.id})).items.length
  const started=Date.now();await rpc('session.send',{employee:person.id,text:prompt,sourceView:'plan',...(person.managementRole==='governor'?{viewId:'all'}:{})})
  await until(async()=>{const state=(await rpc('session.status',{employee:person.id}))[0];if(state.waitingApproval)throw Error('Unexpected approval in isolated authorized execution');return !state.busy&&!state.acknowledging},name)
  const items=(await rpc('session.transcript',{employee:person.id})).items.slice(before),tools=items.flatMap(item=>item.role==='assistant'?item.blocks.filter(b=>b.kind==='tool'):[]),speech=items.flatMap(item=>item.role==='assistant'?item.blocks.filter(b=>b.kind==='text').map(b=>b.text):[]).join('\n')
  const api=tools.filter(tool=>/agents_company_api|company_api/.test(tool.name)),cli=tools.filter(tool=>/Bash|execute_command|terminal/i.test(tool.name)&&/\b(?:agents|aexus-bot)\b.*\b(?:schedule|plan)\b/s.test(JSON.stringify(tool.input)))
  assert.ok(api.length+cli.length>0,name+' did not use the application API/CLI')
  await check();const saved=await rows();assert.ok(saved.every(row=>!row.nextAt||Date.parse(row.nextAt)>Date.now()),'A planning request must not run a due task now')
  assert.equal((await rpc('schedule.history')).length,0,'No plan should execute while it is being arranged')
  report.cases.push({name,actor:person.title,role:person.managementRole,prompt,elapsedMs:Date.now()-started,apiCommands:api.map(tool=>tool.input?.command).filter(Boolean),cliCalls:cli.length,speech:sanitize(speech),jobs:saved.map(row=>({id:row.id,name:row.name,employeeId:row.action.employeeId,rule:row.rule,revision:row.revision,createdBy:row.createdBy}))});console.log('PASS actual model: '+name)
 }
 await ask(employee,'Employee independently discovers self one-time and recurring scheduling','请给你自己安排两项工作，采用上海时间：明天下午15:00做一次资料复核，命名“一次资料复核”；以后每周一上午09:30复核资料，命名“员工每周资料复核”。内容都是核对你工作目录中的 notes.txt，然后把结论告诉我；每次预计20分钟。现在只安排，不要立即执行。完成后核对已保存的安排，告诉我具体时间。',async()=>{
  const one=await job('一次资料复核',employee),repeat=await job('员工每周资料复核',employee);assert.ok(one&&repeat);assert.equal(one.rule.kind,'once');assert.equal(Date.parse(one.rule.at),tomorrow(15));assert.equal(repeat.rule.kind,'weekly');assert.deepEqual(repeat.rule.days,[1]);assert.equal(repeat.rule.time,'09:30');assert.equal(repeat.rule.timezone,'Asia/Shanghai')
 })
 const original=(await job('一次资料复核',employee)).id
 await ask(manager,'Manager edits employee-created subordinate plan and creates own/assigned recurring work','小禾是你团队的员工。把小禾的“一次资料复核”从明天15:00调整到16:00，保留原任务。另给你自己安排“经理每周资料复核”，每周一10:00；再给小禾安排“上级分配的周报”，每周三10:00。都按上海时间，内容是复核各自工作目录的 notes.txt 并汇总结果。现在只保存安排，不要开始执行。',async()=>{
  const one=await job('一次资料复核',employee);assert.equal(one.id,original);assert.equal(Date.parse(one.rule.at),tomorrow(16));assert.ok(await job('经理每周资料复核',manager));assert.ok(await job('上级分配的周报',employee))
 })
 const assigned=(await job('上级分配的周报',employee)).id
 await ask(employee,'Employee edits a superior-created task assigned to itself','把分配给你自己的“上级分配的周报”改到每周三下午14:00，上海时间。修改原来的安排，不要新建、不要现在执行，其他要求保持不变。',async()=>{const changed=await job('上级分配的周报',employee);assert.equal(changed.id,assigned);assert.equal(changed.rule.time,'14:00');assert.deepEqual(changed.rule.days,[3])})
 await ask(governor,'Governor schedules itself and edits lower-role Manager plan','林岚是经理。把林岚的“经理每周资料复核”改为每周二11:00；同时给你自己安排“总督资料复核”，明天下午14:00复核自己的 notes.txt 并汇总。都采用上海时间。现在只安排，不要马上运行，修改已有任务时保留原记录。',async()=>{const lower=await job('经理每周资料复核',manager),self=await job('总督资料复核',governor);assert.deepEqual(lower.rule.days,[2]);assert.equal(lower.rule.time,'11:00');assert.ok(self);assert.equal(Date.parse(self.rule.at),tomorrow(14));assert.equal(self.action.viewId,'all')})
 await ask(secretary,'Secretary independently schedules a peer Secretary and itself','沈舟与你同为Secretary。请给沈舟安排“秘书同级一次复核”，明天16:00；再给沈舟安排“秘书同级每周复核”，每周四09:00。给你自己也安排“秘书每日复核”，每天08:30。都采用上海时间，工作内容为复核目标自己的资料并给我总结。现在只建立安排，不要让任何人立即执行，也不要让沈舟代你设置。完成后核对保存结果。',async()=>{assert.ok(await job('秘书同级一次复核',peer));const repeat=await job('秘书同级每周复核',peer),self=await job('秘书每日复核',secretary);assert.deepEqual(repeat.rule.days,[4]);assert.equal(repeat.rule.time,'09:00');assert.equal(repeat.rule.timezone,'Asia/Shanghai');assert.equal(self.rule.days.length,7)})
 report.passed=true;report.jobs=(await rows()).length;assert.equal((await rpc('schedule.history')).length,0)
}catch(error){report.error=sanitize(error.stack||error);throw Error(sanitize(error.message))}
finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
