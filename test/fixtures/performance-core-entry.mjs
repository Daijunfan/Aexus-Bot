// Private benchmark instrumentation; never part of the production runtime.
import fs from 'node:fs'
import path from 'node:path'
import {build} from 'esbuild'
export async function performanceCoreEntry(directory){
 const root=process.cwd(),entry=path.join(directory,'daemon.cjs');fs.mkdirSync(directory,{recursive:true})
 const source=`import fs from 'node:fs';import {monitorEventLoopDelay} from 'node:perf_hooks';import '${root}/src/main/daemon';
 const original={writeFileSync:fs.writeFileSync,readFileSync:fs.readFileSync,fsyncSync:fs.fsyncSync},histogram=monitorEventLoopDelay({resolution:10});histogram.enable();let measuring=false,started=0,cpu,reads=0,readChars=0,writes=0,writeChars=0,syncs=0,peakHeap=0;const folder=process.env.AEXUS_PERF_CONTROL;
 fs.readFileSync=function(...args){const data=original.readFileSync(...args);if(measuring){reads++;readChars+=data.length??0}return data};fs.writeFileSync=function(...args){if(measuring){writes++;writeChars+=args[1]?.length??0}return original.writeFileSync(...args)};fs.fsyncSync=function(...args){if(measuring)syncs++;return original.fsyncSync(...args)};
 setInterval(()=>{const active=fs.existsSync(folder+'/running');if(active&&!measuring){histogram.reset();started=performance.now();cpu=process.cpuUsage();reads=readChars=writes=writeChars=syncs=peakHeap=0;measuring=true}if(!measuring)return;peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);const usage=process.cpuUsage(cpu),elapsed=performance.now()-started,result={elapsedMs:elapsed,cpuMs:(usage.user+usage.system)/1000,eventLoopP95Ms:histogram.percentile(95)/1e6,eventLoopMaxMs:histogram.max/1e6,reads,readChars,writes,writeChars,fsyncs:syncs,peakHeap};original.writeFileSync(folder+'/core-metrics.json',JSON.stringify(result));if(!active)measuring=false},100).unref();`
 await build({stdin:{contents:source,resolveDir:root,sourcefile:'performance-daemon.mjs'},outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'});return entry
}
