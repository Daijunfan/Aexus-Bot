import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('keyboard-opened selection menu sends only highlighted words to Agent', async () => {
  test.setTimeout(120000);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-selection-keyboard-')));
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINI_NOTION_WORKSPACE', 'MINI_NOTION_DATA_DIR',
    'MINI_NOTION_SOCKET', 'MINI_NOTION_AGENT_TOKEN', 'AGENTS_COMPANY_PLUGIN_RPC', 'VITE_DEV_SERVER_URL',
    'MINI_NOTION_AGENT_CLAUDE', 'MINI_NOTION_AGENT_CODEX']) delete env[key];
  Object.assign(env, { MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: directory });
  const executablePath = process.env.MINI_NOTION_EXECUTABLE;
  const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env });
  const page = await app.firstWindow();
  await page.locator('.page-title').waitFor();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const hidden = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  const api = async (method: string, params: Record<string, unknown>) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  try {
    expect(await hidden()).toBe(true);
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items
      .find(item => item.label === '编辑')?.submenu?.items
      .find(item => item.label === '发送选区给 Agent')?.accelerator)).toBe('CmdOrCtrl+Shift+J');
    const note = await api('page.create', { title: '键盘选区引用验收', color: 'white', blocks: [
      { type: 'paragraph', content: '前段不发送 仅发送选区 后段不发送' },
    ] });
    await api('settings.set', { changes: { selectionAI: { prompt: '解释选区', mode: 'edit' } } });
    await api('page.open', { pageId: note.id });
    const paragraph = page.locator('.bn-editor .bn-inline-content').first();
    await paragraph.waitFor();
    const textPoints = (selected: string) => paragraph.evaluate((element, selected) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const source = element.textContent!;
      const start = source.indexOf(selected);
      const end = start + selected.length;
      const rectAt = (offset: number) => {
        let length = 0;
        for (const node of nodes) {
          if (offset < length + node.length) {
            const range = document.createRange();
            range.setStart(node, offset - length);
            range.setEnd(node, offset - length + 1);
            return range.getBoundingClientRect();
          }
          length += node.length;
        }
        throw new Error('Selection offset not found');
      };
      const first = rectAt(start), last = rectAt(end - 1);
      return { from: { x: first.left + 1, y: first.top + first.height / 2 },
        to: { x: last.right - 1, y: last.top + last.height / 2 } };
    }, selected);
    const points = await textPoints('仅发送选区');
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('仅发送选区');
    const more = page.getByRole('button', { name: '更多文本操作', exact: true });
    await expect(more).toBeVisible();
    await more.focus();
    const focusHistory: string[] = [];
    for (let index = 0; index < 12; index++) {
      focusHistory.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 30) || 'unknown'));
      if (await more.evaluate(element => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    expect(focusHistory).toContain('更多文本操作');
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: '选区 AI 聊天', exact: true });
    await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true }))
      .toHaveValue('解释选区\n\n仅发送选区');
    await assistant.getByRole('button', { name: '关闭选区 AI', exact: true }).click();
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('仅发送选区');
    await page.keyboard.press('Meta+Shift+j');
    await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true }))
      .toHaveValue('解释选区\n\n仅发送选区');
    await assistant.getByRole('button', { name: '关闭选区 AI', exact: true }).click();
    const earlier = await textPoints('前段不发送');
    await page.mouse.move(earlier.from.x, earlier.from.y);
    await page.mouse.down();
    await page.mouse.move(earlier.to.x, earlier.to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('前段不发送');
    await more.click();
    await expect(page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('仅发送选区');
    await more.focus();
    for (let index = 0; index < 12; index++) {
      if (await more.evaluate(element => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
    await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true }))
      .toHaveValue('解释选区\n\n仅发送选区');
    expect(await hidden()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
