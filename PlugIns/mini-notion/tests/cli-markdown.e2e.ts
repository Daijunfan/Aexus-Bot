import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('CLI Markdown renders real tables from the same hidden GUI workspace', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-cli-markdown-')));
  const env = { ...process.env, MINI_NOTION_DATA_DIR: directory,
    MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({
    executablePath, args: executablePath ? [] : [path.resolve(import.meta.dirname, '..')], env,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  const cli = (format: 'markdown' | 'text', args: string[]) => {
    const script = executablePath
      ? path.resolve(path.dirname(executablePath), '..', 'Resources', 'cli', 'mininotion')
      : path.resolve(import.meta.dirname, '..', 'dist-cli', 'cli.cjs');
    return execFileSync(executablePath ? script : process.execPath, [
      ...(executablePath ? [] : [script]), '--data-dir', directory, '--no-start',
      '--format', format, ...args,
    ], { encoding: 'utf8', env, timeout: 30000 });
  };
  try {
    await page.locator('.sidebar').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    const db = await api('database.create', { title: 'CLI 同步数据', color: 'white', columns: [
      { id: 'stage', name: '阶段', type: 'select', options: ['进行中', '完成'] },
      { id: 'points', name: '分数', type: 'number' },
    ] });
    await api('record.create', { databaseId: db.id, title: '项目 | A <风险>',
      values: { stage: '进行中', points: 4 }, color: 'white' });
    await api('record.create', { databaseId: db.id, title: '项目 B',
      values: { stage: '完成', points: -2 }, color: 'white' });
    const view = (await api('view.list', { databaseId: db.id }))[0];
    await api('page.open', { pageId: db.id });
    await expect(page.locator('.enhanced-table tbody tr[data-row-id]')).toHaveCount(2);
    const records = cli('markdown', ['record', 'list', db.id]);
    expect(records).toContain('| 名称 | stage | points | ID |');
    expect(records).toContain('| --- | --- | --- | --- |');
    expect(records).toContain('项目 \\| A &lt;风险&gt;');
    expect(records).toContain('进行中');
    expect(records).toContain('-2');
    const viewOutput = cli('markdown', ['view', 'render', db.id, '--view-id', view.id]);
    expect(viewOutput).toContain('# CLI 同步数据');
    expect(viewOutput).toContain('**记录数：** 2');
    expect(viewOutput).toContain('## 记录');
    expect(viewOutput).toContain('| 名称 | 阶段 | 分数 | ID |');
    const plain = cli('text', ['view', 'render', db.id, '--view-id', view.id]);
    expect(plain).not.toContain('| 名称 | 阶段 | 分数 | ID |');
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
