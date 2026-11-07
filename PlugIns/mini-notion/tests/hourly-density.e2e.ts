import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';
import { makeDateValue } from '../src/database/dateValue';

test('dense hourly plan caps lanes and opens all overflow records in hidden GUI', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-hourly-density-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [{ id: 'date', name: 'Date', type: 'date' }];
  database.views = [{
    id: 'dense-hourly-view', name: 'Dense hours', type: 'plan', planMode: 'hourDay',
    calendarBy: 'date', dateAnchor: '2026-10-15', timeZone: 'Asia/Shanghai', openPagesIn: 'side',
  }];
  database.activeViewId = 'dense-hourly-view';
  const db = makePage({ id: 'dense-hourly-db', title: 'Dense hourly fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 641 }, (_, index) => makePage({
    id: `dense-hourly-${index}`, parentId: db.id, title: `Timed ${String(index).padStart(4, '0')}`,
    values: { date: index < 640
      ? makeDateValue('2026-10-15T09:00', '2026-10-15T10:00', 'Asia/Shanghai')
      : makeDateValue('2026-10-15T16:00', '2026-10-15T17:00', 'Asia/Shanghai') },
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
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await expect(page.locator('.hourly-day')).toHaveCount(1);
    await expect(page.locator('.hourly-event')).toHaveCount(4);
    await expect(page.locator('.hourly-more-timed')).toHaveCount(1);
    await expect(page.locator('.hourly-print-agenda')).toHaveCount(0);
    expect(await page.locator('.hourly-grid').evaluate(element => element.scrollWidth)).toBeLessThan(2000);
    const result = await page.evaluate(() => window.native!.api('view.render', {
      databaseId: 'dense-hourly-db', viewId: 'dense-hourly-view', date: '2026-10-15',
    }));
    expect(result.error).toBeUndefined();
    expect(result.result.count).toBe(641);
    expect(result.result.timeGrid.days[0].events).toHaveLength(641);
    await page.locator('.hourly-more-timed').click();
    const dialog = page.getByRole('dialog', { name: '2026-10-15 的更多小时日程' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.event-detail-list button')).toHaveCount(637);
    await dialog.getByRole('button', { name: /Timed 0639/ }).click();
    await expect(page.locator('.peek-panel .page-title')).toHaveValue('Timed 0639');
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(page.locator('[data-time-event="dense-hourly-640"]')).toBeVisible();
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
