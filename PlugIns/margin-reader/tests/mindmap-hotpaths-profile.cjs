'use strict';
// Repeatable in-memory hot-path profile; no personal library, network or GUI.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const os=require('node:os');
(async()=>{
  const {layoutMindmap}=await import('../ui/mindmap-layout.mjs');
  const {topicMarkup,diagramPaths}=await import('../ui/mindmap-view.mjs');
  const {hitTopic}=await import('../ui/mindmap-overview.mjs');
  const {ViewportIndex,intersects}=await import('../ui/viewport-index.mjs');
  const cards=[{id:'root',title:'Knowledge map',parentId:null}];
  for(let i=0;i<200;i++){
    const parent='branch-'+i;
    cards.push({id:parent,title:'Branch '+i,parentId:'root'});
    for(let j=0;j<(i===199?48:49);j++)cards.push({id:'topic-'+i+'-'+j,title:'Topic '+i+' / '+j,parentId:parent});
  }
  assert.equal(cards.length,10000);
  const layout=layoutMindmap(cards,{mindmap:{enabled:true}});
  assert.equal(layout.positions.size,10000);
  const set={revision:1,cards},counts=new Map();
  for(const c of cards)counts.set(c.parentId,(counts.get(c.parentId)||0)+1);
  const sample=cards.filter((_,i)=>i%23===0).slice(0,420);
  const positionEntries=[...layout.positions];
  const index=new ViewportIndex(positionEntries);
  const linkIndex=new ViewportIndex(layout.links.map((l,i)=>{
    const a=layout.positions.get(l.from),b=layout.positions.get(l.to);
    return [i,{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x)+a.width+b.width,height:Math.abs(a.y-b.y)+a.height+b.height}];
  }));
  const boxes=Array.from({length:40},(_,i)=>{
    const p=positionEntries[Math.floor(i*positionEntries.length/40)][1];
    return {x:p.x-240,y:p.y-240,width:960,height:760};
  });
  const checks=boxes.map(box=>({filter:item=>intersects(item,box),branchCandidates:linkIndex.query(box)}));
  const points=Array.from({length:800},(_,i)=>{
    const p=positionEntries[(i*73)%positionEntries.length][1];
    return [p.x+p.width/2,p.y+p.height/2,0];
  });
  const measure=(label,repeat,fn)=>{
    for(let i=0;i<2;i++)fn();
    const times=[];
    for(let r=0;r<5;r++){const start=performance.now();for(let i=0;i<repeat;i++)fn();times.push(Math.round((performance.now()-start)*100)/100);}
    const sorted=[...times].sort((a,b)=>a-b);
    return {totalCalls:repeat,samplesMs:times,medianMs:sorted[2]};
  };
  const metrics={};
  metrics.topicMarkup=measure('topicMarkup',1,()=>{for(const c of sample){const p=layout.positions.get(c.id),t=layout.topics.get(c.id);const html=topicMarkup(c,p,t,set,'http://127.0.0.1:1/','…',counts);assert(html.includes('data-card-id'));}});
  metrics.diagramPaths=measure('diagramPaths',1,()=>{for(let i=0;i<boxes.length;i++){const html=diagramPaths(layout,[],checks[i]);assert(typeof html==='string');}});
  metrics.hitTopic=measure('hitTopic',1,()=>{for(const [x,y,t] of points)assert(hitTopic(layout,x,y,t,index));});
  const report={platform:process.platform,cpu:os.cpus()[0]?.model,node:process.version,cards:cards.length,links:layout.links.length,samples:{markup:sample.length,panBoxes:boxes.length,pointerHits:points.length},metrics};
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
