#!/usr/bin/env node
// Native protocol fixture only. Shared receipts use real registered tool calls, never parsed assistant output.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),rl=require('node:readline').createInterface({input:process.stdin})
const control=process.env.AC_INIT_FIXTURE;if(!control)throw Error('AC_INIT_FIXTURE is required')
const employee=process.env.AGENTS_COMPANY_EMPLOYEE||(process.env.AC_NATIVE_WORKER_FIXTURE?path.basename(process.cwd()):'catalog'),send=value=>process.stdout.write(JSON.stringify(value)+'\n')
const event=(method,params)=>send({method,params})
let thread='',cwd=process.cwd(),turn='',timer,generation=0,environments=[],discussionUrl,enabledTools=[],boardApproval
const note=(suffix,value)=>{const file=path.join(control,employee+'-'+suffix+'.json'),temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,file)}
async function nativeTool(name,input,callId='fixture-tool-'+crypto.randomUUID()){
 if(!discussionUrl||!enabledTools.includes(name))throw Error('Fixture received no enabled native '+name)
 const mcp=async(method,params,id)=>{const response=await fetch(discussionUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});if(!response.ok)throw Error('Company MCP transport failed: '+response.status);return response.json()}
 const list=await mcp('tools/list',{},callId+'-list');if(!list.result?.tools?.some(tool=>tool.name===name))throw Error('Tool was not exposed by native MCP: '+name)
 event('item/started',{threadId:thread,turnId:turn,item:{id:callId,type:'mcpToolCall',tool:name,arguments:input}})
 const result=await mcp('tools/call',{name,arguments:input},callId)
 event('item/completed',{threadId:thread,turnId:turn,item:{id:callId,type:'mcpToolCall',tool:name,result,status:result.error||result.result?.isError?'failed':'completed'}})
 return result
}
async function initialize(active){
 const file=suffix=>path.join(control,employee+suffix)
 while(active===generation&&!fs.existsSync(file('.release'))&&!fs.existsSync(path.join(control,'release-all')))await new Promise(resolve=>setTimeout(resolve,20))
 if(active!==generation)return
 const operations=fs.existsSync(file('.init-skip-docs'))?[]:fs.existsSync(file('.init-identity-only'))?['identity']:['identity','index',...(fs.existsSync(file('.init-full-doc'))?['document']:[])],results={}
 for(const operation of operations){const reply=await nativeTool('agents_company_documentation',{operation,...(operation==='document'?{document:'core/api'}:{})});if(reply.error||reply.result?.isError)throw Error(reply.error?.message??reply.result.content?.[0]?.text??'Documentation tool failed');results[operation]=JSON.parse(reply.result.content.find(item=>item.type==='text').text)}
 note('read',{operations,identity:results.identity,index:results.index,bytes:operations.map(operation=>JSON.stringify(results[operation]).length)})
}
async function readWorkDocument(text){
 const post=workPostArgs(text,control,employee);if(post){const result=await nativeTool('agents_company_discussion_post',post);note('work-publication',{input:post,result});if(result.error||result.result?.isError)throw Error(result.error?.message??result.result?.content?.[0]?.text??'Publication failed')}
 const file=path.join(control,employee+'.work-document.json');if(!fs.existsSync(file))return
 const input=JSON.parse(fs.readFileSync(file,'utf8')),result=await nativeTool('agents_company_documentation',input)
 if(result.error||result.result?.isError)throw Error(result.error?.message??result.result?.content?.[0]?.text??'Documentation tool failed')
 note('work-document',{input,document:JSON.parse(result.result.content.find(item=>item.type==='text').text)})
}
async function acknowledgmentText(text,active){
 const file=suffix=>path.join(control,employee+suffix),policy=JSON.parse(text.split('\n')[1])
 const toolFile=file('.ack-tool.json'),outputFile=file('.ack-output.txt'),explicit=fs.existsSync(toolFile),hasOutput=fs.existsSync(outputFile)
 if(fs.existsSync(file('.ack-preface.txt')))event('item/agentMessage/delta',{threadId:thread,turnId:turn,itemId:'ack-preface',delta:fs.readFileSync(file('.ack-preface.txt'),'utf8')})
 // A fixture scenario chooses an actual tool request. Final response text is never parsed into a call.
 while(active===generation&&fs.existsSync(file('.hold-ack')))await new Promise(resolve=>setTimeout(resolve,20))
 if(active!==generation)return ''
 if(explicit){
  const input={conversationType:policy.conversationType,conversationId:policy.conversationId,messageId:policy.messageId,text:null,...(explicit?JSON.parse(fs.readFileSync(toolFile,'utf8')):{})},callId='fixture-discussion-'+crypto.randomUUID()
  const result=await nativeTool('agents_company_discussion_post',input,callId);note('discussion-tool',{input,result,callId,at:Date.now()})
 }
 if(fs.existsSync(file('.ack-thinking.txt')))event('item/completed',{threadId:thread,turnId:turn,item:{id:'ack-reasoning',type:'reasoning',summary:[fs.readFileSync(file('.ack-thinking.txt'),'utf8')],content:[]}})
 return hasOutput?fs.readFileSync(outputFile,'utf8'):'Fixture acknowledgment stage complete.'
}
rl.on('line',line=>{
  const request=JSON.parse(line),p=request.params||{},result=value=>send({id:request.id,result:value})
  if(process.env.AC_WORKER_PARITY)fs.appendFileSync(path.join(control,employee+'-protocol.jsonl'),JSON.stringify(request)+'\n')
  if(request.id===undefined)return
  if(!request.method){if(request.id==='board-approval'){note('board-approval',request.result);boardApproval?.();boardApproval=undefined}return}
  switch(request.method){
    case 'initialize':if(process.env.AC_NATIVE_WORKER_FIXTURE){note('process',{pid:process.pid,controllerEnvironment:Object.keys(process.env).filter(key=>/^(AGENTS_|AEXUS_)/.test(key))});if(fs.existsSync(path.join(control,employee+'.hold-initialize')))return}return result({userAgent:'initialization-fixture'})
    case 'config/read':return result({config:process.env.AC_WORKER_PARITY?{model:'gpt-6-luna',model_reasoning_effort:'low',sandbox_mode:'read-only',approval_policy:'on-request',api_key:'fixture-secret-must-be-redacted'}:{}})
    case 'skills/list':return result({data:[{skills:[{name:'fixture-skill',description:'Inspect local changes',enabled:true},{name:'disabled',enabled:false}]}]})
    case 'mcpServerStatus/list':return result({data:[{name:'fixture-mcp',status:'connected',tools:{inspect:{description:'Fixture inspection'}}}]})
    case 'account/read':return result({account:{type:'apiKey',apiKey:'fixture-account-secret'},requiresOpenaiAuth:false})
    case 'account/rateLimits/read':return result({rateLimits:{primary:{usedPercent:12}}})
    case 'thread/name/set':note('thread-name',{threadId:p.threadId,name:p.name});return result({})
    case 'thread/compact/start':result({});setTimeout(()=>event('thread/compacted',{threadId:thread}),10);return
    case 'review/start':result({turn:{id:crypto.randomUUID(),status:'inProgress'}});setTimeout(()=>event('turn/completed',{threadId:thread,turn:{id:turn,status:'completed'}}),20);return
    case 'model/list':return result({data:[{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Fixture',isDefault:true,...(process.env.AC_WORKER_PARITY?{serviceTiers:[{id:'fast',name:'Fast'}],inputModalities:['text','image']}:{}),supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'},{id:'fixture-alt',model:'fixture-alt',displayName:'Fixture alternate'}],nextCursor:null})
    case 'thread/fork':return result({thread:{id:crypto.randomUUID(),turns:[]}})
    case 'thread/start':case 'thread/resume':thread=p.threadId||crypto.randomUUID();cwd=p.cwd||cwd;discussionUrl=p.config?.['mcp_servers.agents_company']?.url;enabledTools=p.config?.['mcp_servers.agents_company']?.enabled_tools??[];environments=p.environments??[{environmentId:'local',cwd,runtimeWorkspaceRoots:[cwd]}];note('thread-start',{resumed:request.method==='thread/resume',readingTools:enabledTools.includes('agents_company_discussion_post'),documentationTools:enabledTools.includes('agents_company_documentation'),disabledNativeAgents:p.config?.['features.multi_agent']===false,developerInstructions:p.developerInstructions??null,permissions:p.permissions??null,sandbox:p.sandbox??null});return result({thread:{id:thread,turns:[]}})
    case 'thread/backgroundTerminals/list':return result({data:[],nextCursor:null})
    case 'thread/unsubscribe':note('thread-unsubscribe',{threadId:p.threadId});return result({})
    case 'thread/read':if(thread&&p.threadId===thread&&p.includeTurns===false)return result({thread:{id:thread,cwd,environments,turns:[]}});return send({id:request.id,error:{code:-32000,message:'thread not found'}})
    case 'turn/steer':note('steer',{thread,turn,input:p.input});return result({turnId:turn})
    case 'turn/start':{
      turn=crypto.randomUUID();if(p.environments!==undefined)environments=p.environments
      const active=++generation,text=(p.input||[]).map(x=>x.text||'').join(''),hidden=text.includes('[Agents Company private initialization]'),ack=/^\[Agents Company (group|channel) acknowledgment\]\n/.test(text)
      if(!hidden&&!ack&&process.env.AC_NATIVE_WORKER_FIXTURE&&fs.existsSync(path.join(control,employee+'.spawn-tools'))&&!fs.existsSync(path.join(control,employee+'-tools.json'))){
       const {spawn}=require('node:child_process'),file=path.join(control,employee+'-tools.json'),ready=file+'.grandchild-ready'
       const grandchild="const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)"
       const script="const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"+JSON.stringify(grandchild)+",process.argv[2]],{stdio:['ignore','inherit','inherit'],detached:true});fs.writeFileSync(process.argv[1],JSON.stringify({parent:"+process.pid+",child:process.pid,grandchild:child.pid}));setInterval(()=>{},1000)"
       spawn(process.execPath,['-e',script,file,ready],{stdio:['ignore','inherit','inherit'],detached:true})
      }
      const input={thread,turn,text,cwd,model:p.model,...(process.env.AC_WORKER_PARITY?{nativeInput:p.input,serviceTier:p.serviceTier,collaborationMode:p.collaborationMode}:{}),environments,explicitEnvironments:p.environments!==undefined,readingTools:enabledTools.includes('agents_company_discussion_post'),documentationTools:enabledTools.includes('agents_company_documentation'),at:Date.now()}
      if(!hidden&&!ack&&process.env.AC_NATIVE_WORKER_FIXTURE)fs.appendFileSync(path.join(control,employee+'-native-turns.jsonl'),JSON.stringify({pid:process.pid,...input})+'\n')
      if(ack)note('ack',input)
      else{note(hidden?'initializing':'user',hidden?input:{thread,turn,text,cwd,model:p.model});if(!hidden)note('work',input)}
      result({turn:{id:turn,status:'inProgress'}});event('turn/started',{threadId:thread,turn:{id:turn}})
      let streamed='',ackText=''
      const complete=()=>{
        if(hidden&&!fs.existsSync(path.join(control,employee+'.release'))&&!fs.existsSync(path.join(control,'release-all')))return
        if(ack&&fs.existsSync(path.join(control,employee+'.hold-ack')))return
        const streamFile=path.join(control,employee+'.stream.txt')
        if(!hidden&&!ack&&fs.existsSync(streamFile)){
          const text=fs.readFileSync(streamFile,'utf8')
          if(text.length>streamed.length){event('item/agentMessage/delta',{threadId:thread,turnId:turn,itemId:'answer',delta:text.slice(streamed.length)});streamed=text}
        }
        if(!hidden&&!ack&&fs.existsSync(path.join(control,employee+'.hold-user')))return
        const holdText=path.join(control,employee+'.hold-text');if(!hidden&&!ack&&fs.existsSync(holdText)&&text.includes(fs.readFileSync(holdText,'utf8')))return
        clearInterval(timer)
        if(ack)note('ack',{...input,response:ackText,finishedAt:Date.now()})
        const failure=hidden&&fs.existsSync(path.join(control,employee+'.fail'))||ack&&fs.existsSync(path.join(control,employee+'.ack-fail'))
        if(failure){if(ack)event('item/completed',{threadId:thread,turnId:turn,item:{id:'answer',type:'agentMessage',text:ackText}});event('turn/completed',{threadId:thread,turn:{id:turn,status:'failed',error:{message:ack?'fixture acknowledgment failure':'fixture initialization failure'}}});return}
        if(hidden){
          event('item/completed',{threadId:thread,turnId:turn,item:{id:'reading-commentary',type:'agentMessage',text:'PRIVATE_INIT_READING_COMMENTARY'}})
        }
        event('item/completed',{threadId:thread,turnId:turn,item:{id:'answer',type:'agentMessage',text:ack?ackText:hidden?(fs.existsSync(path.join(control,employee+'.bad-ok'))?'NOT_READY':'OK'):(fs.existsSync(path.join(control,employee+'.reply.txt'))?fs.readFileSync(path.join(control,employee+'.reply.txt'),'utf8'):'VISIBLE_REPLY')}})
        event('turn/completed',{threadId:thread,turn:{id:turn,status:'completed'}})
      }
      void (ack?acknowledgmentText(text,active).then(value=>{ackText=value}):hidden?initialize(active):readWorkDocument(text)).then(async()=>{
        if(!hidden&&!ack&&fs.existsSync(path.join(control,employee+'.board-approval')))await new Promise(resolve=>{boardApproval=resolve;send({id:'board-approval',method:'tool/requestUserInput',params:{threadId:thread,turnId:turn,questions:[{id:'choice',header:'Design review',question:'Approve the Board design?',options:[{label:'Continue',description:'Proceed with the implementation'},{label:'Revise',description:'Rework the design'}]}]}})})
        if(active===generation)timer=setInterval(complete,50)
      },error=>{if(active===generation)event('turn/completed',{threadId:thread,turn:{id:turn,status:'failed',error:{message:(ack?'Fixture acknowledgment failed: ':'Fixture initialization failed: ')+error.message}}})});return
    }
    case 'turn/interrupt':generation++;clearInterval(timer);result({});return event('turn/completed',{threadId:thread,turn:{id:turn,status:'interrupted'}})
    default:return result({})
  }
})
process.on('SIGTERM',()=>{clearInterval(timer);process.exit(0)});rl.on('close',()=>process.exit(0))

function workPostArgs(text,control,employee){
 const file=path.join(control,employee+'.work-post.json');if(!fs.existsSync(file))return
 const marker=text.includes('[Group request]\n')?'[Group request]\n':text.includes('[Channel context]\n')?'[Channel context]\n':undefined
 if(!marker)return
 const context=JSON.parse(text.split(marker)[1].split('\n')[0])
 return {conversationType:context.conversationType,conversationId:context.conversationId,messageId:context.messageId??context.entryId,...JSON.parse(fs.readFileSync(file,'utf8'))}
}
