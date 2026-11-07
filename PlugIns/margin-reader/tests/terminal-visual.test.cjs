'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {createTerminalVisuals}=require('../terminal-visuals/index.cjs');
const {renderMapSnapshot}=require('../terminal-visuals/cli.cjs');
const {fixture,actions}=require('./terminal-visual-fixtures.cjs');
test('geometry, full objects, revision and navigation',async()=>{
  const v=await createTerminalVisuals(),f=fixture();f.geometry.positions.pop();
  const scene=v.prepare(f);assert.equal(scene.cards.size,4);assert.equal(scene.boxes.size,3);assert.strictEqual(scene.study,f.study);
  assert.throws(()=>v.prepare({...f,geometry:{...f.geometry,revision:8}}),{code:'STALE_SCENE'});
  let s=v.initialState({selectedId:'c0'});
  s=v.reduce(scene,s,{type:'navigate',direction:'right'},{columns:80,rows:24}).state;assert.equal(s.selectedId,'c1');
  s=v.reduce(scene,s,{type:'parent'},{columns:80,rows:24}).state;assert.equal(s.selectedId,'c0');
  s=v.reduce(scene,s,{type:'child'},{columns:80,rows:24}).state;assert.equal(s.selectedId,'c1');
  s=v.reduce(scene,s,{type:'sibling'},{columns:80,rows:24}).state;assert.equal(s.selectedId,'c2');
  const r=v.reduce(scene,s,{type:'select',cardId:'c3'},{columns:80,rows:24});assert.deepEqual(r.effects,[{type:'reveal-required',cardId:'c3'}]);
  assert.equal(r.state.selectedId,'c3');assert.equal(v.render(scene,r.state,{columns:80,rows:24}).stats.totalCards,4);
});
test('Unicode lines are exact column width, plain and bounded after clipping',async()=>{
  const v=await createTerminalVisuals(),width=(await import('string-width')).default,scene=v.prepare(fixture(50));
  for(const columns of [1,2,7,40,80])for(const zoom of [.03,.2,1,4,16]){
    let s=v.initialState({selectedId:'c0',centerX:-500,centerY:-210,zoom});
    const frame=v.render(scene,s,{columns,rows:13,color:'none'});
    assert.equal(frame.lines.length,13);for(const line of frame.lines){assert.equal(width(line),columns);assert.doesNotMatch(line,/[\x00-\x1f\x7f-\x9f]/);}
    assert.equal(v.toPlainText(frame).split('\n').length,13);assert.equal(frame.stats.bufferCells,columns*13);
  }
  assert.throws(()=>v.render(scene,v.initialState(),{columns:1000,rows:1000}),{code:'VIEWPORT_LIMIT'});
});
test('control injection, selection and camera operations',async()=>{
  const v=await createTerminalVisuals(),f=fixture();f.study.cards[0].title='hello\x1b]52;secret\x07中文';
  const scene=v.prepare(f),vp={columns:80,rows:24};let s=v.initialState({selectedId:'c0'});
  s=v.reduce(scene,s,{type:'center-selection'},vp).state;
  const start={...s};s=v.reduce(scene,s,{type:'pan',dx:3,dy:-2},vp).state;assert.equal(s.centerX,start.centerX+36);
  s=v.reduce(scene,s,{type:'zoom',factor:2},vp).state;assert.equal(s.zoom,2);
  for(const a of actions)s=v.reduce(scene,s,a,vp).state;
  const frame=v.render(scene,s,{...vp,glyphs:'ascii'});assert.ok(frame.visibleIds.includes(s.selectedId));assert.ok(frame.lines.join('').includes('>'));
  assert.doesNotMatch(v.toPlainText(frame),/\x1b|\x07/);
  assert.throws(()=>v.reduce(scene,s,{type:'pan',dx:Infinity},vp),{code:'INVALID_ACTION'});
});
test('hierarchy and relationship crossing viewport with offscreen endpoints',async()=>{
  const v=await createTerminalVisuals(),f=fixture(2);
  f.geometry.positions=[{cardId:'c0',x:-1000,y:-20,width:40,height:40},{cardId:'c1',x:1000,y:-20,width:40,height:40}];
  f.geometry.links=[{from:'c0',to:'c1'}];f.study.links=[{id:'knowledge',from:'c0',to:'c1',curve:[[-1000,48],[1000,48]]}];
  const frame=v.render(v.prepare(f),v.initialState(),{columns:40,rows:12});
  assert.equal(frame.stats.visibleCards,0);assert.equal(frame.stats.renderedEdges,2);
  assert.match(frame.lines.join(''),/·/);assert.match(frame.lines.join(''),/:/);assert.ok(frame.hits.some(x=>x.linkId==='knowledge'));
});
test('snapshot only uses injected public reads and rejects stale source revision',async()=>{
  const f=fixture(),calls=[];const request=async(m,p)=>{calls.push([m,p]);return m==='study.get'?f.study:f.geometry;};
  const r=await renderMapSnapshot({request,setId:'fixture',columns:40,rows:12,selectedId:'c1'});
  assert.deepEqual(calls.map(x=>x[0]),['study.get','study.map.geometry']);assert.equal(r.revision,7);assert.equal(r.state.selectedId,'c1');
  await assert.rejects(renderMapSnapshot({setId:'fixture',request:async m=>m==='study.get'?f.study:{...f.geometry,revision:8}}),{code:'STALE_SCENE'});
});
test('10000 real synthetic cards: bounded frames and actual navigation/render work',async t=>{
  const v=await createTerminalVisuals(),f=fixture(10000),start=performance.now(),scene=v.prepare(f),vp={columns:120,rows:36};
  let s=v.reduce(scene,v.initialState({selectedId:'c0'}),{type:'center-selection'},vp).state;
  const prepareMs=performance.now()-start,renderStart=performance.now(),navigation=[],renderTimes=[];let visible=0;
  for(let i=0;i<100;i++){
    const navStart=performance.now();s=v.reduce(scene,s,{type:'navigate',direction:i%2?'down':'right'},vp).state;navigation.push(performance.now()-navStart);
    const frameStart=performance.now(),frame=v.render(scene,s,vp);renderTimes.push(performance.now()-frameStart);visible+=frame.stats.visibleCards;assert.equal(frame.stats.totalCards,10000);assert.equal(frame.stats.bufferCells,4320);assert.ok(frame.visibleIds.includes(s.selectedId));
  }
  assert.ok(visible>100);assert.equal(scene.study.cards.length,10000);
  const percentile=a=>{const sorted=[...a].sort((x,y)=>x-y);return {p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
  const os=require('node:os');t.diagnostic(JSON.stringify({synthetic:true,platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,totalMemory:os.totalmem(),navigationMs:percentile(navigation),renderMs:percentile(renderTimes),cards:10000,frames:100,prepareMs:+prepareMs.toFixed(2),navigateRenderMs:+(performance.now()-renderStart).toFixed(2),heapUsed:process.memoryUsage().heapUsed}));
});

test('coordinate and edge budgets reject pathological input',async()=>{
 const v=await createTerminalVisuals(),f=fixture(1);
 f.geometry.positions[0].x=1e200;assert.throws(()=>v.prepare(f),{code:'INVALID_GEOMETRY'});
 f.geometry.positions[0].x=0;f.geometry.links=Array(500001).fill({from:'c0',to:'c0'});assert.throws(()=>v.prepare(f),{code:'EDGE_LIMIT'});
});

test('10001 cards remain complete; bidi controls cannot spoof labels',async()=>{
 const v=await createTerminalVisuals(),f=fixture(10001);f.study.cards[0].title='A\u202eB\u2066C\u200fD 👨‍👩‍👧‍👦 é';
 const scene=v.prepare(f);assert.equal(scene.cards.size,10001);assert.equal(scene.boxes.size,10001);
 const vp={columns:120,rows:36},state=v.reduce(scene,v.initialState({selectedId:'c0'}),{type:'center-selection'},vp).state;
 const frame=v.render(scene,state,vp),text=v.toPlainText(frame);assert.doesNotMatch(text,/[\u202a-\u202e\u2066-\u2069\u200f]/);assert.match(text,/A�B�C�D/);assert.equal(frame.stats.totalCards,10001);
});
