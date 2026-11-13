// Exercise native HTTP/RPC contracts without credentials, vendor apps or billed turns.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {build} from 'esbuild'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-bot-wire-')),require=createRequire(import.meta.url),calls=[],checks=[]
process.env.AGENTS_COMPANY_HOME=path.join(temp,'state');delete process.env.AGENTS_COMPANY_TEST_BOTS_URL
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
const bots=Array.from({length:53},(_,i)=>({agentId:'grok-'+i,name:'Grok '+i,description:'Instructions '+i,title:'Analyst',kind:'GROK_BOT_AGENT_KIND_AGENT',avatarShape:'cloud',avatarColor:'blue',viewerIsOwner:true})),rooms=Array.from({length:3},(_,i)=>({agentId:'room-'+i,name:'Room '+i,kind:i===0?2:i===1?'ROOM':'GROK_BOT_AGENT_KIND_ROOM',description:'Group goal',memberAgentIds:['grok-0','grok-1'],viewerCanManage:true})),grokItems=[...bots,...rooms]
const dots=Array.from({length:29},(_,i)=>({id:'dot-'+i,display_name:'Dot '+i,description:'Native Dot instructions',messaging_room_id:i===28?undefined:'dot-room-'+i,is_primary:i===0,is_paused:false,active_root_thread_id:'thread-'+i}))
let truncated=false,repeatedCursor=false
const server=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const part of req)raw+=part
  const url=new URL(req.url,'http://127.0.0.1'),body=raw?JSON.parse(raw):{},method=req.method,route=url.pathname;calls.push({method,route,query:Object.fromEntries(url.searchParams),body})
  let value={}
  if(route.startsWith('/grok/')){
   switch(route.slice(6)){
    case 'ListGrokBotAgents':assert.equal(body.includeTeamAgents,true);value={agents:grokItems,truncated};break
    case 'UpdateGrokBotAgent':{assert.equal(body.partialUpdate,true);const item=grokItems.find(item=>item.agentId===body.id);for(const [key,value]of Object.entries(body))if(!['id','partialUpdate'].includes(key))item[key]=value;value={agent:item};break}
    case 'SetGrokBotRoomMembers':{const item=grokItems.find(item=>item.agentId===body.agentId);item.memberAgentIds=body.memberAgentIds;value={agent:item};break}
    case 'CreateGrokBotTemporalAgent':assert.equal(body.harness,'GROK_BOT_AGENT_HARNESS_KIND_TEMPORAL');assert.equal(body.introductionSuppressed,true);assert.equal(body.kickstartRequested,false);value={agent:{...body,kind:'GROK_BOT_AGENT_KIND_AGENT',viewerIsOwner:true}};grokItems.push(value.agent);break
    case 'CreateGrokBotRoom':assert.deepEqual(body.humanMemberUserIds,[]);value={agent:{...body,kind:'GROK_BOT_AGENT_KIND_ROOM',viewerIsOwner:true}};grokItems.push(value.agent);break
    case 'DuplicateGrokBotAgent':value={agent:{...grokItems.find(item=>item.agentId===body.sourceAgentId),agentId:body.agentId}};grokItems.push(value.agent);break
    case 'InterruptGrokBotAgentRun':assert.equal(body.reason,'user-request');value={hadActiveRun:true};break
    case 'StartFreshGrokBotConversation':assert.equal(body.agentId,'grok-0');break
    case 'DeleteGrokBotAgent':grokItems.splice(grokItems.findIndex(item=>item.agentId===body.id),1);break
    default:throw Error('Unexpected Grok method '+route)
   }
  }else if(route==='/dots/tbo'&&method==='GET'){
   assert.equal(url.searchParams.get('limit'),'25');assert.equal(url.searchParams.get('include_room_preview'),'false')
   value=url.searchParams.has('cursor')?{items:dots.slice(25),cursor:repeatedCursor?'page-two':null}:{items:dots.slice(0,25),cursor:'page-two'}
  }else if(route==='/dots/tbo'&&method==='POST'){
   assert.equal(body.create_thread,true);assert.equal(body.should_initialize,true);assert.equal(body.create_additional,true);assert.equal(body.avatar_type,'default');assert.deepEqual(body.avatar_manifest,{schema_version:1,tint:'gray'});value={id:'created-dot',display_name:body.display_name,description:body.description,messaging_room_id:'created-room',active_root_thread_id:'created-thread'};dots.push(value)
  }else if(route==='/dots/tbo/primary'&&method==='PUT'){for(const item of dots)item.is_primary=item.id===body.tbo_id}
  else if(route.startsWith('/dots/tbo/')){
   const [,id,...suffix]=route.slice(6).split('/'),item=dots.find(item=>item.id===id);assert.ok(item,'Known native Dot ID '+id)
   if(method==='GET')value=item
   else if(method==='PATCH'){assert.deepEqual(Object.keys(body),['display_name']);item.display_name=body.display_name;value=item}
   else if(method==='POST'&&suffix[0]==='messaging-room'){item.messaging_room_id='initialized-room';value=item}
   else if(method==='POST'&&suffix[0]==='runtime'){assert.deepEqual(body,{});item.is_paused=suffix[1]==='pause';value={status:'applied',thread_id:item.active_root_thread_id}}
   else if(method==='DELETE'){assert.equal(url.searchParams.get('thread_id'),item.active_root_thread_id);dots.splice(dots.indexOf(item),1)}
   else throw Error('Unexpected Dot request '+method+' '+route)
  }else throw Error('Unexpected request '+method+' '+route)
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))
 }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try{
 const transport=path.join(root,'src/main/bot-bridge/http.ts'),origin='http://127.0.0.1:'+server.address().port,entry=path.join(temp,'catalog.cjs')
 const fixtureEntry=path.join(temp,'entry.ts');fs.writeFileSync(fixtureEntry,'export * from '+JSON.stringify(path.join(root,'src/main/bot-bridge/catalog.ts'))+';export {remoteBots} from '+JSON.stringify(path.join(root,'src/main/bot-bridge/client.ts'))+';')
 await build({entryPoints:[fixtureEntry],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'isolated-native-management-wire',setup(b){
  b.onResolve({filter:/^\.\/credentials$/},args=>args.importer.includes('/bot-bridge/')?{path:'credentials',namespace:'fixture'}:undefined)
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class CredentialError extends Error{};export const getChatGptAuth=()=>({accountId:'fixture-dot',userId:'fixture-user',accessToken:'not-a-credential',expired:false});export const getGrokAuth=()=>({accountId:'fixture-grok',userId:'fixture-user',accessToken:'not-a-credential',expired:false});export const getGrokComputerKeys=()=>{throw Error('No native computers in this fixture')};export const decodeJwt=()=>null`,loader:'js'}))
  b.onResolve({filter:/^\.\/http$/},args=>/bot-bridge\/(dots|grok|client)\.ts$/.test(args.importer)?{path:'http',namespace:'wire'}:undefined)
  b.onLoad({filter:/.*/,namespace:'wire'},()=>({contents:`import * as wire from ${JSON.stringify(transport)};const target=value=>{const url=new URL(value);return ${JSON.stringify(origin)}+(url.hostname==='chatgpt.com'?'/dots'+url.pathname.replace('/backend-api',''):'/grok/'+url.pathname.split('/').at(-1))+url.search};export const httpJson=(url,options)=>wire.httpJson(target(url),options);export const httpStream=(url,options)=>wire.httpStream(target(url),options)`,loader:'js',resolveDir:root}))
 }}]})
 const native=require(entry),pass=message=>{checks.push(message);console.log('PASS '+message)}
 const g=await native.readNativeCatalog('grok'),d=await native.readNativeCatalog('dots');assert.equal(g.items.filter(item=>item.kind==='private').length,53);assert.equal(g.items.filter(item=>item.kind==='group').length,3);assert.equal(d.items.length,29);assert.equal(d.items.at(-1).messagingId,undefined);assert.equal(calls.filter(call=>call.route==='/dots/tbo').length,2);assert.ok(!calls.some(call=>/messages|Transcript|Send/.test(call.route)))
 const imported=await native.remoteBots('grok');assert.equal(imported.length,56);assert.deepEqual(imported.filter(item=>item.kind==='group').map(item=>item.id).sort(),rooms.map(item=>item.agentId).sort())
 pass('Native wire lists 53 Grok bots, three rooms including numeric and short enums, consistent with legacy sync, and every Dot page without opening any conversations')
 truncated=true;assert.equal((await native.readNativeCatalog('grok')).complete,false);truncated=false;repeatedCursor=true;await assert.rejects(()=>native.readNativeCatalog('dots'),/repeated directory cursor/);repeatedCursor=false
 pass('Native truncation remains explicit and a repeated Dot cursor stops instead of looping or claiming complete counts')
 await native.configureNative(g.items[0],{name:'Renamed',grokColor:'violet'});assert.equal(bots[0].name,'Renamed');assert.equal(bots[0].description,'Instructions 0');assert.deepEqual(calls.at(-1).body,{id:'grok-0',partialUpdate:true,name:'Renamed',avatarColor:'violet'})
 await native.configureNative(d.items[0],{name:'Renamed Dot'});assert.equal(dots[0].display_name,'Renamed Dot');await assert.rejects(()=>native.configureNative(d.items[0],{description:'Unverified mutation'}),/read-only/)
 await native.setNativeMembers(g.items.find(item=>item.nativeId==='room-0'),['grok-1','grok-2']);assert.deepEqual(rooms[0].memberAgentIds,['grok-1','grok-2']);pass('Profile writes use verified partial update fields, preserve instructions and apply actual native group membership')
 const bot=await native.createNativeProfile('grok',{name:'Created bot',description:'Created goal',kind:'private',members:[],requestId:randomUUID()}),room=await native.createNativeProfile('grok',{name:'Created room',description:'Group goal',kind:'group',members:['grok-0'],requestId:randomUUID()}),dot=await native.createNativeProfile('dots',{name:'Created Dot',description:'Dot goal',kind:'private',members:[],requestId:randomUUID()});assert.equal(bot.kind,'private');assert.equal(room.kind,'group');assert.equal(dot.nativeId,'created-dot');pass('Native creation uses stable Grok identities, the native group contract and the verified Dot initialization payload')
 const connected=await native.connectNativeProfile(d.items.at(-1));assert.equal(connected.messagingId,'initialized-room');await native.controlNative(d.items[0],'pause',randomUUID());assert.equal(dots[0].is_paused,true);await native.controlNative(d.items[0],'resume',randomUUID());assert.equal(dots[0].is_paused,false);await native.controlNative(d.items[1],'primary',randomUUID());assert.equal(dots[1].is_primary,true)
 await native.controlNative(g.items[0],'interrupt',randomUUID());await native.controlNative(g.items[0],'new-conversation',randomUUID());const duplicated=await native.controlNative(g.items[0],'duplicate',randomUUID());assert.notEqual(duplicated.nativeId,g.items[0].nativeId);await native.deleteNative(bot);await native.deleteNative(dot);assert.ok(!grokItems.some(item=>item.agentId===bot.nativeId));assert.ok(!dots.some(item=>item.id===dot.nativeId));pass('Both providers use the correct native room, runtime, primary, interrupt, reset, duplicate and deletion endpoints')
 assert.ok(!calls.some(call=>/Billing|Payment|OnDemand|Spend/.test(call.route)))
 const out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||'artifacts/bot-management/wire');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,paidModelCalls:0,productionStateUsed:false},null,2)+'\n')
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
