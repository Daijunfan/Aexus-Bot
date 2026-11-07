// At whole-map zoom, topics smaller than readable text are represented by
// batched glyphs. Every visible topic remains in this layer and in hit testing;
// selected/focused topics can still mount their full accessible HTML.
export function overviewGlyphs(layout,ids,selected,highlighted){
 const groups=new Map();let count=0;
 for(const id of ids){if(id===selected)continue;const p=layout.positions.get(id),t=layout.topics.get(id);if(!p||!t)continue;const color=t.fill==='none'?t.accent:t.fill,opacity=highlighted&&!highlighted.has(id)?.2:1,key=color+'|'+t.borderColor+'|'+opacity;
  if(!groups.has(key))groups.set(key,{fill:color,stroke:t.borderColor,opacity,paths:[]});groups.get(key).paths.push(`M${p.x},${p.y}h${p.width}v${p.height}h-${p.width}Z`);count++;
 }
 return {count,svg:`<g class="mm-overview-glyphs" aria-label="${count} 个完整主题的缩略表示">${[...groups.values()].map(g=>`<path d="${g.paths.join(' ')}" fill="${g.fill}" stroke="${g.stroke}" stroke-width="1.3" opacity="${g.opacity}"/>`).join('')}</g>`};
}
export function hitTopic(layout,x,y,tolerance=0,index=null,order=null){
 // The complete layout remains authoritative. Querying the viewport's index
 // merely avoids testing every offscreen topic for each pointer event.
 const pad=Math.max(0,tolerance),ids=index?index.query({x:x-pad,y:y-pad,width:2*pad,height:2*pad}):layout.positions.keys();
 const rank=id=>order?.get(id)??Infinity;
 let hit=null;
 for(const id of ids){
  const p=layout.positions.get(id);if(!p)continue;
  if(x>=p.x&&y>=p.y&&x<=p.x+p.width&&y<=p.y+p.height){
   const score=p.width*p.height;
   if(!hit||score<hit.score||score===hit.score&&rank(id)<rank(hit.id))hit={id,score};
  }
 }
 if(hit)return hit.id;
 // At overview scales a topic may be narrower than one physical pixel.
 // Keep nearest-center tolerance and stable source-order ties unchanged.
 if(tolerance>0){
  let distance=tolerance;
  for(const id of ids){
   const p=layout.positions.get(id);if(!p)continue;
   const d=Math.hypot(x-p.x-p.width/2,y-p.y-p.height/2);
   if(d<distance||hit&&d===distance&&rank(id)<rank(hit.id)){distance=d;hit={id};}
  }
 }
 return hit?.id||null;
}
