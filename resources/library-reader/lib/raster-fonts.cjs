'use strict';
const fs=require('node:fs');
const S=require('./safety.cjs');

// Family names from a document never become filenames. These are the same
// installed platform fonts used by the native renderer, not bundled copies.
const PLATFORM_FONTS={
 darwin:[
  ['Helvetica','/System/Library/Fonts/Helvetica.ttc'],
  ['Hiragino Sans GB','/System/Library/Fonts/Hiragino Sans GB.ttc'],
  ['Arial Unicode MS','/System/Library/Fonts/Supplemental/Arial Unicode.ttf'],
  ['Apple Color Emoji','/System/Library/Fonts/Apple Color Emoji.ttc']
 ],
 linux:[
  ['DejaVu Sans','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  ['Noto Sans CJK SC','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'],
  ['Noto Sans CJK JP','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'],
  ['Noto Color Emoji','/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'],
  ['Noto Color Emoji','/usr/share/fonts/truetype/emoji/NotoColorEmoji.ttf']
 ],
 win32:[
  ['Segoe UI','C:/Windows/Fonts/segoeui.ttf'],
  ['Microsoft YaHei','C:/Windows/Fonts/msyh.ttc'],
  ['Arial','C:/Windows/Fonts/arial.ttf'],
  ['Segoe UI Emoji','C:/Windows/Fonts/seguiemj.ttf']
 ]
};
const GENERIC=/^(?:system-ui|sans-serif|serif|monospace|-apple-system|BlinkMacSystemFont|inherit|initial)$/i;
const GENERIC_FAMILIES={
 darwin:{serif:['Times','Times New Roman'],monospace:['Menlo','Monaco','Courier'],sans:['Helvetica','Arial']},
 linux:{serif:['DejaVu Serif','Nimbus Roman','Liberation Serif'],monospace:['DejaVu Sans Mono','Nimbus Mono PS','Liberation Mono'],sans:['DejaVu Sans','Nimbus Sans','Liberation Sans']},
 win32:{serif:['Times New Roman','Georgia'],monospace:['Consolas','Cascadia Mono','Courier New'],sans:['Segoe UI','Arial']}
};
const ignored=c=>/[\s\p{Control}\p{Format}\p{Variation_Selector}]/u.test(c);
const quote=name=>'"'+name.replace(/["\\]/g,'\\$&')+'"';

function createRasterFonts({platform=process.platform,globalFonts=require('@napi-rs/canvas').GlobalFonts,exists=fs.existsSync,stat=fs.statSync,openFont=file=>require('fontkit').openSync(file)}={}){
 const installed=new Set(globalFonts.families.map(value=>value.family));
 const choices=(PLATFORM_FONTS[platform]||[]).filter(([name,file])=>installed.has(name)&&exists(file));
 S.assert(choices.length,'FONT_UNAVAILABLE','Raster export needs a supported local font. Make a platform Unicode font available, or export SVG for a viewer with the required fonts.');
 const families=[...new Set(choices.map(([name])=>name))],opened=new Map(),checked=new Set(),used=new Set();let fontBytes=0;
 function faces(file){
  if(!opened.has(file)){
   const size=stat(file).size;
   S.assert(size<=256*1024*1024&&fontBytes+size<=256*1024*1024,'FONT_UNAVAILABLE','Local fonts exceed the bounded raster-font reader. Export SVG for a compatible viewer.');
   fontBytes+=size;
   try{const value=openFont(file);opened.set(file,typeof value.hasGlyphForCodePoint==='function'?[value]:value.fonts||[]);}
   catch(error){S.fail('FONT_UNAVAILABLE','The local raster font could not be read: '+file+'. '+error.message);}
  }
  return opened.get(file);
 }
 function assertText(text){
  for(const c of String(text)){
   if(ignored(c)||checked.has(c))continue;
   const point=c.codePointAt(0);let supported=false;
   for(const [name,file]of choices){
    if(faces(file).some(font=>font.hasGlyphForCodePoint(point))){supported=true;used.add(name);break;}
   }
   S.assert(supported,'FONT_UNAVAILABLE','Raster export cannot render '+c+' (U+'+point.toString(16).toUpperCase()+') with the available local fonts. Check the installed CJK/emoji fonts or export SVG for a compatible viewer.');
   if(checked.size>=8192)checked.clear();checked.add(c);
  }
 }
 function familyList(requested='system-ui'){
  // Restrict document input to names already in the native font database.
  // Unknown names and CSS generic names fall back to our explicit local list.
  const preferred=String(requested).split(',').slice(0,16).map(v=>v.trim().replace(/^(['"])(.*)\1$/,'$2')).flatMap(name=>{
   if(!GENERIC.test(name))return installed.has(name)?[name]:[];
   const kind=/^(serif|monospace)$/i.test(name)?name.toLowerCase():'sans';
   const family=(GENERIC_FAMILIES[platform]?.[kind]||[]).find(value=>installed.has(value));return family?[family]:[];
  });
  return [...new Set([...preferred,...families])].map(quote).join(', ');
 }
 return {assertText,familyList,families,used:()=>[...used]};
}
module.exports={createRasterFonts};
