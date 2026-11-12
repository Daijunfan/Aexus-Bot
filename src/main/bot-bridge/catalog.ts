import {createHash} from 'node:crypto'
import type {BotProvider} from '../../shared/bot-workers'
import type {NativeBotAction,NativeBotProfile,NativeBotPatch} from '../../shared/bot-management'
import {hasBotFixture,callBotFixture} from './client'
import * as dots from './dots'
import * as grok from './grok'
import {getChatGptAuth,getGrokAuth} from './credentials'

const grokActions:NativeBotAction[]=['rename','configure','interrupt','new-conversation','duplicate','delete']
const dotActions:NativeBotAction[]=['rename','pause','resume','primary','delete']
export function nativeAccountKey(provider:BotProvider){
 if(hasBotFixture())return 'fixture:'+provider
 const auth=provider==='dots'?getChatGptAuth():getGrokAuth({maxAgeMs:0})
 return createHash('sha256').update(provider+':'+(auth.accountId??'')+':'+(auth.userId??'')).digest('hex')
}
export function profileVersion(profile:Omit<NativeBotProfile,'version'>){return createHash('sha256').update(JSON.stringify([profile.provider,profile.nativeId,profile.name,profile.description,profile.title??'',profile.members.slice().sort(),profile.grokShape??'',profile.grokColor??'',profile.paused??null,profile.primary??null])).digest('hex')}
function finish(profile:Omit<NativeBotProfile,'version'>):NativeBotProfile{return {...profile,version:profileVersion(profile)}}
function grokProfile(a:any):NativeBotProfile{
 const group=a.kind===2||a.kind==='ROOM'||a.kind==='GROK_BOT_AGENT_KIND_ROOM',canManage=a.viewerIsOwner===true||a.viewerCanManage===true
 return finish({provider:'grok',nativeId:a.agentId||a.legacyAgentId,messagingId:a.agentId||a.legacyAgentId,name:a.name||'Grok Bot',description:a.description??'',title:a.title??'',kind:group?'group':'private',members:a.memberAgentIds??[],grokShape:a.avatarShape??'blob',grokColor:a.avatarColor??'black',canManage,actions:canManage?[...grokActions,...(group?['members' as const]:[])]:[]})
}
function dotProfile(a:any):NativeBotProfile{
 const shared=a.scope==='shared',canManage=!shared||a.viewer_role==='owner'||a.viewer_role==='admin'
 return finish({provider:'dots',nativeId:a.id,messagingId:a.messaging_room_id??undefined,name:a.display_name||'Dot',description:a.description??'',kind:'private',members:[],paused:a.is_paused??false,primary:a.is_primary??false,shared,threadId:a.active_root_thread_id??a.root_thread_id,canManage,actions:canManage?dotActions:[]})
}
function fixtureProfile(a:any,provider:BotProvider):NativeBotProfile{
 const profile={...a,...(provider==='grok'?{grokShape:a.grokShape??'blob',grokColor:a.grokColor??'black'}:{}),provider,nativeId:a.nativeId??a.id,messagingId:Object.hasOwn(a,'messagingId')?a.messagingId??undefined:a.id,description:a.description??'',kind:a.kind??'private',members:a.members??a.participantIds??[],canManage:a.canManage!==false,actions:a.canManage===false?[]:a.actions??(provider==='grok'?[...grokActions,...(a.kind==='group'?['members']:[])]:dotActions)}
 return finish(profile)
}
export async function readNativeCatalog(provider:BotProvider):Promise<{items:NativeBotProfile[];complete:boolean}>{
 if(hasBotFixture()){const value=await callBotFixture('list',{provider});return {items:value.map((a:any)=>fixtureProfile(a,provider)),complete:true}}
 if(provider==='grok'){
  const result=await grok.rpc('ListGrokBotAgents',{includeTeamAgents:true})
  return {items:(result.agents??[]).filter((a:any)=>a.agentId||a.legacyAgentId).map(grokProfile),complete:result.truncated!==true}
 }
 const items:NativeBotProfile[]=[],seen=new Set<string>();let cursor:string|undefined
 do{
  const query=new URLSearchParams({limit:'25',include_room_preview:'false',...(cursor?{cursor}:{})}),r=await dots.api('/tbo?'+query)
  if(r.status!==200||!Array.isArray(r.data?.items))throw Error('Dot directory request failed (HTTP '+r.status+')')
  items.push(...r.data.items.map(dotProfile));cursor=r.data.cursor??undefined
  if(cursor&&seen.has(cursor))throw Error('Dot returned a repeated directory cursor; the listing is incomplete')
  if(cursor)seen.add(cursor)
 }while(cursor)
 return {items:[...new Map(items.map(item=>[item.nativeId,item])).values()],complete:true}
}
export async function readNativeProfile(provider:BotProvider,id:string){
 if(provider==='dots'&&!hasBotFixture()){
  const r=await dots.api('/tbo/'+encodeURIComponent(id));if(r.status!==200)throw Object.assign(Error('Native Dot is unavailable (HTTP '+r.status+')'),{status:r.status});return dotProfile(r.data)
 }
 const result=await readNativeCatalog(provider),item=result.items.find(item=>item.nativeId===id)
 if(!item)throw Object.assign(Error(result.complete?'Native bot or group no longer exists or is not visible':'The native directory is incomplete; refresh before managing this item'),{status:result.complete?404:409})
 return item
}
export async function connectNativeProfile(profile:NativeBotProfile){
 if(profile.messagingId)return profile
 if(profile.provider!=='dots')throw Error('The native conversation is unavailable')
 if(hasBotFixture()){const value=await callBotFixture('connect',{provider:'dots',nativeId:profile.nativeId});return fixtureProfile(value,'dots')}
 const r=await dots.api('/tbo/'+encodeURIComponent(profile.nativeId)+'/messaging-room',{method:'POST'})
 if(r.status!==200&&r.status!==201||!r.data?.messaging_room_id)throw Error('Dot did not confirm its messaging room')
 return dotProfile({...r.data,id:profile.nativeId})
}
export async function configureNative(profile:NativeBotProfile,patch:NativeBotPatch){
 if(hasBotFixture())return callBotFixture('configure',{provider:profile.provider,nativeId:profile.nativeId,patch})
 if(profile.provider==='dots'){
  if(Object.keys(patch).some(key=>key!=='name'))throw Error('The current Dot protocol only exposes native name editing; other fields are read-only')
  const r=await dots.api('/tbo/'+encodeURIComponent(profile.nativeId),{method:'PATCH',body:{display_name:patch.name}});if(r.status!==200)throw Error('Dot profile update failed (HTTP '+r.status+')');return
 }
 const names:Record<string,string>={grokShape:'avatarShape',grokColor:'avatarColor'}
 await grok.rpc('UpdateGrokBotAgent',{id:profile.nativeId,partialUpdate:true,...Object.fromEntries(Object.entries(patch).map(([key,value])=>[names[key]??key,value]))})
}
export async function setNativeMembers(profile:NativeBotProfile,members:string[]){
 if(hasBotFixture())return callBotFixture('members',{provider:profile.provider,nativeId:profile.nativeId,members})
 await grok.rpc('SetGrokBotRoomMembers',{agentId:profile.nativeId,memberAgentIds:members})
}
export async function createNativeProfile(provider:BotProvider,values:{name:string;description:string;kind:'private'|'group';members:string[];requestId:string}){
 if(hasBotFixture()){const result=await callBotFixture('native-create',{provider,...values});return fixtureProfile(result,provider)}
 if(provider==='grok'){
  const r=values.kind==='group'?await grok.rpc('CreateGrokBotRoom',{agentId:values.requestId,name:values.name,description:values.description,memberAgentIds:values.members,humanMemberUserIds:[]}):await grok.rpc('CreateGrokBotTemporalAgent',{agentId:values.requestId,name:values.name,description:values.description,harness:'GROK_BOT_AGENT_HARNESS_KIND_TEMPORAL',introductionSuppressed:true,kickstartRequested:false})
  if(r.agent?.agentId!==values.requestId)throw Error('Grok did not confirm the requested native creation identity');return grokProfile(r.agent)
 }
 const r=await dots.api('/tbo',{method:'POST',body:{display_name:values.name,description:values.description,avatar_type:'default',avatar_manifest:{schema_version:1,tint:'gray'},create_thread:true,should_initialize:true,create_additional:true}})
 if(r.status!==200&&r.status!==201||!r.data?.id)throw Object.assign(Error('Dot creation was not confirmed (HTTP '+r.status+'). '+(typeof r.data?.detail==='string'?r.data.detail:'')),{status:r.status})
 return dotProfile(r.data)
}
export async function controlNative(profile:NativeBotProfile,action:NativeBotAction,requestId:string){
 if(hasBotFixture()){const value=await callBotFixture('control',{provider:profile.provider,nativeId:profile.nativeId,action,requestId});return action==='duplicate'?fixtureProfile(value,profile.provider):undefined}
 if(profile.provider==='dots'){
  const r=action==='primary'?await dots.api('/tbo/primary',{method:'PUT',body:{tbo_id:profile.nativeId}}):await dots.api('/tbo/'+encodeURIComponent(profile.nativeId)+'/runtime/'+action,{method:'POST',body:{}})
  if(r.status<200||r.status>=300)throw Error('Dot control failed (HTTP '+r.status+')');if(r.data?.status==='unconfirmed')throw Error('Dot has not confirmed the requested runtime state; refresh before retrying');return
 }
 if(action==='duplicate'){const r=await grok.rpc('DuplicateGrokBotAgent',{sourceAgentId:profile.nativeId,agentId:requestId});if(r.agent?.agentId!==requestId)throw Error('Grok did not confirm the duplicate identity');return grokProfile(r.agent)}
 await grok.rpc(action==='interrupt'?'InterruptGrokBotAgentRun':'StartFreshGrokBotConversation',{agentId:profile.nativeId,...(action==='interrupt'?{reason:'user-request'}:{})})
}
export async function deleteNative(profile:NativeBotProfile){
 if(hasBotFixture())return callBotFixture('native-delete',{provider:profile.provider,nativeId:profile.nativeId})
 if(profile.provider==='grok'){await grok.rpc('DeleteGrokBotAgent',{id:profile.nativeId});return}
 const query=profile.threadId?'?'+new URLSearchParams({thread_id:profile.threadId}):''
 const r=await dots.api('/tbo/'+encodeURIComponent(profile.nativeId)+query,{method:'DELETE'});if(![200,204,404,410].includes(r.status))throw Error('Dot deletion was not confirmed (HTTP '+r.status+')')
}
