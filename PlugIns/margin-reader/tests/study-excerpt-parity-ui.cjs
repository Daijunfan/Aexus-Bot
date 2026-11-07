'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const {create,expect}=require('./ui-session.cjs'),{pdfFixture,epubFixture}=require('./fixtures.cjs');

(async()=>{
  const useWebKit=process.env.MR_WEBKIT_TEST==='1';
  const f=await create('study-excerpt-parity');
  let failure;
  const page=f.page;
  const {workspace,api,pass}=f;

  async function selectedPalette() {
    await expect(page.locator('#study-palette')).toBeVisible();
    const result=await page.locator('#study-palette').evaluate(palette=>{
      const p=palette.getBoundingClientRect();
      const buttons=[...palette.querySelectorAll('[data-color]')].filter(b=>!b.hidden);
      return {width:p.width,height:p.height,left:p.left,right:p.right,top:p.top,bottom:p.bottom,
        labels:buttons.map(b=>b.getAttribute('aria-label')),colors:buttons.map(b=>b.dataset.color),
        clickable:buttons.every(b=>{const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===b;}),
        swatchSize:buttons[0].getBoundingClientRect().width,
        selection:document.getElementById('study-excerpt-preview').textContent};
    });
    assert(result.left>=8&&result.right<=1520&&result.top>=8&&result.bottom<=1000,JSON.stringify(result));
    assert.equal(result.colors.length,6);
    assert(result.height<=110,'Default toolbar must not cover a paragraph: '+result.height);
    assert.equal(result.clickable,true,'Quick colors must be hittable without overlays');
    assert(result.swatchSize>=34,'Quick colors must retain usable pointer targets: '+result.swatchSize);
    assert(result.labels.every(t=>t.includes('高亮')),JSON.stringify(result.labels));
    return result;
  }

  try {
    await fs.writeFile(path.join(workspace,'course.pdf'),pdfFixture());
    const epubArchive=await require('jszip').loadAsync(await epubFixture());
    const chapter=await epubArchive.file('EPUB/one.xhtml').async('string');
    epubArchive.file('EPUB/one.xhtml',chapter.replace('</body>',Array.from({length:40},(_,i)=>`<p>Reading paragraph ${i}: keep the original excerpt while scrolling through this chapter.</p>`).join('')+'</body>'));
    await fs.writeFile(path.join(workspace,'course.epub'),await epubArchive.generateAsync({type:'nodebuffer'}));
    await fs.writeFile(path.join(workspace,'chapter.html'),
      '<h1>Chapter</h1><p>Study material can be highlighted in split view and linked to mindmap nodes with a source and a color.</p>');
    let set=await api('study.create',{title:'Study excerpt parity'});
    set=await api('study.documents.add',{setId:set.id,expectedRevision:set.revision,
      paths:['course.pdf','course.epub','chapter.html']});
    const pdf=set.documents.find(d=>d.path==='course.pdf'),epub=set.documents.find(d=>d.path==='course.epub'),html=set.documents.find(d=>d.path==='chapter.html');
    set=await api('study.view.set',{setId:set.id,expectedRevision:set.revision,
      view:'split',documentId:pdf.id});
    await api('study.open',{setId:set.id,documentId:pdf.id});
    await page.goto(f.server.url);
    await page.locator('body[data-ready=true]').waitFor();
    await expect(page.locator('#workspace')).toHaveClass(/study-split/);
    await expect(page.locator('.pdf-page[data-page="1"]')).toHaveAttribute('data-render-state','ready');
    const position=await page.evaluate(()=>{
      const view=document.getElementById('reader-scroll').getBoundingClientRect();
      const span=[...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')]
        .find(s=>{const b=s.getBoundingClientRect();
          return s.textContent.length>14&&b.width>90&&b.x>view.x+4&&b.right<view.right-5&&b.y>view.y&&b.bottom<view.bottom;});
      // Only choose visible, wide PDF text for the real drag test.
      return span?.getBoundingClientRect().toJSON();
    });
    assert(position,'PDF text must be selectable within the study viewport');
    async function drag(x,y,x2,y2) {
      await page.mouse.move(x,y);
      await page.mouse.down();
      await page.mouse.move(x2,y2,{steps:16});
      await page.mouse.up();
    }
    const y=position.y+position.height/2;
    await drag(position.x+3,y,position.x+Math.min(175,position.width-3),y);
    const colors=await selectedPalette();
    assert(colors.selection.includes('ntroduction'),JSON.stringify(colors));
    await page.screenshot({path:path.join(f.output,'compact-selection.png')});
    await page.locator('#study-palette-more').click();
    await expect(page.locator('#study-palette [data-color]:visible')).toHaveCount(16);
    assert(await page.locator('#study-palette [data-color]').evaluateAll(buttons=>buttons.every(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})));
    await page.locator('#study-palette [data-color=green]').hover();
    await expect(page.locator('#study-color-preview')).toContainText('绿色');
    await page.locator('#study-palette [data-color=yellow]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#study-palette [data-color=green]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#study-palette [data-color=indigo]')).toBeFocused();
    await expect(page.locator('#study-color-preview')).toContainText('靛蓝');
    await page.keyboard.press('End');
    await expect(page.locator('#study-palette [data-color=slate]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#study-palette [data-color=yellow]')).toBeFocused();
    await page.setViewportSize({width:320,height:420});
    await expect.poll(async()=>page.locator('#study-palette').evaluate(p=>p.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
    const mobile=await page.locator('#study-palette').evaluate(p=>{
      const r=p.getBoundingClientRect(),dots=[...p.querySelectorAll('[data-color]')];
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        columns:getComputedStyle(p.querySelector('.study-swatches')).gridTemplateColumns.split(' ').length,
        size:dots[0].getBoundingClientRect().width};
    });
    assert(mobile.left>=8&&mobile.right<=320&&mobile.top>=8&&mobile.bottom<=420,JSON.stringify(mobile));
    assert.equal(mobile.columns,4,'Narrow screens need a four-column color grid');
    assert(mobile.size>=44,'Narrow-screen colors need finger-sized targets');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#study-palette [data-color=pink]')).toBeFocused();
    await page.setViewportSize({width:1520,height:1000});
    await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('Keep this thought while choosing another annotation tool');
    for(const selector of ['#study-region','#study-excerpt-lasso','#study-pen','#study-lasso','#study-eraser','#document-textbox']){
      await page.locator('#reader-annotations summary').click();
      await page.locator(selector).click();
      await expect(page.locator('#selection-note-text')).toHaveValue('Keep this thought while choosing another annotation tool');
      await expect(page.locator('#toast')).toContainText('批注');
      await expect(page.locator('#reader-scroll')).not.toHaveClass(/study-region-mode|study-ink-mode|placing-textbox/);
      await expect(page.locator(selector)).toHaveAttribute('aria-pressed','false');
    }
    await page.locator('#selection-note-text').fill('');
    await page.locator('#selection-note').click();
    // Keyboard focus must not delete the captured text.
    await page.locator('#study-palette [data-color=red]').click();
    await expect.poll(async()=>(await api('study.get',{setId:set.id})).cards.length).toBe(1);
    let latest=await api('study.get',{setId:set.id});
    assert.equal(latest.cards[0].color,'red');
    assert.equal(latest.cards[0].inMap,false);
    assert.equal(latest.cards[0].source.documentId,pdf.id);
    await expect(page.locator('#study-board .study-card')).toHaveCount(0);
    await expect(page.locator('.pdf-page .study-mark')).toHaveCount(1);
    pass('PDF selection stays compact; all 16 colors and keyboard navigation remain available, and highlights do not create map topics');

    await page.selectOption('#study-current-document',html.id);
    await expect(page.locator('.flow-document article')).toBeVisible();
    await page.waitForTimeout(230);
    const r=await page.locator('.flow-document article p').evaluate(p=>{
      const range=document.createRange();
      range.setStart(p.firstChild,2);
      range.setEnd(p.firstChild,65);
      return range.getBoundingClientRect().toJSON();
    });
    const py=r.y+r.height/2;
    await drag(r.x+3,py,r.x+Math.min(r.width-5,260),py);
    const htmlColors=await selectedPalette();
    assert(htmlColors.selection.includes('material'));
    await page.locator('.flow-document article p').evaluate(p=>p.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',shiftKey:true,bubbles:true,composed:true})));
    await expect(page.locator('#study-palette [data-color=yellow]')).toBeFocused();
    await expect(page.locator('#study-color-preview')).toContainText('黄色');
    await page.locator('#selection-map').click();
    await expect.poll(async()=>(await api('study.get',{setId:set.id})).cards.length).toBe(2);
    latest=await api('study.get',{setId:set.id});
    const created=latest.cards.find(c=>c.source?.documentId===html.id);
    assert(created&&created.inMap===true&&created.color==='yellow');
    assert(created.source.selection.end>created.source.selection.start);
    await expect(page.locator('#study-board .study-card')).toHaveCount(1);
    await expect(page.locator('.flow-document .study-mark')).toHaveCount(1);
    pass('HTML Shadow DOM selection creates a linked map topic only through the explicit map action');

    await page.selectOption('#study-current-document',epub.id);
    await expect(page.locator('.flow-document article p').first()).toContainText('EPUB offline reading.');
    await page.waitForTimeout(180);
    const er=await page.locator('.flow-document article p').first().evaluate(p=>{
      const range=document.createRange();
      range.selectNodeContents(p);
      return range.getBoundingClientRect().toJSON();
    });
    const ey=er.y+er.height/2;
    await drag(er.x+1,ey,er.x+Math.min(er.width-3,170),ey);
    const epubColors=await selectedPalette();
    assert(epubColors.selection.includes('EPUB'));
    await page.locator('#study-palette-more').click();
    await page.selectOption('#selection-style','underline');
    await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('这是选文时写下的批注。');
    const scrollBox=await page.locator('#reader-scroll').boundingBox();
    await page.mouse.move(scrollBox.x+scrollBox.width-20,scrollBox.y+scrollBox.height/2);
    await page.mouse.wheel(0,90);
    await expect.poll(()=>page.locator('#reader-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('#selection-note-editor')).toBeVisible();
    await expect(page.locator('#selection-note-text')).toHaveValue('这是选文时写下的批注。');
    await page.locator('#study-boards').click();
    await expect(page.locator('#study-database')).toBeHidden();
    await expect(page.locator('#selection-note-editor')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('批注');
    for(const selector of ['#home','[data-study-view="documents"]','#next-page']){
      await page.locator(selector).click();
      await expect(page.locator('#selection-note-text')).toBeVisible();
      await expect(page.locator('#selection-note-text')).toHaveValue('这是选文时写下的批注。');
      await expect(page.locator('#toast')).toContainText('批注');
    }
    await expect(page.locator('#workspace')).toHaveClass(/study-split/);
    await page.locator('#selection-note-save').click();
    await expect.poll(async()=>(await api('study.get',{setId:set.id})).cards.length).toBe(3);
    latest=await api('study.get',{setId:set.id});
    const createdEpub=latest.cards.find(c=>c.source?.documentId===epub.id);
    assert(createdEpub&&createdEpub.inMap===false);
    assert.equal(createdEpub.note,'这是选文时写下的批注。');
    assert.equal(createdEpub.annotation.style,'underline');
    await expect(page.locator('#study-board .study-card')).toHaveCount(1);
    assert.equal(createdEpub.text,epubColors.selection);
    pass('EPUB inline notes survive real scrolling, database/home/view/page navigation attempts and save with the original source and underline');
    await page.mouse.move(scrollBox.x+scrollBox.width-20,scrollBox.y+scrollBox.height/2);
    await page.mouse.wheel(0,-1000);
    await expect.poll(()=>page.locator('#reader-scroll').evaluate(el=>el.scrollTop)).toBe(0);
    await drag(er.x+1,ey,er.x+Math.min(er.width-3,170),ey);
    await selectedPalette();
    const copied=await page.locator('#study-excerpt-preview').textContent();
    if(!useWebKit)await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(f.server.url).origin});
    await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('Copy keeps this unsaved thought');
    await page.locator('#selection-copy').click();
    await expect(page.locator('#selection-note-text')).toBeVisible();
    await expect(page.locator('#selection-note-text')).toHaveValue('Copy keeps this unsaved thought');
    await expect(page.locator('#toast')).toContainText('已复制选中文字');
    if(!useWebKit)assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),copied);
    await page.locator('#study-palette-close').click();
    await expect(page.locator('#study-palette')).toBeHidden();
    assert.equal((await api('study.get',{setId:set.id})).cards.length,3);
    await drag(er.x+1,ey,er.x+Math.min(er.width-3,170),ey);
    await selectedPalette();
    await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('Explicitly cancelled with Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#study-palette')).toBeHidden();
    assert.equal((await api('study.get',{setId:set.id})).cards.length,3);
    pass('Copy preserves a typed note; close and Escape explicitly discard it without creating duplicate annotations');

    await drag(er.x+1,ey,er.x+Math.min(er.width-3,170),ey);
    await selectedPalette();await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('Saved by the application shortcut');
    await page.locator('#selection-note-text').press('Control+s');
    await expect(page.locator('#study-palette')).toBeHidden();
    latest=await api('study.get',{setId:set.id});
    assert.equal(latest.cards.length,4);
    assert(latest.cards.some(c=>c.note==='Saved by the application shortcut'&&c.inMap===false&&c.text===epubColors.selection));
    await drag(er.x+1,ey,er.x+Math.min(er.width-3,170),ey);
    await selectedPalette();await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('This thought belongs to the map excerpt');
    await page.locator('#selection-map').click();
    await expect(page.locator('#study-palette')).toBeHidden();
    latest=await api('study.get',{setId:set.id});
    assert.equal(latest.cards.length,5);
    assert(latest.cards.some(c=>c.note==='This thought belongs to the map excerpt'&&c.inMap===true&&c.text===epubColors.selection));
    pass('The application save shortcut and explicit map action both preserve the typed note and original quote');

    // Normal library reading must continue using the same excerpt interaction.
    await api('settings.set',{activeStudySet:null,lastDocument:null,homeSection:'library',currentFolder:'.'});
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    await page.locator('#files .file-card[data-path="course.pdf"] .file-open').click();
    await expect(page.locator('.pdf-page[data-page="1"]')).toHaveAttribute('data-render-state','ready');
    const free=await page.locator('.pdf-page[data-page="1"] .textLayer span').first().boundingBox();
    assert(free&&free.width>80);
    const fy=free.y+free.height/2;
    await drag(free.x+2,fy,free.x+Math.min(150,free.width-3),fy);
    await selectedPalette();
    await page.locator('#study-palette [data-color=purple]').click();
    await expect.poll(async()=>{
      const sets=(await api('study.list')).sets;
      const existing=sets.find(s=>s.documentNotesFor===pdf.id);
      return existing?.cardCount||0;
    }).toBe(1);
    pass('Standalone PDF reading retains the same color-and-save workflow through its independent document notebook');
  }catch(e){console.error(await page.locator('#toast').textContent());failure=e;}
  await f.finish(failure);
})().catch(error=>{console.error(error);process.exitCode=1;});
