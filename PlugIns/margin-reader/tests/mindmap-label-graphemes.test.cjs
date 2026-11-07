'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function boundaries(text){
 const values=new Set([0,text.length]);
 for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text))values.add(part.index);
 return values;
}

test('mind-map wrapping preserves complete graphemes and original UTF-16 ranges',async()=>{
 const {wrapLabel,labelWidth}=await import('../ui/mindmap-style.mjs');
 const examples=[
  '👨‍👩‍👧‍👦'.repeat(8),
  '🇨🇳🇺🇸🇯🇵'.repeat(4),
  'e\u0301o\u0308n\u0303'.repeat(8),
  '中文阅读与思维导图，保持原文定位。',
  'Read antidisestablishmentarianism with contextual source links',
  '中文 👩🏽‍🔬 1️⃣ 🇨🇳 e\u0301 research\n第二行\r\nThird line'
 ];
 for(const text of examples)for(const width of [16,32,64,120]){
  const points=boundaries(text),lines=wrapLabel(text,width,16);
  for(const line of lines){
   assert(points.has(line.start),'start splits a grapheme: '+JSON.stringify(line));
   assert(points.has(line.end),'end splits a grapheme: '+JSON.stringify(line));
   assert.equal(text.slice(line.start,line.end),line.text);
   assert(labelWidth(line.text,16)<=width+1e-8||[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(line.text)].length===1);
  }
  // Wrapping may consume whitespace, but cannot drop or reorder visible content.
  assert.equal(lines.map(l=>l.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
 assert.equal(labelWidth('👨‍👩‍👧‍👦',16),labelWidth('👨',16));
 assert.equal(labelWidth('🇨🇳',16),labelWidth('中',16));
 assert.equal(labelWidth('e\u0301',16),labelWidth('e',16));
});

test('title ellipsis removes whole graphemes without changing the full title',async()=>{
 const {topicBox,topicStyle,mapStyle}=await import('../ui/mindmap-style.mjs');
 for(const glyph of ['👨‍👩‍👧‍👦','🇨🇳','e\u0301','中']){
  const title=glyph.repeat(30),card={id:'card',title,mindmap:{width:100,fontSize:24}},config=mapStyle({titleLines:1});
  const box=topicBox(card,topicStyle(card,{titleLines:1}),config);
  assert.equal(box.lines.length,1);assert.equal(box.lines[0].ellipsis,true);
  assert(boundaries(title).has(box.lines[0].end));
  assert.equal(title.slice(box.lines[0].start,box.lines[0].end),box.lines[0].text);
  assert.equal(card.title,title);
 }
});

test('CJK soft wrapping keeps closing punctuation with its preceding source grapheme',async()=>{
 const {wrapLabel,labelWidth}=await import('../ui/mindmap-style.mjs');
 assert.deepEqual(wrapLabel('一二三四：五六',64,16).map(line=>line.text),['一二三','四：五六']);
 for(const mark of Array.from('，。！？：；、）》】〕〉」』〗〙〛］｝’”»›…﹐﹑﹒﹔﹕﹖﹗,.;:!?)]}')){
  const text='甲乙'+mark+'丙丁',lines=wrapLabel(text,32,16);
  assert(lines.every(line=>!line.text.startsWith(mark)),JSON.stringify({mark,lines}));
  for(const line of lines){assert.equal(text.slice(line.start,line.end),line.text);assert(labelWidth(line.text,16)<=32+1e-8);}
  assert.equal(lines.map(line=>line.text).join(''),text);
 }
});

test('CJK opening punctuation moves with the following grapheme instead of hanging at a soft line end',async()=>{
 const {wrapLabel,labelWidth}=await import('../ui/mindmap-style.mjs');
 for(const mark of Array.from('（《【〔〈「『〖〘〚［｛‘“«‹([{')){
  const text='甲'+mark+'乙丙丁',lines=wrapLabel(text,32,16);
  assert(lines.every(line=>!line.text.endsWith(mark)),JSON.stringify({mark,lines}));
  for(const line of lines){assert.equal(text.slice(line.start,line.end),line.text);assert(labelWidth(line.text,16)<=32+1e-8);}
  assert.equal(lines.map(line=>line.text).join(''),text);
 }
 const example=wrapLabel('正文（来源）与复习',48,16);
 assert(example.every(line=>!line.text.endsWith('（')&&!line.text.startsWith('）')));
});

test('punctuation grouping preserves emoji, combining accents, whitespace offsets and explicit breaks',async()=>{
 const {wrapLabel,labelWidth}=await import('../ui/mindmap-style.mjs');
 const closing=/^[，。！？：；、）》】”’…]/u,opening=/[（《【“‘]$/u;
 for(const text of ['中文👩🏽‍🔬：e\u0301学习，保持🇨🇳旗帜。','阅读（“👨‍👩‍👧‍👦家庭”）与e\u0301笔记','中文  ：原文范围（ 空格 ）也连续'])for(const width of [48,64,96]){
  const points=boundaries(text),lines=wrapLabel(text,width,16);
  for(const line of lines){assert(!closing.test(line.text.trimStart()),JSON.stringify(line));assert(!opening.test(line.text.trimEnd()),JSON.stringify(line));assert(points.has(line.start)&&points.has(line.end));assert.equal(text.slice(line.start,line.end),line.text);assert(labelWidth(line.text,16)<=width+1e-8);}
  assert.equal(lines.map(line=>line.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
 const manual='中文\n：保留手动分行\r\n（';
 assert.deepEqual(wrapLabel(manual,1000,16).map(line=>line.text),['中文','：保留手动分行','（']);
 for(const line of wrapLabel(manual,1000,16))assert.equal(manual.slice(line.start,line.end),line.text);
});

test('impossibly narrow punctuation groups fall back in bounded complete graphemes',async()=>{
 const {wrapLabel,labelWidth}=await import('../ui/mindmap-style.mjs');
 const text='（👩🏽‍🔬）e\u0301，！？：'+('（'.repeat(100))+('中'.repeat(5))+('）'.repeat(100)),points=boundaries(text);
 const count=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length;
 for(const width of [0,.1,1,8,16,24]){
  const lines=wrapLabel(text,width,16);assert(lines.length>0&&lines.length<=count);
  for(const line of lines){assert(points.has(line.start)&&points.has(line.end));assert.equal(text.slice(line.start,line.end),line.text);assert(labelWidth(line.text,16)<=width+1e-8||[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(line.text)].length===1);}
  assert.equal(lines.map(line=>line.text).join(''),text);
 }
});
