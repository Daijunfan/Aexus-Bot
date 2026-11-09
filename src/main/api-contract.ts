import {createHash} from 'node:crypto'
import Ajv2020, {type ValidateFunction} from 'ajv/dist/2020'
import {COMMANDS} from '../shared/api-registry'

/** One version and validator for the schemas published by Core, CLI and native tools. */
export const API_REVISION=createHash('sha256').update(JSON.stringify(COMMANDS)).digest('hex').slice(0,16)
const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false}),validators=new Map<string,ValidateFunction>()
const alternatives:Record<string,string[]>={
 'employee.list':['session.status','card.profile'],'card.list':['session.status','card.profile'],
 'company.employees':['session.status'],'team.list':['group.list'],
 'employee.create':['card.create'],'group.create':['group.add'],
 conversation:['conversation.entry','conversation.workspaces'],describe:['api.describe'],document:['api.docs']
}
export function apiError(code:string,command:string,message:string,details:Record<string,unknown>={}){
 return Object.assign(Error(JSON.stringify({code,command,message,apiRevision:API_REVISION,...details})),{code})
}
export function knownApi(command:string){
 const definition=COMMANDS.find(item=>item.name===command)
 if(!definition)throw apiError('UNKNOWN_COMMAND',command,'Unknown Core command; not available under this name',{
  suggestions:alternatives[command]??[],recovery:{command:'api.list',args:{compact:true,search:command.split('.')[0]}}
 })
 return definition
}
/** Validate without coercion, defaults or dropped fields; dispatch still enforces domain/authority. */
export function validateApiArguments(command:string,args:Record<string,unknown>){
 const definition=knownApi(command)
 if(!definition.inputSchema)return
 let validate=validators.get(command)
 if(!validate){validate=ajv.compile(definition.inputSchema);validators.set(command,validate)}
 if(validate(args))return
 const issues=validate.errors?.slice(0,8).map(error=>({path:'/args'+error.instancePath,message:error.message,...error.params}))
 throw apiError('INVALID_ARGUMENTS',command,'Invalid or forbidden arguments: they do not match the published schema; no operation was dispatched',{
  issues,fields:Object.keys((definition.inputSchema.properties??{}) as object),
  ...(command==='schedule.create'?{hint:'Put schedule fields inside args.spec; clientRequestId belongs beside spec. action is {type:"agent",employeeId,prompt}. Read schedule.create before retrying.'}:{}),
  ...(command.startsWith('session.')?{hint:'Use employee for a stable employee ID where supported, or id for a live session ID. Read session.status to obtain sessionId. Message content uses text, not prompt.'}:{}),
  recovery:{command:'api.describe',args:{command}}
 })
}
/** Give actionable recovery without retrying writes, cancelling work or relaxing permissions. */
export function apiFailure(cause:unknown,command:string){
 const error=cause instanceof Error?cause:Error(String(cause))
 if(error.message.startsWith('{"code":'))return error
 const message=error.message
 let code=(error as Error&{code?:string}).code??'CORE_REQUEST_FAILED'
 let recovery:unknown={command:'api.describe',args:{command}}
 if(/revision|changed; reload|reload.*sav/i.test(message)){code='REVISION_CONFLICT';recovery={command:command.startsWith('schedule.')?'schedule.get':'api.describe',guidance:'Read the current record and revision, reconcile the intended edit, then submit once. Never force a stale revision.'}}
 else if(/Cancel the active run/i.test(message))recovery={command:'schedule.history',guidance:'Inspect the active run. Updating a running schedule requires explicitly cancelling that run first; cancellation may interrupt current work.'}
 else if(/busy|reserved/i.test(message))recovery={command:'session.status',guidance:'Inspect status and queue. For deliberate private queued work use direct.send mode=enqueue. Keep clientMessageId only for identical retries; changed content needs a new ID.'}
 else if(/already used with different content/i.test(message))recovery={command:command.startsWith('direct.')?'direct.send-status':'api.describe',guidance:'Inspect the original request before sending again. Reuse an ID only with identical arguments; a changed request needs a new ID.'}
 else if(/future occurrence|window.*end|max.*occurrence/i.test(message))recovery={command:'schedule.get',guidance:'Read the saved rule, until, window and occurrence count. Preview an explicitly revised future rule before resuming.'}
 else if(/unknown.*(?:host|CloudHost)/i.test(message))recovery={command:'host.list',guidance:'Use the registered host ID returned by host.list, not a hostname or a retired ID.'}
 else if(/workspace|outside.*(?:path|root)/i.test(message))recovery={command:'workspace.catalog',guidance:'Use your authorized execution workspace. Download or stage attachments there before publishing; Core paths are not automatically paths on a remote execution host.'}
 else if(/storage server|channel storage|storage connection/i.test(message))recovery={command:'channel.subscription-status',guidance:'Check channel.settings and collector connectivity. This is a storage transport failure, not a schema or reading permission failure. Do not loop identical requests or create a local news cache.'}
 return apiError(code,command,message,{recovery})
}
