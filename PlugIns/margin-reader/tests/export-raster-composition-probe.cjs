'use strict';
// Offline, self-authored diagnostic. No user files, external image requests,
// font registration or production mutation. Compare the installed renderers.
const fs=require('node:fs/promises'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
async function throughPdf(svg,width,height,{alphaClips=false}={}){
 const PDFDocument=require('pdfkit'),SVGtoPDF=require('svg-to-pdfkit');
 const doc=new PDFDocument({autoFirstPage:false,compress:true}),parts=[],warnings=[];
 if(alphaClips){
  if(/<mask\b/i.test(svg))throw Error('Alpha clip equivalence is limited to clip paths');
  const ref=doc.ref;
  doc.ref=function(data,...args){
   if(data?.SMask?.S==='Luminosity'){const {BC,...mask}=data.SMask;data={...data,SMask:{...mask,S:'Alpha'}};}
   return ref.call(this,data,...args);
  };
 }
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>parts.push(b));doc.once('end',()=>resolve(Buffer.concat(parts)));doc.once('error',reject);});
 doc.addPage({size:[width,height],margin:0});
 SVGtoPDF(doc,svg,0,0,{width,height,assumePt:true,
  imageCallback:source=>{if(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(source))throw Error('Only self-authored embedded images');return Buffer.from(source.slice(source.indexOf(',')+1),'base64');},
  documentCallback:()=>{throw Error('External SVG resources are disabled');},
  warningCallback:w=>warnings.push(w)
 });doc.end();const pdf=await result;
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(pdf),verbosity:0,isEvalSupported:false,useSystemFonts:false});
 try{
  const document=await task.promise,page=await document.getPage(1),canvas=createCanvas(width,height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:1}),background:'rgba(0,0,0,0)'}).promise;
  return {canvas,warnings,pdfBytes:pdf.length,pdf};
 }finally{await task.destroy();}
}
async function main(){
 const dir=path.resolve(process.argv[2]||path.join(__dirname,'../artifacts/raster-composition-probe'));await fs.mkdir(dir,{recursive:true});
 const tile=createCanvas(20,20),tileContext=tile.getContext('2d');tileContext.fillStyle='#ff0000';tileContext.fillRect(0,0,20,20);
 const bytes=await tile.encode('png'),uri='data:image/png;base64,'+bytes.toString('base64'),results=[];
 const pixel=canvas=>[...canvas.getContext('2d').getImageData(25,25,1,1).data];
 const direct=createCanvas(80,80);direct.getContext('2d').drawImage(await loadImage(bytes),10,10,40,40);results.push({name:'png-direct',pixel:pixel(direct)});
 for(const attr of ['href','xlink:href','both'])for(const wrapped of [false,true]){
  const name=(wrapped?'link-':'plain-')+attr.replace(':','-'),attrs=attr==='both'?`href="${uri}" xlink:href="${uri}"`:`${attr}="${uri}"`;
  const image=`<image x="10" y="10" width="40" height="40" ${attrs}/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="80" height="80" viewBox="0 0 80 80"><defs><clipPath id="clip"><rect x="0" y="0" width="45" height="80"/></clipPath></defs><g clip-path="url(#clip)">${wrapped?`<a href="margin-reader://card/proof/root">${image}</a>`:image}<rect x="30" y="30" width="10" height="10" fill="#0000ff"/></g></svg>`;
  const canvas=createCanvas(80,80);canvas.getContext('2d').drawImage(await loadImage(Buffer.from(svg)),0,0);
  results.push({name:name+'-skia',pixel:pixel(canvas)});
  await fs.writeFile(path.join(dir,name+'-skia.png'),await canvas.encode('png'));
  try{const start=performance.now(),rendered=await throughPdf(svg,80,80),ctx=rendered.canvas.getContext('2d');
   results.push({name:name+'-pdf',pixel:pixel(rendered.canvas),overpaint:[...ctx.getImageData(35,35,1,1).data],clipped:[...ctx.getImageData(48,25,1,1).data],ms:Math.round(performance.now()-start),warnings:rendered.warnings,pdfBytes:rendered.pdfBytes});
   await fs.writeFile(path.join(dir,name+'-pdf.png'),await rendered.canvas.encode('png'));
   await fs.writeFile(path.join(dir,name+'.pdf'),rendered.pdf);
  }catch(error){results.push({name:name+'-pdf',error:error.message});}
 }
 const jpeg='data:image/jpeg;base64,'+(await tile.encode('jpeg',100)).toString('base64');
 for(const [kind,content]of [['shape','<rect x="10" y="10" width="40" height="40" fill="#ff0000"/>'],['jpeg',`<image x="10" y="10" width="40" height="40" href="${jpeg}"/>`],['rgba',`<image x="10" y="10" width="40" height="40" href="${uri}"/>`]]){
  const source=`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><defs><clipPath id="clip" clipPathUnits="userSpaceOnUse"><path d="M0 0H45V80H0Z"/></clipPath></defs><g clip-path="url(#clip)">${content}<rect x="46" y="60" width="4" height="4" fill="#00ff00"/></g></svg>`;
  const rendered=await throughPdf(source,80,80),ctx=rendered.canvas.getContext('2d');
  results.push({name:'clip-'+kind,pixel:pixel(rendered.canvas),clipped:[...ctx.getImageData(48,25,1,1).data],shapeClipped:[...ctx.getImageData(48,62,1,1).data],warnings:rendered.warnings});
  await fs.writeFile(path.join(dir,'clip-'+kind+'.pdf'),rendered.pdf);await fs.writeFile(path.join(dir,'clip-'+kind+'.png'),await rendered.canvas.encode('png'));
  const fixed=await throughPdf(source,80,80,{alphaClips:true}),fixedContext=fixed.canvas.getContext('2d');
  results.push({name:'alpha-clip-'+kind,pixel:pixel(fixed.canvas),clipped:[...fixedContext.getImageData(48,25,1,1).data],shapeClipped:[...fixedContext.getImageData(48,62,1,1).data],warnings:fixed.warnings});
  await fs.writeFile(path.join(dir,'alpha-clip-'+kind+'.pdf'),fixed.pdf);await fs.writeFile(path.join(dir,'alpha-clip-'+kind+'.png'),await fixed.canvas.encode('png'));
 }
 // Preserve the intermediate PDF so an independent renderer can distinguish
 // SVG-to-PDF group semantics from the Node PDF rasterizer's compositing.
 const defs='<defs><clipPath id="outer"><rect width="50" height="40"/></clipPath><clipPath id="inner"><rect width="35" height="60"/></clipPath></defs>',bitmap='<image width="60" height="60" href="'+uri+'"/>',overpaint='<rect x="10" y="10" width="10" height="10" fill="#0000ff"/>';
 for(const [name,body,points]of [
  ['opacity-shape','<g opacity=".5"><rect x="10" y="10" width="40" height="40" fill="#ff0000"/></g>',[[25,25],[2,2]]],
  ['opacity-image','<g opacity=".5">'+bitmap+'</g>',[[25,25],[75,75]]],
  ['opacity-clip',defs+'<g opacity=".5" clip-path="url(#outer)">'+bitmap+'</g>',[[25,25],[55,25],[25,45]]],
  ['opacity-nested-rotated',defs+'<g transform="translate(120 20) rotate(90)" opacity=".5" clip-path="url(#outer)"><g clip-path="url(#inner)">'+bitmap+overpaint+'</g></g>',[[115,25],[105,35],[115,60],[75,25]]]
 ]){
  const source='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">'+body+'</svg>',rendered=await throughPdf(source,400,200,{alphaClips:true}),ctx=rendered.canvas.getContext('2d');
  results.push({name,pixels:points.map(([x,y])=>({x,y,rgba:[...ctx.getImageData(x,y,1,1).data]})),warnings:rendered.warnings});
  await fs.writeFile(path.join(dir,name+'.svg'),source);await fs.writeFile(path.join(dir,name+'.pdf'),rendered.pdf);await fs.writeFile(path.join(dir,name+'.png'),await rendered.canvas.encode('png'));
 }
 await fs.writeFile(path.join(dir,'probe.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
