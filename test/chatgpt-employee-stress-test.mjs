import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {fixtureCore} from './fixtures/headless-core.mjs'

const root=path.resolve(import.meta.dirname,'..')
const fixture=await fixtureCore({},path.join(root,'out/main/daemon.js'))
try {
  await fixture.stop()
  const bin=path.join(fixture.temp,'bin')
  fs.mkdirSync(bin)
  const stateFile=path.join(bin,'browser.json')
  const holdFile=path.join(bin,'hold-generation')
  // The stub runs the real bridge script, supplying deterministic browser observations.
  const driver=path.join(bin,'browser.mjs')
  fs.writeFileSync(driver,`
    import fs from 'node:fs'
    const stateFile=${JSON.stringify(stateFile)}
    const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)): {count:0,clicks:[]}
    let draft=state.draft??'', time=0, filledThisRun=false
    const home='https://chatgpt.com/'
    const chat=home+'c/00000000-0000-0000-0000-000000000001'
    const url=()=>state.count?chat:home
    const page={
      label:'p1',url(){if(filledThisRun&&draft==='abort-before-click'){state.draft=draft;fs.writeFileSync(stateFile,JSON.stringify(state));process.exit(42)}return url()},goto(){},snapshot(){},
      fill(selector,text){if(!text&&draft==='abort-before-click')state.clearedPreparedDraft=true;draft=text;filledThisRun=true},
      click(){
        if(draft==='uncertain-click')process.exit(42)
        const previous=state.count
        state.count++
        delete state.draft
        state.user=draft
        state.clicks.push(draft)
        fs.writeFileSync(stateFile,JSON.stringify(state))
        draft=''
        time=Date.now()
        if(state.user.startsWith('crash-after-click'))process.exit(42)
      },
      evaluate(){
        const n=state.count
        const elapsed=Date.now()-time
        const active=time&&(elapsed<600||fs.existsSync(${JSON.stringify(holdFile)}))
        return {url:url(),key:n?'turn-'+n:undefined,answerId:n&&!active?'answer-'+n:undefined,
          answer:n&&!active?'reply:'+state.user:undefined,streaming:active?'reply:':'',
          previousKey:n>1?'turn-'+(n-1):undefined,previousAnswer:n>1?'answer-'+(n-1):undefined,
          turnCount:n,user:state.user,state:active?'in_progress':'complete',
          stop:!!active,signedIn:true,draft,waiting:false}
      }
    }
    globalThis.taskSpace=async()=>({pages:async()=>[page]})
    console.log=console.error
    let source=''
    for await(const chunk of process.stdin)source+=chunk
    await new (Object.getPrototypeOf(async function(){}).constructor)(source)()
  `)
  fs.writeFileSync(path.join(bin,'ego-browser'), `#!/bin/sh\nexec "${process.execPath}" "${driver}"\n`,{mode:0o700})
  fixture.env.PATH=bin+path.delimiter+fixture.env.PATH
  await fixture.start()
  const request=(cmd,args)=>fixture.request(null,cmd,args)
  const call=async(cmd,args)=>{const value=await request(cmd,args);assert.ok(value.ok,value.error);return value.data}
  await call('group.add',{name:'Stress',mode:'build'})
  const employee=(await call('card.create',{title:'Stress GPT',group:'Stress',engine:'chatgpt'})).id
  assert.equal((await request('card.access-mode',{id:employee,mode:'isolated'})).ok,false)
  assert.equal((await request('card.initialize',{id:employee})).ok,false)
  const send=(text,key=text)=>request('direct.send',{employee,text,clientMessageId:key})
  const history=async()=>(await call('direct.history',{employee,limit:500})).items
  const clicks=()=>JSON.parse(fs.readFileSync(stateFile)).clicks
  const wait=async(fn,label)=>{
    for(let i=0;i<300;i++){const value=await fn();if(value)return value;await delay(100)}
    throw Error('Timed out waiting for '+label)
  }
  const reply=(rows,text)=>rows.some(row=>row.role==='assistant'&&row.blocks[0]?.text==='reply:'+text)
  const measured=async(size,name)=>{
    const start=performance.now()
    const inputs=Array.from({length:size},(_,i)=>name+'-'+i)
    const responses=await Promise.all(inputs.map(async input=>{
      const result=await send(input)
      return {input,ms:performance.now()-start,result}
    }))
    const p95=responses.map(row=>row.ms).sort((a,b)=>a-b)[Math.ceil(size*.95)-1]
    const accepted=responses.filter(row=>row.result.ok).map(row=>row.input)
    const rejected=responses.filter(row=>!row.result.ok)
    console.log(JSON.stringify({size,p95Ms:Math.round(p95),accepted:accepted.length,rejected:rejected.length,errors:[...new Set(rejected.map(x=>x.result.error))]}))
    return {accepted,rejected,start}
  }
  for(const [size,name] of [[1,'baseline'],[8,'peak'],[32,'spike'],[64,'extreme']]){
    // Keep the first reply in flight until all arrivals have reached admission.
    if(size>=32)fs.writeFileSync(holdFile,'')
    const {accepted,rejected,start}=await measured(size,name)
    if(size>=32){
      const queued=(await history()).find(row=>row.role==='user'&&row.delivery?.state==='queued')
      assert.ok(queued)
      const replay=await send(queued.text)
      assert.ok(replay.ok&&replay.data.directMessageId===queued.id)
    }
    fs.rmSync(holdFile,{force:true})
    assert.equal(accepted.length,Math.min(size,9))
    assert.ok(rejected.every(({result})=>result.error.includes('8 messages waiting')))
    const rows=await wait(async()=>{const rows=await history();return accepted.every(text=>reply(rows,text))&&rows},name+' drain')
    assert.equal(rows.filter(row=>row.role==='assistant'&&row.blocks[0]?.text.startsWith('reply:'+name+'-')).length,accepted.length)
    assert.ok(rejected.every(({input})=>!clicks().includes(input)))
    console.log(JSON.stringify({size,drainMs:Math.round(performance.now()-start)}))
    if(rejected.length){
      const {input}=rejected[0]
      assert.ok((await send(input)).ok)
      await wait(async()=>reply(await history(),input),'admission after queue drain')
      assert.equal(clicks().filter(text=>text===input).length,1)
    }
  }
  const duplicate=await Promise.all(Array.from({length:16},()=>send('duplicate','one-key')))
  assert.ok(duplicate.every(r=>r.ok&&r.data.directMessageId===duplicate[0].data.directMessageId))
  await wait(async()=>reply(await history(),'duplicate'),'deduplication')
  assert.equal(clicks().filter(text=>text==='duplicate').length,1)
  const recover=(messageId,action)=>request('direct.chatgpt-recover',{employee,messageId,action})
  const failed=async result=>wait(async()=> (await history()).find(row=>row.id===result.data.directMessageId)?.delivery?.state==='failed','interrupted delivery')
  const beforeClick=await send('abort-before-click')
  assert.ok(beforeClick.ok)
  assert.ok((await send('after-pre-click-abort')).ok)
  await failed(beforeClick)
  await wait(async()=>reply(await history(),'after-pre-click-abort'),'queue continues after proven unsent')
  assert.ok(!clicks().includes('abort-before-click'))
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).clearedPreparedDraft,true)
  console.log('PASS original pre-click crash reproducer now drains the queue without resending')
  const uncertain=await send('uncertain-click')
  assert.ok(uncertain.ok)
  await failed(uncertain)
  const queued=await send('after-uncertain-click')
  assert.equal(queued.data.status,'queued')
  assert.ok(!clicks().includes('after-uncertain-click'))
  const live=(await call('session.list',{live:true,summary:true})).find(s=>s.cardId===employee)
  assert.equal(live?.chatGPTRecovery,uncertain.data.directMessageId)
  assert.equal(live?.pendingMessages?.length,1)
  assert.equal((await recover('stale-message','unsent')).ok,false)
  const agentToken=await fixture.token(employee)
  assert.equal((await fixture.request(agentToken,'direct.chatgpt-recover',{employee,messageId:uncertain.data.directMessageId,action:'unsent'})).ok,false)
  const resolved=await recover(uncertain.data.directMessageId,'unsent')
  assert.ok(resolved.ok,resolved.error)
  await wait(async()=>reply(await history(),'after-uncertain-click'),'queue resumes after operator confirmation')
  assert.ok(!clicks().includes('uncertain-click'))
  console.log('PASS uncertain delivery pauses queue until authorized resolution')
  const crash=await send('crash-after-click')
  assert.ok(crash.ok)
  await wait(async()=> (await history()).find(row=>row.id===crash.data.directMessageId)?.delivery?.state==='failed','visible bridge failure')
  assert.ok((await send('crash-after-click')).ok)
  const retryStatus=(await history()).find(row=>row.id===crash.data.directMessageId)?.delivery?.state
  console.log(JSON.stringify({deliveryAfterDuplicateRetry:retryStatus}))
  assert.equal(retryStatus,'failed')
  const recoveryStart=performance.now()
  assert.equal((await send('after-crash')).data.status,'queued')
  assert.equal((await recover(crash.data.directMessageId,'unsent')).ok,false)
  const checked=await recover(crash.data.directMessageId,'check')
  assert.ok(checked.ok,checked.error)
  const recovered=await wait(async()=>{const rows=await history();return reply(rows,'after-crash')&&rows},'bridge recovery')
  console.log(JSON.stringify({recoveryMs:Math.round(performance.now()-recoveryStart)}))
  assert.ok(reply(recovered,'crash-after-click'))
  assert.equal(clicks().filter(text=>text==='crash-after-click').length,1)
  assert.ok(recovered.filter(row=>row.role==='assistant').every(row=>row.reply?.id&&recovered.some(source=>source.id===row.reply.id&&'reply:'+source.text===row.blocks[0].text)))
  const bindingFile=path.join(fixture.env.AGENTS_COMPANY_HOME,'chatgpt',employee+'.json')
  const savedText='crash-after-click-with-saved-reply'
  const interrupted=await send(savedText)
  assert.ok(interrupted.ok)
  await wait(async()=> (await history()).find(row=>row.id===interrupted.data.directMessageId)?.delivery?.state==='failed','interrupted publication')
  const pendingFile=bindingFile+'.pending'
  const pending=JSON.parse(fs.readFileSync(pendingFile,'utf8'))
  const browser=JSON.parse(fs.readFileSync(stateFile,'utf8'))
  const completed={ok:true,url:pending.binding.url,key:'turn-'+browser.count,answerId:'answer-'+browser.count,text:'reply:'+savedText}
  fs.writeFileSync(pendingFile,JSON.stringify({...pending,completed}))
  fs.writeFileSync(stateFile,JSON.stringify({...browser,user:'changed browser DOM'}))
  assert.equal((await send('after-saved-reply')).data.status,'queued')
  const imported=await recover(interrupted.data.directMessageId,'check')
  assert.ok(imported.ok,imported.error)
  const savedRows=await wait(async()=>{const rows=await history();return reply(rows,'after-saved-reply')&&rows},'recovery from saved response')
  assert.ok(reply(savedRows,savedText))
  assert.equal(clicks().filter(text=>text===savedText).length,1)
  console.log('PASS recovered exact saved reply after the browser DOM changed')
  const binding=fs.readFileSync(bindingFile,'utf8')
  fs.writeFileSync(bindingFile,JSON.stringify({...JSON.parse(binding),answerId:'stale-answer'}))
  const stale=await send('stale-anchor')
  assert.ok(stale.ok)
  await wait(async()=> (await history()).find(row=>row.id===stale.data.directMessageId)?.delivery?.state==='failed','stale anchor rejection')
  assert.ok(!fs.existsSync(bindingFile+'.pending')&&!clicks().includes('stale-anchor'))
  fs.writeFileSync(bindingFile,binding)
  assert.ok((await send('after-stale-anchor')).ok)
  await wait(async()=>reply(await history(),'after-stale-anchor'),'recovery after stale anchor')
  console.log('PASS stale anchor refused before browser submit and valid anchor recovered')
  console.log('PASS 16 duplicate submissions, post-click bridge crash, reply binding and recovery without resend')
} finally {
  await fixture.close()
}
