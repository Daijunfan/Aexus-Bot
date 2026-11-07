// Opt-in real-model acceptance for both installed native ACP engines, isolated profiles only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {Temporal} from '@js-temporal/polyfill'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Explicit authorization required: --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-acp-natural-')),home=path.join(temp,'home'),xdg=path.join(temp,'config'),nativeHome=os.homedir(),out=path.join(root,'artifacts/additional-engines'),native=JSON.parse(fs.readFileSync(path.join(nativeHome,'.config/kilo/kilo.jsonc')))
const report={passed:false,realModels:true,mockedEngine:false,provider:'Existing official DeepSeek route',model:'deepseek-flash',effort:'low',productionDataUsed:false,cases:[]};let f
try{
 fs.mkdirSync(home,{recursive:true})
 for(const engine of ['opencode','kilo']){const dir=path.join(xdg,engine);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,engine+'.jsonc'),JSON.stringify({...native,$schema:engine==='kilo'?'https://app.kilo.ai/config.json':'https://opencode.ai/config.json',permission:{'*':'ask'}}),{mode:0o600})}
 f=await fixtureCore({HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:xdg,XDG_DATA_HOME:path.join(temp,'data'),XDG_STATE_HOME:path.join(temp,'state'),XDG_CACHE_HOME:path.join(temp,'cache'),OPENCODE_BIN:path.join(nativeHome,'.npm-global/bin/opencode'),KILO_BIN:path.join(nativeHome,'.npm-global/bin/kilo'),NO_PROXY:'127.0.0.1,localhost'})
 const rpc=async(cmd,args={})=>{const result=await f.request(null,cmd,args);if(!result.ok)throw Error(cmd+': '+result.error);return result.data}
 const until=async(check,label)=>{const start=Date.now();while(Date.now()-start<150000){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250))}throw Error('Timed out '+label)}
 await rpc('group.add',{name:'原生引擎自然验收'})
 for(const engine of ['opencode','kilo']){
  const card=await rpc('card.create',{title:engine+' 验收员工',group:'原生引擎自然验收',engine,model:'deepseek-official/deepseek-flash',effort:'low',permissionMode:'bypassPermissions'})
  await until(async()=>{const status=(await rpc('session.status',{employee:card.id}))[0];if(status.initialization?.status==='failed')throw Error(status.initialization.error);return status.initialization?.status==='ready'},'real native initialization')
  const prompt='请给你自己安排两项工作，采用上海时间：明天下午15:00做一次资料复核，命名“一次资料复核”；以后每周一上午09:30复核资料，命名“每周资料复核”。内容是核对工作目录中的资料，再把结论告诉我。现在只安排，不要立即执行。完成后核对已保存的安排，告诉我具体时间。'
  const before=(await rpc('session.transcript',{employee:card.id})).items.length,started=Date.now();await rpc('session.send',{employee:card.id,text:prompt,sourceView:'plan'})
  await until(async()=>{const status=(await rpc('session.status',{employee:card.id}))[0];return !status.busy&&!status.acknowledging},'natural scheduling')
  const rows=(await rpc('plan.query',{limit:500})).rows.filter(r=>r.action.employeeId===card.id),one=rows.find(r=>r.name==='一次资料复核'),repeat=rows.find(r=>r.name==='每周资料复核')
  assert.ok(one&&repeat,'The actual native Agent must persist both requested plans');assert.equal(one.rule.kind,'once');assert.equal(Date.parse(one.rule.at),Temporal.Now.zonedDateTimeISO('Asia/Shanghai').add({days:1}).with({hour:15,minute:0,second:0,millisecond:0,microsecond:0,nanosecond:0}).toInstant().epochMilliseconds);assert.equal(repeat.rule.kind,'weekly');assert.deepEqual(repeat.rule.days,[1]);assert.equal(repeat.rule.time,'09:30');assert.equal(repeat.rule.timezone,'Asia/Shanghai');assert.equal((await rpc('schedule.history')).length,0)
  const items=(await rpc('session.transcript',{employee:card.id})).items.slice(before),blocks=items.flatMap(item=>item.role==='assistant'?item.blocks:[]),api=blocks.filter(b=>b.kind==='tool'&&(/agents_company_api/.test(b.name)||/"command"\s*:\s*"(?:plan|schedule)\./.test(b.command??'')))
  report.observedTools=blocks.filter(b=>b.kind==='tool').map(b=>({name:b.name,input:b.input,command:b.command}));assert.ok(api.length>0,'The Agent must independently call the supplied native application API')
  report.cases.push({engine,prompt,elapsedMs:Date.now()-started,apiTools:api.map(b=>({name:b.name,input:b.input,command:b.command})),speech:blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\n'),jobs:rows.map(r=>({name:r.name,id:r.id,employee:r.action.employeeId,engine:r.action.engine,rule:r.rule}))});console.log('PASS natural native '+engine+': independently uses Bot API to save self once/weekly plans')
 }
 report.pro=await rpc('engine.probe',{engine:'kilo',confirm:true,model:'deepseek-official/deepseek-v4-pro'});assert.equal(report.pro.text,'OK');report.passed=true;report.historyRuns=(await rpc('schedule.history')).length;fs.writeFileSync(path.join(out,'natural-result.json'),JSON.stringify(report,null,2)+'\n')
}catch(error){report.error=String(error);fs.writeFileSync(path.join(out,'natural-failure.json'),JSON.stringify(report,null,2)+'\n');throw error}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
