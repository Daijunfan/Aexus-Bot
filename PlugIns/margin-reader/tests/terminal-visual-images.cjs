'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {validatePNG,planImage,createImageEncoder,MAX_BYTES}=require('../terminal-visuals/images.cjs');
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n>>>1^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function png(width=1,height=1,padding=0){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),...(padding?[chunk('tEXt',Buffer.alloc(padding,65))]:[]),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
test('PNG validates CRC, signature, dimensions and byte boundaries',()=>{
  assert.equal(validatePNG(png()).width,1);
  assert.throws(()=>validatePNG(Buffer.from('not png')),{code:'INVALID_PNG'});
  const bad=png();bad[40]^=1;assert.throws(()=>validatePNG(bad),{code:'INVALID_PNG'});
  assert.throws(()=>validatePNG(png(6000,6000)),{code:'IMAGE_LIMIT'});
  assert.throws(()=>validatePNG(Buffer.alloc(MAX_BYTES+1)),{code:'IMAGE_LIMIT'});
  assert.throws(()=>validatePNG(png().subarray(0,-2)),{code:'INVALID_PNG'});
});
test('unconfirmed, dumb, tmux and non-TTY never encode control bytes',()=>{
  const e=createImageEncoder();
  for(const options of [
    {mode:'kitty',isTTY:false,confirmed:{kitty:true}},
    {mode:'iterm2',isTTY:true,term:'dumb',confirmed:{iterm2:true}},
    {mode:'auto',isTTY:true,term:'xterm-kitty'},
    {mode:'kitty',isTTY:true,multiplexer:true,confirmed:{kitty:true}},
    {mode:'iterm2',isTTY:true,term:'iTerm.app'}
  ]){const plan=planImage(options),out=e.encode(png(),plan);assert.equal(plan.enabled,false);assert.deepEqual(out.chunks,[]);assert.doesNotMatch(out.text,/[\x00-\x1f\x7f-\x9f]/);}
});
test('Kitty chunk reassembly and only owned ID deletion',()=>{
  const e=createImageEncoder(),cap=planImage({isTTY:true,mode:'auto',confirmed:{kitty:true}}),bytes=png(1,1,20000),out=e.encode(bytes,cap);
  assert.ok(out.chunks.length>1);const payloads=out.chunks.map(x=>x.slice(x.indexOf(';')+1,-2));
  assert.ok(payloads.every(x=>x.length<=4096));assert.deepEqual(Buffer.from(payloads.join(''),'base64'),bytes);
  assert.deepEqual(e.clear(999,cap),[]);assert.equal(e.clear(out.id,cap).length,1);assert.deepEqual(e.clear(out.id,cap),[]);
});
test('iTerm inline aspect ratio and confirmed multipart boundary',()=>{
  const e=createImageEncoder(),cap=planImage({isTTY:true,mode:'iterm2',confirmed:{iterm2:true}});
  const out=e.encode(png(),cap);assert.match(out.chunks[0],/inline=1;preserveAspectRatio=1/);
  assert.deepEqual(e.clear(1,cap),[]);
  const large=png(1,1,800000);assert.equal(e.encode(large,cap).chunks.length,0);
  const multi=e.encode(large,{...cap,multipart:true});assert.match(multi.chunks[0],/MultipartFile/);assert.match(multi.chunks.at(-1),/FileEnd/);
});
test('random/injected Kitty IDs and partial-upload exception cleanup',()=>{
 const cap=planImage({isTTY:true,mode:'kitty',confirmed:{kitty:true}}),e=createImageEncoder({allocateId:()=>0xfffffffe});
 const out=e.encode(png(1,1,20000),cap);assert.equal(out.id,0xfffffffe);assert.match(out.chunks[0],/c=80,r=24/);
 // Caller may fail after sending just the first chunk: IDs are already owned.
 assert.deepEqual(e.ownedIds(),[out.id]);assert.equal(e.clearAll(cap).length,1);assert.deepEqual(e.ownedIds(),[]);
 assert.throws(()=>createImageEncoder({allocateId:()=>0}).encode(png(),cap),{code:'INVALID_IMAGE_ID'});
 const a=createImageEncoder(),b=createImageEncoder();assert.notEqual(a.encode(png(),cap).id,b.encode(png(),cap).id);
});
