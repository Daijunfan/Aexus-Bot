import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('category editor merges CLI updates and keeps the originating view on rapid switches', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-category-concurrent-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  let page: Page;
  try {
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'], env,
    });
    page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.page-title').waitFor();
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const result = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
      if (result.error) throw new Error(result.error.message);
      return result.result;
    };
    const db = await api('database.create', {
      title: '快速切换测试', color: 'white',
      columns: [{ id: 'stage', name: '阶段', type: 'select', options: ['旧类'] }],
    });
    const first = await api('view.create', { databaseId: db.id, type: 'board', name: '源看板',
      config: { groupBy: 'stage', hideEmptyGroups: true } });
    const second = await api('view.create', { databaseId: db.id, type: 'board', name: '其他看板',
      config: { groupBy: 'stage', hideEmptyGroups: true } });
    await api('view.select', { databaseId: db.id, viewId: first.id });
    await api('page.open', { pageId: db.id });
    const root = page.locator('.database[data-database-id=' + JSON.stringify(db.id) + ']');
    const column = async () => (await api('property.list', { databaseId: db.id }))
      .find((item: { id: string }) => item.id === 'stage');
    const views = async () => await api('view.list', { databaseId: db.id });
    const saved = async (id: string) => (await views()).find((item: { id: string }) => item.id === id);
    const openEditor = async () => {
      await root.locator('.database-new').click();
      return page.getByRole('dialog', { name: '新增分类' });
    };

    // The property may change via API while the user is editing a label.
    let editor = await openEditor();
    await api('property.update', { databaseId: db.id, propertyId: 'stage',
      optionEdit: { kind: 'create', name: '来自 CLI' } });
    await editor.getByRole('textbox', { name: '分类名称' }).fill('来自界面');
    await editor.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await column()).options).toEqual(['旧类', '来自 CLI', '来自界面']);
    await expect(root.locator('[data-group-key="来自界面"]')).toBeVisible();

    // Switching tabs immediately after saving must not reveal a new group in
    // the wrong view or lose the empty-category reveal in its original view.
    editor = await openEditor();
    await editor.getByRole('textbox', { name: '分类名称' }).fill('仅第一视图');
    await editor.getByRole('button', { name: '保存' }).click();
    await api('view.select', { databaseId: db.id, viewId: second.id });
    await expect.poll(async () => (await saved(first.id)).revealedGroups || []).toContain('仅第一视图');
    expect((await saved(second.id)).revealedGroups || []).not.toContain('仅第一视图');
    await expect(root.locator('[data-group-key="仅第一视图"]')).toHaveCount(0);
    await api('view.select', { databaseId: db.id, viewId: first.id });
    await expect(root.locator('[data-group-key="仅第一视图"]')).toBeVisible();

    // The end-of-board entry uses the same originating-view queue.
    await root.locator('.group-add-board-column').click();
    editor = page.getByRole('dialog', { name: '新增分类' });
    await editor.getByRole('textbox', { name: '分类名称' }).fill('末尾独有');
    await editor.getByRole('button', { name: '保存' }).click();
    await api('view.select', { databaseId: db.id, viewId: second.id });
    await expect.poll(async () => (await saved(first.id)).revealedGroups || []).toContain('末尾独有');
    expect((await saved(second.id)).revealedGroups || []).not.toContain('末尾独有');

    // The editor remains bound to its original view even when another tab
    // becomes active before the user presses Save.
    await api('view.select', { databaseId: db.id, viewId: first.id });
    editor = await openEditor();
    await editor.getByRole('textbox', { name: '分类名称' }).fill('切换时仍属原视图');
    await api('view.select', { databaseId: db.id, viewId: second.id });
    await editor.getByRole('button', { name: '保存' }).click();
    await expect.poll(async () => (await saved(first.id)).revealedGroups || [])
      .toContain('切换时仍属原视图');
    expect((await saved(second.id)).revealedGroups || []).not.toContain('切换时仍属原视图');

    // An option rename and its record rewrites must form one undoable writer
    // operation rather than one UI patch per affected record.
    const row = await api('record.create', { databaseId: db.id, color: 'white',
      title: '撤销验收', values: { stage: '来自界面' } });
    await api('property.update', { databaseId: db.id, propertyId: 'stage',
      optionEdit: { kind: 'update', value: '来自界面', name: '已复核' } });
    const operation = (await api('history.operations', { pageId: db.id }))[0];
    expect(operation).toHaveProperty('id');
    await api('history.undo', { id: operation.id });
    expect((await column()).options).toContain('来自界面');
    expect((await column()).options).not.toContain('已复核');
    expect((await api('page.get', { pageId: row.id })).values.stage).toBe('来自界面');
    await api('history.redo', { id: operation.id });
    expect((await column()).options).toContain('已复核');
    expect((await api('page.get', { pageId: row.id })).values.stage).toBe('已复核');
    expect(errors).toEqual([]);
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
