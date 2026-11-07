'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {create,expect}=require('./ui-session.cjs');

(async()=>{
  const f=await create('study-selection-toolbar');
  const {page,workspace,api,pass}=f;
  let failure;
  const useWebKit=process.env.MR_WEBKIT_TEST==='1';
  try{
    await fs.writeFile(path.join(workspace,'reader.html'),
      '<h1>Reader choices</h1><p>Selection toolbar actions preserve exact source positions while readers highlight, send excerpts to the mind map, annotate, and copy useful words.</p>');
    let set=await api('study.create',{title:'Selection toolbar'});
    set=await api('study.documents.add',{setId:set.id,expectedRevision:set.revision,paths:['reader.html']});
    const doc=set.documents[0];
    set=await api('study.view.set',{setId:set.id,expectedRevision:set.revision,view:'split',documentId:doc.id});
    await api('study.open',{setId:set.id,documentId:doc.id});
    await page.goto(f.server.url);
    await page.locator('body[data-ready=true]').waitFor();
    const paragraph=page.locator('.flow-document article p').first();
    await expect(paragraph).toContainText('Selection toolbar actions');
    const get=()=>api('study.get',{setId:set.id});
    const drag=async()=>{
      const r=await paragraph.evaluate(p=>{
        const text=p.firstChild,range=document.createRange();
        range.setStart(text,1);range.setEnd(text,43);
        return range.getBoundingClientRect().toJSON();
      });
      assert(r.width>120&&r.height>0,'A real selectable text line is required');
      const y=r.y+r.height/2;
      await page.mouse.move(r.x+2,y);
      await page.mouse.down();
      await page.mouse.move(r.x+Math.min(r.width-3,190),y,{steps:14});
      await page.mouse.up();
      await expect(page.locator('#study-palette')).toBeVisible();
      const text=await page.locator('#study-excerpt-preview').textContent();
      assert(text.includes('election toolbar'),text);
      return {text,r};
    };
    // Programmatic text ranges are not a gesture and must not summon the palette.
    await paragraph.evaluate(p=>{
      const range=document.createRange();
      range.setStart(p.firstChild,0);range.setEnd(p.firstChild,12);
      const selection=p.getRootNode().getSelection?.()||window.getSelection();
      selection.removeAllRanges();selection.addRange(range);
    });
    await page.waitForTimeout(230);
    await expect(page.locator('#study-palette')).toBeHidden();
    await paragraph.evaluate(p=>{p.getRootNode().getSelection?.()?.removeAllRanges();window.getSelection()?.removeAllRanges();});
    pass('Script-driven selection changes do not open the user action bar');

    const first=await drag();
    for(const [key,name] of [['Alt+H','selection-highlight'],['Alt+M','selection-map'],['Alt+N','selection-note'],['Alt+C','selection-copy']]){
      await expect(page.locator('#'+name)).toHaveAttribute('aria-keyshortcuts',key.replace('+','+'));
    }
    const rect=await page.locator('#study-palette').boundingBox();
    assert(rect&&rect.y+rect.height<=first.r.y||rect&&rect.y>=first.r.y+first.r.height,
      'Toolbar should not cover the selected line');
    await page.keyboard.press('Alt+h');
    await expect(page.locator('#study-palette')).toBeHidden();
    await expect.poll(async()=>(await get()).cards.length).toBe(1);
    let latest=await get();
    const highlighted=latest.cards.find(c=>c.source?.documentId===doc.id);
    assert(highlighted&&highlighted.inMap===false&&highlighted.text===first.text);
    assert(highlighted.source.selection.end>highlighted.source.selection.start);
    pass('Real text drag + Option-H creates only a durable inline highlight with source offsets');

    const second=await drag();
    await page.keyboard.press('Alt+m');
    await expect.poll(async()=>(await get()).cards.length).toBe(2);
    latest=await get();
    assert(latest.cards.some(c=>c.inMap===true&&c.text===second.text&&c.source?.documentId===doc.id));
    await expect(page.locator('#study-board .study-card')).toHaveCount(1);
    pass('Option-M saves a real mind-map excerpt, separate from inline highlight');

    await drag();
    await page.keyboard.press('Alt+n');
    await expect(page.locator('#selection-note-editor')).toBeVisible();
    await page.locator('#selection-note-save').click();
    await expect(page.locator('#study-capture-status')).toContainText('先写下批注');
    assert.equal((await get()).cards.length,2,'Empty note cannot create a phantom annotation');
    await page.locator('#selection-note-text').fill('This is a durable thought.');
    await expect(page.locator('#study-capture-status')).toContainText('未保存');
    await page.locator('#selection-note-save').click();
    await expect.poll(async()=>(await get()).cards.length).toBe(3);
    latest=await get();
    assert(latest.cards.some(c=>c.note==='This is a durable thought.'&&c.inMap===false));
    pass('Option-N opens a genuine note editor; empty submit is blocked and a valid note persists');

    const fourth=await drag();
    if(!useWebKit)await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(f.server.url).origin});
    await page.keyboard.press('Alt+c');
    await expect(page.locator('#study-palette')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('已复制选中文字');
    if(!useWebKit)assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),fourth.text);
    assert.equal((await get()).cards.length,3,'Copy must not create a card');
    pass('Option-C invokes the actual clipboard action without changing stored cards');

    await drag();
    await page.locator('#selection-note').click();
    await page.locator('#selection-note-text').fill('Still unsaved');
    await page.locator('#selection-copy').click();
    await expect(page.locator('#selection-note-text')).toHaveValue('Still unsaved');
    await expect(page.locator('#study-capture-status')).toContainText('已复制');
    await page.locator('#study-palette-close').click();
    await expect(page.locator('#study-palette')).toBeHidden();
    assert.equal((await get()).cards.length,3);
    pass('Copy preserves an unsaved note until explicit dismissal, without a phantom save');

    await drag();
    await page.setViewportSize({width:320,height:420});
    await page.locator('#study-palette-more').click();
    const geometry=await page.locator('#study-palette').evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};
    });
    assert(geometry.left>=8&&geometry.right<=320&&geometry.top>=8&&geometry.bottom<=420,JSON.stringify(geometry));
    await page.locator('#study-palette-close').click();
    pass('Expanded secondary controls stay inside a small viewport without a native window');
  }catch(error){failure=error;}
  await f.finish(failure);
})().catch(error=>{console.error(error);process.exitCode=1;});
