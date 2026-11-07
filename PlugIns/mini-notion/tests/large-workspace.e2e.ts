import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage, defaultDatabase } from '../src/model';
import { createWorkspace } from '../src/seed';

test('large workspace keeps sidebar bounded, navigable and edits durable', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-large-ui-')));
  const workspace = createWorkspace();
  workspace.pages = Array.from({ length: 2000 }, (_, index) =>
    makePage({
      id: `large-${index}`,
      title: `Large page ${String(index).padStart(4, '0')}`,
      blocks: Array.from({ length: index === 0 ? 200 : 1 }, (_, block) => ({
        id: `block-${index}-${block}`,
        type: 'paragraph',
        content: `Offline content ${index} ${block}`,
      })),
    }),
  );
  workspace.pages[1].parentId = 'large-0';
  workspace.pages[2].parentId = 'large-0';
  workspace.pages[3].database = defaultDatabase();
  workspace.activePageId = 'large-0';
  workspace.expanded = [];
  workspace.recent = [];
  workspace.spaces = {};
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  const env = {
    ...process.env,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_DATA_DIR: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  const app = await electron.launch({
    executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'],
    env,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(String(error)));
    await expect(page.locator('.page-title')).toHaveValue('Large page 0000');
    await expect(page.locator('.bn-editor')).toBeVisible();
    await expect.poll(() => page.locator('.sidebar-page').count()).toBeLessThan(80);

    // End/Home and arrow keys cross unmounted rows, without truncating the tree.
    const first = page.getByRole('treeitem', { name: 'Large page 0000', exact: true });
    await first.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('treeitem', { name: 'Large page 1999', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.page-title')).toHaveValue('Large page 1999');
    await page.getByRole('treeitem', { name: 'Large page 1999', exact: true }).focus();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('treeitem', { name: 'Large page 0001', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.page-title')).toHaveValue('Large page 0000');

    // Empty databases still expose their views in the sidebar.
    const database = page.getByRole('treeitem', { name: 'Large page 0003', exact: true });
    await database.getByRole('button', { name: '展开 Large page 0003', exact: true }).click();
    await expect(page.locator('.sidebar-database-view').first()).toBeVisible();

    // Reordering ahead of a focused row must not move focus to another page.
    await first.focus();
    await page.evaluate(() => window.native!.api('page.move', {
      pageId: 'large-1000', parentId: null, beforeId: 'large-0',
    }));
    await expect(page.getByRole('tree', { name: '页面', exact: true }).getByRole('treeitem').first()).toHaveAttribute('data-page-id', 'large-1000');
    await expect(first).toBeFocused();
    await page.evaluate(() => window.native!.api('settings.set', { changes: { appearance: { density: 'compact' } } }));
    await expect.poll(() => first.evaluate(element => element.getBoundingClientRect().height)).toBe(27);
    await page.keyboard.press('End');
    await expect(page.getByRole('treeitem', { name: 'Large page 1999', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('treeitem', { name: 'Large page 1000', exact: true })).toBeFocused();

    const latencies: number[] = [];
    for (let index = 0; index < 5; index++) {
      const started = Date.now();
      await page.locator('.page-title').fill(`Saved large page ${index}`);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      latencies.push(Date.now() - started);
    }
    await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' durable edit');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const response = await window.native!.api('page.get', { pageId: 'large-0' });
          return JSON.stringify(response.result);
        }),
      )
      .toContain('durable edit');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(page.locator('.page-title')).toHaveValue('Saved large page 4');
    await expect(page.locator('.bn-editor')).toContainText('durable edit');
    await expect.poll(() => page.locator('.sidebar-page').count()).toBeLessThan(80);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('large-workspace.png'), animations: 'disabled' });
    console.log(
      'LARGE WORKSPACE',
      JSON.stringify({
        pages: workspace.pages.length,
        sidebarRows: await page.locator('.sidebar-page').count(),
        titleFrameMs: latencies,
      }),
    );
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
