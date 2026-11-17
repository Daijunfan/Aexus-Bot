import {workspacePdf} from './workspace-pdf'
import {catalog as groupStorageCatalog} from './chat-group-store'
import {readingFile,trackReadingWindow} from './file-snapshots'
import {storageFolderName} from '../shared/storage-folder'
import {WORKER_CONTROL_APIS} from '../shared/worker-controls'
import {workerControlRequest,workerFileEndpoint,workerFile} from './native-workers'
import {MESSAGE_STICKER_APIS} from '../shared/message-stickers'
import {stickerRequest} from './message-stickers'
import {requireGroupExport} from './group-history'
import {planPreferencesRequest} from './plan-preferences'
import {missionRequest,registerSecretaryRequest} from './missions'
import {engineeringRequest} from './engineering'
import {questionRequest,assertQuestionGate} from './chat-questions'
import {listConversationFiles,trashConversationFiles,restoreConversationFiles,sharedFileForReading} from './conversation-files'
import {API_REVISION,knownApi,validateApiArguments} from './api-contract'
import {readApiResult} from './api-results'
import {employeeActivity} from '../shared/activity'
import {protocolLines,protocolJson} from './protocol-lines'
import {monitorRequest} from './script-monitors'
import {botRequest,botDirectTarget,botDirectRequest,botFileEndpoint,botGroup} from './bot-workers'
import {hostRights,hostResources,hostAccess,grantCreatedHost} from './host-access'
import {pluginAccess,pluginScope,pluginAccessEntry,grantCreatedPluginResources} from './plugins/access'
import {pluginResourceRights} from '../shared/plugin-access'
import {isAppAdministrator} from './application-authority'
import {employeeReady} from '../shared/types'
import {directoryName} from '../shared/directory-names'
import {assetNaming} from './asset-naming'
import {assetInfo} from './asset-details'
import {assetPreview} from './asset-previews'
import {assetIndex} from './asset-index'
import {assetRequest,assetLocation,assetReference} from './assets'
import {socialIdentity} from './message-categories'
import {MESSAGE_COLLABORATION_APIS} from '../shared/message-collaboration'
import {messageCollaborationRequest} from './message-collaboration'
import {CONVERSATION_CONTROL_APIS} from '../shared/conversation-control-schema'
import {conversationControlRequest,reconcileConversationNotices} from './conversation-notices'
import {conversationWorkspaceRequest,conversationFileEndpoint,sharedFileIO} from './conversation-workspaces'
import {WORKSPACE_FILE_PREFIX} from '../shared/conversation-workspaces'
import { engineRequest } from './commands/engine'
import { chatRequest } from './commands/chat'
import { openMedia,mediaInfo,readMedia,closeMedia } from './media'
import { randomUUID,createHash } from 'node:crypto'
import { readChatMessages } from './chat-groups'
import { resolveMessageReply } from './transcripts'
import { forwardMessages,forwardStatus } from './message-forwarding'
import { withPrivateSendReceipt,lookupPrivateSendReceipt,type PrivateSendAttempt } from './private-send-receipts'
import {directHistory,postDirectMessage,prepareDirectInput,dispatchDirectInput,directDelivery,acknowledgeDirect,directFileEndpoint,directUploadDirectory,directUploadEndpoint,directFiles,directSearch,directStorage,directClear,directReply,directSummary,directSendKey} from './direct-messages'
import {DIRECT_ATTACHMENT_PREFIX,DIRECT_UPLOAD_PREFIX} from '../shared/direct-messages'
import { privateSendQueued,isSessionQueueing } from './sessions'
import { messengerRequest,resolveConversationReply } from './messenger'
import { channelOperation,channelRequest,channelFileEndpoint,getChannel } from './channels'
import { syncChannelIngress,channelIngressStatus } from './channel-ingress'
import { exportChannelPost } from './channel-export'
import { planRequest } from './plan'
import { APP_VIEWS,appView,VIEW_MUTATIONS } from '../shared/app-views'
import { listChatGroups,getChatGroup,groupMediaRoot } from './chat-groups'
import { assertEngineWorkspace } from '../shared/engines'
import { hostTerminals,openHostTerminal,requireHostTerminal,assertHostIdle,closeHostTerminals } from './host-connections'
import { isEngine } from '../shared/engines'
import { runtimeInfo } from './platform'
import { homedir } from 'node:os'
import { beginUpload,uploadChunk,commitUpload,abortUpload,downloadInfo,downloadChunk,saveDownload } from './uploads'
import { emitCoreEvent } from './core-events'
import {employeeProfile} from './employee-profile'
import {messageSourceView} from '../shared/message-source'
import { queueEmployeeInitialization,retryEmployeeInitialization,cancelEmployeeInitialization } from './initialization'
import { removeEmployeeWorkspace } from './employee-workspace-removal'
import { engineModels,defaultEmployeeModel } from './engine-models'
import { beginManagementInteraction,clearManagementInteraction,managementActivity,pruneManagementActivity } from './management-activity'
import { acknowledgeReply } from './reply-receipts'
import { pendingInitialization,assertEmployeeReady,assertInitializationRequest } from './initialization-state'
import { assertManagementKind,hasGlobalRole } from '../shared/management'
import { isManagementRole,isSupervisor,managementRoles } from '../shared/roles'
import { authenticate,initializeAccessChannel,agentCredential,revokeAgentCredential,removeAgentAccessData } from './agent-access'
import { authorize,requestContext,withCaller,isGlobal,canReadHostCredentials,canReadEmployee,callerEmployee,visibleEmployees,publicEmployee,callerIdentity,allowedCommands,apiDocumentation,delegationFor } from './authorization'
import { managementTopology,requestManagement,decideManagement,bindManagement,unbindManagement,setManagementRole,setGlobalManager,creationAuthority } from './management'
import type { RequestContext } from '../shared/management'
import { updateStore } from './store'
import { validateCloudHostPatch,cloudHostFingerprints,trustCloudHostFingerprint,queryCloudHosts,cloudHostSummary,cloudHostCredentials,getCloudHost,createCloudHost,updateCloudHost,removeCloudHost,cloudHostTarget,checkCloudHost } from './cloud-hosts'
import { openExternalUrl } from './external'
import { sharedDirectory } from './shared-directory'
import { resolveAvatar,randomAvatar,avatarDescription,employeeAppearance,professionValue } from '../shared/avatars'
import {activeAvatarIds,avatarCatalog,getAvatar,updateAvatar} from './avatar-catalog'
import { startTransfer,listTransfers,getTransfer,cancelTransfer,type FileEndpoint } from './transfers'
import type { FileLocation } from '../shared/transfers'
import { cloneEmployee } from './employees'
import { openPluginWindow,pluginWindows,placePluginWindow,modePluginWindow,dismissPluginWindow } from './plugins/windows'
import { scheduleRequest,reconcileSchedules } from './scheduler/service'
import { remoteTarget } from '../shared/remote'
import { executeRemote,checkRemote,remoteFiles,closeRemote,resolveEmployeeWorkspace,hostConnectionId } from './tunnel'
import { checkCloudNative,cloudNativeTarget,readCloudNativeSession } from './cloud-native'
import {createWorker,listWorkers,workerEngines,startWorker,readWorker,inputWorker,saveWorkerDraft,resizeWorker,stopWorker,removeEmployeeWorkers,workerSnapshot,sendWorker,dequeueWorker,respondWorker,configureWorker,interruptWorker} from './native-workers'
import {beforeChannelRequest,flushChannelContent,saveChannelContent,loadChannelAsset,loadChannelPost,loadChannelMessage} from './channel-content'
import { openTerminal,listTerminals,readTerminal,waitTerminalOutput,inputTerminal,resizeTerminal,closeTerminal,closeEmployeeTerminals } from './terminals'
// A unix-socket server so the whole app can be driven from a terminal. Every
// command maps onto the same operations the GUI uses, which is what makes
// headless testing meaningful: the CLI and the window share one code path.

import { getView,getMessagesView,setView } from './presentation'
import type { ViewState } from '../shared/view'
import { createServer,connect,type Server,type Socket } from 'node:net'
import { existsSync,unlinkSync,cpSync,renameSync,rmSync,chmodSync,realpathSync,statSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname,basename,isAbsolute,resolve,join } from 'node:path'
import { APP_HOME,SOCKET_PATH,type Request,type Response } from '../shared/protocol'
import {
revokeInvalidDelegations,assertEmployeeControl,beginEmployeeRemoval,endEmployeeRemoval,assertNotRemoving,
closeSession,
interrupt,
listLive,
sendMessage,
sessionCommands,
sessionInfo,
setEffort,
setFastMode,setRemoteAdmin,
setPlanMode,steerMessage,backgroundProcesses,enqueueMessage,queuedMessages,removeQueuedMessage,
setModel,
setPermissionMode,
setThinking,
startSession,
newSessionId,
type StartArgs
} from './sessions'
import { sessionSnapshot } from './sessions'
import { answerApproval,approvalsFor } from './approvals'
import {
getPreferences,setPreferences,
patchSession,
readStore,
removeSession,
writeStore
} from './store'
import { updateEmployee,employeeFields } from './store'
import { employeeSettings,nativeSessionRefs,canBindNativeSession,type StoredSession } from '../shared/types'
import { workspaceFiles } from './files'
import {revealWorkspaceFile} from './file-reveal'
import { centralizedWorkspacesRoot,employeeRoot,employeeWorkspace,executionEmployee,cloudDirectory,cloudRelative,workspaceStatus,localDirectory,chooseEmployeeWorkspace,defaultPluginWorkspace,legacyPluginWorkspace,inside } from './workspaces'
import { listPlugins,requirePlugin,installPlugin,pluginFile } from './plugins/registry'
import { pluginRuntime,callPlugin,openPluginView,closePluginView } from './plugins/runtime'
import { notebookAccess,notebookCall,notebookGuide,notebookMethods,notebookResources,notebookStatus,readMissionNotebookAsset } from './mission-notebook'
import { libraryOverview, librarySearch } from './library'
import { closeLibraryReaderSession, openLibraryReaderSession, readerAccess, readerCall, readerGuide, readerMethods, readerResources, readerStatus } from './library-reader'
import { provisionWorkspace,provisionEmployee,ensureEmployeeBootstrap } from './plugins/documents'
import { readFileSync,writeFileSync } from 'node:fs'
import { deleteNativeSessions,nativeRefsForRemoval } from './native-sessions'
import { transcriptItems,deleteTranscript,seedTranscript } from './transcripts'
import { renderTranscript } from '../shared/transcript'
import type { EffortLevel,PermissionMode } from '@anthropic-ai/claude-agent-sdk'

let beforeViewChange:(nextKind?:ViewState['kind'],nextMissionTab?:ViewState['missionTab'])=>Promise<void> = async () => {}
export function setViewGuard(guard: typeof beforeViewChange) { beforeViewChange = guard }
let server: Server | null = null
let ownsSocket = false
let askRenderer: (op: string, args?: Record<string, unknown>) => Promise<unknown> = async () => { throw new Error('no window is open') }
export function setUiHandler(handler: typeof askRenderer): void { askRenderer = handler }

/** Every connected client, so events can be fanned out. */
const clients = new Set<Socket>()

/** Subscribers that asked to follow a session; socket -> sessionId. */
const following = new Map<Socket, string>()
const followerContexts=new Map<Socket,RequestContext>()
const followerActivity=new Map<Socket,()=>void>()

/** Followers that want every engine event, not just the rendered transcript. */
const rawFollowers = new Set<Socket>()
let desktopEvent:(channel:string,payload:unknown)=>void=()=>{}
export function setDesktopEvent(handler:typeof desktopEvent){desktopEvent=handler}

/** Fan an event out to CLI clients. Wired from main's broadcast. */
export function publishEvent(channel: string, payload: unknown,clientId?:string): void {
  emitCoreEvent({channel,payload,clientId})
  if(!clientId||clientId==='desktop')desktopEvent(channel,payload)
  if(clientId&&clientId!=='desktop')return
  for (const [sock, sessionId] of following) {
    if (!sock.writable) continue
    const p = payload as { sessionId?: string }
    if (p?.sessionId && p.sessionId !== sessionId) continue
    const context=followerContexts.get(sock)!
    try{authorize('session.follow',{},employeeId(sessionId),context);assertEmployeeReady(employeeId(sessionId))}catch{sock.end(protocolJson({type:'done',error:'Access revoked'})+'\n');following.delete(sock);followerContexts.delete(sock);continue}
    if(!p?.sessionId&&context.principal.kind==='agent')continue
    // A raw follower gets every event verbatim; a normal one gets only the
    // channels needed to render a conversation.
    if (!rawFollowers.has(sock) && !RENDERED_CHANNELS.has(channel)) continue
    sock.write(protocolJson({ type: 'event', channel, payload }) + '\n')
    if (['session:turn-end', 'session:end', 'session:error', 'session:closed'].includes(channel)) {
      sock.end(protocolJson({ type: 'done' }) + '\n')
      following.delete(sock)
      followerContexts.delete(sock)
      rawFollowers.delete(sock)
    }
  }
}

/** The channels that make up a rendered conversation. */
const RENDERED_CHANNELS = new Set([
  'session:message',
  'session:codex',
  'session:agent',
  'session:turn-start',
  'session:turn-end',
  'session:end',
  'session:closed',
  'session:error'
])

function employeeId(value:unknown){const id=String(value??'');return readStore().sessions.some(card=>card.id===id)?id:sessionInfo(id)?.cardId}
function creationFingerprint(value:unknown):string{const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,stable(value)])):value;return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}
const navigationRequests=new Map<string,Promise<unknown>>()
export async function handleRequest(req:Request,context?:RequestContext&{signal?:AbortSignal}):Promise<any>{
  if(context)return withCaller(context,()=>handleRequest(req))
  if(!VIEW_MUTATIONS.has(req.cmd))return handleCurrentRequest(req)
  const caller=requestContext(),key=caller.clientId??'desktop',previous=navigationRequests.get(key)??Promise.resolve(),result=previous.catch(()=>{}).then(()=>{if(caller.signal?.aborted)throw Error('Request cancelled before navigation');return withCaller(caller,()=>handleCurrentRequest(req))})
  navigationRequests.set(key,result)
  try{return await result}finally{if(navigationRequests.get(key)===result)navigationRequests.delete(key)}
}
async function handleCurrentRequest(req:Request):Promise<any>{
  const caller=requestContext(),a={...(req.args??{})} as Record<string,any>
  for(const field of ['crossReply','chat','createdBy','requestedBy','approvedBy','delegation','access','managerTeam','globalManagerIds','globalGrants','deleting','initialization','lastReply'])if(field in a||a.patch&&field in a.patch||a.spec&&field in a.spec)throw Error('Internal field cannot be supplied: '+field)
  if(a.patch&&'managementRole' in a.patch||a.managementRole!==undefined&&req.cmd!=='card.create')throw Error('Use card.management-role to assign roles')
  if(['direct.files','direct.search','direct.storage'].includes(req.cmd)&&a.employee===undefined&&caller.principal.kind==='agent')a.employee=callerEmployee(caller.principal)!.id
  // Conversation members are not employee-control targets.
  let target=CONVERSATION_CONTROL_APIS.has(req.cmd)||MESSAGE_COLLABORATION_APIS.has(req.cmd)?undefined:employeeId(a.employee??a.cardId??a.id)
  if(['card.','session.','config.'].some(prefix=>req.cmd.startsWith(prefix))&&new Set([a.employee,a.cardId,a.id].filter(value=>value!==undefined).map(employeeId).filter(Boolean)).size>1)throw Error('Forbidden: conflicting employee identifiers')
  if(req.cmd.startsWith('card.'))target=employeeId(req.cmd==='card.rename'?a.cardId:a.id)
  if(req.cmd.startsWith('config.')||req.cmd.startsWith('commands.')||req.cmd.startsWith('approval.')||['engine.inspect','engine.skill'].includes(req.cmd))target=employeeId(a.id)
  if(req.cmd.startsWith('worker.'))target=undefined
  if(req.cmd.startsWith('engineering.'))target=undefined
  if(req.cmd.startsWith('terminal.')&&a.id){const terminal=listTerminals().find(terminal=>terminal.id===a.id);if(terminal?.worker)throw Error('Native Worker terminals require worker.* ownership checks');target=terminal?.employee}
  if(['view.tools','view.details'].includes(req.cmd))target=getView().employee
  if(req.cmd==='session.open')target=employeeId(a.cardId??a.employee??a.id)
  if(req.cmd==='card.remove'){
    const single='id',many='ids'
    if(a[many]!==undefined&&a[single]!==undefined)throw Error(`Provide ${single} or ${many}, not both`)
    const values=a[many]??[a[single]]
    if(!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'||!value.trim()))throw Error('Choose at least one valid deletion target')
    a[many]=[...new Set(values)]
    if(a.deleteWorkspace!==undefined&&typeof a.deleteWorkspace!=='boolean')throw Error('deleteWorkspace must be boolean')
    for(const value of a[many])authorize(req.cmd,{...a,[single]:value},value,caller)
    if(a.deleteWorkspace&&!isGlobal(caller.principal))throw Error('删除工作文件夹需要用户或全局管理授权；管理关系只允许移除员工')
  }else authorize(req.cmd,a,target,caller)
  assertInitializationRequest(req.cmd,target)
  if(req.cmd.startsWith('worker.'))validateApiArguments(req.cmd,a)
  if(req.cmd.startsWith('engineering.'))validateApiArguments(req.cmd,a)
  if(req.cmd.startsWith('mission.')||req.cmd.startsWith('question.')||['plan.preferences','plan.archive'].includes(req.cmd))validateApiArguments(req.cmd,a)
  assertQuestionGate(req.cmd,caller)
  if(req.cmd.startsWith('engineering.'))return engineeringRequest(req.cmd.slice(12),a,(cmd,args)=>handleRequest({cmd,args}))
  if(['plan.preferences','plan.archive'].includes(req.cmd))return planPreferencesRequest(req.cmd.slice(5),a)
  if(req.cmd.startsWith('mission.'))return missionRequest(req.cmd.slice(8),a)
  if(req.cmd.startsWith('question.'))return questionRequest(req.cmd.slice(9),a)
  if(req.cmd.startsWith('monitor.'))return monitorRequest(req.cmd,a)
  if(req.cmd.startsWith('bot.'))return botRequest(req.cmd,a)
  if(botDirectTarget(req.cmd,a)){
    if(req.cmd==='direct.send'&&a.replyTo&&a.replyConversation!==undefined){
      if(['employee:'+a.employee,'group:'+a.employee].includes(a.replyConversation)){delete a.replyConversation;delete a.replyTextOnly}
      else a.crossReply=resolveConversationReply(a.replyConversation,a.replyTo,a.replyQuote,a.replyTextOnly)
    }
    return botDirectRequest(req.cmd,a)
  }
  if(req.cmd==='direct.send'){
    for(const key of Object.keys(a))if(!['employee','text','images','files','mode','clientMessageId','replyTo','replyQuote','replyConversation','replyTextOnly','viewId'].includes(key))throw Error('Unknown direct.send field: '+key)
    if(!isAppAdministrator())throw Error('Only the user or Secretary may send private user input')
    if(!target)throw Error('Unknown employee conversation')
    if(caller.principal.kind==='agent'&&caller.principal.employeeId===target)throw Error('Use direct.post to reply to the user; direct.send dispatches work to another employee')
    const mode=a.mode??'enqueue';if(!['send','enqueue','steer'].includes(mode))throw Error('Unknown private delivery mode')
    const args:Record<string,any>={...a,sourceView:'messages',clientMessageId:a.clientMessageId??randomUUID()}
    const reply=a.replyTo?(a.replyConversation&&a.replyConversation!=='employee:'+target?resolveConversationReply(a.replyConversation,a.replyTo,a.replyQuote,a.replyTextOnly):directReply(target,a.replyTo,a.replyQuote)):undefined
    const entry=await prepareDirectInput(target,{...args,resolvedReply:reply,initialDeliveryState:mode==='enqueue'&&isSessionQueueing(target)?'queued':'preparing'})
    const work=async(attempt:PrivateSendAttempt)=>{
      const mission=await registerSecretaryRequest(target!,entry,caller)
      const workArgs=mission?{...args,text:String(args.text??'')+'\n\n[Aexus Mission]\n'+JSON.stringify({id:mission.id,registered:true})}:args
      const decorated:PrivateSendAttempt={directMessageId:entry.id,get queueId(){return attempt.queueId},queued:id=>{attempt.queued(id);directDelivery(target!,entry.id,'queued')},dispatching:id=>{attempt.dispatching(id);dispatchDirectInput(target!,entry.id,id)},accepted:id=>{attempt.accepted(id);directDelivery(target!,entry.id,'accepted')},failed:error=>{attempt.failed(error);directDelivery(target!,entry.id,'failed',String((error as Error)?.message??error))},interrupted:reason=>{attempt.interrupted(reason);directDelivery(target!,entry.id,'interrupted',reason)}}
      return handleAuthorizedRequest({cmd:mode==='enqueue'?'session.enqueue':'session.send'}, {...workArgs,id:undefined,employee:target,...(reply?{crossReply:reply}:{}),replyConversation:undefined},target,caller,decorated)
    }
    if(mode==='steer'){
      if(a.images?.length||a.files?.length)throw Error('Queue attachments instead of steering them')
      if(entry.delivery?.state==='accepted')return {sent:true,directMessageId:entry.id}
      try{const opened=await startSession({cardId:target});const sent=await steerMessage(opened.sessionId,String(a.text??''),'messages',entry.id);directDelivery(target,entry.id,'accepted');return {sent,directMessageId:entry.id}}catch(error){directDelivery(target,entry.id,'failed',String((error as Error).message));throw error}
    }
    try{const receipt=await withPrivateSendReceipt(target,{...args,clientMessageId:directSendKey(args.clientMessageId)},work,privateSendQueued,true);directDelivery(target,entry.id,receipt.status);return {...receipt,clientMessageId:args.clientMessageId,directMessageId:entry.id}}
    catch(error){directDelivery(target,entry.id,'failed',String((error as Error).message));throw error}
  }
  if(['session.send','session.enqueue','session.steer'].includes(req.cmd))a.sourceView=messageSourceView(a.sourceView)
  if((req.cmd==='session.send'||req.cmd==='session.enqueue')&&a.clientMessageId!==undefined){
    if(!target)throw Error('Unknown employee conversation')
    return withPrivateSendReceipt(target,a,attempt=>handleAuthorizedRequest(req,a,target,caller,attempt),privateSendQueued)
  }
  return handleAuthorizedRequest(req,a,target,caller)
}
async function handleAuthorizedRequest(req:Request,a:Record<string,any>,target:string|undefined,caller:RequestContext,privateSend?:PrivateSendAttempt){
  if(req.cmd==='direct.send-status'){if(!isAppAdministrator())throw Error('Only the user or Secretary may inspect native private input');if(typeof a.employee!=='string'||typeof a.clientMessageId!=='string')throw Error('Provide employee and clientMessageId');return lookupPrivateSendReceipt(a.employee,directSendKey(a.clientMessageId),privateSendQueued)}
  if(req.cmd==='direct.post')return postDirectMessage(a)
  if(req.cmd==='direct.history')return directHistory(a as any)
  if(req.cmd==='direct.acknowledge')return acknowledgeDirect(a as any)
  if(req.cmd==='direct.files')return directFiles(a)
  if(req.cmd==='direct.search')return directSearch(a)
  if(req.cmd==='direct.storage')return directStorage(a)
  if(req.cmd==='direct.clear')return directClear(a)
  if(['session.send','session.enqueue','chat.send','chat.post'].includes(req.cmd)&&a.replyConversation!==undefined){
    const destination=req.cmd.startsWith('session.')?'employee:'+target:'group:'+a.id
    if(a.replyConversation!==destination){
      if(!isAppAdministrator(caller.principal))throw Error('Only the user or Secretary may quote another conversation')
      if(a.replyConversation.startsWith('channel:')){if(String(a.replyTo).startsWith('np_'))await loadChannelPost(a.replyTo);else if(String(a.replyTo).startsWith('cm_'))await loadChannelMessage(a.replyConversation.slice(8),a.replyTo)}
      const previous=req.cmd.startsWith('chat.')&&typeof a.clientMessageId==='string'?readChatMessages(a.id).find(message=>message.author.kind==='operator'&&message.clientMessageId===a.clientMessageId):undefined
      const savedReply=previous?.reply
      a.crossReply=savedReply&&savedReply.conversation===a.replyConversation&&savedReply.id===a.replyTo?savedReply:resolveConversationReply(a.replyConversation,a.replyTo,a.replyQuote,a.replyTextOnly)
    }
    else {delete a.replyConversation;delete a.replyTextOnly}
  }
  if((req.cmd==='session.send'||req.cmd==='session.enqueue')&&(a.replyTo!==undefined||a.replyQuote!==undefined)){
    if(!target)throw Error('Unknown reply conversation')
    if(!a.crossReply)resolveMessageReply(target,a.replyTo,a.replyQuote)
    if(typeof a.text==='string'&&a.text.startsWith('/'))throw Error('Replies require a regular message, not a slash command')
  }
  const finishInteraction=beginManagementInteraction(req.cmd,target,caller)
  try{
  if(a.employee&&req.cmd.startsWith('session.')){
    if(req.cmd==='session.open')a.cardId=a.employee
    const live=listLive().find(item=>sessionInfo(item.id)?.cardId===a.employee)
    a.id=live?.id??a.employee
    if(['session.send','session.enqueue','session.steer','session.open'].includes(req.cmd)&&!live){const opened=await startSession({cardId:a.employee,delegation:delegationFor(a.employee,caller)});authorize(req.cmd,a,target,caller);a.id=opened.sessionId}
  }
  if(req.cmd==='session.send'||req.cmd==='session.enqueue')a.delegation=delegationFor(target??employeeId(a.id)!,caller)
  let result=await dispatchRequest({...req,args:a},privateSend)
  if(result?.sessions){const {employeeCreations,...value}=result;result=value}
  if(caller.principal.kind==='operator')return result
  if(req.cmd==='session.search')return result.filter((card:StoredSession)=>canReadEmployee(caller.principal,card.id))
  if(req.cmd==='session.list'&&isGlobal(caller.principal)){const ids=new Set(visibleEmployees(caller.principal).map(card=>card.id));return a.live?result.filter((item:any)=>ids.has(item.cardId)):{...result,sessions:result.sessions.filter((item:StoredSession)=>ids.has(item.id))}}
  if(result?.sessions&&isGlobal(caller.principal))return {...result,sessions:result.sessions.filter((card:StoredSession)=>canReadEmployee(caller.principal,card.id))}
  if(isGlobal(caller.principal))return result
  if(req.cmd==='session.list'){
    const ids=new Set(visibleEmployees(caller.principal).map(card=>card.id))
    return a.live?result.filter((item:any)=>ids.has(item.cardId)).map((item:any)=>({id:item.id,cardId:item.cardId,title:item.title,busy:item.busy,currentTask:item.currentTask,initialization:item.initialization})): {sessions:visibleEmployees(caller.principal).map(publicEmployee)}
  }
  if(result?.sessions)return {sessions:visibleEmployees(caller.principal).map(publicEmployee)}
  return result
  }finally{finishInteraction()}
}
async function dispatchRequest(req: Request,privateSend?:PrivateSendAttempt): Promise<any> {
  const a = (req.args ?? {}) as Record<string, any>
  if(WORKER_CONTROL_APIS.has(req.cmd)&&req.cmd!=='worker.upload-begin')return workerControlRequest(req.cmd,a)
  if(MESSAGE_STICKER_APIS.has(req.cmd))return stickerRequest(req.cmd,a)
  if(['transfer.download-info','transfer.download-save','transfer.download-chunk','transfer.start'].includes(req.cmd)){const ref=a.from;if(ref?.group)requireGroupExport('group:'+ref.group);else if(ref?.conversation)requireGroupExport(ref.conversation)}
  const s = (v: unknown) => String(v)

  if(MESSAGE_COLLABORATION_APIS.has(req.cmd)){if(typeof a.conversation==='string'&&a.conversation.startsWith('channel:')){const entry=String(a.id??a.entryId);if(entry.startsWith('np_'))await loadChannelPost(entry);else if(entry.startsWith('cm_'))await loadChannelMessage(a.conversation.slice(8),entry);}return messageCollaborationRequest(req.cmd,a,fileEndpoint)}
  if(req.cmd.startsWith('channel.')&&['channel.image','channel.export'].includes(req.cmd))await beforeChannelRequest(req.cmd,a)
  if(req.cmd.startsWith('channel.')&&!['channel.settings','channel.image','channel.export'].includes(req.cmd)){const result=await channelOperation(req.cmd,a);if(['channel.save','channel.delete'].includes(req.cmd))await saveChannelContent(String(a.id));if(['channel.publish','channel.media-put','channel.source-avatar-put','channel.message-send','channel.message-post'].includes(req.cmd))await flushChannelContent();return result}
  if(CONVERSATION_CONTROL_APIS.has(req.cmd))return conversationControlRequest(req.cmd,a)
  if(req.cmd==='conversation.file-open'){
    const source=await sharedFileForReading(a);await beforeViewChange();await source.validate()
    const local=await readingFile(source.end,a.conversation,source.version);await source.validate()
    const reader=await openLibraryReaderSession({workspace:local.root,path:local.path})
    trackReadingWindow(reader.id,local.root)
    await source.validate()
    const previous=getView()
    const returnTo=previous.kind==='messages'
      ?{kind:'messages' as const,employee:previous.employee,...(previous.chatId?{chatId:previous.chatId}:{}),...(previous.channelId?{channelId:previous.channelId,...(previous.sourceId?{sourceId:previous.sourceId}:{})}:{})}
      :previous.kind==='plan'
        ?{kind:'plan' as const,planViewId:previous.planViewId,missionTab:previous.missionTab}
        :previous.returnTo
    setView({kind:'library',librarySection:'reader',readerWorkspace:local.root,readerDocumentId:reader.document?.id,...(returnTo?{returnTo}:{})})
    return {reader,document:reader.document,source:{conversation:a.conversation,path:a.path,version:source.version}}
  }
  if(req.cmd==='conversation.files')return listConversationFiles(a)
  if(req.cmd==='conversation.file-trash')return trashConversationFiles(a)
  if(req.cmd==='conversation.file-restore')return restoreConversationFiles(a)
  if(req.cmd.startsWith('conversation.'))return conversationWorkspaceRequest(req.cmd,a,fileEndpoint)
  if(req.cmd.startsWith('engine.'))return engineRequest(req.cmd,a)
  if(req.cmd.startsWith('chat.'))return chatRequest(req.cmd,a)
  switch (req.cmd) {
    case 'messenger.media-open': {if(typeof a.conversation!=='string'||!/^(employee|group|channel):[a-zA-Z0-9_-]+$/.test(a.conversation)||typeof a.path!=='string'||!a.path)throw Error('Choose a conversation media file');const [kind,id]=a.conversation.split(':');return openMedia(()=>fileEndpoint({...(kind==='group'?{group:id}:kind==='channel'?{channel:id}:{employee:id}),path:a.path},false))}
    case 'channel.image': {const file=channelFileEndpoint({channelId:s(a.channelId),postId:a.postId,mediaId:a.mediaId}),asset=await loadChannelAsset(s(a.mediaId),a.maxEdge);return {data:asset.data.toString('base64'),mimeType:asset.mimeType,name:file.name}}
    case 'channel.export': return exportChannelPost(s(a.id))
    case 'channel.settings': {const settings=await channelRequest(req.cmd,a);await syncChannelIngress().catch(()=>{});return {...settings,runtime:channelIngressStatus()}}
    case 'messenger.media-info':return mediaInfo(s(a.id))
    case 'messenger.media-read':return readMedia(s(a.id),Number(a.offset))
    case 'messenger.media-close':return closeMedia(s(a.id))
    case 'messenger.forward':return forwardMessages(a,(cmd,args)=>handleRequest({cmd,args}))
    case 'messenger.forward-status':return forwardStatus(a)
    case 'messenger.profile':case 'messenger.profile-image':case 'messenger.directory':case 'messenger.social':case 'messenger.forward-draft':case 'messenger.gallery':case 'messenger.reference':case 'messenger.state':case 'messenger.reorder':case 'messenger.folder-save':case 'messenger.folder-delete':case 'messenger.conversation':case 'messenger.message':case 'messenger.draft':case 'messenger.search':return messengerRequest(req.cmd,a)
    case 'system.info': return {...runtimeInfo(),clientId:requestContext().clientId,clock:{unixMs:Date.now(),iso:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}}
    case 'system.directories': {
      const directory=realpathSync(a.path?resolve(s(a.path)):homedir())
      if(!statSync(directory).isDirectory())throw Error('请选择后端主机上的文件夹')
      const {readdirSync}=await import('node:fs')
      return {path:directory,parent:dirname(directory),entries:readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')).map(entry=>({name:entry.name,path:resolve(directory,entry.name)})).sort((x,y)=>x.name.localeCompare(y.name))}
    }
    case 'messenger.upload-begin': {
      validateApiArguments(req.cmd,a)
      const conv=s(a.conversation)
      if(conv.startsWith('employee:')&&a.scope!=='work'&&!botGroup(conv.slice(9))){
        const to=directUploadDirectory(conv.slice(9)),end={root:to.root,path:'.',referencePrefix:to.referencePrefix}
        const upload=await beginUpload({conversation:conv,path:to.referencePrefix},end,s(a.name),Number(a.bytes),true)
        return {...upload,path:to.referencePrefix+'/'+upload.name}
      }
      const to=await attachmentDirectory(conv),end=fileEndpoint(to,true);if(to.conversation)end.referencePrefix=WORKSPACE_FILE_PREFIX.slice(0,-1);const upload=await beginUpload(to,end,s(a.name),Number(a.bytes),!!to.conversation);return {...upload,path:to.conversation?WORKSPACE_FILE_PREFIX+upload.name:to.path+'/'+upload.name}
    }
    case 'transfer.download-save': {let path=a.path,overwrite=a.overwrite===true;if(path===undefined){const source=fileEndpoint(a.from,false),selected=await askRenderer('save-file',{name:source.name??basename(s(a.from?.path))}) as {path:string|null};path=selected.path;overwrite=true;if(!path)return {saved:false}}return saveDownload(fileEndpoint(a.from,false),s(path),overwrite)}
    case 'transfer.upload-begin': return beginUpload(a.to,fileEndpoint(a.to,true),s(a.name),Number(a.bytes))
    case 'transfer.upload-chunk': return uploadChunk(s(a.id),Number(a.offset),s(a.data))
    case 'transfer.upload-commit': return commitUpload(s(a.id))
    case 'transfer.upload-abort': return abortUpload(s(a.id))
    case 'transfer.download-info': return downloadInfo(fileEndpoint(a.from,false))
    case 'transfer.download-chunk': return downloadChunk(fileEndpoint(a.from,false),Number(a.offset),a.modifiedAt)

    case 'auth.whoami': return callerIdentity()
    case 'auth.agent-token': return agentCredential(s(a.id))
    case 'auth.revoke': {const result=revokeAgentCredential(s(a.id));clearManagementInteraction(s(a.id));pruneManagementActivity();revokeInvalidDelegations();reconcileSchedules();reconcileConversationNotices();publishEvent('access:changed',{});return result}
    case 'api.list': {
      validateApiArguments('api.list',a)
      const commands=allowedCommands(requestContext(),readStore(),a.all).filter(command=>(!a.prefix||command.name.startsWith(a.prefix))&&(!a.search||[command.name,command.summary,command.gui].join(' ').toLowerCase().includes(a.search.toLowerCase())))
      if(!a.compact){if(a.offset!==undefined||a.limit!==undefined)throw Error('API pagination requires compact=true');return commands}
      const offset=a.offset??0,limit=a.limit??40,selected=commands.slice(offset,offset+limit)
      return {apiRevision:API_REVISION,total:commands.length,offset,nextOffset:offset+selected.length<commands.length?offset+selected.length:null,commands:selected.map(({name,summary,readOnly,permission})=>({name,summary,readOnly,permission}))}
    }
    case 'api.describe': {validateApiArguments('api.describe',a);knownApi(a.command);const command=allowedCommands(requestContext(),readStore(),a.all).find(value=>value.name===a.command);if(!command)throw Error('API not available to this caller: '+a.command);return {...command,apiRevision:API_REVISION}}
    case 'api.docs': return {...apiDocumentation(requestContext(),readStore(),a.document),apiRevision:API_REVISION}
    case 'api.result': validateApiArguments('api.result',a);return readApiResult(requestContext(),a)
    case 'avatar.list': return avatarCatalog(a)
    case 'avatar.get': return getAvatar(s(a.id))
    case 'avatar.update': return updateAvatar({id:s(a.id),enabled:a.enabled,expectedRevision:a.expectedRevision})
    case 'session.acknowledge': return acknowledgeReply(s(a.employee??employeeId(a.id)),a.replyId)
    case 'management.topology': return managementTopology(a.creator)
    case 'management.activity': return managementActivity()
    case 'management.roles': return managementRoles()
    case 'management.request': return requestManagement(s(a.employee),a.manager)
    case 'management.decide': return decideManagement(s(a.id),s(a.decision))
    case 'management.bind': return bindManagement(a)
    case 'management.unbind': return unbindManagement(a)
    case 'management.global': if(typeof a.enabled!=='boolean')throw Error('enabled must be boolean');return setGlobalManager(s(a.id),a.enabled)
    case 'card.initialize': return retryEmployeeInitialization(s(a.id),{model:a.model,effort:a.effort})
    case 'card.management-role': return setManagementRole(s(a.id),a.role)
    case 'card.access-mode': {const card=readStore().sessions.find(c=>c.id===a.id);if(card&&(card.threadId||card.claudeSessionId)&&card.accessMode!==a.mode)throw Error('Execution isolation is fixed once native history exists; create a new employee');if(!['trusted','isolated'].includes(a.mode))throw Error('Use trusted or isolated');await closeForNativeChange(s(a.id));return updateStore(store=>{const card=store.sessions.find(c=>c.id===a.id);if(!card)throw Error('Unknown employee');card.accessMode=a.mode})}
    case 'card.profile': return employeeProfile(a)
    case 'session.status': {const cards=a.employee?readStore().sessions.filter(c=>c.id===a.employee):visibleEmployees();return cards.map(card=>{const live=listLive().find(item=>sessionInfo(item.id)?.cardId===card.id),state=live?sessionInfo(live.id):undefined;return {...publicEmployee(card),lastReply:card.lastReply,sessionId:live?.id,busy:state?.busy??false,acknowledging:state?.acknowledging??false,currentTask:state?.currentTask,activityPreview:state?.activityPreview,waitingApproval:live?approvalsFor(live.id).length>0:false}})}
    case 'shared.info': return {path:sharedDirectory()}
    case 'transfer.start': return startTransfer(a.from,a.to,fileEndpoint(a.from,false),fileEndpoint(a.to,true))
    case 'transfer.list': return listTransfers()
    case 'transfer.get': return getTransfer(s(a.id))
    case 'transfer.cancel': return cancelTransfer(s(a.id))
    case 'view.shared': return setView({...getView(),shared:!!a.enabled})
    case 'host.fingerprints': return (await cloudHostFingerprints(s(a.id))).map(({line,...key})=>key)
    case 'host.trust': {assertHostIdle(s(a.id));return handleRequest({cmd:'host.update',args:{id:a.id,patch:{knownHosts:await trustCloudHostFingerprint(s(a.id),s(a.fingerprint))}}})}
    case 'host.terminal-open': return openHostTerminal(s(a.id),a.directory,a.cols,a.rows)
    case 'host.terminal-list': return hostTerminals(s(a.id))
    case 'host.terminal-read': {const output=await waitTerminalOutput(requireHostTerminal(s(a.id),s(a.terminal)),Number(a.cursor??0),Number(a.waitMs??0),requestContext().signal);authorize(req.cmd,a);return output}
    case 'host.terminal-input': return inputTerminal(requireHostTerminal(s(a.id),s(a.terminal)),s(a.data??''))
    case 'host.terminal-resize': return resizeTerminal(requireHostTerminal(s(a.id),s(a.terminal)),Number(a.cols),Number(a.rows))
    case 'host.terminal-close': return closeTerminal(requireHostTerminal(s(a.id),s(a.terminal)))
    case 'host.exec': return executeRemote(cloudHostTarget(s(a.id),a.directory),s(a.command),a.timeout===undefined?120:Number(a.timeout))
    case 'host.list': {
      return queryCloudHosts(a).filter(host=>hostRights(host.id).read).map(host=>{
        const allowed=canReadHostCredentials(host.id)
        if(a.credentials&&allowed)return {...host,credentials:cloudHostCredentials(host.id,isAppAdministrator())}
        return {...(allowed&&!a.summary?host:cloudHostSummary(host)),access:hostRights(host.id)}
      })
    }
    case 'host.resources': return hostResources()
    case 'host.access': return hostAccess(a as any)
    case 'host.files': {
      const target=cloudHostTarget(s(a.id),a.directory===undefined?undefined:s(a.directory))
      const op=s(a.operation)
      const opMap:Record<string,string>={image:'read-image',info:'copy-info',chunk:'copy-read'}
      const params={path:s(a.path||'.'),...(a.to!==undefined?{to:s(a.to)}:{}),...(a.content!==undefined?{content:s(a.content)}:{}),...(a.hash!==undefined?{hash:s(a.hash)}:{}),...(a.create!==undefined?{create:!!a.create}:{}),...(a.hidden!==undefined?{hidden:!!a.hidden}:{}),...(a.offset!==undefined?{offset:Number(a.offset)}:{}),...(a.trashId!==undefined?{id:s(a.trashId)}:{}),length:262144}
      return remoteFiles('host-files-'+s(a.id),target,opMap[op]??op,params)
    }
    case 'host.get': return getCloudHost(s(a.id))
    case 'host.credentials': return cloudHostCredentials(s(a.id),isAppAdministrator()&&a.files!==false)
    case 'host.create': {const host=createCloudHost(a);const caller=requestContext().principal;if(caller.kind==='agent'&&!isAppAdministrator(caller))grantCreatedHost(caller.employeeId,host.id);writeStore(readStore());publishEvent('hosts:changed',{});return host}
    case 'host.update': {
      assertHostIdle(s(a.id))
      const store=readStore(),bound=store.sessions.filter(card=>!card.deleting&&employeeSettings(store,card).hostId===a.id)
      const candidate=validateCloudHostPatch(s(a.id),a.patch??{})
      if(bound.some(card=>card.kind==='cloud-native-worker')){
        const previous=getCloudHost(s(a.id))
        if(['host','os','port','identityFile','sshConfig','jump'].some(key=>JSON.stringify((previous as any)[key]??null)!==JSON.stringify((candidate as any)[key]??null)))throw new Error('Cloud Native Worker 正在使用此主机；不能把原生会话改绑到另一台主机')
      }
      for(const card of bound)remoteTarget({...candidate,directory:employeeSettings(store,card).directory})
      for(const card of bound)await closeForWorkspaceChange(card.id)
      const host=updateCloudHost(s(a.id),a.patch??{})
      for(const group of groupStorageCatalog().groups.filter(group=>group.storage?.hostId===a.id))closeRemote('group-files-'+group.id)
      closeRemote(hostConnectionId(s(a.id)))
      writeStore(readStore());publishEvent('hosts:changed',{});return host
    }
    case 'host.remove': {
      const storedGroups=groupStorageCatalog().groups.filter(group=>group.storage?.hostId===a.id);if(storedGroups.length)throw Error('Cloud host stores group files: '+storedGroups.map(group=>group.name).join(', '))
      const store=readStore(),bound=store.sessions.filter(card=>!card.deleting&&employeeSettings(store,card).hostId===a.id)
      if(bound.length)throw new Error('云主机仍被员工绑定：'+bound.map(card=>card.title).join('、'))
      assertHostIdle(s(a.id));await closeHostTerminals(s(a.id))
      const result=removeCloudHost(s(a.id));closeRemote('host-'+s(a.id));closeRemote(hostConnectionId(s(a.id)));publishEvent('hosts:changed',{});return result
    }
    case 'host.check': {
      const id=s(a.id),status=await checkCloudHost(id)
      publishEvent('host:health',{id,status});return status
    }
    case 'host.directories': {
      const target=cloudHostTarget(s(a.id),a.path),result=await remoteFiles('host-'+s(a.id),target,'list',{path:'.'})
      return {path:result.root,entries:result.entries.filter((entry:any)=>entry.directory)}
    }

    case 'schedule.schema': case 'schedule.status': case 'schedule.list': case 'schedule.get': case 'schedule.create':
    case 'schedule.update': case 'schedule.pause': case 'schedule.resume': case 'schedule.delete':
    case 'schedule.preview': case 'schedule.run': case 'schedule.history': case 'schedule.cancel': case 'schedule.trigger':
      return scheduleRequest(req.cmd.slice('schedule.'.length), a)
    case 'plan.schema':case 'plan.query':case 'plan.calendar':case 'plan.timeline':case 'plan.analytics':case 'plan.feed':case 'plan.views':case 'plan.view-create':case 'plan.view-update':case 'plan.view-delete':return planRequest(req.cmd.slice(5),a)
    case 'settings.get': return getPreferences()
    case 'settings.set': return setPreferences(a) // Includes pageZoom and pane sizes; usable without a desktop.

    case 'view.list': return {views:APP_VIEWS,current:getView(),shared:{employees:'session.list',conversations:'session.transcript',inbox:'session.inbox',readReceipts:'session.acknowledge',groups:'chat.list',bindings:'management.topology',schedules:'schedule.list',plans:'plan.query',planViews:'plan.views'}}
    case 'view.navigation': {
      validateApiArguments(req.cmd,a);const view=getView(),section=s(a.section);if(section!=='plan'||view.kind!=='plan')throw Error('Open the matching primary view before expanding its navigation');return view
    }
    case 'view.select': {
      validateApiArguments(req.cmd,a)
      const mode=appView(a.id);if(!mode)throw Error('Unknown application view')
      if(a.toggleNavigation&&a.missionTab!==undefined)throw Error('Primary activation cannot set a child view')
      const current=getView()
      if(a.missionTab!==undefined&&(mode.id!=='plan'||a.missionTab!=='plan'))throw Error('Mission opens its layouts directly; child destinations were removed')
      if(mode.id==='plan'&&current.kind==='plan')return current
      if(mode.id==='library'&&current.kind==='library')return current
      const nextMissionTab='plan';await beforeViewChange(mode.id,mode.id==='plan'?nextMissionTab:undefined)
      if(mode.id==='messages'){
        const saved={...getMessagesView(),shared:getView().shared}
        try{
          if(saved.employee&&!readStore().sessions.some(card=>card.id===saved.employee&&!card.deleting&&employeeReady(card)))return setView({kind:'messages'})
          if(saved.chatId)getChatGroup(saved.chatId)
          if(saved.sourceId)saved.channelId=socialIdentity('source:'+saved.sourceId).channelId
          if(saved.channelId){saved.channelId=getChannel(saved.channelId).id;if(['youtube','x','telegram'].includes(getChannel(saved.channelId).kind))delete saved.sourceId}
          return setView(saved)
        }catch{return setView({kind:'messages'})}
      }
      if(mode.id==='library')return setView({kind:'library',librarySection:current.librarySection??'reader'})
      return setView({kind:mode.kind,...(mode.id==='plan'?{missionTab:nextMissionTab}:{} )})
    }
    case 'view.get': return getView()
    case 'view.open': {
      const kind=a.kind as ViewState['kind'],store=readStore()
      if(!['library','employee','conversation','initialization','settings','plugin','clone','messages','plan'].includes(kind))throw new Error('Unknown view kind')
      if(a.librarySection!==undefined&&(kind!=='library'||!['overview','files','search','reader','hosts'].includes(a.librarySection)))throw Error('Choose overview, files, search, reader or hosts for Library')
      if(a.missionTab!==undefined&&(kind!=='plan'||a.missionTab!=='plan'))throw Error('Mission opens its layouts directly; child destinations were removed')
      if(a.planViewId!==undefined&&a.missionTab!==undefined&&a.missionTab!=='plan')throw Error('Database views belong to Mission / Plan')
      if(a.planViewId!==undefined&&(kind!=='plan'||!((await planRequest('views',{})) as Array<{id:string}>).some((view:any)=>view.id===a.planViewId)))throw Error('Unknown Plan view')
      if([a.employee,a.chatId,a.channelId].filter(value=>value!==undefined).length>1)throw Error('Choose one conversation')
      if(a.chatId!==undefined){if(kind!=='messages')throw Error('Group conversations belong to Messages');getChatGroup(a.chatId)}
      if(a.sourceId!==undefined){if(kind!=='messages'||a.employee!==undefined||a.chatId!==undefined)throw Error('Social elements belong to Messages');const source=socialIdentity('source:'+a.sourceId);if(a.channelId!==undefined&&a.channelId!==source.channelId)throw Error('Social element belongs to another channel');a.channelId=source.channelId;if(['youtube','x','telegram'].includes(source.platform))delete a.sourceId}
      if(a.channelId!==undefined){if(kind!=='messages')throw Error('News channels belong to Messages');a.channelId=getChannel(a.channelId).id}
      if((kind==='conversation'||kind==='clone'||a.employee)&&!store.sessions.some(c=>c.id===a.employee))throw new Error('Unknown employee')
      if(a.employee&&kind!=='initialization'&&!(kind==='employee'&&store.sessions.find(card=>card.id===a.employee)?.initialization?.status==='failed'))assertEmployeeReady(s(a.employee))
      const pluginId=a.pluginId??((kind==='settings'||kind==='employee'||kind==='clone')?getView().pluginId:undefined)
      if(kind==='plugin'||pluginId)requirePlugin(s(pluginId))
      if(kind==='conversation'&&pluginId){const card=store.sessions.find(c=>c.id===a.employee)!;if(card.pluginId!==pluginId)throw new Error('员工不属于当前插件')}
      await beforeViewChange(kind,kind==='plan'?(a.planViewId?'plan':a.missionTab??getView().missionTab??'plan'):undefined)
      if(kind==='plugin'){await openPluginWindow(s(pluginId),pluginWorkspace({id:pluginId}));return setView({kind:'plugin',pluginId})}
      const previous=getView()
      const returnTo=!['library','messages','plugin','plan'].includes(kind)?(previous.kind==='library'?{kind:'library' as const,librarySection:previous.librarySection}:previous.kind==='plan'?{kind:'plan' as const,planViewId:previous.planViewId,missionTab:previous.missionTab}:previous.kind==='messages'?{kind:'messages' as const,employee:previous.employee,...(previous.chatId?{chatId:previous.chatId}:{}),...(previous.channelId?{channelId:previous.channelId,...(previous.sourceId?{sourceId:previous.sourceId}:{})}:{})}:previous.returnTo):undefined
      return setView({kind,...(kind==='library'?{librarySection:a.librarySection??previous.librarySection??'reader',...(a.readerWorkspace!==undefined?{readerWorkspace:a.readerWorkspace}:{}),...(a.readerDocumentId!==undefined?{readerDocumentId:a.readerDocumentId}:{}),...(a.libraryHostId!==undefined?{libraryHostId:a.libraryHostId}:{}),...(a.libraryQuery!==undefined?{libraryQuery:a.libraryQuery}:{})}:{}),name:a.name,employee:a.employee,chatId:a.chatId,channelId:a.channelId,sourceId:a.sourceId,...(a.planViewId!==undefined?{planViewId:a.planViewId}:{}),...(kind==='plan'?{missionTab:a.planViewId?'plan':a.missionTab??previous.missionTab??'plan'}:{}),settings:a.settings,pluginId,details:!!a.details,shared:previous.shared,returnTo})
    }
    case 'view.close': {
      await beforeViewChange()
      const view=getView(),back=view.returnTo
      if(back?.kind==='library')return setView({kind:'library',librarySection:back.librarySection??'reader'})
      if(back?.kind==='plan')return setView({kind:'plan',planViewId:back.planViewId,missionTab:back.missionTab??'plan'})
      if(back){let channelId:string|undefined;if(back.channelId){try{channelId=getChannel(back.channelId).id}catch{}};return setView({kind:'messages',employee:readStore().sessions.some(card=>card.id===back.employee&&!card.deleting)?back.employee:undefined,...(back.chatId&&listChatGroups().some(group=>group.id===back.chatId)?{chatId:back.chatId}:{}),...(channelId?{channelId,...(back.sourceId&&!['youtube','x','telegram'].includes(getChannel(channelId).kind)?{sourceId:back.sourceId}:{})}:{})})}
      return setView({kind:'messages',...(view.pluginId?{pluginId:view.pluginId}:{})})
    }
    case 'view.tools': {
      const view=getView();if(!['conversation','messages'].includes(view.kind)||!view.employee)throw new Error('Open a conversation first')
      if(a.section&&!['skills','mcp','account','usage','config','export','background'].includes(a.section))throw new Error('Unknown engine section')
      await beforeViewChange();return setView({...view,...(view.kind==='messages'&&a.section?{kind:'conversation' as const,returnTo:{kind:'messages' as const,employee:view.employee}}:{}),tools:a.section||undefined})
    }
    case 'view.details': {
      await beforeViewChange()
      const view=getView()
      if(!['conversation','messages'].includes(view.kind)||!view.employee)throw new Error('Open a conversation first')
      return setView({...view,details:!!a.enabled})
    }
    case 'assets.naming':
      return assetNaming(a,async(ids)=>{if(listTransfers().some(job=>['queued','running'].includes(job.state)))throw Error('Finish active file transfers before migrating directories');for(const live of listLive()){const info=sessionInfo(live.id);if(info&&ids.includes(info.cardId!)&&info.busy)throw Error('员工正在工作，请等待空闲再迁移目录')}for(const id of ids)await closeForWorkspaceChange(id)},async(mount,operation,args)=>{const end=fileEndpoint({...mount.scope,path:'.'},false);if(!end.remote)throw Error('Expected a remote workspace');return remoteFiles('asset-naming-'+mount.id,end.remote,operation,args)})
    case 'assets.info':return assetInfo(s(a.id),(cmd,args)=>handleRequest({cmd,args}),fileEndpoint)
    case 'assets.preview':return assetPreview(s(a.id),(cmd,args)=>handleRequest({cmd,args}),fileEndpoint)
    case 'assets.browse':case 'assets.tree':case 'assets.children':case 'assets.search':case 'assets.locate':case 'assets.file':
      if(req.cmd==='assets.file'){const ref=assetReference(s(a.id),a.path);a.id=ref.asset;a.path=ref.path}
      if(req.cmd==='assets.file'&&String(a.id).startsWith('published:')&&!(String(a.id).startsWith('published:channel:')&&a.operation==='list')){if(!['list','read','image','info','chunk'].includes(a.operation))throw Error('Published attachments are read-only; copy them to a workspace to edit');const end=fileEndpoint(assetLocation(s(a.id),s(a.path||'.')),false),op=({image:'read-image',info:'copy-info',chunk:'copy-read'} as Record<string,string>)[a.operation]??a.operation;return workspaceFiles(end.root,op,{path:end.path,offset:a.offset??0,length:262144,hidden:a.hidden})}
      if(req.cmd==='assets.file'&&['info','chunk'].includes(a.operation)){const end=fileEndpoint(assetLocation(s(a.id),s(a.path||'.')),false),op=a.operation==='info'?'copy-info':'copy-read',args={path:end.path,offset:a.offset??0,length:262144};await end.validate?.(op,args);return sharedFileIO(end,op,args)}
      return assetRequest(req.cmd,a,(cmd,args)=>handleRequest({cmd,args}),async(ref,args)=>{const end=fileEndpoint(ref,false);if(!end.remote)throw Error('Remote inventory requires a remote workspace');return remoteFiles('asset-index-'+String(ref.employee??ref.conversation),end.remote,'inventory',args)})
    case 'workspace.reveal': return revealWorkspaceFile(fileEndpoint(a.from,false))
    case 'workspace.suggest': {
      if(a.hostId){
        const hostId=s(a.hostId),remoteBase=a.remoteDir??a.directory??a.path
        const targetHost=cloudHostTarget(hostId,remoteBase)
        if(a.directoryMode==='bind')return {path:a.path??a.remoteDir??a.directory??targetHost.directory}
        const name=a.folderName?.trim()?storageFolderName(s(a.folderName)):directoryName(s(a.title||'employee'),'employee')
        return {path:cloudDirectory({mode:'cloud',hostId,directory:targetHost.directory,remote:targetHost},name)}
      }
      return {path:chooseEmployeeWorkspace(readStore(),s(a.title||a.folderName||'employee'),a.folderName,a.path??a.cwd,a.directoryMode,undefined,true)}
    }
    case 'workspace.choose':
      return askRenderer('choose-folder',{path:a.path})
    case 'remote.check': {
      const employee=a.employee?readStore().sessions.find(c=>c.id===a.employee):undefined
      if(a.employee&&!employee)throw new Error('Unknown employee')
      return checkRemote(employee?executionEmployee(readStore(),employee).remote:a.hostId?cloudHostTarget(s(a.hostId),a.remoteDir??a.directory):a.remote)
    }
    case 'worker.upload-begin': {if(!isAppAdministrator())throw Error('Only the user or Secretary may upload client files');validateApiArguments(req.cmd,a);const directory='.agents-attachments';if(!(await workerFile(s(a.id),'info',{path:directory})).exists)await workerFile(s(a.id),'mkdir',{path:directory});return beginUpload({worker:s(a.id),path:directory},workerFileEndpoint(s(a.id),directory),s(a.name),Number(a.bytes),true)}
    case 'worker.create': return createWorker({employee:a.employee,engine:s(a.engine),title:a.title,cwd:a.cwd,clientRequestId:a.clientRequestId})
    case 'worker.list': return listWorkers(a.employee)
    case 'worker.engines': return workerEngines()
    case 'worker.snapshot': return workerSnapshot(s(a.id))
    case 'worker.send': return sendWorker(s(a.id),s(a.text),a.clientMessageId,a.images,a.files)
    case 'worker.dequeue': return dequeueWorker(s(a.id),s(a.messageId))
    case 'worker.respond': return respondWorker(s(a.id),s(a.requestId),s(a.decision),a.answers,a.form)
    case 'worker.configure': {validateApiArguments(req.cmd,a);const {id,...changes}=a;return configureWorker(s(id),changes)}
    case 'worker.start': return startWorker(s(a.id),a.cols,a.rows)
    case 'worker.read': return readWorker(s(a.id),Number(a.cursor??0),Number(a.waitMs??0))
    case 'worker.input': return inputWorker(s(a.id),s(a.data??''),a.terminal)
    case 'worker.draft': return saveWorkerDraft(s(a.id),a.text,a.expectedRevision,a.newAttempt===true,a.images,a.files)
    case 'worker.resize': return resizeWorker(s(a.id),Number(a.cols),Number(a.rows))
    case 'worker.interrupt': return interruptWorker(s(a.id),a.expectedMessageId)
    case 'worker.stop': return stopWorker(s(a.id))
    case 'worker.remove': return stopWorker(s(a.id),true)
    case 'terminal.open': {
      const store=readStore(),card=store.sessions.find(c=>c.id===a.employee)
      if(!card)throw new Error('Unknown employee')
      assertNotRemoving(card.id)
      employeeWorkspace(store,card.cwd,card.id)
      return openTerminal(executionEmployee(store,card),Number(a.cols??100),Number(a.rows??24))
    }
    case 'terminal.list': return listTerminals(a.employee).filter(terminal=>!terminal.worker&&canReadEmployee(requestContext().principal,terminal.employee))
    case 'terminal.read': return readTerminal(s(a.id),Number(a.cursor??0))
    case 'terminal.input': return inputTerminal(s(a.id),s(a.data??''))
    case 'terminal.resize': return resizeTerminal(s(a.id),Number(a.cols),Number(a.rows))
    case 'terminal.close': return closeTerminal(s(a.id))
    case 'workspace.pdf': return workspacePdf(a,fileEndpoint)
    case 'workspace.image':case 'workspace.list':case 'workspace.read':case 'workspace.write':case 'workspace.mkdir':case 'workspace.move':case 'workspace.trash':case 'workspace.restore': {
      if(a.employee&&(String(a.path).startsWith(DIRECT_ATTACHMENT_PREFIX)||String(a.path).startsWith(DIRECT_UPLOAD_PREFIX))){
        const isUpload=String(a.path).startsWith(DIRECT_UPLOAD_PREFIX)
        const operation=req.cmd==='workspace.image'?'read-image':req.cmd==='workspace.read'?'read':undefined
        if(!operation)throw Error('Published private attachments are read-only')
        const end=isUpload?directUploadEndpoint(a.employee,a.path):directFileEndpoint(a.employee,a.path);await end.validate?.(operation,{path:end.path})
        return end.remote?remoteFiles('direct-image-'+a.employee,end.remote,operation,{path:end.path}):workspaceFiles(end.root,operation,{path:end.path})
      }
      if(a.shared){if(a.employee)throw Error('共享文件夹不能同时指定员工');return workspaceFiles(sharedDirectory(),req.cmd==='workspace.image'?'read-image':req.cmd.split('.')[1],a)}
      const store=readStore(),saved=a.employee?store.sessions.find(c=>c.id===a.employee):undefined,card=saved?executionEmployee(store,saved):undefined
      if(card?.remote)return remoteFiles(card.id,card.remote,req.cmd==='workspace.image'?'read-image':req.cmd.split('.')[1],a)
      return workspaceFiles(workspaceContext(a).root,req.cmd==='workspace.image'?'read-image':req.cmd.split('.')[1],a)
    }
    case 'plugin.list':
      return listPlugins()
    case 'plugin.describe': {
      const plugin=requirePlugin(s(a.id))
      return {...plugin,api:JSON.parse(readFileSync(pluginFile(plugin.directory,plugin.schema),'utf8')),documentation:readFileSync(pluginFile(plugin.directory,plugin.documentation),'utf8')}
    }
    case 'plugin.install': {
      const plugin=installPlugin(s(a.path))
      return {plugin,workspaces:[]}
    }
    case 'workspace.docs':
      {const context=workspaceContext(a);return a.employee?ensureEmployeeBootstrap(context.store.sessions.find(c=>c.id===a.employee)!,context.store):context.settings.mode==='cloud'?{mode:'cloud',workspace:context.root,documentation:apiDocumentation().catalogRoot}:provisionWorkspace(context.root,context.settings)}
    case 'plugin.access':case 'plugin.resources': {
      const root=pluginWorkspace(a),caller=requestContext().principal
      if(req.cmd==='plugin.resources'&&!isAppAdministrator(caller)&&caller.kind==='agent'&&!pluginScope(s(a.id),root,caller.employeeId).grants.some(g=>g.read||g.write||g.create))return {plugin:s(a.id),workspace:root,revision:pluginAccessEntry(s(a.id),root).revision,resources:[]}
      const {runtime}=await pluginRuntime(s(a.id),root)
      if(!runtime.resources)throw Error('This plugin has no content authorization catalog')
      const resources=await runtime.resources()
      if(req.cmd==='plugin.access')return pluginAccess(s(a.id),root,resources,a)
      const principal=requestContext().principal,scope=principal.kind==='agent'?pluginScope(s(a.id),root,principal.employeeId):undefined
      return {plugin:s(a.id),workspace:root,revision:pluginAccessEntry(s(a.id),root).revision,resources:resources.flatMap(resource=>{const rights=isAppAdministrator()?{read:true,write:true,create:true}:((resource as any).rights??pluginResourceRights(scope!,resources,resource.id));return rights.read||rights.write||rights.create?[{...resource,rights}]:[]})}
    }
    case 'plugin.call':
      return callPlugin(s(a.id),pluginWorkspace(a),s(a.method),a.params??{},a.raw===true)
    case 'plugin.open': {
      await beforeViewChange()
      const window=await openPluginWindow(s(a.id),pluginWorkspace(a))
      setView({kind:'plugin',pluginId:s(a.id)})
      return window
    }
    case 'plugin.windows': return pluginWindows()
    case 'plugin.place': return placePluginWindow(s(a.id),a.bounds??{})
    case 'plugin.mode': return modePluginWindow(s(a.id),a.mode)
    case 'plugin.dismiss': return dismissPluginWindow(s(a.id))
    case 'plugin.view':
      {const root=pluginWorkspace(a);if(a.employee){const context=workspaceContext(a);provisionWorkspace(root,context.settings)}return openPluginView(s(a.id),root)}
    case 'plugin.close':
      return pluginWindows().some(window=>window.id===a.viewId)?dismissPluginWindow(s(a.viewId)):closePluginView(s(a.viewId))
    case 'library.overview': return libraryOverview()
    case 'library.search': return librarySearch(a as any)
    case 'reader.status': return readerStatus(a.workspace===undefined?undefined:s(a.workspace))
    case 'reader.guide': return readerGuide(a.topic===undefined?undefined:s(a.topic))
    case 'reader.methods': return readerMethods(a.query===undefined?undefined:s(a.query))
    case 'reader.resources': return readerResources(a.workspace===undefined?undefined:s(a.workspace))
    case 'reader.access': return readerAccess(a as any)
    case 'reader.call': return readerCall(s(a.method),a.params??{},{workspace:a.workspace===undefined?undefined:s(a.workspace),origin:a.origin===undefined?undefined:s(a.origin),includeEnvelope:a.includeEnvelope===true,stateMode:a.stateMode as any})
    case 'reader.open': return openLibraryReaderSession({workspace:a.workspace===undefined?undefined:s(a.workspace),path:a.path===undefined?undefined:s(a.path),documentId:a.documentId===undefined?undefined:s(a.documentId),studySetId:a.studySetId===undefined?undefined:s(a.studySetId),importToLibrary:a.importToLibrary===true})
    case 'reader.close': return closeLibraryReaderSession(s(a.id))
    case 'notebook.status': return notebookStatus()
    case 'notebook.guide': return notebookGuide(a.topic===undefined?undefined:s(a.topic))
    case 'notebook.methods': return notebookMethods(a.query===undefined?undefined:s(a.query))
    case 'notebook.resources': return notebookResources()
    case 'notebook.access': return notebookAccess(a as any)
    case 'notebook.call': return notebookCall(s(a.method),a.params??{},{raw:a.includeEnvelope===true,stateMode:a.stateMode as any})
    case 'notebook.asset': {
      const asset=await readMissionNotebookAsset(s(a.path))
      return {mimeType:asset.mimeType,bytes:asset.bytes.length,contentBase64:asset.bytes.toString('base64')}
    }
    case 'status':
      return {
        running: true,
        home: APP_HOME,
        workspacesRoot: centralizedWorkspacesRoot(readStore()),
        live: listLive().length,
        stored: readStore().sessions.length
      }

    case 'session.list': {
      if(a.live){const store=readStore();return listLive().map(s=>sessionSnapshot(s.id,!!a.summary,store))}
      const store=readStore()
      return {...store,sessions:store.sessions.map(c=>workspaceStatus(store,c))}
    }

    case 'session.inbox': {
      return visibleEmployees().map(card=>{
        try{return {...directSummary(card.id),employeeId:card.id}}
        catch{return {employeeId:card.id,text:'',role:null,updatedAt:null,hasMessages:false,unread:false,error:'History unavailable'}}
      })
    }
    case 'session.new': return startSession(a as StartArgs)

    case 'session.open': {
      return startSession({ cardId: s(a.cardId),delegation:delegationFor(s(a.cardId)) })
    }

    case 'session.activity': {
      validateApiArguments('session.activity',a)
      const id=employeeId(a.id),card=readStore().sessions.find(card=>card.id===id)
      if(!card)throw Error('Unknown employee/session; read session.status and use employee or id')
      const live=listLive().find(item=>sessionInfo(item.id)?.cardId===card.id)
      return employeeActivity(card,live?sessionSnapshot(live.id):undefined)
    }
    case 'session.snapshot': return sessionSnapshot(s(a.id))
    case 'approval.list':
      return approvalsFor(s(a.id))
    case 'approval.respond':
      if (!['allow', 'deny'].includes(a.decision)) throw new Error('Decision must be allow or deny')
      return { answered: answerApproval(s(a.id), s(a.requestId), a.decision === 'allow',a.answers,a.form) }
    case 'session.search': {
      const q = s(a.query ?? '').toLowerCase()
      return readStore().sessions.filter((card) =>
        [card.title, card.engine, card.cwd,card.remote?.directory,card.remote?.host].some((v) => v?.toLowerCase().includes(q)))
    }

    case 'external.open': return openExternalUrl(s(a.url))
    case 'session.steer': return {sent:await steerMessage(s(a.id),s(a.text),a.sourceView)}
    case 'session.background': return backgroundProcesses(s(a.id))
    case 'session.background-stop': return backgroundProcesses(s(a.id),a.processId,true)
    case 'session.review': {
      const modes=[a.base,a.commit,a.instructions].filter(v=>v!==undefined);if(modes.length>1)throw new Error('Choose only one review target')
      if(sessionInfo(s(a.id))?.engine!=='codex')throw new Error('Claude 审查请使用其命令列表中的 code-review 或 review')
      const suffix=a.base?' --base '+s(a.base):a.commit?' --commit '+s(a.commit):a.instructions?' '+s(a.instructions):''
      return {sent:await sendMessage(s(a.id),'/review'+suffix)}
    }
    case 'session.enqueue': return enqueueMessage(s(a.id),s(a.text??''),a.images,a.delegation,undefined,a.replyTo,a.replyQuote,a.crossReply,a.files,privateSend,a.sourceView)
    case 'session.queue': return queuedMessages(s(a.id))
    case 'session.dequeue': return removeQueuedMessage(s(a.id),s(a.messageId))
    case 'session.export': {
      const id=s(a.id),card=readStore().sessions.find(c=>c.id===id)??readStore().sessions.find(c=>c.id===sessionSnapshot(id).cardId)!;const format=s(a.format??'markdown');if(!['markdown','json'].includes(format))throw new Error('Use markdown|json')
      const items=transcriptItems(id),content=format==='json'?JSON.stringify(items,null,2):renderTranscript(items)
      if(a.path){const employee=executionEmployee(readStore(),card);const args={path:s(a.path),content,create:true};return employee.remote?remoteFiles(card.id,employee.remote,'write',args):workspaceFiles(employeeWorkspace(readStore(),card.cwd,card.id),'write',args)}
      return {format,content}
    }
    case 'session.send': {const sent=await sendMessage(s(a.id),s(a.text??''),undefined,a.images,a.delegation,undefined,a.replyTo,a.replyQuote,a.crossReply,a.files,privateSend,a.sourceView);return {sent,messageId:sessionInfo(s(a.id))?.currentTask?.messageId}}

    case 'session.transcript': {
      const allItems=transcriptItems(s(a.id)),items=a.limit?allItems.slice(-Math.max(1,Math.min(1000,Number(a.limit)))):allItems
      // Thinking is hidden by default; `--thinking` includes it, matching
      // expanding the thinking block in the GUI.
      const shown = a.thinking
        ? items
        : items.map((it: any) =>
            it.role === 'assistant'
              ? { ...it, blocks: it.blocks.filter((b: any) => b.kind !== 'thinking') }
              : it
          )
      return { text: renderTranscript(shown), items, shown }
    }

    case 'session.info': {
      if(!a.id)throw Error('Choose id or employee; session.status returns stable employee IDs and current sessionId')
      const info = sessionInfo(s(a.id))
      if (!info){const card=readStore().sessions.find(c=>c.id===a.id);if(card)return {...publicEmployee(card),lastReply:card.lastReply,busy:false,sessionId:null};throw new Error(`unknown session ${s(a.id)}`)}
      const card=readStore().sessions.find(card=>card.id===info.cardId)
      return {...info,...(card?employeeAppearance(card):{})}
    }

    case 'session.interrupt': {
      const task=sessionInfo(s(a.id))?.currentTask
      if(a.expectedMessageId&&task?.messageId!==a.expectedMessageId)throw Error('Current message changed; interruption rejected')
      if(task?.runId)await scheduleRequest('cancel',{id:task.runId})
      else await interrupt(s(a.id))
      return {interrupted:true}
    }

    case 'session.close': {
      const closed = await closeSession(s(a.id))
      return { closed }
    }

    case 'config.engine':
      throw new Error('员工引擎创建后固定；如需使用其他引擎，请删除员工后重新添加')
    case 'config.model':
      return { ok: await setModel(s(a.id), a.model ? s(a.model) : undefined) }
    case 'config.remote-admin':
      if(typeof a.enabled!=='boolean')throw new Error('enabled 必须为布尔值')
      return {ok:await setRemoteAdmin(s(a.id),a.enabled)}
    case 'config.permission':
      return { ok: await setPermissionMode(s(a.id), a.mode as PermissionMode) }
    case 'config.plan':
      if(typeof a.enabled!=='boolean')throw new Error('enabled must be boolean')
      return {ok:await setPlanMode(s(a.id),a.enabled)}
    case 'config.fast':
      if(typeof a.enabled!=='boolean')throw new Error('enabled must be boolean')
      return {ok:await setFastMode(s(a.id),a.enabled)}
    case 'config.thinking':
      return { ok: await setThinking(s(a.id), a.enabled === true || a.enabled === 'on') }
    case 'config.effort':
      // 'default' (or omitting the value) clears the override, matching the
      // "Default" entry in the GUI's effort dropdown.
      return {
        ok: await setEffort(
          s(a.id),
          !a.effort || a.effort === 'default' ? null : (a.effort as EffortLevel)
        )
      }

    // ---- UI inspection: what is actually on screen ----
    case 'ui.view':
    case 'ui.dom':
    case 'ui.text':
      return askRenderer(req.cmd.split('.')[1], {
        selector: a.selector,
        timeout: a.timeout
      })

    case 'ui.style':
      return askRenderer('style', { selector: s(a.selector) })
    case 'ui.screenshot':
      return askRenderer('screenshot', { path: s(a.path),privacy:a.privacy===true })
    case 'ui.drag':
      return askRenderer('drag',a)
    case 'ui.wheel':
      return askRenderer('wheel',a)

    case 'ui.click':
      await askRenderer('click', { selector: s(a.selector) })
      // Give React a beat to re-render before the caller reads the UI.
      await new Promise((r) => setTimeout(r, 400))
      return askRenderer('snapshot')

    case 'ui.type':
      await askRenderer('type', { selector: s(a.selector), value: s(a.value) })
      return askRenderer('snapshot')

    case 'ui.wait':
      return askRenderer('wait', { selector: s(a.selector), timeout: a.timeout ?? 5000 })

    case 'commands.run': {
      const text=s(a.text);if(!text.startsWith('/'))throw new Error('Command must start with /')
      return {sent:await sendMessage(s(a.id),text)}
    }
    case 'commands.list': {
      const all = sessionCommands(s(a.id))
      const f = String(a.filter ?? '').toLowerCase()
      const hidden = new Set(sessionInfo(s(a.id))?.terminalCommands ?? [])
      return all
        .filter((c) => (a.all ? true : !hidden.has(c.name)))
        .filter(
          (c) =>
            !f ||
            c.name.toLowerCase().includes(f) ||
            (c.description ?? '').toLowerCase().includes(f)
        )
    }

    // What Tab/Enter would insert when the menu is open.
    case 'commands.complete': {
      const name = s(a.name).replace(/^\//, '')
      const all = sessionCommands(s(a.id))
      const hit = all.find((c) => c.name === name || c.aliases?.includes(name))
      if (!hit) throw new Error(`no such command '/${name}'`)
      const hint = hit.argumentHint ? ' ' : ''
      return { completion: `/${hit.name}${hint}`, command: hit }
    }

    case 'card.clone': return cloneEmployee(s(a.id),{title:s(a.title),cwd:a.cwd,directoryMode:a.directoryMode})
    case 'card.native-bind': {
      const sessionId=s(a.sessionId)
      const bindable=()=>{const card=readStore().sessions.find(value=>value.id===a.id&&!value.deleting)
        if(!card||card.kind!=='cloud-native-worker')throw Error('只有 Cloud Native Worker 可以绑定远端原生会话')
        if(!canBindNativeSession(card)||transcriptItems(card.id).length)throw Error('员工已有会话，不能覆盖；请新建员工绑定另一条会话')
        if(nativeSessionRefs(card).some(ref=>ref.id===sessionId&&ref.ownership!=='external'))throw Error('不能把本员工拥有的原生会话重新标记为外部会话')
        return card
      }
      const card=bindable(),{origin}=cloudNativeTarget(card)
      const config=employeeSettings(readStore(),card)
      await checkCloudNative(card.hostId!,card.engine,cloudRelative(config,card.cwd))
      if(readStore().sessions.some(other=>other.id!==card.id&&nativeSessionRefs(other).some(ref=>ref.engine===card.engine&&ref.id===sessionId&&JSON.stringify(ref.origin??null)===JSON.stringify(origin))))throw Error('此远端原生会话已属于另一名员工')
      const items=await readCloudNativeSession(card,sessionId)
      bindable();await closeForNativeChange(card.id)
      const current=bindable()
      if(JSON.stringify(cloudNativeTarget(current).origin)!==JSON.stringify(origin))throw Error('云主机身份已变化，请重新读取原生会话')
      if(readStore().sessions.some(other=>other.id!==card.id&&nativeSessionRefs(other).some(ref=>ref.engine===card.engine&&ref.id===sessionId&&JSON.stringify(ref.origin??null)===JSON.stringify(origin))))throw Error('此远端原生会话已属于另一名员工')
      seedTranscript(card.id,items)
      try{
        const store=patchSession(card.id,{nativeSessions:nativeSessionRefs(current),...(card.engine==='codex'?{threadId:sessionId}:{claudeSessionId:sessionId}),nativeOwnership:'external',initialization:pendingInitialization()})
        queueEmployeeInitialization(card.id)
        return {card:store.sessions.find(value=>value.id===card.id),imported:items.length}
      }catch(error){deleteTranscript(card.id);throw error}
    }
    case 'card.create': {
      if(a.position!==undefined||a.seatNumber!==undefined)throw Error('Coordinates and seats were removed')
      let creation:NonNullable<ReturnType<typeof readStore>['employeeCreations']>[string]|undefined
      if(a.clientRequestId!==undefined){
        const key=a.clientRequestId,principal=requestContext().principal;if(typeof key!=='string'||!key.trim()||key.length>160)throw Error('clientRequestId must be 1–160 characters')
        const fields=Object.fromEntries(['title','folderName','hostId','remoteDir','character','avatarStyle','avatar','accessory','color','profession','role','engine','kind','model','effort','thinking','permissionMode','accessMode','directoryMode','cwd','managementRole'].map(name=>[name,name==='title'?String(a.title??'').trim():a[name]])),fingerprint=creationFingerprint(fields),store=readStore(),previous=Object.entries(store.employeeCreations??{}).find(([,value])=>value.key===key&&JSON.stringify(value.caller)===JSON.stringify(principal))
        if(previous){if(previous[1].fingerprint!==fingerprint)throw Error('clientRequestId already used with different employee settings');const card=store.sessions.find(card=>card.id===previous[0]&&!card.deleting);if(!card||!canReadEmployee(principal,card.id))throw Error('Created employee is no longer available');return executionEmployee(store,card)}
        creation={caller:principal,key,fingerprint}
      }
      if(a.thinking!==undefined&&typeof a.thinking!=='boolean')throw Error('thinking must be a boolean; CLI uses --thinking on|off')
      if(a.accessMode!==undefined&&!['trusted','isolated'].includes(a.accessMode))throw Error('Invalid process access mode')
      if(a.managementRole!==undefined&&!isManagementRole(a.managementRole))throw Error('Invalid management role')
      const kind=a.kind??'worker'
      assertManagementKind({kind,managementRole:a.managementRole??'employee'})
      if(!['worker','cloud-native-worker'].includes(kind))throw new Error('Only Local or Cloud Native Worker employees are supported')
      if(a.chatProvider!==undefined||a.chatMode!==undefined||a.chromeProfile!==undefined)throw new Error('Web chat employees are no longer supported')
      if(a.permissionMode!==undefined&&!['default','acceptEdits','plan','auto','dontAsk','bypassPermissions'].includes(a.permissionMode))throw Error('Invalid engine permission mode')
      const engine = a.engine ?? 'codex'
      if (!isEngine(engine)) throw new Error('Unknown engine')
      let model=a.model||defaultEmployeeModel(engine,kind)
      if (!String(a.title ?? '').trim()) throw new Error('Employee name is required')
      const avatar=resolveAvatar(a,activeAvatarIds())??randomAvatar(activeAvatarIds()),appearance=employeeFields({...a,avatar,color:a.color??avatarDescription(avatar).color,role:professionValue(a)})
      const store=readStore(),hostId=a.hostId?s(a.hostId):undefined,remoteDir=(a.remoteDir??a.directory)?s(a.remoteDir??a.directory):undefined
      const workspaceMode=hostId?'cloud':'local',config=employeeSettings(store,{workspaceMode,hostId,remoteRoot:remoteDir,directoryMode:a.directoryMode})
      assertEngineWorkspace(engine,config.mode,kind)
      assertManagementKind({kind,managementRole:a.managementRole??'employee'},false,config.mode==='cloud')
      if(a.remote!==undefined)throw new Error('请先在 Cloud Hosts 中登记云主机，再通过 hostId 绑定员工')
      if(kind==='cloud-native-worker'){
        if(!hostId)throw new Error('Cloud Native Worker 需要选择已注册的云主机')
        await checkCloudNative(hostId,engine,remoteDir)
        if(!a.model)model=(await engineModels(engine,kind,hostId)).defaultModel
        await resolveEmployeeWorkspace(store,{title:s(a.title),folderName:a.folderName,cwd:a.cwd,directoryMode:a.directoryMode,preview:true,hostId,remoteDir})
      }
      if(!isGlobal(requestContext().principal)&&workspaceMode==='local'&&a.cwd){const root=centralizedWorkspacesRoot(store),candidate=resolve(root,s(a.cwd));if(!inside(root,candidate))throw Error('Manager-created workspace must stay inside the unified workspaces root')}
      const resolved=await resolveEmployeeWorkspace(store,{title:s(a.title),folderName:a.folderName,cwd:a.cwd,directoryMode:a.directoryMode,hostId,remoteDir})
      const latest=readStore()
      const id = newSessionId()
      const origin=kind==='cloud-native-worker'?{kind:'cloud' as const,hostId:hostId!,host:resolved.remote!.host,os:resolved.remote!.os,directory:resolved.cwd}:undefined
      authorize('card.create',a);
      const employee:StoredSession = { ...appearance,...creationAuthority(requestContext().principal),managementRole:isGlobal(requestContext().principal)?a.managementRole??'employee':'employee',accessMode:isGlobal(requestContext().principal)?a.accessMode??'trusted':callerEmployee()!.accessMode??'trusted',id, title: s(a.title).trim(), engine,kind,workspaceMode,...(hostId?{hostId}:{}),...(resolved.remoteRoot?{remoteRoot:resolved.remoteRoot}:{}),...(a.folderName?.trim()?{folderName:storageFolderName(s(a.folderName.trim()))}:{}),directoryMode:a.directoryMode??(a.cwd?'bind':'default'),nativeOrigin:origin,cwd:resolved.cwd, createdAt: Date.now(),
        model,
        thinking: a.thinking??false,effort: engine==='cline'||engine==='pi'?undefined:a.effort??'low', permissionMode:a.permissionMode??getPreferences().defaultPermissionMode }
      employee.initialization=pendingInitialization()
      ensureEmployeeBootstrap(employee,latest)
      const saved=patchSession(id,employee,creation)
      if(employee.initialization.status==='pending')queueEmployeeInitialization(id)
      return executionEmployee(saved,saved.sessions.find((c) => c.id === id)!)
    }
    case 'card.avatar': {
      const card=readStore().sessions.find(c=>c.id===a.id&&!c.deleting)
      if(!card)throw Error('Unknown employee')
      const avatar=resolveAvatar(a,activeAvatarIds())??randomAvatar(activeAvatarIds())
      assertNotRemoving(card.id)
      const saved=patchSession(card.id,{avatar,color:avatarDescription(avatar).color}).sessions.find(c=>c.id===card.id)!
      return {id:saved.id,...employeeAppearance(saved)}
    }
    case 'card.update': {
      for(const key of Object.keys(a))if(!['id','patch'].includes(key))throw Error('Unknown card.update field: '+key+'; put profile fields inside patch, e.g. {id,patch:{profession:"..."}}')
      if(!a.patch||typeof a.patch!=='object'||Array.isArray(a.patch)||!Object.keys(a.patch).length)throw Error('card.update requires a nonempty patch object, e.g. {id,patch:{profession:"..."}}')
      const store=readStore(), card=store.sessions.find(c=>c.id===a.id)
      if(!card) throw new Error('Unknown employee')
      if(a.patch?.cwd!==undefined&&a.patch.cwd!==card.cwd||a.patch?.directoryMode!==undefined||a.patch?.folderName!==undefined&&a.patch.folderName!==card.folderName||a.patch?.hostId!==undefined&&a.patch.hostId!==card.hostId)throw new Error('员工工作目录和宿主创建后不能更换')
      assertManagementKind(card,hasGlobalRole(store.access,card),employeeSettings(store,card).mode==='cloud')
      const patch={...a.patch},unchangedAvatar=patch.avatar===card.avatar&&patch.character===undefined&&patch.avatarStyle===undefined
      const avatar=unchangedAvatar?patch.avatar:resolveAvatar(patch,activeAvatarIds());if(avatar!==undefined)patch.avatar=avatar;if(patch.profession!==undefined)patch.role=professionValue(patch)
      if(patch.accessMode!==undefined)throw Error('Use card.access-mode')
      if(patch.kind!==undefined&&patch.kind!==(card.kind??'worker'))throw new Error('员工职位创建后不可更改')
      if(patch.chatProvider!==undefined||patch.chatMode!==undefined||patch.chromeProfile!==undefined)throw new Error('Web chat employees are no longer supported')
      if(patch.position!==undefined||patch.seatNumber!==undefined)throw Error('Coordinates and seats were removed')
      if(!Object.keys(employeeFields(patch,card)).length)throw Error('No editable profile fields in patch; use title, profession, role, avatar, accessory or color')
      assertEngineWorkspace(patch.engine??card.engine,employeeSettings(store,card).mode)
      if(patch.remote!==undefined)throw new Error('云主机连接不能在更新时修改')
      if(card.kind==='cloud-native-worker')cloudNativeTarget(card)
      authorize('card.update',a,card.id)
      const updated=updateEmployee(card.id,patch),next=updated.sessions.find(c=>c.id===card.id)!
      provisionEmployee(next.cwd,employeeRoot(updated,next)!,employeeSettings(updated,next))
      return updated
    }

    case 'session.rename': {
      const id=readStore().sessions.some(c=>c.id===a.id)?s(a.id):sessionSnapshot(s(a.id)).cardId
      if(!id)throw new Error('Unknown employee session')
      const updated=updateEmployee(id,{title:s(a.title)}),card=updated.sessions.find(value=>value.id===id)!
      provisionEmployee(card.cwd,employeeRoot(updated,card)!,employeeSettings(updated,card))
      return updated
    }
    case 'card.rename': {
      const id=s(a.cardId),updated=updateEmployee(id,{title:s(a.title)}),card=updated.sessions.find(value=>value.id===id)!
      provisionEmployee(card.cwd,employeeRoot(updated,card)!,employeeSettings(updated,card))
      return updated
    }
    case 'card.remove':
      return removeEmployees(a.ids,a.deleteWorkspace===true)

    default:
      throw new Error(`unknown command: ${req.cmd}`)
  }
}

async function removeEmployees(ids:string[],deleteWorkspace=false) {
  const wanted=new Set(ids),locked:string[]=[]
  try {
    const current=readStore()
    for(const id of wanted){
      if(!current.sessions.some(card=>card.id===id))throw new Error('Unknown employee')
      if(!/^[a-z0-9_-]+$/i.test(id))throw new Error('无效的员工 ID，未移除员工')
      authorize('card.remove',{id},id)
      beginEmployeeRemoval(id);locked.push(id)
    }
    const folders=new Map<string,{id:string;path:string}>(),scope={employees:wanted}
    if(deleteWorkspace)for(const id of wanted){const folder=await removeEmployeeWorkspace(id,true,scope);folders.set(folder.key,{id,path:folder.path})}
    for(const id of wanted)authorize('card.remove',{id},id)
    updateStore(store=>{for(const card of store.sessions)if(wanted.has(card.id))card.deleting=true})
    for(const id of wanted){await cancelEmployeeInitialization(id);revokeAgentCredential(id);await removeEmployeeWorkers(id);await closeEmployeeTerminals(id);closeRemote(id)}
    for(const live of listLive())if(wanted.has(sessionSnapshot(live.id).cardId!))await closeSession(live.id)
    const latest=readStore(),refs=latest.sessions.filter(card=>wanted.has(card.id)).flatMap(nativeRefsForRemoval)
    const others=latest.sessions.filter(card=>!wanted.has(card.id)).flatMap(nativeSessionRefs)
    if(refs.some(ref=>ref.ownership!=='external'&&others.some(other=>other.engine===ref.engine&&other.id===ref.id&&JSON.stringify(other.origin??null)===JSON.stringify(ref.origin??null))))throw new Error('原生会话仍被其他员工引用，未移除员工')
    await deleteNativeSessions(refs)
    // Delete each shared directory once, children before parents, after every native history is closed.
    for(const folder of [...folders.values()].sort((a,b)=>b.path.length-a.path.length))await removeEmployeeWorkspace(folder.id,false,scope)
    for(const id of wanted){deleteTranscript(id);removeAgentAccessData(id)}
    const store=removeSession([...wanted]),view=getView()
    if(view.employee&&wanted.has(view.employee))setView(view.pluginId?{kind:'plugin',pluginId:view.pluginId}:{kind:'messages'})
    return store
  }finally{for(const id of locked)endEmployeeRemoval(id)}
}

function pluginWorkspace(args:Record<string,any>):string {
  if(requirePlugin(String(args.id)).scope==='application')return localDirectory(defaultPluginWorkspace(String(args.id)),isAppAdministrator()?true:'preview',true)
  if(args.workspace&&(isAppAdministrator()||pluginAccessEntry(String(args.id),String(args.workspace)).revision>0))return localDirectory(String(args.workspace),false,true)
  const selected=args.employee?readStore().sessions.find(card=>card.id===args.employee):undefined,legacy=selected?employeeSettings(readStore(),selected):undefined
  if(!legacy||legacy.mode!=='work'||legacy.pluginId!==args.id){
    const settings={mode:'work' as const,pluginId:String(args.id)}
    const defaultRoot=localDirectory(defaultPluginWorkspace(settings.pluginId),'preview',true)
    const selectedRoot=args.workspace?localDirectory(String(args.workspace),false,true):defaultRoot
    if(selectedRoot===defaultRoot){
      if(!isAppAdministrator())return localDirectory(selectedRoot,'preview',true)
      const legacyDir=legacyPluginWorkspace(settings.pluginId)
      const imported=join(defaultRoot,'.agents-company','legacy-import.json')
      if(!existsSync(imported)&&!existsSync(defaultRoot)&&existsSync(legacyDir)&&!inside(legacyDir,defaultRoot)){
        mkdirSync(dirname(defaultRoot),{recursive:true})
        const stage=defaultRoot+'.import-'+process.pid
        try{cpSync(legacyDir,stage,{recursive:true,filter:file=>!file.startsWith(legacyDir+'/.agents-company')});renameSync(stage,defaultRoot)}finally{rmSync(stage,{recursive:true,force:true})}
      }
      const root=localDirectory(selectedRoot,true,true)
      if(!existsSync(imported)){mkdirSync(dirname(imported),{recursive:true});writeFileSync(imported,JSON.stringify({version:1,completed:true})+'\n')}
      provisionWorkspace(root,settings);return root
    }
  }
  const context=workspaceContext(args)
  if(context.settings.mode!=='work'||context.settings.pluginId!==args.id)throw new Error('请选择绑定了此插件的员工或工作区')
  return context.root
}

function workspaceContext(args:Record<string,any>) {
  const store=readStore()
  const employee=args.employee?store.sessions.find(c=>c.id===args.employee):undefined
  if(args.employee&&!employee)throw new Error('Unknown employee')
  if(employee){
    const settings=employeeSettings(store,employee)
    if(settings.mode==='cloud')return {store,root:employee.cwd,settings}
    const root=employeeWorkspace(store,employee.cwd,employee.id)
    return {store,root,settings}
  }
  if(args.workspace){
    const root=localDirectory(String(args.workspace),false,true)
    return {store,root,settings:{mode:'work' as const,pluginId:args.id?String(args.id):undefined}}
  }
  throw new Error('Choose an --employee or --workspace')
}

async function attachmentDirectory(conversation:string):Promise<FileLocation>{
  if(!/^(employee|group|channel):[a-zA-Z0-9_-]+$/.test(conversation))throw Error('Choose a valid conversation')
  if(!conversation.startsWith('employee:')){conversationFileEndpoint(conversation,'.',true);return {conversation,path:'.'}}
  const [kind,id]=conversation.split(':'),to:FileLocation={...(kind==='group'?{group:id}:{employee:id}),path:'.'},endpoint=fileEndpoint(to,true)
  const directory=(kind==='employee'?'.agents-attachments/':'')+randomUUID()
  const call=(operation:string,args:Record<string,unknown>)=>endpoint.remote?remoteFiles('attachment-'+id,endpoint.remote,operation,args):Promise.resolve(workspaceFiles(endpoint.root,operation,args))
  if(kind==='employee'&&!(await call('copy-info',{path:'.agents-attachments'})).exists){try{await call('mkdir',{path:'.agents-attachments'})}catch(error){if(!(await call('copy-info',{path:'.agents-attachments'})).directory)throw error}}
  await call('mkdir',{path:directory})
  return {...to,path:directory}
}
function fileEndpoint(ref:FileLocation,destination:boolean):FileEndpoint {
  if(ref?.asset){const mapped=assetLocation(ref.asset,ref.path),endpoint=fileEndpoint(mapped,destination),context=requestContext();return {...endpoint,validate:async(operation,args)=>withCaller(context,async()=>{const current=fileEndpoint(assetLocation(ref.asset!,ref.path),destination);if(current.root!==endpoint.root||JSON.stringify(current.remote)!==JSON.stringify(endpoint.remote))throw Error('Asset workspace changed during transfer');await endpoint.validate?.(operation,args);if(operation==='copy-commit')assetIndex.invalidate()})}}
  if(!ref||typeof ref.path!=='string'||[!!ref.worker,!!ref.shared,!!ref.employee,!!ref.local,!!ref.group,!!ref.channel,!!ref.conversation,!!ref.hostId].filter(Boolean).length!==1)throw Error('File location requires one shared/employee/local/group/channel/host scope and path')
  if(ref.worker)return workerFileEndpoint(ref.worker,ref.path)
  if(ref.hostId){const target=cloudHostTarget(ref.hostId);return {root:target.directory,path:ref.path||'.',remote:target}}
  const botId=ref?.group??ref?.employee??(ref?.conversation?.startsWith('group:')?ref.conversation.slice(6):undefined)
  if(botId&&botGroup(botId)&&typeof ref.path==='string'&&ref.path.startsWith('@bot/')){if(destination)throw Error('Published bot files are read-only; download a workspace copy');return botFileEndpoint(botId,ref.path)}
  if(ref.employee&&(ref.path.startsWith(DIRECT_ATTACHMENT_PREFIX)||ref.path.startsWith(DIRECT_UPLOAD_PREFIX))){if(destination)throw Error('Published private attachments are read-only');return ref.path.startsWith(DIRECT_UPLOAD_PREFIX)?directUploadEndpoint(ref.employee,ref.path):directFileEndpoint(ref.employee,ref.path)}
  if(ref.conversation)return conversationFileEndpoint(ref.conversation,ref.path,destination)
  if((ref.group||ref.channel)&&ref.path.startsWith(WORKSPACE_FILE_PREFIX))return conversationFileEndpoint((ref.group?'group:'+ref.group:'channel:'+ref.channel),ref.path,destination)
  if(ref.channel){if(destination)throw Error('Channel files are read-only');if(!isAppAdministrator())throw Error('Only the user or Secretary may download channel files');return channelFileEndpoint({channelId:ref.channel,path:ref.path})}
  if(ref.group){if(ref.path.split(/[\\/]/).some(part=>part.toLowerCase()==='.margin-reader'))throw Error('Reader metadata is managed through the plugin');if(!isAppAdministrator())throw Error('Use chat.file for published group attachments');return {root:groupMediaRoot(ref.group),path:ref.path||'.'}}
  if(ref.shared)return {root:sharedDirectory(),path:ref.path||'.'}
  if(ref.local){
    if(!isAbsolute(ref.path))throw Error('本地路径必须为绝对路径')
    if(destination){const root=realpathSync(ref.path);if(!statSync(root).isDirectory())throw Error('目标必须是文件夹');return {root,path:'.'}}
    const file=resolve(ref.path);return {root:realpathSync(dirname(file)),path:basename(file)}
  }
  const store=readStore(),employee=store.sessions.find(c=>c.id===ref.employee)
  if(!employee)throw new Error('Unknown employee')
  const resolved=executionEmployee(store,employee)
  return {root:resolved.cwd,path:ref.path||'.',...(resolved.remote?{remote:resolved.remote}:{})}
}

async function closeForNativeChange(cardId:string):Promise<void> {
  assertEmployeeControl(cardId,undefined,true)
  for(const live of listLive()){const snapshot=sessionSnapshot(live.id);if(snapshot.cardId===cardId){if(snapshot.busy)throw new Error('员工正在工作，请先停止任务再调整执行隔离或绑定原生会话');await closeSession(live.id)}}
}

async function closeForWorkspaceChange(cardId: string): Promise<void> {
  assertEmployeeControl(cardId,undefined,true)
  for(const live of listLive()) {
    const state=sessionSnapshot(live.id)
    if(state.cardId!==cardId) continue
    if(state.busy) throw new Error('员工正在工作，请先停止任务再更改工作空间')
    await closeSession(live.id)
  }
  await closeEmployeeTerminals(cardId);closeRemote(cardId)
}

export function startServer(onListening: () => void = () => {}): void {
  initializeAccessChannel()
  if(process.platform!=='win32')mkdirSync(dirname(SOCKET_PATH), { recursive: true })

  server = createServer((sock) => {
    const cancellation=new AbortController()
    clients.add(sock)
    const drop = () => {
      cancellation.abort()
      followerActivity.get(sock)?.();followerActivity.delete(sock)
      clients.delete(sock)
      following.delete(sock)
      followerContexts.delete(sock)
      rawFollowers.delete(sock)
    }
    sock.on('close', drop)
    sock.on('error', drop)

    const rl = protocolLines(sock)
    rl.on('error', drop)
    rl.on('line', async (line) => {
      let req: Request
      try {
        req = JSON.parse(line)
      } catch {
        sock.write(protocolJson({ ok: false, error: 'malformed request' }) + '\n')
        return
      }

      let caller:RequestContext
      try{caller=authenticate(req.auth)}catch(error){sock.end(protocolJson({ok:false,error:(error as Error).message,...((error as {code?:string}).code?{code:(error as {code:string}).code}:{})})+'\n');return}
      // `follow` keeps the connection open and streams instead of replying.
      // `raw: true` forwards every engine event, not just the rendered text.
      if (req.cmd === 'session.follow') {
        let sessionId=String((req.args??{}).id??(req.args??{}).employee)
        const card=employeeId(sessionId)
        const found=listLive().find(item=>sessionInfo(item.id)?.cardId===card);if(found)sessionId=found.id
        try{authorize('session.follow',req.args,card,caller);assertEmployeeReady(card)}catch(error){sock.end(protocolJson({ok:false,error:(error as Error).message,...((error as {code?:string}).code?{code:(error as {code:string}).code}:{})})+'\n');return}
        const info = sessionInfo(sessionId)
        if(info?.busy){followerActivity.get(sock)?.();followerActivity.set(sock,beginManagementInteraction(req.cmd,card,caller))}
        if (!info) {
          if(card){const items=transcriptItems(card);sock.write(protocolJson({ok:true,data:{following:card,transcript:items,text:renderTranscript(items)}})+'\n');sock.end(protocolJson({type:'done'})+'\n')}
          else sock.end(protocolJson({ ok: false, error: `unknown session ${sessionId}` }) + '\n')
          return
        }
        following.set(sock, sessionId);followerContexts.set(sock,caller)
        if ((req.args ?? {}).raw) rawFollowers.add(sock)
        sock.write(
          JSON.stringify({
            ok: true,
            data: { following: sessionId, transcript: transcriptItems(sessionId), text: renderTranscript(transcriptItems(sessionId)) }
          }) + '\n'
        )
        if (!info.busy) sock.end(protocolJson({ type: 'done' }) + '\n')
        return
      }

      let res: Response
      try {
        res = { ok: true, data: await handleRequest(req,{...caller,signal:cancellation.signal}) }
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : String(err), ...((err as {code?:string})?.code?{code:(err as {code:string}).code}:{}) }
      }
      if (sock.writable) sock.write(protocolJson(res) + '\n')
    })
  })

  const listen = () => server!.listen(SOCKET_PATH, () => { if(process.platform!=='win32')chmodSync(SOCKET_PATH,0o600); ownsSocket = true; onListening() })
  server.on('error', (err) => { console.error('[socket]', err.message); process.exitCode = 1 })
  if (process.platform==='win32'||!existsSync(SOCKET_PATH)) { listen(); return }
  // Probe before removing a stale socket; never detach another running service.
  const probe = connect(SOCKET_PATH)
  probe.once('connect', () => {
    probe.destroy()
    console.error(`Aexus Bot is already running at ${SOCKET_PATH}`)
    process.exit(1)
  })
  probe.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOENT') {
      console.error(err.message); process.exit(1)
    }
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH)
    listen()
  })
}

export function stopServer(): void {
  try {
    server?.close()
    for (const client of clients) client.destroy()
    if (process.platform!=='win32'&&ownsSocket && existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH)
  } catch {
    // shutting down anyway
  }
  server = null
  ownsSocket = false
}
