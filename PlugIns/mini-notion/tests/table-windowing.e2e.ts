import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('large table scrolls without reattaching observers and tabs into unmounted records', async () => {
  test.setTimeout(180000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-table-window-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [{ id: 'notes', name: 'Notes', type: 'text' }];
  database.views = [{ id: 'table-view', name: 'Table', type: 'table', openPagesIn: 'side' }];
  database.activeViewId = 'table-view';
  const db = makePage({ id: 'table-db', title: 'Large table fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 640 }, (_, index) => makePage({
    id: `row-${index}`, parentId: db.id,
    title: `Record ${String(index).padStart(5, '0')}`,
    values: { notes: `Notes ${index}` },
  }))];
  workspace.activePageId = db.id;
  workspace.expanded = [];
  workspace.recent = [];
  workspace.spaces = {};
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR',
    'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL',
    'MINI_NOTION_AGENT_CLAUDE', 'MINI_NOTION_AGENT_CODEX']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const hidden = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  const api = async (method: string, params: Record<string, unknown>) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const scroll = async (fraction: number) => {
    await page.locator('.page-scroll').first().evaluate((node, amount) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) * amount;
    }, fraction);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    expect(await hidden()).toBe(true);
    await page.addInitScript(() => {
      const NativeObserver = window.ResizeObserver;
      (window as any).__tableScrollSubscriptions = 0;
      window.ResizeObserver = class extends NativeObserver {
        observe(target: Element) {
          if (target.classList.contains('page-scroll'))
            (window as any).__tableScrollSubscriptions++;
          return super.observe(target);
        }
      };
    });
    await page.reload();
    const table = page.locator('.database-table.enhanced-table');
    const rendered = table.locator('tbody tr[data-row-id]');
    await rendered.first().waitFor();
    await scroll(0);
    await expect.poll(() => rendered.count()).toBeLessThan(100);
    const initialSubscriptions = await page.evaluate(() => (window as any).__tableScrollSubscriptions);
    expect(initialSubscriptions).toBeGreaterThan(0);

    const lastId = await rendered.last().getAttribute('data-row-id');
    const nextId = `row-${Number(lastId!.slice(4)) + 1}`;
    await rendered.last().locator('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]').last().focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId)).toBe(nextId);
    await page.locator('.page-title').focus();

    for (const fraction of [0.5, 1, 0.25, 0.8, 0]) {
      await scroll(fraction);
      await expect.poll(() => rendered.count()).toBeLessThan(100);
    }
    expect(await page.evaluate(() => (window as any).__tableScrollSubscriptions)).toBe(initialSubscriptions);
    await scroll(1);
    await expect(table.locator('tbody tr[data-row-id="row-639"]')).toHaveCount(1);
    await scroll(0);

    await table.locator('tr[data-row-id="row-0"] input.property-input').fill('Saved from windowed table');
    await expect.poll(async () => (await api('page.get', { pageId: 'row-0' })).values.notes)
      .toBe('Saved from windowed table');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(table.locator('tr[data-row-id="row-0"] input.property-input')).toHaveValue('Saved from windowed table');
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
