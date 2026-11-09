import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {homedir,tmpdir} from 'node:os'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import {APP_HOME} from '../../shared/protocol'
import {atomicJson,readJson} from '../atomic-file'
import {documentationIdentity} from '../documentation-tool'
import {withCaller} from '../authorization'
import {directDelivery,postDirectMessage} from '../direct-messages'
import {invokeApiTool} from '../api-tool'
import {engineExecutable} from './executable'
import {publishEvent} from '../server'
import {engineState} from './state'
import type {EngineStart} from './contract'

type Binding={url?:string;key?:string;answerId?:string}
type CompletedTurn={ok:true;text:string}&Required<Binding>
type PendingTurn={messageId:string;text:string;binding:Binding;format?:'markdown';phase?:'prepared'|'attempting';completed?:CompletedTurn}
type BrowserResult=CompletedTurn|{ok:true;unsent:true}|{ok:false;submitted:boolean;message:string}
type BrowserMode='send'|'check'|'unsent'

// The browser sees only the operator's message and the dedicated chat binding.
const browserProgram=String.raw`
const home='https://chatgpt.com/';
const conversation=url=>/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{36}\/?$/i.test(url);
const composer='main textarea[placeholder], [contenteditable="true"][aria-label="询问 ChatGPT"], #prompt-textarea';
const submit='button[aria-label="发送"], button[data-testid="send-button"]';
const CSSKey=key=>{if(!/^[a-zA-Z0-9_-]+$/.test(key))throw Error('turn changed');return key;};
const visibleText=text=>text?.replace(/\s+/g,' ').trim();
let submitted=false;
try{
 const fs=await import('node:fs/promises');
 const task=await taskSpace(input.space);
 const pages=await task.pages();
 const pinned=input.binding.url||home;
 if(pinned!==home&&!conversation(pinned))throw Error('Open the dedicated ChatGPT browser tab and restore its original chat.');
 let page=pages.find(p=>p.label==='p1');
 // After the managed tab is closed, Ego may assign its replacement a new label.
 if(!page&&pages.length===1)page=pages[0];
 if(!page&&pages.length===0)page=await task.newPage();
 if(!page)throw Error('Open the dedicated ChatGPT browser tab and restore its original chat.');
 if(['about:blank','chrome://new-tab-page/','chrome://newtab/'].includes(await page.url()))await page.goto(pinned);
 if(await page.url()!==pinned&&!(input.mode==='check'&&!input.binding.url&&conversation(await page.url())))throw Error('Open the dedicated ChatGPT browser tab and restore its original chat.');
 await page.snapshot();
 const observe=()=>page.evaluate(()=>{
   const visible=e=>!!e.getClientRects().length;
   const nodes=[...document.querySelectorAll('[data-turn-key]')];
   const last=nodes.at(-1);
   const user=last?.querySelector('[data-user-message-bubble]');
   const buttons=[...user?.querySelectorAll('button')??[]];
   const expand=buttons.length===1&&/^(显示更多|Show more)$/i.test(buttons[0].innerText.trim())&&visible(buttons[0])?buttons[0]:undefined;
   const collapse=[...user?.querySelectorAll('button')??[]].find(b=>/^(显示更少|收起|Show less)$/i.test(b.innerText.trim())&&visible(b));
   const userText=collapse&&user.innerText.trimEnd().endsWith(collapse.innerText.trim())?user.innerText.trimEnd().slice(0,-collapse.innerText.trim().length):user?.innerText;
   const previous=nodes.at(-2);
   const answer=last?.querySelector('[data-chatgpt-selection-message-id]');
   // Copy the rendered structure as Markdown, without forwarding webpage HTML.
   const escape=text=>text.replace(/[\\\x60*_~\[\]<>#]/g,'\\$&');
   const fence=(text,char)=>char.repeat(Math.max(3,...(text.match(new RegExp(char+'+', 'g'))??[]).map(run=>run.length+1)));
   const markdown=node=>{
     if(node.nodeType===3)return escape(node.textContent??'');
     if(node.nodeType!==1||node.matches('button,svg,script,style,[hidden],[aria-hidden="true"]'))return '';
     const children=()=>[...node.childNodes].map(markdown).join('');
     const block=text=>'\n\n'+text.trim()+'\n\n';
     const tag=node.tagName;
     if(/^H[1-6]$/.test(tag))return block('#'.repeat(Number(tag[1]))+' '+children().trim());
     if(tag==='P')return block(children());
     if(tag==='BR')return '  \n';
     if(tag==='HR')return block('---');
     const strong=tag==='STRONG'||tag==='B'||node.hasAttribute('data-d-default-strong');
     if(strong||tag==='EM'||tag==='I'||tag==='DEL'){
       const marker=tag==='DEL'?'~~':strong?'**':'*';
       const value=children().trim();
       return value?marker+value+marker:'';
     }
     if(tag==='PRE'){
       const code=node.querySelector('code')??node;
       const body=code.textContent??'';
       const language=[...code.classList].find(name=>/^language-[\w+#-]+$/.test(name))?.slice(9)??'';
       const ticks=fence(body,String.fromCharCode(96));
       return block(ticks+language+'\n'+body.replace(/\n$/,'')+'\n'+ticks);
     }
     if(tag==='CODE'){
       const body=node.textContent??'';
       const tick=String.fromCharCode(96);
       const delimiter=body.includes(tick)?fence(body,tick):tick;
       const pad=body.startsWith(tick)||body.endsWith(tick)||/^\s|\s$/.test(body)?' ':'';
       return delimiter+pad+body+pad+delimiter;
     }
     if(tag==='A'){
       const url=node.getAttribute('href')??'';
       const label=children().trim();
       return label&&/^https?:\/\/[^\s<>]+$/i.test(url)?'['+label+'](<'+url+'>)':label;
     }
     if(tag==='UL'||tag==='OL'){
       const start=tag==='OL'?Number(node.getAttribute('start')??1):1;
       const items=[...node.children].filter(item=>item.tagName==='LI').map((item,index)=>{
         const prefix=tag==='OL'?(start+index)+'. ':'- ';
         return prefix+markdown(item).trim().replace(/\n(?=.)/g,'\n'+' '.repeat(prefix.length));
       });
       return block(items.join('\n'));
     }
     if(tag==='BLOCKQUOTE')return block(children().trim().split('\n').map(line=>'> '+line).join('\n'));
     if(tag==='TABLE'){
       const rows=[...node.rows].map(row=>[...row.cells].map(cell=>markdown(cell).trim().replace(/\s*\n+\s*/g,' ').replace(/\|/g,'\\|')));
       if(!rows[0]?.length||rows.some(row=>row.length!==rows[0].length))return block(node.innerText);
       const line=row=>'| '+row.join(' | ')+' |';
       return block([line(rows[0]),line(rows[0].map(()=> '---')),...rows.slice(1).map(line)].join('\n'));
     }
     return children();
   };
   const format=root=>{
     const parts=[...root?.querySelectorAll('[data-markdown-text-style]')??[]].filter(visible);
     return parts.map(part=>markdown(part).trim()).filter(Boolean).join('\n\n')||root?.innerText;
   };
   // The final message ID only appears when generation completes.
   const streaming=[...last?.querySelectorAll('[data-talvt-turn-state] [data-markdown-animated]:not([data-markdown-text-tone])')??[]]
     .filter(visible).filter(node=>node.querySelector('[data-dil-response][data-dil-message-id]'))
     .map(node=>markdown(node).trim()).filter(Boolean).join('\n\n');
   const editors=[...document.querySelectorAll('main textarea[placeholder], [contenteditable="true"][aria-label="询问 ChatGPT"], #prompt-textarea')].filter(visible);
   const editor=editors.length===1?editors[0]:null;
   const draft=editor?.value??(editor?.children.length&&[...editor.children].every(node=>node.tagName==='P')
     ?[...editor.children].map(node=>node.textContent).join('\n')
     :editor?.innerText);
   return {url:location.href,key:last?.getAttribute('data-turn-key'),user:userText,expand:expand?.innerText.trim(),
     previousKey:previous?.getAttribute('data-turn-key'),previousAnswer:previous?.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id'),turnCount:nodes.length,
     state:last?.querySelector('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state'),
     answerId:answer?.getAttribute('data-chatgpt-selection-message-id'),answer:answer?.innerText,formatted:format(answer),
     stop:[...document.querySelectorAll('button[aria-label="停止"],button[data-testid="stop-button"]')].some(visible),
     waiting:[...document.querySelectorAll('[role="region"] [role="alert"], [role="dialog"]')].some(visible),
     signedIn:!!document.querySelector('button[aria-label="打开个人资料菜单"],button[aria-label="Open profile menu"]'),
     draft:draft??null,streaming};
 });
 let baseline=await observe();
 if(input.mode!=='check'){
   const readyBy=Date.now()+8000;
   while(Date.now()<readyBy&&(!baseline.signedIn||baseline.draft===null||input.binding.key&&!baseline.key)){
     if(baseline.url!==pinned||baseline.waiting)break;
     await new Promise(resolve=>setTimeout(resolve,250));
     baseline=await observe();
   }
 }
 if(input.mode==='check'){
   submitted=true;
 }else{
   const matchesBinding=state=>state.url===pinned&&state.signedIn&&!state.stop&&!state.waiting&&state.draft!==null&&state.key===input.binding.key&&state.answerId===input.binding.answerId;
   if(!matchesBinding(baseline))
     throw Error('ChatGPT is unavailable, signed out, or the dedicated chat was changed in the browser.');

   // A prepared journal proves the bridge never reached the send attempt.
   // Only clear an exact draft on the original chat and turn.
   const abandoned=input.mode==='unsent'?input.text:input.prepared?.text;
   if(abandoned!==undefined&&baseline.draft.trim()===abandoned.trim()){
     await page.fill(composer,'');
     baseline=await observe();
   }
   if(!matchesBinding(baseline)||baseline.draft.trim()!=='')
     throw Error('ChatGPT has an unsent draft. Clear it in the dedicated browser tab before sending again.');
   if(input.mode==='unsent'){
     console.log('AEXUS_CHATGPT_RESULT '+JSON.stringify({ok:true,unsent:true}));
   }else{
     if(input.prepared)await fs.unlink(input.pending);
     const journal={messageId:input.messageId,text:input.text,binding:input.binding,format:input.format};
     await fs.writeFile(input.staged,JSON.stringify({...journal,phase:'prepared'}),{flag:'wx',mode:0o600});
     await fs.link(input.staged,input.pending);
     await page.fill(composer,input.text);
     const filled=await observe();
     if(!matchesBinding(filled)||filled.draft.trim()!==input.text.trim()||await page.url()!==pinned)
       throw Error('ChatGPT composer changed before submission.');

     // Persist uncertainty before calling Send. A crash from here on requires
     // observation or explicit operator resolution, never another click.
     await fs.writeFile(input.staged+'.attempt',JSON.stringify({...journal,phase:'attempting'}),{flag:'wx',mode:0o600});
     await fs.rename(input.staged+'.attempt',input.pending);
     submitted=true;
     try{await page.click(submit,{label:'Send to dedicated ChatGPT chat'})}catch{}
   }
 }
 if(input.mode!=='unsent'){
   const anchor=input.mode==='check'?input.binding:baseline;
   let turn,observedUrl=input.binding.url,complete=false,lastProgress='';
   const deadline=Date.now()+(input.mode==='check'?20000:170000);
   for(let i=0;Date.now()<deadline;i++){
     if(i)await new Promise(resolve=>setTimeout(resolve,200));
     let current;
     try{current=await observe()}catch{continue}
     if(new URL(current.url).origin!=='https://chatgpt.com')throw Error('browser origin changed');
     if(observedUrl&&current.url!==observedUrl)throw Error('conversation changed');
     if(conversation(current.url))observedUrl=current.url;
     if(!observedUrl)continue;
     if(current.waiting)throw Error('browser confirmation required');
     if(current.key&&current.key!==anchor.key){
       if(!current.signedIn||(anchor.key
         ? current.previousKey!==anchor.key||current.previousAnswer!==anchor.answerId
         : current.turnCount!==1))throw Error('turn changed');
       if(current.expand){
         await page.click('css=[data-turn-key="'+CSSKey(current.key)+'"] [data-user-message-bubble] button');
         continue;
       }
       if(!current.user?.trim())continue;
       if(visibleText(current.user)!==visibleText(input.text)||turn&&turn!==current.key)throw Error('turn changed');
       turn=current.key;
       if(current.state==='cancelled')throw Error('browser turn cancelled');
       const partial=(current.formatted||current.answer||(current.stop||current.state==='in_progress'?current.streaming:''))?.trim();
       if(input.mode==='send'&&partial&&partial!==lastProgress){
         lastProgress=partial;
         // ego-browser buffers console output until exit. Publish snapshots atomically.
         await fs.writeFile(input.dir+'/next',partial,{mode:0o600});
         await fs.rename(input.dir+'/next',input.dir+'/progress');
       }
       if(conversation(current.url)&&current.state==='complete'&&!current.stop&&current.answerId&&current.answerId!==anchor.answerId&&current.answer?.trim()){
         console.log('AEXUS_CHATGPT_RESULT '+JSON.stringify({ok:true,text:(input.format==='markdown'&&current.formatted?.trim()||current.answer.trim()),url:current.url,key:turn,answerId:current.answerId}));
         complete=true;
         break;
       }
     }
   }
   if(!complete)throw Error('browser deadline');
 }
}catch(error){
 console.log('AEXUS_CHATGPT_RESULT '+JSON.stringify({ok:false,submitted,message:submitted?'ChatGPT delivery is uncertain. Inspect the dedicated browser chat before retrying. ('+(['browser origin changed','conversation changed','turn changed','browser confirmation required','browser turn cancelled','browser deadline'].includes(error?.message)?error.message:'browser control interrupted')+')':(['ChatGPT composer changed before submission.','Open the dedicated ChatGPT browser tab and restore its original chat.','ChatGPT has an unsent draft. Clear it in the dedicated browser tab before sending again.'].includes(error?.message)?error.message:'Could not prepare the dedicated ChatGPT tab. Check Ego Browser and sign in to ChatGPT.')}));
}
`

const runFile=promisify(execFile)
async function wakeEgo(signal:AbortSignal){
  if(process.platform==='darwin'){
    const running=await runFile('/usr/bin/pgrep',['-x','ego lite'],{signal,timeout:1500}).then(()=>true,()=>false)
    signal.throwIfAborted()
    if(running)return
    try{await runFile('/usr/bin/open',['-g','-a','ego lite'],{signal,timeout:8000})}
    catch{signal.throwIfAborted();throw Error('Could not start Ego Lite. Check that the browser is installed.')}
  }
}

async function browserTurn(space:string,turn:PendingTurn,pending:string,signal:AbortSignal,mode:BrowserMode,onProgress?:(text:string)=>void,prepared?:PendingTurn):Promise<BrowserResult>{
  const dir=fs.mkdtempSync(path.join(tmpdir(),'aexus-chatgpt-'))
  const staged=pending+'.'+path.basename(dir)+'.arming'
  try{
    // A short startup race is safe to retry only before the browser attempted Send.
    for(let attempt=0;;attempt++){
      signal.throwIfAborted()
      const result=await new Promise<BrowserResult|null>(resolve=>{
        const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LC_[A-Z_]+|XDG_[A-Z_]+)$/.test(key)))
        const child=spawn(engineExecutable('chatgpt'),['nodejs'],{cwd:homedir(),env,stdio:['pipe','pipe','pipe'],signal})
        let output='',last=''
        const progressFile=path.join(dir,'progress')
        let lastModified=0
        const poll=()=>{
          if(!onProgress||signal.aborted)return
          try{
            const {mtimeMs}=fs.statSync(progressFile)
            if(mtimeMs===lastModified)return
            lastModified=mtimeMs
            const value=fs.readFileSync(progressFile,'utf8')
            if(value&&value!==last){last=value;onProgress(value)}
          }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('[ChatGPT progress read failed]')}
        }
        const interval=setInterval(poll,100)
        const timer=setTimeout(()=>child.kill('SIGKILL'),185000)
        child.stdout.resume()
        child.stderr.setEncoding('utf8').on('data',chunk=>{output=(output+chunk).slice(-512000)})
        child.stdin.on('error',()=>{})
        child.once('error',()=>{}) // close also fires after a spawn error or abort
        child.once('close',code=>{
          clearInterval(interval)
          clearTimeout(timer)
          poll()
          const prefix='AEXUS_CHATGPT_RESULT '
          const line=output.split('\n').reverse().find(value=>value.startsWith(prefix))
          try{resolve(code===0&&line?JSON.parse(line.slice(prefix.length)):null)}catch{resolve(null)}
        })
        child.stdin.end('const input='+JSON.stringify({space,...turn,pending,staged,mode,dir,prepared})+';\n'+browserProgram)
      })
      if(result)return result
      if(mode==='send'&&fs.existsSync(pending)){
        const record=readJson<PendingTurn>(pending,()=>turn)
        const submitted=record.phase!=='prepared'
        return {ok:false,submitted,message:submitted?'ChatGPT delivery is uncertain. Inspect the dedicated browser chat before continuing.':'Ego Lite stopped before sending this message.'}
      }
      signal.throwIfAborted()
      if(attempt>=5)return {ok:false,submitted:mode==='check',message:'Could not connect to Ego Lite. Check that the browser has started.'}
      fs.rmSync(staged,{force:true})
      await delay(500,{signal})
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(staged,{force:true});fs.rmSync(staged+'.attempt',{force:true})}
}

export async function openChatGPT(context:EngineStart){
  const {card,cardId,sessionId,cwd,host}=context
  if(!card||card.accessMode==='isolated'||context.remote||context.nativeRemote||context.workRoot||context.kind!=='worker'||(card.managementRole??'employee')!=='employee')
    throw Error('ChatGPT supports local Build Team employees only')
  const state=engineState(context)
  const space='Aexus ChatGPT '+createHash('sha256').update(APP_HOME+'\0'+cardId).digest('hex').slice(0,16)
  const file=path.join(APP_HOME,'chatgpt',cardId+'.json')
  const pending=file+'.pending'
  const readPending=()=>readJson<PendingTurn|null>(pending,()=>null)
  const setRecovery=(messageId?:string)=>{
    state.chatGPTRecovery=messageId
    host.rememberMeta(sessionId,{chatGPTRecovery:messageId})
  }
  const saveReply=async(turn:PendingTurn,result:CompletedTurn,publish:()=>Promise<unknown>)=>{
    if(!/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{36}\/?$/i.test(result.url)||turn.binding.url&&turn.binding.url!==result.url||!result.key||!result.answerId||!result.text)
      throw Error('ChatGPT reply could not be tied to this employee chat')
    if(!turn.completed)atomicJson(pending,{...turn,completed:result})
    await publish()
    atomicJson(file,{url:result.url,key:result.key,answerId:result.answerId})
    fs.rmSync(pending)
  }
  const replyArgs=(turn:PendingTurn,result:CompletedTurn)=>({
    text:result.text,replyTo:turn.messageId,clientMessageId:'chatgpt:'+turn.messageId
  })
  const unsupported=async()=>{throw Error('This ChatGPT employee uses the settings and controls in its dedicated browser chat')}
  state.driver={
    send(text,images,taskId){
      const messageId=state.currentTask?.directMessageId
      if(!taskId||!messageId||images.length||text.length>16000)throw Error('ChatGPT accepts plain text Messages up to 16,000 characters')
      if(state.running)throw Error('This ChatGPT employee is already handling a message')
      const binding=readJson<Binding>(file,()=>({}))
      const previous=readPending()
      if(state.chatGPTRecovery||previous&&previous.phase!=='prepared')throw Error('Resolve the previous ChatGPT delivery before sending')
      if(previous&&(!previous.messageId||typeof previous.text!=='string'||!previous.binding))throw Error('Invalid ChatGPT delivery record')
      const next:PendingTurn={messageId,text,binding,format:'markdown'}
      fs.mkdirSync(path.dirname(pending),{recursive:true,mode:0o700})
      const controller=new AbortController()
      state.abort=controller
      state.running=true
      try{
        host.rememberMeta(sessionId,{busy:true})
        host.emit('session:turn-start',{sessionId})
      }catch(error){
        state.running=false
        state.abort=undefined
        host.rememberMeta(sessionId,{busy:false})
        throw error
      }
      state.finished=(async()=>{
        let failure:string|undefined
        try{
          await wakeEgo(controller.signal)
          const progress=(body:string|null)=>publishEvent('direct:chatgpt-progress',{employee:cardId,messageId,text:body},'desktop')
          const result=await browserTurn(space,next,pending,controller.signal,'send',body=>{
            if(!controller.signal.aborted&&host.isOpen(sessionId)&&state.currentTask?.messageId===taskId&&state.currentTask.directMessageId===messageId)progress(body)
          },previous??undefined)
          if(!result.ok)throw Error(result.message)
          if('unsent' in result)throw Error('Expected a ChatGPT reply')
          controller.signal.throwIfAborted()
          if(!host.isOpen(sessionId)||state.currentTask?.messageId!==taskId||state.currentTask.directMessageId!==messageId)throw Error('The originating private message changed')
          await saveReply(next,result,()=>invokeApiTool(state,{command:'direct.post',args:replyArgs(next,result)},taskId,controller.signal))
          host.emit('session:receipt',{sessionId,taskId,stage:'read'})
          host.emit('session:agent',{sessionId,event:{kind:'text',id:taskId,text:result.text}})
        }catch(error){failure=controller.signal.aborted?'ChatGPT reply cancelled locally. Check the dedicated browser chat for any reply.':(error as Error).message}
        finally{
          state.running=false
          state.abort=undefined
          const unresolved=readPending()
          if(unresolved&&(unresolved.phase!=='prepared'||unresolved.messageId!==messageId))
            setRecovery(unresolved.messageId)
          host.rememberMeta(sessionId,{busy:false})
          publishEvent('direct:chatgpt-progress',{employee:cardId,messageId,text:null,committed:!failure},'desktop')
          if(failure){
            try{directDelivery(cardId,messageId,controller.signal.aborted?'interrupted':'failed',failure)}catch{host.emit('session:error',{sessionId,message:'Could not persist the ChatGPT delivery status'})}
            host.emit('session:error',{sessionId,message:failure})
          }
          host.emit('session:result',{sessionId,success:!failure,error:failure})
          host.emit('session:turn-end',{sessionId})
          if(host.isOpen(sessionId))host.dispatchQueued(state,sessionId)
        }
      })()
    },
    async recoverChatGPT(messageId,action){
      const turn=readPending()
      if(!turn||turn.messageId!==messageId||state.chatGPTRecovery!==messageId)
        throw Error('This ChatGPT delivery is no longer pending')
      if(state.running||state.queueDispatching)throw Error('Wait for the current ChatGPT operation')
      if(action==='unsent'&&turn.completed)throw Error('A completed reply is saved. Check for the reply to recover it.')
      const controller=new AbortController()
      state.running=true
      state.abort=controller
      const operation=(async()=>{
        host.rememberMeta(sessionId,{busy:true})
        await wakeEgo(controller.signal)
        const verifyUnsent=action==='unsent'
        const result=turn.completed??await browserTurn(space,turn,pending,controller.signal,verifyUnsent?'unsent':'check')
        controller.signal.throwIfAborted()
        if(!result.ok)throw Error(result.message)
        if('unsent' in result){
          directDelivery(cardId,messageId,'failed','Confirmed not sent to ChatGPT.')
          fs.rmSync(pending)
        }else{
          await saveReply(turn,result,()=>withCaller({...documentationIdentity(state),signal:controller.signal},()=>postDirectMessage(replyArgs(turn,result))))
          directDelivery(cardId,messageId,'accepted')
        }
        setRecovery()
      })().finally(()=>{
        state.running=false
        state.abort=undefined
        host.rememberMeta(sessionId,{busy:false})
        if(host.isOpen(sessionId))host.dispatchQueued(state,sessionId)
      })
      state.finished=operation.catch(()=>{})
      await operation
    },
    async interrupt(){state.abort?.abort();await state.finished},
    async close(){state.abort?.abort();await state.finished},
    async whenIdle(){await state.finished},
    steer:unsupported,setModel:unsupported,setPlan:unsupported,setPermission:unsupported,
    setThinking:unsupported,setEffort:unsupported,setFast:unsupported,background:unsupported
  }
  const previous=readPending()
  // A previous Core may have exited while its browser script was still alive.
  // Only this live session can automatically retire a prepared journal it observed stop.
  if(previous)state.chatGPTRecovery=previous.messageId
  host.register(sessionId,state)
  host.rememberMeta(sessionId,{engine:'chatgpt',cwd,chatGPTRecovery:state.chatGPTRecovery,busy:false,thinkingSupported:false,commands:[],models:[],planMode:false})
  return {sessionId,cwd,engine:'chatgpt' as const}
}
