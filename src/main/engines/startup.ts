import path from 'node:path'
import {homedir} from 'node:os'
import type {RemoteTarget} from '../../shared/remote'
const starting=new Map<string,Promise<void>>()
/** Serialize only startup handshakes sharing native state, never turns or tool execution. */
export async function acquireCodexStartup(remote?:RemoteTarget,profile?:string,signal?:AbortSignal){
  signal?.throwIfAborted()
  const key=remote?JSON.stringify([remote.host,remote.port??22,remote.jump??'',remote.credentialId??'']):profile??process.env.CODEX_HOME??path.join(homedir(),'.codex')
  const previous=starting.get(key)??Promise.resolve()
  let release!:()=>void
  const current=new Promise<void>(resolve=>{release=resolve})
  const tail=previous.then(()=>current)
  starting.set(key,tail)
  // A canceled slot still follows its predecessor; later startups cannot pass it.
  void tail.then(()=>{if(starting.get(key)===tail)starting.delete(key)})
  let done=false,abort:(()=>void)|undefined
  const unlock=()=>{if(done)return;done=true;release()}
  try{
    await (signal?new Promise<void>((resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});void previous.then(resolve)}):previous)
    signal?.throwIfAborted()
  }catch(error){unlock();throw error}finally{if(abort)signal?.removeEventListener('abort',abort)}
  return unlock
}
