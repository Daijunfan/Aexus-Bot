import {agentCredential,authenticate} from './agent-access'
import {authorize,withCaller,callerIdentity,apiDocumentation} from './authorization'
import type {Live} from './sessions'
import {API_REVISION,apiError,apiFailure,knownApi} from './api-contract'
import {boundedApiResult} from './api-results'

export const DOCUMENTATION_TOOL={
 name:'agents_company_documentation',
 description:'Read identity and index, then only the needed reference. Exact inputs: {operation:"identity"}; {operation:"index"}; {operation:"describe",command:"schedule.create"}; {operation:"document",document:"core/secretary-api"}. document is a published ID, never a file path, query or nested args. For plugin methods use document:"plugin/mininotion/command/page.create". apiRevision identifies the current schema; rediscover after a schema error or application update rather than reusing historical parameters. Large documents return api-result-page; read via agents_company_api api.result. Plan is Core; MiniNotion is separate. Reading never grants execution authority. This tool cannot execute operations.',
 inputSchema:{type:'object',additionalProperties:false,required:['operation'],properties:{operation:{type:'string',enum:['identity','index','document','describe']},document:{type:'string',description:'For operation=document: a document ID such as core/plan, plugin/mininotion/index or plugin/mininotion/command/page.create.'},command:{type:'string',description:'For operation=describe: a Core command such as schedule.create, never a plugin method or document ID.'}}}
} as const

const credentials=new WeakMap<Live,string>(),reads=new WeakMap<Live,Set<string>>()
/** Capture the opened employee identity, not a credential supplied by the model. */
export function prepareDocumentationTool(state:Live){credentials.set(state,agentCredential(state.cardId).token)}
export function documentationIdentity(state:Live){
 const credential=credentials.get(state);if(!credential)throw Error('Employee tool identity is unavailable; reopen this employee')
 const context=authenticate(credential)
 if(context.principal.kind!=='agent'||context.principal.employeeId!==state.cardId)throw Error('Wrong employee tool identity')
 return context
}
export function beginDocumentationRead(state:Live){const actual=new Set<string>();reads.set(state,actual);return()=>{if(reads.get(state)===actual)reads.delete(state)}}
export function assertDocumentationRead(state:Live){if(!reads.get(state)?.has('identity')||!reads.get(state)?.has('index'))throw Error('Initialization must read its identity and the shared API index through the documentation tool')}

export async function invokeDocumentationTool(state:Live,input:unknown,callId:string,signal?:AbortSignal):Promise<unknown>{
 signal?.throwIfAborted()
 if(state.acknowledging)throw Error('Documentation discovery is unavailable during shared-message acknowledgment')
 if(!callId||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['operation','document','command'].includes(key)))throw apiError('INVALID_ARGUMENTS','api.docs','Choose identity, index, document or describe. Use {operation:"document",document:"core/secretary-api"} or {operation:"describe",command:"schedule.create"}; path, query and nested args are not supported.')
 const value=input as {operation?:unknown;document?:unknown;command?:unknown}
 if(state.privateInitialization&&!['identity','index'].includes(String(value.operation)))throw Error('Initialization reads only identity and index; read detailed API documents when a task needs them')
 const context=documentationIdentity(state)
 try{return withCaller(context,()=>{
  if(value.operation==='identity'){
   authorize('auth.whoami');const result=callerIdentity();reads.get(state)?.add('identity');return result
  }
  if(value.operation==='index'||value.operation==='document'){
   const document=value.operation==='index'?'index':value.document
   if(typeof document!=='string'||!document)throw Error('Choose a document ID from the shared index')
   authorize('api.docs',{document});const result=apiDocumentation(undefined,undefined,document);if(result.document==='index')reads.get(state)?.add('index');return boundedApiResult(context,'api.docs',{...result,apiRevision:API_REVISION})
  }
  if(value.operation==='describe'){
   if(typeof value.command!=='string'||!value.command)throw Error('Choose one API command')
   authorize('api.describe',{command:value.command,all:true});const command=knownApi(value.command)
   return boundedApiResult(context,'api.describe',{...command,apiRevision:API_REVISION})
  }
  throw Error('Choose identity, index, document or describe')
 })}catch(error){throw apiFailure(error,value.operation==='describe'?'api.describe':'api.docs')}
}
