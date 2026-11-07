import path from 'node:path'
import {spawn} from 'node:child_process'
import type {RemoteTarget} from '../shared/remote'
import {nativeWorkerEnv} from './native-worker-env'
import {tunnelConfig,tunnelDirectory,python} from './tunnel'
import {terminateTree} from './platform'

/** Scripts use raw pipes, never an interactive terminal or a Coding Agent wrapper. */
export function spawnMonitor(program:string[],cwd:string,root:string,remote?:RemoteTarget|null){
 const config=remote?{target:tunnelConfig({...remote,directory:cwd}),root,program}:{local:true,cwd,root,program}
 const child=spawn(python(),[path.join(tunnelDirectory(),'monitor_process.py'),Buffer.from(JSON.stringify(config)).toString('base64url')],{env:nativeWorkerEnv(),stdio:['pipe','pipe','pipe'],detached:true,windowsHide:true})
 const done=new Promise<void>(resolve=>child.once('close',()=>resolve()))
 child.stdin.on('error',()=>{})
 return {child,done,async stop(){
  if(child.exitCode!==null||child.signalCode!==null)return
  child.stdin.end()
  const timer=setTimeout(()=>terminateTree(child,true),4500)
  try{await done}finally{clearTimeout(timer)}
 }}
}
