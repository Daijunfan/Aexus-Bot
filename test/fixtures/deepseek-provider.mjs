import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
export async function deepseekProvider(){
 const requests=[],errors=[],state={employeeId:undefined}
 const text=content=>typeof content==='string'?content:(content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'deepseek-v4-flash',display_name:'DeepSeek Flash',type:'model',created_at:'2026-01-01T00:00:00Z'},{id:'deepseek-v4-pro',display_name:'DeepSeek Pro',type:'model',created_at:'2026-01-01T00:00:00Z'}]}));return}
   let raw='';for await(const chunk of req)raw+=chunk
   const body=JSON.parse(raw),messages=body.messages??[],last=messages.findLastIndex(message=>message.role==='user'&&text(message.content)),prompt=text(messages[last]?.content),scenario=prompt.includes('[Aexus initialization]')?'INIT':[...prompt.matchAll(/CASE_[A-Z_]+/g)].at(-1)?.[0]??'PROBE',tools=body.tools??[],called=messages.slice(last+1).flatMap(message=>(message.content??[])).filter(block=>block.type==='tool_use')
   requests.push({scenario,model:body.model,body,url:req.url});if(requests.length===1){fs.mkdirSync('artifacts/deepseek/native',{recursive:true});fs.writeFileSync('artifacts/deepseek/native/tool-schema.json',JSON.stringify(tools,null,2))}let content=[{type:'text',text:scenario==='INIT'||scenario==='PROBE'?'OK':'NATIVE_OK '+scenario}]
   const tool=fragment=>tools.find(tool=>tool.name?.includes(fragment))?.name
   if(scenario==='INIT'){
    const name=tool('agents_company_documentation'),operations=called.filter(call=>call.name===name).map(call=>call.input?.operation),operation=!operations.includes('identity')?'identity':!operations.includes('index')?'index':undefined
    if(operation){if(!name)throw Error('Native DeepSeek did not expose the documentation MCP tool');content=[{type:'tool_use',id:'call_'+requests.length,name,input:{operation}}]}
   }else if(scenario==='CASE_API'&&!called.length){const name=tool('agents_company_api');if(!name)throw Error('Native DeepSeek did not expose the API MCP tool');content=[{type:'tool_use',id:'call_'+requests.length,name,input:{command:'plan.query',args:{}}}]}
   else if(scenario==='CASE_DIRECT'&&!called.length){content=[{type:'tool_use',id:'call_'+requests.length,name:tool('agents_company_api'),input:{command:'direct.post',args:{text:'NATIVE_DEEPSEEK_PUBLICATION',clientMessageId:'deepseek-direct-publication'}}}]}
   else if((scenario==='CASE_CORE_ALLOW'||scenario==='CASE_CORE_DENY')&&!called.length){content=[{type:'tool_use',id:'call_'+requests.length,name:tool('agents_company_api'),input:{command:'workspace.write',args:{employee:state.employeeId,path:scenario+'.txt',content:'APPROVED_NATIVE_CORE_WRITE'}}}]}
   else if((scenario==='CASE_NATIVE_WRITE_ALLOW'||scenario==='CASE_NATIVE_WRITE_DENY'||scenario==='CASE_NATIVE_ESCALATE_ALLOW'||scenario==='CASE_NATIVE_ESCALATE_DENY')&&called.length<(scenario.includes('ESCALATE')?2:1)){
    const selected=tools.find(tool=>tool.name==='write_file'||tool.name==='write'||tool.name==='fs_write')
    if(!selected)throw Error('Inspect the advertised native file-writing schema')
    const properties=selected.input_schema?.properties??{},required=selected.input_schema?.required??[],input={}
    for(const key of Object.keys(properties)){if(/path|file/i.test(key))input[key]=path.join(prompt.match(/WORKSPACE=(.+)/)?.[1]?.trim()??process.cwd(),scenario+'.txt');else if(/content|text/i.test(key))input[key]='NATIVE_FILE_WRITE';else if(required.includes(key))throw Error('Inspect native write field: '+key)}
    if(scenario.includes('ESCALATE')&&called.length){input.sandbox_permissions='workspace-write';input.justification='Disposable native approval verification'}
    content=[{type:'tool_use',id:'call_'+requests.length,name:selected.name,input}]
   }
   else if(scenario==='CASE_CANCEL')await new Promise(resolve=>{const timer=setTimeout(resolve,20000);res.once('close',()=>{clearTimeout(timer);resolve()})})
   if(res.destroyed)return
   const message={id:'fixture-'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}},stop=content.some(block=>block.type==='tool_use')?'tool_use':'end_turn'
   if(!body.stream){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({...message,content,stop_reason:stop}));return}
   res.writeHead(200,{'content-type':'text/event-stream'})
   const events=[{type:'message_start',message}]
   content.forEach((block,index)=>events.push({type:'content_block_start',index,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}},{type:'content_block_stop',index}))
   events.push({type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'});for(const event of events)res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end()
  }catch(error){errors.push(error.message);res.writeHead(500).end(error.message)}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {server,requests,errors,state,endpoint:'http://127.0.0.1:'+server.address().port,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
}
