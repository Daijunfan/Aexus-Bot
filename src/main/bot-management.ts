import path from 'node:path'
import {createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import type {BotProvider} from '../shared/bot-workers'
import type {BotCatalog,BotCatalogProvider,NativeBotProfile,NativeBotSummary,NativeBotPatch,NativeBotAction} from '../shared/bot-management'
import type {ChatGroup} from '../shared/chat-groups'
import {requireAppAdministrator,requestContext} from './authorization'
import {atomicJson,readJson} from './atomic-file'
import {SingleFlight} from './single-flight'
import {nativeAccountKey,readNativeCatalog,readNativeProfile,configureNative,setNativeMembers,createNativeProfile,connectNativeProfile,controlNative,deleteNative} from './bot-bridge/catalog'

type Connection=ChatGroup&{removed?:boolean}
type Dependencies={connections:()=>Connection[];connect:(profile:NativeBotProfile)=>Promise<ChatGroup>;archive:(profile:NativeBotProfile)=>Promise<void>;updated:(profile:NativeBotProfile)=>void}
type SavedCatalog={account:string;checkedAt:number;complete:boolean;items:NativeBotProfile[]}
type Mutation={fingerprint:string;state:'dispatching'|'uncertain'|'rejected'|'complete';result?:unknown}
const cacheFile=path.join(APP_HOME,'native-bot-catalog.json'),mutationFile=path.join(APP_HOME,'native-bot-mutations.json'),reads=new SingleFlight<SavedCatalog>(),queues=new Map<string,Promise<unknown>>()
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const same=(a:string[],b:string[])=>JSON.stringify(a.slice().sort())===JSON.stringify(b.slice().sort())
const match=(connection:Connection,profile:NativeBotProfile)=>connection.bot?.provider===profile.provider&&(connection.bot.nativeId===profile.nativeId||connection.bot.remoteId===profile.messagingId)
function guard(provider:BotProvider,account:string){requireAppAdministrator();if(nativeAccountKey(provider)!==account)throw Error('The native account changed. Refresh the directory before continuing.')}
function serial<T>(key:string,work:()=>Promise<T>):Promise<T>{const previous=queues.get(key)??Promise.resolve(),next=previous.catch(()=>{}).then(work);queues.set(key,next);void next.finally(()=>{if(queues.get(key)===next)queues.delete(key)}).catch(()=>{});return next}
async function directory(provider:BotProvider,fresh=false){
 const account=nativeAccountKey(provider)
 if(fresh)await reads.get(provider+':'+account)?.catch(()=>{})
 return reads.run(provider+':'+account,async()=>{const value=await readNativeCatalog(provider);guard(provider,account);const snapshot={...value,account,checkedAt:Date.now()},saved=readJson<Partial<Record<BotProvider,SavedCatalog>>>(cacheFile,()=>({}));saved[provider]=snapshot;atomicJson(cacheFile,saved,true);return snapshot})
}
async function profile(provider:BotProvider,id:string){const account=nativeAccountKey(provider),value=await readNativeProfile(provider,id);guard(provider,account);return {value,account}}
function editable(item:NativeBotProfile,action:NativeBotAction){if(!item.canManage||!item.actions.includes(action))throw Error('This native account does not support or permit '+action+' for this item')}
function version(item:NativeBotProfile,expected:unknown){if(expected!==item.version)throw Error('Native profile changed. Refresh its settings before saving; your draft is retained.')}
async function waitForProfile(provider:BotProvider,id:string,predicate:(item:NativeBotProfile)=>boolean){
 for(let attempt=0;attempt<8;attempt++){const item=await readNativeProfile(provider,id);if(predicate(item))return item;await new Promise(resolve=>setTimeout(resolve,250))}
 throw Error('The native platform has not confirmed the requested change. Refresh its state before retrying.')
}
async function catalog(deps:Dependencies):Promise<BotCatalog>{
 const connections=deps.connections(),providers:BotCatalogProvider[]=[],items:NativeBotSummary[]=[]
 await Promise.all((['dots','grok'] as BotProvider[]).map(async provider=>{
  let snapshot:SavedCatalog|undefined,error:string|undefined,stale=false,account:string|undefined
  try{account=nativeAccountKey(provider);snapshot=await directory(provider)}catch(cause){error=(cause as Error).message;if(account){try{guard(provider,account);const saved=readJson<Partial<Record<BotProvider,SavedCatalog>>>(cacheFile,()=>({}))[provider];if(saved?.account===account){snapshot=saved;stale=true}}catch{}}}
  requireAppAdministrator()
  providers.push({provider,available:!!snapshot&&!stale,stale,complete:snapshot?.complete??false,checkedAt:snapshot?.checkedAt,error,bots:snapshot?.items.filter(item=>item.kind==='private').length,groups:provider==='grok'?snapshot?.items.filter(item=>item.kind==='group').length:undefined,canCreateBot:!!snapshot&&!stale,canCreateGroup:provider==='grok'&&!!snapshot&&!stale})
  for(const item of snapshot?.items??[]){const {description,threadId,...summary}=item,connection=connections.find(connection=>match(connection,item));items.push({...summary,descriptionPreview:description.slice(0,180),...(connection?{connectionId:connection.id,localName:connection.name,removed:connection.removed===true}:{})})}
 }))
 providers.sort((a,b)=>a.provider.localeCompare(b.provider));items.sort((a,b)=>a.provider.localeCompare(b.provider)||a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name))
 return {providers,items,totals:{bots:items.filter(item=>item.kind==='private').length,groups:items.filter(item=>item.kind==='group').length,connected:items.filter(item=>item.connectionId&&!item.removed).length,complete:providers.every(provider=>provider.available&&provider.complete)}}
}
async function durable<T>(provider:BotProvider,requestId:string,parameters:unknown,work:()=>Promise<T>):Promise<T>{
 const account=nativeAccountKey(provider),principal=requestContext().principal,key=hash([principal,provider,requestId]),fingerprint=hash([account,parameters])
 return serial('request:'+key,async()=>{
  guard(provider,account);const records=readJson<Record<string,Mutation>>(mutationFile,()=>({})),previous=records[key]
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('Native request ID already used with different parameters');if(previous.state==='complete')return previous.result as T;if(previous.state!=='rejected')throw Object.assign(Error('The previous native request has an unknown outcome. Refresh the native directory before taking another action; it was not replayed.'),{code:'NATIVE_BOT_UNCERTAIN'})}
  records[key]={fingerprint,state:'dispatching'};atomicJson(mutationFile,records,true)
  try{const result=await work();guard(provider,account);const latest=readJson<Record<string,Mutation>>(mutationFile,()=>({}));latest[key]={fingerprint,state:'complete',result};atomicJson(mutationFile,latest,true);return result}
  catch(error){const latest=readJson<Record<string,Mutation>>(mutationFile,()=>({})),status=(error as any).status;latest[key]={fingerprint,state:status>=400&&status<500&&status!==409?'rejected':'uncertain'};atomicJson(mutationFile,latest,true);throw error}
 })
}
function previousMutation(provider:BotProvider,requestId:string,parameters:unknown){
 const account=nativeAccountKey(provider),key=hash([requestContext().principal,provider,requestId]),previous=readJson<Record<string,Mutation>>(mutationFile,()=>({}))[key]
 if(!previous)return
 guard(provider,account);if(previous.fingerprint!==hash([account,parameters]))throw Error('Native request ID already used with different parameters')
 if(previous.state==='rejected')return
 if(previous.state!=='complete')throw Object.assign(Error('The previous native request has an unknown outcome. Refresh the directory before continuing; it was not replayed.'),{code:'NATIVE_BOT_UNCERTAIN'})
 return {result:previous.result}
}

export async function manageBotRequest(command:string,args:Record<string,any>,deps:Dependencies):Promise<any>{
 requireAppAdministrator()
 if(command==='bot.catalog')return catalog(deps)
 const provider=args.provider as BotProvider
 if(command==='bot.native-create'){
  const previous=previousMutation(provider,args.clientRequestId,{command,...args});if(previous)return previous.result
  const kind=args.kind??'private',members=args.members??[]
  if(kind==='group'&&(provider!=='grok'||!members.length))throw Error('Native groups require at least one Grok bot')
  if(kind==='private'&&members.length)throw Error('Bot members are only supported for Grok groups')
  if(kind==='group'){const available=await directory(provider);if(!available.complete)throw Error('Refresh the complete native directory before choosing members');if(members.some((id:string)=>!available.items.some(item=>item.nativeId===id&&item.kind==='private')))throw Error('Choose actual native Grok bot IDs, not Aexus employee IDs')}
  return durable(provider,args.clientRequestId,{command,...args},async()=>{const created=await createNativeProfile(provider,{name:args.name.trim(),description:args.description??'',kind,members,requestId:args.clientRequestId});await directory(provider,true);return created})
 }
 const target=String(args.nativeId)
 if(command==='bot.control'||command==='bot.native-delete'){const previous=previousMutation(provider,args.clientRequestId,{command,...args});if(previous)return previous.result}
 if(command==='bot.profile')return (await profile(provider,target)).value
 return serial('profile:'+provider+':'+target,async()=>{
  if(command==='bot.control'||command==='bot.native-delete'){const previous=previousMutation(provider,args.clientRequestId,{command,...args});if(previous)return previous.result}
  const current=await profile(provider,target),item=current.value
  if(command==='bot.connect'){
   const connected=await connectNativeProfile(item);guard(provider,current.account);const result=await deps.connect(connected);guard(provider,current.account);return result
  }
  if(command==='bot.configure'){
   const patch=args.patch as NativeBotPatch;if(!Object.keys(patch).length)throw Error('Choose at least one native profile field')
   editable(item,Object.keys(patch).every(key=>key==='name')?'rename':'configure')
   if(patch.name!==undefined&&!patch.name.trim())throw Error('Choose a native name')
   const desired=Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,key==='name'?(value as string).trim():value])),matches=(value:NativeBotProfile)=>Object.entries(desired).every(([key,field])=>(value as any)[key]===field)
   if(matches(item))return item
   version(item,args.expectedVersion);guard(provider,current.account);await configureNative(item,desired);const saved=await waitForProfile(provider,target,matches);guard(provider,current.account);deps.updated(saved);await directory(provider,true);return saved
  }
  if(command==='bot.members'){
   editable(item,'members');const available=await directory(provider),candidates=available.items.filter(value=>value.kind==='private').map(value=>({nativeId:value.nativeId,name:value.name,grokShape:value.grokShape,grokColor:value.grokColor}))
   if(args.members===undefined)return {profile:item,candidates}
   if(!available.complete)throw Error('The native member directory is incomplete. Refresh it before saving.')
   const members=args.members as string[];if(members.some(id=>!candidates.some(value=>value.nativeId===id)))throw Error('Choose actual native Grok bot IDs, not Aexus employee IDs')
   if(same(item.members,members))return {profile:item,candidates}
   version(item,args.expectedVersion);guard(provider,current.account);await setNativeMembers(item,members);const saved=await waitForProfile(provider,target,value=>same(value.members,members));guard(provider,current.account);deps.updated(saved);await directory(provider,true);return {profile:saved,candidates}
  }
  if(command==='bot.control'){
   const action=args.action as NativeBotAction;editable(item,action);version(item,args.expectedVersion)
   if(action==='new-conversation'&&args.confirmNativeId!==target)throw Error('Confirm the exact native ID before starting a fresh conversation')
   return durable(provider,args.clientRequestId,{command,...args},async()=>{
    guard(provider,current.account);const result=await controlNative(item,action,args.clientRequestId)
    const saved=result?.nativeId?await readNativeProfile(provider,result.nativeId):action==='pause'||action==='resume'?await waitForProfile(provider,target,value=>value.paused===(action==='pause')):action==='primary'?await waitForProfile(provider,target,value=>value.primary===true):await readNativeProfile(provider,target)
    guard(provider,current.account);deps.updated(saved);await directory(provider,true);return saved
   })
  }
  if(command==='bot.native-delete'){
   editable(item,'delete');version(item,args.expectedVersion);if(args.confirmNativeId!==target)throw Error('Confirm the exact native ID before deleting the native bot or group')
   return durable(provider,args.clientRequestId,{command,...args},async()=>{
    guard(provider,current.account);await deleteNative(item);const remaining=await directory(provider,true);if(!remaining.complete||remaining.items.some(value=>value.nativeId===target))throw Error('Native deletion has not been confirmed. Refresh before retrying.')
    guard(provider,current.account);await deps.archive(item);return {deleted:true,provider,nativeId:target,historyRetained:true}
   })
  }
  throw Error('Unknown native bot management command')
 })
}
