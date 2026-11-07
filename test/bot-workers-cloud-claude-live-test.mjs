// Opt-in actual Linux SSH + original Claude Code/DeepSeek. All state/work/native profiles are disposable.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {read as productionRead,call as productionCall} from '../artifacts/engine-native/live-control.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Requires explicit --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-cloud-claude-')),nonce=randomUUID(),require=createRequire(import.meta.url),profile=path.join(temp,'claude'),tunnel=path.join(temp,'Tunnel'),remoteRoot='/home/lab/.cache/aexus-tests/bot-workers-'+nonce,model='deepseek-flash',key=fs.readFileSync(path.join(os.homedir(),'.claude/deepseek-api-key'),'utf8').trim(),sanitize=v=>String(v).replaceAll(key,'[redacted]'),report={passed:false,realLinux:true,realClaude:true,model,effort:'low',productionActorsUsed:false,checks:[]}
fs.mkdirSync(profile);fs.cpSync(path.join(root,'Modules/Tunnel'),tunnel,{recursive:true});fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
const userStore=productionRead('sessions.json'),black=userStore.sessions.find(c=>c.title==='black'),target=await productionCall('host.get',{id:userStore.teamSettings[black.group].hostId}),sshArgs=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10']
for(const [field,flag]of [['sshConfig','-F'],['identityFile','-i'],['port','-p'],['jump','-J']])if(target[field])sshArgs.push(flag,String(target[field]));if(target.knownHosts)sshArgs.push('-o','UserKnownHostsFile='+target.knownHosts)
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'"
const ssh=(command,input='')=>new Promise((resolve,reject)=>{const child=spawn('ssh',[...sshArgs,target.host,command],{stdio:['pipe','pipe','pipe']}),stdout=[],stderr=[];const timer=setTimeout(()=>child.kill('SIGTERM'),90000);child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));child.once('error',reject);child.once('close',code=>{clearTimeout(timer);const out=Buffer.concat(stdout).toString();code===0?resolve(out):reject(Error(sanitize(Buffer.concat(stderr).toString()||out||'SSH failed '+code)))});child.stdin.on('error',()=>{});child.stdin.end(input)})
const python=(code,input='')=>ssh('python3 -c '+quote(code),input)
const remoteHashes=()=>python("import hashlib,json,pathlib;print(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [pathlib.Path.home()/'.claude/settings.json',pathlib.Path.home()/'.claude.json'] if p.is_file()}))")
const settings={model,effortLevel:'low',alwaysThinkingEnabled:false,env:{ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},permissions:{deny:['Agent','Task']}}
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify(settings),{mode:0o600});let f,before
try{
 before=await remoteHashes()
 await python("import os,sys,json,pathlib;d=json.load(sys.stdin);r=pathlib.Path(d['root']);r.mkdir(parents=True,exist_ok=False);p=r/'profile';p.mkdir(mode=0o700);s=p/'settings.json';s.write_text(json.dumps(d['settings']));s.chmod(0o600)",JSON.stringify({root:remoteRoot,settings}))
 // A test-only transport copy chooses a disposable native profile. Product transport stays unchanged.
 const file=path.join(tunnel,'agent_process.py');let source=fs.readFileSync(file,'utf8');const marker='    script = setup + f"cd '
 assert.ok(source.includes(marker));source=source.replace(marker,'    setup += '+JSON.stringify('export CLAUDE_CONFIG_DIR='+quote(remoteRoot+'/profile')+';')+'\n'+marker);fs.writeFileSync(file,source)
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs');if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({CLAUDE_CONFIG_DIR:profile,AGENTS_COMPANY_TUNNEL_DIR:tunnel,NO_PROXY:'127.0.0.1,localhost'},entry)
 const rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,sanitize(r.error));return r.data},until=async(check,label)=>{const start=Date.now();while(Date.now()-start<240000){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,250))}throw Error('Timeout '+label)},idle=id=>until(async()=>{const s=(await rpc('session.status',{employee:id}))[0];if(s.initialization?.status==='failed')throw Error(s.initialization.error);return s.initialization?.status==='ready'&&!s.busy&&!s.acknowledging},'native idle')
 const localEngines=await productionCall('engine.list'),config=localEngines.find(e=>e.engine==='claude').configuration,sdkPath=config.sdkPath&&fs.existsSync(config.sdkPath)?config.sdkPath:require.resolve('@anthropic-ai/claude-agent-sdk')
 await rpc('engine.configure',{engine:'claude',patch:{sdkPath}})
 const host=await rpc('host.create',Object.fromEntries(['host','os','port','identityFile','knownHosts','sshConfig','jump'].filter(k=>target[k]!==undefined).map(k=>[k,target[k]]).concat([['name','Disposable Linux acceptance'],['defaultDirectory',remoteRoot]])))
 await rpc('group.add',{name:'Cloud acceptance',mode:'cloud',hostId:host.id,remoteDir:remoteRoot})
 await rpc('group.add',{name:'Local acceptance'})
 const cloud=await rpc('card.create',{title:'云端验收员',group:'Cloud acceptance',kind:'cloud-native-worker',engine:'claude',model,effort:'low',thinking:false,permissionMode:'bypassPermissions'})
 await idle(cloud.id)
 const local=await f.create('本地验收员','Local acceptance'),group=await rpc('chat.create',{name:'跨主机协作验收',members:[cloud.id,local.id]}),ref='group:'+group.id
 const page=await rpc('plugin.call',{id:'mininotion',method:'page.create',params:{title:'跨主机验收笔记',color:'white'}}),acl=await rpc('plugin.access',{id:'mininotion'})
 await rpc('plugin.access',{id:'mininotion',resourceIds:[page.id],employees:[{employeeId:cloud.id,read:true,write:true,create:false}],expectedRevision:acl.revision})
 await rpc('conversation.file',{conversation:ref,operation:'write',path:'shared.txt',content:'SYNTHETIC_LINUX_SHARED_'+nonce,create:true})
 const prompt='请读取这条群消息中的 shared.txt，把它复制到你自己实际工作的 Linux 目录里，在副本末尾另起一行添加 LINUX_VERIFIED，再用改好的副本更新群里的同一个共享文件，保留并发修改保护。接着把我授权的 MiniNotion 笔记“跨主机验收笔记”改名成“Linux 协作已验证”。完成后在这个群里发一条简短的完成说明，并且单独私聊告诉我你的实际操作系统和工作目录。不操作其他文件。'
 const sent=await rpc('chat.send',{id:group.id,text:prompt,files:['@workspace/shared.txt'],mentions:[cloud.id],clientMessageId:'cloud-natural-'+nonce})
 await until(async()=>{const m=(await rpc('chat.history',{id:group.id})).messages.find(m=>m.id===sent.id);if(m.deliveries.some(d=>d.status==='failed'))throw Error(m.deliveries.find(d=>d.status==='failed').error);return m.deliveries.every(d=>d.status==='completed')},'cloud native group work')
 await idle(cloud.id)
 const edited=await rpc('conversation.file',{conversation:ref,operation:'read',path:'shared.txt'});assert.ok(edited.content.includes('SYNTHETIC_LINUX_SHARED_'+nonce));assert.ok(edited.content.includes('LINUX_VERIFIED'))
 assert.equal((await rpc('plugin.call',{id:'mininotion',method:'page.get',params:{pageId:page.id}})).title,'Linux 协作已验证')
 const native=await rpc('session.transcript',{employee:cloud.id,thinking:true}),tools=native.items.flatMap(i=>i.role==='assistant'?i.blocks.filter(b=>b.kind==='tool'):[]),commands=tools.filter(t=>/agents_company_api/.test(t.name)).map(t=>t.input)
 for(const name of ['conversation.entry','conversation.download','conversation.upload','plugin.call','chat.post','direct.post'])assert.ok(commands.some(c=>c.command===name),name+' must be independently chosen by the real native agent')
 const privateHistory=await rpc('direct.history',{employee:cloud.id});assert.ok(privateHistory.items.some(i=>i.role==='assistant'&&JSON.stringify(i.blocks).includes(cloud.cwd)));assert.ok(!privateHistory.items.some(i=>i.role==='user'&&i.text===prompt))
 const onLinux=await python("import pathlib,sys,json;p=pathlib.Path(sys.argv[1])".replace('sys.argv[1]',JSON.stringify(cloud.cwd))+";print(json.dumps({'exists':p.is_dir(),'copies':[x.name for x in p.glob('*') if x.is_file() and 'LINUX_VERIFIED' in x.read_text(errors='ignore')]}))")
 assert.ok(JSON.parse(onLinux).copies.length);report.remoteWorkingDirectory=cloud.cwd;report.apiCommands=commands.map(c=>c.command);report.checks.push('Actual Linux original Claude SDK bridge independently chose group file download/edit/versioned upload, Core-local MiniNotion, explicit group and private publication')
 const bytes=Buffer.alloc(1024*1024+19,67),token=await f.token(cloud.id)
 await python("import pathlib,json,sys,base64;d=json.load(sys.stdin);(pathlib.Path(d['cwd'])/'native-binary.bin').write_bytes(base64.b64decode(d['data']))",JSON.stringify({cwd:cloud.cwd,data:bytes.toString('base64')}))
 const upload=await rpc('conversation.upload',{conversation:ref,from:{path:'native-binary.bin'},path:'native-binary.bin',clientRequestId:'live-native-binary-'+nonce},token)
 await until(async()=>{const s=await rpc('conversation.upload-status',{id:upload.id},token);if(s.state==='failed')throw Error(s.error);return s.state==='completed'},'real Linux binary upload')
 const workspace=await rpc('conversation.workspace',{conversation:ref}),shared=fs.readFileSync(path.join(workspace.root,'native-binary.bin'));assert.equal(createHash('sha256').update(shared).digest('hex'),createHash('sha256').update(bytes).digest('hex'))
 report.checks.push('Real SSH/Python remote binary upload matches a 1 MiB fixture SHA-256 exactly')
 assert.equal(await remoteHashes(),before);report.checks.push('Existing remote native configuration hashes unchanged');report.passed=true
 console.log('PASS actual Linux Claude/DeepSeek Flash low: natural group files + MiniNotion + explicit group/private APIs; real binary transport; remote native configuration preserved')
}catch(error){report.error=sanitize(error);throw error}
finally{
 await f?.close();try{await python("import pathlib,shutil; p=pathlib.Path("+JSON.stringify(remoteRoot)+");assert p.name.startswith('bot-workers-');shutil.rmtree(p)")}catch(e){report.cleanupError=sanitize(e);report.passed=false}
 const out=path.join(root,'artifacts/bot-workers');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'cloud-claude-live-result.json'),sanitize(JSON.stringify(report,null,2))+'\n');fs.rmSync(temp,{recursive:true,force:true})
}
