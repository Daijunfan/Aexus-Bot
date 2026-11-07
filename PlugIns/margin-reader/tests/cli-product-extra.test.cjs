'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'cli.cjs'),env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AGENTS_')));
function run(w,args,input){return spawnSync(process.execPath,[cli,...(w?['--workspace',w]:[]),...args],{encoding:'utf8',env,input,timeout:30000,maxBuffer:16*1024*1024});}
async function fixture(t){const w=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'mr-cli-extra-')));t.after(()=>fs.rm(w,{recursive:true,force:true}));return w;}
function result(w,args){const p=run(w,args);assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout).result;}
test('legacy import and @JSON file preserve originals, multiword search and explicit text',async t=>{
 const w=await fixture(t),source=path.join(w,'outside source.md'),dest=path.join(w,'library');await fs.mkdir(dest);await fs.writeFile(source,'# Hello world\n\nHello world');
 const doc=result(dest,['import',source,'--to','中文 路径.md']);assert.equal(await fs.readFile(source,'utf8'),'# Hello world\n\nHello world');
 const query=result(dest,['search',doc.id,'Hello','world']);assert(query.matches.length);
 const file=path.join(w,'params.json');await fs.writeFile(file,JSON.stringify({id:doc.id,section:0}));
 const p=run(dest,['api','document.content','--data','@'+file,'--text']);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/Hello world/);
 const outline=run(dest,['document','outline',doc.id,'--output','text']);assert.equal(outline.status,0,outline.stderr);assert.match(outline.stdout,/Hello world/);assert(!outline.stdout.includes('\"toc\"'));
 const text=run(dest,['document','read',doc.id,'--section','0','--output','text']);assert.equal(text.status,0,text.stderr);assert.match(text.stdout,/Hello world/);
});
test('XMind export inspect import use explicit revision and version',async t=>{
 const w=await fixture(t);let set=result(w,['study','create','XMind 示例']);
 result(w,['card','note',set.id,'根主题','--expected-revision',String(set.revision)]);
 set=result(w,['study','get',set.id]);
 result(w,['xmind','export','map.xmind','--set-ids',JSON.stringify([set.id]),'--expected-revisions',JSON.stringify({[set.id]:set.revision})]);
 const inspection=result(w,['xmind','inspect','map.xmind']);assert(inspection.sourceVersion);
 result(w,['xmind','import','map.xmind','--expected-version',inspection.sourceVersion]);
 const bad=run(w,['xmind','import','map.xmind','--expected-version','stale']);assert.equal(JSON.parse(bad.stdout).error.data.code,'CONFLICT');
});
test('stdin is consumed once and JSON types, false booleans, delimiters stay explicit',async t=>{
 const w=await fixture(t),{parse}=require('../lib/cli/parse.cjs');
 const p=run(w,['study.mindmap.xmind.export','--path','a.xmind','--set-ids','-','--expected-revisions','-'],'[]');assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).error.data.code,'INVALID_PARAMS');assert.match(p.stderr,/stdin may only/);
 await assert.rejects(parse(['study.create','--title','x','--folder-id','null','--folder-id','a']),{code:'INVALID_PARAMS'});
 await assert.rejects(parse(['study.add','--set-id','x','--expected-revision','1','--paths','{}']),{code:'INVALID_PARAMS'});
 assert.equal((await parse(['study','create','--','--json'])).params.title,'--json');
 assert.equal((await parse(['study','create','--title=--help'])).params.title,'--help');
 assert.equal((await parse(['study.review.configure','--set-id','x','--card-id','x','--expected-revision','1','--enabled','false'])).params.enabled,false);
});
test('errors remain JSON on stdout and diagnostics stderr without terminal escapes',async t=>{
 const w=await fixture(t),p=run(w,['document','open','not found.md']);
 assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).error.data.code,'NOT_FOUND');assert.match(p.stderr,/NOT_FOUND/);assert(!p.stderr.includes('\x1b'));
 const q=run(null,['commands','--bogus']);assert.equal(q.status,1);assert.equal(JSON.parse(q.stdout).error.data.code,'INVALID_PARAMS');
});
test('TUI is lazy and client closes on success and failure',async t=>{
 const w=await fixture(t);
 for(const fails of [false,true]){
  const code="Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});process.env.TERM='xterm';const M=require('node:module'),load=M._load;M._load=function(id,...a){if(id==='./runtime.cjs')return {createPlugin:async()=>({close:async()=>process.stdout.write('closed\\n')})};if(id==='./tui/index.cjs')return {runTui:async o=>{if(!o.client||o.workspace!=="+JSON.stringify(w)+"||o.input!==process.stdin||o.output!==process.stdout||o.errorOutput!==process.stderr)throw Error('bad contract');process.stdout.write('ran\\n');"+(fails?"throw Error('fixture failure');":"")+"}};return load.call(this,id,...a)};process.argv=['node','cli','--workspace',"+JSON.stringify(w)+",'tui'];require("+JSON.stringify(cli)+").main().catch(e=>process.stderr.write(e.message));";
  const p=spawnSync(process.execPath,['-e',code],{encoding:'utf8',env});assert.equal(p.stdout,'ran\nclosed\n');assert.equal(p.stderr,fails?'fixture failure':'');
 }
});
test('readable nested clipping counts every descendant and strips ANSI controls',()=>{
 const {readable}=require('../lib/cli/output.cjs');
 const nodes=Array.from({length:201},(_,i)=>({title:'n'+i,children:i===200?[{title:'hidden descendant'}]:[]}));
 const text=readable({result:{nodes}});assert.match(text,/200 of 202/);
 assert(!readable({result:{text:'a\x1b[31mb'}}).includes('\x1b'));
});
