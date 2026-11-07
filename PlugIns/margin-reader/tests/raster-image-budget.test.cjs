'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspect,LIMITS}=require('../lib/raster-image-budget.cjs');
// Only encoded headers/markers are inspected. The large dimension cases never
// allocate an image, Canvas, decompressed IDAT or decoded JPEG buffer.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
function png(width=1,height=1){const bytes=Buffer.from(pixel);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
function segment(marker,payload){const header=Buffer.alloc(4);header[0]=255;header[1]=marker;header.writeUInt16BE(payload.length+2,2);return Buffer.concat([header,payload]);}
function frame(width,height,marker=192){const bytes=Buffer.alloc(9);bytes[0]=8;bytes.writeUInt16BE(height,1);bytes.writeUInt16BE(width,3);bytes[5]=1;bytes[6]=1;bytes[7]=17;return segment(marker,bytes);}
function jpeg(width=12,height=8,{marker=192,prefix=Buffer.alloc(0),tail=Buffer.from([0,255,0,12,255,208,4])}={}){return Buffer.concat([Buffer.from([255,216]),prefix,frame(width,height,marker),segment(218,Buffer.from([1,1,0,0,63,0])),tail,Buffer.from([255,217])]);}

test('PNG/JPEG preflight reads encoded dimensions without decoding pixel data',()=>{
 assert.deepEqual(inspect(pixel,'image/png'),{width:1,height:1,pixels:1});
 assert.deepEqual(inspect(jpeg(),'image/jpeg'),{width:12,height:8,pixels:96});
 assert.equal(LIMITS.totalPixels,40000000);
});

test('single-image and side budgets accept their exact bounds and reject overflows before allocation',()=>{
 for(const [width,height]of [[5000,4800],[16000,1500],[1500,16000]])for(const [bytes,mime]of [[png(width,height),'image/png'],[jpeg(width,height),'image/jpeg']])assert.equal(inspect(bytes,mime).pixels,24000000);
 for(const [width,height]of [[5000,4801],[16001,1],[1,16001]])for(const [bytes,mime]of [[png(width,height),'image/png'],[jpeg(width,height),'image/jpeg']])assert.throws(()=>inspect(bytes,mime),{code:'TOO_LARGE'});
 for(const bytes of [png(0,1),png(1,0),jpeg(0,1),jpeg(1,0)])assert.throws(()=>inspect(bytes,bytes[0]===137?'image/png':'image/jpeg'),{code:'INVALID_MEDIA'});
});

test('MIME/signature mismatch and unsupported formats cannot bypass image limits',()=>{
 for(const [bytes,mime]of [[pixel,'image/jpeg'],[jpeg(),'image/png'],[pixel,'image/gif'],[Buffer.from('not an image'),'image/png']])assert.throws(()=>inspect(bytes,mime),{code:'INVALID_MEDIA'});
 assert.throws(()=>inspect(new Uint8Array(pixel),'image/png'),{code:'INVALID_MEDIA'});
});

test('PNG chunk boundaries and duplicate dimensions fail without reading past the buffer',()=>{
 const duplicate=Buffer.concat([pixel.subarray(0,33),png(16001,1).subarray(8,33),pixel.subarray(33)]);
 const badHeader=Buffer.from(pixel);badHeader.writeUInt32BE(12,8);
 const badChunk=Buffer.from(pixel);badChunk.writeUInt32BE(0xffffffff,33);
 for(const bytes of [pixel.subarray(0,20),pixel.subarray(0,-1),duplicate,badHeader,badChunk,Buffer.concat([pixel,Buffer.from([0])])])assert.throws(()=>inspect(bytes,'image/png'),{code:'INVALID_MEDIA'});
});

test('JPEG preflight skips metadata and entropy safely and supports baseline/progressive frame markers',()=>{
 const prefix=segment(225,Buffer.concat([Buffer.from('Exif\0\0'),frame(16001,1)]));
 for(const marker of [192,193,194,195,197,198,199,201,202,203,205,206,207])assert.deepEqual(inspect(jpeg(20,10,{marker,prefix}),'image/jpeg'),{width:20,height:10,pixels:200});
 assert.deepEqual(inspect(jpeg(20,10,{prefix:Buffer.from([255,255,1])}),'image/jpeg'),{width:20,height:10,pixels:200});
});

test('JPEG truncated/changed dimension markers cannot be hidden after the first scan',()=>{
 const secondFrame=jpeg(12,8,{tail:frame(16001,1)}),dnl=jpeg(12,8,{tail:segment(220,Buffer.from([0,20]))});
 const badLength=jpeg();badLength.writeUInt16BE(0xffff,4);
 for(const bytes of [jpeg().subarray(0,5),jpeg().subarray(0,-1),secondFrame,dnl,badLength,Buffer.from([255,216,255,217])])assert.throws(()=>inspect(bytes,'image/jpeg'),{code:'INVALID_MEDIA'});
});
