import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('gallery cards reorder by drag and keyboard, move between groups and persist on restart', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-gallery-order-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'VITE_DEV_SERVER_URL', 'AGENTS_COMPANY_PLUGIN_RPC']) delete env[key];
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const launch = () => electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  let app = await launch();
  let page = await app.firstWindow();
  const errors: string[] = [];
  const attachErrors = () => page.on('pageerror', error => errors.push(error.message));
  attachErrors();
  const hidden = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(reply.error).toBeUndefined();
    return reply.result;
  };
  try {
    expect(await hidden()).toBe(true);
    await page.locator('.page-title').waitFor();
    const db = await api('database.create', { title: '画廊手工排序验收', color: 'white',
      columns: [{ id: 'stage', name: '分类', type: 'select', options: ['待办', '进行中'] }] });
    const view = await api('view.create', { databaseId: db.id, type: 'gallery', name: '手工画廊',
      config: { groupBy: 'stage', cardPreview: 'none' } });
    await api('view.select', { databaseId: db.id, viewId: view.id });
    const ids: Record<string, string> = {};
    for (const title of ['甲', '乙', '丙', '丁']) {
      const row = await api('record.create', { databaseId: db.id, title, color: 'white',
        values: { stage: title === '丁' ? '进行中' : '待办' } });
      ids[title] = row.id;
    }
    await api('page.open', { pageId: db.id });
    const gallery = (key: string) => page.locator(`.database[data-database-id="${db.id}"] section[data-group-key="${key}"] .gallery-view`);
    const card = (group: string, id: string) => gallery(group).locator(`.gallery-card[data-record-id="${id}"]`);
    const order = (key: string) => gallery(key).locator('.gallery-card')
      .evaluateAll(cards => cards.map(element => element.getAttribute('data-record-id')));
    await expect(card('待办', ids['甲'])).toBeVisible();
    await card('待办', ids['甲']).dragTo(card('待办', ids['丙']), { targetPosition: { x: 185, y: 35 } });
    await expect.poll(() => order('待办')).toEqual([ids['乙'], ids['丙'], ids['甲']]);
    await card('待办', ids['丙']).dragTo(card('待办', ids['乙']), { targetPosition: { x: 5, y: 35 } });
    await expect.poll(() => order('待办')).toEqual([ids['丙'], ids['乙'], ids['甲']]);
    await card('待办', ids['丙']).dragTo(card('进行中', ids['丁']), { targetPosition: { x: 185, y: 35 } });
    await expect.poll(() => order('进行中')).toEqual([ids['丁'], ids['丙']]);
    await expect.poll(async () => (await api('page.get', { pageId: ids['丙'] })).values.stage).toBe('进行中');
    await card('待办', ids['甲']).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => order('待办')).toEqual([ids['甲'], ids['乙']]);
    const currentView = async () => (await api('view.list', { databaseId: db.id }))
      .find((candidate: { id: string }) => candidate.id === view.id);
    await expect.poll(async () => (await currentView()).manualOrder).toEqual(
      [ids['甲'], ids['乙'], ids['丁'], ids['丙']]);
    await api('view.update', { databaseId: db.id, viewId: view.id,
      changes: { sorts: [{ id: 'title-asc', property: 'title', direction: 'asc' }] } });
    await expect(card('待办', ids['甲'])).toHaveAttribute('draggable', 'false');
    await api('view.update', { databaseId: db.id, viewId: view.id, changes: { sorts: [] } });
    await expect.poll(() => order('待办')).toEqual([ids['甲'], ids['乙']]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    attachErrors();
    await page.locator('.page-title').waitFor();
    await api('page.open', { pageId: db.id });
    await expect.poll(() => order('待办')).toEqual([ids['甲'], ids['乙']]);
    await expect.poll(() => order('进行中')).toEqual([ids['丁'], ids['丙']]);
    expect((await currentView()).manualOrder).toEqual([ids['甲'], ids['乙'], ids['丁'], ids['丙']]);
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
