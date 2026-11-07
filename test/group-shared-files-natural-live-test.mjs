// Real native Claude + DeepSeek. Business requests name no tool, API or parameter.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import sharp from 'sharp'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Explicit live acceptance flag required')
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/shared-files/live')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-shared-real-')),profile=path.join(temp,'claude'),require=createRequire(import.meta.url)
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile)
const key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim(),model='deepseek-flash',sanitize=value=>String(value).replaceAll(key,'[redacted]')
const configuration=JSON.parse(execFileSync('/Applications/Aexus Bot.app/Contents/Resources/cli/agents',['engine','list','--json'],{encoding:'utf8'})).data.find(e=>e.engine==='claude').configuration
const executable=[configuration.path,configuration.managedPath].find(p=>p&&fs.existsSync(p))||require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),sdkPath=configuration.sdkPath&&fs.existsSync(configuration.sdkPath)?configuration.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk')
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model,alwaysThinkingEnabled:false,effortLevel:'low',env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}),{mode:0o600})
const report={passed:false,realModel:true,model,effort:'low',productionDataUsed:false,cases:[]};let f
try{
 f=await fixtureCore({CLAUDE_CONFIG_DIR:profile,CLAUDE_BIN:executable,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_PROXY:'127.0.0.1,localhost'})
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,sanitize(r.error));return r.data}
 const until=async(check,label)=>{const start=Date.now();while(Date.now()-start<180000){if(await check())return;await new Promise(r=>setTimeout(r,200))}throw Error('Timeout '+label)}
 const idle=employee=>until(async()=>{const s=(await rpc('session.status',{employee}))[0];if(s.initialization?.status==='failed')throw Error(s.initialization.error);return s.initialization?.status==='ready'&&!s.busy&&!s.acknowledging},'native ready/idle')
 await rpc('group.add',{name:'Shared file semantic test'});await rpc('engine.configure',{engine:'claude',patch:{sdkPath,path:executable}})
 const create=async(title,managementRole='employee')=>{const employee=await rpc('card.create',{title,managementRole,group:'Shared file semantic test',engine:'claude',model,effort:'low',thinking:false,permissionMode:'bypassPermissions'});await idle(employee.id);return employee}
 const a=await create('晴岚'),b=await create('青禾'),secretary=await create('知夏','secretary'),group=await rpc('chat.create',{name:'共享文稿',members:[a.id,b.id]}),conversation='group:'+group.id
 const shared=await rpc('conversation.workspace',{conversation}),initial='PROJECT_NOTE\nStatus: draft\n'
 await rpc('conversation.file',{conversation,operation:'write',path:'brief.txt',content:initial,create:true})
 const upload=async(name,bytes)=>{const begun=await rpc('messenger.upload-begin',{conversation,name,bytes:bytes.length});await rpc('transfer.upload-chunk',{id:begun.id,offset:0,data:bytes.toString('base64')});return (await rpc('transfer.upload-commit',{id:begun.id})).destination}
 const png=await sharp({create:{width:12,height:8,channels:3,background:'#527dcc'}}).png().toBuffer(),image=await upload('diagram.png',png)
 const original=await rpc('chat.send',{id:group.id,text:'这里是文稿和配图，先知悉即可。',files:['@workspace/brief.txt'],images:[image],clientMessageId:'natural-source-files'})
 const settled=async id=>until(async()=>{const m=(await rpc('chat.history',{id:group.id})).messages.find(m=>m.id===id);if(m.deliveries.some(d=>d.status==='failed'))throw Error(JSON.stringify(m.deliveries));return m.deliveries.every(d=>d.status==='completed')},'group settled')
 await settled(original.id);await idle(a.id);await idle(b.id)
 const requests=[{employee:a,token:'Status: reviewed',prompt:'晴岚，请把刚才群里分享的 brief.txt 下载到你自己的工作目录，把其中的 Status: draft 改成 Status: reviewed，然后上传替换群里的同名文件。在群里单独发一条“第一轮修改完成”，附上更新的文稿和原配图。不要给我私聊。青禾只需知悉。'},
 {employee:b,token:'Second review: accepted',prompt:'青禾，请把群里第一轮更新的 brief.txt 下载到你自己的工作目录，保留第一轮修改，在末尾另加一行 Second review: accepted，再上传替换群里的同名文件。在群里发“第二轮修改完成”并附上文件。不要给我私聊。晴岚只需知悉。'}]
 for(let index=0;index<requests.length;index++){
  const {employee,token,prompt}=requests[index],sent=await rpc('chat.send',{id:group.id,text:prompt,mentions:[employee.id],clientMessageId:'natural-edit-'+index});await settled(sent.id);await idle(a.id);await idle(b.id)
  const current=fs.readFileSync(path.join(shared.root,'brief.txt'),'utf8');assert.ok(current.includes(token));assert.ok(current.includes('Status: reviewed'))
  const messages=(await rpc('chat.history',{id:group.id})).messages,reply=messages.find(m=>m.author.kind==='agent'&&m.author.employeeId===employee.id&&m.text.includes(index?'第二轮修改完成':'第一轮修改完成'))
  assert.ok(reply,'Agent must explicitly publish the updated file');assert.ok(reply.attachments.some(f=>f.name==='brief.txt'));if(index===0)assert.ok(reply.attachments.some(f=>f.kind==='image'))
  assert.ok(fs.existsSync(path.join(employee.cwd,'brief.txt')),'The personal copy exists in the own execution workspace')
  const transcript=(await rpc('session.transcript',{employee:employee.id,thinking:true})).items,allTools=transcript.flatMap(i=>i.role==='assistant'?i.blocks.filter(b=>b.kind==='tool'):[]),tools=allTools.map(b=>({name:b.name,input:b.input}))
  fs.writeFileSync(path.join(out,'employee-'+index+'.json'),sanitize(JSON.stringify({transcript,tools},null,2)))
  const calls=JSON.stringify(tools)
  assert.ok(/conversation[. ](?:download|copy)/.test(calls),'A group-to-personal file copy API must be independently discovered')
  assert.ok(/conversation[. ]upload/.test(calls),'Versioned upload API must be independently discovered')
  assert.ok(/chat[. ]post/.test(calls),'Explicit group publication API must be independently discovered')
  assert.equal((await rpc('direct.history',{employee:employee.id})).items.length,0)
  report.cases.push({name:index?'A second ordinary member edits and replaces the same shared file':'Own-workspace edit, versioned upload, image/file group publication',prompt,employee:employee.title,tools,reply:{text:reply.text,attachments:reply.attachments.map(f=>({kind:f.kind,name:f.name}))}})
 }
 const directory=path.join(f.temp,'Mac chosen folder');fs.mkdirSync(directory);const destination=path.join(directory,'Final review.txt'),prompt='把“共享文稿”群里最后更新的 brief.txt 保存到这台 Mac 的这个完整文件路径：'+destination+'。不要改文件内容。保存完成后私聊告诉我已保存。'
 await rpc('direct.send',{employee:secretary.id,text:prompt,clientMessageId:'natural-secretary-save'});await idle(secretary.id)
 assert.equal(fs.readFileSync(destination,'utf8'),fs.readFileSync(path.join(shared.root,'brief.txt'),'utf8'))
 const full=(await rpc('session.transcript',{employee:secretary.id,thinking:true})).items,tools=full.flatMap(i=>i.role==='assistant'?i.blocks.filter(b=>b.kind==='tool'):[]).map(b=>({name:b.name,input:b.input}))
 fs.writeFileSync(path.join(out,'secretary.json'),sanitize(JSON.stringify({transcript:full,tools},null,2)))
 assert.ok(/(?:conversation[. ]download-local|transfer[. ]download-save)/.test(JSON.stringify(tools)),'Secretary must use an explicit chosen-path Mac save API')
 assert.ok((await rpc('direct.history',{employee:secretary.id})).items.some(i=>i.role==='assistant'))
 report.cases.push({name:'Nonmember Secretary independently saves the latest shared file to the requested Mac path and privately confirms',prompt,tools})
 report.passed=true;fs.writeFileSync(path.join(out,'result.json'),sanitize(JSON.stringify(report,null,2))+'\n');console.log('PASS real native DeepSeek Flash LOW: two members edit/download/upload/publish, Secretary chosen-path save')
}catch(error){report.error=sanitize(error.stack||error);fs.writeFileSync(path.join(out,'failure.json'),sanitize(JSON.stringify(report,null,2))+'\n');throw error}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
