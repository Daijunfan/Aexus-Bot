import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('wide filtered table searches, sorts and persists without showing a desktop window', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-wide-filter-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = Array.from({ length: 80 }, (_, index) => ({
    id: `field-${index}`, name: `属性${index}`, type: (index === 0 ? 'number' : 'text') as 'number' | 'text',
  }));
  database.views = [{
    id: 'wide-view', name: '宽表优先任务', type: 'table', openPagesIn: 'side',
    filters: { id: 'filters', conjunction: 'and', rules: [
      { id: 'priority', property: 'field-79', operator: 'is', value: '优先' },
      { id: 'ready', property: 'field-78', operator: 'is', value: '已准备' },
    ] },
    sorts: [{ id: 'index', property: 'field-0', direction: 'asc' }],
  }];
  database.activeViewId = 'wide-view';
  const root = makePage({ id: 'wide-filter-db', title: '宽表筛选验收', database, fullWidth: true, blocks: [] });
  workspace.pages = [root, ...Array.from({ length: 350 }, (_, index) => makePage({
    id: `row-${index}`, parentId: root.id, title: `任务${index}`,
    values: { 'field-0': index, 'field-78': '已准备',
      'field-79': index % 7 === 0 ? '优先' : '普通' },
  }))];
  workspace.activePageId = root.id;
  workspace.expanded = [];
  workspace.recent = [];
  workspace.spaces = {};
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR',
    'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL',
    'MINI_NOTION_AGENT_CLAUDE', 'MINI_NOTION_AGENT_CODEX']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const hidden = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  try {
    expect(await hidden()).toBe(true);
    const table = page.locator('.database-table.enhanced-table');
    await table.locator('tbody tr[data-row-id]').first().waitFor();
    await expect(table.locator('tbody tr[data-row-id]').first()).toHaveAttribute('data-row-id', 'row-0');
    await expect(table.locator('tr[data-row-id="row-1"]')).toHaveCount(0);
    const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
    await search.fill('任务343');
    await expect(table.locator('tr[data-row-id="row-343"]')).toBeVisible();
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(1);
    await search.fill('任务136');
    await expect(page.getByRole('status').filter({ hasText: '没有匹配的记录' })).toBeVisible();
    await search.press('Escape');
    await page.getByRole('button', { name: '属性0列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '降序排列', exact: true }).click();
    await expect(table.locator('tbody tr[data-row-id]').first()).toHaveAttribute('data-row-id', 'row-343');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(table.locator('tbody tr[data-row-id]').first()).toHaveAttribute('data-row-id', 'row-343');
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
