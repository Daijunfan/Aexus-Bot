// Actual SSH processes only, no model inference; disposable Linux/Windows workspace roots.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {call as liveCall} from '../artifacts/engine-native/live-control.mjs'
if(!process.argv.includes('--confirm-live'))throw Error('Requires --confirm-live')
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-raw-monitors-')),out=path.join(root,'artifacts/bot-workers'),checks=[],hosts=await liveCall('host.list'),targets=[hosts.find(h=>h.host==='aexus-vm-ubuntu-target1'),hosts.find(h=>h.host==='aexus-vm-windows-target1')];let f
assert.ok(targets.every(Boolean),'Registered SSH fixtures must exist')
const run=(target,code)=>new Promise((resolve,reject)=>{
 const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10'];for(const [k,flag]of [['sshConfig','-F'],['identityFile','-i'],['port','-p'],['jump','-J']])if(target[k])args.push(flag,String(target[k]));if(target.knownHosts)args.push('-o','UserKnownHostsFile='+target.knownHosts)
 const command=(target.os==='windows'?'python':'python3')+' -c "import base64;exec(base64.b64decode(\''+Buffer.from(code).toString('base64')+'\'))"',child=spawn('ssh',[...args,target.host,command],{stdio:['ignore','pipe','pipe']}),data=[],errors=[];const timer=setTimeout(()=>child.kill('SIGTERM'),30000);child.stdout.on('data',b=>data.push(b));child.stderr.on('data',b=>errors.push(b));child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(data).toString().trim()):reject(Error(Buffer.concat(errors).toString()||'SSH failed '+code))})
})
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');const entry=path.join(temp,'daemon.cjs');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'});f=await fixtureCore({},entry)
 const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data},until=async(check,label)=>{const start=Date.now();while(Date.now()-start<40000){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,150))}throw Error('Timeout '+label)}
 for(const target of targets){
  const name='monitor-'+randomUUID(),remoteRoot=JSON.parse(await run(target,"import pathlib,json; p=pathlib.Path.home()/'.cache'/'aexus-tests'/"+JSON.stringify(name)+";p.mkdir(parents=True,exist_ok=False);print(json.dumps(str(p)))"))
  try{
   const team='Monitor '+target.os;await rpc('group.add',{name:team});const card=await f.create('Owned monitor '+target.os,team)
   const host=await rpc('host.create',Object.fromEntries(['host','os','port','identityFile','knownHosts','sshConfig','jump'].filter(k=>target[k]!==undefined).map(k=>[k,target[k]]).concat([['name','Disposable '+target.os+' monitor'],['defaultDirectory',remoteRoot]])))
   await f.stop();const file=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),store=JSON.parse(fs.readFileSync(file));Object.assign(store.sessions.find(c=>c.id===card.id),{cwd:remoteRoot,kind:'cloud-native-worker',workEnvironment:'team'});store.teamSettings[team]={mode:'cloud',hostId:host.id,directory:remoteRoot};store.teamRoots[team]=remoteRoot;fs.writeFileSync(file,JSON.stringify(store));await f.start()
   const literal="中文 with spaces & 'quotes' %PATH%",code="import os,sys,json,time,pathlib;pathlib.Path('owned.pid').write_text(str(os.getpid()));print(json.dumps({'id':'native-ready','data':{'pid':os.getpid(),'platform':sys.platform,'cwd':os.getcwd(),'arg':sys.argv[1],'tty':sys.stdout.isatty(),'coreIdentity':any(k.startswith('AGENTS_COMPANY_') for k in os.environ)}}),flush=True);time.sleep(120)",m=await rpc('monitor.create',{employee:card.id,name:'Native '+target.os,program:['python','-u','-c',code,literal]})
   await rpc('monitor.start',{id:m.id});const publication=await until(async()=>{const r=await rpc('monitor.read',{id:m.id});const line=r.output.trim().split(/\r?\n/).find(s=>s.startsWith('{'));return line&&JSON.parse(line)},target.os+' raw output')
   assert.equal(publication.data.arg,literal);assert.equal(publication.data.tty,false);assert.equal(publication.data.coreIdentity,false)
   await rpc('monitor.stop',{id:m.id})
   const pid=publication.data.pid,aliveCode=target.os==='windows'?"import ctypes,json; k=ctypes.windll.kernel32;h=k.OpenProcess(0x1000,False,"+pid+");c=ctypes.c_ulong();alive=bool(h and k.GetExitCodeProcess(h,ctypes.byref(c)) and c.value==259);k.CloseHandle(h) if h else None;print(json.dumps(alive))":"import os,json\ntry: os.kill("+pid+",0);alive=True\nexcept ProcessLookupError: alive=False\nprint(json.dumps(alive))"
   assert.equal(JSON.parse(await run(target,aliveCode)),false,'Stopping the monitor must terminate its owned remote process')
   checks.push({os:target.os,rawStdio:true,literalArgvPreserved:true,noCoreIdentity:true,ownedProcessTerminated:true});console.log('PASS real '+target.os+' monitor: raw JSON, exact Unicode/metachar argv, no Core identity, EOF stop removes owned child')
   await rpc('monitor.remove',{id:m.id})
  }finally{await run(target,"import pathlib,shutil;p=pathlib.Path("+JSON.stringify(remoteRoot)+");assert p.name=="+JSON.stringify(name)+";shutil.rmtree(p)")}
 }
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'monitors-live-result.json'),JSON.stringify({passed:true,checks,realModelCalls:0,existingUserProcessesChanged:false},null,2))
}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
