'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {geometry}=require('../lib/study-geometry.cjs');
const card=(id,parentId=null,extra={})=>({id,parentId,title:'Topic '+id,kind:'note',text:'',...extra});
const set=(cards,map={})=>({id:'synthetic',revision:7,cards,map,appearance:{},canvasInk:[]});
function complete(s,g){assert.equal(g.total,s.cards.length);assert.equal(g.positioned,s.cards.length);assert.equal(new Set(g.positions.map(p=>p.cardId)).size,s.cards.length);for(const p of g.positions){for(const k of ['x','y','width','height'])assert(Number.isFinite(p[k]));assert(p.width>0&&p.height>0);assert.equal(typeof p.viewVisible,'boolean');assert(p.placementReason);}assert.deepEqual(JSON.parse(JSON.stringify(g)).topics,g.topics);}
test('view DTO fixes Map JSON loss and preserves shared layout, positions and ink',async()=>{
 const {layoutStudy}=await import('../ui/study-map-layout.mjs'),{extendInkLayout}=await import('../ui/ink-binding.mjs');
 for(const map of [{},{mindmap:{enabled:false}}]){
  const s=set([card('a',null,{collapsed:true}),card('b','a')],map);s.canvasInk=[{points:[[2000,2000],[2200,2100]],width:4,color:'red'}];
  const internal=extendInkLayout(s,layoutStudy(s.cards,s.map,s.appearance)),g=await geometry(s),explicit=await geometry(s,'view');
  assert.deepEqual(g,explicit);assert.equal(g.width,internal.width);assert.equal(g.height,internal.height);assert.deepEqual(g.links,internal.links);
  assert.deepEqual(g.positions.map(({cardId,x,y,width,height})=>[cardId,{x,y,width,height}]),[...internal.positions]);
  assert(Array.isArray(g.topics));if(internal.mindmap){assert(internal.topics instanceof Map);assert.equal(g.topics[0].cardId,'a');assert.equal(g.topics[0].shape,internal.topics.get('a').shape);}
 }
});
test('all covers hidden, collapsed, focus, submaps, zones, summaries and empty maps without mutation',async()=>{
 const cards=[card('r',null,{collapsed:true}),card('a','r',{submap:true}),card('b','a',{inMap:false,source:{documentId:'stable-source',locator:{page:2}}}),card('s'),card('sc','s'),card('hidden',null,{inMap:false})];
 for(const enabled of [true,false])for(const focus of [null,'a']){
  const s=set(cards,{focusId:focus,submapId:focus,mindmap:{enabled,items:[{id:'zone',kind:'zone',cardIds:['r'],style:{collapsed:true}},{id:'sum',kind:'summary',cardIds:['b'],topicId:'s',style:{}}]}});
  const before=JSON.stringify(s),view=await geometry(s),g=await geometry(s,'all');complete(s,g);assert.equal(JSON.stringify(s),before);assert.equal(g.revision,7);
  const visible=new Set(view.positions.map(p=>p.cardId));for(const p of g.positions)assert.equal(p.viewVisible,visible.has(p.cardId));
  for(const c of cards)if(c.parentId)assert(g.links.some(l=>l.from===c.parentId&&l.to===c.id));
 }
 complete(set([]),await geometry(set([]),'all'));
 const s=set([card('s'),card('child','s')],{mindmap:{items:[{id:'orphan',kind:'summary',cardIds:['missing'],topicId:'s',style:{}}]}});complete(s,await geometry(s,'all'));
});
test('10k shallow and deep projections retain every identity and parent edge, with measured costs',async()=>{
 for(const kind of ['shallow','deep']){
  const cards=Array.from({length:10000},(_,i)=>card('c'+i,i?'c'+(kind==='deep'?i-1:i<201?0:1+(i-201)%200):null,{collapsed:i===0}));
  const s=set(cards),before=JSON.stringify(s),samples=[];
  for(let run=0;run<2;run++){const start=performance.now(),g=await geometry(s,'all'),layoutMs=performance.now()-start,jsonStart=performance.now(),json=JSON.stringify(g);samples.push({ms:Math.round(layoutMs),jsonMs:Math.round(performance.now()-jsonStart),bytes:Buffer.byteLength(json)});complete(s,g);const edges=new Set(g.links.map(l=>l.from+'\0'+l.to));for(const c of cards)if(c.parentId)assert(edges.has(c.parentId+'\0'+c.id));}
  assert.equal(JSON.stringify(s),before);console.log('geometry benchmark',kind,JSON.stringify(samples));
 }
});
test('public schema is strict and geometry preserves actual persisted bytes and revision',async t=>{
 const root=path.resolve(__dirname,'../artifacts/cli-product-20261018/core-e');await fs.mkdir(root,{recursive:true});const workspace=await fs.mkdtemp(path.join(root,'workspace-'));
 const {createPlugin}=require('../runtime.cjs'),runtime=await createPlugin({workspace});t.after(()=>runtime.close());
 const raw=(method,params={})=>runtime.request({jsonrpc:'2.0',id:1,method,params});const api=async(m,p)=>{const r=await raw(m,p);assert(!r.error,JSON.stringify(r.error));return r.result;};
 let s=await api('study.create',{title:'Synthetic only'});s=await api('study.mindmap.outline.import',{setId:s.id,expectedRevision:s.revision,text:'Root\n  Child\n    Leaf'});s=await api('study.card.update',{setId:s.id,expectedRevision:s.revision,cardId:s.cards[0].id,collapsed:true});
 const state=path.join(workspace,'.margin-reader/state.json'),before=await fs.readFile(state);const events=[];const unsubscribe=runtime.subscribe(e=>events.push(e));
 for(const scope of [undefined,'view','all']){const g=await api('study.map.geometry',{setId:s.id,...(scope?{scope}:{})});assert.equal(g.revision,s.revision);if(scope==='all')complete(s,g);}
 assert.deepEqual(await fs.readFile(state),before);assert.equal(events.length,0);if(typeof unsubscribe==='function')unsubscribe();
 for(const scope of [null,[],{},false,'visible','ALL'])assert.equal((await raw('study.map.geometry',{setId:s.id,scope})).error?.data?.code,'INVALID_PARAMS');
 assert.equal((await raw('study.map.geometry',{setId:s.id,unknown:true})).error?.data?.code,'INVALID_PARAMS');
 const commands=require('../scripts/contracts.cjs').commands,schema=require('../schema.json').commands;assert.equal(commands.length,275);assert.equal(new Set(commands.map(c=>c.method)).size,275);assert.deepEqual(schema,commands);
});

test('all safely bounds deep table measurement without changing the internal depth limit',async()=>{
 const cards=Array.from({length:1000},(_,i)=>card('t'+i,i?'t'+(i-1):null));
 const s=set(cards,{mindmap:{structure:'tree-table-right'}}),before=JSON.stringify(s);const g=await geometry(s,'all');complete(s,g);assert.equal(JSON.stringify(s),before);
});
test('persisted legacy deep hidden/focused zone graph keeps exact bytes and stable sources',async t=>{
 const root=path.resolve(__dirname,'../artifacts/cli-product-20261018/core-e'),workspace=await fs.mkdtemp(path.join(root,'workspace-deep-'));
 const {createPlugin}=require('../runtime.cjs');let runtime=await createPlugin({workspace});const r=await runtime.request({jsonrpc:'2.0',id:1,method:'study.create',params:{title:'Legacy synthetic'}});assert(!r.error);await runtime.close();
 const file=path.join(workspace,'.margin-reader/state.json'),state=JSON.parse(await fs.readFile(file,'utf8')),s=state.studySets[r.result.id];
 s.cards=Array.from({length:140},(_,i)=>card('legacy'+i,i?'legacy'+(i-1):null,{collapsed:i===0,submap:i===1,inMap:i!==2,source:i===3?{documentId:'synthetic-document',hash:'synthetic',locator:{page:3}}:null}));
 s.map={focusId:'legacy1',mindmap:{items:[{id:'z',kind:'zone',cardIds:['legacy0'],style:{collapsed:true}}]}};
 await fs.writeFile(file,JSON.stringify(state));runtime=await createPlugin({workspace});t.after(()=>runtime.close());const before=await fs.readFile(file);
 const result=await runtime.request({jsonrpc:'2.0',id:1,method:'study.map.geometry',params:{setId:s.id,scope:'all'}});assert(!result.error,JSON.stringify(result.error));complete(s,result.result);assert.equal(result.result.revision,s.revision);assert.deepEqual(await fs.readFile(file),before);
 const after=JSON.parse(await fs.readFile(file,'utf8')).studySets[s.id];assert.deepEqual(after.cards,s.cards);assert.deepEqual(after.map,s.map);
});

test('image bounds and hidden/focus ink semantics survive public projection',async()=>{
 const {layoutStudy}=await import('../ui/study-map-layout.mjs');
 for(const enabled of [true,false]){
  const s=set([card('image',null,{image:{width:200,height:100},ink:[{points:[[500,500],[600,600]],width:3,hidden:true}]}),card('other')],{focusId:'image',mindmap:{enabled,showImages:true}});
  s.canvasInk=[{points:[[1e6,1e6],[2e6,2e6]],width:5}];
  const before=JSON.stringify(s),view=await geometry(s),all=await geometry(s,'all');
  const box=view.positions[0];assert(box.imageBounds);if(enabled)assert.deepEqual(box.imageBounds,layoutStudy(s.cards,s.map,s.appearance).positions.get('image').imageBounds);
  assert(all.width<1e6&&all.height<1e6,'all must not expose focused-out canvas or hidden card ink');assert.equal(JSON.stringify(s),before);
 }
});
