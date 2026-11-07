'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {svgDocument}=require('../lib/mindmap-export.cjs');

function fixture(){
 return {id:'study',revision:7,title:'中文分支导出',colors:{},layers:[],cards:[
  {id:'root',parentId:null,title:'阅读 · Root',collapsed:true,source:{documentId:'source',locator:{page:3}}},
  {id:'child',parentId:'root',title:'👨‍👩‍👧‍👦 家庭与原文',submap:true},
  {id:'leaf',parentId:'child',title:'🇨🇳 e\u0301 完整内容',inMap:false},
  {id:'other',parentId:null,title:'Unrelated branch'}
 ],links:[{id:'source-link',from:'root',to:'leaf',label:'来源依据'}],map:{focusId:'other',submapId:'other',mindmap:{enabled:true,showSources:true}}};
}

test('all branch export expands collapsed, submap and hidden descendants without changing source data',async()=>{
 const set=fixture(),before=structuredClone(set),result=await svgDocument(set,{scope:'all',rootId:'root'});
 assert.equal(result.topics,3);
 for(const id of ['root','child','leaf'])assert(result.svg.includes('id="topic-'+id+'"'));
 assert(!result.svg.includes('id="topic-other"'));
 assert(result.svg.includes('margin-reader://card/study/root'));
 assert(result.svg.includes('data-association-id="source-link"'));
 assert(result.svg.includes('👨‍👩‍👧‍👦'));assert(result.svg.includes('🇨🇳'));
 assert.deepEqual(set,before);
});

test('visible branch export preserves collapse while default all scope preserves all IDs',async()=>{
 const set=fixture(),visible=await svgDocument(set,{scope:'visible',rootId:'root'}),all=await svgDocument(set);
 assert.equal(visible.topics,1);assert.equal(all.topics,set.cards.length);
 for(const card of set.cards)assert(all.svg.includes('id="topic-'+card.id+'"'));
 assert(!visible.svg.includes('data-association-id="source-link"'));
});

test('canvas ink and its bounds follow export scope instead of the current UI focus',async()=>{
 const set=fixture();set.layers=[{id:'default',visible:true}];set.map.focusId='root';set.map.submapId=null;
 set.canvasInk=[{id:'far-canvas-ink',points:[[2000,2000],[2100,2100]],color:'#aa2255',width:4}];
 const before=structuredClone(set),all=await svgDocument(set,{scope:'all'});
 assert.equal(all.inkStrokes,1);assert(all.svg.includes('#aa2255'));
 assert(all.width>=2132&&all.height>=2132,'the full export must contain the entire far canvas stroke');
 for(const options of [{scope:'all',rootId:'root'},{scope:'visible'},{scope:'visible',rootId:'root'}]){
  const branch=await svgDocument(set,options);
  assert.equal(branch.inkStrokes,0);assert(!branch.svg.includes('#aa2255'));
  assert(branch.width<2000&&branch.height<2000,'a focused branch must not inherit unrelated canvas bounds');
 }
 assert.deepEqual(set,before);
});

test('card ink visibility and bounds agree for hidden map ink, focused ink and hidden layers',async()=>{
 const set=fixture();set.layers=[{id:'default',visible:true},{id:'private',visible:false}];
 set.map.focusId='root';set.map.submapId=null;set.inkBinding={hideFocusInk:true};
 const stroke=(id,color,extra={})=>({id,color,points:[[.2,.2],[.8,.8]],width:.02,...extra});
 set.cards[0].ink=[stroke('focus','#112233',{focusBound:true}),stroke('front','#223344',{reviewSide:'front'}),stroke('layer','#334455',{layerId:'private'})];
 set.cards[1].ink=[stroke('child-hidden','#445566',{mapHidden:true})];
 const all=await svgDocument(set,{scope:'all'}),branch=await svgDocument(set,{scope:'all',rootId:'root'});
 assert.equal(all.inkStrokes,0);assert.equal(branch.inkStrokes,1);
 assert(branch.svg.includes('#112233'));
 for(const color of ['#223344','#334455','#445566'])assert(!branch.svg.includes(color));
});
