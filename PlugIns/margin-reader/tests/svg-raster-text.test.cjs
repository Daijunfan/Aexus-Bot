'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const {JSDOM}=require('jsdom');
const {rasterTextSvg,rasterizeSvg}=require('../lib/svg-raster-text.cjs');
const {svgDocument}=require('../lib/mindmap-export.cjs');
// Geometry tests use an already installed Latin family. The production proof
// separately exercises the real platform font reader and CJK/emoji coverage.
const family=GlobalFonts.families.some(f=>f.family==='Helvetica')?'Helvetica':'DejaVu Sans';
const fonts={families:[family],familyList:()=>`"${family}"`,assertText:text=>{assert(!/[^\x00-\u024f\u0300-\u036f]/.test(text));}};
const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">${body}</svg>`;

test('raster text keeps rich styles, local tspan positions, links, transforms, clipping and paint order',async()=>{
 const source=svg('<defs><clipPath id="clip"><rect width="370" height="180"/></clipPath></defs><g id="group" transform="translate(15 8)" clip-path="url(#clip)"><a href="margin-reader://card/proof/root"><text x="140" y="42" text-anchor="middle" font-size="24" fill="#111111">Normal <tspan fill="#d00000" font-weight="bold" text-decoration="underline">bold</tspan><tspan x="25" y="90" text-anchor="start" fill="#0000d0" font-style="italic">Second é</tspan><tspan dx="14" dy="35" text-anchor="start" fill="#008000">Third</tspan></text></a><rect id="overpaint" x="130" y="25" width="18" height="20" fill="#ff00ff"/></g>');
 const result=await rasterTextSvg(source,{fonts,scale:2});assert.equal(result.textImages,1);assert(result.textPixels>0);
 const document=new JSDOM(result.svg,{contentType:'image/svg+xml'}).window.document;
 assert.equal(document.querySelectorAll('text').length,0);
 assert.equal(document.querySelector('#group').getAttribute('transform'),'translate(15 8)');
 assert.equal(document.querySelector('#group').getAttribute('clip-path'),'url(#clip)');
 assert.equal(document.querySelector('a').getAttribute('href'),'margin-reader://card/proof/root');
 assert(document.querySelector('a > image[data-raster-text]'));
 assert.equal(document.querySelector('#group').lastElementChild.id,'overpaint');
 // Exercise the same composition path used by PNG and raster PDF workers.
 // The pinned Skia SVG loader itself does not load embedded bitmap images.
 const raster=await rasterizeSvg({svg:source,width:400,height:200,fonts}),image=await loadImage(raster.bytes),canvas=createCanvas(400,200),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,400,200).data,counts={red:0,blue:0,green:0};
 for(let i=0;i<pixels.length;i+=4){const [r,g,b,a]=pixels.slice(i,i+4);if(a<128)continue;if(r>100&&g<70&&b<70)counts.red++;if(b>100&&r<70&&g<70)counts.blue++;if(g>70&&r<70&&b<70)counts.green++;}
 for(const [color,count]of Object.entries(counts))assert(count>20,'missing rich run '+color);
 assert.deepEqual([...ctx.getImageData(150,40,1,1).data],[255,0,255,255]);
 assert(source.includes('<text'),'the editable source SVG is untouched');
});

test('mind-map title lines have explicit baselines and preserve full title, rich spans and source links',async()=>{
 const title='First rich line\nSecond line\nThird line',set={id:'proof',title:'Proof',colors:{},layers:[],links:[],map:{mindmap:{enabled:true,showSources:true}},cards:[{id:'root',title,parentId:null,source:{documentId:'source',locator:{page:3}},mindmap:{width:240,runs:[{start:6,end:10,color:'#cc2233',bold:true}]}}]};
 const result=await svgDocument(set),document=new JSDOM(result.svg,{contentType:'image/svg+xml'}).window.document,root=document.querySelector('#topic-root');
 const lines=Array.from(root.children).filter(node=>node.localName==='text');assert.equal(lines.length,3);
 const baselines=lines.map(node=>Number(node.getAttribute('y'))),size=Number(lines[0].getAttribute('font-size'));
 assert(baselines.every((y,i)=>i===0||Math.abs(y-baselines[i-1]-size*1.45)<1e-8));
 assert.equal(root.querySelector('title').textContent,title);assert(root.querySelector('tspan[fill="#cc2233"][font-weight="700"]'));
 assert(root.querySelector('a[href="margin-reader://card/proof/root"]'));assert(!root.querySelector('[dy]'));
});

test('raster text retains punctuation strike-through and the complete advance of underlined spaces',async()=>{
 const source=svg('<text x="20" y="40" font-size="24" fill="#d00000" text-decoration="line-through">___</text><text x="20" y="80" font-size="24" fill="#0000d0" text-decoration="underline" xml:space="preserve">   </text>');
 const prepared=await rasterTextSvg(source,{fonts,scale:2}),dom=new JSDOM(prepared.svg,{contentType:'image/svg+xml'});
 try{
  const canvas=createCanvas(400,200),ctx=canvas.getContext('2d');
  for(const image of dom.window.document.querySelectorAll('image')){
   const bytes=Buffer.from(image.getAttribute('href').split(',')[1],'base64'),native=await loadImage(bytes);
   ctx.drawImage(native,...['x','y','width','height'].map(key=>Number(image.getAttribute(key))));
  }
  const count=(x,y,width,height,predicate)=>{const data=ctx.getImageData(x,y,width,height).data;let n=0;for(let i=0;i<data.length;i+=4)if(predicate(data[i],data[i+1],data[i+2],data[i+3]))n++;return n;};
  assert(count(20,31,50,4,(r,g,b,a)=>r>100&&g<70&&b<70&&a>60)>15,'strike must survive above underscore glyph bounds');
  assert(count(20,82,15,4,(r,g,b,a)=>b>100&&r<70&&g<70&&a>60)>8,'space advance must retain the underline');
 }finally{dom.window.close();}
});

test('mixed fallback spans retain the complete advance and tail glyph extents in either script order',async()=>{
 // This is a geometry regression, including platforms where a CJK fallback
 // is a missing-glyph box. The separate public proof checks real font
 // coverage without this injected reader and retains an explicit visual gate.
 const geometryFonts={...fonts,assertText:()=>{}};
 for(const [text,italic]of [['阅读 → 组织 → 回到原文',false],['👨‍👩‍👧‍👦 家庭情境',false],['🇨🇳 🇺🇸 🇯🇵',false],['↗ 3',false],['Latin 中文🙂',false],['中文 Latin',false],['Latin é ï',true],['中文 italic f',true]]){
  const source=svg('<text x="30" y="70" font-size="28" font-style="'+(italic?'italic':'normal')+'">'+text+'</text>');
  const prepared=await rasterTextSvg(source,{fonts:geometryFonts,scale:2}),dom=new JSDOM(prepared.svg,{contentType:'image/svg+xml'});
  try{
   const element=dom.window.document.querySelector('image'),bounds=Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(element.getAttribute(key))]));
   const reference=createCanvas(1200,220),ctx=reference.getContext('2d');ctx.scale(2,2);ctx.font=(italic?'italic':'normal')+' normal 28px "'+family+'"';ctx.fillText(text,30,70);
   const data=ctx.getImageData(0,0,1200,220).data;let left=Infinity,right=0,top=Infinity,bottom=0;
   for(let y=0;y<220;y++)for(let x=0;x<1200;x++)if(data[(y*1200+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
   assert(Number.isFinite(left),'reference must paint '+text);
   assert(bounds.x*2<=left&&2*(bounds.x+bounds.width)>=right,'full advance/italic tail clipped: '+text);
   assert(bounds.y*2<=top&&2*(bounds.y+bounds.height)>=bottom,'fallback glyph height clipped: '+text);
   const bytes=Buffer.from(element.getAttribute('href').split(',')[1],'base64'),image=await loadImage(bytes),canvas=createCanvas(image.width,image.height),pixel=canvas.getContext('2d');pixel.drawImage(image,0,0);
   const rgba=pixel.getImageData(0,0,image.width,image.height).data;
   for(let x=0;x<image.width;x++){assert.equal(rgba[x*4+3],0,'top padding: '+text);assert.equal(rgba[((image.height-1)*image.width+x)*4+3],0,'bottom padding: '+text);}
   for(let y=0;y<image.height;y++){assert.equal(rgba[(y*image.width)*4+3],0,'left padding: '+text);assert.equal(rgba[(y*image.width+image.width-1)*4+3],0,'right padding: '+text);}
   let tail=0;const tailX=Math.max(0,Math.floor(right-bounds.x*2-24));
   for(let y=0;y<image.height;y++)for(let x=tailX;x<image.width;x++)if(rgba[(y*image.width+x)*4+3]>32)tail++;
   assert(tail>8,'the last glyph must be present in the actual text PNG: '+text);
  }finally{dom.window.close();}
 }
});

test('shape-only and zero-area diagrams require no font reader',async()=>{
 const source=svg('<rect width="20" height="30" fill="#126baf"/><g transform="scale(0 1)"><text>not painted</text></g>');
 const result=await rasterTextSvg(source,{fonts:null});assert.equal(result.textImages,0);assert.deepEqual(result.fonts,[]);assert(result.svg.includes('#126baf'));
});

test('production composition preserves nested clips, rotation, group opacity and bitmap paint order',async()=>{
 const tile=createCanvas(32,32),tileContext=tile.getContext('2d');tileContext.fillStyle='#ff0000';tileContext.fillRect(0,0,32,32);
 const uri='data:image/png;base64,'+(await tile.encode('png')).toString('base64');
 const source=svg('<defs><clipPath id="outer"><rect width="50" height="40"/></clipPath><clipPath id="inner"><rect width="35" height="60"/></clipPath></defs><g transform="translate(120 20) rotate(90)" opacity=".5" clip-path="url(#outer)"><g clip-path="url(#inner)"><image width="60" height="60" href="'+uri+'"/><rect x="10" y="10" width="10" height="10" fill="#0000ff"/></g></g>');
 const raster=await rasterizeSvg({svg:source,width:400,height:200,fonts:null}),image=await loadImage(raster.bytes),canvas=createCanvas(400,200),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
 const inside=pixel(115,25),overpaint=pixel(105,35);
 assert(inside[0]>250&&inside[1]<3&&inside[2]<3&&Math.abs(inside[3]-128)<=2,'rotation and one application of outer opacity');
 assert(overpaint[2]>250&&overpaint[0]<3&&overpaint[1]<3&&Math.abs(overpaint[3]-128)<=2,'the later rectangle must cover the image inside the translucent group');
 assert.equal(pixel(115,60)[3],0,'inner clip must remove the bitmap outside x=35');
 assert.equal(pixel(75,25)[3],0,'outer clip must remove the bitmap outside y=40');
 assert.equal(raster.clipMasks,2);
 await assert.rejects(rasterizeSvg({svg:source,width:400,height:200,fonts:null,limits:{pdfBytes:1}}),error=>error.code==='TOO_LARGE');
 await assert.rejects(rasterizeSvg({svg:source,width:400,height:200,fonts:null,limits:{imageBytes:1}}),error=>error.code==='TOO_LARGE');
 await assert.rejects(rasterizeSvg({svg:source,width:400,height:200,fonts:null,limits:{imagePixels:1023}}),error=>error.code==='TOO_LARGE');
});

test('decoded-image budget counts unique sources and actually reuses the decoded PDF image',async t=>{
 const PDFDocument=require('pdfkit'),original=PDFDocument.prototype.openImage;let decodes=0;
 t.mock.method(PDFDocument.prototype,'openImage',function(...args){decodes++;return original.apply(this,args);});
 const tile=createCanvas(8,8),ctx=tile.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,8,8);
 const red='data:image/png;base64,'+(await tile.encode('png')).toString('base64');ctx.fillStyle='#0000ff';ctx.fillRect(0,0,8,8);
 const blue='data:image/png;base64,'+(await tile.encode('png')).toString('base64');
 const images=(a,b)=>svg('<image x="10" y="10" width="20" height="20" href="'+a+'"/><image x="40" y="10" width="20" height="20" href="'+b+'"/>');
 const same=await rasterizeSvg({svg:images(red,red),width:400,height:200,limits:{imagePixels:64}});assert.equal(same.imagePixels,64);assert.equal(decodes,1,'same Buffer must reach PDFKit decoding once');
 decodes=0;const distinct=await rasterizeSvg({svg:images(red,blue),width:400,height:200,limits:{imagePixels:128}});assert.equal(distinct.imagePixels,128);assert.equal(decodes,2,'distinct assets must each reach decoding once');
 await assert.rejects(rasterizeSvg({svg:images(red,blue),width:400,height:200,limits:{imagePixels:127}}),error=>error.code==='TOO_LARGE');
 await assert.rejects(rasterizeSvg({svg:images('data:image/png;base64,'+Buffer.from('invalid image header').toString('base64'),red),width:400,height:200}),error=>error.code==='INVALID_MEDIA','a caught image callback error must keep its original type');
});

test('opaque map gradients retain colors while grayscale luminosity effects fail explicitly',async()=>{
 const gradient=opacity=>svg('<defs><linearGradient id="color"><stop stop-color="#ff0000"'+(opacity?' stop-opacity="0.2"':'')+'/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="200" height="80" fill="url(#color)"/>');
 const raster=await rasterizeSvg({svg:gradient(false),width:400,height:200}),image=await loadImage(raster.bytes),canvas=createCanvas(400,200),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const left=[...ctx.getImageData(20,20,1,1).data],right=[...ctx.getImageData(180,20,1,1).data];
 assert(left[0]>200&&left[2]<60&&left[3]===255);assert(right[2]>200&&right[0]<60&&right[3]===255);assert.equal(raster.clipMasks,0);
 await assert.rejects(rasterizeSvg({svg:gradient(true),width:400,height:200}),error=>error.code==='EXPORT_FAILED','a gray gradient mask must never become a white clip mask');
});

test('nested equation-sized viewports allocate output-resolution text instead of 884px local glyphs',async()=>{
 // These are the exact dimensions/transforms of a four-character MathJax
 // text box. Latin glyphs make this geometry test independent of CJK fonts;
 // the production API proof separately uses MathJax's actual Chinese output.
 const source=svg('<svg x="20" y="20" width="80" height="19" viewBox="0 -750 4000 950"><g transform="scale(1,-1)"><text font-family="serif" font-size="884px" transform="scale(1,-1)">WWWW</text></g></svg>');
 const result=await rasterizeSvg({svg:source,width:400,height:200,scale:2,fonts,limits:{labelPixels:20000,textPixels:20000}});
 assert.equal(result.textImages,1);assert(result.textPixels<20000);
 const image=await loadImage(result.bytes),canvas=createCanvas(result.width,result.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(40,40,160,40).data;let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>100)opaque++;
 assert(opaque>100,'the scaled equation text must remain visible at its nested viewport');
});

test('raster text rejects aggregate/per-label pixels, embedded bytes, node count and unsupported positions',async()=>{
 const source=svg('<text x="20" y="40" font-size="24">Budget line</text><text x="20" y="90">Second</text>');
 for(const limits of [{labelPixels:1},{textPixels:1},{pngBytes:1},{textNodes:1}])await assert.rejects(rasterTextSvg(source,{fonts,limits}),error=>error.code==='TOO_LARGE');
 await assert.rejects(rasterTextSvg(svg('<text x="20 40" y="40">AB</text>'),{fonts}),error=>error.code==='EXPORT_FAILED');
 await assert.rejects(rasterizeSvg({svg:source,width:9000,height:100,fonts}),error=>error.code==='TOO_LARGE');
 const missing={...fonts,assertText:()=>{const error=new Error('No matching local font');error.code='FONT_UNAVAILABLE';throw error;}};
 await assert.rejects(rasterizeSvg({svg:source,width:400,height:200,fonts:missing}),error=>error.code==='FONT_UNAVAILABLE');
 for(const body of ['<defs><mask id="real"><rect fill="#888" width="10" height="10"/></mask></defs>','<svg><m:mask xmlns:m="http://www.w3.org/2000/svg"/></svg>','<clipPath id="glyph"><text>Mask</text></clipPath>','<defs><text id="glyph">Mask</text><clipPath id="clip"><use href="#glyph"/></clipPath></defs>'])await assert.rejects(rasterTextSvg(svg(body),{fonts}),error=>error.code==='EXPORT_FAILED');
 for(const body of ['<image href="data:image/svg+xml;base64,PHN2Zy8+"/>','<image href="file:///tmp/unread.png"/>','<use href="https://example.invalid/map.svg#glyph"/>'])await assert.rejects(rasterTextSvg(svg(body),{fonts}),error=>error.code==='INVALID_PARAMS');
 await assert.rejects(rasterizeSvg({svg:svg('<path d="M 0 0 INVALID"/>'),width:400,height:200,fonts}),error=>error.code==='EXPORT_FAILED','composition warnings must fail instead of silently omitting geometry');
});
