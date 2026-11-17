// Source markers preserve development roots; portable packages keep data outside replaceable code.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'

const run=promisify(execFile),root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-plugin-location-')))
const stateHome=path.join(temp,'state'),legacy=path.join(stateHome,'workspaces/margin-reader-workspace/default'),migratedHome=path.join(stateHome,'library-reader')
fs.mkdirSync(legacy,{recursive:true})
fs.writeFileSync(path.join(legacy,'saved-before-upgrade.md'),'keep this page\n')
const env={...process.env,HOME:temp,AGENTS_COMPANY_HOME:stateHome,AGENTS_COMPANY_EMPLOYEE_WORKSPACES:path.join(temp,'employee-workspaces'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),CODEX_BIN:path.join(root,'test/fixtures/initialization-codex.cjs'),CODEX_HOME:path.join(temp,'codex')}
delete env.AGENTS_COMPANY_WORKSPACES
const control=path.join(temp,'fixture');fs.mkdirSync(control);fs.writeFileSync(path.join(control,'release-all'),'');env.AC_INIT_FIXTURE=control
const daemon=spawn(process.execPath,[root+'/bin/agents','serve'],{env,stdio:'ignore'}),done=new Promise(resolve=>daemon.once('exit',resolve))
const cli=async(...args)=>{const reply=JSON.parse((await run(process.execPath,[root+'/bin/agents',...args,'--json'],{env,timeout:15000})).stdout);assert.ok(reply.ok,reply.error);return reply.data}
try{
 for(let i=0;i<100;i++){try{if((await cli('status')).running)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
 const view=await cli('reader','open')
 assert.equal(view.workspace,migratedHome)
 assert.equal(fs.readFileSync(path.join(migratedHome,'saved-before-upgrade.md'),'utf8'),'keep this page\n')
 await cli('reader','close',view.id)
 const employee=await cli('card','create','--title','Reader','--directory-mode','default','--engine','codex','--model','gpt-6-luna','--effort','low')
 const readerDocs=await cli('api','docs','core/reader/api');assert.match(readerDocs.markdown,/study\.create/);assert.ok(readerDocs.path.startsWith(path.join(env.AGENTS_COMPANY_HOME,'api-docs')+path.sep));assert.equal(fs.readFileSync(readerDocs.path,'utf8'),readerDocs.markdown);assert.ok(!fs.existsSync(path.join(employee.cwd,'.agents-company')))
 const installed=await cli('plugin','install',path.join(root,'examples/plugin-starter'))
 assert.equal(installed.plugin.id,'workspace-notes')
 const oldNotes=path.join(temp,'develop/Agents-company-workspace/workspace-notes-workspace'),newNotes=path.join(env.AGENTS_COMPANY_HOME,'workspaces/workspace-notes-workspace/default')
 fs.mkdirSync(oldNotes,{recursive:true});fs.writeFileSync(path.join(oldNotes,'cleared.md'),'must stay cleared')
 fs.mkdirSync(path.join(newNotes,'.agents-company'),{recursive:true});fs.writeFileSync(path.join(newNotes,'.agents-company/legacy-import.json'),JSON.stringify({version:1,completed:true,reason:'explicit-reset'}))
 const notesView=await cli('plugin','view','workspace-notes')
 assert.equal(notesView.workspace,newNotes)
 assert.equal(fs.existsSync(path.join(newNotes,'cleared.md')),false)
 assert.ok(!fs.existsSync(path.join(env.AGENTS_COMPANY_HOME,'plugins/workspace-notes/workspaces')),'installable code must not contain user workspaces')
 await cli('plugin','close',notesView.id)
 const writer=await cli('card','create','--title','Writer','--directory-mode','default','--engine','codex','--model','gpt-6-luna','--effort','low')
 const notesDocs=await cli('api','docs','plugin/workspace-notes/api');assert.match(notesDocs.markdown,/plugin: workspace-notes/);assert.ok(notesDocs.path.startsWith(path.join(env.AGENTS_COMPANY_HOME,'api-docs')+path.sep));assert.equal(fs.readFileSync(notesDocs.path,'utf8'),notesDocs.markdown);assert.ok(!fs.existsSync(path.join(writer.cwd,'.agents-company/plugins/workspace-notes/API.md')))
 console.log('PASS explicit workspace reset prevents old legacy content from being imported again')
 console.log('PASS legacy files copied without moving; source-marker roots preserved; portable plugin data stays outside code; current CLI docs resolve through the shared catalog without workspace copies')
}finally{daemon.kill('SIGTERM');await done;fs.rmSync(temp,{recursive:true,force:true})}
