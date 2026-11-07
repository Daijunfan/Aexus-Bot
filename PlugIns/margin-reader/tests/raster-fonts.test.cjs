'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRasterFonts}=require('../lib/raster-fonts.cjs');

function fixture(names=['Helvetica','Hiragino Sans GB','Arial Unicode MS','Apple Color Emoji']){
 const opened=[],checked=[],fonts=createRasterFonts({platform:'darwin',globalFonts:{families:names.map(family=>({family}))},exists:()=>true,stat:()=>({size:100}),openFont:file=>{
  opened.push(file);
  return {hasGlyphForCodePoint(point){checked.push(point);return file.endsWith('Helvetica.ttc')?point<128||point===0x301:file.includes('Hiragino')?point>=0x4e00&&point<=0x9fff:file.includes('Apple Color Emoji')?point>=0x1f000&&point<=0x1ffff:false;}};
 }});
 return {fonts,opened,checked};
}
test('raster fallback uses installed family names and reads only fixed platform paths, lazily and once',()=>{
 const f=fixture();assert.deepEqual(f.opened,[]);
 f.fonts.assertText('A e\u0301 中文 👨‍👩‍👧‍👦 🇨🇳');
 const calls=f.checked.length;f.fonts.assertText('A e\u0301 中文 👨‍👩‍👧‍👦 🇨🇳');assert.equal(f.checked.length,calls);
 assert.equal(new Set(f.opened).size,f.opened.length);
 assert(f.opened.every(file=>file.startsWith('/System/Library/Fonts/')));
 const families=f.fonts.familyList('url(https://invalid.test/font), /private/font.ttf, Helvetica');
 assert(families.startsWith('"Helvetica"'));assert(!families.includes('https'));assert(!families.includes('/private'));
});
test('missing CJK or emoji glyphs fail clearly instead of allowing a replacement-box raster',()=>{
 const f=fixture(['Helvetica']);f.fonts.assertText('Latin e\u0301');
 for(const text of ['中','👨‍👩‍👧‍👦','🇨🇳'])assert.throws(()=>f.fonts.assertText(text),error=>error.code==='FONT_UNAVAILABLE'&&/SVG/.test(error.message));
 assert.throws(()=>createRasterFonts({platform:'linux',globalFonts:{families:[]},exists:()=>true}),error=>error.code==='FONT_UNAVAILABLE');
});
test('font file size is bounded before fontkit opens its contents',()=>{
 let opened=false;const fonts=createRasterFonts({platform:'darwin',globalFonts:{families:[{family:'Helvetica'}]},exists:()=>true,stat:()=>({size:256*1024*1024+1}),openFont:()=>{opened=true;}});
 assert.throws(()=>fonts.assertText('A'),error=>error.code==='FONT_UNAVAILABLE');assert.equal(opened,false);
});
test('generic serif and monospace keep their family semantics while retaining Unicode fallbacks',()=>{
 const {fonts}=fixture(['Helvetica','Times','Menlo','Hiragino Sans GB','Arial Unicode MS','Apple Color Emoji']);
 assert(fonts.familyList('serif').startsWith('"Times",'));
 assert(fonts.familyList('monospace').startsWith('"Menlo",'));
 assert(fonts.familyList('system-ui').startsWith('"Helvetica",'));
 assert(fonts.familyList('sans-serif').startsWith('"Helvetica",'));
 assert(fonts.familyList('monospace').includes('"Hiragino Sans GB"'));
 assert(fonts.familyList('monospace').includes('"Apple Color Emoji"'));
});
