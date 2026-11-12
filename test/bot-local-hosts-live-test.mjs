// Explicitly connects the user's native Mac execution services. No message/model turn is sent.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Native Mac account access requires --confirm-live')
if(process.platform!=='darwin')throw Error('This acceptance requires an actual Mac')
const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/bot-local-host/live-core');fs.mkdirSync(out,{recursive:true})
const report={passed:false,realNativeAccounts:true,modelTurns:0,productionCoreDataUsed:false,checks:[]},home=os.homedir()
const executors=()=>execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{const match=/^\s*(\d+)\s+(.+)$/.exec(line);return match&&(/\/CodexCLI\.app\/Contents\/MacOS\/codex .*exec-server /.test(match[2])||/\/local-exec-daemon\/entry\.cjs/.test(match[2]))?[Number(match[1])]:[]})
let f
try{
 const before=new Set(executors());f=await fixtureCore({AGENTS_COMPANY_TEST_BOT_LOCAL_HOSTS:'1',CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude')})
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
 const connected=async()=>{let result;for(let i=0;i<300;i++){result=await rpc('bot.list');if(['dots','grok'].every(provider=>result.some(bot=>bot.bot.provider===provider&&bot.bot.localComputer?.state==='connected')))return result;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Native executor startup failed: '+JSON.stringify(result.map(bot=>({provider:bot.bot.provider,localComputer:bot.bot.localComputer}))))}
 await rpc('bot.sync');await connected();assert.ok(executors().filter(pid=>!before.has(pid)).length>=2);report.checks.push('Explicit first sync connects both native Mac executors in an isolated Core without official app windows or model turns')
 await f.stop();assert.deepEqual(executors().filter(pid=>!before.has(pid)),[]);report.checks.push('Stopping Core waits for both owned native execution processes to exit')
 await f.start();await connected();assert.ok(executors().filter(pid=>!before.has(pid)).length>=2);report.checks.push('Restart with persisted provider bindings automatically reconnects Dot and Grok without calling bot.sync or opening a view')
 await f.stop();assert.deepEqual(executors().filter(pid=>!before.has(pid)),[]);report.passed=true;console.log(report.checks.map(check=>'PASS '+check).join('\n'))
}catch(error){report.error=error.message;throw error}
finally{await f?.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n')}
