'use strict';
const LIMITS = Object.freeze({cells:100000,cards:100000,segments:64,minZoom:0.02,maxZoom:16,edges:500000});
const finite = Number.isFinite;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function viewport(v={}) {
  const columns=v.columns??120, rows=v.rows??36;
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>LIMITS.cells)fail('VIEWPORT_LIMIT','Viewport must contain 1–100000 cells.');
  return {columns,rows};
}
const clean=s=>String(s??'').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,'�').replace(/\p{Cf}/gu,c=>c==='\u200c'||c==='\u200d'?c:'�');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function clip(x0,y0,x1,y1,w,h){
  let lo=0,hi=1,dx=x1-x0,dy=y1-y0;
  for(const [p,q] of [[-dx,x0],[dx,w-1-x0],[-dy,y0],[dy,h-1-y0]]){
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
  }
  return [x0+lo*dx,y0+lo*dy,x0+hi*dx,y0+hi*dy];
}
async function createTerminalVisuals({measure,segment}={}){
  measure??=(await import('string-width')).default;
  const intl=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  segment??=s=>Array.from(intl.segment(s),x=>x.segment);
  const graphemes=s=>Array.from(segment(clean(s)),x=>typeof x==='string'?x:x.segment);
  function prepare({study,geometry}={}){
    if(!study||!geometry||study.revision!==geometry.revision)fail('STALE_SCENE','Study and geometry revisions must match.');
    if(!Array.isArray(study.cards)||study.cards.length>LIMITS.cards||!Array.isArray(geometry.positions)||geometry.positions.length>LIMITS.cards)fail('INVALID_SCENE','Expected complete cards and positions arrays (at most 100000 cards).');
    const cards=new Map(), boxes=new Map(), children=new Map(), warnings=[];
    for(const c of study.cards){
      if(!c||typeof c.id!=='string'||cards.has(c.id))fail('INVALID_SCENE','Duplicate or invalid card ID.');
      cards.set(c.id,c);
      const parent=c.parentId??null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(c.id);
    }
    for(const p of geometry.positions){
      if(!cards.has(p.cardId)){warnings.push({code:'UNKNOWN_POSITION',cardId:p.cardId});continue;}
      if(boxes.has(p.cardId)||![p.x,p.y,p.width,p.height].every(n=>finite(n)&&Math.abs(n)<=1e12)||p.width<=0||p.height<=0)fail('INVALID_GEOMETRY','Invalid or duplicate node bounds.');
      boxes.set(p.cardId,{...p});
    }
    if((geometry.links?.length||0)+(study.links?.length||0)>LIMITS.edges)fail('EDGE_LIMIT','At most 500000 edges are supported.');
    const edges=[];
    for(const [kind,rows] of [['hierarchy',geometry.links||[]],['relationship',study.links||[]]]){
      for(const l of rows){
        if(l.hidden)continue;
        if(l.toSetId&&l.toSetId!==study.id){warnings.push({code:'EXTERNAL_LINK',linkId:l.id});continue;}
        if(!boxes.has(l.from)||!boxes.has(l.to))continue;
        const a=boxes.get(l.from),b=boxes.get(l.to);
        let points=kind==='hierarchy'?l.points:l.curve;
        if(!Array.isArray(points)||points.length<2)points=[[a.x+a.width/2,a.y+a.height/2],[b.x+b.width/2,b.y+b.height/2]];
        if(points.length>LIMITS.segments+1){warnings.push({code:'EDGE_SIMPLIFIED',linkId:l.id});points=[points[0],points.at(-1)];}
        if(!points.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(finite))){warnings.push({code:'INVALID_EDGE',linkId:l.id});continue;}
        edges.push({id:l.id||kind+':'+l.from+':'+l.to,kind,from:l.from,to:l.to,label:clean(l.label),points});
      }
    }
    if(boxes.size<cards.size)warnings.push({code:'UNPOSITIONED_CARDS',count:cards.size-boxes.size});
    // topics is deliberately ignored: Core currently exposes a Map that JSON loses.
    const all=[...boxes.values()];
    const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
    for(const p of all){bounds.left=Math.min(bounds.left,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.right=Math.max(bounds.right,p.x+p.width);bounds.bottom=Math.max(bounds.bottom,p.y+p.height);}
    if(!all.length)Object.assign(bounds,{left:0,top:0,right:1,bottom:1});
    // Sorted x index: no world-sized bitmap and no pairwise navigation table.
    const xIndex=all.map(p=>[p.x,p.cardId]).sort((a,b)=>a[0]-b[0]);
    const maxWidth=all.reduce((n,p)=>Math.max(n,p.width),0);
    return {study,geometry,revision:study.revision,cards,boxes,children,edges,bounds,xIndex,maxWidth,warnings};
  }
  function initialState({selectedId=null,centerX=0,centerY=0,zoom=1}={}){
    if(!finite(centerX)||!finite(centerY)||!finite(zoom)||zoom<=0)fail('INVALID_CAMERA','Camera values must be finite; zoom must be positive.');
    return {selectedId,centerX,centerY,zoom:clamp(zoom,LIMITS.minZoom,LIMITS.maxZoom)};
  }
  function ensure(scene,state,v){
    const p=scene.boxes.get(state.selectedId);if(!p)return state;
    const sx=12/state.zoom,sy=24/state.zoom,hw=v.columns*sx/2,hh=v.rows*sy/2;
    const cx=p.x+p.width/2,cy=p.y+p.height/2;
    const center=(current,low,high,half)=>high-low>half*2?low+half:current<high-half?high-half:current>low+half?low+half:current;
    return {...state,centerX:center(state.centerX,p.x,p.x+p.width,hw),centerY:center(state.centerY,p.y,p.y+p.height,hh)};
  }
  function reduce(scene,state,action={},vp={}){
    const v=viewport(vp);let next=initialState(state),effects=[];
    const p=scene.boxes.get(next.selectedId);
    const select=id=>{
      if(!scene.cards.has(id)){effects.push({type:'diagnostic',code:'UNKNOWN_CARD',cardId:id});return;}
      next.selectedId=id;
      if(!scene.boxes.has(id))effects.push({type:'reveal-required',cardId:id});
    };
    switch(action.type){
      case 'pan':{
        const dx=action.dx??0,dy=action.dy??0;if(!finite(dx)||!finite(dy))fail('INVALID_ACTION','Pan must be finite.');
        next.centerX+=dx*12/next.zoom;next.centerY+=dy*24/next.zoom;break;
      }
      case 'zoom':{
        const z=action.zoom??next.zoom*(action.factor??1);
        if(!finite(z)||z<=0)fail('INVALID_ACTION','Zoom must be finite and positive.');
        const old=next.zoom;next.zoom=clamp(z,LIMITS.minZoom,LIMITS.maxZoom);
        if(p){const x=p.x+p.width/2,y=p.y+p.height/2;next.centerX=x-(x-next.centerX)*old/next.zoom;next.centerY=y-(y-next.centerY)*old/next.zoom;}
        next=ensure(scene,next,v);break;
      }
      case 'fit':{
        const b=scene.bounds;next.centerX=(b.left+b.right)/2;next.centerY=(b.top+b.bottom)/2;
        next.zoom=clamp(Math.min(Math.max(1,v.columns-4)*12/Math.max(1,b.right-b.left),Math.max(1,v.rows-2)*24/Math.max(1,b.bottom-b.top)),LIMITS.minZoom,LIMITS.maxZoom);break;
      }
      case 'center-selection':
        if(p){next.centerX=p.x+p.width/2;next.centerY=p.y+p.height/2;}
        else if(next.selectedId)effects.push({type:'reveal-required',cardId:next.selectedId});break;
      case 'select':select(action.cardId??action.selectedId);next=ensure(scene,next,v);break;
      case 'parent':{const id=scene.cards.get(next.selectedId)?.parentId;if(id)select(id);next=ensure(scene,next,v);break;}
      case 'child':{const id=scene.children.get(next.selectedId)?.[action.index??0];if(id)select(id);next=ensure(scene,next,v);break;}
      case 'sibling':{
        const card=scene.cards.get(next.selectedId),siblings=scene.children.get(card?.parentId??null)||[],i=siblings.indexOf(next.selectedId),delta=action.delta??1;
        if(!Number.isInteger(delta))fail('INVALID_ACTION','Sibling delta must be an integer.');
        if(i>=0&&siblings.length)select(siblings[(i+delta%siblings.length+siblings.length)%siblings.length]);next=ensure(scene,next,v);break;
      }
      case 'navigate':{
        const dirs={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]},d=dirs[action.direction];if(!d)fail('INVALID_ACTION','Unknown direction.');
        if(!p){if(next.selectedId)effects.push({type:'reveal-required',cardId:next.selectedId});else if(scene.boxes.size){select(scene.boxes.keys().next().value);next=ensure(scene,next,v);}break;}
        const x=p.x+p.width/2,y=p.y+p.height/2;let best=null;
        for(const [id,b] of scene.boxes){if(id===next.selectedId)continue;const dx=b.x+b.width/2-x,dy=b.y+b.height/2-y,forward=dx*d[0]+dy*d[1];if(forward<=0)continue;
          const side=Math.abs(dx*d[1]-dy*d[0]),overlap=d[0]?b.y<=p.y+p.height&&b.y+b.height>=p.y:b.x<=p.x+p.width&&b.x+b.width>=p.x;
          const score=[overlap?0:1,side/forward,Math.hypot(dx,dy),id];
          if(!best||score.some((n,i)=>n<best.score[i]&&score.slice(0,i).every((v,j)=>v===best.score[j])))best={id,score};
        }
        if(best)select(best.id);next=ensure(scene,next,v);break;
      }
      case 'resize':next=ensure(scene,next,v);break;
      default:fail('INVALID_ACTION','Unknown visual action.');
    }
    if(!finite(next.centerX)||!finite(next.centerY))fail('INVALID_CAMERA','Camera overflow.');
    return {state:next,effects};
  }
  function render(scene,input,options={}){
    const v=viewport(options),state=initialState(input),ascii=options.glyphs==='ascii';
    const cells=Array.from({length:v.rows},()=>Array(v.columns).fill(' ')),hits=[],visibleIds=[],warnings=[...scene.warnings];
    const sx=state.zoom/12,sy=state.zoom/24;
    const screen=(x,y)=>[(x-state.centerX)*sx+v.columns/2,(y-state.centerY)*sy+v.rows/2];
    const owners=Array.from({length:v.rows},()=>new Int32Array(v.columns).fill(-1));
    const put=(x,y,s)=>{
      if(x<0||y<0||x>=v.columns||y>=v.rows)return;
      const width=measure(s);if(!Number.isInteger(width)||width<1||x+width>v.columns)return;
      for(let j=x;j<x+width;j++){const owner=owners[y][j];if(owner>=0){const oldWidth=measure(cells[y][owner]);for(let k=owner;k<owner+oldWidth;k++){cells[y][k]=' ';owners[y][k]=-1;}}}
      cells[y][x]=s;for(let j=x;j<x+width;j++){owners[y][j]=x;if(j>x)cells[y][j]='';}
    };
    const drawLine=(a,b,glyph)=>{
      const c=clip(...a,...b,v.columns,v.rows);if(!c)return;
      let [x,y,x1,y1]=c.map(Math.round),dx=Math.abs(x1-x),dy=-Math.abs(y1-y),ax=x<x1?1:-1,ay=y<y1?1:-1,err=dx+dy;
      for(let n=0;n<v.columns+v.rows+2;n++){put(x,y,glyph);if(x===x1&&y===y1)break;const e=2*err;if(e>=dy){err+=dy;x+=ax;}if(e<=dx){err+=dx;y+=ay;}}
    };
    let renderedEdges=0;
    for(const e of scene.edges){
      let visible=false;
      for(let i=1;i<e.points.length;i++){
        const a=screen(...e.points[i-1]),b=screen(...e.points[i]);const c=clip(...a,...b,v.columns,v.rows);if(!c)continue;
        visible=true;drawLine(a,b,e.kind==='relationship'?':':ascii?'.':'·');
        const [x,y,x1,y1]=c;hits.push({kind:'link',linkId:e.id,from:e.from,to:e.to,x:Math.floor(Math.min(x,x1)),y:Math.floor(Math.min(y,y1)),width:Math.max(1,Math.ceil(Math.abs(x1-x))+1),height:Math.max(1,Math.ceil(Math.abs(y1-y))+1),layer:0});
      }
      if(visible)renderedEdges++;
    }
    const worldLeft=state.centerX-v.columns/(2*sx),worldRight=state.centerX+v.columns/(2*sx);
    let omittedLabels=0;
    const candidates=[];
    for(const [x,id] of scene.xIndex){if(x>worldRight)break;if(x+scene.maxWidth<worldLeft)continue;const b=scene.boxes.get(id),[px,py]=screen(b.x,b.y),w=Math.max(1,Math.round(b.width*sx)),h=Math.max(state.zoom>=0.15?3:1,Math.round(b.height*sy));
      if(px+w<0||py+h<0||px>=v.columns||py>=v.rows)continue;candidates.push({id,b,x:Math.round(px),y:Math.round(py),w,h});}
    candidates.sort((a,b)=>(a.id===state.selectedId?1:0)-(b.id===state.selectedId?1:0));
    for(const n of candidates){
      const {id,w,h}=n,x=n.x,y=n.y,selected=id===state.selectedId;
      visibleIds.push(id);
      const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(v.columns,x+w),bottom=Math.min(v.rows,y+h);
      hits.push({kind:'card',cardId:id,x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top),layer:selected?2:1});
      if(w<4||h<2||state.zoom<0.15){put(clamp(x,0,v.columns-1),clamp(y,0,v.rows-1),selected?'@':ascii?'o':'•');omittedLabels++;continue;}
      // Clear only the visible rectangle; never iterate a world-sized box.
      for(let yy=top;yy<bottom;yy++)for(let xx=left;xx<right;xx++)put(xx,yy,' ');
      const horizontal=selected?'=':ascii?'-':'─',vertical=selected?'!':ascii?'|':'│';
      for(let xx=left;xx<right;xx++){put(xx,y,horizontal);put(xx,y+h-1,horizontal);}
      for(let yy=top;yy<bottom;yy++){put(x,yy,vertical);put(x+w-1,yy,vertical);}
      for(const [xx,yy] of [[x,y],[x+w-1,y],[x,y+h-1],[x+w-1,y+h-1]])put(xx,yy,selected?'*':'+');
      const available=Math.max(0,w-2),maxLines=Math.min(4,Math.max(0,h-2));
      let row=0,col=0,used=0;const gs=graphemes(scene.cards.get(id).title||scene.cards.get(id).text||id);
      for(const g of gs){
        const width=measure(g);if(!Number.isInteger(width)||width<0||width>available){used++;continue;}if(width===0){used++;continue;}
        if(col+width>available){row++;col=0;}if(row>=maxLines)break;
        const xx=x+1+col,yy=y+1+row;
        if(xx>=0&&xx+width<=v.columns&&yy>=0&&yy<v.rows){put(xx,yy,g);}
        col+=width;used++;
      }
      if(used<gs.length){omittedLabels++;if(maxLines&&available)put(x+w-2,y+Math.min(maxLines,h-2),ascii?'>':'…');}
      if(selected)put(x,y,'>');
    }
    const lines=cells.map(row=>{let text='',width=0;for(const g of graphemes(row.join(''))){const n=measure(g);if(!Number.isInteger(n)||n<=0)continue;if(width+n>v.columns)break;text+=g;width+=n;}return text+' '.repeat(v.columns-width);});
    return {lines,rows:cells,cellRuns:undefined,hits,visibleIds,selectedId:state.selectedId,revision:scene.revision,stats:{totalCards:scene.cards.size,positionedCards:scene.boxes.size,visibleCards:visibleIds.length,totalEdges:scene.edges.length,renderedEdges,omittedLabels,omittedEdges:scene.edges.length-renderedEdges,bufferCells:v.columns*v.rows},warnings,columns:v.columns,height:v.rows};
  }
  return {prepare,initialState,reduce,render,toPlainText};
}
function toPlainText(frame){return frame.lines.join('\n');}
module.exports={createTerminalVisuals,toPlainText,LIMITS};
