import {spawn,execFile} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
const run=promisify(execFile),root=path.resolve(import.meta.dirname,'..')
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-plugin-'))),home=path.join(temp,'home'),workspace=path.join(temp,"Reader's 工作空间",'reader-workspace','任意命名'),other=path.join(temp,"Reader's 工作空间",'workspace-notes-workspace','Notes')
fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(other,{recursive:true});const control=path.join(temp,'fixture');fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'')
fs.writeFileSync(path.join(workspace,'AGENTS.md'),'# Keep user instructions\n')
fs.writeFileSync(path.join(workspace,'CLAUDE.md'),'# Keep Claude instructions\n')
fs.mkdirSync(home,{recursive:true})
const env={...process.env,CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),AC_INIT_FIXTURE:control,AGENTS_COMPANY_HOME:home,AGENTS_COMPANY_EMPLOYEE_WORKSPACES:path.join(temp,'employees'),AGENTS_COMPANY_WORKSPACES:path.dirname(path.dirname(workspace)),CODEX_HOME:path.join(temp,'codex'),CLAUDE_CONFIG_DIR:path.join(temp,'claude'),AGENTS_COMPANY_PLUGIN_DIRS:''}
for(const key of Object.keys(env))if(key.startsWith('AGENTS_COMPANY_TOKEN')||['AGENTS_COMPANY_SOCKET','AGENTS_COMPANY_URL','AGENTS_COMPANY_EMPLOYEE','AGENTS_COMPANY_PLUGIN_RPC'].includes(key))delete env[key]
const executable=process.env.AGENTS_COMPANY_TEST_CLI||process.execPath,prefix=process.env.AGENTS_COMPANY_TEST_CLI?[]:['bin/agents']
const daemon=spawn(process.env.AGENTS_COMPANY_TEST_CORE_ENTRY?process.execPath:executable,process.env.AGENTS_COMPANY_TEST_CORE_ENTRY?[process.env.AGENTS_COMPANY_TEST_CORE_ENTRY]:[...prefix,'serve'],{cwd:root,env,stdio:['ignore','pipe','pipe']})
const done=new Promise(resolve=>daemon.once('exit',resolve));let log='';daemon.stdout.on('data',d=>log+=d);daemon.stderr.on('data',d=>log+=d)
const cli=async(...args)=>{const response=JSON.parse((await run(executable,[...prefix,...args,'--json'],{cwd:root,env,timeout:30000})).stdout);assert.ok(response.ok,response.error);return response.data}
const reader=(method,params={},target=workspace)=>cli('reader','call',method,'--workspace',target,'--params',JSON.stringify(params))
let count=0;const ok=(value,label)=>{assert.ok(value,label);count++;console.log('PASS '+label)}
try{
  for(let i=0;i<100&&!fs.existsSync(path.join(home,'agents.sock'));i++)await new Promise(r=>setTimeout(r,50))
  const list=await cli('plugin','list')
  ok(!list.some(p=>['margin-reader','cloud-hosts','mininotion'].includes(p.id)),'retired built-in manifests are excluded from plugin.list')
  const sharedGuide=await cli('api','docs')
  const guide=fs.readFileSync(path.join(workspace,'AGENTS.md'),'utf8')
  const employee=await cli('card','create','--title','Writer','--engine','codex')
  for(let i=0;i<250;i++){const status=(await cli('session','status','--employee',employee.id))[0];if(status.initialization.status==='ready')break;if(status.initialization.status==='failed')throw Error(status.initialization.error);await new Promise(resolve=>setTimeout(resolve,40))}
  assert.equal((await cli('session','status','--employee',employee.id))[0].initialization.status,'ready')
  ok(guide==='# Keep user instructions\n'&&sharedGuide.document==='index'&&!fs.existsSync(path.join(employee.cwd,'.agents-company'))&&fs.readFileSync(path.join(workspace,'CLAUDE.md'),'utf8')==='# Keep Claude instructions\n','user instructions stay untouched and employee has no copied documentation or local runtime folder')
  await cli('workspace','docs','--employee',employee.id)
  ok(fs.readFileSync(path.join(workspace,'AGENTS.md'),'utf8')===guide&&(await cli('api','docs')).markdown===sharedGuide.markdown&&!fs.existsSync(path.join(employee.cwd,'.agents-company')),'provisioning is idempotent')
  await reader('fs.mkdir',{path:'notes'})
  await reader('fs.write',{path:'notes/guide.md',content:'# Shared guide\n'})
  ok(fs.readFileSync(path.join(workspace,'notes/guide.md'),'utf8')==='# Shared guide\n','plugin writes scoped workspace files with spaces and apostrophes')
  const study=await reader('study.create',{title:'API study'})
  ok((await reader('study.get',{setId:study.id})).title==='API study','plugin call creates and reads study sets')
  const view=await cli('reader','open','--workspace',workspace),base=new URL('.',view.url)
  ok((await fetch(view.url).then(r=>r.text())).includes('Study Reader'),'Core hosts content permissions around the built-in Study Reader renderer')
  const reply=await fetch(new URL('rpc',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:42,method:'study.get',params:{setId:study.id}})}).then(r=>r.json())
  ok(reply.result.title==='API study','scoped renderer JSON API uses the same service')
  ok((await fetch(new URL('/rpc',view.url))).status===404,'unguarded root has no RPC route')
  await cli('reader','close',view.id)
  await assert.rejects(fetch(view.url));ok(true,'closing a reader session releases its HTTP listener')
  const starter=path.join(temp,'starter');fs.cpSync(path.join(root,'examples/plugin-starter'),starter,{recursive:true})
  fs.writeFileSync(path.join(starter,'runtime.cjs'),fs.readFileSync(path.join(starter,'runtime.cjs'),'utf8').replace("if(method==='notes.list')","if(method==='private.write'){await fs.writeFile(path.join(workspace,'bypass.txt'),'wrong');result=true;}else if(method==='notes.list')"))
  const invalid=path.join(temp,'invalid');fs.cpSync(starter,invalid,{recursive:true});const invalidSchema=JSON.parse(fs.readFileSync(path.join(invalid,'schema.json')));invalidSchema.commands=[];fs.writeFileSync(path.join(invalid,'schema.json'),JSON.stringify(invalidSchema))
  await assert.rejects(()=>cli('plugin','install',invalid));ok(true,'plugins without a declared CLI command schema are rejected')
  await cli('plugin','install',starter)
  const result=await cli('plugin','call','workspace-notes','notes.write','--workspace',other,'--params',JSON.stringify({name:'second.md',content:'Second independent plugin'}))
  ok(result.name==='second.md'&&fs.existsSync(path.join(other,'second.md')),'second plugin installs and executes without host modifications')
  await assert.rejects(()=>cli('plugin','call','workspace-notes','private.write','--workspace',other))
  const guarded=await cli('plugin','view','workspace-notes','--workspace',other),guardedBase=new URL('.',guarded.url)
  const denied=await fetch(new URL('rpc',guardedBase),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'private.write'})}).then(r=>r.json())
  ok(denied.error.code===-32601&&!fs.existsSync(path.join(other,'bypass.txt')),'renderer and CLI both reject runtime methods absent from the shared command schema')
  await cli('plugin','close',guarded.id)
  ok((await cli('api','docs','plugin/workspace-notes/api')).markdown.length>0&&!fs.existsSync(path.join(other,'.agents-company/plugins')),'all installed plugin docs share the catalog without workspace copies')
  await assert.rejects(()=>reader('fs.write',{path:path.join(other,'wrong.md'),content:'escape'}));ok(!fs.existsSync(path.join(other,'wrong.md')),'workspace API rejects escaping plugin root')
  console.log(`PASS=${count} FAIL=0 — no model calls`)
}catch(error){console.error(log);throw error}finally{daemon.kill('SIGTERM');await done;fs.rmSync(temp,{recursive:true,force:true})}
