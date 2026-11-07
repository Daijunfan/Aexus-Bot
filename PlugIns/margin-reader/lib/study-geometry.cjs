'use strict';
// Public geometry DTO boundary. Shared renderer layouts retain their Maps.
function projection(set) {
  const ids=new Set(set.cards.map(c=>c.id)),children=new Map(),depths=new Map(),cuts=new Set();
  for(const c of set.cards){const parent=ids.has(c.parentId)?c.parentId:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(c);}
  const queue=(children.get(null)||[]).map(c=>[c.id,0]);
  for(let i=0;i<queue.length;i++){const [id,depth]=queue[i];if(depths.has(id))continue;depths.set(id,depth);if(depth&&depth%64===0)cuts.add(id);for(const c of children.get(id)||[])queue.push([c.id,depth+1]);}
  // Corrupt/legacy cycles cannot make the projection recurse forever.
  for(const c of set.cards)if(!depths.has(c.id))cuts.add(c.id);
  return {cards:set.cards.map(c=>({...c,parentId:cuts.has(c.id)?null:c.parentId,collapsed:false,submap:false,inMap:true})),cuts,
    map:{...set.map,focusId:null,submapId:null,mindmap:{...set.map?.mindmap,items:(set.map?.mindmap?.items||[]).map(i=>i.kind==='zone'?{...i,style:{...i.style,collapsed:false}}:i)}}};
}
function boundedViewCards(set) {
  // Table-width measurement scans descendants before the shared 64-level
  // rendering cutoff. Bound only the all-scope visibility probe, never view.
  if(set.map?.mindmap?.enabled===false)return set.cards;
  const ids=new Set(set.cards.map(c=>c.id)),children=new Map();
  for(const c of set.cards){const parent=ids.has(c.parentId)?c.parentId:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(c);}
  const scope=set.map?.focusId||set.map?.submapId,queue=scope?[[scope,0]]:(children.get(null)||[]).map(c=>[c.id,0]),seen=new Set();
  for(let i=0;i<queue.length;i++){const [id,depth]=queue[i];if(seen.has(id))continue;seen.add(id);if(depth<64)for(const c of children.get(id)||[])queue.push([c.id,depth+1]);}
  return set.cards.filter(c=>seen.has(c.id));
}
async function geometry(set,scope='view') {
  const {layoutStudy}=await import('../ui/study-map-layout.mjs'),{extendInkLayout}=await import('../ui/ink-binding.mjs');
  const view=layoutStudy(scope==='all'?boundedViewCards(set):set.cards,set.map,set.appearance),byId=new Map(set.cards.map(c=>[c.id,c]));
  let layout=view;const reasons=new Map();
  if(scope==='all'){
    const projected=projection(set);layout=layoutStudy(projected.cards,projected.map,set.appearance);
    for(const id of layout.positions.keys())reasons.set(id,projected.cuts.has(id)?'depth-continuation':view.positions.has(id)?'view':'expanded-projection');
    // Detached summaries and unusual legacy inputs get measured, deterministic
    // overflow rows, without rewriting their model parent or inventing roots.
    let y=layout.height+60;
    for(const card of set.cards)if(!layout.positions.has(card.id)){
      const one=layoutStudy([{...card,parentId:null,collapsed:false,submap:false,inMap:true,position:null}],{...projected.map,mindmap:{...projected.map.mindmap,items:[]}},set.appearance);
      const box=one.positions.get(card.id);layout.positions.set(card.id,{...box,x:50,y});
      if(layout.topics&&one.topics?.has(card.id))layout.topics.set(card.id,one.topics.get(card.id));
      reasons.set(card.id,'overflow-placement');y+=box.height+40;
      layout.width=Math.max(layout.width,box.width+120);layout.height=y;
    }
    const edges=new Set(layout.links.map(l=>l.from+'\0'+l.to)),viewEdges=new Set(view.links.map(l=>l.from+'\0'+l.to));
    for(const card of set.cards)if(byId.has(card.parentId)&&!edges.has(card.parentId+'\0'+card.id)){
      layout.links.push({from:card.parentId,to:card.id,style:layout.mindmap?'mindmap':'tree0',line:'straight',width:1.5,color:layout.config?.ink||'#64748b',projection:true,placementReason:'parent-continuation'});
    }
    layout.links=layout.links.map(l=>({...l,viewVisible:viewEdges.has(l.from+'\0'+l.to)}));
  }
  // Deliberately use the original set for ink visibility, focus and layer rules.
  layout=extendInkLayout(set,layout);
  const positions=[...layout.positions].map(([cardId,box])=>({cardId,...box,imageBounds:layout.mindmap?(box.imageBounds||null):require('./image-ink.cjs').frame(byId.get(cardId),box.width,box.height,set.appearance),viewVisible:view.positions.has(cardId),placementReason:reasons.get(cardId)||'view'}));
  const {topics,positions:_,...rest}=layout;
  return {revision:set.revision,...rest,scope,total:set.cards.length,positioned:positions.length,positions,topics:topics?[...topics].map(([cardId,topic])=>({cardId,...topic})):[]};
}
module.exports={geometry};
