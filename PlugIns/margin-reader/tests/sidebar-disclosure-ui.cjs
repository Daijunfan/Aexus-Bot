'use strict';
const assert = require('node:assert/strict');
const { create, expect } = require('./ui-session.cjs');

(async () => {
  const f = await create('sidebar-disclosure-ui'); let failure;
  try {
    const { page, api } = f;
    await api('fs.mkdir', { path: '资料/章节' });
    await api('fs.write', { path: '资料/章节/第一篇.md', content: '# 第一篇\n\n原文保持在阅读区。' });
    await api('fs.write', { path: '资料/章节/第二篇.md', content: '# 第二篇\n\n只有点击其他文件才切换。' });
    let library = await api('study.library.get');
    library = await api('study.folder.create', { expectedRevision: library.revision, title: '学习分类' });
    const folder = library.folders.find(item => item.title === '学习分类');
    const set = await api('study.create', { title: '阅读计划', folderId: folder.id });
    await api('settings.set', { homeSection: 'library', currentFolder: '.', lastDocument: null, activeStudySet: null });
    const methods = [];
    page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().endsWith('/rpc')) return;
      try { methods.push(request.postDataJSON().method); } catch {}
    });
    await page.goto(f.server.url); await page.locator('body[data-ready=true]').waitFor();
    const root = page.locator('#file-tree .tree-row[data-path="资料"]');
    const child = page.locator('#file-tree .tree-row[data-path="资料/章节"]');
    const first = page.locator('#file-tree .tree-row[data-path="资料/章节/第一篇.md"]');
    const folderRow = page.locator('.study-folder-row[data-folder-id="' + folder.id + '"]');

    await root.locator('.tree-label').click();
    await expect(root).toHaveAttribute('aria-expanded', 'true');
    await root.locator('.tree-label').click();
    await expect(root).toHaveAttribute('aria-expanded', 'false');
    await root.locator('.twisty').click(); await child.click();
    await expect(first).toBeVisible();
    await expect(page.locator('#library-view')).toBeVisible();
    f.pass('Library folder opens and closes on a single click anywhere, including the chevron and nested folder');

    await first.click();
    await expect(page.locator('#document-path')).toHaveText('资料/章节/第一篇.md');
    await expect(page.locator('.flow-document')).toContainText('原文保持在阅读区');
    const before = await api('settings.get');
    await page.evaluate(() => window.readerSurfaceBefore = document.getElementById('reading-surface').firstElementChild);
    const from = methods.length;
    await child.locator('.tree-label').click();
    await child.locator('.tree-label').click();
    await root.locator('.tree-label').click();
    await root.locator('.tree-label').click();
    await expect(page.locator('#reader-view')).toBeVisible();
    assert(await page.evaluate(() => window.readerSurfaceBefore === document.getElementById('reading-surface').firstElementChild));
    assert.equal((await api('settings.get')).lastDocument, before.lastDocument);
    assert.equal(methods.slice(from).filter(m => ['document.open', 'settings.set'].includes(m)).length, 0);
    await first.click();
    assert.equal(methods.slice(from).filter(m => m === 'document.open').length, 0);
    await page.locator('#file-tree .tree-row[data-path="资料/章节/第二篇.md"]').click();
    await expect(page.locator('#document-path')).toHaveText('资料/章节/第二篇.md');
    f.pass('Folder toggles and active-file click preserve the open document; another file opens normally');

    const fromStudy = methods.length;
    await folderRow.locator('.folder-open').click();
    await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.study-set-row[data-set-id="' + set.id + '"]')).toBeVisible();
    await folderRow.locator('.folder-open').click();
    await expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#reader-view')).toBeVisible();
    await expect(page.locator('#document-path')).toHaveText('资料/章节/第二篇.md');
    assert.equal(methods.slice(fromStudy).filter(m => ['study.open', 'document.open', 'settings.set'].includes(m)).length, 0);
    f.pass('Study folder name expands/collapses in place with no navigation RPC');

    await folderRow.locator('.folder-open').focus();
    await page.keyboard.press('ArrowRight');
    await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
    await expect(folderRow.locator('.folder-open')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    if (await root.getAttribute('aria-expanded') === 'true') await root.locator('.tree-label').click();
    await root.focus();
    await page.keyboard.press('ArrowRight');
    await expect(root).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(child).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(child).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowLeft');
    await expect(root).toBeFocused();
    await page.keyboard.press(' ');
    await expect(root).toHaveAttribute('aria-expanded', 'false');
    assert.equal(await page.locator('#file-tree .tree-row[tabindex="0"]').count(), 1);
    f.pass('Keyboard expansion, collapse, focus restoration and single tree tab stop');

    await api('reader.position.set', { id: (await api('settings.get')).lastDocument, locator: { section: 0 }, activate: false });
    await page.waitForTimeout(600);
    await expect(root).toHaveAttribute('aria-expanded', 'false');

    await folderRow.locator('.folder-open').click();
    await page.locator('.study-set-row[data-set-id="' + set.id + '"]').click();
    await expect(page.locator('#study-map-viewport')).toBeVisible();
    const activeStudy = (await api('settings.get')).activeStudySet;
    await folderRow.locator('.folder-open').click();
    await expect(folderRow).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#study-map-viewport')).toBeVisible();
    assert.equal((await api('settings.get')).activeStudySet, activeStudy);
    f.pass('Collapsing the current study folder leaves its active mind-map workspace intact');

    await folderRow.locator('[data-collection-more]').click();
    await expect(page.locator('.collection-menu [data-action=open]')).toContainText('在主页中浏览');
    await page.locator('.collection-menu [data-action=open]').click();
    await expect(page.locator('#study-library-title')).toHaveText('学习分类');
    await page.click('#library-root');
    await root.locator('.file-more').click();
    await page.locator('.file-context-menu [data-action=open]').click();
    await expect(page.locator('#folder-title')).toHaveText('资料');
    f.pass('Background refresh respects manual collapse; context-menu Browse deliberately opens the folder page');

    for (const width of [1440, 960, 780]) {
      await page.setViewportSize({ width, height: 680 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    f.pass('No horizontal overflow at three practical viewport widths');
  } catch (error) { failure = error; }
  await f.finish(failure);
})().catch(error => { console.error(error); process.exitCode = 1; });
