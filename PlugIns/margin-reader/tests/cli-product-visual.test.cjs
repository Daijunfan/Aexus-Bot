'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'cli.cjs'),env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AGENTS_')));
async function fixture(t){const w=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'mr-cli-visual-')));t.after(()=>fs.rm(w,{recursive:true,force:true}));return w;}
function run(w,args){return spawnSync(process.execPath,[cli,'--workspace',w,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});}
function rpc(w,args){const p=run(w,args);assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout).result;}
test('real terminal-visuals ABI renders JSON and text without changing state',async t=>{
 const w=await fixture(t);let set=rpc(w,['study','create','终端空间']);
 rpc(w,['card','note',set.id,'中文 根主题','--expected-revision',String(set.revision)]);
 set=rpc(w,['study','get',set.id]);const id=set.cards[0].id;
 rpc(w,['card','note',set.id,'子主题','--expected-revision',String(set.revision),'--parent-id',id]);
 const state=path.join(w,'.margin-reader/state.json'),before=await fs.readFile(state);
 const snapshot=rpc(w,['map','render','--set-id',set.id,'--columns','80','--rows','24','--select',id,'--zoom','1']);
 assert.equal(typeof snapshot.text,'string');assert.equal(snapshot.state.selectedId,id);assert.equal(snapshot.stats.totalCards,2);assert.equal(snapshot.stats.bufferCells,1920);assert(Array.isArray(snapshot.warnings));
 const p=run(w,['map','render','--set-id',set.id,'--columns','80','--rows','24','--output','text']);assert.equal(p.status,0,p.stderr);assert(!p.stdout.includes('"jsonrpc"'));assert(!p.stdout.includes('\x1b'));assert.equal(p.stderr,'');
 assert.equal(p.stdout.slice(0,-1).split('\n').length,24);assert.deepEqual(await fs.readFile(state),before);
});
test('snapshot adapter unwraps Core results and always closes the client',async t=>{
 const w=await fixture(t);
 const code="const M=require('node:module'),load=M._load;let closed=0;M._load=function(id,...a){if(id==='./runtime.cjs')return {createPlugin:async()=>({request:async r=>({jsonrpc:'2.0',id:r.id,result:{method:r.method,params:r.params}}),close:async()=>{closed++;}})};if(id==='./terminal-visuals/cli.cjs')return {renderMapSnapshot:async p=>{const a=await p.request('study.get',{setId:p.setId});const b=await p.request('study.map.geometry',{setId:p.setId});if(a.result||a.method!=='study.get'||b.method!=='study.map.geometry'||p.selectedId!=='card'||p.columns!==90||p.rows!==20||p.zoom!==2)throw Error('ABI mismatch');return {text:'snapshot',revision:7,state:{},stats:{},warnings:[]}}};return load.call(this,id,...a)};process.argv=['node','cli','--workspace',"+JSON.stringify(w)+",'map','render','--set-id','set','--select','card','--columns','90','--rows','20','--zoom','2'];require("+JSON.stringify(cli)+").main().then(()=>{if(closed!==1)throw Error('close count '+closed)}).catch(e=>{console.error(e);process.exitCode=1});";
 const p=spawnSync(process.execPath,['-e',code],{encoding:'utf8',env});assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).result.text,'snapshot');
});
test('map render validates flags and ranges before Core initialization, and has scoped help/completion',async()=>{
 const {parse}=require('../lib/cli/parse.cjs'),{candidates}=require('../lib/cli/completion.cjs');
 for(const args of [[],['--set-id','s','--columns','0'],['--set-id','s','--rows','1.5'],['--set-id','s','--columns','1000','--rows','1000'],['--set-id','s','--zoom','0'],['--set-id','s','--zoom','17'],['--set-id','s','extra'],['--set-id','s','--rows','2','--rows','3']])await assert.rejects(parse(['map','render',...args]),{code:'INVALID_PARAMS'});
 assert.equal((await parse(['map','render','--set-id','s','--zoom','0.02'])).action,'map-render');
 assert.deepEqual(candidates(['map','r']),['render']);assert(candidates(['map','render','--']).includes('--columns'));assert(!candidates(['map','render','--']).includes('--expected-revision'));
 const p=spawnSync(process.execPath,[cli,'help','map','render'],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/100000/);assert.match(p.stdout,/--output text/);
});
test('real CLI TUI exits naturally after q and restores listeners',async t=>{
 const w=await fixture(t);
 const script=String.raw`import os,pty,subprocess,select,time,sys,json
master,slave=pty.openpty()
env=os.environ.copy();env['TERM']='xterm-256color'
code="process.argv.splice(1,0,'cli');let baseline;const M=require('node:module'),load=M._load;M._load=function(id,...args){const mod=load.call(this,id,...args);if(id==='./tui/index.cjs')return {runTui:async o=>{baseline={sigint:process.listeners('SIGINT'),sigterm:process.listeners('SIGTERM')};return mod.runTui(o)}};return mod;};require(process.env.MR_CLI).main().then(()=>{const same=(key,event)=>JSON.stringify(process.listeners(event).map(f=>baseline[key].indexOf(f)))===JSON.stringify(baseline[key].map((_,i)=>i));console.error('CLEANUP '+JSON.stringify({data:process.stdin.listenerCount('data'),paused:process.stdin.isPaused(),raw:process.stdin.isRaw,sigintRestored:same('sigint','SIGINT'),sigtermRestored:same('sigterm','SIGTERM')}));}).catch(e=>{console.error(e);process.exitCode=1});"
p=subprocess.Popen([sys.argv[2],'-e',code,'--','--workspace',sys.argv[1],'tui'],stdin=slave,stdout=slave,stderr=slave,env=env)
os.close(slave);out=b'';sent=False;deadline=time.monotonic()+6
try:
 while time.monotonic()<deadline and p.poll() is None:
  if select.select([master],[],[],.05)[0]:
   try:out+=os.read(master,65536)
   except OSError:break
  if not sent and b'1049h' in out:os.write(master,b'q');sent=True;start=time.monotonic()
 try:exitcode=p.wait(timeout=.5)
 except subprocess.TimeoutExpired:raise AssertionError('CLI failed natural exit after q; tail='+repr(out[-500:]))
 try:
  while select.select([master],[],[],0)[0]:
   chunk=os.read(master,65536)
   if not chunk:break
   out+=chunk
 except OSError:pass
 assert sent,repr(out[-500:])
 assert exitcode==0,repr(out[-1000:])
 assert b'1049l' in out,repr(out[-500:])
 assert b'"data":0' in out and b'"sigintRestored":true' in out and b'"sigtermRestored":true' in out and b'"raw":false' in out,repr(out[-1000:])
 print('natural q exit seconds='+str(round(time.monotonic()-start,3)))
 print(out[out.rfind(b'CLEANUP '):].decode(errors='replace'))
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master)
`;
 const p=spawnSync('python3',['-c',script,w,process.execPath],{env:{...env,MR_CLI:cli},encoding:'utf8',timeout:10000});
 assert.equal(p.status,0,p.stdout+p.stderr);t.diagnostic(p.stdout.trim());
});
