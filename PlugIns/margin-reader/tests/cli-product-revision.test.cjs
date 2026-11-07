'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'cli.cjs'),{schema,definitions,kebab,collisions,globalOptions}=require('../lib/cli/commands.cjs');
const {candidates,completion}=require('../lib/cli/completion.cjs'),{parse}=require('../lib/cli/parse.cjs');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AGENTS_')));
async function fixture(t){const w=await fs.mkdtemp(path.join(os.tmpdir(),'mr-cli-revision-'));t.after(()=>fs.rm(w,{recursive:true,force:true}));return w;}
function run(w,args){return spawnSync(process.execPath,[cli,'--workspace',w,...args],{env,encoding:'utf8',timeout:30000});}
function rpc(w,args){const p=run(w,args);assert.equal(p.status,0,p.stdout+p.stderr);return JSON.parse(p.stdout).result;}
test('single and bulk moves are distinct, and common editing aliases persist through real processes',async t=>{
 const w=await fixture(t);let set=rpc(w,['study','create','编辑场景']);
 rpc(w,['card','note',set.id,'父主题','--expected-revision',String(set.revision)]);
 set=rpc(w,['study','get',set.id]);const parent=set.cards[0].id;
 rpc(w,['card','note',set.id,'子主题','--expected-revision',String(set.revision)]);
 set=rpc(w,['study','get',set.id]);const child=set.cards.find(c=>c.id!==parent).id;
 rpc(w,['card','move',set.id,child,'--expected-revision',String(set.revision),'--parent-id',parent]);
 set=rpc(w,['study','get',set.id]);assert.equal(set.cards.find(c=>c.id===child).parentId,parent);
 rpc(w,['card','update',set.id,child,'--expected-revision',String(set.revision),'--title','已编辑','--tags','["标签"]']);
 set=rpc(w,['study','get',set.id]);assert.equal(set.cards.find(c=>c.id===child).title,'已编辑');
 rpc(w,['cards','move',set.id,'--expected-revision',String(set.revision),'--card-ids',JSON.stringify([child]),'--parent-id','null']);
 set=rpc(w,['study','get',set.id]);assert.equal(set.cards.find(c=>c.id===child).parentId,null);
 rpc(w,['card','remove',set.id,child,'--expected-revision',String(set.revision)]);
 assert.equal(rpc(w,['study','get',set.id]).cards.length,1);
 assert.equal((await parse(['card','source','s','c'])).params.force,true);
 assert.equal((await parse(['card','source','s','c','--force=false'])).params.force,false);
 assert(!Object.hasOwn((await parse(['study.card.activate','--set-id','s','--card-id','c'])).params,'force'));
});
test('all schema flags map uniquely; global collision inventory is empty and API JSON remains opaque',async()=>{
 assert.deepEqual(collisions,[]);
 for(const c of schema.commands){
  const flags=Object.keys(c.options||{}).map(kebab);assert.equal(new Set(flags).size,flags.length,c.method);
  const offered=candidates([c.method,'--']);
  for(const flag of flags)assert(offered.includes('--'+flag),c.method+' '+flag);
 }
 const raw=JSON.stringify({workspace:'business',output:'business',json:false,help:'business',version:'business'});
 const parsed=await parse(['--workspace','/tmp/explicit','api','some.future.method','--data',raw]);
 assert.equal(parsed.options.workspace,'/tmp/explicit');assert.equal(parsed.options.data,raw);assert(!parsed.options.help);assert(!parsed.options.version);
});
test('context completion traverses groups, scopes flags, and completes enums without echoing input',()=>{
 assert(candidates(['']).includes('card'));assert(candidates(['']).length<40);
 assert.deepEqual(candidates(['review','session','']),[]); // shorthand has no such subgroup; canonical namespace is study review session.
 assert.deepEqual(candidates(['study','review','session','']),['action','get','start']);
 assert(candidates(['card','update','--']).includes('--edited-text'));assert(!candidates(['card','update','--']).includes('--rating'));
 assert.deepEqual(candidates(['review','grade','s','c','g']),['good']);
 assert.deepEqual(candidates(['review','grade','--rating','g']),['good']);
 assert.deepEqual(candidates(['review','grade','--rating=g']),['--rating=good']);
 assert.deepEqual(candidates(['review','grade','--rating','=','g']),['good']);
 assert.deepEqual(candidates(['--workspace','/tmp/space path','review','grade','--rating','e']),['easy']);
 assert.deepEqual(candidates(['--output','p']),['pretty']);
 assert.deepEqual(candidates(['--output=p']),['--output=pretty']);
 assert.deepEqual(candidates(['api','fs.list','--d']),['--data']);
 assert(!candidates(['card','update','--title','already','--']).includes('--title'));
 assert.deepEqual(candidates(['card','$(touch /tmp/unsafe)','']),[]);
});
test('help uses exact schema examples and clearly labels generated skeletons',()=>{
 const {methodHelp}=require('../lib/cli/help.cjs');
 for(const c of schema.commands){const text=methodHelp(c.method);assert(text);if(c.examples?.length){for(const e of c.examples)assert(text.includes(JSON.stringify(e)));assert(!text.includes('Parameter skeleton only'));}else{assert(text.includes('Parameter skeleton only'));assert(text.includes('NOT a valid request'));}}
 assert(methodHelp('card source').includes('{"force":true}'));
});
test('bash and zsh execute generated adapters with real CLI context results',async t=>{
 const w=await fixture(t),bin=path.join(w,'bin');await fs.mkdir(bin);
 const launcher=path.join(bin,'margin-reader');await fs.writeFile(launcher,'#!/bin/sh\nexec node "$MR_CLI" "$@"\n',{mode:0o755});
 const shellEnv={...env,MR_CLI:cli,PATH:bin+path.delimiter+env.PATH};
 for(const shell of ['bash','zsh']){
  const script=path.join(w,'completion.'+shell);await fs.writeFile(script,completion(shell));
  let code;
  if(shell==='bash')code='source "$MR_COMPLETION"; COMP_WORDS=(margin-reader review grade --rating g); COMP_CWORD=4; _margin_reader_complete; printf "%s\\n" "${COMPREPLY[@]}"';
  else code='autoload -Uz compinit; compinit -D; source "$MR_COMPLETION"; compadd() { shift; printf "%s\\n" "$@"; }; words=(margin-reader review grade --rating g ignored-after-cursor); CURRENT=5; _margin_reader_complete';
  const p=spawnSync(shell,['-c',code],{env:{...shellEnv,MR_COMPLETION:script},encoding:'utf8',timeout:30000});
  assert.equal(p.status,0,shell+': '+p.stderr);assert.equal(p.stdout.trim(),'good');assert.equal(p.stderr,'');
 }
 const fish=spawnSync('fish',['--version'],{encoding:'utf8'});if(fish.error?.code==='ENOENT')t.diagnostic('fish executable unavailable; fish adapter generated, not runtime-verified');else{
  const script=path.join(w,'completion.fish');await fs.writeFile(script,completion('fish'));
  const p=spawnSync('fish',['-c','source "$MR_COMPLETION"; complete -C "margin-reader review grade --rating g"'],{env:{...shellEnv,MR_COMPLETION:script},encoding:'utf8',timeout:30000});
  assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),'good');
 }
});
