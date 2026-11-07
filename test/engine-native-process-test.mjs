// Installed native clients; synthetic shared profiles and a deterministic loopback provider.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const binaries={cline:process.env.AGENTS_TEST_CLINE_BIN,pi:process.env.AGENTS_TEST_PI_BIN}
if(!binaries.cline||!binaries.pi){console.log('SKIP set AGENTS_TEST_CLINE_BIN and AGENTS_TEST_PI_BIN for native inheritance verification');process.exit(0)}
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-native-process-')),before={...process.env},requests=[],events=[],clients=[]
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value),{mode:0o600})}
const home=path.join(temp,'home');fs.mkdirSync(home);fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
Object.assign(process.env,{HOME:home,USERPROFILE:home,AGENTS_COMPANY_HOME:path.join(temp,'state'),CLINE_BIN:binaries.cline,PI_BIN:binaries.pi,CLINE_DATA_DIR:path.join(home,'.cline/data'),PI_CODING_AGENT_DIR:path.join(home,'.pi/agent')})
const gateway=http.createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part
 const body=JSON.parse(raw);requests.push({model:body.model,path:req.url,clineKey:req.headers.authorization==='Bearer NATIVE_CLINE_KEY',piKey:req.headers.authorization==='Bearer NATIVE_PI_KEY'})
 res.writeHead(200,{'content-type':'text/event-stream'})
 for(const [delta,finish] of [[{role:'assistant'},null],[{content:'NATIVE_PROFILE_OK'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'native-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n')
 res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${gateway.address().port}/native/v1`
try{
 const clineFile=path.join(process.env.CLINE_DATA_DIR,'settings/providers.json'),piFile=path.join(process.env.PI_CODING_AGENT_DIR,'models.json')
 write(clineFile,{version:1,lastUsedProvider:'openai-compatible',providers:{'openai-compatible':{settings:{provider:'openai-compatible',model:'cline-native-b',baseUrl:endpoint,apiKey:'NATIVE_CLINE_KEY'},updatedAt:new Date().toISOString()}}})
 write(path.join(process.env.CLINE_DATA_DIR,'settings/models.json'),{version:1,providers:{'openai-compatible':{models:{'cline-native-a':{id:'cline-native-a',name:'Native A'},'cline-native-b':{id:'cline-native-b',name:'Native B'}}}}})
 write(path.join(process.env.PI_CODING_AGENT_DIR,'settings.json'),{defaultProvider:'native-pi',defaultModel:'pi-native-b',defaultThinkingLevel:'low'})
 write(piFile,{providers:{'native-pi':{baseUrl:endpoint,api:'openai-completions',apiKey:'NATIVE_PI_KEY',models:[{id:'pi-native-a',name:'Native A',reasoning:true},{id:'pi-native-b',name:'Native B',reasoning:true}]}}});write(path.join(process.env.PI_CODING_AGENT_DIR,'auth.json'),{})
 const originals=new Map([clineFile,piFile].map(file=>[file,fs.readFileSync(file)])),entry=path.join(temp,'clients.cjs')
 await build({stdin:{contents:"export {clineClient} from './src/main/engines/cline-client';export {piClient} from './src/main/engines/pi-client'",resolveDir:root},outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 const {clineClient,piClient}=createRequire(import.meta.url)(entry),cwd=path.join(temp,'workspace');fs.mkdirSync(cwd)
 const cline=await clineClient({cwd,directory:path.join(temp,'cline-runtime'),onUpdate:e=>events.push(e)});clients.push(cline)
 assert.equal(cline.native,true);assert.equal(cline.model,'cline-native-b');assert.deepEqual(cline.models.map(m=>m.id),['cline-native-a','cline-native-b'])
 await cline.call('initialize',{protocolVersion:1,clientInfo:{name:'native-profile-test',version:'1'},clientCapabilities:{}})
 const session=await cline.call('session/new',{cwd,mcpServers:[]});await cline.call('session/set_config_option',{sessionId:session.sessionId,configId:'model',value:cline.model})
 await cline.call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'Return the fixture reply.'}]},45000)
 assert.ok(events.some(e=>e.sessionUpdate==='agent_message_chunk'&&e.content?.text.includes('NATIVE_PROFILE_OK')))
 assert.ok(requests.some(r=>r.model==='cline-native-b'&&r.clineKey&&!r.piKey));await cline.close()
 const pi=piClient({cwd,directory:path.join(temp,'pi-runtime'),onEvent:e=>events.push(e)});clients.push(pi)
 const state=await pi.call('get_state'),models=await pi.call('get_available_models');assert.equal(pi.native,true);assert.equal(state.model.id,'pi-native-b');assert.equal(state.model.provider,'native-pi');assert.equal(state.thinkingLevel,'low');assert.deepEqual(models.models.filter(m=>m.provider==='native-pi').map(m=>m.id).sort(),['pi-native-a','pi-native-b'])
 await pi.call('prompt',{message:'Return the fixture reply.'})
 await new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(events.some(e=>e.type==='agent_settled')){clearInterval(timer);resolve()}else if(Date.now()-started>30000){clearInterval(timer);reject(Error('Pi native prompt did not settle'))}},50)})
 assert.ok(events.some(e=>e.type==='message_update'&&e.assistantMessageEvent?.delta==='NATIVE_PROFILE_OK'));assert.ok(requests.some(r=>r.model==='pi-native-b'&&r.piKey&&!r.clineKey));await pi.close()
 for(const [file,data]of originals)assert.deepEqual(fs.readFileSync(file),data,'native source changed')
 assert.ok(requests.every(r=>r.path==='/native/v1/chat/completions'))
 fs.mkdirSync(path.join(root,'artifacts/engine-native'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/engine-native/native-process-result.json'),JSON.stringify({passed:true,checks:['Installed Cline inherits active provider, exact model, all native models and its own credential','Installed Pi inherits active provider, exact model, all native models, its own credential and native low thinking','Real outgoing requests match native model and engine-specific credential','Canonical native profiles remain unchanged'],requests,paidCalls:0},null,2)+'\n')
 console.log('PASS installed Cline and Pi inherit native provider, full models and separate keys; Pi preserves low thinking; real loopback requests and untouched canonical files')
}finally{
 for(const client of clients)await client.close();gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve))
 for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);fs.rmSync(temp,{recursive:true,force:true})
}
