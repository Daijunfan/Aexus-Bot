import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('board primary action always creates categories; record creation and grouping recovery stay explicit', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-board-quick-add-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory };
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
    await page.locator('.page-title').waitFor();
    expect(await app!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  try {
    await launch();
    const source = await api('database.create', {
      title: '看板分类回归',
      color: 'white',
      columns: [
        { id: 'stage', name: '进度', type: 'status',
          statusGroups: { todo: ['未开始'], doing: ['进行中'], done: ['完成'] },
          defaultStatus: '未开始' },
        { id: 'note', name: '说明', type: 'text' },
      ],
    });
    const board = await api('view.create', {
      databaseId: source.id, name: '进度看板', type: 'board',
      config: { groupBy: 'stage', hideEmptyGroups: true },
    });
    await api('view.select', { databaseId: source.id, viewId: board.id });
    const original = await api('record.create', {
      databaseId: source.id, title: '已有内容', color: 'white',
      values: { stage: '进行中', note: '不能丢失的文本' },
    });
    await api('page.open', { pageId: source.id });
    const database = () => page.locator('.database[data-database-id="' + source.id + '"]');
    const primary = () => database().locator('.database-new');
    const group = (name: string) => database().locator('[data-group-key=' + JSON.stringify(name) + ']');
    const view = async () => (await api('view.list', { databaseId: source.id }))
      .find((item: { id: string }) => item.id === board.id);
    const column = async (id: string) => (await api('property.list', { databaseId: source.id }))
      .find((item: { id: string }) => item.id === id);
    await expect(primary()).toHaveText('新增分类');
    await expect(database().locator('.database-category-add')).toHaveCount(0);
    await expect(database().locator('.group-add-board-column')).toHaveCount(1);
    await page.setViewportSize({ width: 820, height: 630 });
    await expect(primary()).toBeVisible();

    for (let index = 0; index < 5; index++) {
      await primary().click();
      const editor = page.getByRole('dialog', { name: '新增分类' });
      await editor.getByRole('textbox', { name: '分类名称' }).fill('待检 ' + index);
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(group('待检 ' + index)).toBeVisible();
      await expect.poll(async () => (await view()).revealedGroups).toContain('待检 ' + index);
      await expect.poll(async () => (await view()).hideEmptyGroups).toBe(true);
      await expect(primary()).toHaveText('新增分类');
    }
    await expect.poll(async () => (await column('stage')).options.length).toBe(8);
    await expect(group('完成')).toHaveCount(0);
    await api('view.update', { databaseId: source.id, viewId: board.id,
      changes: { hiddenGroups: ['进行中'] } });
    await expect(group('进行中')).toHaveCount(0);
    await api('view.update', { databaseId: source.id, viewId: board.id,
      changes: { hiddenGroups: [] } });
    await expect(group('进行中')).toBeVisible();
    await database().getByRole('button', { name: '新建记录与模板' }).click();
    await page.getByRole('menuitem', { name: '新建记录', exact: true }).click();
    await page.locator('.peek-panel .page-title').fill('从下拉新增');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('record.list', { databaseId: source.id }))
      .some((item: { title: string }) => item.title === '从下拉新增')).toBe(true);

    // A board grouped by Text cannot define an empty option. Its blue button
    // must lead to a usable selector rather than disappearing or doing nothing.
    await api('view.update', { databaseId: source.id, viewId: board.id,
      changes: { groupBy: 'note', hideEmptyGroups: true } });
    await expect(group('不能丢失的文本')).toBeVisible();
    await expect(primary()).toHaveText('新增分类');
    await primary().click();
    const guidance = page.getByRole('dialog', { name: '选择分类属性' });
    await expect(guidance).toContainText('原来的属性及记录数据都会保留');
    await guidance.getByRole('button', { name: '使用「进度」分类' }).click();
    let editor = page.getByRole('dialog', { name: '新增分类' });
    await editor.getByRole('textbox', { name: '分类名称' }).fill('重新选定');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await view()).groupBy).toBe('stage');
    await expect(group('重新选定')).toBeVisible();
    await expect.poll(async () => (await api('page.get', { pageId: original.id })).values.note)
      .toBe('不能丢失的文本');
    await expect.poll(async () => (await view()).hiddenGroups).toEqual([]);
    await expect.poll(async () => (await view()).collapsedGroups).toEqual([]);

    // The other recovery path creates a Select property, switches grouping,
    // and immediately opens its new-category editor without deleting old data.
    await api('view.update', { databaseId: source.id, viewId: board.id, changes: { groupBy: 'note' } });
    await expect(group('不能丢失的文本')).toBeVisible();
    await primary().click();
    await page.getByRole('dialog', { name: '选择分类属性' })
      .getByRole('button', { name: /创建新的单选分类属性/ }).click();
    editor = page.getByRole('dialog', { name: '新增分类' });
    await editor.getByRole('textbox', { name: '分类名称' }).fill('新项目类别');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    const selectedView = await view();
    await expect.poll(async () => (await view()).groupBy).not.toBe('note');
    const newPropertyId = (await view()).groupBy;
    expect((await column(newPropertyId)).type).toBe('select');
    await expect(group('新项目类别')).toBeVisible();
    await expect.poll(async () => (await api('page.get', { pageId: original.id })).values.note)
      .toBe('不能丢失的文本');
    await expect(primary()).toHaveText('新增分类');

    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: source.id });
    await expect(primary()).toHaveText('新增分类');
    await expect(group('新项目类别')).toBeVisible();
    expect((await view()).groupBy).toBe(newPropertyId);
    expect((await view()).hideEmptyGroups).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
