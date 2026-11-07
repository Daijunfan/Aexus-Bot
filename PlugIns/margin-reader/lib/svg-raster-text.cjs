'use strict';
const {createCanvas}=require('@napi-rs/canvas');
const S=require('./safety.cjs');
const {createRasterFonts}=require('./raster-fonts.cjs');
const {rasterScale}=require('./svg-raster-scale.cjs');

// Only raster output goes through this helper. Skia's SVG text renderer does
// not provide Canvas's font fallback or joined-emoji shaping. Rasterize each
// text element in its own local coordinates, then leave it in the same SVG
// position and paint order as an embedded image. Ordinary SVG stays editable.
const LIMITS={textNodes:50000,textPixels:64000000,labelPixels:4000000,pngBytes:24*1024*1024,svgBytes:96*1024*1024};
const DEFAULT_STYLE={fontFamily:'system-ui',fontSize:16,fontWeight:'normal',fontStyle:'normal',fill:'#000000',fillOpacity:1,stroke:'none',strokeWidth:1,strokeOpacity:1,anchor:'start',decoration:'none',direction:'ltr',localOpacity:1};
const ATTRS={'font-family':'fontFamily','font-weight':'fontWeight','font-style':'fontStyle','fill':'fill','stroke':'stroke','text-anchor':'anchor','text-decoration':'decoration','direction':'direction','color':'color'};
const ELEMENTS=new Set(['svg','g','path','text','tspan','a','image','defs','linearGradient','radialGradient','stop','marker','circle','ellipse','rect','line','polyline','polygon','use','symbol','pattern','clipPath','title','desc']);
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const first=(value,fallback=0)=>{const n=parseFloat(value);return Number.isFinite(n)?n:fallback;};
const clampOpacity=value=>Math.max(0,Math.min(1,first(value,1)));
function properties(node){
 const values={};for(const attr of Array.from(node.attributes||[]))values[attr.name]=attr.value;
 for(const declaration of (values.style||'').split(';')){const colon=declaration.indexOf(':');if(colon>0)values[declaration.slice(0,colon).trim()]=declaration.slice(colon+1).trim();}
 return values;
}
function inherit(base,node,{opacity=false}={}){
 const result={...base},values=properties(node);
 for(const [attr,key]of Object.entries(ATTRS))if(values[attr]!==undefined)result[key]=values[attr];
 if(values['font-size']!==undefined){const v=values['font-size'];result.fontSize=/em$/.test(v)?first(v,1)*base.fontSize:/%$/.test(v)?first(v,100)*base.fontSize/100:first(v,base.fontSize);}
 for(const [attr,key]of [['fill-opacity','fillOpacity'],['stroke-opacity','strokeOpacity']])if(values[attr]!==undefined)result[key]=clampOpacity(values[attr]);
 if(values['stroke-width']!==undefined)result.strokeWidth=Math.max(0,first(values['stroke-width'],1));
 if(opacity&&values.opacity!==undefined)result.localOpacity*=clampOpacity(values.opacity);
 return result;
}
function ancestorStyle(node){
 const parents=[];for(let p=node.parentNode;p?.nodeType===1;p=p.parentNode)parents.unshift(p);
 return parents.reduce((style,p)=>inherit(style,p),DEFAULT_STYLE);
}
function validateComposition(document){
 for(const node of document.querySelectorAll('*')){
  // This is the existing map export vocabulary, not an arbitrary SVG service.
  // A true luminosity mask cannot use the white clip-path compatibility rule.
  S.assert(ELEMENTS.has(node.localName)&&node.namespaceURI==='http://www.w3.org/2000/svg'&&!node.prefix,'EXPORT_FAILED','Raster export cannot preserve '+node.localName+' content; export SVG for a compatible viewer.');
  const values=properties(node);
  S.assert(!['mask','filter'].some(key=>values[key]&&values[key]!=='none'),'EXPORT_FAILED','Raster export cannot preserve SVG mask/filter effects; export SVG.');
  if(node.localName==='image')S.assert(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(node.getAttribute('href')||node.getAttribute('xlink:href')||''),'INVALID_PARAMS','Raster export accepts only embedded PNG/JPEG map images.');
  if(node.localName==='use')S.assert(/^#[A-Za-z0-9_.:-]+$/.test(node.getAttribute('href')||node.getAttribute('xlink:href')||''),'INVALID_PARAMS','Raster export accepts only local SVG shape references.');
  if(['text','image','use'].includes(node.localName)){let depth=0;for(let parent=node.parentNode;parent?.nodeType===1;parent=parent.parentNode){S.assert(++depth<=256,'TOO_LARGE','Raster SVG nesting exceeds its bound.');S.assert(parent.localName!=='clipPath','EXPORT_FAILED','Raster export requires geometric clip paths; export SVG for text or referenced clip outlines.');}}
 }
}
function fontString(style,fonts){
 const weight=/^(?:normal|bold|[1-9]00)$/.test(String(style.fontWeight))?style.fontWeight:'normal';
 const slant=/^(?:italic|oblique)$/.test(style.fontStyle)?'italic':'normal';
 S.assert(Number.isFinite(style.fontSize)&&style.fontSize>0&&style.fontSize<=1000,'TOO_LARGE','A raster text size exceeds the bounded label renderer.');
 return `${slant} ${weight} ${style.fontSize}px ${fonts.familyList(style.fontFamily)}`;
}
function chunksFor(element,fonts,ctx){
 const chunks=[],cursor={x:0,y:0};let current;
 function visit(node,base){
  if(node.nodeType===3){
   const text=node.nodeValue;if(!text)return;
   fonts.assertText(text);const style=base,font=fontString(style,fonts);
   if(!current){current={x:cursor.x,y:cursor.y,anchor:style.anchor,runs:[],width:0};chunks.push(current);}
   const signature=JSON.stringify({...style,fontFamily:font}),previous=current.runs.at(-1);
   ctx.font=font;ctx.direction=style.direction==='rtl'?'rtl':'ltr';
   if(previous?.signature===signature){const old=previous.width;previous.text+=text;previous.width=ctx.measureText(previous.text).width;current.width+=previous.width-old;cursor.x+=previous.width-old;}
   else{const width=ctx.measureText(text).width;current.runs.push({text,font,style,signature,width});current.width+=width;cursor.x+=width;}
   return;
  }
  if(node.nodeType!==1)return;
  S.assert(!['textPath','foreignObject'].includes(node.localName),'EXPORT_FAILED','This map text requires an unsupported raster text path; export SVG.');
  const style=inherit(base,node,{opacity:node!==element}),values=properties(node);
  if(['x','y','dx','dy'].some(key=>values[key]!==undefined)){
   // The exporter uses scalar positions. Refuse per-glyph coordinate lists
   // instead of silently treating them as one position.
   for(const key of ['x','y','dx','dy'])if(values[key]!==undefined)S.assert(/^\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:px)?\s*$/i.test(values[key]),'EXPORT_FAILED','Raster text requires scalar '+key+' positions; export SVG for positioned glyph lists.');
   if(values.x!==undefined)cursor.x=first(values.x);if(values.y!==undefined)cursor.y=first(values.y);
   cursor.x+=first(values.dx);cursor.y+=first(values.dy);
   current={x:cursor.x,y:cursor.y,anchor:style.anchor,runs:[],width:0};chunks.push(current);
  }
  for(const child of Array.from(node.childNodes))visit(child,style);
 }
 visit(element,ancestorStyle(element));return chunks.filter(chunk=>chunk.runs.length);
}
function runBounds(run,ctx,cache){
 const full=ctx.measureText(run.text),metrics=[full];
 // Native Skia 0.1.100 can omit later fallback spans from both the ink and
 // font boxes. Measure complete graphemes for their extents only; keep the
 // original run intact when shaping/drawing and use its full advance.
 for(const {segment}of graphemes.segment(run.text)){
  const key=run.font+'\0'+ctx.direction+'\0'+segment;let metric=cache.get(key);
  if(!metric){metric=ctx.measureText(segment);if(cache.size>=4096)cache.delete(cache.keys().next().value);cache.set(key,metric);}
  metrics.push(metric);
 }
 let left=0,right=run.width,ascent=0,descent=0;
 for(const m of metrics){
  left=Math.max(left,m.actualBoundingBoxLeft);
  right=Math.max(right,run.width+Math.max(0,m.actualBoundingBoxRight-m.width));
  ascent=Math.max(ascent,m.actualBoundingBoxAscent,m.fontBoundingBoxAscent||0);
  descent=Math.max(descent,m.actualBoundingBoxDescent,m.fontBoundingBoxDescent||0);
 }
 return {left,right,ascent,descent};
}
function placeRuns(chunks,ctx,metrics){
 const placed=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const chunk of chunks){
  let x=chunk.x-(chunk.anchor==='middle'?chunk.width/2:chunk.anchor==='end'?chunk.width:0);
  for(const run of chunk.runs){
   ctx.font=run.font;ctx.direction=run.style.direction==='rtl'?'rtl':'ltr';ctx.textAlign='left';ctx.textBaseline='alphabetic';
   const m=runBounds(run,ctx,metrics),stroke=run.style.stroke!=='none'?run.style.strokeWidth/2:0;
   left=Math.min(left,x-m.left-stroke);right=Math.max(right,x+m.right+stroke);
   top=Math.min(top,chunk.y-m.ascent-stroke);bottom=Math.max(bottom,chunk.y+m.descent+stroke);
   const decorationRadius=Math.max(.7,run.style.fontSize*.055)/2;
   for(const offset of [/underline/.test(run.style.decoration)?run.style.fontSize*.13:null,/line-through/.test(run.style.decoration)?-run.style.fontSize*.3:null].filter(v=>v!==null)){
    left=Math.min(left,x-decorationRadius);right=Math.max(right,x+run.width+decorationRadius);
    top=Math.min(top,chunk.y+offset-decorationRadius);bottom=Math.max(bottom,chunk.y+offset+decorationRadius);
   }
   placed.push({...run,x,y:chunk.y});x+=run.width;
  }
 }
 return {placed,left,top,right,bottom};
}
async function textImage(element,{fonts,measure,canvas,metrics,scale,limits,budget}){
 const {placed,left,top,right,bottom}=placeRuns(chunksFor(element,fonts,measure),measure,metrics);
 if(!placed.length||!Number.isFinite(left))return null;
 const x=left-2/scale,y=top-2/scale,width=Math.max(1,Math.ceil((right-left)*scale)+4),height=Math.max(1,Math.ceil((bottom-top)*scale)+4);
 S.assert(width*height<=limits.labelPixels&&budget.pixels+width*height<=limits.textPixels,'TOO_LARGE','Raster text exceeds its pixel budget; export a smaller branch or SVG.');
 // Resize through a 1-pixel surface. A wide next label must never allocate
 // its new width multiplied by the previous label's potentially tall height.
 budget.pixels+=width*height;canvas.width=1;canvas.height=height;canvas.width=width;
 const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.translate(-x,-y);ctx.textAlign='left';ctx.textBaseline='alphabetic';
 for(const run of placed){
  const s=run.style;ctx.font=run.font;ctx.direction=s.direction==='rtl'?'rtl':'ltr';
  const fill=s.fill==='currentColor'?s.color||'#000000':s.fill;
  if(fill!=='none'){ctx.globalAlpha=s.localOpacity*s.fillOpacity;ctx.fillStyle=fill;ctx.fillText(run.text,run.x,run.y);}
  if(s.stroke!=='none'){ctx.globalAlpha=s.localOpacity*s.strokeOpacity;ctx.strokeStyle=s.stroke==='currentColor'?s.color||'#000000':s.stroke;ctx.lineWidth=s.strokeWidth;ctx.strokeText(run.text,run.x,run.y);}
  ctx.globalAlpha=s.localOpacity*s.fillOpacity;ctx.strokeStyle=fill;ctx.lineWidth=Math.max(.7,s.fontSize*.055);
  for(const offset of [/underline/.test(s.decoration)?s.fontSize*.13:null,/line-through/.test(s.decoration)?-s.fontSize*.3:null].filter(v=>v!==null)){ctx.beginPath();ctx.moveTo(run.x,run.y+offset);ctx.lineTo(run.x+run.width,run.y+offset);ctx.stroke();}
 }
 const bytes=await canvas.encode('png');budget.bytes+=bytes.length;
 S.assert(budget.bytes<=limits.pngBytes,'TOO_LARGE','Raster text exceeds its embedded-image budget; export a smaller branch or SVG.');
 return {x,y,width:width/scale,height:height/scale,href:'data:image/png;base64,'+bytes.toString('base64')};
}
async function rasterTextSvg(svg,{scale=1,fonts,limits:overrides={}}={}){
 const limits={...LIMITS,...overrides};
 S.assert(Number.isFinite(scale)&&scale>0&&scale<=8,'INVALID_PARAMS','Invalid raster text scale.');
 S.assert(Buffer.byteLength(svg)<=64*1024*1024,'TOO_LARGE','Diagram SVG exceeds 64 MiB.');
 const {JSDOM}=require('jsdom'),dom=new JSDOM(svg,{contentType:'image/svg+xml'});
 try{
  const document=dom.window.document,texts=Array.from(document.querySelectorAll('*')).filter(node=>node.localName==='text');
  validateComposition(document);
  S.assert(texts.length<=limits.textNodes,'TOO_LARGE','Too many raster text elements; export a smaller branch.');
  const measure=createCanvas(1,1).getContext('2d'),canvas=createCanvas(1,1),metrics=new Map(),budget={pixels:0,bytes:0};let images=0,fontReader=fonts;
  for(const text of texts){
   if(!text.textContent){text.remove();continue;}
   const density=rasterScale(text,scale);if(density===0){text.remove();continue;}
   fontReader||=createRasterFonts();
   const result=await textImage(text,{fonts:fontReader,measure,canvas,metrics,scale:density,limits,budget});if(!result){text.remove();continue;}
   const image=document.createElementNS('http://www.w3.org/2000/svg','image');
   for(const attr of ['id','class','transform','clip-path','mask','filter','opacity','display','visibility','style'])if(text.hasAttribute(attr))image.setAttribute(attr,text.getAttribute(attr));
   for(const [key,value]of Object.entries(result))image.setAttribute(key,String(value));
   image.setAttribute('preserveAspectRatio','none');image.setAttribute('data-raster-text','true');
   text.parentNode.replaceChild(image,text);images++;
  }
  const output=document.documentElement.outerHTML;
  S.assert(Buffer.byteLength(output)<=limits.svgBytes,'TOO_LARGE','Raster text and map images exceed the SVG rendering budget.');
  return {svg:output,textImages:images,textPixels:budget.pixels,textBytes:budget.bytes,fonts:fontReader?.families||[]};
 }finally{dom.window.close();}
}
async function rasterizeSvg({svg,width,height,scale=1,...options}){
 S.assert(Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0,'INVALID_PARAMS','Invalid raster diagram dimensions.');
 const pixelWidth=Math.max(1,Math.ceil(width*scale)),pixelHeight=Math.max(1,Math.ceil(height*scale));
 S.assert(pixelWidth*pixelHeight<=24000000+16384&&pixelWidth<=8192&&pixelHeight<=8192,'TOO_LARGE','Raster output exceeds its image bounds.');
 const prepared=await rasterTextSvg(svg,{scale,...options});
 const result=await require('./svg-raster-composite.cjs').compose(prepared.svg,pixelWidth,pixelHeight,options);
 return {...result,width:pixelWidth,height:pixelHeight,textImages:prepared.textImages,textPixels:prepared.textPixels,textBytes:prepared.textBytes,fonts:prepared.fonts};
}
module.exports={rasterizeSvg,rasterTextSvg,LIMITS};
