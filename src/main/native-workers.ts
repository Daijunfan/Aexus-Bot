import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {isEngine,ENGINE_DEFINITIONS} from '../shared/engines'
import type {NativeWorker,NativeWorkerDraftResult,NativeWorkerEngine,WorkerSnapshot,WorkerReceipt,WorkerState} from '../shared/native-worker'
import type {PrincipalRef} from '../shared/management'
import {atomicJson,readJson} from './atomic-file'
import {readStore} from './store'
import {executionEmployee,employeeWorkspace} from './workspaces'
import {requestContext} from './request-context'
import {isAppAdministrator} from './application-authority'
import {emitCoreEvent,onCoreEvent} from './core-events'
import type {ChildProcess} from 'node:child_process'
import type {Session} from '../shared/types'
import {apply,applyAgent,renderTranscript} from '../shared/transcript'
import {approvalsFor,answerApproval,cancelApprovals} from './approvals'
import {openWorkerRuntime,type WorkerRuntime} from './engines/worker-runtime'
import {closeWorkerProcesses} from './worker-processes'
import {terminateTree} from './platform'
import {engineExecutable} from './engines/executable'
import {resolveBinary} from './exec'
import {listTerminals,closeTerminal} from './terminals'

type Record=Omit<NativeWorker,'running'|'terminal'|'exitCode'|'busy'|'state'|'error'>&{sessionFile?:string}&{createdBy?:PrincipalRef;clientRequestId?:string;requestFingerprint?:string}
const file=path.join(APP_HOME,'native-workers.json'),stopping=new Set<string>()
const records=()=>readJson<Record[]>(file,()=>[],Array.isArray)
function owner(employee?:string){
 const principal=requestContext().principal,id=employee??(principal.kind==='agent'?principal.employeeId:undefined)
 if(!id)throw Error('请选择 Worker 的直属员工（employee）')
 if(!isAppAdministrator(principal)&&principal.kind==='agent'&&principal.employeeId!==id)throw Error('Forbidden: only directly owned Workers may be controlled')
 const store=readStore(),card=store.sessions.find(c=>c.id===id&&!c.deleting)
 if(!card)throw Error('Worker owner no longer exists')
 return {store,card}
}
function authorizeWorker(value:Record){if(value.employee)owner(value.employee);else if(!isAppAdministrator(requestContext().principal))throw Error('Forbidden: only directly owned Workers may be controlled')}
let workerEmitter=(id?:string)=>emitCoreEvent({channel:'workers:changed',payload:{id}})
export function setWorkerEmitter(emit?:(id?:string)=>void){workerEmitter=emit??(id=>emitCoreEvent({channel:'workers:changed',payload:{id}}))}
function changed(id?:string){workerEmitter(id)}
function get(id:string){const value=records().find(w=>w.id===id);if(!value)throw Error('Unknown Worker');authorizeWorker(value);return value}

function present(value:Record):NativeWorker{const {createdBy,clientRequestId,requestFingerprint,sessionFile,...worker}=value,entry=entries.get(value.id);return {...worker,running:!!entry?.runtime&&entry.runtime.connected?.()!==false&&!entry.closing,busy:!!entry?.current||!!entry?.background,state:entry?.state??'stopped',error:entry?.error,model:entry?.session.model??value.model,effort:entry?.effort??value.effort}}

function location(value:Record){
 if(!value.employee){authorizeWorker(value);const cwd=fs.realpathSync(value.cwd);if(!fs.statSync(cwd).isDirectory())throw Error('Worker 工作目录必须是已有文件夹');return {id:'worker:'+value.id,cwd,remote:null,accessMode:'trusted' as const}}
 const {store,card}=owner(value.employee),effective=executionEmployee(store,card)
 if((effective.remote?.host??undefined)!==value.host)throw Error('直属员工的执行主机已改变，请重新创建 Worker；不会回退到本机')
 const paths=effective.remote?.os==='windows'?path.win32:effective.remote?path.posix:path
 const root=effective.remote?card.cwd:fs.realpathSync(card.cwd),cwd=effective.remote?paths.resolve(value.cwd):fs.realpathSync(value.cwd),relative=paths.relative(root,cwd)
 if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw Error('Worker 工作目录必须位于直属员工的工作目录内')
 if(!effective.remote&&!fs.statSync(cwd).isDirectory())throw Error('Worker 工作目录必须是已有文件夹')
 employeeWorkspace(store,card.group,card.cwd,card.id)
 return {...effective,cwd,remote:effective.remote?{...effective.remote,directory:cwd}:null}
}
export function listWorkers(employee?:string){
 const principal=requestContext().principal
 if(employee||!isAppAdministrator(principal)&&principal.kind==='agent')owner(employee)
 return records().filter(w=>employee?w.employee===employee:isAppAdministrator(principal)||principal.kind==='agent'&&w.employee===principal.employeeId).map(present)
}
export function workerEngines():NativeWorkerEngine[]{return Object.keys(ENGINE_DEFINITIONS).filter(engine=>engine!=='chatgpt').map(engine=>{const id=engine as NativeWorkerEngine['engine'],executable=engineExecutable(id,false),resolved=path.isAbsolute(executable)?executable:resolveBinary(executable);return {engine:id,label:ENGINE_DEFINITIONS[id].label,installed:path.isAbsolute(resolved)&&fs.existsSync(resolved)}})}
export function createWorker(args:{employee?:string;engine:string;title?:string;cwd?:string;clientRequestId?:string}){
 if(!isEngine(args.engine)||args.engine==='chatgpt')throw Error('Unsupported native Coding Agent engine')
 const principal=requestContext().principal
 const owned=args.employee||!isAppAdministrator(principal)||principal.kind==='agent'&&!args.cwd?owner(args.employee):undefined
 if(!owned&&!args.cwd?.trim())throw Error('Choose an existing Worker workspace')
 const effective=owned?executionEmployee(owned.store,owned.card):undefined
 if(effective?.remote&&!['codex','claude'].includes(args.engine))throw Error('This engine’s graphical Worker requires a Core-local folder; the host will not be changed.')
 const paths=effective?.remote?.os==='windows'?path.win32:effective?.remote?path.posix:path
 const value:Record={id:randomUUID(),...(owned?{employee:owned.card.id}:{}),title:args.title?.trim()||ENGINE_DEFINITIONS[args.engine].label+' Worker',engine:args.engine,cwd:paths.resolve(owned?.card.cwd??process.cwd(),args.cwd??'.'),host:effective?.remote?.host,createdAt:new Date().toISOString()}
 if(args.clientRequestId!==undefined){
  const key=args.clientRequestId;if(typeof key!=='string'||!key.trim()||key.length>160)throw Error('clientRequestId must be 1–160 characters')
  const fingerprint=createHash('sha256').update(JSON.stringify([value.employee??null,value.title,value.engine,value.cwd,value.host??null])).digest('hex'),previous=records().find(worker=>worker.clientRequestId===key&&JSON.stringify(worker.createdBy)===JSON.stringify(principal))
  if(previous){authorizeWorker(previous);if(previous.requestFingerprint!==fingerprint)throw Error('clientRequestId already used with different Worker settings');return present(previous)}
  value.createdBy=principal;value.clientRequestId=key;value.requestFingerprint=fingerprint
 }
 location(value)
 atomicJson(file,[...records(),value]);changed();return present(value)
}
type History={revision?:number;items:Session['items'];receipts:WorkerReceipt[]}
type Entry={session:Session;effort?:string;receipts:WorkerReceipt[];revision:number;state:WorkerState;background?:boolean;policy?:'default'|'acceptEdits'|'bypassPermissions';error?:string;current?:WorkerReceipt;runtime?:WorkerRuntime;opening?:Promise<void>;pumping?:Promise<void>;controller?:AbortController;life:AbortController;children:ChildProcess[];closing:boolean;timer?:ReturnType<typeof setTimeout>;saveTimer?:ReturnType<typeof setTimeout>;closePromise?:Promise<void>}
const entries=new Map<string,Entry>(),historyFile=(id:string)=>path.join(APP_HOME,'worker-conversations',id+'.json')
function persist(id:string,entry:Entry){clearTimeout(entry.saveTimer);entry.saveTimer=undefined;const value=records().find(worker=>worker.id===id);atomicJson(historyFile(id),{revision:entry.revision,items:entry.session.items,receipts:entry.receipts,...(value?{nativeSessionId:value.nativeSessionId,sessionFile:value.sessionFile,engine:value.engine,cwd:value.cwd,host:value.host,title:value.title,employee:value.employee,draft:value.draft}:{})},true)}
function update(id:string,entry:Entry,immediate=false){entry.revision++;if(immediate){persist(id,entry);changed(id)}else{if(!entry.timer)entry.timer=setTimeout(()=>{entry.timer=undefined;changed(id)},60);if(!entry.saveTimer)entry.saveTimer=setTimeout(()=>{try{persist(id,entry)}catch(error){entry.saveTimer=undefined;entry.error='Worker history could not be saved: '+(error as Error).message;entry.state='error';changed(id)}},1000)}}

function safeUpdate(id:string,entry:Entry,immediate=true){try{update(id,entry,immediate);return true}catch(error){entry.error='Worker history could not be saved: '+(error as Error).message;if(!entry.closing)entry.state='error';changed(id);return false}}

function hydrate(value:Record){
 const existing=entries.get(value.id);if(existing)return existing
 const saved=readJson<History>(historyFile(value.id),()=>({items:[],receipts:[]})),interrupted=new Set(saved.receipts.filter(receipt=>['queued','running'].includes(receipt.state)).map(receipt=>receipt.id))
 const receipts=saved.receipts.map(receipt=>interrupted.has(receipt.id)?{...receipt,state:'interrupted' as const,error:'The previous Worker connection ended. This task was not replayed.'}:receipt)
 const items=saved.items.map(item=>item.role==='user'&&interrupted.has(item.id)?{...item,delivery:{state:'interrupted',error:'The previous connection ended. This task was not replayed.'}}:item.role==='assistant'?{...item,blocks:item.blocks.map(block=>block.kind==='tool'?{...block,running:false}:block.kind==='thinking'?{...block,done:true}:block)}:item)
 const session:Session={id:'worker:'+value.id,title:value.title,engine:value.engine,group:'',createdAt:Date.now(),items,commands:[],models:[],model:value.model,permissionMode:value.permissionMode??'default',thinking:false,thinkingSupported:false,busy:false}
 const entry:Entry={session,receipts,effort:value.effort,revision:(saved.revision??0)+1,state:'stopped',life:new AbortController(),children:[],closing:false};entries.set(value.id,entry);if(interrupted.size)persist(value.id,entry);return entry
}
export function workerSnapshot(id:string):WorkerSnapshot{
 const value=get(id),entry=hydrate(value);return {worker:present(value),configuration:{model:value.model,effort:value.effort,permissionMode:value.permissionMode??'default'},requiresReconnect:!!entry.runtime&&entry.policy!==(value.permissionMode??'default'),items:entry.session.items,receipts:entry.receipts,models:entry.session.models,model:entry.session.model,effort:entry.effort,approvals:approvalsFor('worker:'+id),pendingMessages:entry.receipts.filter(receipt=>receipt.state==='queued').map(({id,text})=>({id,text})),currentMessageId:entry.current?.id,revision:entry.revision}
}
function nativeInfo(id:string,entry:Entry,info:{nativeSessionId?:string;sessionFile?:string;models?:Session['models'];model?:string;effort?:string}){
 if(entry.closing||!entries.has(id))return
 if(info.models)entry.session.models=info.models;if(info.model)entry.session.model=info.model;if(info.effort!==undefined)entry.effort=info.effort
 if(info.nativeSessionId||info.sessionFile)atomicJson(file,records().map(worker=>worker.id===id?{...worker,...(info.nativeSessionId?{nativeSessionId:info.nativeSessionId}:{}),...(info.sessionFile?{sessionFile:info.sessionFile}:{})}:worker))
 update(id,entry,true)
}
function delivery(entry:Entry,receipt:WorkerReceipt,state:WorkerReceipt['state'],error?:string){
 receipt.state=state;receipt.error=error;entry.session.items=entry.session.items.map(item=>item.id===receipt.id&&item.role==='user'?{...item,delivery:{state:state==='running'||state==='completed'?'accepted':state,error}}:item)
}
function finishBlocks(entry:Entry){entry.session.items=entry.session.items.map(item=>item.role==='assistant'?{...item,blocks:item.blocks.map(block=>block.kind==='tool'?{...block,running:false}:block.kind==='thinking'?{...block,done:true}:block)}:item)}
function cancelQueue(entry:Entry,reason:string){for(const receipt of entry.receipts)if(receipt.state==='queued')delivery(entry,receipt,'interrupted',reason)}
async function closeEntry(id:string,entry:Entry,preserveQueue=false){
 if(entry.closePromise)return entry.closePromise
 entry.closing=true;entry.state='stopping';entry.background=false;if(!preserveQueue)cancelQueue(entry,'Worker stopped. This queued task was cancelled.');cancelApprovals('worker:'+id);safeUpdate(id,entry)
 entry.closePromise=(async()=>{
  await closeWorkerProcesses(entry.children,async()=>{entry.life.abort();entry.controller?.abort();if(entry.runtime)await entry.runtime.close();else{for(const child of entry.children)terminateTree(child);await entry.opening?.catch(()=>{})}await entry.pumping})
  entry.runtime=undefined;entry.children=[];entry.state='stopped';entry.closing=false;finishBlocks(entry);if(!safeUpdate(id,entry))throw Error('Worker stopped, but its history could not be saved. Its record was retained.')
 })().catch(error=>{entry.state=entry.runtime?.connected?.()===false?'stopped':'error';entry.error=(error as Error).message;safeUpdate(id,entry);throw error}).finally(()=>{entry.closePromise=undefined})
 return entry.closePromise
}
export async function startWorker(id:string,_cols?:number,_rows?:number){
 const value=get(id),entry=hydrate(value);if(_cols!==undefined||_rows!==undefined)throw Error('Graphical Workers do not accept terminal dimensions. Omit cols and rows.');if(stopping.has(id)||entry.closing)throw Error('Worker is stopping. Wait for it to exit before reconnecting.')
 if(entry.opening){await entry.opening;return present(get(id))}
 if(entry.runtime&&entry.runtime.connected?.()!==false)return present(value)
 entry.opening=(async()=>{
  if(entry.runtime)await closeEntry(id,entry,true)
  entry.closing=false;entry.life=new AbortController();entry.children=[];entry.error=undefined;entry.session.error=undefined;entry.session.model=value.model;entry.effort=value.effort;entry.state='starting';update(id,entry,true)
  const previous=listTerminals().find(terminal=>terminal.worker===id);if(previous)await closeTerminal(previous.id)
  const effective=location(get(id));if(effective.accessMode==='isolated')throw Error('This Worker protocol does not support strict isolation; no unrestricted process was started.')
  const runtime=await openWorkerRuntime({id,engine:value.engine,cwd:effective.remote?.directory??effective.cwd,remote:effective.remote,directory:path.join(APP_HOME,'native-worker-profiles',id),nativeSessionId:value.nativeSessionId,sessionFile:value.sessionFile,model:value.model,effort:value.effort,permissionMode:value.permissionMode??'default',signal:entry.life.signal,turnSignal:()=>entry.controller?.signal??entry.life.signal,
   onProcess:child=>{entry.children.push(child);if(entry.closing)terminateTree(child)},changed:()=>safeUpdate(id,entry),info:info=>{try{nativeInfo(id,entry,info)}catch(error){entry.error='Worker history could not be saved: '+(error as Error).message;entry.state='error';entry.controller?.abort();changed(id)}},event:(event,format)=>{if(entry.closing||!entries.has(id))return;if(event.kind==='background-turn'){entry.background=event.busy;if(event.busy)entry.state='working';else{if(!entry.current)entry.state=entry.error?'error':'ready';pump(id,entry)}}entry.session=format==='claude'?apply(entry.session,event):applyAgent(entry.session,event);if(event.kind==='notice'&&event.level==='error'){entry.error=event.text;entry.state='error'}update(id,entry)}})
  if(entry.closing){await runtime.close();throw Error('Worker connection was cancelled')}
  try{location(get(id))}catch(error){await runtime.close();throw error}if(entry.error){await runtime.close();throw Error(entry.error)}entry.runtime=runtime;entry.policy=value.permissionMode??'default';entry.state='ready';update(id,entry,true)
 })().catch(async error=>{if(!entry.closing){entry.error=(error as Error).message;entry.state='error';await closeWorkerProcesses(entry.children,async()=>{}).catch(()=>{});update(id,entry,true)}throw error}).finally(()=>{entry.opening=undefined})
 await entry.opening;return present(get(id))
}
function pump(id:string,entry:Entry){
 if(entry.pumping||entry.closing||entry.background||!entry.runtime)return
 entry.pumping=(async()=>{
  while(!entry.closing&&!entry.background&&entry.runtime){
   const receipt=entry.receipts.find(receipt=>receipt.state==='queued');if(!receipt)break
   // Recheck ownership, physical folder and execution host before every task.
   try{location(get(id))}catch(error){delivery(entry,receipt,'failed',(error as Error).message);cancelQueue(entry,'Worker access changed. Queued tasks were cancelled.');entry.error=(error as Error).message;entry.state='error';update(id,entry,true);break}
   entry.current=receipt;entry.controller=new AbortController();entry.error=undefined;entry.session.error=undefined;entry.state='working';delivery(entry,receipt,'running');update(id,entry,true)
   try{await entry.runtime.send(receipt.text,entry.controller.signal);if(entry.controller.signal.aborted)delivery(entry,receipt,'interrupted','Task interrupted');else if(entry.error)throw Error(entry.error);else delivery(entry,receipt,'completed')}
   catch(error){const interrupted=entry.controller.signal.aborted;delivery(entry,receipt,interrupted?'interrupted':'failed',(error as Error).message);if(!interrupted){entry.error=(error as Error).message;cancelQueue(entry,'A previous task failed. This task was not replayed.')}}
   finally{entry.current=undefined;entry.controller=undefined;cancelApprovals('worker:'+id);if(receipt.state!=='completed')finishBlocks(entry);if(!entry.closing)entry.state=entry.runtime?.connected?.()===false?'stopped':entry.error?'error':'ready';safeUpdate(id,entry)}
   if(entry.error)break
  }
 })().catch(error=>{entry.error=(error as Error).message;entry.state='error';cancelQueue(entry,'Worker history could not be saved. Queued tasks were cancelled.');changed(id)}).finally(()=>{entry.pumping=undefined})
}
export async function sendWorker(id:string,text:string,clientMessageId=randomUUID()){
 const value=get(id),entry=hydrate(value)
 if(typeof text!=='string'||!text.trim()||text.length>100000)throw Error('Worker task text must contain 1–100000 characters')
 if(typeof clientMessageId!=='string'||!clientMessageId.trim()||clientMessageId.length>160)throw Error('clientMessageId must contain 1–160 characters')
 const previous=entry.receipts.find(receipt=>receipt.clientMessageId===clientMessageId)
 if(previous){if(previous.text!==text)throw Error('clientMessageId was already used with different task text');return {accepted:!['failed','interrupted'].includes(previous.state),receipt:previous,duplicate:true}}
 location(value);if(entry.runtime&&entry.policy!==(value.permissionMode??'default'))throw Error('Reconnect the Worker to apply its changed permissions before sending new work.');if(entry.closing)throw Error('Worker is stopping');if(stopping.has(id))throw Error('Worker settings are being applied. Wait for the current operation.')
 const receipt:WorkerReceipt={id:randomUUID(),clientMessageId,text,createdAt:Date.now(),state:'queued'};entry.receipts.push(receipt);entry.session.items=[...entry.session.items,{role:'user',id:receipt.id,text,createdAt:receipt.createdAt,delivery:{state:'queued'}}];try{update(id,entry,true)}catch(error){entry.receipts=entry.receipts.filter(value=>value.id!==receipt.id);entry.session.items=entry.session.items.filter(item=>item.id!==receipt.id);throw error}
 // Accept durably before a potentially slow native handshake; never leave clicked text only in a transient editor.
 void startWorker(id).then(()=>pump(id,entry)).catch(error=>{if(entry.closing||entry.state==='stopped'||!entries.has(id)||!records().some(worker=>worker.id===id))return;for(const pending of entry.receipts)if(pending.state==='queued')delivery(entry,pending,'failed',(error as Error).message);entry.error=(error as Error).message;entry.state='error';update(id,entry,true)})
 return {accepted:true,receipt,duplicate:false}
}

export function dequeueWorker(id:string,messageId:string){const entry=hydrate(get(id)),receipt=entry.receipts.find(receipt=>receipt.id===messageId&&receipt.state==='queued');if(receipt)delivery(entry,receipt,'interrupted','Queued task cancelled');update(id,entry,true);return workerSnapshot(id)}
export function respondWorker(id:string,requestId:string,decision:string,answers?:{[key:string]:string|string[]},form?:{[key:string]:unknown}){const value=get(id);if(decision==='allow')location(value);return answerApproval('worker:'+id,requestId,decision==='allow',answers,form)}
export async function configureWorker(id:string,changes:{model?:string;effort?:string;permissionMode?:'default'|'acceptEdits'|'bypassPermissions'}){
 const value=get(id),entry=hydrate(value);location(value)
 if(changes.permissionMode!==undefined&&!isAppAdministrator(requestContext().principal))throw Error('Only the user or Secretary may change Worker permissions')
 if(entry.current||entry.background||entry.receipts.some(receipt=>receipt.state==='queued')||entry.opening||entry.closing||approvalsFor('worker:'+id).length)throw Error('Wait for the current Worker task before changing its settings')
 if(changes.model&&!entry.session.models.some(model=>model.value===changes.model))throw Error('Connect first and choose a model from this native engine’s catalog')
 const model=entry.session.models.find(model=>model.value===(changes.model||entry.session.model));if(changes.effort&&!model?.supportedEffortLevels?.includes(changes.effort))throw Error('This model does not support the selected reasoning effort')
 const previousNative={model:entry.session.model??'',effort:entry.effort??''},patch={...changes,...(changes.model!==undefined&&changes.model!==value.model?{effort:changes.effort??''}:{})}
 stopping.add(id)
 try{
  if(entry.runtime&&(patch.model!==undefined||patch.effort!==undefined)){if(!entry.runtime.configure)throw Error('This native connection cannot change its settings while connected');await entry.runtime.configure(patch)}
  const next={...get(id),...patch};if(!next.model)delete next.model;if(!next.effort)delete next.effort
  atomicJson(file,records().map(worker=>worker.id===id?next:worker));if(!entry.runtime){entry.session.model=next.model;entry.effort=next.effort}update(id,entry,true)
  return workerSnapshot(id)
 }catch(error){if(entry.runtime?.configure&&(patch.model!==undefined||patch.effort!==undefined))try{await entry.runtime.configure(previousNative)}catch{};throw error}finally{stopping.delete(id)}
}

export async function interruptWorker(id:string,expectedMessageId?:string){
 const entry=hydrate(get(id));if(expectedMessageId&&entry.current?.id!==expectedMessageId)throw Error('The Worker task changed. Review the current task before stopping.')
 cancelQueue(entry,'Queued task cancelled by Stop');if(entry.opening&&!entry.runtime){await closeEntry(id,entry);return present(get(id))}
 const active=entry.controller;active?.abort();cancelApprovals('worker:'+id)
 if(!active&&entry.background&&entry.runtime)await entry.runtime.interrupt()
 if(entry.pumping){let timer:ReturnType<typeof setTimeout>|undefined;try{const done=await Promise.race([entry.pumping.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),1000)})]);if(!done)await closeEntry(id,entry)}finally{clearTimeout(timer)}}
 entry.background=false;update(id,entry,true);return present(get(id))
}
export async function readWorker(id:string,cursor=0,waitMs=0){
 const entry=hydrate(get(id)),text=()=>renderTranscript(entry.session.items)
 const signal=requestContext().signal
 if(waitMs&&entry.revision===cursor)await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);off();signal?.removeEventListener('abort',finish);resolve()},off=onCoreEvent(event=>{if(event.channel==='workers:changed'&&(!event.payload.id||event.payload.id===id))finish()}),timer=setTimeout(finish,Math.min(waitMs,15000));signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted)finish()})
 get(id);const updated=cursor===0||cursor!==entry.revision;return {...present(get(id)),output:updated?text():'',cursor:entry.revision,reset:cursor>0&&updated}
}
export function inputWorker(id:string,data:string,expectedTerminal?:string){if(expectedTerminal!==undefined||/[\u001b\u0000]/.test(data))throw Error('Workers use graphical conversations. Raw terminal input is unsupported; use worker.send.');return sendWorker(id,data.replace(/\r$/,''))}
export function saveWorkerDraft(id:string,text:string,expectedRevision?:number,newAttempt=false):NativeWorkerDraftResult{
 const value=get(id),current=value.draft??{text:'',revision:0}
 if(typeof text!=='string'||text.length>100000)throw Error('Worker draft text must be at most 100000 characters')
 if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw Error('expectedRevision must be a nonnegative integer')
 if(expectedRevision!==undefined&&expectedRevision!==current.revision)return {applied:false,draft:current}
 if(text===current.text&&!newAttempt)return {applied:true,draft:current}
 const draft={text,revision:current.revision+1};atomicJson(file,records().map(worker=>worker.id===id?{...worker,draft}:worker));changed();return {applied:true,draft}
}
export function resizeWorker(id:string,_cols:number,_rows:number){get(id);throw Error('Workers use graphical conversations and have no terminal to resize.')}
export async function stopWorker(id:string,remove=false){
 const value=get(id);if(stopping.has(id))throw Error('Worker is stopping. Wait for process termination to finish.')
 stopping.add(id)
 try{const entry=hydrate(value);await closeEntry(id,entry);const terminal=listTerminals().find(terminal=>terminal.worker===id);if(terminal)await closeTerminal(terminal.id);get(id);if(remove){atomicJson(file,records().filter(worker=>worker.id!==id));entries.delete(id)}changed(id);return remove?true:present(get(id))}finally{stopping.delete(id)}
}
/** Employee removal revokes its identity first; this internal path still closes every owned process. */
export async function removeEmployeeWorkers(employee:string){
 for(const value of records().filter(worker=>worker.employee===employee)){const entry=entries.get(value.id);if(entry)await closeEntry(value.id,entry);const terminal=listTerminals().find(terminal=>terminal.worker===value.id);if(terminal)await closeTerminal(terminal.id);entries.delete(value.id)}
 atomicJson(file,records().filter(worker=>worker.employee!==employee));changed()
}
export async function closeWorkers(){const results=await Promise.allSettled([...entries].map(([id,entry])=>closeEntry(id,entry)));for(const result of results)if(result.status==='rejected')console.error('Worker shutdown:',(result.reason as Error).message)}
