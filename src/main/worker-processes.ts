import {execFileSync,spawn,type ChildProcess} from 'node:child_process'

/** Capture ownership before closing: a native parent can exit while its tools keep pipes open. */
function processTable(){return execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat='],{encoding:'utf8'}).trim().split('\n').map(line=>{const [pid,parent,group,state]=line.trim().split(/\s+/);return {pid:Number(pid),parent:Number(parent),group:Number(group),state}})}
export async function closeWorkerProcesses(children:ChildProcess[],close:()=>Promise<unknown>){
 const roots=children.filter(child=>child.pid&&child.exitCode===null&&child.signalCode===null).map(child=>child.pid!)
 if(process.platform==='win32'){
  const killers=roots.map(pid=>new Promise<void>((resolve,reject)=>{const child=spawn('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('close',()=>resolve())}))
  try{await close()}finally{await Promise.all(killers)}return
 }
 const initial=processTable(),owned=new Set(roots),groups=new Set(initial.filter(row=>roots.includes(row.pid)&&row.group===row.pid).map(row=>row.group))
 const descendants=(table:ReturnType<typeof processTable>)=>{let count=-1;while(count!==owned.size){count=owned.size;for(const row of table)if(owned.has(row.parent)||groups.has(row.group)){owned.add(row.pid);if(row.pid===row.group)groups.add(row.group)}};return table.filter(row=>!row.state.startsWith('Z')&&(owned.has(row.pid)||groups.has(row.group)))}
 descendants(initial)
 const remaining=()=>descendants(processTable()),signal=(force=false)=>{for(const row of remaining())try{process.kill(row.pid,force?'SIGKILL':'SIGTERM')}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}}
 let closed=false,closeError:unknown
 // Do not await a protocol's `close` before enforcing termination: inherited stdio
 // can keep its close event pending until a stubborn descendant has been killed.
 const closing=close().catch(error=>{closeError=error}).finally(()=>{closed=true})
 await Promise.race([closing,new Promise(resolve=>setTimeout(resolve,150))]);signal();let until=Date.now()+1500
 while((!closed||remaining().length)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,40))
 if(remaining().length)signal(true)
 until=Date.now()+2000;while((!closed||remaining().length)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,40))
 if(remaining().length||!closed)throw Error('Worker processes have not exited. The Worker was not removed.')
 await closing
 // The OS exit check is authoritative even when a closed native pipe rejects its last control reply.
 void closeError
}
