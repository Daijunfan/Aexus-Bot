import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('long timeline windows rows while keeping keyboard focus, grouping, edits and PDF complete', async () => {
  test.setTimeout(180000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-timeline-window-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'start', name: 'Start', type: 'date' },
    { id: 'end', name: 'End', type: 'date' },
    { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Done'] },
  ];
  database.views = [{
    id: 'long-timeline', name: 'Timeline', type: 'timeline', calendarBy: 'start',
    timelineEnd: 'end', dateAnchor: '2026-10-01', timelineScale: 'month',
    openPagesIn: 'side',
  }];
  database.activeViewId = 'long-timeline';
  const db = makePage({ id: 'timeline-db', title: 'Long timeline fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 640 }, (_, index) => {
    const day = String(index % 27 + 1).padStart(2, '0');
    const end = String(index % 27 + 2).padStart(2, '0');
    return makePage({
      id: `timeline-${index}`, parentId: db.id,
      title: `Record ${String(index).padStart(5, '0')}`,
      values: { start: `2026-10-${day}`, end: `2026-10-${end}`, stage: index % 2 ? 'Done' : 'Todo' },
    });
  })];
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
  const errors: string[] = [];
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const surface = page.locator('.timeline-view');
  const bar = (id: number) => surface.locator(`[data-timeline-id="timeline-${id}"]`);
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const scroll = async (fraction: number) => {
    await page.locator('.page-scroll').first().evaluate((node, fraction) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
    }, fraction);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await bar(0).waitFor();
    await expect.poll(() => surface.locator('.timeline-row').count()).toBeLessThan(70);
    await bar(0).focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.closest<HTMLElement>('[data-timeline-entry-index]')?.dataset.timelineEntryIndex,
    )).toBe('1');
    const resize = bar(0).locator('.timeline-resize');
    await resize.scrollIntoViewIfNeeded();
    const handle = await resize.boundingBox();
    await page.mouse.move(handle!.x + 3, handle!.y + 14);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 33, handle!.y + 14, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await api('page.get', { pageId: 'timeline-0' })).values.end)
      .toBe('2026-10-03');

    await scroll(1);
    await expect(bar(639)).toHaveCount(1);
    await expect.poll(() => surface.locator('.timeline-row').count()).toBeLessThan(70);
    await scroll(0);
    await expect(bar(0)).toHaveCount(1);

    await api('view.update', {
      databaseId: 'timeline-db', viewId: 'long-timeline', changes: { groupBy: 'stage' },
    });
    await expect(surface.locator('.timeline-group-row[data-group-key="Todo"]')).toContainText('320');
    await page.getByRole('button', { name: '折叠分组 Todo', exact: true }).click();
    await expect(surface.locator('.timeline-group-row[data-group-key="Todo"]')).toContainText('320');
    await page.getByRole('button', { name: '展开分组 Todo', exact: true }).click();

    const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
    await search.fill('Record 00639');
    await expect(bar(639)).toHaveCount(1);
    await expect(surface.locator('.timeline-row')).toHaveCount(1);
    await bar(639).click();
    await page.locator('.peek-panel .page-title').fill('Durable timeline edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'timeline-639' })).title)
      .toBe('Durable timeline edit');
    await search.fill('');
    await api('view.update', { databaseId: 'timeline-db', viewId: 'long-timeline', unset: ['groupBy'] });
    await page.reload();
    await scroll(1);
    await expect(bar(639)).toHaveCount(1);
    await expect(surface).toContainText('Durable timeline edit');

    const output = path.join(directory, 'timeline.pdf');
    await api('file.export', { pageId: db.id, type: 'pdf', output });
    const pdfText = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .replace(/\s+/g, '');
    expect(pdfText).toContain('Durabletimelineedit');
    expect(pdfText).toContain('Record00000');
    expect((await api('record.list', { databaseId: db.id })).length).toBe(640);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
