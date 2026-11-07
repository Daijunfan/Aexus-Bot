'use strict';
// Self-authored, isolated acceptance evidence. All learning-set changes and
// map exports use the public runtime. Extra clip/rotation fixtures exercise
// the same production worker directly, because these are renderer invariants
// rather than additional public map-editing features. No fonts are registered.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),{JSDOM}=require('jsdom');
const {setup,pdfFixture}=require('./fixtures.cjs');
const {createRasterFonts}=require('../lib/raster-fonts.cjs');
const {createWorkerJobs}=require('../lib/worker-jobs.cjs');

async function pngCanvas(bytes){const image=await loadImage(bytes),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return canvas;}
async function pdfCanvas(bytes){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0,isEvalSupported:false});
 try{
  const document=await task.promise;assert.equal(document.numPages,1);
  const page=await document.getPage(1),viewport=page.getViewport({scale:1}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  const operators=(await page.getOperatorList()).fnArray;assert(operators.includes(pdfjs.OPS.paintImageXObject),'raster PDF must contain its map image');
  await page.render({canvas:null,canvasContext:canvas.getContext('2d'),viewport,background:'rgba(0,0,0,0)'}).promise;return canvas;
 }finally{await task.destroy();}
}
function pixels(canvas){
 const ctx=canvas.getContext('2d');return {
  at:(x,y)=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data],
  count:(box,predicate)=>{
   const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y)),right=Math.min(canvas.width,Math.ceil(box.x+box.width)),bottom=Math.min(canvas.height,Math.ceil(box.y+box.height));
   assert(right>x&&bottom>y,'pixel assertion requires a visible region');
   const data=ctx.getImageData(x,y,right-x,bottom-y).data;let count=0;
   for(let i=0;i<data.length;i+=4)if(predicate(data[i],data[i+1],data[i+2],data[i+3]))count++;return count;
  }
 };
}
function rgbNear(value,expected,tolerance=3){return value.every((v,i)=>Math.abs(v-expected[i])<=tolerance);}
function projection(document,canvas){
 const [minX,minY,width,height]=document.documentElement.getAttribute('viewBox').split(/\s+/).map(Number),sx=canvas.width/width,sy=canvas.height/height;
 const origin=topic=>{const match=topic.getAttribute('transform').match(/^translate\(([-\d.]+)[ ,]+([-\d.]+)\)$/);assert(match);return [+match[1],+match[2]];};
 return {point:(topic,x,y)=>{const [tx,ty]=origin(topic);return [(tx+x-minX)*sx,(ty+y-minY)*sy];},box:(topic,x,y,w,h)=>{const [tx,ty]=origin(topic);return {x:(tx+x-minX)*sx,y:(ty+y-minY)*sy,width:w*sx,height:h*sy};}};
}
function verifyPublicImage(canvas,document,ids,fontReader){
 const pixel=pixels(canvas),project=projection(document,canvas),checks=[];
 const topic=id=>{const node=document.getElementById('topic-'+id);assert(node);return node;};
 const imageTopic=topic(ids.bitmap),bitmap=imageTopic.querySelector('image');assert(bitmap);
 const [x,y,w,h]=['x','y','width','height'].map(key=>Number(bitmap.getAttribute(key))),fit=Math.min(w/96,h/64),left=x+(w-96*fit)/2,top=y+(h-64*fit)/2;
 for(const [name,px,py,color]of [['magenta',24,16,[240,0,192,255]],['cyan',72,16,[0,191,208,255]],['yellow',24,48,[255,208,0,255]],['blue',72,48,[32,48,255,255]]]){
  const actual=pixel.at(...project.point(imageTopic,left+px*fit,top+py*fit));assert(rgbNear(actual,color),'embedded bitmap '+name+': '+actual);checks.push({name:'bitmap-'+name,actual});
 }
 const rich=topic(ids.rich),first=Array.from(rich.children).find(node=>node.localName==='text'),fontSize=Number(first.getAttribute('font-size')),baseline=Number(first.getAttribute('y')),textX=Number(first.getAttribute('x'));
 const strike=pixel.count(project.box(rich,textX+2,baseline-fontSize*.3-1.6,fontSize,3.2),(r,g,b,a)=>r>120&&g<80&&b<80&&a>100);
 assert(strike>12,'punctuation strike must appear above the underscore glyphs');checks.push({name:'punctuation-strike',pixels:strike});
 const second=Array.from(rich.children).filter(node=>node.localName==='text')[1];assert(second);
 const blue=pixel.count(project.box(rich,textX,Number(second.getAttribute('y'))-fontSize,200,fontSize*1.2),(r,g,b,a)=>b>120&&r<80&&g<120&&a>100);
 assert(blue>50,'rich blue accented line must appear');checks.push({name:'rich-blue-accent',pixels:blue});
 const measure=createCanvas(1,1).getContext('2d'),segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 // These regions target the actual final grapheme of complete mixed-script
 // lines. A renderer that paints only the first fallback span fails here.
 for(const [key,label,bright]of [['root','阅读 → 组织 → 回到原文',true],['family','👨‍👩‍👧‍👦 家庭情境',false],['flags','🇨🇳 🇺🇸 🇯🇵',false],['accents','Latin 中文🙂',false],['accents','中文 Latin é ï',false],['source','↗ 1',false]]){
  const node=topic(ids[key]),line=Array.from(node.querySelectorAll('text')).find(text=>text.textContent===label);assert(line,'complete SVG line absent: '+label);
  const size=Number(line.getAttribute('font-size')),weight=line.getAttribute('font-weight')||'normal',slant=line.getAttribute('font-style')||'normal';
  measure.font=slant+' '+weight+' '+size+'px '+fontReader.familyList(line.getAttribute('font-family'));measure.textAlign='left';measure.textBaseline='alphabetic';
  const advance=measure.measureText(label).width,last=Array.from(segmenter.segment(label)).at(-1).segment,metric=measure.measureText(last),anchor=line.getAttribute('text-anchor');
  const textLeft=Number(line.getAttribute('x'))-(anchor==='middle'?advance/2:anchor==='end'?advance:0),ascent=Math.max(metric.actualBoundingBoxAscent,metric.fontBoundingBoxAscent||0),descent=Math.max(metric.actualBoundingBoxDescent,metric.fontBoundingBoxDescent||0);
  const box=project.box(node,textLeft+advance-metric.width-1,Number(line.getAttribute('y'))-ascent-1,metric.width+3,ascent+descent+2);
  const count=pixel.count(box,(r,g,b,a)=>a>100&&(bright?r>180&&g>180&&b>180:r+g+b<550));
  assert(count>3,'last grapheme missing in production pixels: '+label);checks.push({name:'line-tail',line:label,pixels:count});
 }
 const equationTopic=topic(ids.equation),equation=equationTopic.querySelector('svg[data-mml-node],svg[viewBox]');assert(equation,'actual MathJax nested SVG');
 assert(equation.querySelector('text'),'Chinese MathJax emits fallback text');
 const [ex,ey,ew,eh]=['x','y','width','height'].map(key=>Number(equation.getAttribute(key)));
 const equationInk=pixel.count(project.box(equationTopic,ex,ey,ew,eh),(r,g,b,a)=>a>100&&r+g+b<450);assert(equationInk>40,'nested MathJax Chinese pixels');checks.push({name:'mathjax-chinese-region',pixels:equationInk});
 return checks;
}
function verifyGeometry(canvas){
 const pixel=pixels(canvas),scale=canvas.width/400,at=(x,y)=>pixel.at((x+.5)*scale,(y+.5)*scale),checks=[];
 for(const [name,x,y,color]of [['rotated-bitmap',115,25,[255,0,0,128]],['later-overpaint',105,35,[0,0,255,128]],['inner-clip',115,60,[0,0,0,0]],['outer-clip',75,25,[0,0,0,0]]]){
  const actual=at(x,y);assert(rgbNear(actual,color),'geometry '+name+': '+actual);checks.push({name,actual});
 }
 return checks;
}
async function main(){
 const directory=path.resolve(process.argv[2]||path.join(__dirname,'../artifacts/export-production-proof'));
 await fs.mkdir(directory,{recursive:true});const cleanups=[],report={selfAuthoredFixture:true,publicRuntime:true,productionWorker:true,node:process.version,platform:process.platform,arch:process.arch,outputs:[],automatedChecks:'running',visualReview:'pending',overall:'running'};
 let f;
 try{
  f=await setup({after:callback=>cleanups.push(callback)});let set=await f.api('study.create',{title:'MarginReader · 真实导出验收'});
  const change=async(method,params={})=>set=await f.api(method,{setId:set.id,expectedRevision:set.revision,...params}),ids={};
  const note=async(key,title,parentId,patch={})=>{await change('study.note.create',{title,...(parentId?{parentId}:{}),...(key==='family'?{submap:true}:{})});const card=set.cards.find(card=>card.title===title);ids[key]=card.id;await change('study.mindmap.topics.update',{cardIds:[card.id],patch:{width:260,fontSize:22,bold:false,fill:'#FFFFFF',textColor:'#122333',...patch}});};
  await change('study.mindmap.configure',{patch:{enabled:true,structure:'logic-right',theme:'business',showImages:true,showSources:true,fontSize:18,titleLines:0,spacing:24,branchSpacing:72}});
  await note('root','MarginReader\n阅读 → 组织 → 回到原文',undefined,{width:340,fontSize:22,fill:'#20304C',textColor:'#FFFFFF'});
  await note('family','👨‍👩‍👧‍👦 家庭情境',ids.root,{width:240});
  await note('flags','🇨🇳 🇺🇸 🇯🇵',ids.family,{width:220});
  await note('accents','Latin 中文🙂\n中文 Latin é ï',ids.root,{width:280,italic:true});
  await note('english','Source-linked knowledge\nLong English words: antidisestablishmentarianism',ids.root,{width:260,fontSize:18});
  await note('chinese','长中文标题的真实换行：摘录、结构与复习共享同一份来源，不丢失卡片身份。',ids.root,{width:190,fontSize:18,fill:'#E9F4FC',gradient:true});
  const richTitle='___ RED\nBlue accent é ï';await note('rich',richTitle,ids.root,{width:280,fontSize:24,align:'left',runs:[{start:0,end:3,strike:true,color:'#D00000'},{start:4,end:7,bold:true,color:'#D00000'},{start:8,end:richTitle.length,italic:true,underline:true,color:'#174CBB'}]});
  await note('equation','公式中文与尺度',ids.root,{width:240,fontSize:18,equation:{latex:String.raw`\text{中文测试}`,scale:1}});
  const tile=createCanvas(96,64),tileContext=tile.getContext('2d');for(const [x,y,color]of [[0,0,'#F000C0'],[48,0,'#00BFD0'],[0,32,'#FFD000'],[48,32,'#2030FF']]){tileContext.fillStyle=color;tileContext.fillRect(x,y,48,32);}
  await change('study.media.import',{kind:'image',title:'自制 PNG · 四色图片',contentBase64:(await tile.encode('png')).toString('base64')});ids.bitmap=set.lastMedia.cardId;await change('study.card.move',{cardId:ids.bitmap,parentId:ids.root});
  await change('study.mindmap.topics.update',{cardIds:[ids.bitmap],patch:{width:240,fontSize:18,fill:'#FFFFFF',textColor:'#122333'}});
  await fs.writeFile(path.join(f.workspace,'self-authored-source.pdf'),pdfFixture());await change('study.documents.add',{paths:['self-authored-source.pdf']});
  const document=await f.api('document.get',{id:set.documentIds[0]}),capture=await f.api('study.card.create',{setId:set.id,expectedRevision:set.revision,documentId:document.id,expectedSourceVersion:document.sourceVersion,captureId:randomUUID(),title:'原文页 1 · Source',text:'',color:'yellow',locator:{page:1},selection:{rects:[{page:1,x:.08,y:.05,width:.8,height:.11}]}});
  ids.source=capture.card.id;set=await f.api('study.get',{setId:set.id});await change('study.card.move',{cardId:ids.source,parentId:ids.root});await change('study.mindmap.topics.update',{cardIds:[ids.source],patch:{width:240,fontSize:18,fill:'#FFFFFF',textColor:'#122333'}});
  await note('outside','非目标分支：仅完整全图包含',undefined,{width:240,fontSize:18});await change('study.card.update',{cardId:ids.root,collapsed:true});
  const before=await f.api('study.get',{setId:set.id}),params={setId:set.id,expectedRevision:set.revision,rootId:ids.root,scope:'all'};
  const exportedSvg=await f.api('study.mindmap.export',{...params,format:'svg',path:'public-map.svg'}),svg=await fs.readFile(path.join(f.workspace,exportedSvg.path),'utf8');
  const dom=new JSDOM(svg,{contentType:'image/svg+xml'}),fontReader=createRasterFonts();
  try{
   assert.equal(exportedSvg.topics,10);assert.equal(exportedSvg.images,2);assert(!dom.window.document.getElementById('topic-'+ids.outside));
   for(const [key,id]of Object.entries(ids))if(key!=='outside')assert(dom.window.document.getElementById('topic-'+id));
   assert(dom.window.document.querySelector('a[href="margin-reader://card/'+set.id+'/'+ids.source+'"]'));
   assert.equal(dom.window.document.getElementById('topic-'+ids.chinese).querySelector('title').textContent,before.cards.find(card=>card.id===ids.chinese).title);
   await fs.writeFile(path.join(directory,'public-map.svg'),svg);
   for(const [format,pdfMode]of [['png',undefined],['pdf','raster']]){
    const started=performance.now(),result=await f.api('study.mindmap.export',{...params,format,...(pdfMode?{pdfMode}:{}),path:'public-map.'+format}),bytes=await fs.readFile(path.join(f.workspace,result.path));
    assert.equal(result.topics,10);assert.equal(result.images,2);assert(result.rasterized);
    const canvas=format==='png'?await pngCanvas(bytes):await pdfCanvas(bytes);assert.equal(canvas.width,result.width);assert.equal(canvas.height,result.height);
    const checks=verifyPublicImage(canvas,dom.window.document,ids,fontReader);
    await fs.writeFile(path.join(directory,'public-map.'+format),bytes);if(format==='pdf')await fs.writeFile(path.join(directory,'public-raster-pdf.png'),await canvas.encode('png'));
    report.outputs.push({name:'public-'+format,request:'study.mindmap.export',...result,pixelChecks:checks,status:'passed-automated',elapsedMs:performance.now()-started});
   }
   const visible=await f.api('study.mindmap.export',{...params,scope:'visible',format:'svg',path:'public-visible.svg'});assert.equal(visible.topics,1);assert.equal(visible.images,0);
   assert.deepEqual(await f.api('study.get',{setId:set.id}),before);report.sourceSemantics={topics:10,excludedBranch:true,fullTitle:true,sourceLink:true,visibleTopics:1,stateUnchanged:true};report.fonts=fontReader.families;
  }finally{dom.window.close();}
  const red=createCanvas(32,32),redContext=red.getContext('2d');redContext.fillStyle='#ff0000';redContext.fillRect(0,0,32,32);const uri='data:image/png;base64,'+(await red.encode('png')).toString('base64');
  const equation=await f.api('study.mindmap.equation.preview',{latex:String.raw`\text{中文测试}`}),math=equation.svg.replace('<svg ','<svg x="20" y="175" width="'+equation.width+'" height="'+equation.height+'" ');
  const geometry='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><defs><clipPath id="outer"><rect width="50" height="40"/></clipPath><clipPath id="inner"><rect width="35" height="60"/></clipPath></defs><g transform="translate(120 20) rotate(90)" opacity=".5" clip-path="url(#outer)"><g clip-path="url(#inner)"><image width="60" height="60" href="'+uri+'"/><rect x="10" y="10" width="10" height="10" fill="#0000ff"/></g></g><text x="20" y="135" font-size="22">中文 é 👨‍👩‍👧‍👦 🇨🇳</text>'+math+'</svg>';
  await fs.writeFile(path.join(directory,'worker-geometry.svg'),geometry);
  const jobs=createWorkerJobs(path.join(__dirname,'../lib/mindmap-export-worker.cjs'),{timeout:60000,memory:512});
  try{
   for(const format of ['png','pdf']){
    const result=await jobs.run({svg:geometry,width:400,height:240,scale:2,format,pdfMode:'raster',title:'Self-authored production-worker geometry'}),bytes=Buffer.from(result.bytes),canvas=format==='png'?await pngCanvas(bytes):await pdfCanvas(bytes),checks=verifyGeometry(canvas);
    await fs.writeFile(path.join(directory,'worker-geometry.'+format),bytes);if(format==='pdf')await fs.writeFile(path.join(directory,'worker-geometry-pdf.png'),await canvas.encode('png'));
    report.outputs.push({name:'worker-geometry-'+format,request:'production-worker-internal-fixture',width:canvas.width,height:canvas.height,pixelChecks:checks,status:'passed-automated'});
   }
   await assert.rejects(jobs.run({svg:'<svg xmlns="http://www.w3.org/2000/svg"><mask id="gray"><rect fill="#888" width="10" height="10"/></mask></svg>',width:20,height:20,format:'png'}),error=>error.code==='EXPORT_FAILED');report.unsupportedMask='explicit-EXPORT_FAILED';
  }finally{await jobs.close();}
  report.automatedChecks='passed';report.overall='awaiting-manual-review';
 }catch(error){report.automatedChecks='failed';report.overall='failed';report.error={code:error.code||'ASSERTION_FAILED',message:error.message,stack:error.stack};process.exitCode=1;}
 finally{
  for(const cleanup of cleanups.reverse())await cleanup();
  await fs.writeFile(path.join(directory,'proof.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,...report},null,2));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
