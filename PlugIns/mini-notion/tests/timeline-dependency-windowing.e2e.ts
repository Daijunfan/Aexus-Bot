import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('large timeline keeps offscreen dependency edges correct while windowing, dragging and grouping', async () => {
  test.setTimeout(180000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-dependency-window-')));
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'start', name: 'Start', type: 'date' },
    { id: 'end', name: 'End', type: 'date' },
    { id: 'stage', name: 'Stage', type: 'select', options: ['Todo', 'Done'] },
  ];
  database.dependencies = { enabled: true, dateProperty: 'start', endProperty: 'end', shift: 'none' };
  database.views = [{
    id: 'dependency-timeline', name: 'Dependencies', type: 'timeline', calendarBy: 'start',
    timelineEnd: 'end', dateAnchor: '2026-10-01', timelineScale: 'month', openPagesIn: 'side',
  }];
  database.activeViewId = 'dependency-timeline';
  const db = makePage({ id: 'dependency-db', title: 'Dependency window fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 640 }, (_, index) => {
    const day = String(index % 27 + 1).padStart(2, '0');
    const end = String(index % 27 + 2).padStart(2, '0');
    return makePage({
      id: `dependency-${index}`, parentId: db.id,
      title: `Record ${String(index).padStart(5, '0')}`,
      values: { start: `2026-10-${day}`, end: `2026-10-${end}`, stage: index % 2 ? 'Done' : 'Todo' },
      blockedBy: index === 320 ? ['dependency-0'] : index === 639 ? ['dependency-320'] : [],
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
  const timeline = page.locator('.timeline-view');
  const bar = (index: number) => timeline.locator(`[data-timeline-id="dependency-${index}"]`);
  const edges = timeline.locator('.dependency-edge');
  const edgeTo = (title: string) => edges.filter({ has: page.locator('title', { hasText: title }) });
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const scroll = async (fraction: number) => {
    await page.locator('.page-scroll').first().evaluate((node, part) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) * part;
    }, fraction);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const endY = (data: string | null) => {
    const match = data?.match(/V(-?\d+(?:\.\d+)?) H-?\d+(?:\.\d+)?$/);
    expect(match).not.toBeNull();
    return Number(match![1]);
  };

  try {
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await bar(0).waitFor();
    await expect(timeline.locator('.timeline-row')).not.toHaveCount(640);
    await expect.poll(() => timeline.locator('.timeline-row').count()).toBeLessThan(70);
    await expect(bar(320)).toHaveCount(0);
    await expect(edges).toHaveCount(2);
    const topEdge = edgeTo('Record 00000 → Record 00320');
    const bottomEdge = edgeTo('Record 00320 → Record 00639');
    await expect(topEdge).toHaveCount(1);
    await expect(bottomEdge).toHaveCount(1);
    expect(endY(await topEdge.getAttribute('d'))).toBe(40 + 320 * 76 + 38);
    expect(endY(await bottomEdge.getAttribute('d'))).toBe(40 + 639 * 76 + 38);

    await bar(0).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '从 Record 00000 创建依赖' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.closest<HTMLElement>('[data-timeline-entry-index]')?.dataset.timelineEntryIndex,
    )).toBe('1');

    const resize = bar(0).locator('.timeline-resize');
    await resize.scrollIntoViewIfNeeded();
    const handle = await resize.boundingBox();
    const oldPath = await topEdge.getAttribute('d');
    await page.mouse.move(handle!.x + 3, handle!.y + 14);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 33, handle!.y + 14, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await api('page.get', { pageId: 'dependency-0' })).values.end)
      .toBe('2026-10-03');
    await expect.poll(async () => topEdge.getAttribute('d')).not.toBe(oldPath);

    await scroll(1);
    await expect(bar(639)).toHaveCount(1);
    // The last focused or dragged row may remain pinned while the rest is windowed.
    await expect.poll(() => timeline.locator('.timeline-row').count()).toBeLessThan(70);
    await expect(edges).toHaveCount(2);
    const mountedTargetY = await bar(639).evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const grid = element.closest('.timeline-grid')!.getBoundingClientRect();
      return bounds.top + bounds.height / 2 - grid.top;
    });
    expect(Math.abs(endY(await bottomEdge.getAttribute('d')) - mountedTargetY)).toBeLessThan(1);

    await api('view.update', {
      databaseId: db.id, viewId: 'dependency-timeline', changes: { groupBy: 'stage' },
    });
    await scroll(0);
    await expect(timeline.locator('.timeline-group-row[data-group-key="Todo"]')).toContainText('320');
    await expect(edges).toHaveCount(2);
    await page.getByRole('button', { name: '折叠分组 Todo', exact: true }).click();
    await expect(edges).toHaveCount(0);
    await page.getByRole('button', { name: '展开分组 Todo', exact: true }).click();
    await expect(edges).toHaveCount(2);
    await topEdge.focus();
    await page.keyboard.press('Space');
    await expect(edges).toHaveCount(1);
    await expect.poll(async () => api('dependency.list', { databaseId: db.id })).toEqual([
      { from: 'dependency-320', to: 'dependency-639' },
    ]);
    await page.reload();
    await expect(edges).toHaveCount(1);
    expect((await api('record.list', { databaseId: db.id })).length).toBe(640);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
