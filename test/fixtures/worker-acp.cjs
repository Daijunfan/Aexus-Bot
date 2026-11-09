#!/usr/bin/env node
// ACP protocol fixture for graphical OpenCode/Kilo Workers. No network, model service or Company identity.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline')
if(process.argv.includes('--version')){console.log('worker-acp-fixture-1');process.exit(0)}
const dir=process.env.XDG_STATE_HOME;if(!dir)throw Error('Isolated native state is required');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'worker-fixture.json'),saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;let session=saved?.session??crypto.randomUUID(),model=saved?.model??'fixture/native-1',effort=saved?.effort??'low',waiting
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n'),update=data=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:session,update:data}})+'\n')
const options=()=>[{id:'model',currentValue:model,options:[{value:'fixture/native-1',name:'Native One'},{value:'fixture/native-2',name:'Native Two'}]},{id:'effort',currentValue:effort,options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}]
const save=()=>fs.writeFileSync(file,JSON.stringify({session,model,effort}))
const complete=(request,text)=>{update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Review the native task.'}});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'NATIVE_WORKER_REPLY '+text}});reply(request.id,{stopReason:'end_turn'});waiting=undefined;save()}
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),p=r.params??{}
 if(r.method==='initialize')return reply(r.id,{protocolVersion:1,agentInfo:{name:'fixture',version:'1'},agentCapabilities:{loadSession:true,mcpCapabilities:{http:true}}})
 if(['session/new','session/load','session/resume'].includes(r.method)){if(p.mcpServers?.length)throw Error('Workers must not receive Company MCP');if(p.sessionId)session=p.sessionId;save();return reply(r.id,{sessionId:session,configOptions:options()})}
 if(r.method==='session/set_config_option'){if(p.configId==='model')model=p.value;if(p.configId==='effort')effort=p.value;save();return reply(r.id,{configOptions:options()})}
 if(r.method==='session/prompt'){const text=p.prompt.map(part=>part.text??'').join('');fs.appendFileSync(path.join(dir,'native-inputs.jsonl'),JSON.stringify({text,model,session})+'\n');if(text.includes('FAIL_FIXTURE'))return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Native Worker fixture failure'}})+'\n');if(text.includes('HOLD_FIXTURE')){waiting=r;return}return complete(r,text)}
 if(r.method==='session/cancel'){if(waiting){reply(waiting.id,{stopReason:'cancelled'});waiting=undefined}return}
 if(r.id!==undefined)reply(r.id,{})
}).on('close',()=>process.exit(0))
process.on('SIGTERM',()=>process.exit(0))
