import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('unfinished OR filters and nested groups preserve visible records until entered', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-filter-draft-')));
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
    const database = await api('database.create', { title: '筛选草稿验收', color: 'white' });
    for (const title of ['甲任务', '乙任务', '丙任务'])
      await api('record.create', { databaseId: database.id, title, color: 'white' });
    await api('page.open', { pageId: database.id });
    const records = page.locator('.database-table tbody tr[data-row-id]');
    await expect(records).toHaveCount(3);
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.getByRole('button', { name: '添加条件', exact: true }).click();
    const values = page.getByRole('textbox', { name: '筛选内容', exact: true });
    await values.first().fill('甲');
    await expect(records).toHaveCount(1);
    await expect(records).toContainText('甲任务');
    await page.getByRole('combobox', { includeHidden: true, name: '筛选组合', exact: true }).first().selectOption('or');
    await expect(records).toHaveCount(1);
    await page.getByRole('button', { name: '添加条件', exact: true }).first().click();
    await expect(values).toHaveCount(2);
    await expect(records).toHaveCount(1);
    await page.getByRole('button', { name: '添加筛选组', exact: true }).first().click();
    await expect(records).toHaveCount(1);
    await values.nth(1).fill('乙');
    await expect(records).toHaveCount(2);
    await values.nth(1).fill('');
    await expect(records).toHaveCount(1);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(records).toHaveCount(1);
    await expect(records).toContainText('甲任务');
    const views = await api('view.list', { databaseId: database.id });
    expect(views[0].filters.conjunction).toBe('or');
    expect(views[0].filters.rules).toHaveLength(3);
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
