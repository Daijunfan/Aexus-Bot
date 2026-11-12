import {nativeFixture} from './native-fixture.mjs'
// Real socket/CLI control flow with deterministic engine fixtures; no Electron or inference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {build} from 'esbuild'
import assert from 'node:assert/strict'
const project=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-core-'))),run=promisify(execFile),calls=path.join(temp,'controls.jsonl')
const sdk=path.join(temp,'sdk.mjs'),binary=path.join(temp,'codex'),initControl=path.join(temp,'init-fixture'),switchFile=path.join(temp,'use-native');fs.mkdirSync(initControl);fs.writeFileSync(path.join(initControl,'release-all'),'')
fs.writeFileSync(sdk,String.raw`import fs from 'node:fs';const record=(method,args)=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method,args})+'\n');
export const deleteSession=async()=>{};export const forkSession=async()=>{throw new Error('Fork is not used by this fixture')};
export const tool=(name,description,schema,handler)=>({name,handler});export const createSdkMcpServer=({name,tools})=>({name,tools});
export function query({prompt,options}){record('start',{cwd:options.cwd,model:options.model,permissionMode:options.permissionMode});return {supportedCommands:async()=>[],supportedModels:async()=>[{value:'fixture-claude',displayName:'Fixture Claude',supportsEffort:true,supportedEffortLevels:['low','medium','high']}],setModel:async value=>record('model',value),setPermissionMode:async value=>record('permission',value),setMaxThinkingTokens:async value=>record('thinking',value),applyFlagSettings:async value=>record('effort',value),interrupt:async()=>record('interrupt',true),close(){},async *[Symbol.asyncIterator](){for await(const item of prompt){const text=typeof item.message.content==='string'?item.message.content:item.message.content.map(b=>b.text||'').join('\n');if(text.includes('[Agents Company private initialization]')){const doc=options.mcpServers.agents_company.tools.find(tool=>tool.name==='agents_company_documentation');for(const operation of ['identity','index']){const result=await doc.handler({operation},{requestId:'fixture-'+operation+'-'+Date.now()});if(result.isError)throw Error(result.content?.[0]?.text??'Documentation initialization failed')}yield {type:'assistant',message:{id:'init-'+Date.now(),content:[{type:'text',text:'OK'}]}};yield {type:'result',subtype:'success'};continue}yield {type:'assistant',message:{id:'fixture-'+Date.now(),content:[{type:'text',text:'CLAUDE: '+text}]}};yield {type:'result',subtype:'success'}}}}}`)
fs.writeFileSync(binary,String.raw`#!/usr/bin/env node
const args=process.argv.slice(2);if(!args.includes('gpt-5.6-luna')||!args.includes('model_reasoning_effort="low"'))process.exit(3);
let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'turn.started'})+'\n');if(text==='hold'){setInterval(()=>{},1000);return}process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',id:'reply',text:'CODEX: '+text}})+'\n');process.stdout.write(JSON.stringify({type:'turn.completed'})+'\n')});`,{mode:0o755})
const entry=path.join(temp,'service.cjs');await build({entryPoints:['src/main/daemon.ts'],bundle:true,platform:'node',format:'cjs',outfile:entry,logLevel:'silent'})
const native=nativeFixture(binary),bridge=path.join(temp,'codex-bridge');fs.writeFileSync(bridge,`#!/usr/bin/env node\nconst {spawn}=require('node:child_process'),fs=require('node:fs');const binary=fs.existsSync(${JSON.stringify(switchFile)})?${JSON.stringify(native)}:${JSON.stringify(path.join(project,'test/fixtures/initialization-codex.cjs'))};const child=spawn(binary,process.argv.slice(2),{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));process.on('SIGTERM',()=>child.kill('SIGTERM'));\n`,{mode:0o755})
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_SHARED_DIR:path.join(temp,'shared'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_BUILTIN_PLUGINS:path.join(project,'build/plugins'),AGENTS_COMPANY_TUNNEL_DIR:path.join(project,'Modules/Tunnel'),CLAUDE_CONFIG_DIR:path.join(temp,'claude'),CODEX_BIN:bridge,CODEX_HOME:path.join(temp,'codex-home'),AC_INIT_FIXTURE:initControl,SHELL:'/bin/bash',HISTFILE:'/dev/null'}
const service=spawn(process.execPath,[entry],{env,stdio:'ignore'}),done=new Promise(r=>service.once('exit',r))
const cli=async(...args)=>{const r=JSON.parse((await run(process.execPath,[path.join(project,'bin/agents'),...args,'--json'],{env,timeout:10000})).stdout);assert.ok(r.ok,r.error);return r.data}
const until=async(fn)=>{for(let i=0;i<400;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw new Error('Condition timed out')}
const ready=async id=>until(async()=>{const [card]=await cli('session','status','--employee',id);if(card.initialization?.status==='failed')throw Error('Native fixture initialization failed: '+card.initialization.error);return card.initialization?.status==='ready'})
let n=0;const ok=(value,label)=>{assert.ok(value,label);n++;console.log('PASS '+label)}
try{
 await until(async()=>{try{return (await cli('status')).running}catch{return false}})
 await cli('engine','configure','--engine','claude','--data',JSON.stringify({path:binary,sdkPath:sdk}));
 await cli('group','add','Backend');const card=await cli('card','create','--title','Engineer','--group','Backend','--engine','codex')
 await ready(card.id);await cli('session','close',(await cli('session','open',card.id)).sessionId);fs.writeFileSync(switchFile,'')
 let session=await cli('session','open',card.id);await cli('config','model',session.sessionId,'gpt-5.6-luna');await cli('config','effort',session.sessionId,'low');await cli('config','permission',session.sessionId,'acceptEdits');await cli('session','send',session.sessionId,'first conversation')
 await until(async()=>!(await cli('session','snapshot',session.sessionId)).busy)
 ok((await cli('session','transcript',card.id)).items.some(i=>i.role==='user'&&i.text==='first conversation'),'creating employees, engine selection, model/effort and conversation work without a renderer')
 await cli('session','send',session.sessionId,'hold');await assert.rejects(()=>cli('config','engine',card.id,'claude'))
 ok((await cli('session','list')).sessions.find(c=>c.id===card.id).engine==='codex','busy engine switching is rejected without changing employee state')
 await cli('session','interrupt',session.sessionId);await until(async()=>!(await cli('session','snapshot',session.sessionId)).busy)
 const terminal=await cli('terminal','open','--employee',card.id)
 await assert.rejects(()=>cli('config','engine',session.sessionId,'claude'));ok((await cli('terminal','list','--employee',card.id)).some(t=>t.id===terminal.id),'rejected engine switch leaves the live session and terminal intact')
 await cli('card','remove',card.id);ok(!(await cli('terminal','list')).length,'explicit removal closes the old employee terminal')
 const replacement=await cli('card','create','--title','Engineer','--group','Backend','--engine','claude','--directory-mode','bind','--cwd',card.cwd);ok(replacement.id!==card.id&&replacement.engine==='claude','another engine requires a newly created employee')
 await ready(replacement.id);session=await cli('session','open',replacement.id);await until(async()=>(await cli('session','snapshot',session.sessionId)).models.length>0)
 await cli('config','model',session.sessionId,'fixture-claude');await cli('config','thinking',session.sessionId,'off');await cli('config','thinking',session.sessionId,'on');await cli('config','effort',session.sessionId,'low');await cli('config','permission',session.sessionId,'acceptEdits')
 const recorded=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse)
 ok(recorded.some(c=>c.method==='thinking'&&c.args===0)&&recorded.some(c=>c.method==='thinking'&&c.args===null)&&recorded.some(c=>c.method==='model'&&c.args==='fixture-claude')&&recorded.some(c=>c.method==='effort'&&c.args.effortLevel==='low'),'CLI thinking, model, permission and effort settings reach the same engine adapter')
 await cli('session','send',session.sessionId,'second conversation');await until(async()=>!(await cli('session','snapshot',session.sessionId)).busy)
 const transcript=await cli('session','transcript',replacement.id);ok(transcript.items.filter(i=>i.role==='user').length===1&&transcript.items.some(i=>i.role==='assistant'&&JSON.stringify(i).includes('CLAUDE: [Agents Company role]')&&JSON.stringify(i).includes('second conversation')),'replacement employee has its own role-prefixed conversation')
 await assert.rejects(()=>cli('card','update',replacement.id,'--engine','codex'));ok((await cli('session','list')).sessions.find(c=>c.id===replacement.id).engine==='claude','card.update cannot change an existing engine')
 await cli('card','remove',replacement.id)
 console.log(`PASS=${n} FAIL=0 — no GUI, no paid model calls`)
}finally{service.kill('SIGTERM');await done;fs.rmSync(temp,{recursive:true,force:true})}
