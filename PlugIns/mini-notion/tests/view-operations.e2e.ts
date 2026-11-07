import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('view tabs expose rename and layout, preserve duplicates and keep linked view names independent', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-views-'));
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
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env,
    });
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
    const database = await api('database.create', {
      title: '视图操作验收',
      color: 'white',
      columns: [
        { id: 'text-status', name: '状态', type: 'text' },
        { id: 'number', name: '分数', type: 'number' },
      ],
    });
    const row = await api('record.create', { databaseId: database.id, title: '记录保留', color: 'white' });
    await api('page.open', { pageId: database.id });
    await expect(page.getByRole('button', { name: '添加视图', exact: true })).toContainText('添加视图');
    await page.getByRole('button', { name: '添加视图', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新建视图' });
    await expect(create.locator('.create-view-grid > button')).toHaveCount(10);
    await create.getByRole('button', { name: /^看板/ }).click();
    await create.getByRole('textbox', { name: '新视图名称' }).fill('看板项目');
    await create.getByRole('button', { name: '创建视图', exact: true }).click();
    await expect.poll(async () => (await api('view.list', { databaseId: database.id })).length).toBe(2);
    const board = (await api('view.list', { databaseId: database.id })).find(
      (view: { name: string }) => view.name === '看板项目',
    );
    const columns = await api('property.list', { databaseId: database.id });
    const group = columns.find((column: { id: string }) => column.id === board.groupBy);
    expect(group.type).toBe('status');
    expect(group.name).toBe('状态 2');
    expect((await api('page.get', { pageId: row.id })).values[group.id]).toBe('未开始');

    await page.getByRole('button', { name: '数据库设置', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /^属性可见性/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /^编辑属性/ }).click();
    await expect(page.getByRole('menuitem', { name: '新建属性', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '状态 2', exact: true }).click();
    await page.getByRole('dialog', { name: '编辑属性' }).getByLabel('属性名称', { exact: true }).fill('进度');
    await page.getByRole('dialog', { name: '编辑属性' }).getByRole('button', { name: '完成', exact: true }).click();
    await expect.poll(async () => (await api('property.list', { databaseId: database.id })).find((column: { id: string }) => column.id === group.id).name).toBe('进度');

    await page.locator(`[data-view-id="${board.id}"]`).click();
    await page.getByRole('menuitem', { name: '重命名视图', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '重命名视图' });
    await rename.getByRole('textbox', { name: '视图名称' }).fill('团队进展');
    await rename.getByRole('textbox', { name: '视图名称' }).press('Enter');
    await expect
      .poll(
        async () =>
          (await api('view.list', { databaseId: database.id })).find(
            (view: { id: string }) => view.id === board.id,
          ).name,
      )
      .toBe('团队进展');
    await page.locator(`[data-view-id="${board.id}"]`).press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '布局', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '复制视图', exact: true }).click();
    await expect.poll(async () => (await api('view.list', { databaseId: database.id })).length).toBe(3);
    const duplicate = (await api('view.list', { databaseId: database.id })).find(
      (view: { name: string }) => view.name === '团队进展（副本）',
    );
    expect(duplicate.groupBy).toBe(group.id);
    await page.getByRole('button', { name: '全部视图', exact: true }).click();
    await page.getByRole('button', { name: '团队进展 的视图操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '布局', exact: true }).click();
    await expect(page.locator('.view-type-options')).toBeVisible();
    await page.locator('.view-type-options').getByRole('button', { name: '列表', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect
      .poll(
        async () =>
          (await api('view.list', { databaseId: database.id })).find(
            (view: { id: string }) => view.id === board.id,
          ).type,
      )
      .toBe('list');
    expect(
      (await api('view.list', { databaseId: database.id })).find(
        (view: { id: string }) => view.id === duplicate.id,
      ).type,
    ).toBe('board');

    const table = (await api('view.list', { databaseId: database.id }))[0];
    await page.locator(`[data-view-id="${table.id}"]`).press('F2');
    await page
      .getByRole('dialog', { name: '重命名视图' })
      .getByRole('textbox', { name: '视图名称' })
      .fill('总览表');
    await page
      .getByRole('dialog', { name: '重命名视图' })
      .getByRole('button', { name: '保存', exact: true })
      .click();
    await expect(page.locator(`[data-view-id="${board.id}"]`)).toHaveClass('active');
    const linkedView = { id: 'local-table', name: '关联视图', type: 'table' };
    const holder = await api('page.create', {
      title: '关联视图容器',
      color: 'white',
      blocks: [
        {
          type: 'databaseView',
          props: {
            databaseId: database.id,
            linked: true,
            viewState: JSON.stringify({ views: [linkedView], activeViewId: linkedView.id, view: 'table' }),
          },
        },
      ],
    });
    await api('page.open', { pageId: holder.id });
    await page.locator('[data-view-id="local-table"]').click();
    await page.getByRole('menuitem', { name: '重命名视图', exact: true }).click();
    await page
      .getByRole('dialog', { name: '重命名视图' })
      .getByRole('textbox', { name: '视图名称' })
      .fill('只改关联视图');
    await page
      .getByRole('dialog', { name: '重命名视图' })
      .getByRole('button', { name: '保存', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse((await api('page.get', { pageId: holder.id })).blocks[0].props.viewState).views[0].name,
      )
      .toBe('只改关联视图');
    expect(
      (await api('view.list', { databaseId: database.id })).map((view: { name: string }) => view.name),
    ).toEqual(['总览表', '团队进展', '团队进展（副本）']);
    await page.screenshot({ path: test.info().outputPath('linked-view-rename.png'), animations: 'disabled' });
    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: holder.id });
    await expect(page.locator('[data-view-id="local-table"]')).toHaveText('只改关联视图');
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('board selection repairs missing grouping only after a user action and respects database locks', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-board-default-'));
  const env = {
    ...process.env,
    MINI_NOTION_DATA_DIR: data,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env,
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.page-title').waitFor();
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), {
        method,
        params,
      });
      if (response.error) throw new Error(response.error.message);
      return response.result;
    };
    for (const columns of [
      [],
      [
        { id: 'choice', name: '分类', type: 'select', options: ['A'] },
        { id: 'progress', name: '进度', type: 'status' },
      ],
    ]) {
      const db = await api('database.create', { color: 'white', columns });
      const table = (await api('view.list', { databaseId: db.id }))[0];
      const board = await api('view.create', {
        databaseId: db.id,
        type: 'board',
        name: '需要修复的看板',
        config: { groupBy: 'missing' },
      });
      await api('page.open', { pageId: db.id });
      await expect(page.locator('.board-view')).toBeVisible();
      expect((await api('property.list', { databaseId: db.id })).length).toBe(columns.length);
      await page.locator(`[data-view-id="${table.id}"]`).click();
      await page.locator(`[data-view-id="${board.id}"]`).click();
      await expect
        .poll(
          async () =>
            (await api('view.list', { databaseId: db.id })).find(
              (view: { id: string }) => view.id === board.id,
            ).groupBy,
        )
        .not.toBe('missing');
      const chosen = (await api('view.list', { databaseId: db.id })).find(
        (view: { id: string }) => view.id === board.id,
      ).groupBy;
      expect(
        (await api('property.list', { databaseId: db.id })).find(
          (column: { id: string }) => column.id === chosen,
        ).type,
      ).toBe('status');
    }
    const locked = await api('database.create', { color: 'white', columns: [] });
    const table = (await api('view.list', { databaseId: locked.id }))[0];
    const board = await api('view.create', {
      databaseId: locked.id,
      type: 'board',
      config: { groupBy: 'missing' },
    });
    await api('page.update', { pageId: locked.id, changes: { locked: true } });
    await api('page.open', { pageId: locked.id });
    await page.locator(`[data-view-id="${table.id}"]`).click();
    await page.locator(`[data-view-id="${board.id}"]`).click();
    expect(await api('property.list', { databaseId: locked.id })).toEqual([]);
    await expect(page.getByRole('button', { name: '添加视图', exact: true })).toBeDisabled();
    await page.locator(`[data-view-id="${board.id}"]`).click();
    await expect(page.getByRole('menuitem', { name: '重命名视图', exact: true })).toBeDisabled();
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
