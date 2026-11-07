'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rasterScale}=require('../lib/svg-raster-scale.cjs');
function node(localName,attrs={},parentNode=null){return {localName,nodeType:1,parentNode,getAttribute:key=>Object.hasOwn(attrs,key)?String(attrs[key]):null};}
const root=attrs=>node('svg',{width:400,height:200,viewBox:'0 0 400 200',...attrs});
const near=(actual,expected)=>assert(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-12,`${actual} != ${expected}`);

test('MathJax Chinese local 884px glyphs use the actual 40×19 viewport density',()=>{
 const equation=node('svg',{width:40,height:19,viewBox:'0 -750 2000 950'},root());
 const group=node('g',{transform:'scale(1,-1)'},equation),first=node('text',{transform:'scale(1,-1)','font-size':'884px'},group),second=node('text',{transform:'translate(1000,0) scale(1,-1)'},group);
 near(rasterScale(first,2),.04);near(rasterScale(second,2),.04);near(884*rasterScale(first,2),35.36);
 assert.deepEqual(Object.keys(first),['localName','nodeType','parentNode','getAttribute']);
});

test('nested meet, slice and none viewports use their correct density without applying root scale twice',()=>{
 const outer=root({width:800,height:400});
 near(rasterScale(node('text',{},outer),2),2);
 for(const [aspect,expected]of [['xMidYMid meet',1],['xMaxYMin slice',2],['none',2]]){
  const viewport=node('svg',{width:200,height:100,viewBox:'0 0 100 100',preserveAspectRatio:aspect},outer);
  near(rasterScale(node('text',{},viewport),2),expected*2);
 }
});

test('full matrix composition handles rotated anisotropy and skew rather than multiplying separate maxima',()=>{
 const group=node('g',{transform:'translate(200,300) scale(2 1) rotate(90) scale(3 1)'},root());
 near(rasterScale(node('text',{},group),1),3);
 const shear=node('text',{transform:'matrix(1 0 1 1 40 -50)'},root());
 near(rasterScale(shear,2),1+Math.sqrt(5));
 near(rasterScale(node('text',{transform:'skewX(45)'},root()),1),(1+Math.sqrt(5))/2);
 near(rasterScale(node('text',{transform:'rotate(30 250 100) scale(-2 3)'},root()),1),3);
});

test('nested percentages resolve against the nearest viewport viewBox in user units',()=>{
 const first=node('svg',{width:'50%',height:'100%',viewBox:'0 0 100 100'},root());
 const second=node('svg',{width:'50%',height:'100%',viewBox:'0 0 10 10'},first);
 near(rasterScale(node('text',{},second),2),20);
 const scaled=node('svg',{width:200,height:100,viewBox:'0 0 100 100',transform:'scale(3)'},root());
 near(rasterScale(node('text',{},scaled),2),6);
});

test('inline transform precedence and zero-area transforms preserve rendering semantics',()=>{
 near(rasterScale(node('text',{transform:'scale(9)',style:'fill: red; transform: scale(.5);'},root()),2),1);
 assert.equal(rasterScale(node('text',{transform:'scale(0 4)'},root()),2),0);
 assert.equal(rasterScale(node('text',{},node('svg',{width:0,height:100,viewBox:'0 0 100 100'},root())),2),0);
 assert.equal(rasterScale(node('text',{},node('svg',{width:100,height:100,viewBox:'0 0 0 100'},root())),2),0);
});

test('unsupported coordinates, unresolved percentages and nonfinite/deep transforms fail before raster allocation',()=>{
 for(const transform of ['scale(NaN)','scale(1,,2)','matrix(1 0 0 1)','translate(2) unparsed','matrix3d(1)'])assert.throws(()=>rasterScale(node('text',{transform},root()),1),error=>error.code==='EXPORT_FAILED');
 assert.throws(()=>rasterScale(node('text',{transform:'scale(1e308) scale(1e308)'},root()),1),error=>error.code==='TOO_LARGE');
 assert.throws(()=>rasterScale(node('text',{},node('svg',{width:'50%',height:100,viewBox:'0 0 10 10'},node('svg'))),1),error=>error.code==='EXPORT_FAILED');
 assert.throws(()=>rasterScale(node('text',{},root()),Infinity),error=>error.code==='INVALID_PARAMS');
 let deep=root();for(let i=0;i<256;i++)deep=node('g',{},deep);
 assert.throws(()=>rasterScale(deep,1),error=>error.code==='TOO_LARGE');
});
