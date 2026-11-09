// Frozen pre-refactor parse-only payloads include historical defaults and remote @file handling.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {CLI_COMMANDS} from '../src/shared/api-registry.ts'
import {compileCliInputs} from '../src/shared/cli-contract.ts'
const root=path.resolve(import.meta.dirname,'..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const compiled=compileCliInputs(CLI_COMMANDS),cases=[...read('test/fixtures/cli-input-cases.json'),...read('test/fixtures/cli-team-cases.json'),...read('test/fixtures/cli-board-categories-cases.json'),...read('test/fixtures/cli-worker-conversation-cases.json'),...read('test/fixtures/cli-mcp-cases.json')]
assert.deepEqual(compiled,read('bin/command-inputs.json'),'generated CLI inputs must match canonical schemas')

const largeOptions=Array.from({length:80},(_,i)=>({id:'choice-'+i,label:'需要完整保留的选项内容。'.repeat(60)})),largeQuestion={conversation:'employee:employee-1',question:'Choose the complete result',options:largeOptions,timeoutSeconds:null,clientRequestId:'large-question'}
cases.push({args:['question','ask','--conversation',largeQuestion.conversation,'--question',largeQuestion.question,'--options','@/remote/choices.json','--timeout-seconds','null','--client-request-id',largeQuestion.clientRequestId],input:{'/remote/choices.json':JSON.stringify(largeOptions)},expected:{cmd:'question.ask',args:largeQuestion}})

const messageCases=read('test/fixtures/cli-message-cases.json')
const navigationCases=read('test/fixtures/cli-navigation-cases.json')
const preferenceCases=[{args:['settings','set','--explorer-collapsed','on','--explorer-tree-collapsed','off'],expected:{cmd:'settings.set',args:{explorerCollapsed:true,explorerTreeCollapsed:false}}}]
for(const {args,input,expected} of [...cases,...messageCases,...preferenceCases,...navigationCases]){
 const result=spawnSync(process.execPath,[path.join(root,'bin/agents'),...args,'--json'],{cwd:root,env:{...process.env,AGENTS_COMPANY_PARSE_ONLY:'1'},input:JSON.stringify(input??{}),encoding:'utf8'})
 assert.ok(result.stdout,result.stderr)
 const actual=JSON.parse(result.stdout);if(actual.cmd)actual.args??={}
 assert.deepEqual(actual,expected,args.join(' '))
}
const coveredRoutes=new Set(cases.map(({args})=>args.slice(0,2).join('.')))
for(const command of Object.keys(compiled))assert.ok(coveredRoutes.has(command),'Missing CLI payload fixture: '+command)
const unknown=JSON.parse(spawnSync(process.execPath,[path.join(root,'bin/agents'),'unknown-command','--json'],{cwd:root,env:{...process.env,AGENTS_COMPANY_PARSE_ONLY:'1'},encoding:'utf8'}).stdout)
assert.match(unknown.error,/unknown command: unknown-command/);assert.doesNotMatch(unknown.error,/not defined/)
console.log(`PASS ${cases.length+messageCases.length+preferenceCases.length+navigationCases.length} CLI payloads; ${Object.keys(compiled).length} schema-owned routes, remote input and failure parity`)
