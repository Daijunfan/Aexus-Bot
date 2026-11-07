'use strict';
const {parentPort,workerData:a}=require('node:worker_threads');
async function run(){
 if(a.format==='pdf'&&a.pdfMode!=='raster')return require('./mindmap-vector-pdf.cjs').render(a);
 const raster=await require('./svg-raster-text.cjs').rasterizeSvg(a),{width,height}=raster,png=raster.bytes;
 if(a.format==='png')return {bytes:png};
 const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create(),embedded=await pdf.embedPng(png),scale=Math.min(1,14000/Math.max(width,height));
 const page=pdf.addPage([width*scale,height*scale]);page.drawImage(embedded,{x:0,y:0,width:width*scale,height:height*scale});pdf.setTitle(a.title);pdf.setCreator('Margin Reader');return {bytes:await pdf.save()};
}
run().then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:{code:error.code||'EXPORT_FAILED',message:error.message}}));
