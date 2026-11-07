import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('single-assignee board drag and group quick-add preserve a complete person record', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-person-board-')));
  const env = {
    ...process.env,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_DATA_DIR: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  try {
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'],
      env,
    });
    const page: Page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.page-title').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params),
        { method, params });
      if (reply.error) throw new Error(reply.error.message);
      return reply.result;
    };

    const alice = await api('person.create', { name: '小王', email: 'alice@example.test' });
    const bob = await api('person.create', { name: '小李', email: 'bob@example.test' });
    const databasePage = await api('database.create', {
      title: '人员看板交互回归', color: 'white',
      columns: [{ id: 'owner', name: '负责人', type: 'person', personLimit: 1 }],
    });
    const board = await api('view.create', {
      databaseId: databasePage.id, name: '负责人看板', type: 'board',
      config: { groupBy: 'owner', hideEmptyGroups: true },
    });
    await api('view.select', { databaseId: databasePage.id, viewId: board.id });
    const moving = await api('record.create', {
      databaseId: databasePage.id, title: '待转派', color: 'white', values: { owner: alice.id },
    });
    const target = await api('record.create', {
      databaseId: databasePage.id, title: '已有负责人', color: 'white', values: { owner: bob.id },
    });
    await api('page.open', { pageId: databasePage.id });
    const database = page.locator('.database[data-database-id="' + databasePage.id + '"]');
    const group = (personId: string) => database.locator('[data-group-key="' + personId + '"]');
    const movingCard = group(alice.id).locator('[data-record-id="' + moving.id + '"]');
    const bobGroup = group(bob.id);
    await expect(movingCard).toBeVisible();
    await expect(bobGroup.locator('[data-record-id="' + target.id + '"]')).toBeVisible();
    await movingCard.dragTo(bobGroup.locator('.board-cards'));
    await expect(bobGroup.locator('[data-record-id="' + moving.id + '"]')).toBeVisible();
    await expect.poll(async () => (await api('page.get', { pageId: moving.id })).values.owner)
      .toEqual([bob]);

    await bobGroup.locator('.board-add').click();
    const title = page.locator('.peek-panel .page-title');
    await expect(title).toBeVisible();
    await title.fill('同组新任务');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('record.list', { databaseId: databasePage.id }))
      .some((row: { title: string }) => row.title === '同组新任务')).toBe(true);
    const matching = (await api('record.list', { databaseId: databasePage.id }))
      .find((row: { title: string }) => row.title === '同组新任务');
    expect(matching.values.owner).toEqual([bob]);

    // Two different people can share a display name; the unique count must use identity.
    const namesake = await api('person.create', { name: '小李', email: 'namesake@example.test' });
    await api('record.create', {
      databaseId: databasePage.id, title: '同名不同人', color: 'white',
      values: { owner: namesake.id },
    });
    const tableView = await api('view.create', {
      databaseId: databasePage.id, name: '人员统计表', type: 'table',
      config: { calculations: { owner: 'count_unique' } },
    });
    await api('view.select', { databaseId: databasePage.id, viewId: tableView.id });
    await api('page.open', { pageId: databasePage.id });
    const table = database.locator('.database-table.enhanced-table');
    await expect(table.locator('tfoot .column-calculation')).toContainText('计数唯一值');
    await expect(table.locator('tfoot .column-calculation strong')).toHaveText('2');

    // The same person group must initialize a complete assignee when adding a table record.
    await api('view.update', {
      databaseId: databasePage.id, viewId: tableView.id,
      changes: { groupBy: 'owner', hideEmptyGroups: true },
    });
    const bobTableGroup = group(bob.id);
    await expect(bobTableGroup.locator('.database-table.enhanced-table')).toBeVisible();
    await bobTableGroup.locator('.database-add-row').click();
    const tableTitle = page.locator('.peek-panel .page-title');
    await expect(tableTitle).toBeVisible();
    await tableTitle.fill('表格分组新任务');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('record.list', { databaseId: databasePage.id }))
      .some((row: { title: string }) => row.title === '表格分组新任务')).toBe(true);
    const tableRecord = (await api('record.list', { databaseId: databasePage.id }))
      .find((row: { title: string }) => row.title === '表格分组新任务');
    expect(tableRecord.values.owner).toEqual([bob]);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
