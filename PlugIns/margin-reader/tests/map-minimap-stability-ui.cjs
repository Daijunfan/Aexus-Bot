'use strict';
const assert=require('node:assert/strict');
const {create,expect}=require('./ui-session.cjs');
const {webkit}=require('../../../node_modules/@playwright/test');
(async()=>{
 const native=process.env.MR_WEBKIT_TEST==='1',f=await create(native?'map-minimap-webkit':'map-minimap-chromium');let browser,failure;
 const page=native?await(browser=await webkit.launch({headless:true})).newPage({viewport:{width:1520,height:1000}}):f.page;
 const camera=()=>page.locator('#study-map-viewport').evaluate(v=>({x:+v.dataset.cameraX,y:+v.dataset.cameraY,z:+v.dataset.cameraZoom}));
 const near=(a,b)=>assert(Math.abs(a-b)<.1,`${a} differs from ${b}`);
 try{
  let set=await f.api('study.create',{title:'Minimap camera interactions'});
  set=await f.api('study.mindmap.outline.import',{setId:set.id,expectedRevision:set.revision,text:'Center\n  Research\n    Source\n  Notes\n    Draft\n  Design\n    Review'});
  await f.api('study.open',{setId:set.id});await page.goto(f.server.url);await page.locator('body[data-ready=true]').waitFor();
  const mini=page.locator('#mindmap-overview'),svg=mini.locator('svg');await expect(mini).toBeVisible();await page.click('#study-zoom-fit');
  const box=await svg.boundingBox(),before=await camera(),x=box.x+box.width*.37,y=box.y+box.height*.32;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y+18,{steps:4});
  const moved=await camera();assert(Math.hypot(moved.x-before.x,moved.y-before.y)>15,'Minimap drag should move the camera');
  await page.keyboard.press('Escape');await page.mouse.move(x+60,y+20,{steps:3});await page.mouse.up();
  const cancelled=await camera();near(cancelled.x,before.x);near(cancelled.y,before.y);near(cancelled.z,before.z);
  f.pass('Escape cancels a held minimap drag and subsequent motion cannot move the restored camera');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+10,{steps:3});
  await svg.evaluate(node=>node.parentElement.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'})));
  await page.mouse.move(x+60,y+20,{steps:3});await page.mouse.up();
  const pointerCancelled=await camera();near(pointerCancelled.x,before.x);near(pointerCancelled.y,before.y);
  f.pass('Pointer cancellation releases minimap dragging and restores the previous view');
  await page.mouse.click(x,y,{button:'right'});const right=await camera();near(right.x,before.x);near(right.y,before.y);
  f.pass('Secondary click does not pan the overview');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y+12,{steps:3});await page.mouse.up();
  const complete=await camera();assert(Math.hypot(complete.x-before.x,complete.y-before.y)>10);
  const rect=await svg.locator('.mm-overview-window').evaluate(el=>({x:+el.getAttribute('x'),y:+el.getAttribute('y'),width:+el.getAttribute('width'),height:+el.getAttribute('height')}));
  const view=await page.locator('#study-map-viewport').evaluate(v=>({width:v.clientWidth,height:v.clientHeight}));
  near(rect.x,-complete.x/complete.z);near(rect.y,-complete.y/complete.z);near(rect.width,view.width/complete.z);near(rect.height,view.height/complete.z);
  assert.equal((await f.api('study.get',{setId:set.id})).revision,set.revision);
  f.pass('Completed minimap drag maintains an accurate visible-area rectangle without editing topic data');
 }catch(e){failure=e;}finally{await browser?.close();await f.finish(failure);}
})().catch(e=>{console.error(e);process.exitCode=1;});
