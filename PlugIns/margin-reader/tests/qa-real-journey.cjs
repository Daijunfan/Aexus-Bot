'use strict';

// Product QA: one real, headless user journey against the built plugin. No
// installed App, native window, external book, model call or shared workspace.
// Run: MR_WEBKIT_TEST=1 node tests/qa-real-journey.cjs
//      MR_WEBKIT_TEST=0 node tests/qa-real-journey.cjs  (Chromium comparison)
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { chromium, webkit, expect } = require('./ui-session.cjs');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const pluginRoot = path.resolve(process.env.MR_QA_PLUGIN_ROOT || path.join(root, 'dist-plugin'));
const useWebKit = process.env.MR_WEBKIT_TEST === '1';
const browserName = useWebKit ? 'webkit' : 'chromium';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, 'artifacts', `qa-real-journey-${browserName}-${stamp}`);
const docName = 'qa-reading.html';
const folderName = 'QA 阅读资料';
const studyTitle = 'QA 用户旅程';
const sourceNote = '从原文选择时写下的批注；切换到数据库后仍须保留。';
const databaseNote = '数据库编辑后的注释应同时出现在原始脑图主题。';
const sourceHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QA Reading</title></head><body>
<h1>Reading and source navigation</h1>
<p>Reading systems become reliable when the original passage, its annotation, and the mind map all refer to the same local source. This paragraph is deliberately selectable and remains unchanged after database edits.</p>
<p>Second section: local-first source verification never needs a model.</p>
</body></html>`;
const original = Buffer.from(sourceHtml, 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  await fs.mkdir(output, { recursive: true });
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mr-qa-real-journey-')));
  const workspace = path.join(temp, 'library');
  await fs.mkdir(workspace);
  assert.equal(path.dirname(await fs.realpath(workspace)), temp);
  const report = {
    status: 'running', browser: browserName, headless: true, pluginRoot,
    workspaceIsolated: true, modelCalls: 0, checks: [], failures: [], browserErrors: [],
    rpcMethods: [], screenshots: [], source: { path: docName, sha256: hash(original) }
  };
  const pass = label => { report.checks.push(label); console.log('PASS ' + label); };
  let server, browser, page, studyId, cardId;
  const screenshot = async name => {
    if (!page || page.isClosed()) return;
    const file = path.join(output, name + '.png');
    await page.screenshot({ path: file, animations: 'disabled' }).catch(() => {});
    report.screenshots.push(file);
  };
  const failure = async (stage, error) => {
    report.failures.push({ stage, message: error.message, stack: error.stack });
    console.error('FAIL ' + stage + ': ' + error.message);
    await screenshot('failure-' + stage);
  };
  const cli = async (method, params = {}) => {
    const env = { ...process.env };
    for (const key of ['AGENTS_WORKSPACE', 'AGENTS_COMPANY_PLUGIN_RPC', 'AGENTS_COMPANY_TOKEN', 'AGENTS_COMPANY_TOKEN_FILE']) delete env[key];
    const result = await exec(process.execPath, [path.join(pluginRoot, 'cli.cjs'), '--workspace', workspace, 'api', method, '--data', JSON.stringify(params)],
      { env, timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    const reply = JSON.parse(result.stdout);
    assert(!reply.error, JSON.stringify(reply.error));
    return reply.result;
  };

  try {
    server = await require(path.join(pluginRoot, 'lib/server.cjs')).startServer({ workspace, pluginRoot });
    const api = async (method, params = {}) => {
      const reply = await server.runtime.request({ jsonrpc: '2.0', id: randomUUID(), method, params });
      assert(!reply.error, JSON.stringify(reply.error));
      return reply.result;
    };
    const options = { headless: true };
    if (!useWebKit) {
      const candidate = process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath();
      if (fsSync.existsSync(candidate)) options.executablePath = candidate;
    }
    browser = await (useWebKit ? webkit : chromium).launch(options);
    const context = await browser.newContext({ viewport: { width: 1520, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.browserErrors.push(error.message));
    page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().endsWith('/rpc')) return;
      try { report.rpcMethods.push(request.postDataJSON()?.method); } catch { /* ignore non-JSON requests */ }
    });
    const localOrigin = new URL(server.url).origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort());
    await page.goto(server.url);
    await page.locator('body[data-ready=true]').waitFor();

    // Verify that the single public New Folder action can be reached and used
    // from the visible library heading, not merely found in the DOM.
    try {
      const button = page.locator('#new-folder');
      await expect(button).toBeVisible();
      assert(await button.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.width >= 24 && rect.height >= 24 && (target === el || el.contains(target));
      }), 'New folder must be a visible, unobstructed pointer target');
      await button.click();
      await expect(page.locator('#dialog')).toBeVisible();
      await page.locator('#dialog [name=name]').fill(folderName);
      await page.click('#dialog-submit');
      await expect(page.locator('#dialog')).toBeHidden();
      await expect(page.locator('#files .file-card[data-path=' + JSON.stringify(folderName) + ']')).toBeVisible();
      const listed = await cli('fs.list', { path: '.' });
      assert(listed.entries.some(item => item.path === folderName && item.kind === 'folder'));
      await screenshot('01-library-folder');
      pass('Visible New Folder button: click, name, submit, library card and independent CLI persistence');
    } catch (error) {
      await failure('library-folder', error);
      if (await page.locator('#dialog').isVisible()) await page.locator('#dialog-cancel').click();
    }

    // Actual upload-button click and intercepted headless file chooser, not a
    // direct fs.write fixture or a synthetic DOM change event.
    await page.click('#library-root');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('#import-files');
    await (await chooserPromise).setFiles({ name: docName, mimeType: 'text/html', buffer: original });
    await expect(page.locator('#reader-view')).toBeVisible();
    await expect(page.locator('#document-path')).toHaveText(docName);
    await expect(page.locator('.flow-document article p').first()).toContainText('Reading systems become reliable');
    assert.equal(hash(await fs.readFile(path.join(workspace, docName))), hash(original));
    for (const method of ['import.begin', 'import.chunk', 'import.finish']) assert(report.rpcMethods.includes(method), 'Missing real upload RPC ' + method);
    await screenshot('02-import-reading');
    pass('Real file chooser uploads the source, opens its readable article and preserves the exact original bytes');

    // Leave reading through the visible Back control before opening the
    // study collection. While reading, the sidebar root only toggles a tree.
    await page.click('#back-library');
    await expect(page.locator('#reader-view')).toBeHidden();
    await expect(page.locator('#library-view')).toBeVisible();
    await page.click('#studies-root');
    await expect(page.locator('#study-library-view')).toBeVisible();
    await expect(page.locator('#study-create')).toBeVisible();
    await page.click('#study-create');
    await page.locator('#dialog [name=title]').fill(studyTitle);
    // The current product intentionally creates compact topics by default;
    // the old mapMode selector is no longer part of this dialog.
    await page.click('#dialog-submit');
    await expect(page.locator('#dialog')).toBeHidden();
    await expect(page.locator('#study-title')).toHaveText(studyTitle);
    studyId = (await api('study.list')).sets.find(set => set.title === studyTitle)?.id;
    assert(studyId);
    await page.click('#study-add-documents');
    await page.locator('.study-file-choice input[value=' + JSON.stringify(docName) + ']').check();
    await page.click('#dialog-submit');
    await expect(page.locator('#dialog')).toBeHidden();
    let study = await api('study.get', { setId: studyId });
    assert.equal(study.documents.length, 1);
    const documentId = study.documents[0].id;
    // The home-gallery is hidden while reading. Enter split reading through
    // the visible Documents tab only if the source is not already showing.
    if (!await page.locator('#reader-view').isVisible()) await page.click('[data-study-view=documents]');
    await expect(page.locator('#reader-view')).toBeVisible();
    await expect(page.locator('#document-path')).toHaveText(docName);
    await expect(page.locator('.flow-document article p').first()).toBeVisible();
    pass('Study set and source membership are created through real dialogs without duplicating the original file');

    const paragraph = page.locator('.flow-document article p').first();
    await paragraph.scrollIntoViewIfNeeded();
    const points = await paragraph.evaluate(element => {
      const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const point = (offset, leading = false) => {
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + (leading ? Math.min(1, rect.width / 6) : rect.width / 2), y: rect.top + rect.height / 2 };
      };
      // Begin inside the leading edge of R. At the glyph center WebKit's
      // caret hit-test legitimately starts after R and selects "eading".
      return { start: point(0, true), end: point(36) };
    });
    assert(points && Math.abs(points.start.y - points.end.y) < 8, 'Selectable source segment must fit the visible first line');
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 18 });
    await page.mouse.up();
    await expect(page.locator('#study-palette')).toBeVisible();
    const quotedText = (await page.locator('#study-excerpt-preview').textContent()).trim();
    report.selectionPreview = quotedText;
    const liveSelection = await page.locator('.flow-document article').evaluate(article => {
      const shadow = article.getRootNode(), selection = window.getSelection();
      let range;
      try {
        const composed = selection?.getComposedRanges?.({ shadowRoots: [shadow] })?.[0];
        if (composed && article.contains(composed.startContainer) && article.contains(composed.endContainer)) {
          range = document.createRange();
          range.setStart(composed.startContainer, composed.startOffset);
          range.setEnd(composed.endContainer, composed.endOffset);
        }
      } catch { /* Browser may not expose composed selection ranges. */ }
      if (!range) {
        const fallback = shadow.getSelection?.() || selection;
        if (fallback?.rangeCount) range = fallback.getRangeAt(0);
      }
      let start = null, end = null;
      if (range && article.contains(range.startContainer) && article.contains(range.endContainer)) {
        const prefix = document.createRange();
        prefix.selectNodeContents(article);
        prefix.setEnd(range.startContainer, range.startOffset);
        start = prefix.cloneContents().textContent.length;
        prefix.setEnd(range.endContainer, range.endOffset);
        end = prefix.cloneContents().textContent.length;
      }
      return { start, end, rangeText: range?.toString() || '', windowSelection: selection?.toString() || '',
        articleHtmlStart: article.innerHTML.slice(0, 180), articleTextStart: article.textContent.slice(0, 120) };
    });
    const coreSection = await api('document.content', { id: documentId, section: 0 });
    const coreDom = new (require('jsdom').JSDOM)(coreSection.html);
    const coreBody = coreDom.window.document.body.textContent;
    coreDom.window.close();
    const renderedBody = await page.locator('.flow-document article').evaluate(el => el.textContent);
    const mismatchAt = [...renderedBody].findIndex((c, i) => c !== coreBody[i]);
    report.sourceTextParity = { coreLength: coreBody.length, renderedLength: renderedBody.length,
      mismatchAt, coreHtmlStart: coreSection.html.slice(0, 180), coreStart: coreBody.slice(0, 120),
      renderedStart: renderedBody.slice(0, 120), liveSelection,
      coreSliceAtUiOffset: liveSelection.start === null ? null : coreBody.slice(liveSelection.start, liveSelection.end),
      renderedSliceAtUiOffset: liveSelection.start === null ? null : renderedBody.slice(liveSelection.start, liveSelection.end),
      selected: quotedText };
    assert.equal(renderedBody, coreBody, 'Visible HTML text must match Core body.textContent exactly, including leading whitespace');
    if (liveSelection.start !== null) {
      const normalize = value => value.replace(/\s+/g, ' ').trim();
      assert.equal(normalize(coreBody.slice(liveSelection.start, liveSelection.end)), normalize(quotedText),
        'Physical selection offsets must resolve to the same normalized source quote in Core');
    }
    assert(quotedText.length > 12 && quotedText.includes('Reading systems'), 'Drag must select the actual source words: ' + JSON.stringify(quotedText));
    pass('Reader and Core HTML text offsets agree exactly for physical selection');
    await screenshot('03-source-selection');
    await page.click('#selection-note');
    await page.locator('#selection-note-text').fill(sourceNote);
    await page.click('#selection-map');
    await expect.poll(async () => (await api('study.get', { setId: studyId })).cards.length).toBe(1);
    study = await api('study.get', { setId: studyId });
    const card = study.cards[0];
    cardId = card.id;
    assert(card.inMap && card.source?.documentId === documentId);
    assert.equal(card.note, sourceNote);
    assert.equal(card.text.trim(), quotedText);
    assert(card.source.selection.end > card.source.selection.start);
    const snapshot = await api('study.card.image', { setId: studyId, cardId });
    assert(snapshot.contentBase64?.length > 100);
    await fs.writeFile(path.join(output, 'source-snapshot.png'), Buffer.from(snapshot.contentBase64, 'base64'));
    pass('Physical text drag and note/map buttons create one durable, source-linked excerpt and PNG');

    await page.click('#study-boards');
    await expect(page.locator('#study-database')).toBeVisible();
    await expect(page.locator('.board-card')).toHaveCount(1);
    await page.locator('[data-board-edit]').first().click();
    await page.locator('#board-editor [name=editTitle]').fill('QA 已整理摘录');
    await page.locator('#board-editor [name=editTags]').fill('qa-path, review');
    await page.locator('#board-editor [name=editNote]').fill(databaseNote);
    await page.click('#board-edit-save');
    await expect(page.locator('#board-editor')).toBeHidden();
    await expect.poll(async () => (await api('study.get', { setId: studyId })).cards[0].note).toBe(databaseNote);
    study = await api('study.get', { setId: studyId });
    assert.equal(study.cards[0].text.trim(), quotedText, 'Table edits must never overwrite the original excerpt');
    assert(study.cards[0].tags.includes('qa-path') && study.cards[0].tags.includes('review'));
    await page.selectOption('[name=group1]', 'tag');
    if (!await page.locator('#board-filters').evaluate(el => el.open)) await page.locator('#board-filters>summary').click();
    await page.locator('#board-filters [name=tags]').fill('qa-path');
    await page.click('#board-search');
    // Tag grouping renders the same card in both matching tag sections;
    // duplicate rows are not duplicate persisted source cards.
    await expect(page.locator('.board-card')).toHaveCount(2);
    const groupedKeys = await page.locator('.board-card [data-board-edit]').evaluateAll(buttons => buttons.map(b => b.dataset.boardEdit));
    assert.equal(new Set(groupedKeys).size, 1, 'Both tag groups must reference the same durable card');
    await expect(page.locator('.board-group h3').first()).toContainText('qa-path');
    await expect(page.locator('.board-group h3').nth(1)).toContainText('review');
    await page.click('#board-save');
    await page.locator('#dialog [name=title]').fill('QA 重点视图');
    await page.click('#dialog-submit');
    await expect(page.locator('#dialog')).toBeHidden();
    assert((await api('study.get', { setId: studyId })).boards.some(view => view.title === 'QA 重点视图'));
    await screenshot('04-database-organized');
    pass('Database editor, tag filtering, grouped rows and saved view persist through the public Core');

    await page.click('#board-close');
    await expect(page.locator('#study-database')).toBeHidden();
    if (await page.locator('[data-study-view=map]').getAttribute('aria-pressed') !== 'true') await page.click('[data-study-view=map]');
    if (await page.locator('[data-study-view=documents]').getAttribute('aria-pressed') === 'true') await page.click('[data-study-view=documents]');
    await expect(page.locator('#study-map-viewport')).toBeVisible();
    await expect(page.locator('#reader-view')).toBeHidden();
    await page.click('#study-zoom-fit');
    const topic = page.locator('.mindmap-topic[data-card-id=' + JSON.stringify(cardId) + ']');
    await expect(topic).toBeVisible();
    await expect(topic).toContainText('QA 已整理摘录');
    await screenshot('05-mindmap');
    // In map-only mode a title click selects the topic. The visible More
    // menu offers the explicit "回到原文" command; the footer is hidden by
    // this topic layout, so never force-click that hidden DOM element.
    await topic.hover();
    await topic.locator('.study-card-more').click();
    const returnSource = page.locator('.study-card-menu [data-action=source]');
    await expect(returnSource).toBeVisible();
    await returnSource.click();
    await expect(page.locator('#reader-view')).toBeVisible();
    await expect(page.locator('#document-path')).toHaveText(docName);
    const mark = page.locator('.flow-document article .study-mark[data-card-id=' + JSON.stringify(cardId) + ']').first();
    await expect(mark).toBeVisible();
    await expect.poll(async () => mark.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const viewport = document.getElementById('reader-scroll').getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= viewport.top - 4 && rect.bottom <= viewport.bottom + 4;
    })).toBe(true);
    await screenshot('06-return-to-source');
    pass('Switching to the mind map and physically clicking its topic returns to a visible source highlight');

    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    await expect(page.locator('.flow-document article .study-mark[data-card-id=' + JSON.stringify(cardId) + ']')).toBeVisible();
    const persisted = await cli('study.get', { setId: studyId });
    assert.equal(persisted.cards.find(item => item.id === cardId).note, databaseNote);
    assert(persisted.cards.find(item => item.id === cardId).tags.includes('qa-path'));
    assert.equal(hash(await fs.readFile(path.join(workspace, docName))), hash(original));
    report.data = { studyId, cardId, documentId, quotedText, sourceLocator: card.source.locator,
      sourceSelection: card.source.selection, finalRevision: persisted.revision,
      savedView: 'QA 重点视图', sourceHash: hash(original) };
    await fs.writeFile(path.join(output, 'data.json'), JSON.stringify(report.data, null, 2) + '\n');
    pass('Reload and separate CLI agree on tags, annotation and source link; original HTML is byte-identical');
  } catch (error) {
    await failure('journey', error);
  } finally {
    if (report.browserErrors.length) report.failures.push({ stage: 'renderer', message: report.browserErrors.join('; ') });
    report.status = report.failures.length ? 'failed' : 'passed';
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('QA REAL JOURNEY REPORT ' + path.join(output, 'result.json'));
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
  assert.equal(report.status, 'passed', report.failures.map(item => item.stage + ': ' + item.message).join(' | '));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
