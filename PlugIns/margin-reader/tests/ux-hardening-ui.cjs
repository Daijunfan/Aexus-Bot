'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {create,expect}=require('./ui-session.cjs');
const {pdfFixture}=require('./fixtures.cjs');
const {webkit}=require('../../../node_modules/@playwright/test');
const {clickTool}=require('./read-map-actions.cjs');

(async()=>{
 const native=process.env.MR_WEBKIT_TEST==='1';
 const f=await create(native?'ux-hardening-webkit':'ux-hardening-chromium');
 const {api,workspace,pass}=f;let browser,error;
 const page=native?await(browser=await webkit.launch({headless:true})).newPage({viewport:{width:1520,height:1000}}):f.page;
 try {
  await fs.writeFile(path.join(workspace,'source.pdf'),pdfFixture());
  await fs.writeFile(path.join(workspace,'reading.html'),'<h1>Reader</h1><p>Careful reading and explicit interaction are required for annotations.</p>');
  const extra=path.join(workspace,'Extras');await fs.mkdir(extra);
  await Promise.all(Array.from({length:320},(_,i)=>fs.writeFile(path.join(extra,'book'+String(i).padStart(4,'0')+'.md'),'# Book '+i)));
  let set=await api('study.create',{title:'UX polish'});
  set=await api('study.documents.add',{setId:set.id,expectedRevision:set.revision,paths:['source.pdf','reading.html']});
  const pdf=set.documents.find(d=>d.path==='source.pdf');
  const outline='# Research\n'+Array.from({length:16},(_,i)=>'## Topic '+i).join('\n');
  set=await api('study.mindmap.outline.import',{setId:set.id,expectedRevision:set.revision,text:outline});
  set=await api('study.view.set',{setId:set.id,expectedRevision:set.revision,view:'split',documentId:pdf.id});
  await api('study.open',{setId:set.id,documentId:pdf.id});
  await page.goto(f.server.url);await page.locator('body[data-ready=true]').waitFor();
  await expect(page.locator('.pdf-page[data-page="1"]')).toHaveAttribute('data-render-state','ready');
  await page.setViewportSize({width:780,height:530});
  await expect(page.locator('#workspace')).toHaveClass(/study-split/);
  const geom=await page.locator('#reader-scroll').boundingBox();
  console.log('READING_GEOMETRY',JSON.stringify(await page.evaluate(()=>{
    const pick=el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return {id:el.id,className:el.className,h:r.height,y:r.y,wrap:c.flexWrap,basis:c.flexBasis,container:c.containerName,type:c.containerType};};
    return [...document.querySelectorAll('.main-pane,#study-reading-bar,#study-reading-bar>.study-view-controls,#study-current-document,#study-back-set,#reader-scroll,#reader-view,.reader-toolbar,.pdf-controls,#pdf-progress')].map(pick);
  })));
  assert(geom&&geom.height>=265,'Reader viewport remains too short at 780x530: '+JSON.stringify(geom));
  const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(horizontal,false,'Workspace must not overflow horizontally');
  pass('Compact 780x530 split reader preserves at least 265px of reading content and no page overflow');

  await page.click('#study-back-set');
  await page.click('#study-add-documents');
  await expect(page.locator('#study-file-search')).toBeVisible();
  await expect(page.locator('.study-file-choice')).toHaveCount(96);
  await expect(page.locator('.study-file-picker-count')).toContainText('96 / 322');
  await page.locator('.study-file-picker').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
  await expect.poll(()=>page.locator('.study-file-choice').count()).toBeGreaterThan(96);
  await page.locator('#study-file-search').fill('book0319');
  await expect(page.locator('.study-file-choice')).toHaveCount(1);
  await page.locator('.study-file-choice input').check();
  await expect(page.locator('#dialog-submit')).toHaveText('添加 1 份文件');
  await page.locator('#study-file-search').fill('');
  await expect(page.locator('.study-file-choice')).toHaveCount(96);
  await page.locator('#study-file-search').fill('book0319');
  await expect(page.locator('.study-file-choice[data-path="Extras/book0319.md"] input')).toBeChecked();
  await page.click('#dialog-cancel');
  pass('320-file picker mounts in 96-card pages, supports search and keeps selection across filtering');

  set=await api('study.get',{setId:set.id});
  set=await api('study.view.set',{setId:set.id,expectedRevision:set.revision,view:'map'});
  await page.reload();await page.locator('body[data-ready=true]').waitFor();
  await expect(page.locator('#study-map-viewport')).toBeVisible();
  const more=page.locator('#map-more>summary');await more.click();
  const input=page.locator('#map-action-search');
  await expect(input).toBeVisible();
  const before=await page.locator('#map-more button:visible').count();
  await input.fill('Markdown');
  const filtered=await page.locator('#map-more button:visible').count();
  assert(filtered>0&&filtered<before,'Existing action filter must reduce commands: '+JSON.stringify({before,filtered}));
  await input.fill('');
  await expect.poll(()=>page.locator('#map-more button:visible').count()).toBe(before);
  await more.click();
  pass('The existing forty-action map overflow menu is searchable without losing operations');

  const map=page.locator('.mindmap-topic').first();
  await map.click();
  const sizes=await map.evaluate(el=>{
    const item=selector=>{const e=el.querySelector(selector),r=e?.getBoundingClientRect();return r?{w:r.width,h:r.height,visible:getComputedStyle(e).opacity}:null};
    return{menu:item('.study-card-more'),details:item('.mm-topic-details'),collapse:item('.study-card-collapse'),resize:item('.mm-resize-handle'),
      scale:document.getElementById('study-map-viewport').dataset.cameraZoom};
  });
  assert(sizes.menu&&sizes.menu.w>=24&&sizes.menu.h>=24,JSON.stringify(sizes));
  assert(sizes.details&&sizes.details.w>=24,JSON.stringify(sizes));
  assert(sizes.resize&&sizes.resize.w>=16,JSON.stringify(sizes));
  pass('Selected node keeps screen-readable menu/details/resize targets while the mindmap zooms');

  await clickTool(page,'mm-export');
  await page.fill('#dialog [name=path]','Research Notes.svg');
  await page.selectOption('#dialog [name=format]','md');
  assert.equal(await page.inputValue('#dialog [name=path]'),'Research Notes.md');
  for(const name of ['pdfMode','paper','content']){
    const style=await page.locator('#dialog [name='+name+']').evaluate(el=>getComputedStyle(el.closest('.dialog-field')).display);
    assert.equal(style,'none',name+' is irrelevant to Markdown');
  }
  await expect(page.locator('#dialog [name=scope]')).toBeVisible();
  await page.selectOption('#dialog [name=format]','pdf');
  assert.equal(await page.inputValue('#dialog [name=path]'),'Research Notes.pdf');
  await expect(page.locator('#dialog [name=paper]')).toBeVisible();
  await page.click('#dialog-cancel');
  pass('Export form retains basename and shows only parameters meaningful to its chosen format');
 }catch(e){error=e;}
 await browser?.close();
 await f.finish(error);
})().catch(error=>{console.error(error);process.exitCode=1;});
