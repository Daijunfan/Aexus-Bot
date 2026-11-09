// Explicit opt-in: billed native inference, disposable employees and group only.
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'

if(process.env.AGENTS_TEST_DSH_LIVE!=='1'||!process.env.AGENTS_TEST_DSH_BIN){
 console.log('SKIP: set AGENTS_TEST_DSH_LIVE=1 and AGENTS_TEST_DSH_BIN for billed native group smoke test')
 process.exit(0)
}
let f
const until=async(check,label)=>{
 const deadline=Date.now()+180000
 while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,500))}
 throw Error('Timeout: '+label)
}
try{
 f=await fixtureCore({DSH_HOME:process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),DEEPSEEK_BIN:process.env.AGENTS_TEST_DSH_BIN})
 const rpc=async(cmd,args={})=>{const result=await f.request(null,cmd,args);assert.ok(result.ok,result.error);return result.data}
 await rpc('group.add',{name:'Isolated native test'})
 const card=await rpc('card.create',{title:'DeepSeek group test',group:'Isolated native test',engine:'deepseek',effort:'low',permissionMode:'default'})
 await until(async()=>{const c=await f.status(card.id);assert.notEqual(c.initialization?.status,'failed',c.initialization?.error);return c.initialization?.status==='ready'},'native initialization')
 const group=await rpc('chat.create',{name:'Disposable DeepSeek group',members:[card.id]})
 const history=async()=>(await rpc('chat.history',{id:group.id})).messages
 for(const [text,mentions] of [['大家好',undefined],['请在群里用一句话介绍自己。',[card.id]]]){
  const sent=await rpc('chat.send',{id:group.id,text,...(mentions?{mentions}:{})})
  await until(async()=>{const message=(await history()).find(m=>m.id===sent.id),delivery=message.deliveries[0];assert.ok(!['failed','interrupted'].includes(delivery.status),delivery.error||delivery.status);return delivery.status==='completed'&&delivery.readAt},'native group reply')
  const replies=(await history()).filter(m=>m.replyTo===sent.id&&m.author.employeeId===card.id)
  assert.ok(replies.length>0,'Native model completed work without publishing a group reply')
  assert.ok(replies.every(m=>m.text.trim()&&!/静默阅读/.test(m.text)))
  console.log('PASS real DeepSeek '+(mentions?'mention':'broadcast')+': read receipt and explicit public reply')
 }
 assert.equal((await rpc('direct.history',{employee:card.id})).items.length,0)
 console.log('PASS real DeepSeek group smoke: no private-chat leakage; temporary home only')
}finally{await f?.close()}
