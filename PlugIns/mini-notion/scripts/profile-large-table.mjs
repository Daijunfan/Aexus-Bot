// Build and exercise an isolated copy, leaving the shared dist and personal data untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { buildSync } = require('esbuild');
const { _electron: electron, expect } = require('@playwright/test');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mininotion-table-profile-'));
const appRoot = path.join(temporary, 'app'), data = path.join(temporary, 'data');
fs.mkdirSync(appRoot); fs.mkdirSync(data);
const count = Number(process.env.PROFILE_TABLE_ROWS || 2000);
let app;
try {
  fs.cpSync(path.join(root, 'electron'), path.join(appRoot, 'electron'), { recursive: true });
  fs.cpSync(path.join(root, 'dist-cli'), path.join(appRoot, 'dist-cli'), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(appRoot, 'node_modules'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'mininotion-table-profile', version: '1.0.0', main: 'electron/main.cjs' }));
  buildSync({ entryPoints: { server: path.join(root, 'src/backend/server.ts'), client: path.join(root, 'src/backend/client.ts'), delta: path.join(root, 'src/core/stateDelta.ts') }, outdir: path.join(appRoot, 'dist-cli'), outExtension: { '.js': '.cjs' }, bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(appRoot, 'dist')], { cwd: root, stdio: 'pipe' });
  buildSync({ stdin: { contents: "export {makePage,defaultDatabase} from './src/model'; export {createWorkspace} from './src/seed';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temporary, 'model.cjs'), logLevel: 'silent' });
  const { makePage, defaultDatabase, createWorkspace } = require(path.join(temporary, 'model.cjs'));
  const ws = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'notes', name: 'Notes', type: 'text' }, { id: 'amount', name: 'Amount', type: 'number' },
    { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Doing', 'Done'] },
    { id: 'done', name: 'Done', type: 'checkbox' }, { id: 'email', name: 'Email', type: 'email' },
    { id: 'double', name: 'Double', type: 'formula', formula: 'prop("Amount") * 2' },
  ];
  database.subItems = true;
  const view = database.views.find(view => view.id === database.activeViewId);
  view.calculations = { amount: 'sum' };
  view.columnWidths = { title: 280, notes: 160, amount: 120, stage: 140, done: 90, email: 180, double: 130 };
  const db = makePage({ id: 'table-db', title: 'Large database', database, fullWidth: true, blocks: [] });
  const records = Array.from({ length: count }, (_, i) => makePage({ id: `row-${i}`, parentId: db.id,
    title: `Record ${String(i).padStart(5, '0')}`,
    subItemOf: i === 1 ? 'row-0' : i === 2 ? 'row-1' : null,
    values: { notes: `Notes ${i}`, amount: i, stage: ['Todo', 'Doing', 'Done'][i % 3], done: i % 2 === 0, email: `row${i}@example.test` },
  }));
  ws.pages = [db, ...records]; ws.activePageId = db.id; ws.expanded = []; ws.recent = []; ws.spaces = {};
  fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify(ws));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MINI_NOTION_WORKSPACE; delete env.VITE_DEV_SERVER_URL;
  const started = performance.now();
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [appRoot], cwd: appRoot, env, timeout: 120000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(30000);
  await page.locator('.database-table [data-row-id="row-0"]').waitFor({ timeout: 90000 });
  const startupMs = Math.round(performance.now() - started);
  await page.waitForTimeout(300);
  const mounted = await page.locator('.database-table [data-row-id]').count();
  const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const editMs = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await page.locator('[data-row-id="row-0"] input[aria-label="Notes"]').fill(`Saved edit ${i}`);
    await frame(); editMs.push(Math.round(performance.now() - start));
  }
  await page.locator('[data-row-id="row-0"] input[aria-label="Notes"]').blur();
  const scrollStarted = performance.now();
  await page.locator('.page-scroll').first().evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.locator(`[data-row-id="row-${count - 1}"]`).waitFor();
  await frame();
  const scrollEndMs = Math.round(performance.now() - scrollStarted);
  await expect(page.locator('.table-total')).toContainText(`${count} 条记录`);
  await expect(page.locator('.column-calculation').filter({ hasText: '求和' })).toContainText(String(count * (count - 1) / 2));
  await expect.poll(() => page.evaluate(async () => (await window.native.api('page.get', { pageId: 'row-0' })).result.values.notes)).toBe('Saved edit 2');
  const checks = [];
  if (process.env.PROFILE_TABLE_VERIFY === '1') {
    const api = async (method, params) => {
      const response = await page.evaluate(async ({ method, params }) => window.native.api(method, params), { method, params });
      if (response.error) throw new Error(JSON.stringify(response.error));
      return response.result;
    };
    const update = changes => api('view.update', { databaseId: db.id, viewId: view.id, changes });
    const scroll = async fraction => { await page.locator('.page-scroll').first().evaluate((node, fraction) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction; }, fraction); await frame(); };
    await scroll(0);
    await page.getByRole('checkbox', { name: '选择所有记录', exact: true }).check();
    await expect(page.locator('.database-selection-toolbar')).toContainText(`已选择 ${count} 条记录`);
    await scroll(1);
    await expect(page.locator(`[data-row-id="row-${count - 1}"] input[type=checkbox]`).first()).toBeChecked();
    await scroll(0);
    await page.getByRole('checkbox', { name: '选择所有记录', exact: true }).uncheck();
    await expect(page.locator('.database-selection-toolbar')).toHaveCount(0);
    checks.push('all rows select/deselect, including unmounted records');
    await page.getByRole('button', { name: '折叠 Record 00000 的子项目', exact: true }).click();
    await expect(page.locator('[data-row-id="row-1"]')).toHaveCount(0);
    await expect(page.locator('[data-row-id="row-2"]')).toHaveCount(0);
    await expect(page.locator('.table-total')).toContainText(`${count} 条记录`);
    await page.getByRole('button', { name: '展开 Record 00000 的子项目', exact: true }).click();
    await expect(page.locator('[data-row-id="row-2"]')).toHaveCount(1);
    checks.push('nested sub-items collapse and restore without changing totals');
    const input = page.locator('[data-row-id="row-0"] input[aria-label="Notes"]');
    await input.focus();
    await scroll(1);
    await expect(input).toBeFocused();
    await page.keyboard.insertText(' retained editor');
    await expect.poll(async () => (await api('page.get', { pageId: 'row-0' })).values.notes).toContain('retained editor');
    await input.blur();
    await scroll(0);
    await page.locator('[data-row-id="row-0"] button[aria-label="Stage"]').click();
    await scroll(1);
    await expect(page.locator('.popover')).toBeVisible();
    await page.locator('.popover').getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'row-0' })).values.stage).toBe('Done');
    checks.push('focused editor and portal picker survive scrolling out of view');
    await update({ sorts: [{ id: 'amount-desc', property: 'amount', direction: 'desc' }] });
    await scroll(0);
    await expect(page.locator('.database-table [data-row-id]').first()).toHaveAttribute('data-row-id', `row-${count - 1}`);
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill(`Record ${String(count - 1).padStart(5, '0')}`);
    await expect(page.locator('.table-total')).toContainText('1 条记录');
    await expect(page.locator('.column-calculation').filter({ hasText: '求和' })).toContainText(String(count - 1));
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('');
    await update({ sorts: [], groupBy: 'stage' });
    await expect(page.locator('.database-group-heading')).toHaveCount(4); // includes the empty-value group
    const totals = await page.locator('.table-total').allTextContents();
    if (totals.reduce((sum, text) => sum + Number(text.match(/\d+/)[0]), 0) !== count) throw new Error('Grouped counts dropped rows');
    checks.push('full data sorting, filtered sums and grouped counts');
    await update({ groupBy: undefined, wrapCells: true, columnWidths: { ...view.columnWidths, title: 140 } });
    await api('view.update', { databaseId: db.id, viewId: view.id, unset: ['groupBy'] });
    const wrappedTitle = 'Wrapped record with several words '.repeat(12);
    await api('page.update', { pageId: 'row-0', title: wrappedTitle });
    await api('page.update', { pageId: `row-${count - 1}`, title: wrappedTitle + ' last' });
    await scroll(0);
    await expect.poll(() => page.locator('[data-row-id="row-0"]').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(100);
    await scroll(1);
    await expect.poll(() => page.locator(`[data-row-id="row-${count - 1}"]`).evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(100);
    await expect.poll(() => page.locator('.page-scroll').first().evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    for (const fraction of [0, 0.5, 1, 0]) {
      await scroll(fraction);
      await expect.poll(() => page.evaluate(() => {
        const scroll = document.querySelector('.page-scroll'), bounds = scroll.getBoundingClientRect();
        return [...document.querySelectorAll('.database-table tr[data-row-id]')].some(row => { const rect = row.getBoundingClientRect(); return rect.top < bounds.bottom && rect.bottom > bounds.top; });
      })).toBe(true);
    }
    checks.push('measured wrapped rows retain full height through repeated long scrolls');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(page.locator('.database-table.enhanced-table')).toBeVisible();
    await expect(page.locator('.database-table th.title-column')).toHaveClass(/table-cell-wrap/);
    await expect(page.locator('.table-total')).toContainText(`${count} 条记录`);
    checks.push('database settings and complete row count survive reload');
    // PDF uses its separate hidden renderer and must mount the entire logical table.
    const tail = `PDFTAIL${count - 1}`;
    await api('page.update', { pageId: `row-${count - 1}`, title: tail });
    const pdf = path.join(temporary, 'complete-table.pdf');
    await api('file.export', { pageId: db.id, type: 'pdf', output: pdf });
    const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    fs.mkdirSync(path.join(root, '.local-data'), { recursive: true });
    fs.copyFileSync(pdf, path.join(root, '.local-data/table-print.pdf'));
    fs.writeFileSync(path.join(root, '.local-data/table-print.txt'), text);
    const compact = text.replace(/\s+/g, '');
    if (!compact.includes(tail) || !compact.includes('Record01000')) throw new Error('PDF omitted unmounted database rows');
    checks.push(`${count}-row PDF includes middle and final records verified by pdftotext`);
  }
  const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  if (!hidden) throw new Error('Profile window was visible');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ count, startupMs, mounted, dom, editMs, scrollEndMs, mountedAtEnd: await page.locator('.database-table [data-row-id]').count(), hidden, durableEdit: true, checks, errors }, null, 2));
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
