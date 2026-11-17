import {readStore} from './store'
import {employeeSettings,type Engine,type NativeOrigin,type StoredSession,type Item} from '../shared/types'
import {cloudHostTarget,getCloudHost} from './cloud-hosts'
import {remoteFiles,hostConnectionId} from './tunnel'
import {remoteAgentCommand,readRemoteClaudeSession,listRemoteClaudeSessions} from './remote-agent-process'
import {withCodexSessionApi} from './native-sessions'
import {cloudDirectory} from './workspaces'
import type {RemoteTarget} from '../shared/remote'

export function cloudNativeTarget(card:StoredSession):{target:RemoteTarget;origin:NativeOrigin}{
  const settings=employeeSettings(readStore(),card),hostId=settings.hostId??card.hostId
  const remote=settings.remote??(hostId?cloudHostTarget(hostId,card.remoteRoot??card.cwd):undefined)
  if(card.kind!=='cloud-native-worker'||settings.mode!=='cloud'||!hostId||!remote)throw new Error('Cloud Native Worker 必须绑定已注册的云主机')
  const target={...remote,directory:card.cwd},origin:NativeOrigin={kind:'cloud',hostId,host:remote.host,os:remote.os,directory:card.cwd}
  if(card.nativeOrigin&&JSON.stringify(card.nativeOrigin)!==JSON.stringify(origin))throw new Error('云主机身份已变化；旧原生会话不会连接到另一台主机')
  return {target,origin}
}

export async function checkCloudNative(hostId:string,engine:Engine,directory?:string){
  if(!hostId)throw new Error('请先选择已注册的云主机')
  if(engine!=='codex'&&engine!=='claude')throw new Error('请选择 Codex 或 Claude Code')
  const host=getCloudHost(hostId),target=cloudHostTarget(hostId,directory)
  const scope=await remoteFiles(hostConnectionId(hostId),target,'directory',{path:'.'})
  const version=await remoteAgentCommand({...target,directory:scope.path},engine,['--version'])
  if(version.code!==0)throw new Error(`该云主机未找到 ${engine==='codex'?'Codex':'Claude Code'}：${version.stderr||version.stdout||'CLI 不可执行'}`)
  if(engine==='codex')await withCodexSessionApi(call=>call('model/list',{limit:1}),{nativeRemote:{...target,directory:scope.path}})
  else{
    const help=await remoteAgentCommand({...target,directory:scope.path},'claude',['--help'])
    if(help.code!==0||!help.stdout.includes('stream-json'))throw new Error('云端 Claude Code 版本不支持 SDK 所需的 stream-json 协议')
  }
  const auth=await remoteAgentCommand({...target,directory:scope.path},engine,engine==='codex'?['login','status']:['auth','status','--json'])
  let authentication:'configured'|'not-signed-in'|'unknown'='unknown'
  if(auth.code===0){try{const value=JSON.parse(auth.stdout);authentication=value.loggedIn===false?'not-signed-in':'configured'}catch{authentication='configured'}}
  else if(/not logged|not authenticated|未登录|not signed|login required/i.test(auth.stdout+' '+auth.stderr))authentication='not-signed-in'
  if(authentication==='not-signed-in')throw new Error(`云端 ${engine==='codex'?'Codex':'Claude Code'} 尚未登录；请在该主机配置认证`)
  return {hostId,host:host.name,engine,version:version.stdout||version.stderr,directory:scope.path,authentication,protocol:'stdio'}
}

export async function listCloudNativeSessions(hostId:string,engine:Engine,directory?:string){
  const target=cloudHostTarget(hostId,directory),settings={mode:'cloud' as const,hostId,directory:target.directory,remote:target}
  await checkCloudNative(hostId,engine,target.directory)
  const inScope=(cwd:string|null|undefined)=>{if(!cwd)return false;try{return directory?cloudDirectory(settings,cwd)===cwd:true}catch{return false}}
  if(engine==='codex'){
    const result=await withCodexSessionApi(call=>call('thread/list',{limit:100}),{nativeRemote:target})
    return {sessions:(result.data??[]).filter((thread:any)=>inScope(thread.cwd)).map((thread:any)=>({id:thread.id,cwd:thread.cwd,preview:String(thread.name??thread.preview??''),updatedAt:thread.updatedAt,engine}))}
  }
  const result=await listRemoteClaudeSessions(target)
  return {sessions:result.sessions.filter(session=>inScope(session.cwd)).map(session=>({...session,engine}))}
}

export async function readCloudNativeSession(card:StoredSession,sessionId:string):Promise<Item[]>{
  if(!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId))throw new Error('无效的远端原生会话 ID')
  const {target}=cloudNativeTarget(card)
  if(card.engine==='claude'){
    const result=await readRemoteClaudeSession(target,sessionId)
    if(result.cwd!==card.cwd)throw new Error('原生会话工作目录与该员工不一致；请绑定到同一目录')
    return result.items.map((item,index)=>item.role==='user'?{role:'user',id:`native-u-${index}`,text:item.text}:{role:'assistant',id:`native-a-${index}`,blocks:[{kind:'text',text:item.text}]})
  }
  const result=await withCodexSessionApi(call=>call('thread/read',{threadId:sessionId,includeTurns:true}),{nativeRemote:target})
  if(result.thread?.cwd!==card.cwd)throw new Error('原生会话工作目录与该员工不一致；请绑定到同一目录')
  const items:Item[]=[]
  for(const turn of result.thread.turns??[])for(const item of turn.items??[]){
    if(item.type==='userMessage'){
      const text=(item.content??[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n')
      if(text)items.push({role:'user',id:item.id??`native-u-${items.length}`,text})
    }else if(item.type==='agentMessage'&&item.text)items.push({role:'assistant',id:item.id??`native-a-${items.length}`,blocks:[{kind:'text',text:item.text}]})
  }
  return items
}
