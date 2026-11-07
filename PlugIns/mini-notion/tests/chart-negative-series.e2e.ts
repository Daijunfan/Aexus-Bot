import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('chart line marks follow negative series values and keyboard toggles drilldown', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-chart-negative-')));
  const workspace = createWorkspace();
  const database = defaultDatabase();
  database.columns = [
    { id: 'stage', name: '类别', type: 'select', options: ['收入', '亏损', '利润'] },
    { id: 'amount', name: '金额', type: 'number' },
  ];
  database.views = [{
    id: 'negative-chart', name: '带负值的折线图', type: 'chart',
    chartGroup: 'stage', chartAggregation: 'sum', chartValue: 'amount', chartType: 'line',
  }];
  database.activeViewId = 'negative-chart';
  const db = makePage({ id: 'negative-db', title: '负值图表验收', database, blocks: [] });
  workspace.pages = [
    db,
    makePage({ id: 'positive', title: '销售收入', parentId: db.id, values: { stage: '收入', amount: 10 } }),
    makePage({ id: 'negative', title: '项目亏损', parentId: db.id, values: { stage: '亏损', amount: -8 } }),
    makePage({ id: 'profit', title: '结余利润', parentId: db.id, values: { stage: '利润', amount: 4 } }),
  ];
  workspace.activePageId = db.id;
  workspace.expanded = [];
  workspace.recent = [];
  workspace.spaces = {};
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR',
    'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({
    executablePath, args: executablePath ? [] : [path.resolve(import.meta.dirname, '..')], env,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const chart = page.locator('.chart-view');
    await expect(chart.locator('.chart-mark')).toHaveCount(3);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    const points = (await chart.locator('polyline').getAttribute('points'))!.split(' ').map(point => Number(point.split(',')[1]));
    const markers = chart.locator('.chart-mark');
    for (let index = 0; index < 3; index++) {
      const dotY = Number(await markers.nth(index).locator('circle').getAttribute('cy'));
      expect(dotY).toBeCloseTo(points[index], 3);
    }
    expect(points[1]).toBeGreaterThan(points[0]);
    expect(points[1]).toBeGreaterThan(points[2]);

    await markers.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(chart.locator('.chart-drilldown')).toContainText('项目亏损');
    await page.keyboard.press('Enter');
    await expect(chart.locator('.chart-drilldown')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(chart.locator('.chart-drilldown')).toContainText('项目亏损');
    await page.keyboard.press('Space');
    await expect(chart.locator('.chart-drilldown')).toHaveCount(0);

    await page.getByRole('combobox', { includeHidden: true, name: '图表类型' }).selectOption('bar');
    await expect(chart.locator('.chart-mark rect')).toHaveCount(3);
    await page.getByRole('combobox', { includeHidden: true, name: '图表类型' }).selectOption('line');
    await page.reload();
    await expect(chart.locator('polyline')).toHaveCount(1);
    const after = Number(await chart.locator('.chart-mark').nth(1).locator('circle').getAttribute('cy'));
    expect(after).toBeCloseTo(points[1], 3);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
