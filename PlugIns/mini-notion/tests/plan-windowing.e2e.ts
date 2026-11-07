import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('large daily plan windows backlog and scheduled cards while keeping drag, completion and export', async () => {
  test.setTimeout(180000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-plan-window-')));
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const workspace = createWorkspace(), database = defaultDatabase();
  database.columns = [
    { id: 'date', name: 'Date', type: 'date' },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'notes', name: 'Notes', type: 'text' },
  ];
  database.views = [{
    id: 'daily-plan', name: 'Daily plan', type: 'plan', planMode: 'day',
    calendarBy: 'date', planDoneBy: 'done', dateAnchor: day, openPagesIn: 'side',
  }];
  database.activeViewId = 'daily-plan';
  const db = makePage({ id: 'plan-db', title: 'Long plan fixture', database, fullWidth: true, blocks: [] });
  workspace.pages = [db, ...Array.from({ length: 640 }, (_, index) => makePage({
    id: `plan-${index}`, parentId: db.id,
    title: `Record ${String(index).padStart(5, '0')}`,
    values: { date: index < 320 ? '' : day, done: false, notes: `Notes ${index}` },
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
  const surface = page.locator('.plan-view');
  const backlog = surface.locator('.plan-backlog .plan-lane');
  const scheduled = surface.locator('.plan-schedule .plan-lane');
  const card = (id: number) => surface.locator(`.plan-card[data-record-id="plan-${id}"]`);
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
    await card(0).waitFor();
    await expect(backlog.locator('header small')).toHaveText('320');
    await expect(scheduled.locator('header small')).toHaveText('320');
    await expect.poll(() => surface.locator('.plan-card').count()).toBeLessThan(90);
    await expect(backlog.locator('.plan-lane-cards.windowed-cards')).toHaveCount(1);
    await expect(scheduled.locator('.plan-lane-cards.windowed-cards')).toHaveCount(1);
    const lastMounted = await backlog.locator('.plan-card').last().getAttribute('data-record-id');
    const nextId = `plan-${Number(lastMounted!.slice(5)) + 1}`;
    await backlog.locator(`.plan-card[data-record-id="${lastMounted}"]`)
      .locator('button:not([disabled]), input:not([disabled]), [tabindex="0"]').last().focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.closest<HTMLElement>('[data-record-id]')?.dataset.recordId,
    )).toBe(nextId);
    await scroll(0);

    await card(1).getByRole('checkbox', { name: '完成 Record 00001' }).check();
    await expect.poll(async () => (await api('page.get', { pageId: 'plan-1' })).values.done).toBe(true);
    await card(0).dragTo(scheduled.locator('header'), { targetPosition: { x: 25, y: 15 } });
    await expect.poll(async () => (await api('page.get', { pageId: 'plan-0' })).values.date).toBe(day);
    await expect(backlog.locator('header small')).toHaveText('319');
    await expect(scheduled.locator('header small')).toHaveText('321');

    await scroll(1);
    await expect(card(319)).toHaveCount(1);
    await expect(card(639)).toHaveCount(1);
    await expect.poll(() => surface.locator('.plan-card').count()).toBeLessThan(90);
    await scroll(0);
    await card(2).locator('.plan-card-title button').click();
    await page.locator('.peek-panel .page-title').fill('Durable plan edit');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await expect.poll(async () => (await api('page.get', { pageId: 'plan-2' })).title).toBe('Durable plan edit');
    await page.reload();
    await expect(card(2)).toContainText('Durable plan edit');
    await expect(card(1).getByRole('checkbox', { name: '完成 Record 00001' })).toBeChecked();

    // Scrolling should reposition the virtual window without replacing its ResizeObservers.
    await page.addInitScript(() => {
      const OriginalObserver = window.ResizeObserver;
      (window as any).__planObserverAttachments = 0;
      window.ResizeObserver = class extends OriginalObserver {
        observe(element: Element) {
          if (element.classList.contains('plan-lane-cards'))
            (window as any).__planObserverAttachments++;
          return super.observe(element);
        }
      };
    });
    await page.reload();
    await card(2).waitFor();
    await scroll(0);
    const attachments = await page.evaluate(() => (window as any).__planObserverAttachments);
    for (const fraction of [0.4, 1, 0.7, 0.2, 0]) await scroll(fraction);
    expect(await page.evaluate(() => (window as any).__planObserverAttachments)).toBe(attachments);
    await scroll(0);

    const output = path.join(directory, 'plan.pdf');
    await api('file.export', { pageId: db.id, type: 'pdf', output });
    const pdfText = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .replace(/\s+/g, '');
    expect(pdfText).toContain('Record00639');
    expect(pdfText).toContain('Durableplanedit');
    expect((await api('record.list', { databaseId: db.id })).length).toBe(640);
    expect(errors).toEqual([]);
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
