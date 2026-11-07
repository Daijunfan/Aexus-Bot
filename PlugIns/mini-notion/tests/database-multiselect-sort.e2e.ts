import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('multi-select column sorting uses tag order and persists in a hidden desktop window', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-tags-sort-')));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR',
    'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL',
    'MINI_NOTION_AGENT_CLAUDE', 'MINI_NOTION_AGENT_CODEX']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  const page = await app.firstWindow();
  await page.locator('.page-title').waitFor();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const hidden = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  const api = async (method: string, params: Record<string, unknown>) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  try {
    expect(await hidden()).toBe(true);
    const database = await api('database.create', {
      title: '标签排序验收', color: 'white',
      columns: [{ id: 'tags', name: '标签', type: 'multiSelect', options: ['待办', '进行中', '完成'] }],
    });
    for (const [title, tags] of [
      ['已完成', ['完成']],
      ['无标签', []],
      ['进行中', ['进行中']],
      ['待办', ['待办']],
      ['跨阶段', ['完成', '待办']],
    ] as const) {
      await api('record.create', { databaseId: database.id, color: 'white', title, values: { tags } });
    }
    await api('page.open', { pageId: database.id });
    const titles = page.locator('.database-table .record-title-copy strong');
    await expect(titles).toHaveCount(5);
    await page.getByRole('button', { name: '标签列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '升序排列', exact: true }).click();
    await expect(titles).toHaveText(['待办', '跨阶段', '进行中', '已完成', '无标签']);
    await page.getByRole('button', { name: '标签列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '降序排列', exact: true }).click();
    await expect(titles).toHaveText(['无标签', '已完成', '进行中', '跨阶段', '待办']);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(titles).toHaveText(['无标签', '已完成', '进行中', '跨阶段', '待办']);
    const views = await api('view.list', { databaseId: database.id });
    expect(views[0].sorts).toEqual([expect.objectContaining({ property: 'tags', direction: 'desc' })]);
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
