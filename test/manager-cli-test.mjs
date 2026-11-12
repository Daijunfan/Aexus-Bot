// Isolated Governor control through the real authenticated host socket and deterministic native fixtures.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{spawn,execFile}from 'node:child_process';import{promisify}from 'node:util';import{createRequire}from 'node:module';import{build}from 'esbuild';import assert from 'node:assert/strict'
const run=promisify(execFile),require=createRequire(import.meta.dirname),root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-manager-')),fixture=path.join(temp,'fixture'),env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_SHARED_DIR:path.join(temp,'shared'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work'),CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex'),AC_INIT_FIXTURE:fixture,AGENTS_COMPANY_BUILTIN_PLUGINS:path.join(root,'build/plugins'),AGENTS_COMPANY_TUNNEL_DIR:path.join(root,'Modules/Tunnel')};fs.mkdirSync(fixture);fs.writeFileSync(path.join(fixture,'release-all'),'');let manager=path.join(temp,'Agents-Managers');fs.mkdirSync(manager);manager=fs.realpathSync(manager)
fs.writeFileSync(path.join(manager,'.agents-company-manager'),'agents-company-manager/v1\n')
const sdk=require.resolve('@anthropic-ai/claude-agent-sdk'),bundle=path.join(temp,'env.cjs');await build({stdin:{contents:"export {childEnv} from './src/main/exec'",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});const {childEnv}=require(bundle)
const daemon=spawn(process.execPath,[root+'/bin/agents','serve'],{env,stdio:'ignore'}),done=new Promise(resolve=>daemon.once('exit',resolve));let director
const credentials=new Map()
const cli=async(cwd,...args)=>{const response=JSON.parse((await run(path.join(env.AGENTS_COMPANY_HOME,'cli/bin/agents'),[...args,'--json'],{cwd,env:{...childEnv(cwd),...env,PATH:childEnv(cwd).PATH,AGENTS_COMPANY_TOKEN_FILE:credentials.get(cwd)},timeout:25000})).stdout);assert.ok(response.ok,response.error);return response.data}
const bootstrap=async(...args)=>{const response=JSON.parse((await run(process.execPath,[root+'/bin/agents',...args,'--json'],{env,timeout:25000})).stdout);assert.ok(response.ok,response.error);return response.data}
const ready=async id=>{for(let i=0;i<300;i++){const [card]=await bootstrap('session','status','--employee',id);if(card.initialization?.status==='ready')return;if(card.initialization?.status==='failed')throw Error('Deterministic initialization failed: '+card.initialization.error);await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timed out waiting for fixture native initialization')}
try{
 for(let n=0;n<100;n++){try{if((await bootstrap('status')).running)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
 assert.ok(!fs.existsSync(path.join(manager,'API.md'))&&!fs.existsSync(path.join(manager,'agents')))
 await bootstrap('group','add','Managers','--mode','build','--directory-mode','bind','--root',manager)
 director=await bootstrap('card','create','--title','Director','--group','Managers','--engine','codex','--model','gpt-6-luna','--effort','low','--permission','acceptEdits')
 await ready(director.id)
 await bootstrap('management','global',director.id,'on');credentials.set(director.cwd,(await bootstrap('auth','agent-token',director.id)).file)
 assert.equal(director.permissionMode,'acceptEdits')
 const launcher=path.join(env.AGENTS_COMPANY_HOME,'cli/bin/agents');assert.ok(fs.existsSync(launcher),'runtime-scoped authenticated CLI launcher')
 const guide=(await bootstrap('api','docs','core/api')).markdown;assert.match(guide,/host.credentials/);assert.match(guide,/schedule.create/);assert.ok((await bootstrap('api','docs','core/permissions')).markdown)
 assert.ok(!fs.existsSync(path.join(director.cwd,'AGENTS.md')),'shared docs must not be copied to employee workspace')
 assert.equal((await cli(director.cwd,'status')).running,true)
 const originalPath=process.env.PATH;process.env.PATH='/usr/bin:/bin';const finderEnv=childEnv(director.cwd);process.env.PATH=originalPath
 assert.ok(finderEnv.PATH.split(':').length>0)
 assert.ok(finderEnv.PATH.split(':').some(folder=>fs.existsSync(path.join(folder,'node'))),'Finder environment must include Node for the Manager launcher')
 assert.equal(JSON.parse((await run(launcher,['status','--json'],{cwd:director.cwd,env:{...finderEnv,...env,PATH:finderEnv.PATH,AGENTS_COMPANY_TOKEN_FILE:credentials.get(director.cwd)}})).stdout).data.running,true)
 const assistant=await cli(director.cwd,'card','create','--title','Assistant','--group','Managers','--engine','codex','--permission','acceptEdits')
 await ready(assistant.id)
 await bootstrap('management','global',assistant.id,'on');credentials.set(assistant.cwd,(await bootstrap('auth','agent-token',assistant.id)).file)
 assert.equal(assistant.permissionMode,'acceptEdits')
 assert.ok(fs.existsSync(launcher))
 assert.equal((await cli(assistant.cwd,'status')).running,true)
 assert.equal((await cli(assistant.cwd,'api','docs','core/api')).markdown,guide)
 const bound=path.join(manager,'Bound');fs.mkdirSync(bound)
 const boundEmployee=await cli(director.cwd,'card','create','--title','Bound','--group','Managers','--directory-mode','bind','--cwd',bound)
 assert.ok(!fs.existsSync(path.join(boundEmployee.cwd,'.agents-company/employees',boundEmployee.id,'API.md')))
 await ready(boundEmployee.id)
 await cli(director.cwd,'card','remove',boundEmployee.id)
 await assert.rejects(()=>cli(director.cwd,'card','create','--title','Outside','--group','Managers','--directory-mode','bind','--cwd',temp))
 await cli(director.cwd,'group','add','Demo','--mode','build')
 const worker=await cli(assistant.cwd,'card','create','--title','Worker','--group','Demo','--engine','codex','--model','gpt-6-luna','--effort','low')
 await ready(worker.id)
 await cli(director.cwd,'card','update',worker.id,'--role','Reviewer','--color','#7089c4')
 const changed=(await cli(assistant.cwd,'session','list')).sessions.find(s=>s.id===worker.id);assert.equal(changed.role,'Reviewer');assert.equal(changed.color,'#7089c4')
 await cli(director.cwd,'room','bounds','Demo','--columns','5','--rows','4');assert.deepEqual((await cli(assistant.cwd,'room','layout','Demo')).seating,{columns:5,rows:4})
 const when=new Date(Date.now()+86400000).toISOString(),job=await cli(assistant.cwd,'schedule','create','--name','Future check','--employee',worker.id,'--at',when,'--prompt','Read the test workspace only','--model','gpt-6-luna','--effort','low')
 assert.equal((await cli(director.cwd,'schedule','get',job.id)).id,job.id)
 assert.ok((await cli(director.cwd,'schedule','preview',job.id,'--count','1')).times.length>0)
 await cli(assistant.cwd,'schedule','pause',job.id);await cli(assistant.cwd,'schedule','resume',job.id);await cli(director.cwd,'schedule','delete',job.id)
 await cli(assistant.cwd,'card','remove',worker.id);await cli(director.cwd,'group','remove','Demo')
 assert.ok(!(await cli(director.cwd,'session','list')).sessions.some(s=>s.id===worker.id));assert.ok(!(await cli(director.cwd,'group','list')).includes('Demo'))
 console.log('PASS two Governor employees control other Teams, employees and schedule configuration through CLI; no visible window or paid model call')
}finally{daemon.kill('SIGTERM');await done;fs.rmSync(temp,{recursive:true,force:true})}
