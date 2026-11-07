'use strict';
const assert=require('node:assert/strict');
const {create,expect}=require('./ui-session.cjs');
const {webkit}=require('../../../node_modules/@playwright/test');

(async()=>{
 const useWebKit=process.env.MR_WEBKIT_TEST==='1';
 const f=await create(useWebKit?'map-select-paint-webkit':'map-select-paint-chromium');
 let browser,error;
 const page=useWebKit?await(browser=await webkit.launch({headless:true})).newPage({viewport:{width:1520,height:1000}}):f.page;
 const instrument=async()=>{
  await page.locator('body[data-ready=true]').waitFor();
  await page.evaluate(async()=>{
   const {MapCamera}=await import(new URL('./map-camera.mjs',document.querySelector('script[type="module"]').src));
   const original=MapCamera.prototype.paint;
   window.__mapPaints=0;
   MapCamera.prototype.paint=function(...args){window.__mapPaints++;return original.apply(this,args);};
  });
  await page.waitForTimeout(400);
  await page.evaluate(()=>{window.__mapPaints=0;});
 };
 const count=()=>page.evaluate(()=>window.__mapPaints);
 try{
  let set=await f.api('study.create',{title:'Selection redraw regression'});
  set=await f.api('study.mindmap.outline.import',{
   setId:set.id,expectedRevision:set.revision,
   text:'Center\n  First branch\n    First note\n  Second branch\n    Second note\n  Third branch\n    Third note'
  });
  assert.equal(set.canvasInk?.length||0,0);
  await f.api('study.open',{setId:set.id});
  await page.goto(f.server.url);
  await instrument();
  const card=page.locator('.study-card[data-card-id]').nth(1),id=await card.getAttribute('data-card-id');
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveClass(/selected/);
  assert.equal(await count(),0,'Selecting an ink-free card must not repaint the full camera');
  f.pass('Ink-free topic selection updates visual focus without repainting the map camera');
  assert.equal((await f.api('study.get',{setId:set.id})).revision,set.revision);
  f.pass('Topic selection does not persist a study revision');

  const geom=await f.api('study.map.geometry',{setId:set.id});
  const p=geom.positions.find(v=>v.cardId===id);
  assert(p,'Selected topic must have geometry');
  set=await f.api('study.map.ink.add',{
   setId:set.id,expectedRevision:set.revision,
   points:[[p.x+p.width*.2,p.y+p.height*.5],[p.x+p.width*.8,p.y+p.height*.5]],color:'blue'
  });
  assert(set.canvasInk?.length||set.cards.some(c=>c.ink?.some(s=>!s.imageBound)),'Ink should be stored on the map');
  await f.api('study.open',{setId:set.id});
  await page.reload();
  await instrument();
  const withInk=page.locator('.study-card[data-card-id]').nth(1);
  await withInk.click();
  await expect(withInk).toHaveClass(/selected/);
  assert((await count())>0,'Selecting with map ink must recompute and repaint ink extent');
  f.pass('Map ink retains the selection-dependent extent repaint path after the study changes');
  assert.equal((await f.api('study.get',{setId:set.id})).revision,set.revision);
  f.pass('Ink-visible selection still avoids revision writes');
 }catch(e){error=e;}finally{await browser?.close();await f.finish(error);}
})().catch(e=>{console.error(e);process.exitCode=1;});
