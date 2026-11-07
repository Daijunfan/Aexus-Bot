import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('dense calendar renders visible lanes only and loads unscheduled records on demand', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-calendar-density-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [{ id: 'date', name: 'Date', type: 'date' }];
  database.views = [{
    id: 'dense-calendar-view', name: 'Dense calendar', type: 'calendar',
    calendarBy: 'date', dateAnchor: '2026-10-15', openPagesIn: 'side',
  }];
  database.activeViewId = 'dense-calendar-view';
  const db = makePage({ id: 'dense-calendar-db', title: 'Dense calendar fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 820 }, (_, index) => makePage({
    id: `dense-calendar-${index}`, parentId: db.id,
    title: `Record ${String(index).padStart(5, '0')}`,
    values: { date: index < 640 ? '2026-10-15' : '' },
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
  const calendar = page.locator('.calendar-view');
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  try {
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await calendar.waitFor();
    await expect(calendar.locator('.calendar-event')).toHaveCount(4);
    await expect(calendar.locator('.calendar-event.overflow-event')).toHaveCount(0);
    await expect(calendar.getByRole('button', { name: /查看 2026-10-15 的全部日程，另有 636 项/ })).toHaveCount(1);
    await expect(calendar.locator('.calendar-unplanned summary')).toContainText('180 个页面');
    await expect(calendar.locator('.calendar-unplanned > button')).toHaveCount(0);
    const projection = await api('view.render', { databaseId: db.id, viewId: 'dense-calendar-view', date: '2026-10-15' });
    expect(projection.count).toBe(820); // CLI includes 180 unscheduled records too.
    const octoberWeek = projection.weeks.find((week: { dates: string[] }) => week.dates.includes('2026-10-15'));
    expect(octoberWeek.events).toHaveLength(640);

    await calendar.getByRole('button', { name: /查看 2026-10-15 的全部日程/ }).click();
    await expect(page.getByRole('dialog', { name: '2026-10-15 的全部日程' })).toContainText('640 项日程');
    await expect(page.locator('.calendar-day-list .calendar-day-item')).toHaveCount(640);
    await page.getByRole('button', { name: '关闭当天日程' }).click();

    await calendar.locator('.calendar-unplanned summary').click();
    await expect(calendar.locator('.calendar-unplanned > button')).toHaveCount(81);
    await calendar.getByRole('button', { name: /显示更多页面（还有 100 个）/ }).click();
    await expect(calendar.locator('.calendar-unplanned > button')).toHaveCount(161);
    await calendar.getByRole('button', { name: /显示更多页面（还有 20 个）/ }).click();
    await expect(calendar.locator('.calendar-unplanned > button')).toHaveCount(180);
    await calendar.getByRole('button', { name: 'Record 00819' }).click();
    await expect(page.locator('.peek-panel .page-title')).toHaveValue('Record 00819');
    await page.getByRole('button', { name: '关闭预览' }).click();
    expect((await api('record.list', { databaseId: db.id })).length).toBe(820);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
