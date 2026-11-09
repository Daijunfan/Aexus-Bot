import {api} from './api'
import {SnapshotDecoder} from '../../shared/snapshot-wire'
const decoder=new SnapshotDecoder()
let generation=0
api.onEvent(event=>{if(['client:connected','client:authentication'].includes(event.channel)){generation++;decoder.clear()}})
setInterval(()=>decoder.prune(),30000)
/** Full results and immutable history for internal readers; public api.call stays unchanged. */
export async function readSnapshot<T>(command:'worker.snapshot'|'session.snapshot',args:Record<string,unknown>):Promise<T>{
 if(!api.snapshot)return api.call<T>(command,args)
 const key=JSON.stringify([command,args]),base=decoder.base(key),epoch=generation
 try{return decoder.decode<T>(key,await api.snapshot(command,args,base?.token),base,epoch===generation)}catch(error){
  if((error as {code?:string}).code==='SNAPSHOT_BASE_MISSING')return decoder.decode<T>(key,await api.snapshot(command,args),undefined,epoch===generation)
  const failure=error as {message?:string;code?:string};if(error instanceof Error)throw error;throw Object.assign(Error(failure.message??String(error)),failure.code?{code:failure.code}:{})
 }
}
