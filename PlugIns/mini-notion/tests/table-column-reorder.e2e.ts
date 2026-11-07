import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('table property headers reorder before, after and by keyboard without self-drop corruption', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-table-column-order-')));
  const env = { ...process.env, MINI_NOTION_DATA_DIR: root,
    MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  let app: ElectronApplication | undefined;
  let page: Page;
  const errors: string[] = [];
  const launch = async () => {
    app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')], env });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.sidebar').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  const headers = () => page.locator('.enhanced-table thead th[draggable]');
  const headerNames = () => headers().locator('button').evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('aria-label')));
  const drag = async (source: string, target: string, side: 'before' | 'after') => {
    const from = page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: source + '列选项' }) });
    const to = page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: target + '列选项' }) });
    const bounds = (await to.boundingBox())!;
    await from.dragTo(to, {
      sourcePosition: { x: 50, y: 18 },
      targetPosition: { x: side === 'before' ? 12 : bounds.width - 12, y: 18 },
    });
  };
  try {
    await launch();
    const db = await api('database.create', { title: '表格列拖放验收', color: 'white', columns: [
      { id: 'priority', name: '优先级', type: 'text' },
      { id: 'owner', name: '负责人', type: 'text' },
      { id: 'budget', name: '预算', type: 'number' },
    ] });
    await api('record.create', { databaseId: db.id, title: '测试记录', color: 'white' });
    const view = (await api('view.list', { databaseId: db.id }))[0];
    const order = async () => (await api('view.list', { databaseId: db.id }))
      .find((item: { id: string }) => item.id === view.id).propertyOrder;
    await api('page.open', { pageId: db.id });
    await expect(headers()).toHaveCount(3);
    expect(await headerNames()).toEqual(['优先级列选项', '负责人列选项', '预算列选项']);

    await drag('优先级', '预算', 'after');
    await expect.poll(headerNames).toEqual(['负责人列选项', '预算列选项', '优先级列选项']);
    await expect.poll(order).toEqual(['owner', 'budget', 'priority']);

    await drag('优先级', '优先级', 'before');
    expect(await headerNames()).toEqual(['负责人列选项', '预算列选项', '优先级列选项']);
    expect(await order()).toEqual(['owner', 'budget', 'priority']);

    await drag('优先级', '负责人', 'before');
    await expect.poll(headerNames).toEqual(['优先级列选项', '负责人列选项', '预算列选项']);
    await expect.poll(order).toEqual(['priority', 'owner', 'budget']);

    await page.getByRole('button', { name: '负责人列选项' }).focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(headerNames).toEqual(['负责人列选项', '优先级列选项', '预算列选项']);
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(headerNames).toEqual(['优先级列选项', '负责人列选项', '预算列选项']);

    await api('page.update', { pageId: db.id, changes: { locked: true } });
    await expect(headers().first()).toHaveAttribute('draggable', 'false');
    await page.getByRole('button', { name: '负责人列选项' }).focus();
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await order()).toEqual(['priority', 'owner', 'budget']);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await app!.close();
    app = undefined;

    await launch();
    await api('page.open', { pageId: db.id });
    await expect.poll(headerNames).toEqual(['优先级列选项', '负责人列选项', '预算列选项']);
    expect(await order()).toEqual(['priority', 'owner', 'budget']);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
