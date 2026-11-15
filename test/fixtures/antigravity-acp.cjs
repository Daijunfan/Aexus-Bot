#!/usr/bin/env node
// Matches official Antigravity 1.5.9 ACP IDs and capabilities; no model service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline')
if(process.argv.includes('--version')){console.log('1.5.9-fixture');process.exit(0)}
const at=process.argv.indexOf('--log-file'),dir=path.dirname(process.argv[at+1]);fs.mkdirSync(dir,{recursive:true})
const settings=JSON.parse(process.argv[process.argv.indexOf('--settings')+1]);if(settings.toolPermission!=='strict')throw Error('Core must receive native permission requests')
const file=path.join(dir,'fixture-session.json'),wire=path.join(dir,'fixture-protocol.jsonl'),inputs=path.join(dir,'native-inputs.jsonl'),saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{}
let session=saved.session??crypto.randomUUID(),model=saved.model??'fixture-gemini',effort=saved.effort??'low',mode='default',authenticated=process.env.AC_AGY_AUTHENTICATED==='1',servers=[],pendingTurn
const permissions=new Map(),send=value=>process.stdout.write(JSON.stringify(value)+'\n'),reply=(id,result)=>send({jsonrpc:'2.0',id,result}),error=(id,message,code=-32000)=>send({jsonrpc:'2.0',id,error:{code,message}}),update=entry=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:session,update:entry}})
const options=()=>[{id:'model',category:'model',name:'Model',type:'select',currentValue:model,options:[{value:'fixture-gemini',name:'Fixture Gemini'},{value:'fixture-gemini-fast',name:'Fixture Gemini Fast'}]},{id:'thought_level',category:'thought_level',name:'Thinking Level',type:'select',currentValue:effort,options:['low','high'].map(value=>({value,name:value}))},{id:'mode',category:'mode',name:'Mode',type:'select',currentValue:mode,options:['default','accept-edits','plan'].map(value=>({value,name:value}))}]
const save=()=>fs.writeFileSync(file,JSON.stringify({session,model,effort}))
const ask=tool=>new Promise(resolve=>{const id='permission-'+crypto.randomUUID();permissions.set(id,resolve);send({jsonrpc:'2.0',id,method:'session/request_permission',params:{sessionId:session,toolCall:{toolCallId:id,...tool},options:[{optionId:'allow',kind:'allow_once'},{optionId:'deny',kind:'reject_once'}]}})})
async function mcp(name,args){
 const descriptor=servers.find(server=>server.name==='agents-company');if(!descriptor)throw Error('No application MCP in this connection')
 if(!await ask({title:name,kind:'other',rawInput:args}))throw Error('Core denied '+name)
 const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'}
 const call=async(method,params,id)=>{const response=await fetch(descriptor.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id,method,params})});if(response.headers.get('mcp-session-id'))headers['Mcp-Session-Id']=response.headers.get('mcp-session-id');const text=await response.text();if(!text)return {};return JSON.parse(text.trim().startsWith('data:')||text.includes('\ndata:')?text.split('\n').filter(line=>line.startsWith('data:')).at(-1).slice(5):text)}
 await call('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'antigravity-fixture',version:'1'}},'init')
 const result=await call('tools/call',{name,arguments:args},'call');if(result.error||result.result?.isError)throw Error(JSON.stringify(result));return result
}
async function prompt(request){
 const content=request.params.prompt,text=content.map(part=>part.text??'').join('');fs.appendFileSync(inputs,JSON.stringify({text,content,session,model,effort,servers})+'\n')
 if(text.includes('HOLD_FIXTURE')){pendingTurn=request;return}
 if(text.includes('FAIL_FIXTURE'))return error(request.id,'Antigravity fixture failed')
 if(text.includes('[Aexus initialization]')){await mcp('agents_company_documentation',{operation:'identity'});await mcp('agents_company_documentation',{operation:'index'})}
 if(text.includes('WRITE_FIXTURE')){const target=path.join(process.cwd(),'approval.txt'),allow=await ask({title:'Write approval.txt',kind:'edit',rawInput:{path:target,content:'approved'}});if(allow)fs.writeFileSync(target,'approved')}
 update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:text.includes('[Aexus initialization]')?'OK':'ANTIGRAVITY_REPLY '+text}})
 update({sessionUpdate:'usage_update',used:42,size:1000});reply(request.id,{stopReason:'end_turn'});save()
}
readline.createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line),params=request.params??{};fs.appendFileSync(wire,JSON.stringify(request)+'\n')
 if(permissions.has(request.id)){const resolve=permissions.get(request.id);permissions.delete(request.id);resolve(request.result?.outcome?.optionId==='allow');return}
 if(request.method==='initialize')return reply(request.id,{protocolVersion:1,agentInfo:{name:'Antigravity ACP Server',version:'1.5.9'},agentCapabilities:{loadSession:true,promptCapabilities:{image:true},sessionCapabilities:{resume:{},close:{}}},authMethods:[{id:'gemini-api-key',name:'Gemini API key'},{id:'oauth-personal',name:'Log in with Google'}]})
 if(request.method==='authenticate'){if(params.methodId!=='gemini-api-key')throw Error('Discovery cannot open Google OAuth');authenticated=true;return reply(request.id,{})}
 if(['session/new','session/resume','session/load'].includes(request.method)){
  if(!authenticated)return error(request.id,'Authentication required')
  if(params.sessionId)session=params.sessionId;servers=params.mcpServers??[];if(servers.length&&!process.argv.includes('--process-per-session'))throw Error('Antigravity HTTP MCP requires a process per session');save()
  update({sessionUpdate:'available_commands_update',availableCommands:[{name:'fixture-skill',description:'Native Antigravity command',input:{hint:'[arguments]'}}]})
  return reply(request.id,{sessionId:session,configOptions:options(),modes:{currentModeId:mode,availableModes:['default','accept-edits','plan'].map(id=>({id,name:id}))}})
 }
 if(request.method==='session/set_config_option'){
  const option=options().find(option=>option.id===params.configId);if(!option?.options.some(choice=>choice.value===params.value))return error(request.id,'Choose an advertised native option')
  if(params.configId==='model')model=params.value;if(params.configId==='thought_level')effort=params.value;if(params.configId==='mode')mode=params.value;save();return reply(request.id,{configOptions:options()})
 }
 if(request.method==='session/prompt')return void prompt(request).catch(cause=>error(request.id,cause.message))
 if(request.method==='session/cancel'){for(const resolve of permissions.values())resolve(false);permissions.clear();if(pendingTurn){reply(pendingTurn.id,{stopReason:'cancelled'});pendingTurn=undefined}return}
 if(request.method==='session/close')return reply(request.id,{})
 if(request.id!==undefined)reply(request.id,{})
}).on('close',()=>process.exit(0))
process.on('SIGTERM',()=>process.exit(0))
