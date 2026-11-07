// Real source-built Core with local SSH/native protocol fixtures. No real host, server or model call.
// Covers cloud-native Codex -> reverse-tunneled agents_company_api -> MiniNotion grants, local/cloud
// group parity, and the local-only Secretary gate matrix. File relay is covered by
// test/group-shared-files-remote-test.mjs; cloud Claude stream-json remains untested (see artifacts notes).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-cloud-parity-'))),bin=path.join(temp,'bin'),remote=path.join(temp,'cloud'),home=path.join(temp,'user'),work=path.join(temp,'work'),projects=path.join(temp,'projects')
for(const directory of [bin,remote,home,work,projects])fs.mkdirSync(directory,{recursive:true})
// The SSH fixture runs commands on this host. For -R it reports the forwarded target port so the
// reverse-tunneled MCP URL resolves to Core's loopback endpoint, exactly as the native tests do.
fs.writeFileSync(path.join(bin,'ssh'),`#!${process.execPath}
const args=process.argv.slice(2);if(args.includes('-R')){console.error('Allocated port '+args[args.indexOf('-R')+1].split(':').at(-1));setInterval(()=>{},1000)}else{const child=require('child_process').spawn('/bin/sh',['-c',args.at(-1)],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));process.on('SIGTERM',()=>child.kill('SIGTERM'))}
`,{mode:0o755})
// Reuse the maintained initialization fixture and add the real agents_company_api tool hook.
let native=fs.readFileSync(path.join(root,'test/fixtures/initialization-codex.cjs'),'utf8')
const employeeMarker="const employee=process.env.AGENTS_COMPANY_EMPLOYEE||'catalog'",workMarker='async function readWorkDocument(text){'
assert.ok(native.includes(employeeMarker)&&native.includes(workMarker),'initialization fixture changed; update the cloud parity hook')
native=native.replace(employeeMarker,"const employee=process.env.AGENTS_COMPANY_EMPLOYEE||path.basename(process.cwd())")
native=native.replace(workMarker,workMarker+`\n const requestFile=path.join(control,employee+'.fetch-request.json')\n if(fs.existsSync(requestFile)){const input=JSON.parse(fs.readFileSync(requestFile,'utf8')),response=await nativeTool('agents_company_api',input);note('fetch-result',response.result);return}\n`)
fs.writeFileSync(path.join(bin,'fixture.cjs'),native)
fs.writeFileSync(path.join(bin,'codex'),`#!${process.execPath}
if(process.argv.includes('--version')){console.log('codex-cli fixture');process.exit(0)}if(process.argv[2]==='login'){console.log('Logged in');process.exit(0)}require(${JSON.stringify(path.join(bin,'fixture.cjs'))})
`,{mode:0o755})
const externalEntry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY
const entry=externalEntry?path.resolve(externalEntry):path.join(temp,'daemon.cjs')
if(!externalEntry){fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})}
let f
const checks=[];const pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 f=await fixtureCore({HOME:home,PATH:[bin,path.dirname(process.execPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),CODEX_BIN:path.join(bin,'codex'),CODEX_HOME:path.join(temp,'codex'),AGENTS_COMPANY_WORKSPACES:work,AGENTS_COMPANY_PROJECTS:projects},entry)
 const rpc=async(cmd,args={},token=null)=>{const response=await f.request(token,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data}
 const deny=async(cmd,args={},token=null)=>{const response=await f.request(token,cmd,args);assert.equal(response.ok,false,cmd+' must remain denied');return response.error}
 const card=async id=>(await rpc('session.list')).sessions.find(value=>value.id===id)
 const createCloud=async(title,role='employee')=>{const value=await rpc('card.create',{title,group:'Cloud',kind:'cloud-native-worker',engine:'codex',model:'gpt-6-luna',managementRole:role});await f.ready(value.id);return card(value.id)}

 const host=await rpc('host.create',{name:'Fixture host',host:'fixture',os:'linux',defaultDirectory:remote})
 await rpc('group.add',{name:'Local'})
 await rpc('group.add',{name:'Cloud',mode:'cloud',hostId:host.id,remote:{host:'fixture',os:'linux',directory:remote},directory:remote})
 const secretary=await f.create('Local Secretary','Local','secretary')
 const coder=await createCloud('Cloud Coder','employee'),manager=await createCloud('Cloud Manager','manager'),governor=await createCloud('Cloud Governor','governor')
 for(const [employee,role] of [[coder,'employee'],[manager,'manager'],[governor,'governor']]){
  const saved=await card(employee.id),who=await rpc('auth.whoami',{},await f.token(employee.id))
  assert.equal(saved.kind,'cloud-native-worker');assert.equal(saved.managementRole,role);assert.ok(saved.cwd.startsWith(remote+path.sep))
  assert.deepEqual(saved.nativeOrigin,{kind:'cloud',hostId:host.id,host:'fixture',os:'linux',directory:saved.cwd})
  assert.equal(who.managementRole,role);assert.equal(who.globalManager,role==='governor');assert.equal(who.team,'Cloud')
 }
 pass('Cloud Employee/Manager/Governor create through authenticated Core, finish hidden initialization over SSH fixtures, and retain cloud-native metadata and role identity')

 const readRoots=()=>[fs.readdirSync(remote).sort(),fs.readdirSync(projects).sort()],before=readRoots()
 const localOnly=/Secretary 必须在 Core 所在主机本地运行/
 assert.match(await deny('card.create',{title:'CloudSecretary',group:'Cloud',kind:'cloud-native-worker',engine:'codex',model:'gpt-6-luna',managementRole:'secretary'}),localOnly)
 assert.match(await deny('card.create',{title:'TeamSecretary',group:'Cloud',engine:'codex',model:'gpt-6-luna',managementRole:'secretary'}),localOnly)
 assert.match(await deny('session.new',{title:'SessionSecretary',group:'Cloud',kind:'cloud-native-worker',engine:'codex',managementRole:'secretary'}),/Use card\.management-role to assign roles/)
 assert.match(await deny('card.management-role',{id:coder.id,role:'secretary'}),localOnly)
 assert.equal((await card(coder.id)).managementRole,'employee')
 assert.match(await deny('card.management-role',{id:manager.id,role:'secretary'},await f.token(manager.id)),/Forbidden/)
 assert.equal((await card(manager.id)).managementRole,'manager')
 assert.match(await deny('card.update',{id:coder.id,patch:{managementRole:'secretary'}}),/Use card\.management-role to assign roles/)
 assert.match(await deny('card.update',{id:coder.id,patch:{kind:'worker'}}),/员工职位创建后不可更改/)
 assert.match(await deny('card.update',{id:coder.id,patch:{cwd:path.join(remote,'elsewhere')}}),/员工工作目录创建后不能更换/)
 assert.match(await deny('card.update',{id:secretary.id,patch:{group:'Cloud'}}),/员工创建后不能更换 Team/)
 assert.match(await deny('card.move',{id:secretary.id,group:'Cloud'}),/员工创建后不能更换 Team/)
 assert.match(await deny('card.move',{id:coder.id,group:'Local'}),/员工创建后不能更换 Team/)
 assert.match(await deny('card.native-bind',{id:secretary.id,sessionId:'00000000-0000-4000-8000-000000000000'}),/只有 Cloud Native Worker/)
 assert.deepEqual((await card(secretary.id)).managementRole,'secretary')
 assert.ok(!(await rpc('session.list')).sessions.some(employee=>['CloudSecretary','TeamSecretary','SessionSecretary'].includes(employee.title)))
 assert.deepEqual(readRoots(),before)
 for(const name of ['cloudsecretary','teamsecretary','sessionsecretary','elsewhere']){assert.ok(!fs.existsSync(path.join(remote,name)),name+' must not create a remote folder');assert.ok(!fs.existsSync(path.join(projects,name)),name+' must not create a local folder')}
 pass('Local-only Secretary is denied at card.create, session.new, role change, card.update, card.move and native-bind with no remote or local directory side effect; a local Secretary remains valid')

 const plug=(method,params={},token=null)=>rpc('plugin.call',{id:'mininotion',method,params},token)
 const granted=await plug('page.create',{title:'Granted cloud note',color:'white'}),ungranted=await plug('page.create',{title:'Ungranted cloud note',color:'white'})
 await plug('page.write-markdown',{pageId:granted.id,markdown:'CLOUD_GRANTED_CONTENT'})
 const acl=await rpc('plugin.access',{id:'mininotion'})
 await rpc('plugin.access',{id:'mininotion',resourceIds:[granted.id],employees:[{employeeId:coder.id,read:true,write:true,create:false}],expectedRevision:acl.revision})
 const {sessionId}=await rpc('session.open',{cardId:coder.id})
 await rpc('config.permission',{id:sessionId,mode:'bypassPermissions'})
 const employeeName=path.basename(coder.cwd),requestFile=path.join(f.control,employeeName+'.fetch-request.json'),resultFile=path.join(f.control,employeeName+'-fetch-result.json')
 const invoke=async(command,args={})=>{
  fs.rmSync(resultFile,{force:true});fs.writeFileSync(requestFile,JSON.stringify({command,args}))
  await rpc('session.send',{employee:coder.id,text:'Run the authenticated Core API request for this bounded task.'})
  await f.until(()=>fs.existsSync(resultFile),'API result '+command)
  await f.until(async()=>!(await f.status(coder.id)).busy,'API idle '+command)
  return JSON.parse(fs.readFileSync(resultFile,'utf8'))
 }
 const dataOf=result=>{assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text).data}
 const resources=dataOf(await invoke('plugin.resources',{id:'mininotion'})),pluginRoot=fs.realpathSync(path.join(work,'mini-notion-workspace'))
 assert.ok(resources.resources.some(resource=>resource.id===granted.id));assert.ok(!resources.resources.some(resource=>resource.id===ungranted.id))
 assert.equal(resources.workspace,pluginRoot);assert.ok(!resources.workspace.startsWith(coder.cwd+path.sep));assert.ok(!fs.existsSync(path.join(coder.cwd,'mini-notion-workspace')))
 assert.match(dataOf(await invoke('plugin.call',{id:'mininotion',method:'page.read-markdown',params:{pageId:granted.id}})).markdown,/CLOUD_GRANTED_CONTENT/)
 const rejected=await invoke('plugin.call',{id:'mininotion',method:'page.read-markdown',params:{pageId:ungranted.id}})
 assert.ok(rejected.isError);assert.match(rejected.content[0].text,/页面未授权|PAGE_ACCESS_DENIED|PAGE_NOT_FOUND/);assert.equal((await plug('page.get',{pageId:ungranted.id})).id,ungranted.id)
 dataOf(await invoke('plugin.call',{id:'mininotion',method:'page.update',params:{pageId:granted.id,title:'Cloud wrote this'}}))
 assert.equal((await plug('page.get',{pageId:granted.id})).title,'Cloud wrote this')
 fs.rmSync(requestFile,{force:true})
 pass('Cloud-native Codex reaches Core agents_company_api over the reverse tunnel, reads/writes only its granted MiniNotion page in the Core-local collection, and an ungranted page is denied')

 const colleagueValue=await rpc('card.create',{title:'Local Colleague',group:'Cloud',kind:'worker',workEnvironment:'local',engine:'codex',model:'gpt-6-luna'})
 await f.ready(colleagueValue.id)
 const colleague=await card(colleagueValue.id)
 assert.equal(colleague.kind,'worker');assert.equal(colleague.workEnvironment,'local');assert.ok(!colleague.cwd.startsWith(remote+path.sep))
 const catalog=await rpc('workspace.catalog',{employee:coder.id}),company=catalog.workspaces.find(workspace=>workspace.id==='company:'+coder.id)
 assert.equal(company.location,'remote');assert.equal(company.nativeAccess,true);assert.equal(company.path,coder.cwd)
 assert.equal((await rpc('workspace.catalog',{employee:colleague.id})).workspaces.find(workspace=>workspace.id==='company:'+colleague.id).location,'core')
 const group=await rpc('chat.create',{name:'Mixed local and cloud',members:[coder.id,colleague.id]}),sharedText='Shared group history for local and cloud members.'
 await rpc('chat.send',{id:group.id,text:sharedText,clientMessageId:'mixed-context'})
 const history=await f.until(async()=>{const value=await rpc('chat.history',{id:group.id}),message=value.messages.find(item=>item.text===sharedText);return message&&message.deliveries.length===2&&message.deliveries.every(delivery=>delivery.status==='completed')&&value},'mixed group deliveries')
 const message=history.messages.find(item=>item.text===sharedText)
 assert.deepEqual(new Set(message.deliveries.map(delivery=>delivery.employeeId)),new Set([coder.id,colleague.id]))
 assert.deepEqual(new Set((await rpc('chat.get',{id:group.id})).memberIds),new Set([coder.id,colleague.id]))
 pass('A local Company member and a cloud-native member share the same group membership and completed history; only the cloud-native Company workspace is remote')

 const out=path.join(root,'artifacts/bot-workers');fs.mkdirSync(out,{recursive:true})
 fs.writeFileSync(path.join(out,'cloud-parity-result.json'),JSON.stringify({passed:true,checks,platform:process.platform,realModelCalls:0,realHosts:0,realServers:0,sshFixture:true},null,2)+'\n')
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
