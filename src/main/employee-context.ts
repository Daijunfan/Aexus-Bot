import type {Live} from './sessions'
import type {StoredSession} from '../shared/types'
import {AGENT_CONTEXT_REVISION} from '../shared/message-source'
import {ROUTER_PROMPT} from './plugins/documents'
import {readStore,patchSession} from './store'
import {createHash} from 'node:crypto'
import {roleDescription} from '../shared/roles'

export type PendingInstructions={revision:string;identity:string;taskId?:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const revision=AGENT_CONTEXT_REVISION+'-'+hash(ROUTER_PROMPT).slice(0,12)
const identity=(card:StoredSession)=>hash([card.id,card.title,card.role,card.managementRole??'employee',card.group,card.cwd,roleDescription(card.managementRole)])
function nativeId(state:Live,card:StoredSession){
 const id=state.engine==='codex'?state.threadId??card.threadId:state.sessionId??(state.engine==='claude'?card.claudeSessionId:state.engine==='cline'?card.clineSessionId:state.engine==='pi'?card.piSessionId:undefined)
 return id?state.engine+':'+id:undefined
}

/** Fixed instructions belong to the native conversation, not every user message or Core process. */
export function employeeContextPrompt(state:Live,text:string,taskId?:string){
 const card=readStore().sessions.find(card=>card.id===state.cardId&&!card.deleting)
 if(!card)throw Error('Employee no longer exists')
 const current=nativeId(state,card),previous=card.instructionContext,native=previous?.nativeId===current?previous:undefined
 const pending:PendingInstructions={revision,identity:identity(card),taskId}
 if(native?.revision===pending.revision&&native.identity===pending.identity)return {text}
 const blocks:string[]=[]
 // Codex developer instructions and Claude's native system append already carry this router.
 if(!['codex','claude'].includes(state.engine)&&native?.revision!==pending.revision)blocks.push(ROUTER_PROMPT,...(state.engine==='cline'&&state.remoteLaunch?[state.remoteLaunch.instructions]:[]))
 if(!state.privateInitialization)blocks.push('[Aexus context update]\n'+JSON.stringify({revision:pending.revision,employeeId:card.id,managementRole:card.managementRole??'employee',team:card.group})+'\n身份或规则已更新；用文档工具刷新 identity，索引按需刷新。')
 return {text:[...blocks,text].join('\n\n'),pending}
}

/** Persist only after the engine acknowledges input or completes a successful turn. */
export function confirmEmployeeContext(state:Live,pending=state.pendingInstructions){
 if(!pending||state.acknowledging||pending.taskId!==state.currentTask?.messageId)return
 const card=readStore().sessions.find(card=>card.id===state.cardId&&!card.deleting),id=card&&nativeId(state,card)
 if(card&&id&&identity(card)===pending.identity)try{patchSession(card.id,{instructionContext:{nativeId:id,revision:pending.revision,identity:pending.identity}})}catch(error){console.error('[Agent context delivery cache]',(error as Error).message)}
 if(state.pendingInstructions===pending)state.pendingInstructions=undefined
}
