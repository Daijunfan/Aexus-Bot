'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'cli.cjs');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AGENTS_')));
function run(args,input){return spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',input,timeout:30000,maxBuffer:16*1024*1024});}
async function workspace(t){const w=await fs.mkdtemp(path.join(os.tmpdir(),'mr-cli-product-'));t.after(()=>fs.rm(w,{recursive:true,force:true}));return w;}
function rpc(w,...args){const p=run(['--workspace',w,...args]);assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout).result;}
test('discovery and version work with no workspace and unavailable host',()=>{
 for(const args of [['--version'],['help'],['help','study'],['help','card','create'],['commands','xmind'],['schema','fs.write'],['completion','bash'],['completion','zsh'],['completion','fish']]){
  const p=run(args);assert.equal(p.status,0,p.stderr);assert(p.stdout.length);assert.equal(p.stderr,'');
 }
});
test('database and excerpt task guides expose real schema operations without a workspace',()=>{
 for (const [topic,needles] of [
  ['database',['study.board.query','study.board.save','study.cards.batch','--direction desc']],
  ['excerpt',['study.card.create','study.annotation.update','--data @capture.json','Shift+arrows']]
 ]) {
  const help=run(['help',topic]);assert.equal(help.status,0,help.stderr);
  for (const needle of needles) assert(help.stdout.includes(needle),topic+' missing '+needle);
  const list=run(['commands',topic]);assert.equal(list.status,0,list.stderr);
  assert(list.stdout.includes(needles[0]),list.stdout);
  assert(!list.stdout.includes('Unknown help topic'));
 }
 assert.match(run(['help']).stdout,/Task guides: help database \| help excerpt/);
 assert.match(run(['--help','数据库']).stdout,/study.board.query/);
 assert.match(run(['--help','摘录']).stdout,/study.card.create/);
});
test('discovery never loads runtime',()=>{
 const code="const M=require('node:module');const original=M._load;M._load=function(id,...a){if(id.includes('runtime.cjs'))throw Error('Core loaded');return original.call(this,id,...a)};process.argv=['node','cli','help','card','create'];require("+JSON.stringify(cli)+").main()";
 const p=spawnSync(process.execPath,['-e',code],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
test('all public methods have canonical and namespace mapping with exact schema rules',async()=>{
 const {schema,definitions,kebab}=require('../lib/cli/commands.cjs');
 const {parse}=require('../lib/cli/parse.cjs');
 for(const c of schema.commands){
  const dotted=definitions.find(d=>d.name===c.method);assert.equal(dotted.command,c);
  assert(definitions.some(d=>d.name===c.method.split('.').map(kebab).join(' ')&&d.method===c.method));
  const params={};for(const [key,r] of Object.entries(c.options||{})){
   if(r.nullable)params[key]=null;
   else if(r.enum)params[key]=r.enum[0];
   else params[key]=r.type==='string'?'value':r.type==='number'?r.minimum??1:r.type==='boolean'?false:r.type==='array'?[]:{};
  }
  const args=[c.method,...Object.entries(params).flatMap(([k,v])=>['--'+kebab(k),typeof v==='object'?JSON.stringify(v):String(v)])];
  const parsed=await parse(args);assert.equal(parsed.method,c.method);assert.deepEqual(parsed.params,params);
 }
});
test('old syntax, JSON envelope, stdin, pretty and text remain compatible',async t=>{
 const w=await workspace(t);
 const p=run(['--workspace',w,'api','fs.write','--data','-'],JSON.stringify({path:'中文 空格.md',content:'# Hello\n世界'}));
 assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).jsonrpc,'2.0');
 const doc=rpc(w,'open','中文 空格.md');
 assert.match(run(['--workspace',w,'read',doc.id,'--text']).stdout,/世界/);
 assert.equal(JSON.parse(run(['--workspace',w,'tree','--json']).stdout).jsonrpc,'2.0');
 assert.match(run(['--workspace',w,'tree','--output','pretty']).stdout,/\n  "jsonrpc"/);
 assert.match(run(['--workspace',w,'tree','--output','text']).stdout,/中文 空格.md/);
});
for(const args of [['--bogus'],['--constructor'],['constructor'],['tree','--constructor'],['api','fs.list','--__proto__'],['tree','extra','extra'],['tree','--depth','2','--depth','3'],['document','open','a','--path','b'],['tree','--depth','NaN'],['--output','text','--json','tree'],['tui','extra']]){
 test('strict invalid arguments '+args.join(' '),async t=>{const w=await workspace(t);const p=run(['--workspace',w,...args]);assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).error.data.code,'INVALID_PARAMS');assert.match(p.stderr,/INVALID_PARAMS/);});
}
test('typed boolean, null, number, JSON file and stdin conversion',async t=>{
 const {parse}=require('../lib/cli/parse.cjs');const w=await workspace(t),file=path.join(w,'paths.json');await fs.writeFile(file,'["中文 空格.md"]');
 assert.deepEqual((await parse(['study','add','id','--expected-revision','2','--paths','@'+file])).params,{setId:'id',expectedRevision:2,paths:['中文 空格.md']});
 assert.equal((await parse(['study.create','--title','x','--folder-id','null'])).params.folderId,null);
 assert.equal((await parse(['document.open','--path','x','--activate=false'])).params.activate,false);
 const p=run(['--workspace',w,'study','create','测试']);
 assert.equal(p.status,0,p.stderr);
 const set=JSON.parse(p.stdout).result;
 const q=run(['--workspace',w,'study','add',set.id,'--expected-revision',String(set.revision),'--paths','-'],'[]');assert.notEqual(JSON.parse(q.stdout).error?.data.code,'INTERNAL_ERROR');
});
test('complete learning workflow, stale revision, source activation, export and restart',async t=>{
 const w=await workspace(t);
 rpc(w,'api','fs.write','--data',JSON.stringify({path:'课程 一.md',content:'# Lesson\n\nHello world'}));
 const doc=rpc(w,'document','open','课程 一.md');
 let set=rpc(w,'study','create','终端学习');
 set=rpc(w,'study','add',set.id,'--expected-revision',String(set.revision),'--paths','["课程 一.md"]');
 let result=rpc(w,'card','create',set.id,'--expected-revision',String(set.revision),'--document-id',doc.id,'--expected-source-version',doc.sourceVersion||doc.version,'--capture-id',randomUUID(),'--text','Hello world','--locator','{"section":0}','--color','yellow');
 set=rpc(w,'study','get',set.id);
 const card=set.cards[0];assert(card);
 rpc(w,'card','note',set.id,'子主题','--expected-revision',String(set.revision),'--parent-id',card.id,'--text','解释');
 const stale=run(['--workspace',w,'card','note',set.id,'冲突','--expected-revision',String(set.revision)]);assert.equal(JSON.parse(stale.stdout).error.data.code,'CONFLICT');
 set=rpc(w,'study','get',set.id);assert.equal(set.cards.length,2);
 assert.match(run(['--workspace',w,'map','show',set.id,'--output','text']).stdout,/子主题/);
 rpc(w,'review','configure',set.id,card.id,'--expected-revision',String(set.revision),'--enabled','true');
 rpc(w,'review','queue',set.id);
 set=rpc(w,'study','get',set.id);
 rpc(w,'review','grade',set.id,card.id,'good','--expected-revision',String(set.revision));
 set=rpc(w,'study','get',set.id);
 rpc(w,'study.navigation.set','--set-id',set.id,'--expected-revision',String(set.revision),'--mode','off');
 assert.equal(rpc(w,'study.card.activate','--set-id',set.id,'--card-id',card.id).linked,false);
 const source=rpc(w,'card','source',set.id,card.id);assert.equal(source.linked,true);assert.equal(source.source.documentId,doc.id);
 assert.equal(rpc(w,'card','source',set.id,card.id,'--force=false').linked,false);
 rpc(w,'study','export',set.id,'学习导出.json','--include-images=false');
 assert((await fs.stat(path.join(w,'学习导出.json'))).size>0);
 const reopened=rpc(w,'study','get',set.id);assert.equal(reopened.cards.length,2);assert.equal(reopened.cards.find(c=>c.id===card.id).review.logs.length,1);
 assert.equal(await fs.readFile(path.join(w,'课程 一.md'),'utf8'),'# Lesson\n\nHello world');
});
test('CLI capture overrides and saved descending database views survive separate processes',async t=>{
 const w=await workspace(t),original='<h1>CLI reading</h1><p>Original quotation</p>';
 rpc(w,'fs.write','--path','capture.html','--content',original);
 const doc=rpc(w,'document.open','--path','capture.html','--activate=false');
 let set=rpc(w,'study.create','--title','CLI database parity');
 set=rpc(w,'study.documents.add','--set-id',set.id,'--expected-revision',String(set.revision),'--paths','["capture.html"]');
 set=rpc(w,'study.capture.settings','--set-id',set.id,'--expected-revision',String(set.revision),'--in-map=true','--annotation-style','highlight','--tags','["preset"]');
 const preset=structuredClone(set.captureSettings),captureId=randomUUID();
 const args=['card','create',set.id,'--expected-revision',String(set.revision),'--document-id',doc.id,'--expected-source-version',doc.sourceVersion,'--capture-id',captureId,'--title','A quotation','--text','Original quotation','--color','yellow','--locator','{"section":0}','--in-map=false','--annotation-style','underline','--note','CLI inline note','--tags','["command"]'];
 const created=rpc(w,...args);assert.equal(created.card.inMap,false);assert.equal(created.card.annotation.style,'underline');assert.equal(created.card.note,'CLI inline note');assert.deepEqual(created.card.tags,['command']);
 assert.equal(rpc(w,...args).card.id,created.card.id);
 set=rpc(w,'study.get','--set-id',set.id);assert.deepEqual(set.captureSettings,preset);assert.equal(set.cards.length,1);
 set=rpc(w,'study.note.create','--set-id',set.id,'--expected-revision',String(set.revision),'--title','Z note');
 set=rpc(w,'study.board.save','--set-id',set.id,'--expected-revision',String(set.revision),'--title','Descending','--filter','{}','--sort','title','--direction','desc');
 const board=set.boards.find(b=>b.title==='Descending');assert.equal(board.direction,'desc');
 const queried=rpc(w,'study.board.query','--set-id',set.id,'--board-id',board.id);assert.deepEqual(queried.cards.map(c=>c.title),['Z note','A quotation']);
 const materialized=rpc(w,'study.board.materialize','--set-id',set.id,'--expected-revision',String(set.revision),'--board-id',board.id),root=materialized.cards.find(c=>c.boardSource===board.id),references=materialized.cards.filter(c=>c.parentId===root.id&&c.reference);assert.equal(root.title,'Descending');assert.deepEqual(references.map(c=>c.title),['Z note','A quotation']);assert.deepEqual(references.map(c=>c.reference.cardId),queried.cards.map(c=>c.id));
 assert.equal(await fs.readFile(path.join(w,'capture.html'),'utf8'),original);
});
test('text rendering reports display clipping and API pagination without mutating data',()=>{
 const {readable}=require('../lib/cli/output.cjs');const reply={result:{cards:Array.from({length:205},(_,i)=>({id:String(i),title:'节点 '+i})),truncated:true,nextOffset:205}};
 const before=JSON.stringify(reply),text=readable(reply);assert.match(text,/display clipped/);assert.match(text,/nextOffset=205/);assert.equal(JSON.stringify(reply),before);
});
test('completion adapters invoke context helper without evaluating user input',()=>{
 const {completion,candidates}=require('../lib/cli/completion.cjs');
 for(const shell of ['bash','zsh','fish'])assert(!/\beval\b/.test(completion(shell)));
 assert.deepEqual(candidates(['card','']),['create','move','note','remove','source','update']);
 assert(candidates(['study.card.create','--']).includes('--expected-source-version'));
 assert(!candidates(['study.card.create','--']).includes('--rating'));
 const p=spawnSync('bash',['-n'],{input:completion('bash'),encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
test('closed downstream pipe does not print stack or EPIPE diagnostics',()=>{
 const p=spawnSync('bash',['-o','pipefail','-c','node "$1" schema | head -c 1 >/dev/null','bash',cli],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(p.stderr,'');
});
