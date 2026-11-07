import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('large chart drilldown windows records while keeping keyboard, filtering, edits and PDF complete', async () => {
  test.setTimeout(180000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-chart-window-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Done'] },
    { id: 'amount', name: 'Amount', type: 'number' },
  ];
  database.views = [{
    id: 'large-chart', name: 'Chart', type: 'chart', chartGroup: 'stage',
    chartAggregation: 'count', chartType: 'bar', openPagesIn: 'side',
  }];
  database.activeViewId = 'large-chart';
  const db = makePage({ id: 'chart-db', title: 'Chart drilldown fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 640 }, (_, index) => makePage({
    id: `chart-${index}`, parentId: db.id, title: `Record ${String(index).padStart(5, '0')}`,
    values: { stage: index === 639 ? 'Done' : 'Todo', amount: index },
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
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const chart = page.locator('.chart-view');
  const drilldown = chart.locator('.chart-drilldown');
  const record = (id: number) => drilldown.locator(`[data-record-id="chart-${id}"]`);
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const scroll = async (fraction: number) => {
    await page.locator('.page-scroll').first().evaluate((node, fraction) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
    }, fraction);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await expect(chart.locator('.chart-mark')).toHaveCount(2);
    await chart.locator('.chart-mark').first().click();
    await expect(drilldown.locator('h4')).toContainText('Todo');
    await expect(drilldown.locator('.chart-drilldown-rows.windowed-cards')).toHaveCount(1);
    await expect.poll(() => drilldown.locator('[data-record-id]').count()).toBeLessThan(65);

    const lastMounted = await drilldown.locator('[data-record-id]').last().getAttribute('data-record-id');
    await drilldown.locator(`[data-record-id="${lastMounted}"]`).focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.closest<HTMLElement>('[data-record-id]')?.dataset.recordId,
    )).toBe(`chart-${Number(lastMounted!.slice(6)) + 1}`);

    await scroll(1);
    await expect(record(638)).toHaveCount(1);
    await expect.poll(() => drilldown.locator('[data-record-id]').count()).toBeLessThan(65);
    await record(638).click();
    await page.locator('.peek-panel .page-title').fill('Durable chart edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'chart-638' })).title)
      .toBe('Durable chart edit');
    await scroll(0);
    await chart.locator('.chart-mark').nth(1).click();
    await expect(drilldown.locator('h4')).toContainText('Done');
    await expect(page.locator('.chart-drilldown > button')).toHaveCount(1);
    await expect(record(639)).toHaveCount(1);
    await chart.locator('.chart-mark').first().click();
    await expect(drilldown.locator('.chart-drilldown-rows.windowed-cards')).toHaveCount(1);

    await page.getByRole('combobox', { includeHidden: true, name: '图表计算' }).selectOption('sum');
    const metric = page.getByRole('combobox', { includeHidden: true, name: '图表数值属性' });
    await expect(metric).toHaveValue('amount');
    await expect.poll(async () => (await api('view.render', { databaseId: db.id, viewId: 'large-chart' }))
      .series.find((item: { name: string }) => item.name === 'Done')?.value).toBe(639);
    await expect(chart.locator('.chart-mark')).toHaveCount(2);
    await page.reload();
    await chart.locator('.chart-mark').first().click();
    await scroll(1);
    await expect(record(638)).toContainText('Durable chart edit');

    const output = path.join(directory, 'chart.pdf');
    await api('file.export', { pageId: db.id, type: 'pdf', output });
    const pdfText = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .replace(/\s+/g, '');
    expect(pdfText).toContain('Todo');
    expect(pdfText).toContain('Done');
    expect(pdfText).toContain('203841');
    expect((await api('record.list', { databaseId: db.id })).length).toBe(640);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
