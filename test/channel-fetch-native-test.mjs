import {magazinePdf} from './fixtures/magazine-pdf.mjs'
// Actual engine adapters and authenticated Core; deterministic SDK/ACP/RPC/MCP peers only.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {writeNativeProfiles} from './fixtures/native-profiles.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-fetch-native-')),checks=[];let f
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 const entry=process.env.AGENTS_COMPANY_TEST_CORE_ENTRY??path.join(temp,'daemon.cjs');if(!process.env.AGENTS_COMPANY_TEST_CORE_ENTRY)await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
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
 writeNativeProfiles(f.env,{engines:['cline','pi']})
 await rpc('group.add',{name:'Native readers'})
 const src=await rpc('channel.source-add',{plugin:'x',locator:'@nativefetch',name:'Native original author'}),pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP+kAAAAASUVORK5CYII=',publishedAt=Date.now()-1000
 const image=(await rpc('channel.media-put',{sourceId:src.id,externalId:'native-news',publishedAt,mediaKey:'photo',name:'native.png',mimeType:'image/png',data:pixel})).media
 const post=await rpc('channel.publish',{sourceId:src.id,externalId:'native-news',publishedAt,title:'Native LLM story',body:'Full synthetic text with its original image.',mediaIds:[image.id]})
 const caption='caption-only '+('Long native image caption '.repeat(16000))+'CAPTION_END',captionTime=publishedAt-5000
 const captionMedia=(await rpc('channel.media-put',{sourceId:src.id,externalId:'caption-only',publishedAt:captionTime,mediaKey:'photo',name:'caption.png',mimeType:'image/png',data:pixel})).media
 await rpc('channel.publish',{sourceId:src.id,externalId:'caption-only',publishedAt:captionTime,title:'Caption-only fixture',body:caption,mediaIds:[captionMedia.id]})
 let piContent
 for(const engine of ['codex','claude','cline','pi']){
  const card=await rpc('card.create',{title:engine+' reader',group:'Native readers',engine,model:engine==='codex'?'gpt-6-luna':engine==='claude'?'fixture-claude':'deepseek-flash'});await f.ready(card.id)
  const grant=await rpc('channel.access',{id:src.channelId});await rpc('channel.access',{id:src.channelId,employeeIds:[...grant.employeeIds,card.id],expectedRevision:grant.revision})
  const {sessionId}=await rpc('session.open',{cardId:card.id});await rpc('config.permission',{id:sessionId,mode:'dontAsk'})
  const requestFile=path.join(f.control,card.id+'.fetch-request.json'),output=path.join(f.control,card.id+'-fetch-result.json')
  for(const command of ['channel.fetch-text','channel.fetch-images','channel.search']){
   fs.rmSync(output,{force:true});fs.writeFileSync(requestFile,JSON.stringify({command,args:{id:src.channelId,sourceIds:[src.id],since:new Date(publishedAt-1000).toISOString(),until:new Date(publishedAt+1000).toISOString(),keywordsAll:['native'],limit:1,...(command==='channel.search'?{keywordsAny:['LLM'],images:true}:{})}}))
   await rpc('session.send',{id:sessionId,text:'Read the requested synthetic channel item.'});await f.until(()=>fs.existsSync(output),engine+' native API result');await f.until(async()=>!(await f.status(card.id)).busy,'idle')
   const result=JSON.parse(fs.readFileSync(output));assert.ok(!result.isError,JSON.stringify(result));const data=JSON.parse(result.content[0].text).data;assert.equal(data.messages[0].id,post.id)
   const images=result.content.filter(block=>block.type==='image');assert.equal(images.length,command==='channel.fetch-text'?0:1)
   if(images.length){assert.equal(images[0].data,pixel);assert.equal(images[0].mimeType,'image/png');assert.ok(result.content.filter(b=>b.type==='text').every(b=>!b.text.includes(pixel)),'base64 must not be prose');assert.ok(result.content.some(b=>b.type==='text'&&b.text.includes(image.id)));if(engine==='pi')piContent=result.content}
  }
  const readNative=async input=>{fs.rmSync(output,{force:true});fs.writeFileSync(requestFile,JSON.stringify(input));await rpc('session.send',{id:sessionId,text:'Read the long-caption fixture.'});await f.until(()=>fs.existsSync(output),engine+' bounded image metadata');await f.until(async()=>!(await f.status(card.id)).busy,'idle');const value=JSON.parse(fs.readFileSync(output));assert.ok(!value.isError,JSON.stringify(value));return value}
  fs.writeFileSync(path.join(card.cwd,'native-magazine.pdf'),magazinePdf())
  const pdfResult=await readNative({command:'workspace.pdf',args:{employee:card.id,path:'native-magazine.pdf',operation:'page',page:3,width:800}}),pdfImage=pdfResult.content.filter(block=>block.type==='image'),pdfMetadata=JSON.parse(pdfResult.content[0].text).data
  assert.equal(pdfImage.length,1);assert.equal(pdfImage[0].mimeType,'image/png');assert.equal(pdfMetadata.kind,'workspace-pdf-page');assert.equal(pdfMetadata.page,3);assert.match(pdfMetadata.text,/Reading a figure/);assert.equal(pdfMetadata.data,undefined);assert.ok(!pdfResult.content[0].text.includes(pdfImage[0].data));assert.equal(Buffer.from(pdfImage[0].data,'base64').subarray(1,4).toString(),'PNG')
  checks.push(engine+': actual native tool transport returns a real PDF page image and its text under the current employee workspace scope, without write approval or base64 prose')
  const longResult=await readNative({command:'channel.fetch-images',args:{id:src.channelId,limit:1,keywordsAll:['caption-only']}})
  assert.equal(longResult.content.filter(block=>block.type==='image').length,1);assert.ok(longResult.content[0].text.length<=18000)
  const page=JSON.parse(longResult.content[0].text).data;assert.equal(page.kind,'api-result-page')
  const tail=await readNative({command:'api.result',args:{id:page.id,path:'/data/messages/0/text',offset:caption.length-12,limit:30}})
  assert.match(JSON.parse(tail.content[0].text).data.content,/CAPTION_END/)
  checks.push(engine+': authenticated authorized text/images/search through the actual adapter; native image blocks and no duplicate base64 prose; long captions page losslessly with cross-turn continuation; no write approval')
 }
 const files=[],walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.name==='company-discussion.mjs')files.push(file)}};walk(f.env.AGENTS_COMPANY_HOME);assert.ok(files.length)
 const tools=[];const extension=await import(pathToFileURL(files.at(-1)).href);extension.default({registerTool:tool=>tools.push(tool)})
 const actual=await tools.find(tool=>tool.name==='agents_company_api').execute('fixture-call',{},new AbortController().signal,()=>{},{ui:{input:async()=>JSON.stringify({content:piContent})}});assert.deepEqual(actual.content,piContent)
 checks.push('Pi generated extension execute() preserves actual image blocks end to end')
 const out=path.join(root,'artifacts/channel-api');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-result.json'),JSON.stringify({passed:true,checks,providerCalls:0,engines:'deterministic protocol/SDK fixtures'},null,2)+'\n');for(const check of checks)console.log('PASS '+check)
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
