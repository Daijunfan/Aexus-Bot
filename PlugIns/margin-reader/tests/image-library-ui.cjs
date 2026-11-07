'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {createCanvas}=require('@napi-rs/canvas'),{PDFDocument,StandardFonts}=require('pdf-lib');
const {create,expect}=require('./ui-session.cjs'),{clickTool}=require('./read-map-actions.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const canvas=createCanvas(480,320),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(480,320);let seed=173;
 for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+c]=seed>>>24;}pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);ctx.fillStyle='#dc4738';ctx.fillRect(100,90,280,40);
 const pdf=await PDFDocument.create(),image=await pdf.embedPng(await canvas.encode('png')),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let n=1;n<=12;n++){const page=pdf.addPage([612,792]);page.drawText('IMAGE SOURCE '+n,{x:64,y:740,size:20,font});page.drawImage(image,{x:60,y:280,width:492,height:328});}
 return Buffer.from(await pdf.save());
}
(async()=>{
 const f=await create('image-library'),{api,page,pass}=f;let failure;
 f.report.workload={kind:'synthetic raster PDF crops',captures:105,pdfPages:12,modelCalls:0,metrics:{},limitations:['short isolated workload, not long-duration image pressure','no physical stylus or visible native-window scheduling']};
 const metrics=f.report.workload.metrics;
 try{
  const original=await fixture();await fs.writeFile(path.join(f.workspace,'image-source.pdf'),original);
  let set=await api('study.create',{title:'Image excerpt library'});
  const refresh=async()=>set=await api('study.get',{setId:set.id});
  const change=async(method,params={})=>{await refresh();return set=await api(method,{setId:set.id,expectedRevision:set.revision,...params});};
  await change('study.documents.add',{paths:['image-source.pdf']});await change('study.note.create',{title:'Image library root'});const root=set.cards[0].id;
  await change('study.mindmap.configure',{patch:{enabled:true,structure:'logic-right',motion:false,showImages:true}});
  const doc=await api('document.open',{path:'image-source.pdf',activate:false}),ids=[];let captureBytes=0,decodedPixels=0;
  const captureStart=performance.now();
  for(let i=0;i<105;i++){
   const number=i%12+1,result=await api('study.card.create',{setId:set.id,expectedRevision:set.revision,documentId:doc.id,expectedSourceVersion:doc.sourceVersion,captureId:randomUUID(),title:'Raster '+String(i).padStart(3,'0'),text:'',color:'yellow',parentId:root,locator:{page:number},selection:{rects:[{page:number,x:.1,y:.22,width:.8,height:.45}]}});
   set.revision=result.revision;ids.push(result.card.id);assert.equal(result.card.image.kind,'pdf-crop');assert(result.card.image.width>500&&result.card.image.height>500);
   decodedPixels+=result.card.image.width*result.card.image.height;
   const image=await api('study.card.image',{setId:set.id,cardId:result.card.id});captureBytes+=Buffer.from(image.contentBase64,'base64').length;
  }
  metrics.captureTotalMs=+(performance.now()-captureStart).toFixed(2);
  f.report.workload.captureBytes=captureBytes;f.report.workload.decodedPixels=decodedPixels;assert(captureBytes>8*1024*1024);
  assert.equal(new Set(ids).size,105);await refresh();assert.equal(set.cards.length,106);
  const target=set.cards.find(c=>c.id===ids.at(-1)),beforeImage=hash(Buffer.from((await api('study.card.image',{setId:set.id,cardId:target.id})).contentBase64,'base64')),beforeSource=structuredClone(target.source);
  await api('study.open',{setId:set.id});const ready=performance.now();await page.goto(f.server.url);await page.locator('body[data-ready=true]').waitFor();metrics.uiReadyMs=+(performance.now()-ready).toFixed(2);
  const geometry=await api('study.map.geometry',{setId:set.id});assert.equal(geometry.positions.length,106);assert.deepEqual(new Set(geometry.positions.map(p=>p.cardId)),new Set(set.cards.map(c=>c.id)));
  pass('105 real raster PDF crops retain every card and full-model geometry without using a personal library');
  const open=performance.now();await page.click('#study-boards');await expect(page.locator('.board-card')).toHaveCount(100);metrics.databaseOpenMs=+(performance.now()-open).toFixed(2);
  await page.click('#board-select-page');await expect(page.locator('#board-selected')).toHaveText('已选择 100 张卡片');const next=performance.now();await page.click('#board-next');await expect(page.locator('.board-card')).toHaveCount(6);metrics.databaseNextPageMs=+(performance.now()-next).toFixed(2);
  await expect(page.locator('#board-status')).toHaveText('106 张卡片 · 当前 101–106');await page.click('#board-select-page');await expect(page.locator('#board-selected')).toHaveText('已选择 106 张卡片');
  await page.locator(`[data-board-edit="${set.id+'/'+target.id}"]`).click();await page.locator('#board-editor [name=editText]').fill('Image display transcription');await page.locator('#board-editor [name=editNote]').fill('Image source note');await page.click('#board-edit-save');await expect(page.locator('#board-editor')).toBeHidden();
  await page.click('#board-select-all');await expect(page.locator('#board-selected')).toHaveText('已选择 106 张卡片');await page.click('#board-batch');await page.locator('#dialog [name=addTags]').fill('image-all-pages');await page.click('#dialog-submit');await expect(page.locator('#dialog')).toBeHidden();
  await refresh();assert(set.cards.every(c=>c.tags.includes('image-all-pages')));assert.equal(set.cards.find(c=>c.id===target.id).editedText,'Image display transcription');assert.deepEqual(set.cards.find(c=>c.id===target.id).source,beforeSource);
  assert.equal(hash(Buffer.from((await api('study.card.image',{setId:set.id,cardId:target.id})).contentBase64,'base64')),beforeImage);
  pass('Image-heavy pagination, inline transcription and all-result batch editing preserve original crops and exact source anchors');
  const sourceStart=performance.now();await page.locator(`[data-board-card="${set.id+'/'+target.id}"]`).click();await expect(page.locator('#study-database')).toBeHidden();await expect(page.locator('#document-path')).toHaveText('image-source.pdf');
  const mark=page.locator(`.pdf-page[data-page="${target.source.locator.page}"] .study-mark[data-card-id="${target.id}"]`).first();
  await expect(page.locator('#reader-scroll')).toHaveAttribute('aria-busy','false');
  f.report.workload.sourceSettings=await api('settings.get');
  await expect.poll(async()=>{
   const measured=await mark.evaluate(el=>{const scroller=document.getElementById('reader-scroll'),r=el.getBoundingClientRect(),v=scroller.getBoundingClientRect(),paper=el.closest('.pdf-page');return {mark:r.toJSON(),viewport:v.toJSON(),paper:paper.getBoundingClientRect().toJSON(),scrollTop:scroller.scrollTop,scrollLeft:scroller.scrollLeft,clientWidth:scroller.clientWidth,clientHeight:scroller.clientHeight,scrollWidth:scroller.scrollWidth,scrollHeight:scroller.scrollHeight,busy:scroller.getAttribute('aria-busy')};});
   f.report.workload.sourceViewport=measured;const {mark:r,viewport:v}=measured;
   return r.width>0&&r.height>0&&r.top>=v.top&&r.bottom<=v.bottom&&r.left>=v.left&&r.right<=v.right;
  }).toBe(true);metrics.sourceReturnMs=+(performance.now()-sourceStart).toFixed(2);
  assert.equal((await api('reader.position.get',{id:doc.id})).locator.page,target.source.locator.page);
  pass('The last image excerpt on the second database page returns to its fully visible original PDF region');
  await change('study.view.set',{view:'map'});await page.reload();await page.locator('body[data-ready=true]').waitFor();await page.click('#study-map-scale');
  const element=page.locator(`.study-card[data-card-id="${target.id}"]`),image=element.locator('img');
  const offscreen=await image.boundingBox(),viewport=await page.locator('#study-map-viewport').boundingBox();assert(offscreen&&viewport);
  await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);await page.mouse.wheel(offscreen.x+offscreen.width/2-viewport.x-viewport.width/2,offscreen.y+offscreen.height/2-viewport.y-viewport.height/2);
  await expect.poll(()=>image.evaluate(el=>{const r=el.getBoundingClientRect(),v=document.getElementById('study-map-viewport').getBoundingClientRect();return Math.abs(r.x+r.width/2-v.x-v.width/2)<2&&Math.abs(r.y+r.height/2-v.y-v.height/2)<2;})).toBe(true);
  assert.equal(Boolean((await refresh()).map.focusId),false);await expect(image).toBeInViewport();await expect.poll(()=>image.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
  await clickTool(page,'card-ink-pen');const box=await image.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.55,{steps:12});await page.mouse.up();
  await expect.poll(async()=>((await refresh()).cards.find(c=>c.id===target.id).ink||[]).length).toBe(1);await clickTool(page,'card-ink-pen');const ink=structuredClone(set.cards.find(c=>c.id===target.id).ink[0]);assert.equal(ink.imageBound,true);
  await change('study.mindmap.topics.update',{cardIds:[target.id],patch:{shape:'ellipse',width:330}});await expect(element).toHaveAttribute('data-topic-shape','ellipse');await expect(element.locator('[data-card-stroke]')).toHaveCount(1);assert.deepEqual((await refresh()).cards.find(c=>c.id===target.id).ink[0],ink);
  await page.reload();await page.locator('body[data-ready=true]').waitFor();await expect(element.locator('[data-card-stroke]')).toHaveCount(1);await refresh();assert.equal(set.cards.length,106);assert.deepEqual(set.cards.find(c=>c.id===target.id).ink[0],ink);assert.deepEqual(await fs.readFile(path.join(f.workspace,'image-source.pdf')),original);
  assert.equal(hash(Buffer.from((await api('study.card.image',{setId:set.id,cardId:target.id})).contentBase64,'base64')),beforeImage);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(f.output,'image-library-ink.png')});pass('A physical headless pointer stroke stays image-bound after shape changes and reopening, with the crop and original PDF unchanged');
  await page.click('#study-boards');await expect(page.locator('.board-card')).toHaveCount(100);
  await expect.poll(()=>page.locator('#study-map-world img[src]').evaluateAll(images=>images.every(image=>image.complete))).toBe(true);
  const stalledContext=await f.context.browser().newContext({viewport:{width:1520,height:1000}}),stalled=await stalledContext.newPage(),readAsset=f.server.runtime.readAsset.bind(f.server.runtime);
  stalled.on('pageerror',error=>f.report.browserErrors.push(error.message));stalled.setDefaultTimeout(15000);
  let release,started=0;const gate=new Promise(resolve=>{release=resolve;});
  f.server.runtime.readAsset=async asset=>{if(asset.startsWith('study-card/')){const number=++started;await gate;if(number===4)throw Error('Injected screenshot response failure');}return readAsset(asset);};
  try{
   await stalled.goto(f.server.url,{waitUntil:'domcontentloaded'});await stalled.locator('body[data-ready=true]').waitFor();
   await expect.poll(()=>started).toBe(3);await expect(stalled.locator('#study-map-world img[src]')).toHaveCount(3);await expect(stalled.locator('#study-map-world img[data-map-image]')).toHaveCount(102);
   const open=performance.now();await stalled.click('#study-boards');await expect(stalled.locator('.board-card')).toHaveCount(100);metrics.databaseWithImagesHeldMs=+(performance.now()-open).toFixed(2);
   await stalled.click('#board-select-page');await stalled.click('#board-next');await expect(stalled.locator('.board-card')).toHaveCount(6);await stalled.click('#board-select-page');await expect(stalled.locator('#board-selected')).toHaveText('已选择 106 张卡片');
   assert.equal(started,3);release();
   await expect.poll(()=>stalled.locator('#study-map-world img[src]').evaluateAll(images=>images.filter(image=>image.complete&&image.naturalWidth>0).length)).toBe(3);
   await stalled.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(started,3);await expect(stalled.locator('#study-map-world img[data-map-image]')).toHaveCount(102);
   const resumed=performance.now();await stalled.click('#board-close');await expect(stalled.locator('#study-database')).toBeHidden();
   await expect.poll(()=>started).toBeGreaterThan(3);
   await expect.poll(()=>stalled.locator('#study-map-world img').evaluateAll(images=>{const view=document.getElementById('study-map-viewport').getBoundingClientRect();return images.every(image=>{if(!image.dataset.mapImage)return image.complete;const r=image.getBoundingClientRect();return r.bottom<view.top-240||r.top>view.bottom+240||r.right<view.left-240||r.left>view.right+240;});})).toBe(true);
   await expect(stalled.locator('#study-map-world img[data-map-image]')).not.toHaveCount(0);
   await stalled.click('#study-zoom-fit');
   await expect.poll(()=>started,{timeout:15000}).toBe(105);await expect(stalled.locator('#study-map-world img[data-map-image]')).toHaveCount(0);
   await expect.poll(()=>stalled.locator('#study-map-world img').evaluateAll(images=>images.filter(image=>image.complete&&image.naturalWidth>0).length),{timeout:15000}).toBe(104);metrics.resumedImageLoadMs=+(performance.now()-resumed).toFixed(2);
   await expect.poll(()=>stalled.locator('#study-map-world img').evaluateAll(images=>images.filter(image=>image.complete&&!image.naturalWidth).length)).toBe(1);
   await stalled.reload();await stalled.locator('body[data-ready=true]').waitFor();await stalled.click('#study-zoom-fit');await expect.poll(()=>stalled.locator('#study-map-world img').evaluateAll(images=>images.filter(image=>image.complete&&image.naturalWidth>0).length),{timeout:15000}).toBe(105);
   pass('Three held screenshots leave database pagination and cross-page selection usable; close resumes nearby images, fit loads the full map, image failure frees its slot and reopening restores every image');
  }catch(error){
   f.report.workload.imageScheduler={started,...await stalled.evaluate(()=>{const view=document.getElementById('study-map-viewport');return {viewport:view.getBoundingClientRect().toJSON(),camera:{...view.dataset},world:document.getElementById('study-map-world').getBoundingClientRect().toJSON(),images:[...document.querySelectorAll('#study-map-world img')].map(image=>({cardId:image.closest('.study-card').dataset.cardId,deferred:Boolean(image.dataset.mapImage),complete:image.complete,naturalWidth:image.naturalWidth,rect:image.getBoundingClientRect().toJSON()}))};})};
   await stalled.screenshot({path:path.join(f.output,'image-scheduler-failure.png')});throw error;
  }finally{release();f.server.runtime.readAsset=readAsset;await stalledContext.close();}
 }catch(error){failure=error;}await f.finish(failure);
})().catch(error=>{console.error(error);process.exitCode=1;});
