import {prepareDeepseek} from './deepseek-config'
import fs from 'node:fs'
import path from 'node:path'
import {StringDecoder} from 'node:string_decoder'
import spawn from 'cross-spawn'
import {spawnEmployeeProcess} from '../agent-process-isolation'
import {terminateTree} from '../platform'
import {childEnv} from '../exec'
import {engineExecutable} from './executable'
import {engineProcessEnvironment} from './configuration'
import {copyNativeConnection} from './native-config'
import {codeConfig,codeCredential,type NativeAcpEngine} from './opencode-config'
import type {AcpPermission} from './cline-client'

/** Native ACP over stdio. Native config is shared; employee session data is private. */
export function nativeAcpClient(options:{engine:NativeAcpEngine;cwd:string;directory:string;employeeId?:string;onUpdate?:(update:any)=>void;onPermission?:(request:AcpPermission)=>Promise<any>}){
 const {engine,directory}=options
 fs.mkdirSync(directory,{recursive:true,mode:0o700})
 const config=codeConfig(engine),data=path.join(directory,'data')
 if(engine!=='deepseek')copyNativeConnection(config.authFile,path.join(data,engine,'auth.json'))
 // Override concrete native rules too: a wildcard cannot override an existing edit/bash allow.
 const permission=Object.fromEntries([...new Set(['*','read','edit','glob','grep','list','bash','external_directory','todowrite','question','webfetch','websearch','lsp','doom_loop','skill',...Object.keys(config.data.permission??{})])].map(name=>[name,'ask']))
 permission.task='deny'
 // Native Plan agents may hide unknown MCP tools. Core remains the authority for
 // each command, including allowing user replies while rejecting planning writes.
 permission['agents-company_*']='ask'
 const nativeContent=JSON.parse(process.env[engine.toUpperCase()+'_CONFIG_CONTENT']||'{}')
 const dsh=engine==='deepseek'?prepareDeepseek(directory):undefined
 const env={...engineProcessEnvironment(engine,childEnv(options.cwd)),XDG_DATA_HOME:data,XDG_STATE_HOME:path.join(directory,'state'),[engine.toUpperCase()+'_CONFIG_CONTENT']:JSON.stringify({...nativeContent,permission,agent:{...nativeContent.agent,plan:{...nativeContent.agent?.plan,permission:{...nativeContent.agent?.plan?.permission,'agents-company_*':'ask'}}}})}
 Object.assign(env,dsh?.env)
 const launchArgs=dsh?.args??['acp','--cwd',options.cwd]
 const processOptions={cwd:options.cwd,env,stdio:['pipe','pipe','pipe'] as ['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'}
 const child=options.employeeId?spawnEmployeeProcess(options.employeeId,engineExecutable(engine),launchArgs,processOptions):spawn(engineExecutable(engine),launchArgs,processOptions)
 const secrets=[...(dsh?.secrets??[]),...Object.entries(env).filter(([name,value])=>/key|token|password/i.test(name)&&value&&value.length>8).map(([,value])=>value!),...Object.values(config.auth).flatMap((a:any)=>[a.key,a.access,a.refresh].filter(v=>typeof v==='string'&&v.length>8)),...Object.values(config.providers).map(p=>codeCredential(p.options?.apiKey)).filter((v):v is string=>!!v&&v.length>8)]
 const redact=(text:string)=>secrets.reduce((value,secret)=>value.replaceAll(secret,'[redacted]'),text)
 let sequence=0,stderr='',closed=false,buffer='';const decoder=new StringDecoder('utf8')
 const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>}>()
 const fail=(error:Error)=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error)}pending.clear()}
 child.stderr?.on('data',data=>stderr=redact(stderr+String(data)).slice(-4096));child.once('error',error=>fail(Error(redact(error.message))))
 const exited=new Promise<void>(resolve=>child.once('close',code=>{closed=true;fail(Error(engine+' exited ('+code+'): '+stderr));resolve()}))
 const send=(message:unknown)=>{if(closed||!child.stdin?.writable)throw Error(engine+' ACP is closed');child.stdin.write(JSON.stringify(message)+'\n')}
 const consume=(line:string)=>{
  let message:any;try{message=JSON.parse(line)}catch{fail(Error(engine+' emitted invalid ACP JSON'));return}
  if(message.method&&message.id!==undefined){
   const reply=message.method==='session/request_permission'&&options.onPermission?options.onPermission(message.params):Promise.resolve({outcome:{outcome:'cancelled'}})
   void reply.then(result=>{if(!closed)send({jsonrpc:'2.0',id:message.id,result})}).catch(error=>{if(!closed)send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:redact(String(error))}})})
  }else if(message.method==='session/update')options.onUpdate?.(message.params.update)
  else if(pending.has(message.id)){const item=pending.get(message.id)!;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(redact([message.error.message,message.error.data&&JSON.stringify(message.error.data)].filter(Boolean).join(': ')||JSON.stringify(message.error)).slice(0,4096))):item.resolve(message.result)}
 }
 child.stdout?.on('data',data=>{buffer+=decoder.write(data);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(line)consume(line)}})
 return {redact,
  call(method:string,params:Record<string,unknown>={},timeout=30000):Promise<any>{return new Promise((resolve,reject)=>{const id=++sequence,timer=timeout?setTimeout(()=>{pending.delete(id);reject(Error(engine+' '+method+' timed out'))},timeout):undefined;pending.set(id,{resolve,reject,timer});try{send({jsonrpc:'2.0',id,method,params})}catch(error){pending.delete(id);clearTimeout(timer);reject(error)}})},
  notify(method:string,params:Record<string,unknown>={}){send({jsonrpc:'2.0',method,params})},
  async close(){if(closed)return;child.stdin?.end();terminateTree(child);const timer=setTimeout(()=>terminateTree(child,true),2000);try{await exited}finally{clearTimeout(timer)}}
 }
}
