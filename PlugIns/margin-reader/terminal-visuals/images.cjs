'use strict';
const MAX_BYTES=16*1024*1024,MAX_PIXELS=24000000;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function fail(code,message){throw Object.assign(new Error(message),{code});}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function validatePNG(input){
  if(!Buffer.isBuffer(input)&&!(input instanceof Uint8Array))fail('INVALID_PNG','PNG bytes are required.');
  const bytes=Buffer.from(input);if(bytes.length>MAX_BYTES)fail('IMAGE_LIMIT','PNG exceeds 16 MiB.');
  if(bytes.length<45||!bytes.subarray(0,8).equals(signature))fail('INVALID_PNG','Invalid PNG signature.');
  let offset=8,width,height,ended=false,hasData=false,index=0;
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if(end>bytes.length)fail('INVALID_PNG','Truncated PNG chunk.');
    const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);
    if(crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))fail('INVALID_PNG','PNG CRC mismatch.');
    if(index++===0&&type!=='IHDR')fail('INVALID_PNG','IHDR must be first.');
    if(type==='IHDR'){
      if(width!==undefined||length!==13)fail('INVALID_PNG','Invalid IHDR.');
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(!width||!height||width*height>MAX_PIXELS)fail('IMAGE_LIMIT','PNG exceeds 24 MP.');
      const allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!allowed[data[9]]?.includes(data[8])||data[10]!==0||data[11]!==0||data[12]>1)fail('INVALID_PNG','Unsupported PNG header.');
    }
    if(type==='acTL'||type==='fcTL'||type==='fdAT')fail('INVALID_PNG','Animated PNG is not supported.');
    if(type==='IDAT')hasData=true;
    if(type==='IEND'){if(length!==0||end!==bytes.length)fail('INVALID_PNG','Invalid PNG ending.');ended=true;break;}
    offset=end;
  }
  if(!ended||!hasData)fail('INVALID_PNG','PNG data/end missing.');
  // Structural validation only; the terminal is the decoder. No unbounded inflate.
  return {bytes,mimeType:'image/png',width,height};
}
function planImage({isTTY=false,term='',mode='off',confirmed={},multiplexer=false}={}){
  if(!['off','auto','kitty','iterm2'].includes(mode))fail('INVALID_IMAGE_MODE','Unknown image mode.');
  if(!isTTY)return {enabled:false,reason:'NO_TTY',protocol:null};
  if(term==='dumb')return {enabled:false,reason:'DUMB_TERMINAL',protocol:null};
  if(mode==='off')return {enabled:false,reason:'DISABLED',protocol:null};
  if(multiplexer&&!confirmed.passthrough)return {enabled:false,reason:'UNCONFIRMED_MULTIPLEXER',protocol:null};
  const protocol=mode==='auto'?(confirmed.kitty?'kitty':confirmed.iterm2?'iterm2':null):mode;
  if(!protocol||!confirmed[protocol])return {enabled:false,reason:'UNCONFIRMED_CAPABILITY',protocol:null};
  return {enabled:true,protocol,reason:'CONFIRMED',multipart:protocol==='iterm2'&&confirmed.iterm2Multipart===true};
}
function createImageEncoder({allocateId=()=>require('node:crypto').randomInt(1,0x100000000)}={}){
  const own=new Set();
  function allocate(){
    if(own.size>=10000)fail('IMAGE_LIMIT','Release owned images before allocating more.');
    for(let tries=0;tries<32;tries++){const id=allocateId();if(!Number.isInteger(id)||id<1||id>0xffffffff)fail('INVALID_IMAGE_ID','Image IDs must be unsigned nonzero 32-bit integers.');if(!own.has(id)){own.add(id);return id;}}
    fail('IMAGE_ID_COLLISION','Allocator repeatedly returned owned image IDs.');
  }
  function encode(input,capability,{columns=80,rows=24}={}){
    if(!capability?.enabled)return {chunks:[],text:'[image unavailable: '+(capability?.reason||'DISABLED')+']',id:null};
    if(!['kitty','iterm2'].includes(capability.protocol))fail('INVALID_CAPABILITY','Unknown image protocol.');
    if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>100000)fail('IMAGE_LIMIT','Invalid image viewport.');
    const png=validatePNG(input),b64=png.bytes.toString('base64'),chunks=[];
    if(capability.protocol==='kitty'){
      const id=allocate();
      for(let i=0;i<b64.length;i+=4096){
        const first=i===0,last=i+4096>=b64.length;
        chunks.push('\x1b_G'+(first?'a=T,f=100,t=d,i='+id+',c='+columns+',r='+rows+',':'')+'m='+(last?0:1)+';'+b64.slice(i,i+4096)+'\x1b\\');
      }
      return {chunks,id,text:'',width:png.width,height:png.height};
    }
    const args='inline=1;preserveAspectRatio=1;width='+columns+';height='+rows+';size='+png.bytes.length;
    if(capability.multipart){
      chunks.push('\x1b]1337;MultipartFile='+args+'\x07');
      for(let i=0;i<b64.length;i+=4096)chunks.push('\x1b]1337;FilePart='+b64.slice(i,i+4096)+'\x07');
      chunks.push('\x1b]1337;FileEnd\x07');
    }else{
      if(b64.length+args.length+32>1048576)return {chunks:[],id:null,text:'[image unavailable: ITERM_SEQUENCE_LIMIT]'};
      chunks.push('\x1b]1337;File='+args+':'+b64+'\x07');
    }
    return {chunks,id:null,text:'',width:png.width,height:png.height};
  }
  function clear(id,capability){
    if(!capability?.enabled||capability.protocol!=='kitty'||!own.has(id))return [];
    own.delete(id);return ['\x1b_Ga=d,d=I,i='+id+'\x1b\\'];
  }
  function clearAll(capability){const chunks=[];for(const id of [...own])chunks.push(...clear(id,capability));return chunks;}
  return {encode,clear,clearAll,ownedIds:()=>[...own]};
}
module.exports={validatePNG,planImage,createImageEncoder,MAX_BYTES,MAX_PIXELS};
