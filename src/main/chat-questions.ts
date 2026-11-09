import {missionTaskId,missionTaskState,questionMissionId} from './missions'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import type {ChatQuestion,QuestionSpec} from '../shared/chat-questions'
import type {Delegation,PrincipalRef,RequestContext} from '../shared/management'
import {atomicJson,readJson} from './atomic-file'
import {readStore} from './store'
import {requestContext,authorize,canReadEmployee,withCaller,validateDelegation,registerDelegationValidator} from './authorization'
import {credentialActive} from './agent-access'
import {requireConversation} from './conversation-policy'
import {postDirectMessage,linkDirectQuestion} from './direct-messages'
import {postChatMessage} from './chat-groups'
import {messages,historyFile,emitChatChange} from './chat-group-store'
import {getLive,listLive,startSession,enqueueMessage} from './sessions'
import {taskViewId} from './task-view'
import {apiReadOnly} from '../shared/api-effects'

type Saved=ChatQuestion&{credentialHash?:string;originTaskId?:string;fingerprint:string;resume?:'claimed'|'queued'|'waiter'|'not-needed';viewId?:string}
const file=join(APP_HOME,'chat-questions.json'),creating=new Set<string>(),waiters=new Map<string,Set<()=>void>>()
let state:{version:1;questions:Saved[]}|undefined,timer:ReturnType<typeof setInterval>|undefined,emit:(channel:string,payload:unknown)=>void=()=>{},running=false,serviceError=''
const questionFingerprint=(value:Record<string,any>,scope=true)=>createHash('sha256').update(JSON.stringify([value.conversation,value.question,value.options.map((option:any)=>[option.id,option.label]),value.timeoutSeconds,value.fallback?[value.fallback.optionId,value.fallback.text??null]:null,...(scope?[value.missionId??null]:[])])).digest('hex')
const person=(id:string)=>readStore().sessions.find(card=>card.id===id&&!card.deleting)
function data(){if(serviceError)throw Error(serviceError);return state??=readJson(file,()=>({version:1 as const,questions:[] as Saved[]}),value=>(value as any)?.version===1&&Array.isArray((value as any)?.questions)&&(value as {questions:Saved[]}).questions.every(item=>typeof item.id==='string'&&item.id.startsWith('question_')&&typeof item.authorId==='string'&&typeof item.conversation==='string'&&typeof item.question==='string'&&Array.isArray(item.options)&&item.options.every(option=>typeof option.id==='string'&&typeof option.label==='string')&&['pending','answered','decided','cancelled'].includes(item.status)&&Number.isSafeInteger(item.revision)&&(item.deadline===null||Number.isFinite(item.deadline))))}
function save(item:Saved){try{atomicJson(file,data(),true)}catch(error){serviceError='Saved question storage is unavailable: '+(error as Error).message;running=false;clearInterval(timer);throw Error(serviceError)}emit('question:changed',{id:item.id,conversation:item.conversation,employee:item.authorId,status:item.status});for(const resolve of waiters.get(item.id)??[])resolve()}
function readable(item:ChatQuestion,principal=requestContext().principal){
 if(item.conversation==='employee:'+item.authorId){if(canReadEmployee(principal,item.authorId))return;throw Error('Private questions are visible only to their author and the real user')}
 requireConversation(item.conversation,'read',principal)
}
function get(id:string){const item=data().questions.find(item=>item.id===id);if(!item)throw Error('Unknown question');readable(item);return item}
function publicQuestion(item:Saved):ChatQuestion{if(serviceError)throw Error(serviceError);const {credentialHash,originTaskId,fingerprint,resume,viewId,...value}=item;return structuredClone(value)}
function validateAuthor(item:Saved){
 if(!person(item.authorId))throw Error('Question author no longer exists')
 if(item.credentialHash&&!credentialActive(item.authorId,item.credentialHash))throw Error('Question author credential was revoked')
 readable(item,{kind:'agent',employeeId:item.authorId})
}
export function validateQuestionReply(delegation:Delegation,target:string){
 const item=data().questions.find(item=>item.id===delegation.questionReply?.id)
 if(!item||item.status==='pending'||item.status==='cancelled'||item.authorId!==target||delegation.questionReply?.missionId!==item.missionId||delegation.requestedBy.kind!=='agent'||delegation.requestedBy.employeeId!==target||delegation.credentialHash!==item.credentialHash)throw Error('Question continuation is no longer authorized')
 validateAuthor(item)
 if(item.missionId&&!['open','failed'].includes(missionTaskState(item.missionId)))throw Error('The linked mission is unavailable or already complete; the decision remains saved')
}
registerDelegationValidator('questionReply',validateQuestionReply)
function choice(item:ChatQuestion,optionId:unknown,text:unknown){
 if(typeof optionId!=='string'||optionId!=='other'&&!item.options.some(option=>option.id===optionId))throw Error('Choose one of the published options or Other')
 if(text!==undefined&&(typeof text!=='string'||text.length>16000)||optionId==='other'&&(typeof text!=='string'||!text.trim()))throw Error('Other requires your written answer')
 return {optionId,...(typeof text==='string'&&text.trim()?{text:text.trim()}:{})}
}
async function resume(item:Saved){
 if(item.resume||creating.has(item.id)||item.status==='cancelled'||item.status==='pending')return
 if(item.missionId&&['succeeded','missing'].includes(missionTaskState(item.missionId))){item.resume='not-needed';save(item);return}
 item.resume='claimed';save(item)
 const context:RequestContext={principal:{kind:'agent',employeeId:item.authorId},requestId:'question:'+item.id,credentialHash:item.credentialHash},delegation:Delegation={requestedBy:context.principal,requestId:context.requestId,credentialHash:item.credentialHash,selfSchedule:true,questionReply:{id:item.id,missionId:item.missionId}}
 try{await withCaller(context,async()=>{
  validateDelegation(delegation,item.authorId)
  const opened=await startSession({cardId:item.authorId,delegation});validateDelegation(delegation,item.authorId)
  if(!running)throw Error('Service stopped before question continuation was queued')
  const text='[Aexus saved question decision]\n'+JSON.stringify({id:item.id,conversation:item.conversation,question:item.question,missionId:item.missionId,answer:item.answer,chosenLabel:item.options.find(option=>option.id===item.answer?.optionId)?.label??'Other'})+'\nContinue the original task using this recorded decision. When missionId is present, read mission.get to recover the goal and acceptance criteria before continuing. Newer messages and mission notifications are separate tasks. Do not ask the same question again or invent another user answer.'
  enqueueMessage(opened.sessionId,text,[],delegation,taskViewId(item.authorId,item.viewId,true),undefined,undefined,undefined,undefined,[],undefined,item.conversation.startsWith('employee:')?'messages':'company')
 });item.resume='queued';item.deliveryError=undefined}catch(error){if(item.missionId&&['succeeded','missing'].includes(missionTaskState(item.missionId))){item.resume='not-needed';item.closedReason='mission-completed';item.deliveryError=undefined}else item.deliveryError=(error as Error).message}save(item)
}
function settle(item:Saved,answer:NonNullable<ChatQuestion['answer']>){
 item.answer=answer;item.status=answer.by==='user'?'answered':'decided';item.revision++
 if(waiters.get(item.id)?.size)item.resume='waiter'
 save(item);void resume(item).catch(error=>console.error('[Question continuation]',error.message))
}
export function startQuestions(broadcast:typeof emit){
 emit=broadcast;try{data()}catch(error){serviceError='Cannot start saved questions: '+(error as Error).message;console.error(serviceError);return}running=true
 for(const item of data().questions)if(item.resume==='claimed'&&!item.deliveryError){item.deliveryError='Service stopped during continuation delivery. The saved answer is retained; it was not replayed.';save(item)}
 timer=setInterval(()=>{try{for(const item of data().questions)if(item.status==='pending'){
  if(item.missionId&&['succeeded','missing'].includes(missionTaskState(item.missionId))){item.status='cancelled';item.closedReason='mission-completed';item.revision++;save(item);continue}
  if(!person(item.authorId)){item.status='cancelled';item.revision++;item.deliveryError='Question author was removed';save(item);continue}
  if(item.deadline!==null&&item.deadline<=Date.now()){try{validateAuthor(item);const answer=choice(item,item.fallback?.optionId,item.fallback?.text);settle(item,{...answer,at:Date.now(),by:'timeout'})}catch(error){item.deliveryError=(error as Error).message;item.deadline=null;item.revision++;save(item)}}
 }}catch(error){serviceError='Saved question timer stopped: '+(error as Error).message;running=false;clearInterval(timer);console.error(serviceError)}},250);timer.unref()
}
export function stopQuestions(){running=false;clearInterval(timer);for(const listeners of waiters.values())for(const resolve of listeners)resolve()}
export function missionPendingQuestions(id:string){return data().questions.filter(item=>item.status==='pending'&&item.missionId===id).map(item=>({id:item.id,authorId:item.authorId}))}
/** A different incoming task remains free to run; only the asking turn is gated. */
export function assertQuestionGate(command:string,context:RequestContext){
 if(context.principal.kind!=='agent'||apiReadOnly(command)||['direct.post','chat.post','mission.fail','question.cancel','mission.archive','mission.delete','plan.archive'].includes(command))return
 const employee=context.principal.employeeId,live=listLive().map(({id})=>getLive(id)).find(live=>live?.cardId===employee),current=live?.running?live.currentTask:undefined,missionId=missionTaskId(employee,current)
 if(command.startsWith('question.'))return
 const blocking=data().questions.filter(item=>item.status==='pending'&&(item.authorId===employee&&item.originTaskId===current?.messageId&&!!current||missionId&&item.missionId===missionId))
 if(blocking.length)throw Error('This task is waiting for a saved user question: '+blocking.map(item=>item.id).join(', ')+'. Read question.get when authorized; only its author calls question.wait. Report the wait or yield this goal. Other incoming tasks remain independent.')
}
export async function questionRequest(method:string,args:Record<string,any>){
 const context=requestContext();authorize('question.'+method,args)
 if(method==='list'){
  const rows=data().questions.filter(item=>{try{readable(item);return (!args.conversation||item.conversation===args.conversation)&&(!args.missionId||item.missionId===args.missionId)&&(!args.status||item.status===args.status)}catch{return false}}).sort((a,b)=>b.createdAt-a.createdAt),offset=args.offset??0,limit=args.limit??200
  const pendingCounts:Record<string,number>={};for(const item of rows)if(item.status==='pending')pendingCounts[item.conversation]=(pendingCounts[item.conversation]??0)+1
  return {questions:rows.slice(offset,offset+limit).map(publicQuestion),total:rows.length,hasMore:offset+limit<rows.length,pendingCounts}
 }
 if(method==='ask'){
  if(context.principal.kind!=='agent')throw Error('Questions are published by the authenticated employee, not the operator')
  const authorId=context.principal.employeeId
  if(args.conversation!=='employee:'+authorId){const group=requireConversation(args.conversation);if(!args.conversation.startsWith('group:')||group.group?.bot)throw Error('Questions require your private chat or a Company group')}
  if(!Array.isArray(args.options)||!args.options.length||args.options.some((option:any)=>!option?.id?.trim()||!option.label?.trim()||option.id==='other')||new Set(args.options.map((option:any)=>option.id)).size!==args.options.length)throw Error('Provide unique option IDs; Other is added automatically')
  if(args.timeoutSeconds!==null&&(!Number.isSafeInteger(args.timeoutSeconds)||args.timeoutSeconds<1))throw Error('Use a positive timeout or null to require the user indefinitely')
  if(args.timeoutSeconds!==null&&!args.fallback)throw Error('A finite timeout requires the employee’s declared fallback decision')
  if(args.timeoutSeconds===null&&args.fallback)throw Error('An indefinite user decision cannot have an automatic fallback')
  const fingerprint=questionFingerprint(args),previous=data().questions.find(item=>item.authorId===authorId&&item.clientRequestId===args.clientRequestId)
  if(previous){readable(previous);if(previous.fingerprint!==fingerprint)throw Error('Question request key already used with different content');return publicQuestion(previous)}
  const live=listLive().map(({id})=>getLive(id)).find(live=>live?.cardId===authorId&&live.running),now=Date.now(),item:Saved={conversation:args.conversation,question:args.question,options:args.options,timeoutSeconds:args.timeoutSeconds,fallback:args.fallback,clientRequestId:args.clientRequestId,id:'question_'+randomUUID(),authorId,createdAt:now,deadline:args.timeoutSeconds===null?null:now+args.timeoutSeconds*1000,revision:1,status:'pending',missionId:(args.missionId??missionTaskId(authorId,live?.currentTask))?questionMissionId(args.missionId??missionTaskId(authorId,live?.currentTask)!,context.principal):undefined,credentialHash:context.credentialHash,fingerprint,originTaskId:live?.currentTask?.messageId,viewId:taskViewId(authorId,args.viewId??live?.currentTask?.viewId,true)}
  if(item.fallback)choice(item,item.fallback.optionId,item.fallback.text)
  const unanswered=item.missionId&&data().questions.find(previous=>previous.authorId===authorId&&previous.missionId===item.missionId&&previous.status==='pending'&&questionFingerprint(previous,false)===questionFingerprint(item,false))
  if(unanswered)return publicQuestion(unanswered)
  data().questions.push(item);creating.add(item.id);save(item)
  try{
   const publication=item.conversation.startsWith('employee:')?await postDirectMessage({text:item.question,clientMessageId:'question:'+item.id}):await postChatMessage({id:item.conversation.slice(6),text:Array.from(item.question).slice(0,1800).join(''),kind:'question',clientMessageId:'question:'+item.id})
   item.messageId=publication.id
   if(item.conversation.startsWith('employee:'))linkDirectQuestion(authorId,item.messageId,item.id)
   else{const groupId=item.conversation.slice(6),history=messages(groupId),message=history.find(message=>message.id===item.messageId);if(message){message.questionId=item.id;atomicJson(historyFile(groupId),history,true);emitChatChange(groupId,item.messageId)}}
   save(item);if(item.status!=='pending')item.resume='waiter';return publicQuestion(item)
  }catch(error){item.deliveryError=(error as Error).message;save(item);throw error}finally{creating.delete(item.id)}
 }
 const item=get(args.id)
 if(method==='get')return publicQuestion(item)
 if(method==='wait'){
  if(context.principal.kind!=='agent'||context.principal.employeeId!==item.authorId)throw Error('Only the question author waits on its decision')
  if(item.status==='pending')await new Promise<void>((resolve,reject)=>{
   const listeners=waiters.get(item.id)??new Set<()=>void>();waiters.set(item.id,listeners)
   const finish=(error?:Error)=>{clearTimeout(timeout);listeners.delete(done);if(!listeners.size)waiters.delete(item.id);context.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve()},done=()=>finish(),abort=()=>finish(Error('Question wait cancelled; the saved question remains pending')),timeout=setTimeout(done,(args.seconds??25)*1000)
   listeners.add(done);context.signal?.addEventListener('abort',abort,{once:true});if(context.signal?.aborted)abort()
  })
  return publicQuestion(item)
 }
 if(method==='answer'){
  if(context.principal.kind!=='operator')throw Error('Only the real user may answer a saved question; Secretary cannot impersonate the user')
  if(item.status!=='pending'||item.revision!==args.expectedRevision)throw Error('Question already decided or changed; reload the saved decision')
  settle(item,{...choice(item,args.optionId,args.text),at:Date.now(),by:'user'});return publicQuestion(item)
 }
 if(method==='cancel'){
  if(context.principal.kind!=='operator'&&context.principal.employeeId!==item.authorId)throw Error('Only the author or real user may withdraw a question')
  if(item.status!=='pending'||item.revision!==args.expectedRevision)throw Error('Question already decided or changed')
  item.status='cancelled';item.revision++;save(item);return publicQuestion(item)
 }
 throw Error('Unknown question method')
}
