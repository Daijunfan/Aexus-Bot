import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('form multiselect labels toggle only their own option and blank names cannot submit', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-form-multiselect-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  const app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  try {
    await page.locator('.sidebar').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    const database = await api('database.create', { title: '表单真实交互验收', color: 'white', columns: [
      { id: 'tags', name: '需求标签', type: 'multiSelect', options: ['性能', '体验', '同步'] },
      { id: 'priority', name: '优先级', type: 'select', options: ['高', '中', '低'] },
    ] });
    const view = await api('view.create', { databaseId: database.id, type: 'form', name: '需求反馈' });
    await api('page.open', { pageId: database.id });
    const tab = page.locator('[data-view-id="' + view.id + '"]');
    if (!(await tab.getAttribute('class'))?.includes('active')) await tab.click();
    const form = page.locator('.database-form');
    await expect(form).toHaveCount(1);
    const option = (name: string) => form.locator('.form-multiselect label').filter({ hasText: name });
    const checked = async () => form.locator('.form-multiselect input:checked')
      .evaluateAll(elements => elements.map(element => element.closest('label')!.textContent!.trim()));
    await form.locator('.form-field').filter({ hasText: '需求标签' }).locator(':scope > span').click();
    expect(await checked()).toEqual([]);
    await option('体验').click();
    expect(await checked()).toEqual(['体验']);
    await option('性能').click();
    expect(await checked()).toEqual(['性能', '体验']);
    await option('体验').click();
    expect(await checked()).toEqual(['性能']);

    const title = form.getByRole('textbox', { name: '名称', exact: true });
    await title.fill('   ');
    await expect(form.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
    await expect(form.getByRole('alert')).toHaveText('名称不能只包含空格');
    await title.press('Enter');
    expect((await api('record.list', { databaseId: database.id })).length).toBe(0);

    await title.fill('  测试用户反馈  ');
    await expect(form.getByRole('alert')).toHaveCount(0);
    await form.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.locator('.form-success')).toContainText('已收到你的提交');
    await expect.poll(async () => (await api('record.list', { databaseId: database.id })).length).toBe(1);
    const records = await api('record.list', { databaseId: database.id });
    expect(records).toHaveLength(1);
    const record = await api('page.get', { pageId: records[0].id });
    expect(record.title).toBe('测试用户反馈');
    expect(record.values.tags).toEqual(['性能']);
    await page.getByRole('button', { name: '再提交一条' }).click();
    await expect(form.getByRole('textbox', { name: '名称' })).toHaveValue('');
    expect(await checked()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
