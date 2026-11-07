// Actual Claude Code + configured OpenAI route. Disposable Core/profile; metadata-only wire capture.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {call as live} from '../artifacts/engine-native/live-control.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Requires --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-sol-xhigh-')),profile=path.join(temp,'claude'),capture=path.join(temp,'wire.jsonl'),routerSource=path.join(os.homedir(),'.claude/model-router/router.py'),config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude/model-router/routes.json'))),native=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude/settings.json'))),key=fs.readFileSync(config.local_token_file,'utf8').trim(),sanitize=s=>String(s).replaceAll(key,'[redacted]'),report={passed:false,engine:'claude',model:'gpt-6.1-sol',requestedEffort:'xhigh',productionUserData:false};let f,router
try{
 fs.mkdirSync(profile);fs.mkdirSync(path.join(profile,'model-router'));fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 fs.writeFileSync(path.join(profile,'model-router/routes.json'),JSON.stringify(config),{mode:0o600})
 const runner=path.join(temp,'capture-router.py');fs.writeFileSync(runner,`import importlib.util,json,sys,pathlib\ns=importlib.util.spec_from_file_location('native_router',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.build_responses_request\ndef capture(payload,route):\n r=original(payload,route)\n with open(sys.argv[3],'a') as f:f.write(json.dumps({'model':r.get('model'),'reasoning':r.get('reasoning'),'clientEffort':payload.get('output_config',{}).get('effort')})+'\\n')\n return r\nm.build_responses_request=capture\nclass Observed(m.Handler):\n def note(self,value):\n  with open(sys.argv[3]+'.errors','a') as f:f.write(json.dumps(value)+'\\n')\n def reply(self,status,data):\n  if status>=400:self.note({'status':status,'error':data.get('error',{}).get('message')})\n  return super().reply(status,data)\n def emit(self,event,data):\n  if event=='error':self.note({'event':event,'error':data.get('error',{}).get('message')})\n  return super().emit(event,data)\n def log(self,model,route,status,path):\n  self.note({'model':model,'status':status});return super().log(model,route,status,path)\nserver=m.ThreadingHTTPServer(('127.0.0.1',0),Observed);server.config=json.loads(pathlib.Path(sys.argv[2]).read_text());print(json.dumps({'port':server.server_address[1]}),flush=True);server.serve_forever()\n`)
 router=spawn('python3',['-u',runner,routerSource,path.join(profile,'model-router/routes.json'),capture],{stdio:['ignore','pipe','pipe']});const routerDone=new Promise(r=>router.once('exit',r));let log='';router.stderr.on('data',b=>log+=b)
 const port=await new Promise((resolve,reject)=>{let text='';router.stdout.on('data',b=>{text+=b;const line=text.split('\n')[0];try{resolve(JSON.parse(line).port)}catch{}});router.once('exit',()=>reject(Error(sanitize(log))))})
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({model:'gpt-6.1-sol',effortLevel:'high',modelPicker:native.modelPicker,env:{...native.env,ANTHROPIC_BASE_URL:'http://127.0.0.1:'+port,ANTHROPIC_AUTH_TOKEN:key},permissions:{deny:['Agent','Task']}}),{mode:0o600})
 const entry=path.join(temp,'daemon.cjs');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({CLAUDE_CONFIG_DIR:profile,NO_PROXY:'127.0.0.1,localhost'},entry)
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,sanitize(r.error));return r.data},until=async(check,label)=>{const start=Date.now();while(Date.now()-start<180000){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,200))}throw Error('Timeout '+label)}
 const engines=await live('engine.list'),sdkPath=engines.find(e=>e.engine==='claude').configuration.sdkPath;await rpc('engine.configure',{engine:'claude',patch:{sdkPath}})
 const models=(await rpc('engine.models',{engine:'claude'})).models,sol=models.find(m=>m.value==='gpt-6.1-sol');assert.ok(sol.supportedEffortLevels.includes('xhigh'))
 await rpc('group.add',{name:'Routing acceptance'});const actor=await rpc('card.create',{title:'Route verifier',group:'Routing acceptance',engine:'claude',model:'gpt-6.1-sol',effort:'xhigh',thinking:true,permissionMode:'bypassPermissions'})
 await until(async()=>{const s=(await rpc('session.status',{employee:actor.id}))[0];if(s.initialization?.status==='failed')throw Error(s.initialization.error);return s.initialization?.status==='ready'&&!s.busy},'native initialization')
 const opened=await rpc('session.open',{cardId:actor.id}),initial=await rpc('session.info',{id:opened.sessionId});assert.equal(initial.effort,'xhigh')
 await rpc('session.send',{employee:actor.id,text:'只在原生会话输出 ENGINE_WIRE_OK。不要使用工具，不要发私聊或群聊。'})
 await until(async()=>!(await rpc('session.info',{id:opened.sessionId})).busy,'wire probe response')
 assert.ok((await rpc('session.transcript',{employee:actor.id})).text.includes('ENGINE_WIRE_OK'))
 const requests=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);assert.ok(requests.length);assert.ok(requests.every(r=>r.model==='gpt-6.1-sol'&&r.reasoning?.effort==='xhigh'&&r.clientEffort==='max'),JSON.stringify(requests))
 await rpc('config.effort',{id:opened.sessionId,effort:'high'});await rpc('config.effort',{id:opened.sessionId,effort:'xhigh'});assert.equal((await rpc('session.info',{id:opened.sessionId})).effort,'xhigh')
 await rpc('session.close',{id:opened.sessionId});const reopened=await rpc('session.open',{cardId:actor.id});assert.equal((await rpc('session.info',{id:reopened.sessionId})).effort,'xhigh')
 report.passed=true;report.requests=requests;report.nativeModelMenu=sol.supportedEffortLevels;report.hotSwitchAndReopen=true;console.log('PASS actual Claude Code: Sol logical xhigh stays xhigh across start/hot switch/reopen; real OpenAI wire uses gpt-6.1-sol reasoning.effort=xhigh')
}catch(e){report.error=sanitize(e);throw e}
finally{if(fs.existsSync(capture))report.requests=fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);if(fs.existsSync(capture+'.errors'))report.upstreamDiagnostics=fs.readFileSync(capture+'.errors','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);await f?.close();router?.kill('SIGTERM');fs.mkdirSync(path.join(root,'artifacts/poster-acceptance'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/poster-acceptance/xhigh-wire-result.json'),sanitize(JSON.stringify(report,null,2)));fs.rmSync(temp,{recursive:true,force:true})}
