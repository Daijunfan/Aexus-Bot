'use strict';
const {createCanvas}=require('@napi-rs/canvas');
const S=require('./safety.cjs');
const {inspect,LIMITS:IMAGE_LIMITS}=require('./raster-image-budget.cjs');
const LIMITS={pdfBytes:128*1024*1024,imageBytes:64*1024*1024,imagePixels:IMAGE_LIMITS.totalPixels};

// This adapter receives only the validated, text-free map SVG from
// svg-raster-text. The pinned Skia SVG loader omits embedded images. Our
// existing SVG-to-PDF renderer preserves them, transforms and paint order.
// PDF.js's Node BaseFilterFactory returns "none" for luminosity-to-alpha,
// however. SVG-to-PDFKit represents clip paths as white/transparent luminosity
// masks: for precisely that case Alpha without BC is equivalent. Real SVG
// masks, text/image clip outlines and external SVGs are rejected before this
// private PDF is constructed. PDFKit can also create grayscale masks for
// transparent gradients; those must fail explicitly, never become Alpha.
function isWhiteClip(data){
 const mask=data?.SMask,form=mask?.G?.data,group=form?.Group;
 return data?.Type==='ExtGState'&&data.CA===1&&data.ca===1&&data.BM==='Normal'&&mask?.S==='Luminosity'&&
  Array.isArray(mask.BC)&&mask.BC.length===3&&mask.BC.every(value=>value===0)&&
  form?.Type==='XObject'&&form.Subtype==='Form'&&form.FormType===1&&
  group?.S==='Transparency'&&group.CS==='DeviceRGB'&&group.I===true&&group.K===false;
}
async function compose(svg,width,height,{limits:overrides={}}={}){
 const limits={...LIMITS,...overrides},PDFDocument=require('pdfkit'),SVGtoPDF=require('svg-to-pdfkit');
 const doc=new PDFDocument({autoFirstPage:false,compress:true,info:{Creator:'Margin Reader raster compositor'}});
 const originalRef=doc.ref;let clipMasks=0,conversionError;
 // SVG-to-PDFKit catches some callback failures and reports warnings. Keep
 // the original typed failure so resource limits remain actionable/atomic.
 const preserveError=callback=>(...args)=>{
  if(conversionError)throw conversionError;
  try{return callback(...args);}catch(error){conversionError=error;throw error;}
 };
 doc.ref=preserveError((data,...args)=>{
  if(isWhiteClip(data)){
   const {BC,...mask}=data.SMask;data={...data,SMask:{...mask,S:'Alpha'}};clipMasks++;
  }
  S.assert(data?.S!=='Luminosity'&&data?.SMask?.S!=='Luminosity','EXPORT_FAILED','Raster export cannot preserve a luminosity transparency effect; export SVG for a compatible viewer.');
  return originalRef.call(doc,data,...args);
 });
 const parts=[],images=new Map(),decoded=new WeakMap();let length=0,imageBytes=0,imagePixels=0,warning;
 // PDFKit caches string paths but opens a fresh PNGImage for every Buffer.
 // Keep the already validated Buffer's image object local to this document:
 // its embed guard then decodes/embeds pixels once, matching the unique-image
 // budget even when the same asset appears in several transformed groups.
 const originalOpenImage=doc.openImage;
 doc.openImage=preserveError(source=>{
  if(Buffer.isBuffer(source)&&decoded.has(source))return decoded.get(source);
  const image=originalOpenImage.call(doc,source);if(Buffer.isBuffer(source))decoded.set(source,image);return image;
 });
 const result=new Promise((resolve,reject)=>{
  doc.on('data',part=>{
   length+=part.length;
   if(length>limits.pdfBytes){doc.destroy();reject(new S.ReaderError('TOO_LARGE','Raster composition exceeds its PDF byte budget; export a smaller branch or SVG.'));return;}
   parts.push(part);
  });
  doc.once('error',reject);doc.once('end',()=>resolve(Buffer.concat(parts)));
 });result.catch(()=>{});
 let pdf;
 try{
  doc.addPage({size:[width,height],margin:0});
  SVGtoPDF(doc,svg,0,0,{width,height,assumePt:true,preserveAspectRatio:'none',precision:4,
   fontCallback:preserveError(()=>S.fail('EXPORT_FAILED','Unconverted map text reached raster composition; export SVG.')),
   imageCallback:preserveError(source=>{
    S.assert(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(source),'INVALID_PARAMS','Raster composition accepts only embedded PNG/JPEG map images.');
    if(!images.has(source)){
     const bytes=Buffer.from(source.slice(source.indexOf(',')+1),'base64');imageBytes+=bytes.length;
     S.assert(imageBytes<=limits.imageBytes,'TOO_LARGE','Raster composition exceeds its embedded-image byte budget.');
     imagePixels+=inspect(bytes,source.startsWith('data:image/png;')?'image/png':'image/jpeg').pixels;
     S.assert(imagePixels<=limits.imagePixels,'TOO_LARGE','Raster composition exceeds 40 megapixels of decoded images; export a smaller branch or SVG.');images.set(source,bytes);
    }
    return images.get(source);
   }),
   documentCallback:preserveError(()=>S.fail('INVALID_PARAMS','External SVG resources are not permitted in raster export.')),
   warningCallback:message=>{warning??=String(message).split(':')[0].slice(0,80);}
  });
  if(conversionError)throw conversionError;
  S.assert(!warning,'EXPORT_FAILED','Raster composition could not preserve a map element ('+warning+'). Check the original SVG and map images.');
  doc.end();pdf=await result;
 }catch(error){doc.destroy();throw error;}
 finally{images.clear();}
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(pdf),verbosity:0,isEvalSupported:false,useSystemFonts:false});
 try{
  const document=await task.promise,page=await document.getPage(1),canvas=createCanvas(width,height);
  // Without canvas:null PDF.js selects canvasContext.canvas and requests a
  // new alpha:false context. Native Canvas can still expose transparent
  // pixels through getImageData but flatten them onto white when encoding.
  // Keep the caller's transparent context all the way to the PNG bytes.
  await page.render({canvas:null,canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:1}),background:'rgba(0,0,0,0)'}).promise;
  return {bytes:await canvas.encode('png'),compositionBytes:pdf.length,clipMasks,imagePixels};
 }finally{await task.destroy();}
}
module.exports={compose,LIMITS};
