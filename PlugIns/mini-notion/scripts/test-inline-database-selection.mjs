// Hidden desktop regression against an isolated build and synthetic workspace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
const { buildSync } = require('esbuild'), { _electron: electron, expect } = require('@playwright/test');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mininotion-inline-selection-'));
const appRoot = path.join(temporary, 'app'), data = path.join(temporary, 'data');
fs.mkdirSync(appRoot); fs.mkdirSync(data);
let app;
try {
  fs.cpSync(path.join(root, 'electron'), path.join(appRoot, 'electron'), { recursive: true });
  fs.cpSync(path.join(root, 'dist-cli'), path.join(appRoot, 'dist-cli'), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(appRoot, 'node_modules'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'mininotion-inline-regression', version: '1.0.0', main: 'electron/main.cjs' }));
  buildSync({ entryPoints: { server: path.join(root, 'src/backend/server.ts'), client: path.join(root, 'src/backend/client.ts'), delta: path.join(root, 'src/core/stateDelta.ts') }, outdir: path.join(appRoot, 'dist-cli'), outExtension: { '.js': '.cjs' }, bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(appRoot, 'dist')], { cwd: root, stdio: 'pipe' });
  buildSync({ stdin: { contents: "export {makePage,defaultDatabase} from './src/model'; export {createWorkspace} from './src/seed';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temporary, 'model.cjs'), logLevel: 'silent' });
  const { makePage, defaultDatabase, createWorkspace } = require(path.join(temporary, 'model.cjs'));
  const ws = createWorkspace(), database = defaultDatabase();
  database.columns = [{ id: 'notes', name: 'Notes', type: 'text' }, { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Done'] }];
  const owner = makePage({ id: 'owner', title: 'Inline selection fixture', fullWidth: true, blocks: [
    { id: 'before', type: 'paragraph', content: 'Before database' },
    { id: 'inline', type: 'databaseView', props: { databaseId: 'database', title: 'Embedded database', linked: false } },
    { id: 'after', type: 'paragraph', content: 'After database' },
  ] });
  const db = makePage({ id: 'database', parentId: owner.id, title: 'Embedded database', database });
  ws.pages = [owner, db, ...Array.from({ length: 3 }, (_, i) => makePage({ id: `record-${i}`, parentId: db.id, title: `Record ${i}`, values: { notes: `Notes ${i}`, stage: 'Todo' } }))];
  ws.activePageId = owner.id; ws.expanded = []; ws.recent = []; ws.spaces = {};
  fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify(ws));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MINI_NOTION_WORKSPACE; delete env.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [appRoot], cwd: appRoot, env, timeout: 120000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(15000);
  const inline = page.locator('.inline-database');
  await inline.waitFor();
  const state = () => page.evaluate(() => {
    const inline = document.querySelector('.inline-database');
    const style = getComputedStyle(inline, '::after');
    const view = document.querySelector('.bn-editor').editor.view;
    return { selection: view.state.selection.toJSON(), overlay: style.content !== 'none' && style.boxShadow !== 'none', shadow: style.boxShadow, selectedNodes: document.querySelectorAll('.ProseMirror-selectednode').length, active: document.activeElement?.tagName };
  });
  const observed = {};
  await inline.locator('button[data-view-id] span').first().click();
  observed.tabLabel = await state();
  await page.keyboard.press('Escape');
  await inline.locator('th .title-column, th.title-column').first().click();
  observed.header = await state();
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover-layer')).toHaveCount(0);
  await inline.getByRole('button', { name: '筛选', exact: true }).locator('svg').click();
  observed.filterIcon = await state();
  await page.keyboard.press('Escape');
  await inline.locator('[data-row-id="record-0"] input[aria-label="Notes"]').click();
  observed.cell = await state();
  const checks = [];
  if (process.env.INLINE_SELECTION_VERIFY === '1') {
    for (const [name, result] of Object.entries(observed)) expect(result.overlay, name).toBe(false);
    const input = inline.locator('[data-row-id="record-0"] input[aria-label="Notes"]');
    await input.fill('Keyboard editing');
    await input.press('Meta+a');
    await page.keyboard.insertText('Edited correctly');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Edited correctly');
    const api = async (method, params) => page.evaluate(async ({ method, params }) => {
      const result = await window.native.api(method, params); if (result.error) throw new Error(result.error.message); return result.result;
    }, { method, params });
    await expect.poll(async () => (await api('page.get', { pageId: 'record-0' })).values.notes).toBe('Edited correctly');
    await inline.locator('[data-row-id="record-0"] button[aria-label="Stage"] .tag').click();
    await page.locator('.popover').getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'record-0' })).values.stage).toBe('Done');
    expect((await state()).overlay).toBe(false);
    checks.push('nested icon/label clicks and cell editing show no whole-block selection overlay');
    checks.push('input focus, select-all, text editing and picker choice are preserved and durable');
    const headers = inline.locator('thead th[draggable="true"]');
    await headers.nth(1).dragTo(headers.nth(0));
    await expect.poll(async () => (await api('page.get', { pageId: db.id })).database.views.find(item => item.id === database.activeViewId).propertyOrder).toEqual(['stage', 'notes']);
    checks.push('database column drag-and-drop still updates its own property order');
    const paragraph = page.locator('[data-id="before"] .bn-inline-content');
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' keyboard works');
    await expect(paragraph).toContainText('keyboard works');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await page.keyboard.press('Meta+a');
    await expect.poll(() => page.evaluate(() => JSON.stringify(document.querySelector('.bn-editor').editor.view.state.selection.content().toJSON()).includes('After database'))).toBe(true);
    const selected = await page.evaluate(() => document.querySelector('.bn-editor').editor.view.state.selection.content().toJSON());
    expect(JSON.stringify(selected)).toContain('databaseView');
    expect(JSON.stringify(selected)).toContain('"id":"before"');
    expect(JSON.stringify(selected)).toContain('After database');
    checks.push('surrounding text typing and explicit multi-block selection still include the database');
    await paragraph.click(); // clear the multi-block selection before dragging one block
    await inline.hover({ position: { x: 8, y: 12 } });
    const handle = page.locator('.bn-side-menu [draggable="true"]');
    await handle.waitFor();
    const target = page.locator('[data-id="after"] .bn-inline-content');
    // macOS native dragTo enters an OS drag loop for BlockNote's HTML payload
    // when the window is hidden. Dispatch the same drag events/DataTransfer so
    // the real side-handle and ProseMirror drop handlers run without showing it.
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const sourceBounds = await handle.boundingBox();
    await handle.dispatchEvent('dragstart', { dataTransfer: transfer, clientX: sourceBounds.x + 5, clientY: sourceBounds.y + 5 });
    expect(await page.evaluate(() => !!document.querySelector('.bn-editor').editor.view.dragging)).toBe(true);
    await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const targetBounds = await target.boundingBox();
    const dropPoint = { dataTransfer: transfer, clientX: targetBounds.x + 10, clientY: targetBounds.y + targetBounds.height + 8 };
    await page.locator('.bn-editor').dispatchEvent('dragover', dropPoint);
    await page.locator('.bn-editor').dispatchEvent('drop', dropPoint);
    await handle.dispatchEvent('dragend', { dataTransfer: transfer });
    await transfer.dispose();
    await expect.poll(async () => (await api('page.get', { pageId: owner.id })).blocks.filter(block => ['before', 'after', 'inline'].includes(block.id)).map(block => block.id)).toEqual(['before', 'after', 'inline']);
    checks.push('side-handle drag events reorder the entire database block through ProseMirror');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await inline.waitFor();
    await expect(inline.locator('[data-row-id="record-0"] input[aria-label="Notes"]')).toHaveValue('Edited correctly');
    checks.push('database content and block order survive reload');
  }
  const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  expect(hidden).toBe(true); expect(errors).toEqual([]);
  console.log(JSON.stringify({ observed, checks, hidden, errors }, null, 2));
} finally { await app?.close().catch(() => {}); fs.rmSync(temporary, { recursive: true, force: true }); }
