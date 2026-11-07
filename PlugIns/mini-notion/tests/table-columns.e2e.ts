import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('table column menus wrap individual properties and freeze through the chosen column without covering selection', async () => {
  test.setTimeout(120000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-table-columns-')));
  const metadata = path.join(root, '.mininotion');
  fs.mkdirSync(metadata);
  fs.writeFileSync(path.join(metadata, 'collection.json'), JSON.stringify({ format: 'mininotion.collection/v1' }));
  const env = {
    ...process.env,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_WORKSPACE: root,
    MINI_NOTION_DATA_DIR: path.join(metadata, 'desktop'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  let page: Page;
  const errors: string[] = [];
  const launch = async () => {
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'],
      env,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 740, height: 650 });
    await page.locator('.sidebar').waitFor();
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  const coordinates = async (scrollLeft: number) => {
    return page.locator('.database-table.enhanced-table').first().evaluate((table, left) => {
      const wrap = table.closest<HTMLElement>('.database-table-wrap')!;
      wrap.scrollLeft = left;
      const cells = [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]:first-child > td')];
      return {
        scroll: wrap.scrollLeft, width: wrap.scrollWidth, client: wrap.clientWidth,
        selection: cells[0].getBoundingClientRect().left,
        title: cells[1].getBoundingClientRect().left,
        a: cells[2].getBoundingClientRect().left,
        b: cells[3].getBoundingClientRect().left,
        c: cells[4].getBoundingClientRect().left,
      };
    }, scrollLeft);
  };
  try {
    await launch();
    const columns = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id === 'a' ? '说明' : id.toUpperCase(), type: 'text' }));
    const db = await api('database.create', { title: '表格冻结换行验收', color: 'white', columns });
    await api('record.create', { databaseId: db.id, color: 'white',
      title: '一个必须能够在名称列自由换行的较长标题，一二三四五六七八九十。'.repeat(3),
      values: { a: '说明的内容'.repeat(25), b: 'B列内容'.repeat(20), c: 'C列内容' },
    });
    const view = (await api('view.list', { databaseId: db.id })).find((item: { type: string }) => item.type === 'table');
    await api('page.open', { pageId: db.id });
    const table = page.locator('.database-table.enhanced-table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(1);
    const start = await coordinates(0);
    const horizontal = await coordinates(200);
    expect(horizontal.scroll).toBeGreaterThan(0);
    expect(horizontal.width).toBeGreaterThan(horizontal.client);
    expect(Math.abs(start.selection - horizontal.selection)).toBeLessThan(2);
    expect(Math.abs(start.title - horizontal.title)).toBeLessThan(2);
    expect(start.a - horizontal.a).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'B列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '冻结到此列', exact: true }).click();
    await expect.poll(async () => (await api('view.list', { databaseId: db.id }))
      .find((item: { id: string }) => item.id === view.id).frozenThrough).toBe('b');
    const frozenBefore = await coordinates(0);
    const frozenAfter = await coordinates(180);
    expect(Math.abs(frozenBefore.selection - frozenAfter.selection)).toBeLessThan(2);
    expect(Math.abs(frozenBefore.title - frozenAfter.title)).toBeLessThan(2);
    expect(Math.abs(frozenBefore.a - frozenAfter.a)).toBeLessThan(2);
    expect(Math.abs(frozenBefore.b - frozenAfter.b)).toBeLessThan(2);
    expect(frozenBefore.c - frozenAfter.c).toBeGreaterThan(100);
    expect(frozenAfter.title - frozenAfter.selection).toBeGreaterThanOrEqual(29);

    await page.getByRole('button', { name: '说明列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '换行显示内容', exact: true }).click();
    await expect(table.locator('tbody td:nth-child(3) textarea.property-input')).toBeVisible();
    await expect(table.locator('tbody td:nth-child(4) input.property-input')).toBeVisible();
    await expect.poll(async () => (await api('view.list', { databaseId: db.id }))
      .find((item: { id: string }) => item.id === view.id).columnWrap?.a).toBe(true);

    await page.getByRole('button', { name: '名称列选项', exact: true }).click();
    await page.getByRole('menuitem', { name: '换行显示内容', exact: true }).click();
    await expect(table.locator('tbody td:nth-child(2)')).toHaveClass(/table-cell-wrap/);
    const titleWrap = await table.locator('tbody td:nth-child(2) .record-title-copy strong').evaluate(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      height: element.getBoundingClientRect().height,
    }));
    expect(titleWrap.whiteSpace).toBe('normal');
    expect(titleWrap.height).toBeGreaterThan(30);

    await api('view.update', { databaseId: db.id, viewId: view.id,
      changes: { wrapCells: true, columnWrap: { a: false, title: false }, frozenThrough: null } });
    await expect(table.locator('tbody td:nth-child(3) input.property-input')).toBeVisible();
    await expect(table.locator('tbody td:nth-child(4) textarea.property-input')).toBeVisible();
    await expect(table.locator('thead th.table-frozen-cell')).toHaveCount(0);
    const plainBefore = await coordinates(0);
    const plainAfter = await coordinates(160);
    expect(plainBefore.title - plainAfter.title).toBeGreaterThan(100);

    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: db.id });
    await expect(page.locator('.database-table.enhanced-table tbody td:nth-child(3) input.property-input')).toBeVisible();
    await expect(page.locator('.database-table.enhanced-table tbody td:nth-child(4) textarea.property-input')).toBeVisible();
    await expect(page.locator('.database-table.enhanced-table thead th.table-frozen-cell')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
