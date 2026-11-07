'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTerminalVisuals}=require('../terminal-visuals/index.cjs');

test('first spatial navigation reveals a distant selected node at every supported viewport size',async()=>{
 // ASCII measurement keeps this projection-only regression independent of I/O
 // and optional renderer dependencies; the existing suite covers Unicode cells.
 const visual=await createTerminalVisuals({measure:s=>s.length});
 for(const [x,y] of [[10000,10000],[-10000,-10000]])for(const [columns,rows] of [[80,24],[120,40],[40,12]]){
  const scene=visual.prepare({study:{id:'set',revision:1,cards:[{id:'far',title:'Source context'}]},geometry:{revision:1,positions:[{cardId:'far',x,y,width:200,height:100}],links:[]}});
  for(const direction of ['left','right','up','down']){
   const before=visual.initialState(),result=visual.reduce(scene,before,{type:'navigate',direction},{columns,rows});
   assert.equal(result.state.selectedId,'far');assert.deepEqual(result.effects,[]);
   assert.deepEqual(visual.render(scene,result.state,{columns,rows,glyphs:'ascii'}).visibleIds,['far']);
   assert.deepEqual(before,visual.initialState());
  }
 }
});

test('hidden selection requests explicit reveal and never silently chooses a different card',async()=>{
 const visual=await createTerminalVisuals({measure:s=>s.length});
 const scene=visual.prepare({study:{id:'set',revision:2,cards:[{id:'hidden',title:'Hidden'}, {id:'shown',title:'Shown'}]},geometry:{revision:2,positions:[{cardId:'shown',x:0,y:0,width:200,height:100}],links:[]}});
 const result=visual.reduce(scene,visual.initialState({selectedId:'hidden'}),{type:'navigate',direction:'right'},{columns:80,rows:24});
 assert.equal(result.state.selectedId,'hidden');assert.deepEqual(result.effects,[{type:'reveal-required',cardId:'hidden'}]);
});
