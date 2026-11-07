import { test, expect, _electron as electron, type Page as BrowserPage } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

const count = 640;

async function fixture(type: 'board' | 'gallery' | 'list' | 'feed') {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-card-window-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'notes', name: 'Notes', type: 'text' },
    { id: 'amount', name: 'Amount', type: 'number' },
    { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Done'] },
    { id: 'team', name: 'Team', type: 'select', options: ['Product', 'Engineering'] },
  ];
  database.views = [{ id: 'cards', name: 'Cards', type, groupBy: type === 'board' ? 'stage' : undefined, openPagesIn: 'side' }];
  database.activeViewId = 'cards';
  const db = makePage({ id: 'cards-db', title: 'Windowed cards fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: count }, (_, index) => makePage({
    id: `card-${index}`, parentId: db.id, title: `Record ${String(index).padStart(5, '0')}`,
    values: { notes: `Notes ${index}`, amount: index, stage: index % 2 ? 'Done' : 'Todo', team: index % 4 < 2 ? 'Product' : 'Engineering' },
    blocks: [{ type: 'paragraph', content: `Preview ${index} ordinary offline text. `.repeat(8) }],
  }))];
  workspace.activePageId = db.id;
  workspace.expanded = [];
  workspace.recent = [];
  workspace.spaces = {};
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR', 'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL', 'MINI_NOTION_AGENT_CLAUDE', 'MINI_NOTION_AGENT_CODEX']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const hidden = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  expect(await hidden()).toBe(true);
  const surface = page.locator(type === 'board' ? '.board-outer' : type === 'list' ? '.database-list' : type === 'feed' ? '.feed-view' : '.gallery-view');
  await surface.locator('[data-record-id="card-0"]').waitFor();
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const update = (changes: Record<string, unknown>) => api('view.update', { databaseId: db.id, viewId: 'cards', changes });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scroll = async (fraction: number) => {
    await page.locator('.page-scroll').first().evaluate((node, fraction) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction; }, fraction);
    await frame();
  };
  const close = async () => {
    try {
      expect(await hidden()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
  return { app, page, surface, api, update, frame, scroll, close, directory };
}

async function visibleCards(page: BrowserPage) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.page-scroll')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.database-card')].filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.top < viewport.bottom && rect.bottom > viewport.top && rect.left < viewport.right && rect.right > viewport.left;
    }).length;
  });
}

test('board and gallery cards open with Space and Enter from keyboard focus', async () => {
  test.setTimeout(90000);
  for (const type of ['board', 'gallery'] as const) {
    const { page, surface, close } = await fixture(type);
    try {
      const card = surface.locator('[data-record-id="card-0"]');
      await card.focus();
      await page.keyboard.press('Space');
      await expect(page.locator('.peek-panel .page-title')).toHaveValue('Record 00000');
      await page.getByRole('button', { name: '关闭预览', exact: true }).click();
      await card.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.peek-panel .page-title')).toHaveValue('Record 00000');
    } finally { await close(); }
  }
});

test('large board keeps complete groups, keyboard order, native drag and saved records while windowing cards', async () => {
  test.setTimeout(180000);
  const { page, surface, api, update, scroll, close } = await fixture('board');
  try {
    const column = (key: string) => surface.locator(`.board-column[data-group-key="${key}"]`);
    const card = (id: string) => surface.locator(`[data-record-id="${id}"]`);
    await expect.poll(() => surface.locator('[data-record-id]').count()).toBeLessThan(100);
    await expect(column('Todo').locator('.board-column-title small')).toHaveText('320');
    await expect(column('Done').locator('.board-column-title small')).toHaveText('320');
    await card('card-0').focus();
    for (let index = 1; index <= 25; index++) {
      await page.keyboard.press('Tab');
      await expect(card(`card-${index * 2}`)).toBeFocused();
    }
    for (let index = 24; index >= 0; index--) {
      await page.keyboard.press('Shift+Tab');
      await expect(card(`card-${index * 2}`)).toBeFocused();
    }
    await page.locator('.page-title').focus();
    for (const fraction of [1, 0.5, 0, 1, 0]) {
      await scroll(fraction);
      await expect.poll(() => visibleCards(page)).toBeGreaterThan(0);
      await expect.poll(() => surface.locator('[data-record-id]').count()).toBeLessThan(100);
    }
    await card('card-4').dragTo(card('card-0'), { targetPosition: { x: 15, y: 5 } });
    await expect(column('Todo').locator('[data-record-id]').first()).toHaveAttribute('data-record-id', 'card-4');
    await card('card-4').dragTo(card('card-1'), { targetPosition: { x: 15, y: 5 } });
    await expect.poll(async () => (await api('page.get', { pageId: 'card-4' })).values.stage).toBe('Done');
    await expect(column('Done').locator('.board-column-title small')).toHaveText('321');
    await card('card-4').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(card('card-4')).toBeFocused();
    const view = () => api('view.list', { databaseId: 'cards-db' }).then(views => views.find((item: { id: string }) => item.id === 'cards'));
    await expect.poll(async () => (await view()).manualOrder.filter((id: string) => id === 'card-4' || Number(id.slice(5)) % 2 === 1).slice(0, 2)).toEqual(['card-1', 'card-4']);
    await expect.poll(() => column('Done').locator('[data-record-id]').evaluateAll(cards => cards.slice(0, 2).map(card => card.getAttribute('data-record-id')))).toEqual(['card-1', 'card-4']);
    await page.getByRole('button', { name: '折叠分组 Done', exact: true }).click();
    await expect(column('Done').locator('[data-record-id]')).toHaveCount(0);
    await page.getByRole('button', { name: '展开分组 Done', exact: true }).click();
    await expect(card('card-4')).toHaveCount(1);
    await update({ subGroupBy: 'team' });
    await expect(surface.locator('section[data-subgroup-key="Product"] .board-column[data-group-key="Todo"] .board-column-title small')).toHaveText('159');
    await expect(surface.locator('section[data-subgroup-key="Engineering"] .board-column[data-group-key="Todo"] .board-column-title small')).toHaveText('160');
    await api('view.update', { databaseId: 'cards-db', viewId: 'cards', unset: ['subGroupBy'] });
    await update({ sorts: [{ id: 'amount-desc', property: 'amount', direction: 'desc' }] });
    await scroll(0);
    await expect(column('Todo').locator('[data-record-id]').first()).toHaveAttribute('data-record-id', 'card-638');
    await expect(card('card-638')).toHaveAttribute('draggable', 'false');
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('Record 00639');
    await expect(surface.locator('[data-record-id]')).toHaveCount(1);
    await expect(card('card-639')).toBeVisible();
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('');
    await update({ sorts: [] });
    await scroll(0);
    await card('card-4').click();
    await page.locator('.peek-panel .page-title').fill('Durable board edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'card-4' })).title).toBe('Durable board edit');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(card('card-4')).toContainText('Durable board edit');
    await expect(column('Done').locator('.board-column-title small')).toHaveText('321');
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count);
    await scroll(0);
    await card('card-4').focus();
    await page.keyboard.press('Tab');
    const source = card('card-1');
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    await page.evaluate(() => {
      (window as any).cardDragEvents = [];
      for (const type of ['dragstart', 'drop', 'dragend']) document.addEventListener(type, event => {
        (window as any).cardDragEvents.push({ type, trusted: event.isTrusted });
      }, { capture: true });
    });
    await page.mouse.move(sourceBox!.x + 30, sourceBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + 45, sourceBox!.y + 30, { steps: 3 });
    await expect.poll(() => page.evaluate(() => (window as any).cardDragEvents.some((event: { type: string }) => event.type === 'dragstart'))).toBe(true);
    await scroll(1);
    await expect(source).toHaveCount(1);
    const target = card('card-639');
    await target.scrollIntoViewIfNeeded();
    const targetBox = await target.boundingBox();
    await page.mouse.move(targetBox!.x + 20, targetBox!.y + targetBox!.height - 5, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await view()).manualOrder.at(-1)).toBe('card-1');
    const dragEvents = await page.evaluate(() => (window as any).cardDragEvents as { type: string; trusted: boolean }[]);
    expect(dragEvents.some(event => event.type === 'drop')).toBe(true);
    expect(dragEvents.every(event => event.trusted)).toBe(true);
  } finally { await close(); }
});

test('large gallery keeps responsive measured rows, tab navigation, search, edits and complete PDF output', async ({}, info) => {
  test.setTimeout(180000);
  const { app, page, surface, api, update, scroll, close, directory } = await fixture('gallery');
  try {
    const card = (id: string) => surface.locator(`[data-record-id="${id}"]`);
    await expect.poll(() => surface.locator('[data-record-id]').count()).toBeLessThan(100);
    await card('card-0').focus();
    for (let index = 1; index <= 40; index++) {
      await page.keyboard.press('Tab');
      await expect(card(`card-${index}`)).toBeFocused();
    }
    for (let index = 39; index >= 0; index--) {
      await page.keyboard.press('Shift+Tab');
      await expect(card(`card-${index}`)).toBeFocused();
    }
    await page.locator('.page-title').focus();
    for (const fraction of [1, 0.5, 0, 1, 0]) {
      await scroll(fraction);
      await expect.poll(() => visibleCards(page)).toBeGreaterThan(0);
      await expect.poll(() => surface.locator('[data-record-id]').count()).toBeLessThan(100);
    }
    await api('page.update', { pageId: 'card-0', title: 'Wrapped title with multiple words '.repeat(15) });
    await api('page.update', { pageId: 'card-639', title: 'Tall last card '.repeat(45) });
    await expect.poll(() => card('card-0').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(300);
    await scroll(1);
    await expect.poll(() => page.locator('.page-scroll').first().evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    await expect(card('card-639')).toBeInViewport();
    const wideColumns = await surface.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 650));
    await scroll(0);
    await expect.poll(() => visibleCards(page)).toBeGreaterThan(0);
    await expect.poll(() => surface.locator('.card-window-row').first().evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBeLessThan(wideColumns);
    const narrowColumns = await surface.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    await expect.poll(() => surface.locator('.card-window-row').first().evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(narrowColumns);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await update({ cardSize: 'small', cardPreview: 'none' });
    await scroll(0);
    await expect(surface.locator('.gallery-preview')).toHaveCount(0);
    await expect.poll(() => surface.locator('.card-window-row').first().evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBeGreaterThan(1);
    await update({ groupBy: 'stage' });
    await expect(page.locator('section[data-group-key="Todo"] .database-group-heading small')).toHaveText('320');
    await page.getByRole('button', { name: '折叠分组 Todo', exact: true }).click();
    await expect(page.locator('section[data-group-key="Todo"] [data-record-id]')).toHaveCount(0);
    await page.getByRole('button', { name: '展开分组 Todo', exact: true }).click();
    await card('card-0').click();
    await expect(page.locator('.peek-panel .page-title')).toHaveValue(/Wrapped title with multiple words/);
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect(card('card-0')).toHaveCount(1);
    await expect.poll(() => page.locator('section[data-group-key="Todo"] .gallery-card').count()).toBeLessThan(100);
    await api('view.update', { databaseId: 'cards-db', viewId: 'cards', unset: ['groupBy'] });
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('Record 00500');
    await expect(surface.locator('[data-record-id]')).toHaveCount(1);
    await card('card-500').click();
    await page.locator('.peek-panel .page-title').fill('Durable gallery edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('');
    await expect.poll(async () => (await api('page.get', { pageId: 'card-500' })).title).toBe('Durable gallery edit');
    await api('page.update', { pageId: 'card-639', title: 'PDFTAIL0639' });
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('Durable gallery edit');
    await expect(card('card-500')).toHaveCount(1);
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('');
    const output = path.join(directory, 'cards.pdf');
    await api('file.export', { pageId: 'cards-db', type: 'pdf', output });
    const compact = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).replace(/\s+/g, '');
    expect(compact).toContain('Record00320');
    expect(compact).toContain('PDFTAIL0639');
    fs.copyFileSync(output, info.outputPath('complete-gallery.pdf'));
    await page.screenshot({ path: info.outputPath('windowed-gallery.png') });
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count);
    const child = await api('subitem.create', { pageId: 'card-0', title: 'Nested card fixture', color: 'white' });
    await update({ subItemDisplay: 'card' });
    await scroll(0);
    const childButton = card('card-0').getByRole('button', { name: 'Nested card fixture', exact: false });
    await expect(childButton).toHaveCount(1);
    await childButton.focus();
    await scroll(1);
    await expect(childButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card('card-1')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(childButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.peek-panel .page-title')).toHaveValue('Nested card fixture');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    expect((await api('page.get', { pageId: child.id })).subItemOf).toBe('card-0');
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count);
    await update({ subItemDisplay: 'flat' });
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count + 1);
    await api('page.update', { pageId: 'cards-db', locked: true });
    await expect(card('card-0')).toHaveAttribute('draggable', 'false');
  } finally { await close(); }
});

test('large list windows real rows while keeping search, grouping, sub-items, edits and reload usable', async () => {
  test.setTimeout(180000);
  const { page, surface, api, update, scroll, close } = await fixture('list');
  try {
    const row = (id: string) => surface.locator(`[data-record-id="${id}"]`);
    await expect.poll(() => surface.locator('.database-list-row').count()).toBeLessThan(80);
    for (const fraction of [0.5, 1, 0.25, 0]) {
      await scroll(fraction);
      await expect.poll(() => surface.locator('.database-list-row').count()).toBeLessThan(80);
      await expect.poll(() => surface.locator('.database-list-row').count()).toBeGreaterThan(0);
    }
    await scroll(1);
    await expect(row('card-639').getByRole('button', { name: /Record 00639/ })).toBeInViewport();
    await scroll(0);

    await update({ groupBy: 'stage' });
    await expect(surface.locator('section[data-group-key="Todo"] .database-group-heading small')).toHaveText('320');
    await expect(surface.locator('section[data-group-key="Done"] .database-group-heading small')).toHaveText('320');
    await page.getByRole('button', { name: '折叠分组 Todo', exact: true }).click();
    await expect(surface.locator('section[data-group-key="Todo"] .database-list-row')).toHaveCount(0);
    await page.getByRole('button', { name: '展开分组 Todo', exact: true }).click();
    await expect(row('card-0')).toHaveCount(1);
    await api('view.update', { databaseId: 'cards-db', viewId: 'cards', unset: ['groupBy'] });

    const child = await api('subitem.create', { pageId: 'card-0', title: 'List nested child', color: 'white' });
    await update({ subItemDisplay: 'nested' });
    await scroll(0);
    await expect(row(child.id)).toHaveCount(1);
    await expect(row(child.id).locator('.record-title-tree')).toHaveCSS('padding-left', '18px');
    await page.getByRole('button', { name: '折叠 Record 00000 的子项目', exact: true }).click();
    await expect(row(child.id)).toHaveCount(0);
    await page.getByRole('button', { name: '展开 Record 00000 的子项目', exact: true }).click();
    await expect(row(child.id)).toHaveCount(1);

    const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
    await search.fill('Record 00639');
    await expect(surface.locator('.database-list-row')).toHaveCount(1);
    await row('card-639').locator('.database-row-title').click();
    await page.locator('.peek-panel .page-title').fill('Durable list edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'card-639' })).title).toBe('Durable list edit');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('Durable list edit');
    await expect(row('card-639')).toContainText('Durable list edit');
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count + 1);
  } finally { await close(); }
});

test('large feed windows updates while preserving grouping, live checkboxes, edits, focus and full export', async () => {
  test.setTimeout(180000);
  const { page, surface, api, update, scroll, close, directory } = await fixture('feed');
  try {
    const record = (id: string) => surface.locator(`.feed-record[data-record-id="${id}"]`);
    await expect.poll(() => surface.locator('.feed-record').count()).toBeLessThan(60);
    for (const fraction of [0.5, 1, 0.25, 0]) {
      await scroll(fraction);
      await expect.poll(() => surface.locator('.feed-record').count()).toBeLessThan(60);
      await expect.poll(() => surface.locator('.feed-record').count()).toBeGreaterThan(0);
    }
    await scroll(1);
    await expect(record('card-639')).toBeInViewport();
    await scroll(0);
    await page.screenshot({ path: test.info().outputPath('windowed-feed.png'), animations: 'disabled' });

    await api('page.update', { pageId: 'card-0', changes: { blocks: [
      { type: 'checkListItem', props: { checked: false }, content: 'Feed task checkbox' },
    ] } });
    const checkbox = record('card-0').getByRole('checkbox', { name: 'Feed task checkbox' });
    await expect(checkbox).toHaveCount(1);
    await checkbox.check();
    await expect.poll(async () => (await api('page.get', { pageId: 'card-0' })).blocks[0].props.checked).toBe(true);
    await checkbox.focus();
    await scroll(1);
    await expect(checkbox).toBeFocused();
    await expect(record('card-0')).toHaveCount(1);
    await scroll(0);

    await update({ groupBy: 'stage' });
    await expect(surface.locator('section[data-group-key="Todo"] .database-group-heading small')).toHaveText('320');
    await expect(surface.locator('section[data-group-key="Done"] .database-group-heading small')).toHaveText('320');
    await page.getByRole('button', { name: '折叠分组 Done', exact: true }).click();
    await expect(surface.locator('section[data-group-key="Done"] .feed-record')).toHaveCount(0);
    await page.getByRole('button', { name: '展开分组 Done', exact: true }).click();
    await api('view.update', { databaseId: 'cards-db', viewId: 'cards', unset: ['groupBy'] });
    await scroll(0);
    await record('card-0').getByRole('button', { name: '打开 Record 00000', exact: true }).click();
    await page.locator('.peek-panel .page-title').fill('Durable feed edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'card-0' })).title).toBe('Durable feed edit');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
    await search.fill('Durable feed edit');
    await expect(record('card-0')).toContainText('Durable feed edit');
    await expect(record('card-0').getByRole('checkbox', { name: 'Feed task checkbox' })).toBeChecked();
    await search.fill('');
    const output = path.join(directory, 'feed.pdf');
    await api('file.export', { pageId: 'cards-db', type: 'pdf', output });
    const pdfText = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).replace(/\s+/g, '');
    expect(pdfText).toContain('Record00639');
    expect(pdfText).toContain('Durablefeededit');
    expect((await api('record.list', { databaseId: 'cards-db' })).length).toBe(count);
  } finally { await close(); }
});
