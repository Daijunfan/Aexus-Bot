// Replay observed Secretary failures through the real authenticated MCP HTTP and Core dispatch.
// No user state, native agents, network collectors or paid inference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import Ajv2020 from 'ajv/dist/2020.js'
import {COMMANDS} from '../src/shared/api-registry.ts'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-mcp-recovery-')),home=path.join(temp,'state'),previous=process.env.AGENTS_COMPANY_HOME,checks=[]
let core,mcp,peer
fs.mkdirSync(home);process.env.AGENTS_COMPANY_HOME=home
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
const check=message=>checks.push(message)
try{
 const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false})
 for(const command of COMMANDS)if(command.inputSchema)assert.doesNotThrow(()=>ajv.compile(command.inputSchema),command.name)
 check('Every published schema compiles, including oneOf/not schedule constraints')
 const cards=['secretary','peer','employee'].map(id=>({id,title:id,engine:'codex',kind:'worker',group:'A',cwd:temp,createdAt:1,initialization:{status:'ready'},managementRole:id==='employee'?'employee':'secretary'}))
 fs.writeFileSync(path.join(home,'sessions.json'),JSON.stringify({sessions:cards,groups:['A'],teamRoots:{A:temp},rooms:{}}))
 const entry=path.join(temp,'test.cjs')
 await build({stdin:{contents:`export * from './src/main/api-tool';export * from './src/main/documentation-tool';export {openDiscussionMcp} from './src/main/discussion-mcp';export {handleRequest} from './src/main/server';export {withCaller,operatorContext} from './src/main/authorization';export {startScheduler,stopScheduler} from './src/main/scheduler/service';export {closeChannels} from './src/main/channels';export {seedTranscript} from './src/main/transcripts';export {boundedApiResult} from './src/main/api-results';export {nativeToolResult} from './src/main/native-tool-result';export {revokeAgentCredential} from './src/main/agent-access';export {run as sql} from './src/main/channel-store';export {exchangeChannelStorage,completeChannelStorage} from './src/main/channel-storage-transport'`,resolveDir:root},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:entry,define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 core=createRequire(import.meta.url)(entry);core.startScheduler(()=>{})
 const state={cardId:'secretary',running:true,permissionMode:'bypassPermissions',currentTask:{messageId:'turn'}},other={...state,cardId:'peer'}
 core.prepareDocumentationTool(state);core.prepareDocumentationTool(other)
 mcp=await core.openDiscussionMcp(state);peer=await core.openDiscussionMcp(other)
 let seq=0
 const tool=async(name,input,url=mcp.url)=>{
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:input}})})
  const wire=await response.json();assert.equal(wire.error,undefined)
  assert.ok(wire.result.content[0].text.length<=18_000,'Native text must stay below the SDK overflow boundary')
  return {error:wire.result.isError===true,value:JSON.parse(wire.result.content[0].text)}
 }
 const call=(command,args={},url)=>tool('agents_company_api',{command,args},url)
 const success=async(command,args,url)=>{const r=await call(command,args,url);assert.equal(r.error,false,JSON.stringify(r.value));assert.equal(r.value.ok,true);return r.value.data}
 const fail=async(command,args,code,url)=>{const r=await call(command,args,url);assert.equal(r.error,true,command);assert.equal(r.value.code,code);assert.equal(r.value.apiRevision.length,16);return r.value}
 const raw=(command,args={})=>core.handleRequest({cmd:command,args},core.operatorContext())

 const identity=await tool('agents_company_documentation',{operation:'identity'})
 assert.equal(identity.value.employee.id,'secretary')
 const page=await success('api.list')
 assert.ok(page.commands.length<=40);assert.ok(page.nextOffset);assert.equal(page.apiRevision,identity.value.apiRevision)
 const all=[];let offset=0
 do{const page=await success('api.list',{offset,limit:30});all.push(...page.commands);offset=page.nextOffset}while(offset!==null)
 assert.equal(new Set(all.map(c=>c.name)).size,all.length)
 assert.ok(all.some(c=>c.name==='api.result'))
 const schema=await success('api.describe',{command:'schedule.create'})
 assert.equal(schema.apiRevision,identity.value.apiRevision);assert.ok(schema.inputSchema.required.includes('spec'))
 check('Identity/version → compact paged discovery → exact current schema through MCP')

 const invalid=[['api.describe',{name:'schedule.create'}],['engine.models',{}],['card.profile',{}],['session.activity',{employeeId:'employee'}],['session.activity',{sessionId:'employee'}],['session.info',{session:'employee'}],['engine.inspect',{session:'employee',what:'mcp'}],['schedule.create',{name:'flat',action:{type:'agent',employeeId:'employee',prompt:'NO_RUN'},afterSeconds:3600}],['schedule.create',{spec:{name:'nested-key',afterSeconds:3600,clientRequestId:'bad',action:{type:'agent',employeeId:'employee',prompt:'NO_RUN'}}}],['direct.send',{employeeId:'employee',text:'NO_RUN'}],['session.send',{employee:'employee',prompt:'NO_RUN'}],['plan.query',{tags:['bad']}]]
 state.permissionMode='default'
 for(const [command,args] of invalid){const result=await fail(command,args,'INVALID_ARGUMENTS');assert.equal(result.recovery.command,'api.describe')}
 state.permissionMode='bypassPermissions'
 for(const name of ['employee.list','card.list','company.employees','team.list']){const e=await fail(name,{},'UNKNOWN_COMMAND');assert.ok(e.suggestions.length)}
 const badDoc=await tool('agents_company_documentation',{operation:'document',path:'core/api',query:'schedule'})
 assert.equal(badDoc.error,true);assert.match(badDoc.value.message,/Choose|document/)
 assert.equal((await raw('schedule.list')).length,0)
 await assert.rejects(raw('schedule.create',{name:'flat',action:{type:'agent',employeeId:'employee',prompt:'NO_RUN'}}),/requires args.spec/)
 check('Historical malformed requests fail before approval/dispatch, without creating jobs or starting engines')

 const spec={name:'Recovered request',enabled:false,afterSeconds:3600,action:{type:'agent',employeeId:'employee',prompt:'NEVER_EXECUTE'}}
 const job=await success('schedule.create',{spec,clientRequestId:'recovered-once'})
 const retry=await success('schedule.create',{spec,clientRequestId:'recovered-once'});assert.equal(retry.id,job.id)
 const edited=await success('schedule.update',{id:job.id,expectedRevision:job.revision,patch:{name:'Edited'}})
 assert.equal(edited.revision,job.revision+1)
 const conflict=await fail('schedule.update',{id:job.id,expectedRevision:job.revision,patch:{name:'Stale'}},'REVISION_CONFLICT')
 assert.equal(conflict.recovery.command,'schedule.get');assert.equal((await raw('schedule.get',{id:job.id})).name,'Edited')
 assert.equal((await raw('schedule.list')).length,1)
 check('Corrected schedule saves once; idempotent retries and stale-revision protection remain enforced')

 assert.equal(await success('session.activity',{employee:'employee'}),null)
 assert.equal(await success('session.activity',{id:'employee'}),null)
 assert.equal((await success('session.info',{employee:'employee'})).sessionId,null)
 assert.deepEqual(await raw('session.list',{live:true}),[])
 check('Stable employee IDs work while closed; activity/info never open a native session')

 const items=[{id:'one',role:'assistant',blocks:[{kind:'text',text:'Long synthetic result '.repeat(35_000)+'END_OF_RESULT'}],at:Date.now()}]
 core.seedTranscript('employee',items)
 const response=await success('session.transcript',{employee:'employee',limit:1})
 assert.equal(response.kind,'api-result-page');assert.ok(response.totalCharacters>1_000_000)
 let text=response.content,next=response.nextOffset
 while(next!==null){const page=await success('api.result',{id:response.id,offset:next});text+=page.content;next=page.nextOffset}
 assert.deepEqual(JSON.parse(text),{ok:true,data:await raw('session.transcript',{employee:'employee',limit:1})})
 let projected=await success('api.result',{id:response.id,path:'/data/items/0/blocks/0/text',limit:12000}),selected=projected.content
 while(projected.nextOffset!==null){assert.equal(projected.nextCall.args.path,'/data/items/0/blocks/0/text');projected=await success(projected.nextCall.command,projected.nextCall.args);selected+=projected.content}
 assert.equal(JSON.parse(selected),items[0].blocks[0].text)
 await fail('api.result',{id:response.id},'RESULT_UNAVAILABLE',peer.url)
 const largeDoc=await tool('agents_company_documentation',{operation:'document',document:'core/api'})
 assert.equal(largeDoc.error,false);assert.equal(largeDoc.value.data.kind,'api-result-page')
 check('Million-character transcripts and full docs stay successful, lossless and seekable without SDK spill files')

 const escaped={ok:true,data:{text:'"\\\n'.repeat(20_000)}},escapedPage=core.boundedApiResult(core.documentationIdentity(state),'fixture.read',escaped).data
 assert.ok(JSON.stringify({ok:true,data:escapedPage}).length<=18_000)
 let escapedText=escapedPage.content,escapedOffset=escapedPage.nextOffset
 while(escapedOffset!==null){const page=await success('api.result',{id:escapedPage.id,offset:escapedOffset});escapedText+=page.content;escapedOffset=page.nextOffset}
 assert.deepEqual(JSON.parse(escapedText),escaped)

 const image={ok:true,data:{kind:'channel-messages',mode:'images',messages:[{id:'image-message',images:[{id:'image',data:'fixture-base64',mimeType:'image/png'}]}]}}
 const rendered=core.nativeToolResult(core.boundedApiResult(core.documentationIdentity(state),'channel.fetch-images',image))
 assert.equal(rendered.content.at(-1).type,'image');assert.doesNotMatch(rendered.content[0].text,/fixture-base64/)
 image.data.messages[0].body='Long caption '.repeat(20_000)
 const caption=core.nativeToolResult(core.boundedApiResult(core.documentationIdentity(state),'channel.fetch-images',image))
 assert.equal(caption.content.at(-1).type,'image');assert.ok(caption.content[0].text.length<=18_000)
 const captionPage=JSON.parse(caption.content[0].text).data;assert.equal(captionPage.kind,'api-result-page')
 const imageMetadata=await success('api.result',{id:captionPage.id,path:'/data/messages/0/images/0'})
 assert.deepEqual(JSON.parse(imageMetadata.content),{id:'image',mimeType:'image/png'})
 core.revokeAgentCredential('secretary')
 await assert.rejects(core.invokeApiTool(state,{command:'api.result',args:{id:response.id}},'revoked'),/revoked|Invalid/)
 core.prepareDocumentationTool(state)
 await fail('api.result',{id:response.id},'RESULT_UNAVAILABLE')
 const expires=core.boundedApiResult(core.documentationIdentity(state),'fixture.read',escaped).data.id,now=Date.now
 try{Date.now=()=>now()+16*60_000;await fail('api.result',{id:expires},'RESULT_UNAVAILABLE')}finally{Date.now=now}
 check('Native image blocks preserved; peer callers, revoked tokens and replacement credentials cannot read result references')

 const source=await raw('channel.source-add',{plugin:'x',locator:'@storagefixture',name:'Offline storage fixture'})
 core.sql('INSERT INTO collectors VALUES(?,?,?,?,?,NULL)','offline','Offline fixture','fixture-hash','"all"',Date.now())
 core.sql("INSERT INTO metadata VALUES('content_storage',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({collectorId:'offline',hostId:'fixture',directory:'/fixture'}))
 core.sql('INSERT INTO collector_activity VALUES(?,?)','offline',Date.now()-120_000)
 const began=Date.now(),storage=await raw('channel.storage')
 assert.equal(storage.available,false);assert.equal(storage.capacity,null);assert.equal(storage.storage.collectorId,'offline');assert.match(storage.error,/offline/);assert.ok(Date.now()-began<1000)
 const unavailable=await fail('channel.fetch-text',{id:source.channelId,limit:3},'CHANNEL_STORAGE_UNAVAILABLE')
 assert.equal(unavailable.recovery.command,'channel.subscription-status')
 core.sql('UPDATE collector_activity SET last_seen_at=? WHERE collector_id=?',Date.now(),'offline')
 const reconnect=raw('channel.storage'),collector={id:'offline',sourceIds:'all'}
 const exchange=await core.exchangeChannelStorage(collector,{waitMs:1000});assert.equal(exchange.jobs.length,1)
 core.completeChannelStorage(collector,{id:exchange.jobs[0].id,result:{bytes:123}})
 const recovered=await reconnect;assert.equal(recovered.available,true);assert.deepEqual(recovered.capacity,{bytes:123})
 check('Offline storage diagnostics preserve configuration, fail fast and recover after collector heartbeat without local caching')
 console.log('PASS Secretary MCP recovery: '+checks.length+' checks\n'+checks.map(c=>'  '+c).join('\n'))
 if(process.env.AGENTS_COMPANY_TEST_ARTIFACTS){fs.mkdirSync(process.env.AGENTS_COMPANY_TEST_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.AGENTS_COMPANY_TEST_ARTIFACTS,'mcp-recovery.json'),JSON.stringify({passed:true,checks,paidCalls:0,userStateTouched:false},null,2))}
}finally{
 await mcp?.close();await peer?.close();await core?.stopScheduler();core?.closeChannels()
 if(previous===undefined)delete process.env.AGENTS_COMPANY_HOME;else process.env.AGENTS_COMPANY_HOME=previous
 fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
