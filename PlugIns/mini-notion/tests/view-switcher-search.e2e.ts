import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('searchable view switcher selects a matching view with Enter and persists', async () => {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-view-switcher-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app;
  const errors: string[] = [];
  const launch = async () => {
    app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.page-title').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(win => !win.isVisible()))).toBe(true);
    return page;
  };
  try {
    let page = await launch();
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
      if (reply.error) throw new Error(reply.error.message);
      return reply.result;
    };
    const database = await api('database.create', { title: '视图查找验收', color: 'white' });
    await api('page.open', { pageId: database.id });
    for (const [type, name] of [
      ['board', '项目进度与交付检查视图'],
      ['list', '个人待办与阅读收集视图'],
      ['calendar', '每周项目日程安排视图'],
    ]) {
      await page.getByRole('button', { name: '添加视图', exact: true }).click();
      const create = page.getByRole('dialog', { name: '新建视图' });
      await create.getByRole('button', { name: type === 'board' ? /^看板/ : type === 'list' ? /^列表/ : /^日历/ }).click();
      await create.getByRole('textbox', { name: '新视图名称' }).fill(name);
      await create.getByRole('button', { name: '创建视图', exact: true }).click();
    }
    await expect.poll(async () => (await api('view.list', { databaseId: database.id })).length).toBe(4);
    const views = await api('view.list', { databaseId: database.id });
    await page.setViewportSize({ width: 640, height: 560 });
    await page.getByRole('button', { name: '全部视图', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索视图', exact: true });
    await expect(search).toBeFocused();
    await search.fill('项目');
    await expect(page.locator('.view-switcher-row')).toHaveCount(2);
    await search.fill('每周项目');
    await expect(page.locator('.view-switcher-row')).toHaveCount(1);
    await search.press('Enter');
    const chosen = views.find((view: { name: string }) => view.name === '每周项目日程安排视图');
    await expect(page.locator(`[data-view-id="${chosen.id}"]`)).toHaveClass(/active/);
    await page.screenshot({ path: test.info().outputPath('view-switcher-narrow.png'), animations: 'disabled' });
    await app!.close();
    app = undefined;
    page = await launch();
    await api('page.open', { pageId: database.id });
    await expect(page.locator(`[data-view-id="${chosen.id}"]`)).toHaveClass(/active/);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
