import {validateApiArguments} from './api-contract'
import {workerFeatures,workerCommands,workerPublicData} from './engines/worker-tools'
import {activeModel,supportsFast} from '../shared/engine-commands'
import {workerPermissionModes,type WorkerPermissionMode,type WorkerSettings,type WorkerRuntimeInfo} from '../shared/worker-controls'
import {workspaceFiles} from './files'
import {remoteFiles} from './tunnel'
import {attachmentPaths,attachmentInfo} from '../shared/message-attachments'
import {withCaller} from './request-context'
import type {FileEndpoint} from './transfers'
import {openTerminal,readTerminal,inputTerminal,resizeTerminal} from './terminals'
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

type WorkerRecord=Omit<NativeWorker,'running'|'terminal'|'exitCode'|'busy'|'state'|'error'>&{sessionFile?:string;archives?:{id:string;createdAt:number;nativeSessionId?:string;title:string}[];resets?:{key:string;archive?:string}[]}&{createdBy?:PrincipalRef;clientRequestId?:string;requestFingerprint?:string}
const file=path.join(APP_HOME,'native-workers.json'),stopping=new Set<string>()
const records=()=>readJson<WorkerRecord[]>(file,()=>[],Array.isArray)
function owner(employee?:string){
 const principal=requestContext().principal,id=employee??(principal.kind==='agent'?principal.employeeId:undefined)
 if(!id)throw Error('请选择 Worker 的直属员工（employee）')
 if(!isAppAdministrator(principal)&&principal.kind==='agent'&&principal.employeeId!==id)throw Error('Forbidden: only directly owned Workers may be controlled')
 const store=readStore(),card=store.sessions.find(c=>c.id===id&&!c.deleting)
 if(!card)throw Error('Worker owner no longer exists')
 return {store,card}
}
function authorizeWorker(value:WorkerRecord){if(value.employee)owner(value.employee);else if(!isAppAdministrator(requestContext().principal))throw Error('Forbidden: only directly owned Workers may be controlled')}
let workerEmitter=(id?:string)=>emitCoreEvent({channel:'workers:changed',payload:{id}})
export function setWorkerEmitter(emit?:(id?:string)=>void){workerEmitter=emit??(id=>emitCoreEvent({channel:'workers:changed',payload:{id}}))}
function changed(id?:string){workerEmitter(id)}
function get(id:string){const value=records().find(w=>w.id===id);if(!value)throw Error('Unknown Worker');authorizeWorker(value);return value}

function present(value:WorkerRecord):NativeWorker{const {createdBy,clientRequestId,requestFingerprint,sessionFile,archives,resets,...worker}=value,entry=entries.get(value.id);return {...worker,running:!!entry?.runtime&&entry.runtime.connected?.()!==false&&!entry.closing,busy:!!entry?.current||!!entry?.background,state:entry?.runtime&&entry.runtime.connected?.()===false&&!entry.current?'stopped':entry?.state??'stopped',error:entry?.error,model:entry?.session.model??value.model,effort:entry?.effort??value.effort}}

function location(value:WorkerRecord){
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
export function workerEngines():NativeWorkerEngine[]{return Object.keys(ENGINE_DEFINITIONS).map(engine=>{const id=engine as NativeWorkerEngine['engine'],executable=engineExecutable(id,false),resolved=path.isAbsolute(executable)?executable:resolveBinary(executable);return {engine:id,label:ENGINE_DEFINITIONS[id].label,installed:path.isAbsolute(resolved)&&fs.existsSync(resolved)}})}
export function createWorker(args:{employee?:string;team?:string;engine:string;title?:string;cwd?:string;clientRequestId?:string}){
 if(!isEngine(args.engine))throw Error('Unsupported native Coding Agent engine')
 const principal=requestContext().principal
 const owned=args.employee||!isAppAdministrator(principal)||principal.kind==='agent'&&!args.cwd?owner(args.employee):undefined
 if(!owned&&!args.cwd?.trim())throw Error('Choose an existing Worker workspace')
 if(args.team!==undefined){if(!readStore().groups.includes(args.team))throw Error('Unknown Worker Team');if(!isAppAdministrator(principal)&&args.team!==owned?.card.group)throw Error('Forbidden: Worker Team must match its owner')}
 const effective=owned?executionEmployee(owned.store,owned.card):undefined
 if(effective?.remote&&!['codex','claude'].includes(args.engine))throw Error('This engine’s graphical Worker requires a Core-local folder; the host will not be changed.')
 const paths=effective?.remote?.os==='windows'?path.win32:effective?.remote?path.posix:path
 const value:WorkerRecord={id:randomUUID(),...(args.team?{team:args.team}:{}),...(owned?{employee:owned.card.id}:{}),title:args.title?.trim()||ENGINE_DEFINITIONS[args.engine].label+' Worker',engine:args.engine,cwd:paths.resolve(owned?.card.cwd??process.cwd(),args.cwd??'.'),host:effective?.remote?.host,createdAt:new Date().toISOString()}
 if(args.clientRequestId!==undefined){
  const key=args.clientRequestId;if(typeof key!=='string'||!key.trim()||key.length>160)throw Error('clientRequestId must be 1–160 characters')
  const fingerprint=createHash('sha256').update(JSON.stringify([value.employee??null,value.title,value.engine,value.cwd,value.host??null,...(value.team?[value.team]:[])])).digest('hex'),previous=records().find(worker=>worker.clientRequestId===key&&JSON.stringify(worker.createdBy)===JSON.stringify(principal))
  if(previous){authorizeWorker(previous);if(previous.requestFingerprint!==fingerprint)throw Error('clientRequestId already used with different Worker settings');return present(previous)}
  value.createdBy=principal;value.clientRequestId=key;value.requestFingerprint=fingerprint
 }
 location(value)
 atomicJson(file,[...records(),value]);changed();return present(value)
}
type History={usage?:unknown;revision?:number;items:Session['items'];receipts:WorkerReceipt[]}
type Entry={info:WorkerRuntimeInfo;session:Session;effort?:string;receipts:WorkerReceipt[];revision:number;state:WorkerState;background?:boolean;policy?:WorkerPermissionMode;error?:string;current?:WorkerReceipt;runtime?:WorkerRuntime;opening?:Promise<void>;pumping?:Promise<void>;controller?:AbortController;life:AbortController;children:ChildProcess[];closing:boolean;timer?:ReturnType<typeof setTimeout>;saveTimer?:ReturnType<typeof setTimeout>;closePromise?:Promise<void>}
const entries=new Map<string,Entry>(),historyFile=(id:string)=>path.join(APP_HOME,'worker-conversations',id+'.json')
function persist(id:string,entry:Entry){clearTimeout(entry.saveTimer);entry.saveTimer=undefined;const value=records().find(worker=>worker.id===id);atomicJson(historyFile(id),{revision:entry.revision,items:entry.session.items,receipts:entry.receipts,usage:entry.info.usage,...(value?{nativeSessionId:value.nativeSessionId,sessionFile:value.sessionFile,engine:value.engine,cwd:value.cwd,host:value.host,title:value.title,employee:value.employee,draft:value.draft}:{})},true)}
function update(id:string,entry:Entry,immediate=false){entry.revision++;if(immediate){persist(id,entry);changed(id)}else{if(!entry.timer)entry.timer=setTimeout(()=>{entry.timer=undefined;changed(id)},60);if(!entry.saveTimer)entry.saveTimer=setTimeout(()=>{try{persist(id,entry)}catch(error){entry.saveTimer=undefined;entry.error='Worker history could not be saved: '+(error as Error).message;entry.state='error';changed(id)}},1000)}}

function safeUpdate(id:string,entry:Entry,immediate=true){try{update(id,entry,immediate);return true}catch(error){entry.error='Worker history could not be saved: '+(error as Error).message;if(!entry.closing)entry.state='error';changed(id);return false}}

function hydrate(value:WorkerRecord){
 const existing=entries.get(value.id);if(existing)return existing
 const saved=readJson<History>(historyFile(value.id),()=>({items:[],receipts:[]})),interrupted=new Set(saved.receipts.filter(receipt=>['queued','running'].includes(receipt.state)).map(receipt=>receipt.id))
 const receipts=saved.receipts.map(receipt=>interrupted.has(receipt.id)?{...receipt,state:'interrupted' as const,error:'The previous Worker connection ended. This task was not replayed.'}:receipt)
 const items=saved.items.map(item=>item.role==='user'&&interrupted.has(item.id)?{...item,delivery:{state:'interrupted',error:'The previous connection ended. This task was not replayed.'}}:item.role==='assistant'?{...item,blocks:item.blocks.map(block=>block.kind==='tool'?{...block,running:false}:block.kind==='thinking'?{...block,done:true}:block)}:item)
 const session:Session={id:'worker:'+value.id,title:value.title,engine:value.engine,group:'',createdAt:Date.now(),items,commands:[],models:[],model:value.model,permissionMode:value.permissionMode??'default',thinking:false,thinkingSupported:false,busy:false}
 const entry:Entry={info:{usage:saved.usage},session,receipts,effort:value.effort,revision:(saved.revision??0)+1,state:'stopped',life:new AbortController(),children:[],closing:false};entries.set(value.id,entry);if(interrupted.size)persist(value.id,entry);return entry
}
export function workerSnapshot(id:string):WorkerSnapshot{
 const value=get(id),entry=hydrate(value),features={...(entry.info.features??workerFeatures(value.engine))},model=activeModel(entry.session.models,entry.session.model);if(model?.inputModalities)features.images=features.images&&model.inputModalities.includes('image');return {worker:present(value),features,commands:workerCommands(value.engine,features,entry.session.commands,entry.session.models,entry.session.model),configOptions:entry.info.configOptions??[],planMode:entry.info.planMode??value.planMode,thinking:entry.info.thinking??value.thinking,fastMode:entry.info.fastMode??value.fastMode,fastModeState:entry.info.fastModeState,fastModeDisabledReason:entry.info.fastModeDisabledReason,usage:entry.info.usage,configuration:{model:value.model,effort:value.effort,permissionMode:value.permissionMode??'default',planMode:value.planMode,thinking:value.thinking,fastMode:value.fastMode,nativeOptions:value.nativeOptions},requiresReconnect:!!entry.runtime&&entry.policy!==(value.permissionMode??'default'),items:entry.session.items,receipts:entry.receipts,models:entry.session.models,model:entry.session.model,effort:entry.effort,approvals:approvalsFor('worker:'+id),pendingMessages:entry.receipts.filter(receipt=>receipt.state==='queued').map(({id,text})=>({id,text})),currentMessageId:entry.current?.id,revision:entry.revision}
}
function nativeInfo(id:string,entry:Entry,info:WorkerRuntimeInfo){
 if(entry.closing||!entries.has(id))return
 entry.info={...entry.info,...info};if(info.commands)entry.session.commands=info.commands;
 if(info.models)entry.session.models=info.models;if(Object.hasOwn(info,'model'))entry.session.model=info.model;if(Object.hasOwn(info,'effort'))entry.effort=info.effort
 if(info.nativeSessionId||info.sessionFile)atomicJson(file,records().map(worker=>worker.id===id?{...worker,...(info.nativeSessionId?{nativeSessionId:info.nativeSessionId}:{}),...(info.sessionFile?{sessionFile:info.sessionFile}:{})}:worker))
 update(id,entry,true)
}
function delivery(entry:Entry,receipt:WorkerReceipt,state:WorkerReceipt['state'],error?:string){
 receipt.state=state;receipt.error=error;entry.session.items=entry.session.items.map(item=>item.id===receipt.id&&item.role==='user'?{...item,delivery:{state:state==='running'||state==='completed'?'accepted':state,error}}:item)
}
/** Core orchestration projection: the persisted owner and exact receipt must both match.
 * Not exposed as a Worker API and never used to grant an employee another owner's controls. */
export function ownedWorkerExecution(id:string,employee:string,clientMessageId:string){
 const value=records().find(worker=>worker.id===id&&worker.employee===employee)
 if(!value)throw Error('The engineering Worker was removed or its owner changed')
 const entry=hydrate(value),receipt=entry.receipts.find(receipt=>receipt.clientMessageId===clientMessageId),index=receipt?entry.session.items.findIndex(item=>item.id===receipt.id):-1
 let items=index<0?[]:entry.session.items.slice(index+1);const next=items.findIndex(item=>item.role==='user');if(next>=0)items=items.slice(0,next)
 return {worker:present(value),receipt:receipt?structuredClone(receipt):undefined,approvalCount:approvalsFor('worker:'+id).length,result:receipt?.state==='completed'?renderTranscript(items).slice(-64000):undefined}
}
/** Cancel one linked receipt, preserving unrelated queued work and all native history. */
export async function cancelOwnedWorkerExecution(id:string,employee:string,clientMessageId:string){
 const current=records().find(worker=>worker.id===id);if(!current)return // Removal already waits for its owned process tree.
 if(current.employee!==employee)throw Error('Engineering Worker ownership changed; no task was stopped')
 ownedWorkerExecution(id,employee,clientMessageId)
 const value=records().find(worker=>worker.id===id&&worker.employee===employee)!,entry=hydrate(value),receipt=entry.receipts.find(receipt=>receipt.clientMessageId===clientMessageId)
 if(!receipt||!['queued','running'].includes(receipt.state))return
 if(receipt.state==='queued'){delivery(entry,receipt,'interrupted','Engineering work was stopped or superseded');update(id,entry,true);return}
 if(entry.current?.id!==receipt.id)throw Error('The engineering Worker task changed; no other task was stopped')
 entry.controller?.abort();cancelApprovals('worker:'+id)
 const deadline=Date.now()+1000
 while(receipt.state==='running'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20))
 if(receipt.state==='running')await closeEntry(id,entry,true)
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
  for(const previous of listTerminals().filter(terminal=>terminal.worker===id&&terminal.purpose!=='shell'))await closeTerminal(previous.id)
  const effective=location(get(id));if(effective.accessMode==='isolated')throw Error('This Worker protocol does not support strict isolation; no unrestricted process was started.')
  const runtime=await openWorkerRuntime({id,engine:value.engine,cwd:effective.remote?.directory??effective.cwd,remote:effective.remote,directory:path.join(APP_HOME,'native-worker-profiles',id),nativeSessionId:value.nativeSessionId,sessionFile:value.sessionFile,model:value.model,effort:value.effort,planMode:value.planMode,thinking:value.thinking,fastMode:value.fastMode,nativeOptions:value.nativeOptions,permissionMode:value.permissionMode??'default',signal:entry.life.signal,turnSignal:()=>entry.controller?.signal??entry.life.signal,
   onProcess:child=>{entry.children.push(child);if(entry.closing)terminateTree(child)},changed:()=>safeUpdate(id,entry),info:info=>{try{nativeInfo(id,entry,info)}catch(error){entry.error='Worker history could not be saved: '+(error as Error).message;entry.state='error';entry.controller?.abort();changed(id)}},event:(event,format)=>{if(entry.closing||!entries.has(id))return;if(event.kind==='usage')entry.info.usage=event.usage;if(event.kind==='background-turn'){entry.background=event.busy;if(event.busy)entry.state='working';else{if(!entry.current)entry.state=entry.error?'error':'ready';pump(id,entry)}}entry.session=format==='claude'?apply(entry.session,event):applyAgent(entry.session,event);if(event.kind==='notice'&&event.level==='error'){entry.error=event.text;entry.state='error'}update(id,entry)}})
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
   try{const attachments=await workerAttachments(get(id),(receipt as WorkerReceipt&{images?:string[]}).images,(receipt as WorkerReceipt&{files?:string[]}).files);await entry.runtime.send([receipt.text,attachments.files.length?'[Attached files]\n'+attachments.files.map(file=>file.path).join('\n'):''].filter(Boolean).join('\n\n'),entry.controller.signal,attachments.images);if(entry.controller.signal.aborted)delivery(entry,receipt,'interrupted','Task interrupted');else if(entry.error)throw Error(entry.error);else delivery(entry,receipt,'completed')}
   catch(error){const interrupted=entry.controller.signal.aborted;delivery(entry,receipt,interrupted?'interrupted':'failed',(error as Error).message);if(!interrupted){entry.error=(error as Error).message;cancelQueue(entry,'A previous task failed. This task was not replayed.')}}
   finally{entry.current=undefined;entry.controller=undefined;cancelApprovals('worker:'+id);if(receipt.state!=='completed')finishBlocks(entry);if(!entry.closing)entry.state=entry.runtime?.connected?.()===false?'stopped':entry.error?'error':'ready';safeUpdate(id,entry)}
   if(entry.error)break
  }
 })().catch(error=>{entry.error=(error as Error).message;entry.state='error';cancelQueue(entry,'Worker history could not be saved. Queued tasks were cancelled.');changed(id)}).finally(()=>{entry.pumping=undefined})
}
export async function sendWorker(id:string,text:string,clientMessageId=randomUUID(),images?:string[],files?:string[],nativeCommand=false){
 const value=get(id),entry=hydrate(value)
 if(!nativeCommand&&/^\/[a-z][\w:-]*(?:\s|$)/i.test(text.trim())){if(images?.length||files?.length)throw Error('Run slash commands without attachments; your attachments were kept');return runWorkerCommand(id,text,clientMessageId)}
 if(typeof text!=='string'||!text.trim()&&!images?.length&&!files?.length||text.length>100000)throw Error('Worker task text must contain 1–100000 characters')
 if(typeof clientMessageId!=='string'||!clientMessageId.trim()||clientMessageId.length>160)throw Error('clientMessageId must contain 1–160 characters')
 const previous=entry.receipts.find(receipt=>receipt.clientMessageId===clientMessageId)
 if(previous){if(previous.text!==text||JSON.stringify((previous as any).images??[])!==JSON.stringify(images??[])||JSON.stringify((previous as any).files??[])!==JSON.stringify(files??[]))throw Error('clientMessageId was already used with different task text');return {accepted:!['failed','interrupted'].includes(previous.state),receipt:previous,duplicate:true}}
 location(value);const attachments=await workerAttachments(value,images,files);location(get(id));if(entries.get(id)!==entry)throw Error('Worker connection changed before accepting this task');const accepted=entry.receipts.find(receipt=>receipt.clientMessageId===clientMessageId);if(accepted){if(accepted.text!==text||JSON.stringify(accepted.images??[])!==JSON.stringify(images??[])||JSON.stringify(accepted.files??[])!==JSON.stringify(files??[]))throw Error('clientMessageId was already used with different task text');return {accepted:!['failed','interrupted'].includes(accepted.state),receipt:accepted,duplicate:true}}if(images?.length&&!workerSnapshot(id).features.images)throw Error('This native engine does not expose image input');if(entry.runtime&&entry.policy!==(value.permissionMode??'default'))throw Error('Reconnect the Worker to apply its changed permissions before sending new work.');if(entry.closing)throw Error('Worker is stopping');if(stopping.has(id))throw Error('Worker settings are being applied. Wait for the current operation.')
 const receipt:WorkerReceipt={id:randomUUID(),clientMessageId,text,...(images?.length?{images}:{}),...(files?.length?{files}:{}),createdAt:Date.now(),state:'queued'};entry.receipts.push(receipt);entry.session.items=[...entry.session.items,{role:'user',id:receipt.id,text,...(images?.length?{images}:{}),...(files?.length?{files:attachments.files}:{}),createdAt:receipt.createdAt,delivery:{state:'queued'}}];try{update(id,entry,true)}catch(error){entry.receipts=entry.receipts.filter(value=>value.id!==receipt.id);entry.session.items=entry.session.items.filter(item=>item.id!==receipt.id);throw error}
 // Accept durably before a potentially slow native handshake; never leave clicked text only in a transient editor.
 void startWorker(id).then(()=>pump(id,entry)).catch(error=>{if(entry.closing||entry.state==='stopped'||!entries.has(id)||!records().some(worker=>worker.id===id))return;for(const pending of entry.receipts)if(pending.state==='queued')delivery(entry,pending,'failed',(error as Error).message);entry.error=(error as Error).message;entry.state='error';update(id,entry,true)})
 return {accepted:true,receipt,duplicate:false}
}

export function dequeueWorker(id:string,messageId:string){const entry=hydrate(get(id)),receipt=entry.receipts.find(receipt=>receipt.id===messageId&&receipt.state==='queued');if(receipt)delivery(entry,receipt,'interrupted','Queued task cancelled');update(id,entry,true);return workerSnapshot(id)}
export function respondWorker(id:string,requestId:string,decision:string,answers?:{[key:string]:string|string[]},form?:{[key:string]:unknown}){const value=get(id);if(decision==='allow')location(value);return answerApproval('worker:'+id,requestId,decision==='allow',answers,form)}
export async function configureWorker(id:string,changes:WorkerSettings){
 validateApiArguments('worker.configure',{id,...changes})
 const value=get(id),entry=hydrate(value);location(value)
 if(stopping.has(id))throw Error('Worker settings are being applied. Wait for the current operation.')
 if(changes.permissionMode!==undefined&&!workerPermissionModes(value.engine).includes(changes.permissionMode))throw Error('This native engine does not expose that permission mode')
 if((changes.permissionMode!==undefined||changes.nativeOptions!==undefined)&&!isAppAdministrator(requestContext().principal))throw Error('Only the user or Secretary may change Worker permissions')
 if(entry.current||entry.background||entry.receipts.some(receipt=>receipt.state==='queued')||entry.opening||entry.closing||approvalsFor('worker:'+id).length)throw Error('Wait for the current Worker task before changing its settings')
 if(changes.nativeOptions){if(Object.keys(changes.nativeOptions).some(name=>['model','effort','reasoning_effort'].includes(name)))throw Error('Use the named model and effort controls');if(!entry.runtime)throw Error('Connect before changing native options');for(const [name,selected] of Object.entries(changes.nativeOptions)){const option=entry.info.configOptions?.find(option=>option.id===name);if(!option?.options.some(choice=>choice.value===selected))throw Error('Choose an option reported by this native engine')}}
 if(changes.model&&!entry.session.models.some(model=>model.value===changes.model))throw Error('Connect first and choose a model from this native engine’s catalog')
 const model=entry.session.models.find(model=>model.value===(changes.model||entry.session.model));if(changes.effort&&!model?.supportedEffortLevels?.includes(changes.effort))throw Error('This model does not support the selected reasoning effort')
 const features=entry.info.features??workerFeatures(value.engine);for(const [field,capability] of [['planMode','plan'],['thinking','thinking'],['fastMode','fast']] as const)if(changes[field]!==undefined&&!features[capability])throw Error('This native engine does not expose '+field);if(changes.fastMode&&!supportsFast(value.engine,model))throw Error('This native model does not advertise Fast mode');
 const previousNative:WorkerSettings={model:entry.session.model??'',effort:entry.effort??'',...(features.plan?{planMode:entry.info.planMode??false}:{}),...(features.thinking?{thinking:entry.info.thinking??true}:{}),...(features.fast?{fastMode:entry.info.fastMode??false}:{}),...(changes.nativeOptions?{nativeOptions:Object.fromEntries((entry.info.configOptions??[]).filter(option=>Object.hasOwn(changes.nativeOptions!,option.id)).map(option=>[option.id,option.currentValue]))}:{})},patch={...changes,...(changes.model!==undefined&&entry.info.fastMode&&!supportsFast(value.engine,model)?{fastMode:false}:{}),...(changes.nativeOptions?{nativeOptions:{...value.nativeOptions,...changes.nativeOptions}}:{}),...(changes.model!==undefined&&changes.model!==value.model?{effort:changes.effort??''}:{})}
 stopping.add(id)
 try{
  if(entry.runtime&&Object.keys(patch).some(key=>key!=='permissionMode')){if(!entry.runtime.configure)throw Error('This native connection cannot change its settings while connected');await entry.runtime.configure(patch)}
  const next={...get(id),...patch};if(changes.nativeOptions?.mode!==undefined)delete next.planMode;if(changes.planMode!==undefined&&next.nativeOptions){next.nativeOptions={...next.nativeOptions};delete next.nativeOptions.mode}if(!next.model)delete next.model;if(!next.effort)delete next.effort
  atomicJson(file,records().map(worker=>worker.id===id?next:worker));if(!entry.runtime){entry.session.model=next.model;entry.effort=next.effort;entry.info={...entry.info,planMode:next.planMode,thinking:next.thinking,fastMode:next.fastMode}}update(id,entry,true)
  return workerSnapshot(id)
 }catch(error){if(entry.runtime?.configure&&Object.keys(patch).some(key=>key!=='permissionMode'))try{await entry.runtime.configure(previousNative)}catch{};throw error}finally{stopping.delete(id)}
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
export function saveWorkerDraft(id:string,text:string,expectedRevision?:number,newAttempt=false,images?:string[],files?:string[]):NativeWorkerDraftResult{
 const value=get(id),current=value.draft??{text:'',revision:0}
 if(typeof text!=='string'||text.length>100000)throw Error('Worker draft text must be at most 100000 characters')
 if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw Error('expectedRevision must be a nonnegative integer')
 if(expectedRevision!==undefined&&expectedRevision!==current.revision)return {applied:false,draft:current}
 attachmentPaths(images);attachmentPaths(files);if((images?.length??0)+(files?.length??0)>16)throw Error('Choose at most 16 attachments');
 if(text===current.text&&JSON.stringify(images??[])===JSON.stringify(current.images??[])&&JSON.stringify(files??[])===JSON.stringify(current.files??[])&&!newAttempt)return {applied:true,draft:current}
 const draft={text,...(images?.length?{images}:{}),...(files?.length?{files}:{}),revision:current.revision+1};atomicJson(file,records().map(worker=>worker.id===id?{...worker,draft}:worker));changed();return {applied:true,draft}
}
export function resizeWorker(id:string,_cols:number,_rows:number){get(id);throw Error('Workers use graphical conversations and have no terminal to resize.')}
export async function stopWorker(id:string,remove=false){
 const value=get(id);if(stopping.has(id))throw Error('Worker is stopping. Wait for process termination to finish.')
 stopping.add(id)
 try{const entry=hydrate(value);await closeEntry(id,entry);for(const terminal of listTerminals().filter(terminal=>terminal.worker===id&&(remove||terminal.purpose!=='shell')))await closeTerminal(terminal.id);get(id);if(remove){atomicJson(file,records().filter(worker=>worker.id!==id));entries.delete(id)}changed(id);return remove?true:present(get(id))}finally{stopping.delete(id)}
}
/** Employee removal revokes its identity first; this internal path still closes every owned process. */
export async function removeEmployeeWorkers(employee:string){
 for(const value of records().filter(worker=>worker.employee===employee)){const entry=entries.get(value.id);if(entry)await closeEntry(value.id,entry);for(const terminal of listTerminals().filter(terminal=>terminal.worker===value.id))await closeTerminal(terminal.id);entries.delete(value.id)}
 atomicJson(file,records().filter(worker=>worker.employee!==employee));changed()
}
export async function closeWorkers(){const results=await Promise.allSettled([...entries].map(([id,entry])=>closeEntry(id,entry)));for(const result of results)if(result.status==='rejected')console.error('Worker shutdown:',(result.reason as Error).message)}

/** The exact same filesystem/transfer implementation as employee workspaces, with Worker ownership and host checks. */
export function workerFileEndpoint(id:string,filePath:string):FileEndpoint{
 const value=get(id),effective=location(value),context=requestContext(),root=effective.cwd,remote=effective.remote??undefined
 return {root,path:filePath||'.',remote,validate:()=>withCaller(context,()=>{const current=location(get(id));if(current.cwd!==root||JSON.stringify(current.remote??undefined)!==JSON.stringify(remote))throw Error('Worker workspace or execution host changed')})}
}
export async function workerFile(id:string,operation:string,args:Record<string,any>={}){
 const end=workerFileEndpoint(id,args.path??'.'),map:Record<string,string>={info:'copy-info',image:'read-image',chunk:'copy-read'},op=map[operation]??operation
 await end.validate?.(op,args)
 return end.remote?remoteFiles('worker-'+id,end.remote,op,{...args,path:end.path,length:262144}):workspaceFiles(end.root,op,{...args,path:end.path,length:262144})
}
async function workerAttachments(value:WorkerRecord,images?:string[],files?:string[]){
 const pictures=attachmentPaths(images),documents=attachmentPaths(files);if(pictures.length+documents.length>16)throw Error('Choose at most 16 attachments')
 const data=await Promise.all(pictures.map(async file=>{const image=await workerFile(value.id,'image',{path:file});return {path:file,data:image.data,mimeType:image.mimeType}}))
 const info=await Promise.all(documents.map(async file=>attachmentInfo(file,await workerFile(value.id,'info',{path:file}),'file')))
 return {images:data,files:info}
}
const idle=(id:string,entry:Entry)=>{if(stopping.has(id)||entry.current||entry.background||entry.opening||entry.closing||entry.receipts.some(receipt=>receipt.state==='queued')||approvalsFor('worker:'+id).length)throw Error('Wait for the current Worker task before changing its context')}
export async function inspectWorker(id:string,section:string){
 const value=get(id),entry=hydrate(value),snapshot=workerSnapshot(id)
 if(section==='capabilities')return {engine:value.engine,...snapshot.features,commands:snapshot.commands,configOptions:snapshot.configOptions}
 if(['account','mcp'].includes(section)&&!isAppAdministrator())throw Error('Only the user or Secretary may inspect native account and MCP configuration');
 if(section==='config')return {title:value.title,engine:value.engine,cwd:value.cwd,host:value.host,nativeSessionId:value.nativeSessionId,...snapshot.configuration,model:snapshot.model,effort:snapshot.effort,planMode:snapshot.planMode,thinking:snapshot.thinking,fastMode:snapshot.fastMode,busy:snapshot.worker.busy,requiresReconnect:snapshot.requiresReconnect,...(entry.runtime?.inspect&&isAppAdministrator()?{native:workerPublicData(await entry.runtime.inspect('config'))}:{})}
 if(!entry.runtime?.inspect)throw Error('Connect this Worker to read its native tools and settings')
 const result=workerPublicData(await entry.runtime.inspect(section));get(id);return section==='usage'?{...result,usage:entry.info.usage??result.usage??null}:result
}
export async function workerBackground(id:string,processId?:string,stop=false){const value=get(id),entry=hydrate(value);if(!entry.runtime)return {data:[]};if(!entry.runtime.background)throw Error('This native protocol does not expose background task control');if(stop)location(value);const result=await entry.runtime.background(processId,stop);get(id);return result}
export async function steerWorker(id:string,text:string,expectedMessageId:string){const value=get(id),entry=hydrate(value);location(value);if(!text.trim()||entry.current?.id!==expectedMessageId||entry.closing)throw Error('The Worker turn changed; review it before steering');if(!entry.runtime?.steer)throw Error('This native protocol does not support steering');await entry.runtime.steer(text);entry.session.items=[...entry.session.items,{role:'user',id:randomUUID(),text,createdAt:Date.now(),delivery:{state:'accepted'}}];update(id,entry,true);return {accepted:true,messageId:expectedMessageId}}
export function workerHistory(id:string,archive?:string){const value=get(id);if(!archive)return {archives:value.archives??[]};const record=value.archives?.find(record=>record.id===archive);if(!record)throw Error('Unknown Worker context archive');return {...record,...readJson<History>(path.join(APP_HOME,'worker-conversations',id+'-'+archive+'.json'),()=>{throw Error('Worker context archive is unavailable')})}}
export async function resetWorker(id:string,clientRequestId:string){
 const value=get(id),entry=hydrate(value),key=JSON.stringify([requestContext().principal,clientRequestId]);if(value.resets?.some(record=>record.key===key))return workerSnapshot(id);location(value);idle(id,entry);stopping.add(id)
 try{await closeEntry(id,entry);const current=get(id),archive=(entry.session.items.length||current.nativeSessionId||current.sessionFile)?{id:randomUUID(),createdAt:Date.now(),title:current.title,nativeSessionId:current.nativeSessionId}:undefined
  if(archive)atomicJson(path.join(APP_HOME,'worker-conversations',id+'-'+archive.id+'.json'),{items:entry.session.items,receipts:entry.receipts,nativeSessionId:current.nativeSessionId,sessionFile:current.sessionFile},true)
  atomicJson(file,records().map(record=>record.id===id?{...record,nativeSessionId:undefined,sessionFile:undefined,archives:[...(record.archives??[]),...(archive?[archive]:[])],resets:[...(record.resets??[]),{key,archive:archive?.id}]}:record))
  entry.session.items=[];entry.receipts=[];entry.info={...entry.info,nativeSessionId:undefined,sessionFile:undefined,usage:undefined};entry.error=undefined;entry.state='stopped';update(id,entry,true);return workerSnapshot(id)
 }finally{stopping.delete(id)}
}
export async function forkWorker(id:string,title:string,clientRequestId:string){
 const value=get(id),entry=hydrate(value),key='fork:'+createHash('sha256').update(id+':'+clientRequestId).digest('hex'),existing=records().find(record=>record.clientRequestId===key&&JSON.stringify(record.createdBy)===JSON.stringify(requestContext().principal));if(existing){if(existing.title!==title.trim())throw Error('Fork request ID already used with a different title');authorizeWorker(existing);return present(existing)}
 location(value);idle(id,entry);if(!entry.runtime?.fork)throw Error('Connect a native engine that supports context forking');stopping.add(id)
 try{const native=await entry.runtime.fork(title);location(get(id));const created=createWorker({employee:value.employee,engine:value.engine,cwd:value.cwd,title,clientRequestId:key});const original=get(id)
  atomicJson(file,records().map(record=>record.id===created.id?{...record,...native,model:original.model,effort:original.effort,permissionMode:original.permissionMode,planMode:original.planMode,thinking:original.thinking,fastMode:original.fastMode,nativeOptions:original.nativeOptions}:record))
  const copy=structuredClone(entry.session.items);atomicJson(historyFile(created.id),{revision:1,items:copy,receipts:[]},true);changed(created.id);return present(get(created.id))
 }finally{stopping.delete(id)}
}
export async function exportWorker(id:string,format='markdown',destination?:string){const value=get(id),entry=hydrate(value);if(!['markdown','json'].includes(format))throw Error('Choose Markdown or JSON');const content=format==='json'?JSON.stringify({worker:present(value),items:entry.session.items},null,2):'# '+value.title+'\n\n'+renderTranscript(entry.session.items);if(destination)await workerFile(id,'write',{path:destination,content,create:true});return {format,content,saved:!!destination}}
export async function workerTerminal(id:string,operation:string,args:Record<string,any>={}){
 const value=get(id);if(!isAppAdministrator())throw Error('Only the user or Secretary may use a Worker human shell');if(operation==='list')return listTerminals().filter(terminal=>terminal.worker===id&&terminal.purpose==='shell')
 if(operation==='open'&&(stopping.has(id)||entries.get(id)?.closing))throw Error('Worker is stopping. Wait for it to exit before opening a shell.');const current=operation==='open'||operation==='input'?location(value):undefined;if(operation==='open')return openTerminal({id:'worker:'+id,cwd:current!.cwd,remote:current!.remote},args.cols??100,args.rows??24,undefined,{worker:id,purpose:'shell'})
 const terminal=listTerminals().find(terminal=>terminal.id===args.terminal&&terminal.worker===id&&terminal.purpose==='shell');if(!terminal)throw Error('Terminal does not belong to this Worker')
 if(operation==='read')return readTerminal(terminal.id,args.cursor??0)
 if(operation==='input')return inputTerminal(terminal.id,args.data??'')
 if(operation==='resize')return resizeTerminal(terminal.id,args.cols,args.rows)
 if(operation==='close')return closeTerminal(terminal.id)
 throw Error('Unknown Worker terminal operation')
}
export async function runWorkerCommand(id:string,text:string,clientMessageId=randomUUID()):Promise<any>{
 const value=get(id),entry=hydrate(value),match=text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);if(!match)throw Error('A Worker command starts with /')
 const name=match[1],argument=match[2]?.trim()??'',catalog=workerSnapshot(id).commands,command=catalog.find(command=>command.name===name||command.aliases?.includes(name));if(!command)throw Error('This native Worker does not expose /'+name+'; use /help to see its real commands')
 if(argument&&['help','status','normal','skills','mcp','account','usage','config','ps','stop','history','export'].includes(command.name))throw Error('Use /'+command.name+' without arguments');
 if(command.name==='compact'&&value.engine==='codex'&&argument)throw Error('Use /compact without arguments');
 if(['compact','review'].includes(command.name)||entry.session.commands.some(native=>native.name===command.name)&&!['help','model','permissions','status','plan','normal','effort','fast','thinking','new','fork','skills','mcp','account','usage','config','ps','stop','export','history'].includes(command.name))return sendWorker(id,text,clientMessageId,undefined,undefined,true)
 let data:any,panel:string|undefined
 switch(command.name){
  case 'help':data={commands:catalog};break
  case 'status':data={worker:present(value),model:entry.session.model,effort:entry.effort,planMode:entry.info.planMode,fastMode:entry.info.fastMode,thinking:entry.info.thinking};break
  case 'model':if(!argument){panel='config';data={models:entry.session.models};break}{const [model,effort,...extra]=argument.split(/\s+/);if(extra.length)throw Error('Use /model MODEL [EFFORT]');data=await configureWorker(id,{model,...(effort?{effort}:{})});break}
  case 'permissions':if(argument)data=await configureWorker(id,{permissionMode:argument as any});else panel='config';break
  case 'effort':if(argument)data=await configureWorker(id,{effort:argument==='default'?'':argument});else panel='config';break
  case 'plan':data=await configureWorker(id,{planMode:true});if(argument)return sendWorker(id,argument,clientMessageId);break
  case 'normal':data=await configureWorker(id,{planMode:false});break
  case 'fast':case 'thinking':if(argument&&argument!=='status'){if(!['on','off'].includes(argument))throw Error('Use /'+command.name+' on|off|status');data=await configureWorker(id,{[command.name==='fast'?'fastMode':'thinking']:argument==='on'})}else{panel='config';data=workerSnapshot(id).configuration}break
  case 'skills':case 'mcp':case 'account':case 'usage':case 'config':panel=command.name;data=await inspectWorker(id,command.name);break
  case 'ps':panel='background';data=await workerBackground(id);break
  case 'stop':data=await workerBackground(id,undefined,true);break
  case 'new':if(argument)throw Error('Use /new without arguments');data=await resetWorker(id,clientMessageId);break
  case 'fork':if(!argument)throw Error('Use /fork TITLE');data=await forkWorker(id,argument,clientMessageId);break
  case 'export':panel='export';data=await exportWorker(id);break
  case 'history':panel='history';data=workerHistory(id);break
 }
 return {handled:true,command:command.name,panel,data}
}
export async function workerControlRequest(command:string,args:Record<string,any>){validateApiArguments(command,args);const id=args.id
 switch(command){
  case 'worker.commands':return workerSnapshot(id).commands.filter(command=>!args.filter||(command.name+' '+command.description).toLocaleLowerCase().includes(args.filter.toLocaleLowerCase()))
  case 'worker.command':return runWorkerCommand(id,args.text,args.clientMessageId)
  case 'worker.skill':{const catalog=await inspectWorker(id,'skills');if(!catalog.data?.some((skill:any)=>skill.name===args.name))throw Error('This native skill is not available in this Worker');const value=get(id);return sendWorker(id,(value.engine==='codex'?'$':'/')+args.name+(args.prompt?' '+args.prompt:''),args.clientMessageId,undefined,undefined,true)}
  case 'worker.inspect':return inspectWorker(id,args.section)
  case 'worker.background':return workerBackground(id)
  case 'worker.background-stop':return workerBackground(id,args.processId,true)
  case 'worker.steer':return steerWorker(id,args.text,args.expectedMessageId)
  case 'worker.reset':return resetWorker(id,args.clientRequestId)
  case 'worker.fork':return forkWorker(id,args.title,args.clientRequestId)
  case 'worker.history':return workerHistory(id,args.archive)
  case 'worker.export':return exportWorker(id,args.format,args.path)
  case 'worker.file':return workerFile(id,args.operation,{...args,id:args.trashId})
  case 'worker.terminal':return workerTerminal(id,args.operation,args)
 }
 throw Error('Unknown Worker control')
}
