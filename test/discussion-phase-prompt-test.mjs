// Phase projections over temporary real stores; no engine or provider is started.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-phase-prompts-')),home=path.join(temp,'home'),entry=path.join(temp,'test.cjs'),previous=process.env.AGENTS_COMPANY_HOME
process.env.AGENTS_COMPANY_HOME=home;fs.mkdirSync(home);fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
let core
try{
 fs.writeFileSync(path.join(home,'sessions.json'),JSON.stringify({sessions:[{id:'reader',title:'Reader',engine:'codex',kind:'worker',group:'Studio',cwd:temp,createdAt:1,initialization:{status:'ready'},managementRole:'employee'}],groups:['Studio'],rooms:{}}))
 await build({stdin:{contents:"export * from './src/main/chat-groups';export * from './src/main/channels';export {channelTaskPrompt,recordChannelDelivery} from './src/main/channel-discussion';export {run,all} from './src/main/channel-store';export {withCaller,operatorContext} from './src/main/authorization'",resolveDir:root,sourcefile:'phase-prompt-entry.ts'},outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 core=createRequire(import.meta.url)(entry)
 const op=fn=>core.withCaller(core.operatorContext(),fn),delegation={requestedBy:{kind:'operator'},requestId:'fixture'},metadata=prompt=>JSON.parse(prompt.split('[Group request]\n')[1].split('\n')[0])
 const group=await op(()=>core.createChatGroup({name:'Real group identity',members:['reader']})),file=path.join(home,'chats',group.id+'.json')
 const original={id:'gm_original',sequence:1,createdAt:100,author:{kind:'agent',employeeId:'reader'},authorName:'Reader',text:'Original reply text 中文',kind:'summary',mentions:[],deliveries:[]}
 const request={id:'gm_request',sequence:2,createdAt:200,author:{kind:'operator'},authorName:'You',text:'Stored request',kind:'message',mentions:['reader'],replyTo:original.id,deliveries:[{employeeId:'reader',mode:'work',status:'running'}]}
 fs.writeFileSync(file,JSON.stringify([original,request]));const groupContext={groupId:group.id,messageId:request.id},accepted='Accepted original request',groupReading=op(()=>core.chatTaskPrompt(groupContext,'reader',delegation,accepted,true)),groupWork=op(()=>core.chatTaskPrompt(groupContext,'reader',delegation,accepted))
 assert.deepEqual(metadata(groupReading),metadata(groupWork));assert.equal(metadata(groupReading).reply.text,original.text);assert.deepEqual(metadata(groupReading).author,request.author);assert.equal(metadata(groupReading).createdAt,request.createdAt);assert.equal(metadata(groupReading).acknowledgment.mode,'work');assert.equal(groupReading.split('\n').slice(3).join('\n'),accepted)
 assert.ok(!groupReading.includes('[Group reporting]')&&!groupReading.includes('agents chat context')&&!groupReading.includes('agents chat post'));assert.equal(groupWork,groupReading);assert.ok(!groupWork.includes('[Group reporting]'))

 assert.throws(()=>op(()=>core.channelRequest('channel.message-post',{id:'readonly-channel',text:'No legacy publishing'})),/read-only|只读/i)
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),[original,request])
 const reader=fn=>core.withCaller({principal:{kind:'agent',employeeId:'reader'},requestId:'explicit-receipt'},fn)
 // Simulate the Core's successful native completion, never an Agent null post.
 core.updateChatDelivery('reader',groupContext,{deliveredAt:200,readAt:201})
 assert.equal(metadata(op(()=>core.chatTaskPrompt(groupContext,'reader',delegation,accepted))).acknowledgment.acknowledged,true)
 console.log('PASS group/channel ACK projections preserve authentic context without response/history instructions or writes; formal prompts omit repeated manuals and show acknowledged:true after native completion receipts; no engines')
}finally{core?.closeChannels();if(previous===undefined)delete process.env.AGENTS_COMPANY_HOME;else process.env.AGENTS_COMPANY_HOME=previous;fs.rmSync(temp,{recursive:true,force:true})}
