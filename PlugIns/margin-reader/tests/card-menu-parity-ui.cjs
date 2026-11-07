'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{create,expect}=require('./ui-session.cjs'),{pdfFixture}=require('./fixtures.cjs');
const {webkit}=require('../../../node_modules/@playwright/test');

(async()=>{
 const native=process.env.MR_WEBKIT_TEST==='1';
 const f=await create(native?'card-menu-webkit':'card-menu-chromium');
 const {api,workspace,pass}=f;
 let browser,failure;
 const page=native?await(browser=await webkit.launch({headless:true})).newPage({viewport:{width:1100,height:800}}):f.page;
 try{
  await fs.writeFile(path.join(workspace,'original.pdf'),pdfFixture());
  let set=await api('study.create',{title:'Menu workflow'});
  set=await api('study.documents.add',{setId:set.id,expectedRevision:set.revision,paths:['original.pdf']});
  const document=await api('document.open',{path:'original.pdf',activate:false});
  const part=(captureId,pageNumber)=>({
   documentId:document.id,expectedSourceVersion:document.sourceVersion,captureId,
   text:'',locator:{page:pageNumber},
   selection:{rects:[{page:pageNumber,x:.13,y:.11,width:.5,height:.13}]}
  });
  const created=await api('study.card.create',{
   setId:set.id,expectedRevision:set.revision,title:'Key point',color:'yellow',...part(randomUUID(),1)
  });
  set=await api('study.get',{setId:set.id});
  await api('study.excerpt.append',{
   setId:set.id,cardId:created.card.id,expectedRevision:set.revision,...part(randomUUID(),2)
  });
  set=await api('study.get',{setId:set.id});
  set=await api('study.view.set',{setId:set.id,expectedRevision:set.revision,view:'map'});
  await api('study.open',{setId:set.id});
  await page.goto(f.server.url);
  await page.locator('body[data-ready=true]').waitFor();
  await expect(page.locator('#study-map-viewport')).toBeVisible();
  const topic=page.locator('.study-card[data-card-id="'+created.card.id+'"]');
  await expect(topic).toBeVisible();
  await topic.click();
  await topic.locator('.study-card-more').click();
  const menu=page.locator('.study-card-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.study-menu-group')).toHaveCount(4);
  for(const item of ['source','preview','inspector','edit','child','format',
                     'parts','image','emphasis','generate-review','occlude','review',
                     'links','focus','remove']){
   assert.equal(await menu.locator('[data-action="'+item+'"]').count(),1,
    'Existing '+item+' handler should have a discoverable menu entry');
  }
  pass('The existing source-card actions are discoverable and grouped without adding new features');

  const buttons=menu.locator('[role=menuitem]');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(buttons.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(topic.locator('.study-card-more')).toBeFocused();
  pass('Arrow/Home/End/Escape navigate and dismiss the menu, returning focus to the invoking card');

  await topic.locator('.study-card-more').click();
  await menu.locator('[data-action=parts]').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect(page.locator('.excerpt-part')).toHaveCount(2);
  await page.click('#dialog-cancel');
  pass('Existing continuous-excerpt editor is accessible from the source card and retains both fragments');

  await topic.locator('.study-card-more').click();
  await menu.locator('[data-action=preview]').click();
  await expect(page.locator('.study-card-preview')).toBeVisible();
  await page.click('#dialog-cancel');
  await topic.locator('.study-card-more').click();
  await menu.locator('[data-action=occlude]').click();
  await expect(page.locator('#occlusion-editor img')).toBeVisible();
  await page.click('#dialog-cancel');
  pass('Existing card preview and image occlusion editors open from grouped actions without changing source data');

  await page.setViewportSize({width:780,height:530});
  await topic.click();
  await topic.locator('.study-card-more').click();
  const box=await menu.boundingBox();
  assert(box&&box.x>=7&&box.y>=7&&box.x+box.width<=780&&box.y+box.height<=530,
    'Menu must fit within the narrow viewport: '+JSON.stringify(box));
  assert(await menu.evaluate(el=>el.scrollHeight>el.clientHeight),
    'Large existing action menu should scroll inside itself on small screens');
  pass('Grouped menu remains within 780×530 reading workspace, with independent vertical scrolling');
  await menu.locator('[data-action=source]').click();
  await expect(page.locator('#reader-view')).toBeVisible();
  await expect(page.locator('#document-path')).toContainText('original.pdf');
  pass('Explicit source action opens the document, while clicking the card body keeps the mind map in place');

  set=await api('study.get',{setId:set.id});
  await api('study.view.set',{setId:set.id,expectedRevision:set.revision,view:'split',documentId:document.id});
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  await expect(page.locator('#workspace')).toHaveClass(/study-split/);
  await expect(page.locator('#study-map-viewport')).toBeVisible();
  const linked=page.locator('.study-card[data-card-id="'+created.card.id+'"]');
  await linked.click();
  await expect(page.locator('#workspace')).toHaveClass(/study-split/);
  await expect(page.locator('#reader-view')).toBeVisible();
  pass('Split-document and mind-map linkage still works; map-only selection behavior stays isolated');
 }catch(err){failure=err;}
 await browser?.close();
 await f.finish(failure);
})().catch(error=>{console.error(error);process.exitCode=1;});
