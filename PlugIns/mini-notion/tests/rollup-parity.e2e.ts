import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('rollup calculations can be edited in the desktop and survive restart', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-rollup-'));
  const errors: string[] = [];
  let app: ElectronApplication | undefined;
  let page: Page;
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
    const target = await api('database.create', {
      title: '汇总来源',
      color: 'white',
      columns: [
        { id: 'amount', name: '金额', type: 'number' },
        { id: 'date', name: '日期', type: 'date' },
      ],
    });
    const recordIds: string[] = [];
    for (const amount of [0, 2, 8, 2, null]) {
      const row = await api('record.create', {
        databaseId: target.id,
        title: `金额 ${amount ?? '空'}`,
        color: 'white',
        values: amount === null ? {} : { amount, date: '2026-01-01' },
      });
      recordIds.push(row.id);
    }
    const source = await api('database.create', {
      title: '汇总验收',
      color: 'white',
      columns: [
        { id: 'related', name: '关联', type: 'relation', relationTo: target.id },
        {
          id: 'rollup',
          name: '汇总结果',
          type: 'rollup',
          relationProperty: 'related',
          targetProperty: 'amount',
          calculation: 'median',
        },
      ],
    });
    await api('record.create', {
      databaseId: source.id,
      title: '全部记录',
      color: 'white',
      values: { related: recordIds },
    });
    await api('page.open', { pageId: source.id });
    const value = () => page.locator('.database-table tbody .property-computed');
    await expect(value()).toHaveText('2');
    for (const [calculation, expected] of [
      ['range', '8'],
      ['percent_empty', '20%'],
      ['show_original', '0, 2, 8, 2'],
    ]) {
      await page.getByRole('button', { name: '汇总结果列选项', exact: true }).click();
      await page.getByRole('menuitem', { name: '编辑属性', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '编辑属性' });
      await modal
        .getByLabel('计算方式', { exact: true })
        .and(page.locator('select'))
        .selectOption(calculation);
      await modal.getByRole('button', { name: '完成', exact: true }).click();
      await expect(value()).toHaveText(expected);
      await expect
        .poll(
          async () =>
            (await api('property.list', { databaseId: source.id })).find(
              (property: { id: string }) => property.id === 'rollup',
            ).calculation,
        )
        .toBe(calculation);
    }
    await page.screenshot({
      path: test.info().outputPath('rollup-original-values.png'),
      animations: 'disabled',
    });
    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: source.id });
    await expect(value()).toHaveText('0, 2, 8, 2');
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
