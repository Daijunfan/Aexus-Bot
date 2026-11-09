#!/usr/bin/env node
// A terminal client for the official Harness ACP profile. No Company identity or MCP injection.
const {createInterface}=require('node:readline'),{PassThrough}=require('node:stream'),{StringDecoder}=require('node:string_decoder'),spawn=require('cross-spawn')
const executable=process.argv[2]
if(!executable)throw Error('DeepSeek Harness executable is required')
const env={...process.env}
for(const key of Object.keys(env))if(/^(AGENTS_|AEXUS_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key]
const child=spawn(executable,['--profile','acp'],{cwd:process.cwd(),env,stdio:['pipe','pipe','pipe'],windowsHide:true})
const decoder=new StringDecoder('utf8'),pending=new Map(),queue=[]
let counter=0,buffer='',session,configuration=[],busy=false,permission,closing=false,ready=false
const keyboard=new PassThrough(),inputDecoder=new StringDecoder('utf8'),frame='\x1b]777;aexus-prompt;';let inputBuffer=''
if(process.stdin.isTTY)process.stdin.setRawMode(true)
const terminal=createInterface({input:keyboard,output:process.stdout,terminal:!!process.stdout.isTTY,prompt:'› '})
const write=text=>process.stdout.write(text)
const line=text=>write('\r\x1b[2K'+text+'\n')
const send=value=>{if(!child.stdin.writable)throw Error('DeepSeek Harness has exited');child.stdin.write(JSON.stringify(value)+'\n')}
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++counter,timer=method==='session/prompt'?undefined:setTimeout(()=>{pending.delete(id);reject(Error('DeepSeek '+method+' timed out'))},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});try{send({jsonrpc:'2.0',id,method,params})}catch(error){pending.get(id).reject(error);pending.delete(id)}})
const choices=id=>(configuration.find(option=>option.id===id)?.options??[]).flatMap(option=>option.options??[option])
const name=value=>{try{return JSON.parse(value).join('/')}catch{return value}}
const update=value=>{
 if(value.sessionUpdate==='config_option_update')configuration=value.configOptions
 else if(value.sessionUpdate==='agent_message_chunk'&&value.content?.type==='text')write(value.content.text)
 else if(value.sessionUpdate==='agent_thought_chunk'&&value.content?.type==='text')write('\x1b[2m'+value.content.text+'\x1b[0m')
 else if(value.sessionUpdate==='tool_call')line('\x1b[36m'+(value.title||value.kind||'Tool')+'\x1b[0m')
 else if(value.sessionUpdate==='tool_call_update'&&value.status==='failed')line('Tool failed: '+(typeof value.rawOutput==='string'?value.rawOutput:JSON.stringify(value.content??[])))
}
child.stdout.on('data',data=>{buffer+=decoder.write(data);let end;while((end=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!raw.trim())continue;try{const value=JSON.parse(raw)
 if(value.method==='session/update')update(value.params.update)
 else if(value.method==='session/request_permission'&&value.id!==undefined){permission=value;line('Permission needed: '+(value.params.toolCall?.title||'Native tool')+'\n:allow to approve once · :deny to refuse');terminal.prompt()}
 else if(pending.has(value.id)){const request=pending.get(value.id);pending.delete(value.id);value.error?request.reject(Error(value.error.message)):request.resolve(value.result)}
 }catch(error){line(error.message)}}})
child.stderr.on('data',data=>write(String(data)))
child.stdin.on('error',()=>{})
child.once('error',error=>{line(error.message);process.exitCode=1;terminal.close()})
child.once('close',code=>{for(const request of pending.values())request.reject(Error('DeepSeek Harness exited ('+code+')'));pending.clear();terminal.close();process.exitCode=process.exitCode??(closing?0:code||1)})
async function drain(){
 if(!ready||busy||closing||!queue.length)return
 const text=queue.shift();busy=true
 try{const result=await call('session/prompt',{sessionId:session,prompt:[{type:'text',text}]});write('\n');if(result.stopReason==='cancelled')line('Interrupted');else if(result.stopReason==='refusal')line('The native engine declined this request')}
 catch(error){line(error.message)}finally{busy=false;permission=undefined;if(queue.length)void drain();else terminal.prompt()}
}
async function close(){if(closing)return;closing=true;queue.length=0;try{if(session)await call('session/close',{sessionId:session})}catch{}finally{child.stdin.end();child.kill('SIGTERM');terminal.close()}}
// A private input frame keeps pasted multiline tasks out of terminal command echo.
process.stdin.on('data',data=>{
 inputBuffer+=inputDecoder.write(data)
 for(;;){
  const start=inputBuffer.indexOf(frame)
  if(start<0){let keep=0;for(let length=1;length<=Math.min(frame.length,inputBuffer.length);length++)if(frame.startsWith(inputBuffer.slice(-length)))keep=length;keyboard.write(inputBuffer.slice(0,inputBuffer.length-keep));inputBuffer=keep?inputBuffer.slice(-keep):'';return}
  if(start){keyboard.write(inputBuffer.slice(0,start));inputBuffer=inputBuffer.slice(start)}
  const end=inputBuffer.indexOf('\x07',frame.length);if(end<0)return
  try{const text=JSON.parse(Buffer.from(inputBuffer.slice(frame.length,end),'base64').toString('utf8'));if(typeof text!=='string')throw Error('Invalid native task');line('› '+text);queue.push(text);if(busy)line('Queued · '+queue.length);void drain()}catch(error){line(error.message)}
  inputBuffer=inputBuffer.slice(end+1)
 }
})
process.stdin.on('end',()=>keyboard.end())
terminal.on('SIGINT',()=>{queue.length=0;if(busy)send({jsonrpc:'2.0',method:'session/cancel',params:{sessionId:session}});else void close()})
process.on('SIGTERM',()=>void close())
terminal.on('close',()=>{if(process.stdin.isTTY)process.stdin.setRawMode(false);if(!closing){closing=true;child.stdin.end();child.kill('SIGTERM')}})
terminal.on('line',async input=>{
 try{
  if(input===':allow'||input===':deny'){
   if(!permission){line('No permission request is waiting');terminal.prompt();return}
   const option=permission.params.options.find(option=>option.kind===(input===':allow'?'allow_once':'reject_once'))
   send({jsonrpc:'2.0',id:permission.id,result:{outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}}});permission=undefined;return
  }
  if(input===':exit'){await close();return}
  if(input===':help'){line(':models · :model provider/model · :effort off|low|high|max · :allow · :deny · :exit\nCtrl+C interrupts work. Native configuration and histories stay in DeepSeek Harness.');terminal.prompt();return}
  if(input===':models'){line(choices('model').map(option=>name(option.value)).join('\n'));terminal.prompt();return}
  if(input.startsWith(':model ')||input.startsWith(':effort ')){
   if(busy)throw Error('Wait for the current task before changing configuration')
   const model=input.startsWith(':model '),id=model?'model':'reasoning_effort',selected=input.slice(input.indexOf(' ')+1).trim(),matches=choices(id).filter(option=>model?name(option.value)===selected||JSON.parse(option.value)[1]===selected:option.value===selected||selected==='none'&&option.value==='off')
   if(matches.length!==1)throw Error('Choose an available native option; use :models to list models')
   configuration=(await call('session/set_config_option',{sessionId:session,configId:id,value:matches[0].value})).configOptions;line('Updated '+id);terminal.prompt();return
  }
  const text=input.startsWith(':prompt ')?JSON.parse(input.slice(8)):input
  if(typeof text!=='string'||!text.trim()){terminal.prompt();return}
  queue.push(text);if(busy)line('Queued · '+queue.length);void drain()
 }catch(error){line(error.message);terminal.prompt()}
})
;(async()=>{try{
 const protocol=await call('initialize',{protocolVersion:1,clientInfo:{name:'aexus-native-worker',version:'1'},clientCapabilities:{}})
 if(protocol.protocolVersion!==1)throw Error('Unsupported DeepSeek Harness ACP version')
 const result=await call('session/new',{cwd:process.cwd(),mcpServers:[]});session=result.sessionId;configuration=result.configOptions??[];ready=true
 line('\x1b[1mDeepSeek Harness\x1b[0m · native Coding Agent\n'+process.cwd()+'\nNative session '+session+' · :help for controls');terminal.prompt();void drain()
}catch(error){line(error.message);process.exitCode=1;await close()}})()
