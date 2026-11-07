import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('conditional color rules work across local views and persist after restart', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-colors-'));
  let app: ElectronApplication | undefined;
  let page: Page;
  const errors: string[] = [];
  const launch = async () => {
    const env = {
      ...process.env,
      MINI_NOTION_DATA_DIR: data,
      MINI_NOTION_TEST: '1',
      MINI_NOTION_BACKGROUND_TEST: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE, args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.page-title').waitFor();
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), {
      method,
      params,
    });
    if (response.error) throw new Error(response.error.message);
    return response.result;
  };
  try {
    await launch();
    await api('settings.set', { changes: { theme: 'light' } });
    const database = await api('database.create', {
      title: '条件颜色验收',
      color: 'white',
      columns: [
        { id: 'amount', name: '金额', type: 'number' },
        { id: 'status', name: '状态', type: 'select', options: ['进行中', '已完成'] },
        { id: 'date', name: '日期', type: 'date' },
      ],
    });
    const urgent = await api('record.create', {
      databaseId: database.id,
      title: '高优先级',
      color: 'white',
      values: { amount: 20, status: '进行中', date: '2026-10-11' },
    });
    await api('record.create', {
      databaseId: database.id,
      title: '常规记录',
      color: 'white',
      values: { amount: 5, status: '进行中', date: '2026-10-11' },
    });
    await api('page.open', { pageId: database.id });
    const table = (await api('view.list', { databaseId: database.id }))[0];
    await page.getByRole('button', { name: '数据库设置', exact: true }).click();
    await page.getByRole('menuitem', { name: /^条件颜色/ }).click();
    await page.getByRole('menuitem', { name: '添加颜色规则', exact: true }).click();
    const settings = page.locator('.view-settings');
    await settings.getByRole('button', { name: '添加条件', exact: true }).click();
    await settings.getByLabel('筛选属性', { exact: true }).and(page.locator('select')).selectOption('amount');
    await settings.getByLabel('筛选运算符', { exact: true }).and(page.locator('select')).selectOption('gt');
    await settings.getByLabel('筛选内容', { exact: true }).fill('10');
    await settings.getByRole('button', { name: '背景颜色：浅绿', exact: true }).click();
    await expect
      .poll(
        async () => (await api('view.list', { databaseId: database.id }))[0].conditionalColors?.[0]?.color,
      )
      .toBe('green');
    await page.keyboard.press('Escape');
    const tableRow = () => page.locator('.database-table tbody tr').filter({ hasText: '高优先级' });
    await expect(tableRow()).toHaveCSS('background-color', 'rgb(234, 242, 235)');
    const saved = (await api('view.list', { databaseId: database.id }))[0].conditionalColors;
    const rules = [...saved, { ...saved[0], id: 'amount-cell', color: 'blue', targetProperty: 'amount' }];
    await api('view.update', {
      databaseId: database.id,
      viewId: table.id,
      changes: { conditionalColors: rules },
    });
    await expect(
      tableRow()
        .locator('td')
        .filter({ has: page.getByRole('spinbutton', { name: '金额', exact: true }) }),
    ).toHaveCSS('background-color', 'rgb(234, 242, 251)');
    for (const [type, selector] of [
      ['board', `.database-card[data-record-id="${urgent.id}"]`],
      ['gallery', `.database-card[data-record-id="${urgent.id}"]`],
      ['list', `.database-list-row[data-record-id="${urgent.id}"]`],
      ['calendar', `[data-calendar-id="${urgent.id}"]`],
      ['timeline', `[data-timeline-id="${urgent.id}"]`],
      ['feed', `.feed-record[data-record-id="${urgent.id}"]`],
      ['plan', `.plan-card[data-record-id="${urgent.id}"]`],
    ]) {
      const view = await api('view.create', {
        databaseId: database.id,
        type,
        name: type,
        config: {
          conditionalColors: rules,
          groupBy: type === 'board' ? 'status' : undefined,
          calendarBy: 'date',
          dateAnchor: '2026-10-11',
          planMode: 'week',
        },
      });
      await expect(page.locator(selector).first()).toHaveCSS('background-color', 'rgb(234, 242, 235)');
      expect(
        (await api('view.render', { databaseId: database.id, viewId: view.id })).records.find(
          (row: { id: string }) => row.id === urgent.id,
        ).conditionalColor,
      ).toBe('green');
    }
    await api('view.select', { databaseId: database.id, viewId: table.id });
    await api('settings.set', { changes: { theme: 'dark' } });
    await expect(tableRow()).toHaveCSS('background-color', 'rgb(34, 49, 41)');
    await page.screenshot({
      path: test.info().outputPath('conditional-colors-dark.png'),
      animations: 'disabled',
    });
    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: database.id });
    await api('view.select', { databaseId: database.id, viewId: table.id });
    await expect(tableRow()).toHaveCSS('background-color', 'rgb(34, 49, 41)');
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
