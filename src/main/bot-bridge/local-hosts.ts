import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto'
import {stripVTControlCharacters,promisify} from 'node:util'
import {APP_HOME} from '../../shared/protocol'
import type {BotProvider,BotLocalComputer} from '../../shared/bot-workers'
import {atomicJson,readJson} from '../atomic-file'
import {nativeWorkerEnv} from '../native-worker-env'
import {protocolLines,protocolJson} from '../protocol-lines'
import {terminateTree} from '../platform'
import {getChatGptAuth,getGrokAuth,getGrokComputerKeys,decodeJwt} from './credentials'
import {httpJson,resolveProxy} from './http'
import * as dots from './dots'
import * as grok from './grok'

type Runtime={running:()=>boolean;close:()=>Promise<void>}
type Update=(state:BotLocalComputer['state'],error?:string)=>void
export type LocalHostStarter=(provider:BotProvider,signal:AbortSignal,update:Update)=>Promise<Runtime>
type Entry={value:BotLocalComputer;life:AbortController;opening?:Promise<void>;closing?:Promise<void>;runtime?:Runtime;retryAt:number}

/** One Core-owned native executor per provider; message delivery never waits for process startup. */
export function createBotLocalHosts(start:LocalHostStarter,changed:(provider:BotProvider)=>void=()=>{}){
 const entries=new Map<BotProvider,Entry>();let revision=0,closed=false
 const stop=(provider:BotProvider)=>{const entry=entries.get(provider);if(!entry)return Promise.resolve();return entry.closing??=(async()=>{entry.life.abort();await entry.opening;await entry.runtime?.close();if(entries.get(provider)===entry)entries.delete(provider);changed(provider)})()}
 const ensure=async(providers:BotProvider[])=>{
  if(closed)return
  const version=++revision,wanted=new Set(providers);await Promise.all([...entries.keys()].filter(provider=>!wanted.has(provider)).map(stop));if(version!==revision||closed)return
  await Promise.all([...wanted].map(async provider=>{
   let entry=entries.get(provider)
   if(entry?.closing){await entry.closing;if(version!==revision||closed)return;entry=entries.get(provider)}
   if(entry&&(entry.opening||entry.runtime?.running()||entry.retryAt>Date.now()))return
   if(entry){await stop(provider);if(version!==revision||closed)return}
   entry={value:{state:'starting'},life:new AbortController(),retryAt:0};entries.set(provider,entry)
   const current=entry,update:Update=(state,error)=>{if(entries.get(provider)!==current||current.life.signal.aborted)return;current.value={state,...(error?{error}:{}),...(state==='connected'?{connectedAt:Date.now()}:current.value.connectedAt?{connectedAt:current.value.connectedAt}:{})};if(state==='error')current.retryAt=Date.now()+30000;changed(provider)}
   update('starting')
   current.opening=start(provider,current.life.signal,update).then(async runtime=>{current.runtime=runtime;if(current.life.signal.aborted)await runtime.close()}).catch(error=>{if(!current.life.signal.aborted)update('error',safeError(error))}).finally(()=>{current.opening=undefined})
   await current.opening
  }))
 }
 return {ensure,status:(provider:BotProvider):BotLocalComputer=>{const entry=entries.get(provider);return entry&&!entry.life.signal.aborted?entry.value:{state:'stopped'}},close:()=>{closed=true;revision++;return Promise.all([...entries.keys()].map(stop)).then(()=>{})}}
}

function safeError(error:unknown){return (error instanceof Error?error.message:String(error)).replace(/Bearer\s+\S+/gi,'Bearer <redacted>').replace(/https?:\/\/[^\s"']+/g,'<service>').replace(/\b[A-Za-z0-9_-]{48,}\b/g,'<redacted>').slice(0,400)}
const home=os.homedir(),runtimeDir=path.join(APP_HOME,'bot-local-hosts')
function application(name:string){const dir=[path.join('/Applications',name+'.app'),path.join(home,'Applications',name+'.app')].find(dir=>fs.existsSync(dir));if(!dir)throw Error(`Install ${name} once to provide its native background executor.`);return dir}
function alive(pid:unknown){if(!Number.isInteger(pid)||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true}catch{return false}}
async function nativePeer(binary:string,environmentId:string){const {stdout}=await promisify(execFile)('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',timeout:3000,maxBuffer:4*1024*1024});for(const line of stdout.split('\n')){const match=/^\s*(\d+)\s+(.+)$/.exec(line);if(match&&match[2].startsWith(binary+' ')&&match[2].includes(' exec-server ')&&match[2].includes('--environment-id '+environmentId))return Number(match[1])}}
function unseal(file:string,key:string){const value=readJson<any>(file,()=>undefined);if(!value||value.sandSealedFile!==1)return value;const raw=Buffer.from(value.data,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'))}
function seal(file:string,value:unknown,key:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv),body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);atomicJson(file,{sandSealedFile:1,data:Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')},true)}

function nativeProcess(name:BotProvider,command:string,args:string[],env:NodeJS.ProcessEnv,signal:AbortSignal,update:Update,onLine:(line:string)=>void,onSpawn?:(child:ChildProcess)=>void,cleanup=()=>{},keep=()=>false):Runtime{
 signal.throwIfAborted()
 fs.mkdirSync(runtimeDir,{recursive:true,mode:0o700})
 const logFile=path.join(runtimeDir,name+'.log'),fd=fs.openSync(logFile,'a',0o600);let position=fs.fstatSync(fd).size,pending=''
 const child=spawn(command,args,{cwd:home,env,windowsHide:true,detached:true,stdio:['pipe',fd,fd,...(onSpawn?['ipc' as const]:[])]});fs.closeSync(fd)
 let ended=false,closing=false,retired=false,lastError='Native computer executor stopped',closePromise:Promise<void>|undefined
 const tail=()=>{let input:number|undefined;try{input=fs.openSync(logFile,'r');const size=fs.fstatSync(input).size;if(size<position)position=0;const buffer=Buffer.alloc(16384);while(position<size){const count=fs.readSync(input,buffer,0,Math.min(buffer.length,size-position),position);if(!count)break;position+=count;const lines=(pending+buffer.toString('utf8',0,count)).split('\n');pending=lines.pop()!.slice(-16384);for(const line of lines){if(/fatal:|error:|registration.*failed/i.test(line))lastError=safeError(line);onLine(line)}}}catch(error){if(!closing)update('error',safeError(error))}finally{if(input!==undefined)fs.closeSync(input)}}
 fs.watchFile(logFile,{interval:250,persistent:false},tail)
 const retire=()=>{if(retired)return;retired=true;fs.unwatchFile(logFile,tail);try{cleanup()}catch(error){if(!closing)update('error',safeError(error))}}
 const exit=new Promise<void>(resolve=>{child.once('error',error=>{lastError=safeError(error);ended=true;retire();if(!closing)update('error',lastError);resolve()});child.once('exit',code=>{tail();ended=true;retire();if(!closing)update('error',code===0?'Native computer connection ended':lastError);resolve()})})
 if(onSpawn)child.once('spawn',()=>{if(!closing)onSpawn(child)})
 const close=()=>closePromise??=(async()=>{closing=true;signal.removeEventListener('abort',abort);if(ended)return;if(keep()){retire();child.unref();return}child.stdin?.end();terminateTree(child);const force=setTimeout(()=>terminateTree(child,true),3000);try{await exit}finally{clearTimeout(force)}})()
 const abort=()=>{void close()};signal.addEventListener('abort',abort,{once:true})
 if(signal.aborted)void close()
 return {running:()=>!ended,close}
}

/** Read native plugin metadata without importing employee sessions or starting an inference turn. */
async function dotPlugins(binary:string,env:NodeJS.ProcessEnv,signal:AbortSignal):Promise<any>{
 signal.throwIfAborted()
 const child=spawn(binary,['app-server','--listen','stdio://'],{cwd:home,env,detached:true,stdio:['pipe','pipe','pipe']}),lines=protocolLines(child.stdout),ended=new Promise<void>(resolve=>child.once('close',()=>resolve()))
 let diagnostic='',timer:NodeJS.Timeout|undefined,abort=()=>{}
 child.stderr.on('data',chunk=>diagnostic=(diagnostic+chunk).slice(-4000))
 try{return await new Promise((resolve,reject)=>{
  const fail=(error:unknown)=>reject(error instanceof Error?error:Error(String(error)))
  abort=()=>{terminateTree(child);fail(Error('Native plugin discovery cancelled'))};signal.addEventListener('abort',abort,{once:true})
  timer=setTimeout(()=>fail(Error('Native plugin discovery timed out')),15000);child.once('error',fail);child.stdin.on('error',fail);child.once('close',()=>fail(Error(diagnostic||'Native plugin discovery stopped')))
  lines.on('line',line=>{let reply:any;try{reply=JSON.parse(line)}catch{return}if(reply.error){fail(Error(reply.error.message));return}if(reply.id===1){child.stdin.write(protocolJson({method:'initialized'})+'\n');child.stdin.write(protocolJson({id:2,method:'plugin/installed',params:{}})+'\n')}else if(reply.id===2)resolve(reply.result)})
  child.stdin.write(protocolJson({id:1,method:'initialize',params:{clientInfo:{name:'aexus_native_computer',version:'1'},capabilities:{experimentalApi:true}}})+'\n')
  if(signal.aborted)abort()
 })}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);lines.close();child.stdin.end();terminateTree(child);const force=setTimeout(()=>terminateTree(child,true),1500);try{await ended}finally{clearTimeout(force)}}
}

async function startDot(signal:AbortSignal,update:Update):Promise<Runtime>{
 const app=application('ChatGPT'),binary=path.join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
 if(!fs.existsSync(binary))throw Error('The installed ChatGPT app does not contain its native exec-server.')
 const file=path.join(runtimeDir,'dots-installation.json'),saved=readJson<{id:string}>(file,()=>{
  const original=[path.join(home,'Library/Application Support/Codex/.codex-tpp-local-executor-installation-id'),path.join(home,'Library/Application Support/ChatGPT/.codex-tpp-local-executor-installation-id')].find(file=>fs.existsSync(file)),id=original?fs.readFileSync(original,'utf8').trim():randomUUID()
  return {id}
 });if(!fs.existsSync(file))atomicJson(file,saved,true)
 const auth=getChatGptAuth(),installed=await dotPlugins(binary,{...nativeWorkerEnv(),CODEX_HOME:path.dirname(auth.source)},signal)
 const roots=[{id:'codex-home-skills',path:path.join(home,'.codex/skills')},...(installed.marketplaces??[]).flatMap((marketplace:any)=>(marketplace.plugins??[]).filter((plugin:any)=>plugin.installed&&plugin.enabled).flatMap((plugin:any)=>{
  const cached=plugin.localVersion?path.join(home,'.codex/plugins/cache',marketplace.name,plugin.name,plugin.localVersion):undefined,root=cached&&fs.existsSync(cached)?cached:plugin.source?.type==='local'?plugin.source.path:undefined
  return root?[{id:plugin.id,path:root}]:[]
 })).slice(0,255)]
 let displayName=os.hostname();try{const {stdout}=await promisify(execFile)('/usr/sbin/scutil',['--get','ComputerName'],{encoding:'utf8',timeout:1000,maxBuffer:4096,env:nativeWorkerEnv()});displayName=stdout.trim()||displayName}catch{}
 const registration=await httpJson('https://chatgpt.com/backend-api/flora/cca/executor',{method:'POST',headers:{...dots.headers(auth),'content-type':'application/json'},body:{displayName,installation_id:saved.id,selected_capability_roots:roots},signal,timeoutMs:45000})
 if(registration.status!==200||typeof registration.data?.executor_id!=='string')throw Error('Dot computer registration failed (HTTP '+registration.status+'). Check the native ChatGPT login.')
 signal.throwIfAborted()
 const peer=await nativePeer(binary,registration.data.executor_id);if(peer){update('external');return {running:()=>alive(peer),close:async()=>{}}}
 const env:NodeJS.ProcessEnv={...nativeWorkerEnv(),CODEX_HOME:path.dirname(auth.source),CODEX_EXEC_SERVER_EXIT_ON_STDIN_CLOSE:'true',CODEX_INTERNAL_ORIGINATOR_OVERRIDE:'codex_work_desktop',LOG_FORMAT:'json',RUST_LOG:'info,codex_exec_server::remote=info'}
 const proxy=await resolveProxy('https://codex-cloud-environments.chatgpt.com');if(proxy){env.HTTPS_PROXY??=env.https_proxy??proxy;env.HTTP_PROXY??=env.http_proxy??proxy}
 return nativeProcess('dots',binary,['-c','forced_login_method="chatgpt"','exec-server','--concurrent-requests','32','--remote','https://codex-cloud-environments.chatgpt.com/api','--environment-id',registration.data.executor_id,'--exit-on-stdin-close'],env,signal,update,line=>{
  const plain=stripVTControlCharacters(line);let event:any;try{event=JSON.parse(plain)}catch{}
  if(event?event.target!=='codex_exec_server::remote'||event.fields?.noise_event!=='rendezvous_connection':!plain.includes('codex_exec_server::remote')||!plain.includes('noise_event="rendezvous_connection"'))return
  const outcome=event?.fields?.noise_outcome??/noise_outcome="(ok|disconnected|error)"/.exec(plain)?.[1]
  if(outcome==='ok')update('connected');else if(outcome==='disconnected'||outcome==='error')update('reconnecting',safeError(event?.fields?.noise_reason??'Native rendezvous disconnected'))
 })
}

async function startGrok(signal:AbortSignal,update:Update):Promise<Runtime>{
 const app=application('Grok Bot'),nativeHome=path.join(home,'.grokbot'),discovery=path.join(nativeHome,'local-exec-daemon.json'),heartbeatFile=path.join(nativeHome,'local-exec-supervisor.json')
 const existing=readJson<any>(discovery,()=>undefined)
 if(existing&&alive(existing.pid)){update('external');return {running:()=>alive(existing.pid),close:async()=>{}}}
 if(fs.existsSync(path.join(nativeHome,'local-exec-account-retire.json')))throw Error('Grok computer access was retired. Reconnect this Mac in the native account settings.')
 const keys=getGrokComputerKeys(),credentialFile=path.join(nativeHome,'local-exec-daemon-credential.json')
 const refresh=async()=>{
  const auth=getGrokAuth(),scope=createHash('sha256').update(decodeJwt(auth.accessToken)?.sub??auth.accessToken).digest('hex'),saved=unseal(credentialFile,keys.fileKey)??{backendUrl:'https://api2.cursor.sh/'},computers=saved.userComputers??(saved.userComputer?[saved.userComputer]:[]),current=computers.find((value:any)=>value.accountScope===scope&&value.machineId===keys.machineId)
  if(current?.expiresAtMs>Date.now()+5*60000)return
  if(saved.userComputerRemoved?.accountScope===scope)throw Error('This Grok account removed the Mac connection. Reconnect it in native account settings.')
  const result=await grok.rpc('IssueGrokBotUserComputerCredential',{machineId:keys.machineId},{auth,signal})
  signal.throwIfAborted()
  if(!result.credential||!Number(result.expiresAtMs))throw Error('Grok did not confirm the native computer credential.')
  const computer={...result,machineId:keys.machineId,accountScope:scope,expiresAtMs:Number(result.expiresAtMs)}
  seal(credentialFile,{...saved,userComputer:computer,userComputers:[...computers.filter((value:any)=>value.accountScope!==scope),computer]},keys.fileKey)
 }
 await refresh();signal.throwIfAborted()
 const entry=path.join(app,'Contents/Resources/app.asar/dist/local-exec-daemon/entry.cjs')
 // Electron supplies ASAR support; a Core-only Node process uses the installed app's Node mode.
 const executable=process.versions.electron?process.execPath:path.join(application('Aexus Bot'),'Contents/MacOS/Aexus Bot')
 const env:NodeJS.ProcessEnv={...nativeWorkerEnv(),ELECTRON_RUN_AS_NODE:'1',SAND_DATA_ROOT:nativeHome,SAND_PACKAGED:'1',SAND_DISABLE_TELEMETRY:'1'}
 const proxy=await resolveProxy('https://api2.cursor.sh');if(proxy)env.SAND_NODE_PROXY_ENV=JSON.stringify({HTTPS_PROXY:env.HTTPS_PROXY??env.https_proxy??proxy,HTTP_PROXY:env.HTTP_PROXY??env.http_proxy??proxy,NO_PROXY:[env.NO_PROXY??env.no_proxy,'localhost','127.0.0.1','::1'].filter(Boolean).join(',')})
 const externalSupervisor=()=>{const value=readJson<any>(heartbeatFile,()=>undefined);return value?.pid!==process.pid&&alive(value?.pid)&&Date.now()-value.at<90000}
 let borrowed=false,connected=false
 const heartbeat=()=>{const external=externalSupervisor();if(external!==borrowed){borrowed=external;update(external?'external':connected?'connected':'reconnecting')}if(!external)atomicJson(heartbeatFile,{pid:process.pid,at:Date.now()},true)};atomicJson(heartbeatFile,{pid:process.pid,at:Date.now()},true)
 let refreshing=false;const timer=setInterval(()=>{try{heartbeat()}catch(error){update('error',safeError(error))}if(refreshing||borrowed)return;refreshing=true;void refresh().catch(error=>update('error',safeError(error))).finally(()=>{refreshing=false})},15000);timer.unref()
 const cleanup=()=>{clearInterval(timer);const current=readJson<any>(heartbeatFile,()=>undefined);if(current?.pid===process.pid)fs.rmSync(heartbeatFile,{force:true})}
 try{return nativeProcess('grok',executable,[entry],env,signal,update,line=>{
  if(/\[user-computer-watch\].* connected after /.test(line)){connected=true;update(borrowed?'external':'connected')}
  else if(/\[user-computer-watch\].*(ended|disconnected|dialing)/.test(line)){connected=false;update(borrowed?'external':'reconnecting')}
 },child=>child.send!({type:'sand-local-exec-file-key',key:keys.fileKey,computerId:keys.machineId}),cleanup,externalSupervisor)}catch(error){cleanup();throw error}
}

export async function startNativeBotHost(provider:BotProvider,signal:AbortSignal,update:Update):Promise<Runtime>{
 if(process.platform!=='darwin'){update('unsupported');return {running:()=>true,close:async()=>{}}}
 return provider==='dots'?startDot(signal,update):startGrok(signal,update)
}
export const localBotHosts=createBotLocalHosts(async(provider,signal,update)=>{
 if(process.env.AGENTS_COMPANY_TEST_BOTS_URL||APP_HOME!==path.join(home,'AgentsCompany')&&process.env.AGENTS_COMPANY_TEST_BOT_LOCAL_HOSTS!=='1'){update('stopped');return {running:()=>true,close:async()=>{}}}
 return startNativeBotHost(provider,signal,update)
})
