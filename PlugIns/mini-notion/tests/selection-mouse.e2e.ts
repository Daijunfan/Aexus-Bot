import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('native word, paragraph and Shift-click selections keep their anchors', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-mouse-selection-')));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: root };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  const app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')], env });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.sidebar').waitFor();
    const hidden = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()));
    expect(await hidden()).toBe(true);
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
      if (reply.error) throw new Error(reply.error.message);
      return reply.result;
    };
    const note = await api('page.create', { title: '原生鼠标选区', color: 'white', blocks: [
      { type: 'paragraph', content: 'alpha bravo charlie delta' },
      { type: 'paragraph', content: 'surrounding paragraph stays intact' },
    ] });
    await api('page.open', { pageId: note.id });
    const editor = page.locator('.bn-editor');
    const paragraph = editor.locator('.bn-inline-content').first();
    const point = (offset: number) => paragraph.evaluate((element, offset) => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    }, offset);
    const before = await editor.evaluate(element => (element as any).editor.state.doc.toJSON());
    const word = await point(8);
    await page.mouse.dblclick(word.x, word.y);
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('bravo');
    const first = await point(2);
    await page.mouse.click(first.x, first.y, { clickCount: 3 });
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('alpha bravo charlie delta');
    await page.keyboard.press('ArrowLeft');
    for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowRight');
    const end = await point(19);
    await page.keyboard.down('Shift');
    await page.mouse.click(end.x, end.y);
    await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('bravo charlie');
    await page.keyboard.press('ArrowRight');
    const start = await point(0);
    await page.keyboard.down('Shift');
    await page.mouse.click(start.x, start.y);
    await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('alpha bravo charlie');
    await page.keyboard.press('Meta+b');
    await expect(paragraph.locator('strong')).toHaveText('alpha bravo charlie');
    await expect(paragraph).toHaveText('alpha bravo charlie delta');
    await page.keyboard.press('Meta+z');
    await expect(paragraph.locator('strong')).toHaveCount(0);
    await expect.poll(() => editor.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(before);
    await expect(page.locator('.save-status')).toContainText('已保存');
    const saved = await api('page.get', { pageId: note.id });
    await page.reload();
    await expect(paragraph).toHaveText('alpha bravo charlie delta');
    expect((await api('page.get', { pageId: note.id })).blocks).toEqual(saved.blocks);
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
