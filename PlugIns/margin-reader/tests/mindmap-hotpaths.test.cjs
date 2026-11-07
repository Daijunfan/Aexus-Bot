'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('spatial branch culling reproduces the full viewport SVG in original paint order',async()=>{
 const {layoutMindmap}=await import('../ui/mindmap-layout.mjs');
 const {branchPaintBounds,diagramPaths}=await import('../ui/mindmap-view.mjs');
 const {ViewportIndex,intersects}=await import('../ui/viewport-index.mjs');
 const cards=[{id:'root',title:'Root',parentId:null},...Array.from({length:1500},(_,i)=>({id:'n'+i,title:'Branch '+i,parentId:'root'}))];
 const layout=layoutMindmap(cards,{mindmap:{enabled:true}});
 const index=new ViewportIndex(layout.links.map((link,i)=>[i,branchPaintBounds(layout,link)]));
 for(let i=0;i<35;i++){
  const p=layout.positions.get('n'+(i*43)%1500),box={x:p.x-200,y:p.y-120,width:760,height:460};
  const options={filter:item=>intersects(item,box)};
  assert.equal(diagramPaths(layout,[],{...options,branchCandidates:index.query(box)}),diagramPaths(layout,[],options),'all visible branches and drawing order retained at '+i);
 }
});
test('indexed pointer hit testing exactly matches full-graph selection and tolerance',async()=>{
 const {hitTopic}=await import('../ui/mindmap-overview.mjs');
 const {ViewportIndex}=await import('../ui/viewport-index.mjs');
 const positions=new Map(Array.from({length:10000},(_,i)=>['n'+i,{x:(i%100)*190,y:Math.floor(i/100)*120,width:160,height:85}]));
 // Same-area overlap, tiny inner target and a large box exercise ties and grid overflow.
 positions.set('first',{x:400,y:400,width:200,height:200});
 positions.set('second',{x:400,y:400,width:200,height:200});
 positions.set('inner',{x:450,y:450,width:30,height:30});
 positions.set('huge',{x:-2000,y:-2000,width:120000,height:80000});
 const layout={positions},index=new ViewportIndex(positions),order=new Map([...positions.keys()].map((id,i)=>[id,i]));
 let seed=10333;const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/2**32);
 for(let i=0;i<250;i++){
  const x=random()*22000-1100,y=random()*14000-700,tolerance=i%3?0:120;
  assert.equal(hitTopic(layout,x,y,tolerance,index,order),hitTopic(layout,x,y,tolerance),'pointer mismatch at '+i);
 }
 assert.equal(hitTopic(layout,470,470,0,index,order),'inner');
 assert.equal(hitTopic(layout,410,410,0,index,order),hitTopic(layout,410,410,0));
});
test('topic collapse affordance reindexes parent changes at the new study revision',async()=>{
 const {layoutMindmap}=await import('../ui/mindmap-layout.mjs');
 const {topicMarkup}=await import('../ui/mindmap-view.mjs');
 const cards=[{id:'root',title:'Parent',parentId:null},{id:'child',title:'Child',parentId:'root'}],set={revision:1,cards};
 const layout=layoutMindmap(cards,{mindmap:{enabled:true}}),p=layout.positions.get('root'),t=layout.topics.get('root');
 const html=()=>topicMarkup(cards[0],p,t,set,'http://127.0.0.1:1/','more');
 assert.match(html(),/study-card-collapse/);
 cards[1].parentId=null;set.revision=2;
 assert.doesNotMatch(html(),/study-card-collapse/);
 cards[1].parentId='root';set.revision=3;
 assert.match(html(),/study-card-collapse/);
});
