'use strict';
const S=require('./safety.cjs');
const LIMITS=Object.freeze({side:16000,imagePixels:24000000,totalPixels:40000000});
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const SOF=new Set([192,193,194,195,197,198,199,201,202,203,205,206,207]);
const valid=(condition,message)=>S.assert(condition,'INVALID_MEDIA',message);
function bounded(width,height){
 valid(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0,'Image has invalid raster dimensions.');
 S.assert(width<=LIMITS.side&&height<=LIMITS.side&&width*height<=LIMITS.imagePixels,'TOO_LARGE','Raster images must fit 24 megapixels and 16000 pixels per side; export a smaller image or SVG.');
 return {width,height,pixels:width*height};
}
function png(bytes){
 valid(bytes.length>=33&&bytes.subarray(0,8).equals(PNG),'Invalid PNG image header.');
 valid(bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR','PNG must begin with a complete IHDR header.');
 const result=bounded(bytes.readUInt32BE(16),bytes.readUInt32BE(20));
 // Check all chunk boundaries, so a later duplicate IHDR cannot change the
 // decoder's dimensions after this preflight. No pixel data is inflated here.
 let at=8,imageData=false,ended=false;
 while(at<bytes.length){
  valid(at+12<=bytes.length,'Truncated PNG chunk.');
  const size=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+12+size;
  valid(end<=bytes.length,'Truncated PNG chunk payload.');
  valid(type!=='IHDR'||at===8,'Duplicate PNG image dimensions.');
  if(type==='IDAT')imageData=true;
  if(type==='IEND'){valid(size===0&&end===bytes.length,'Invalid PNG image end.');ended=true;break;}
  at=end;
 }
 valid(ended&&imageData,'PNG image is missing its pixel data or end marker.');return result;
}
function jpeg(bytes){
 valid(bytes.length>=4&&bytes[0]===255&&bytes[1]===216,'Invalid JPEG image header.');
 let at=2,result,scan=false,hasScan=false,ended=false;
 while(at<bytes.length){
  if(scan){at=bytes.indexOf(255,at);valid(at!==-1,'Truncated JPEG scan.');}
  valid(bytes[at]===255,'Invalid JPEG marker boundary.');
  while(at<bytes.length&&bytes[at]===255)at++;
  valid(at<bytes.length,'Truncated JPEG marker.');
  const marker=bytes[at++];
  if(scan&&(marker===0||marker>=208&&marker<=215))continue;
  scan=false;
  if(marker===217){ended=true;break;}
  valid(marker!==0&&marker!==216&&marker!==220,'Unsupported or repeated JPEG dimension marker.');
  if(marker===1||marker>=208&&marker<=215)continue;
  valid(at+2<=bytes.length,'Truncated JPEG marker length.');
  const size=bytes.readUInt16BE(at),end=at+size;
  valid(size>=2&&end<=bytes.length,'Damaged JPEG marker payload.');
  if(SOF.has(marker)){
   valid(!result&&size>=11,'Missing or repeated JPEG frame dimensions.');
   const components=bytes[at+7];valid(components>0&&size===8+components*3,'Invalid JPEG frame header.');
   result=bounded(bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3));
  }
  if(marker===218){
   valid(result&&size>=8&&bytes[at+2]>0&&size===6+bytes[at+2]*2,'Invalid JPEG scan header.');
   scan=true;hasScan=true;
  }
  at=end;
 }
 valid(result&&hasScan&&ended,'JPEG image is missing its frame, scan or end marker.');return result;
}
// Dimension/structure preflight only: leave decoding and image integrity to the
// bounded compositor. Its source cache counts each result once, including text
// PNGs, before passing any image to PDFKit or the Canvas/PDF.js decoders.
function inspect(bytes,mime){
 valid(Buffer.isBuffer(bytes),'Raster image inspection requires encoded bytes.');
 valid(mime==='image/png'||mime==='image/jpeg','Raster composition accepts PNG or JPEG images only.');
 return mime==='image/png'?png(bytes):jpeg(bytes);
}
module.exports={inspect,LIMITS};
