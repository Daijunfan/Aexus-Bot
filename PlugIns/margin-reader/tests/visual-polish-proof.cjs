'use strict';
// Reproducible, self-authored visual evidence. No runtime or user library opens.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {svgDocument}=require('../lib/mindmap-export.cjs');
const {rasterizeSvg}=require('../lib/svg-raster-text.cjs');

async function main(){
 const directory=path.resolve(process.argv[2]||path.join(__dirname,'../artifacts/visual-polish'));
 await fs.mkdir(directory,{recursive:true});
 const set={id:'visual-proof',revision:1,title:'MarginReader · 来源与脑图',colors:{},layers:[],cards:[
  {id:'root',parentId:null,title:'MarginReader\n阅读 → 组织 → 回到原文',collapsed:true,source:{documentId:'proof',locator:{page:3}},mindmap:{width:280}},
  {id:'family',parentId:'root',title:'👨‍👩‍👧‍👦 家庭情境\n完整的图形字符，保留在同一行。',submap:true,mindmap:{width:210}},
  {id:'flags',parentId:'family',title:'🇨🇳 🇺🇸 🇯🇵\n跨语言阅读与来源定位',inMap:false,mindmap:{width:170}},
  {id:'accents',parentId:'root',title:'cafe\u0301 · nai\u0308ve\n组合音标随字母移动',mindmap:{width:180}},
  {id:'english',parentId:'root',title:'Source-linked knowledge\nLong English words: antidisestablishmentarianism',mindmap:{width:200}},
  {id:'chinese',parentId:'root',title:'长中文标题的真实换行：摘录、结构与复习共享同一份来源，不丢失卡片身份。',mindmap:{width:180}},
  {id:'outside',parentId:null,title:'非目标分支\n仅全图导出包含本卡片',mindmap:{width:200}}
 ],links:[{id:'evidence',from:'family',to:'flags',label:'来源关联',mindmap:{line:'straight',color:'#536da8'}}],map:{mindmap:{enabled:true,structure:'logic-right',theme:'business',showSources:true,spacing:28,branchSpacing:72}}};
 const before=JSON.stringify(set),report={selfAuthoredFixture:true,productionRasterPath:true,node:process.version,platform:process.platform,arch:process.arch,outputs:[],structuralChecks:'passed',pixelChecks:'not-run',visualReview:'pending',overall:'generated-awaiting-review'};
 for(const [name,options,expected] of [['complete-branch',{scope:'all',rootId:'root'},6],['visible-branch',{scope:'visible',rootId:'root'},1],['complete-map',{scope:'all'},7]]){
  const result=await svgDocument(set,options);assert.equal(result.topics,expected);
  if(name==='complete-branch')assert(!result.svg.includes('id="topic-outside"'));
  const scale=Math.min(1.5,2400/result.width,2400/result.height),entry={name,topics:result.topics,width:result.width,height:result.height,sourceLink:result.svg.includes('margin-reader://card/visual-proof/root')};
  await fs.writeFile(path.join(directory,name+'.svg'),result.svg);
  try{
   const started=performance.now(),raster=await rasterizeSvg({...result,scale});
   await fs.writeFile(path.join(directory,name+'.png'),raster.bytes);
   const {bytes,...details}=raster;report.outputs.push({...entry,status:'generated',...details,renderMs:performance.now()-started});
  }catch(error){
   await fs.rm(path.join(directory,name+'.png'),{force:true});
   report.outputs.push({...entry,status:'failed',error:{code:error.code||'EXPORT_FAILED',message:error.message}});report.overall='failed';
  }
 }
 assert.equal(JSON.stringify(set),before);
 await fs.writeFile(path.join(directory,'proof.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,...report},null,2));
 if(report.overall==='failed')process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
