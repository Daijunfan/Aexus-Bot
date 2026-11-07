'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {setup}=require('./fixtures.cjs');
const {createCanvas}=require('@napi-rs/canvas');

async function imageFixture(t,count=1){
 const f=await setup(t);let set=await f.api('study.create',{title:'Scoped image export'});
 const change=async(method,params={})=>set=await f.api(method,{setId:set.id,expectedRevision:set.revision,...params});
 await change('study.note.create',{title:'Selected branch'});const root=set.cards[0].id;
 const canvas=createCanvas(32,24),ctx=canvas.getContext('2d');ctx.fillStyle='#126baf';ctx.fillRect(0,0,32,24);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,8,8);
 const contentBase64=(await canvas.encode('png')).toString('base64'),inside=[];
 for(let i=0;i<count+1;i++){
  await change('study.media.import',{kind:'image',title:i<count?'Selected image '+i:'Unrelated image',contentBase64});
  const id=set.lastMedia.cardId;
  if(i<count){inside.push(id);await change('study.card.move',{cardId:id,parentId:root,index:i});}
 }
 await change('study.mindmap.configure',{patch:{showImages:true}});
 const outside=set.cards.find(c=>c.title==='Unrelated image');
 return {...f,root,inside,outside,change,get set(){return set;}};
}

test('branch and visible exports never read unrelated or collapsed image assets',async t=>{
 const f=await imageFixture(t),bad=path.join(f.workspace,'.margin-reader',f.outside.imageAsset);
 // This is an intentionally damaged attachment in an isolated test workspace.
 // Selected source bytes remain intact; no user file is read or modified.
 await fs.writeFile(bad,Buffer.from('damaged test attachment'));
 const initial=await f.api('study.get',{setId:f.set.id});
 const branch=await f.api('study.mindmap.export',{setId:f.set.id,expectedRevision:f.set.revision,format:'svg',path:'branch.svg',scope:'all',rootId:f.root});
 assert.equal(branch.topics,2);assert.equal(branch.images,1);
 const svg=await fs.readFile(path.join(f.workspace,'branch.svg'),'utf8');
 assert(svg.includes('topic-'+f.inside[0]));assert(!svg.includes('topic-'+f.outside.id));assert(svg.includes('data:image/png;base64,'));
 assert.deepEqual(await f.api('study.get',{setId:f.set.id}),initial);
 await f.error('study.mindmap.export',{setId:f.set.id,expectedRevision:f.set.revision,format:'svg',path:'full.svg'},'ASSET_CORRUPT');
 assert.equal(await fs.stat(path.join(f.workspace,'full.svg')).catch(()=>null),null);
 await f.change('study.card.update',{cardId:f.root,collapsed:true});
 const visible=await f.api('study.mindmap.export',{setId:f.set.id,expectedRevision:f.set.revision,format:'svg',path:'visible.svg',scope:'visible',rootId:f.root});
 assert.equal(visible.topics,1);assert.equal(visible.images,0);
 const noImages=await f.api('study.mindmap.export',{setId:f.set.id,expectedRevision:f.set.revision,format:'svg',path:'no-images.svg',includeImages:false});
 assert.equal(noImages.images,0);assert.equal(noImages.topics,3);
});

test('selected image byte budget still rejects atomically after scope resolution',async t=>{
 const f=await imageFixture(t,5),capture=require('../lib/study-capture.cjs'),calls=[];
 // Inject only the public reader's byte result to exercise the aggregate budget
 // without generating a photographic 35 MiB fixture. Each simulated read is
 // below the existing per-excerpt 8 MiB limit.
 const bytes=Buffer.alloc(7*1024*1024);
 t.mock.method(capture,'cardImage',async(store,setId,cardId)=>{calls.push(cardId);return {bytes};});
 await f.error('study.mindmap.export',{setId:f.set.id,expectedRevision:f.set.revision,format:'svg',path:'too-large.svg',rootId:f.root},'TOO_LARGE');
 assert.deepEqual(calls,f.inside);assert(!calls.includes(f.outside.id));
 assert.equal(await fs.stat(path.join(f.workspace,'too-large.svg')).catch(()=>null),null);
 assert.equal((await f.api('study.get',{setId:f.set.id})).revision,f.set.revision);
});
