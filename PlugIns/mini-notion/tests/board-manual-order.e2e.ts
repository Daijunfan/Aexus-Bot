import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('board card order follows drag, survives group changes and restart', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-board-order-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env });
  let page = await app.firstWindow();
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  try {
    await page.locator('.page-title').waitFor();
    const database = await api('database.create', { title: '排序验收', color: 'white',
      columns: [{ id: 'stage', name: '分类', type: 'select', options: ['待办', '进行中'] }] });
    const view = await api('view.create', { databaseId: database.id, type: 'board', name: '手工', config: { groupBy: 'stage' } });
    await api('view.select', { databaseId: database.id, viewId: view.id });
    const ids: Record<string, string> = {};
    for (const title of ['甲', '乙', '丙', '丁']) {
      const row = await api('record.create', { databaseId: database.id, title, color: 'white', values: { stage: title === '丁' ? '进行中' : '待办' } });
      ids[title] = row.id;
    }
    await api('page.open', { pageId: database.id });
    const column = (key: string) => page.locator(`.database[data-database-id="${database.id}"] .board-column[data-group-key="${key}"]`);
    const card = (key: string, id: string) => column(key).locator(`.database-card[data-record-id="${id}"]`);
    const order = (key: string) => column(key).locator('.database-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-record-id')));
    await expect(card('待办', ids['丙'])).toBeVisible();
    await card('待办', ids['丙']).dragTo(card('待办', ids['甲']), { targetPosition: { x: 15, y: 5 } });
    await expect.poll(() => order('待办')).toEqual([ids['丙'], ids['甲'], ids['乙']]);
    await card('待办', ids['丙']).dragTo(card('进行中', ids['丁']), { targetPosition: { x: 15, y: 5 } });
    await expect.poll(() => order('进行中')).toEqual([ids['丙'], ids['丁']]);
    await expect.poll(async () => (await api('page.get', { pageId: ids['丙'] })).values.stage).toBe('进行中');
    await card('待办', ids['乙']).focus();
    await card('待办', ids['乙']).press('Alt+ArrowUp');
    await expect.poll(() => order('待办')).toEqual([ids['乙'], ids['甲']]);
    const getView = async () => (await api('view.list', { databaseId: database.id }))
      .find((candidate: { id: string }) => candidate.id === view.id);
    await expect.poll(async () => (await getView()).manualOrder)
      .toEqual([ids['乙'], ids['甲'], ids['丙'], ids['丁']]);
    await api('view.update', { databaseId: database.id, viewId: view.id,
      changes: { sorts: [{ id: 'name-sort', property: 'title', direction: 'asc' }] } });
    await expect(card('待办', ids['乙'])).toHaveAttribute('draggable', 'false');
    await expect.poll(() => order('待办')).toEqual([ids['甲'], ids['乙']]);
    await api('view.update', { databaseId: database.id, viewId: view.id, changes: { sorts: [] } });
    await expect.poll(() => order('待办')).toEqual([ids['乙'], ids['甲']]);
    await app.close();
    app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env });
    page = await app.firstWindow();
    await page.locator('.page-title').waitFor();
    await api('page.open', { pageId: database.id });
    await expect.poll(() => order('待办')).toEqual([ids['乙'], ids['甲']]);
    await expect.poll(() => order('进行中')).toEqual([ids['丙'], ids['丁']]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
