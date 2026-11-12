// Actual engine adapters and authenticated Core; deterministic SDK/ACP/RPC/MCP peers only.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-plugin-native-')),checks=[];let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=path.join(temp,'daemon.cjs');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 const codex=path.join(temp,'codex.cjs'),processPeer=path.join(temp,'process.cjs'),sdk=path.join(temp,'sdk.mjs')
 let source=fs.readFileSync(path.join(root,'test/fixtures/initialization-codex.cjs'),'utf8'),marker='async function readWorkDocument(text){';assert.ok(source.includes(marker))
 source=source.replace(marker,marker+`const requestFile=path.join(control,employee+'.fetch-request.json');if(fs.existsSync(requestFile)){const input=JSON.parse(fs.readFileSync(requestFile,'utf8')),response=await nativeTool('agents_company_api',input);note('fetch-result',response.result);return}\n`);fs.writeFileSync(codex,source,{mode:0o755})
 source=fs.readFileSync(path.join(root,'test/fixtures/process-adapter.cjs'),'utf8').replace("title:name==='agents_company_documentation'?'Aexus documentation':'Aexus discussion'","title:name==='agents_company_documentation'?'Aexus documentation':name==='agents_company_api'?'Aexus API':'Aexus discussion'")
 marker=' const post=control&&employee?workPostArgs(text,control,employee):undefined';assert.ok(source.includes(marker))
 source=source.replace(marker,`const requestFile=path.join(control,employee+'.fetch-request.json');if(fs.existsSync(requestFile)){const response=await nativeTool('agents_company_api',JSON.parse(fs.readFileSync(requestFile,'utf8')));note('fetch-result',acp?response.result:response.content?response:{content:[{type:'text',text:JSON.stringify(response.result)}]});finish('FETCH_OK');return}\n`+marker);fs.writeFileSync(processPeer,source,{mode:0o755})
 source=fs.readFileSync(path.join(root,'test/fixtures/discussion-claude-sdk.mjs'),'utf8');marker='}else{const post=workPostArgs';assert.ok(source.includes(marker))
 source=source.replace(marker,`}else{if(fs.existsSync(file('.fetch-request.json'))){const result=await nativeTool('agents_company_api',JSON.parse(fs.readFileSync(file('.fetch-request.json'),'utf8')));note('fetch-result',result)}const post=workPostArgs`);fs.writeFileSync(sdk,source)
 f=await fixtureCore({CODEX_BIN:codex,CLINE_BIN:processPeer,PI_BIN:processPeer,CLAUDE_CONFIG_DIR:path.join(temp,'claude')},entry)
 const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
 await rpc('engine.configure',{engine:'claude',patch:{path:'/usr/bin/true',sdkPath:sdk}})
 for(const engine of ['cline','pi'])await rpc('engine.configure',{engine,patch:{apiKey:'fixture-only-not-real'}})
 await rpc('group.add',{name:'Native readers'})
 const plug=(method,params={})=>rpc('plugin.call',{id:'mininotion',method,params});const page=await plug('page.create',{title:'Native scoped note',color:'white'});await plug('page.write-markdown',{pageId:page.id,markdown:'NATIVE_PLUGIN_SCOPE_TEXT'});
 for(const engine of ['codex','claude','cline','pi']){
  const card=await rpc('card.create',{title:engine+' scoped editor',group:'Native readers',engine,model:engine==='codex'?'gpt-6-luna':engine==='claude'?'fixture-claude':'deepseek-flash'});await f.ready(card.id)
  const acl=await rpc('plugin.access',{id:'mininotion'});await rpc('plugin.access',{id:'mininotion',resourceIds:[page.id],employees:[{employeeId:card.id,read:true,write:true,create:false}],expectedRevision:acl.revision});
  const {sessionId}=await rpc('session.open',{cardId:card.id});await rpc('config.permission',{id:sessionId,mode:'dontAsk'});
  const requestFile=path.join(f.control,card.id+'.fetch-request.json'),output=path.join(f.control,card.id+'-fetch-result.json');
  const call=async(command,args)=>{fs.rmSync(output,{force:true});fs.writeFileSync(requestFile,JSON.stringify({command,args}));await rpc('session.send',{id:sessionId,text:'Use the granted plugin content for the requested task.'});await f.until(()=>fs.existsSync(output),engine+' plugin API response');await f.until(async()=>!(await f.status(card.id)).busy,'native plugin idle');const result=JSON.parse(fs.readFileSync(output));assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text).data;};
  assert.ok((await call('plugin.resources',{id:'mininotion'})).resources.some(r=>r.id===page.id));assert.ok((await call('plugin.call',{id:'mininotion',method:'page.read-markdown',params:{pageId:page.id}})).markdown.includes('NATIVE_PLUGIN_SCOPE_TEXT'));
  await rpc('config.permission',{id:sessionId,mode:'bypassPermissions'});await call('plugin.call',{id:'mininotion',method:'page.update',params:{pageId:page.id,title:engine+' native edit'}});assert.equal((await plug('page.get',{pageId:page.id})).title,engine+' native edit');
  checks.push(engine+': actual native API transport reads granted plugin pages without write approval, then edits through the same page authorization in Full access; no plugin Team');
 }
 const out=path.join(root,'artifacts/plugin-page-access');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-result.json'),JSON.stringify({passed:true,checks,modelCalls:0},null,2)+'\n');for(const check of checks)console.log('PASS '+check)
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
