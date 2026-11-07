import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let page: Page;
let root: string;
let errors: string[];
const api = async (method: string, params: Record<string, unknown> = {}) => {
  const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
};
const selectText = async () => {
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Meta+a');
  await expect(page.locator('.selection-toolbar')).toBeVisible();
};

test.beforeEach(async () => {
  errors = [];
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-selection-database-')));
  const metadata = path.join(root, '.mininotion');
  fs.mkdirSync(metadata);
  fs.writeFileSync(path.join(metadata, 'collection.json'), JSON.stringify({ format: 'mininotion.collection/v1' }));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_WORKSPACE: root, MINI_NOTION_DATA_DIR: path.join(metadata, 'desktop') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  app = await electron.launch({ executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.sidebar').waitFor();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
});

test.afterEach(async () => {
  try {
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('selection toolbar formats the actual selection, supports compact overflow and anchored comments', async () => {
  const note = await api('page.create', { title: '选区体验验收', color: 'white', blocks: [
    { type: 'paragraph', content: '需要格式化的中文选区和 inline code。' },
  ] });
  await api('page.open', { pageId: note.id });
  await page.locator('.bn-editor').waitFor();
  await selectText();
  await expect(page.locator('.selection-toolbar [data-test^="alignText"]')).toHaveCount(0);
  await page.locator('.selection-toolbar [data-test="bold"]').click();
  await expect(page.locator('.bn-editor strong')).toContainText('中文选区');
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '行内代码', exact: true }).click();
  await expect(page.locator('.bn-editor code')).toContainText('inline code');
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '居中对齐', exact: true }).click();
  await expect.poll(() => page.locator('.bn-editor .bn-block-content').first().evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
  await selectText();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '清除文字格式', exact: true }).click();
  await expect(page.locator('.bn-editor strong, .bn-editor code')).toHaveCount(0);
  await selectText();
  await page.getByRole('button', { name: '评论所选内容', exact: true }).click();
  await expect(page.locator('.comment-new-quote')).toContainText('中文选区');
  await page.getByRole('textbox', { name: '新评论', exact: true }).fill('真实选区批注');
  await page.locator('.new-comment').getByRole('button', { name: '评论', exact: true }).click();
  await expect.poll(async () => (await api('comment.list', { pageId: note.id })).length).toBe(1);
  await page.getByRole('button', { name: '关闭评论', exact: true }).click();
  await page.setViewportSize({ width: 560, height: 700 });
  await api('settings.set', { changes: { theme: 'dark', sidebarHidden: true } });
  await selectText();
  const bounds = await page.locator('.selection-toolbar').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(561);
  await expect.poll(() => page.locator('.selection-toolbar').evaluate(element =>
    getComputedStyle(element.parentElement!).opacity)).toBe('1');
  expect(await page.locator('.selection-toolbar').evaluate(element =>
    getComputedStyle(element.parentElement!).transitionDuration)).toBe('0s');
  await page.screenshot({ path: 'test-results/selection-toolbar-dark-narrow.png' });
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.bn-editor')).toContainText('inline code');
  const saved = await api('page.get', { pageId: note.id });
  expect(saved.blocks[0].props.textAlignment).toBe('center');
});

test('partial selection survives colors, links and overflow without formatting surrounding text', async () => {
  const note = await api('page.create', { title: '局部选区验收', color: 'white', blocks: [
    { type: 'paragraph', content: [
      { type: 'text', text: '前文 ', styles: { italic: true } },
      { type: 'text', text: '局部选区', styles: {} },
      { type: 'text', text: ' 后文', styles: { underline: true } },
    ] },
  ] });
  await page.setViewportSize({ width: 760, height: 650 });
  await api('page.open', { pageId: note.id });
  const paragraph = page.locator('.bn-editor .bn-inline-content').first();
  const selectPartial = async () => {
    await paragraph.scrollIntoViewIfNeeded();
    const points = await paragraph.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const start = element.textContent!.indexOf('局部选区');
      const rectAt = (offset: number) => {
        let consumed = 0;
        for (const node of nodes) {
          if (offset < consumed + node.length) {
            const range = document.createRange();
            range.setStart(node, offset - consumed);
            range.setEnd(node, offset - consumed + 1);
            return range.getBoundingClientRect();
          }
          consumed += node.length;
        }
        throw new Error('Selection character not found');
      };
      const first = rectAt(start), last = rectAt(start + 3);
      return { from: { x: first.left + 1, y: first.top + first.height / 2 },
        to: { x: last.right - 1, y: last.top + last.height / 2 } };
    });
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('局部选区');
    await expect(page.locator('.selection-toolbar')).toBeVisible();
  };
  await selectPartial();
  await page.locator('.selection-toolbar [data-test="bold"]').click();
  await expect(paragraph.locator('strong')).toHaveText('局部选区');
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '行内代码', exact: true }).click();
  await expect(paragraph.locator('code')).toHaveText('局部选区');
  await expect(paragraph.locator('strong')).toHaveText('局部选区');
  await page.locator('.selection-toolbar [data-test="colors"]').click();
  const red = page.locator('[data-test="text-color-red"]');
  await expect(red).toBeVisible();
  expect(await red.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
  await red.click();
  await expect(paragraph.locator('[data-style-type="textColor"][data-value="red"]')).toHaveText('局部选区');
  await page.keyboard.press('Escape');
  await selectPartial();
  await page.locator('.selection-toolbar [data-test="createLink"]').click();
  const url = page.locator('input[name="url"]');
  await expect(url).toBeVisible();
  await url.fill('https://example.com/selection-test');
  await url.press('Enter');
  await expect(paragraph.locator('a')).toHaveText('局部选区');
  await expect(paragraph.locator('a')).toHaveAttribute('href', 'https://example.com/selection-test');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraph.locator('a')).toHaveAttribute('href', 'https://example.com/selection-test');
  await expect(paragraph.locator('strong')).toHaveText('局部选区');
  await expect(paragraph.locator('code')).toHaveText('局部选区');
  await expect(paragraph.locator('[data-style-type="textColor"][data-value="red"]')).toHaveText('局部选区');
  await selectPartial();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '清除文字格式', exact: true }).click();
  await expect(paragraph.locator('strong, code')).toHaveCount(0);
  await expect(paragraph.locator('em')).toHaveText('前文 ');
  await expect(paragraph.locator('u')).toHaveText(' 后文');
  await expect(paragraph).toHaveText('前文 局部选区 后文');
  await selectPartial();
  await page.getByRole('button', { name: '评论所选内容', exact: true }).click();
  await expect(page.locator('.comment-new-quote')).toHaveText('局部选区');
  await page.getByRole('button', { name: '关闭评论', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 780 });
  await api('settings.set', { changes: { selectionAI: { prompt: '仅解释这段文字', mode: 'edit', employeeId: '' } } });
  await selectPartial();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: '选区 AI 聊天', exact: true });
  await expect(assistant).toBeVisible();
  await expect(assistant).toContainText('在 Agents Company 中打开同一工作区');
  await expect(assistant).not.toContainText('未知数据方法');
  await expect(assistant.getByRole('combobox', { name: 'AI 员工', exact: true })).toHaveCount(0);
  await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('仅解释这段文字\n\n局部选区');
  await expect(assistant.getByRole('button', { name: '发送 AI 消息', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 760, height: 560 });
  for (const control of [
    assistant.getByRole('button', { name: '关闭选区 AI', exact: true }),
    assistant.getByRole('textbox', { name: 'AI 消息', exact: true }),
  ]) {
    await expect.poll(() => control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
        element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  await assistant.getByRole('button', { name: '关闭选区 AI', exact: true }).click();
  await expect(assistant).toHaveCount(0);
  await api('settings.set', { changes: { selectionAI: { prompt: '仅解释这段文字', mode: 'send', employeeId: 'unavailable-host-employee' } } });
  await selectPartial();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
  await expect(assistant).toContainText('在 Agents Company 中打开同一工作区');
  await expect(assistant.locator('.selection-ai-user, [role="alert"]')).toHaveCount(0);
  await expect(assistant.getByRole('button', { name: '发送 AI 消息', exact: true })).toBeDisabled();
  await assistant.getByRole('button', { name: '关闭选区 AI', exact: true }).click();
  await page.setViewportSize({ width: 760, height: 650 });
  await api('settings.set', { changes: { theme: 'dark', sidebarHidden: true } });
  await selectPartial();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  const menu = page.locator('.selection-more-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '清除文字格式', exact: true })).toBeVisible();
  expect(await menu.getByRole('menuitem').evaluateAll(elements => elements.every(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }))).toBe(true);
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(761);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(651);
  await expect.poll(() => menu.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.locator('.selection-toolbar').evaluate(element =>
    getComputedStyle(element.parentElement!).transitionDuration)).toBe('0s');
  expect(await menu.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.screenshot({ path: 'test-results/partial-selection-menu.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraph).toHaveText('前文 局部选区 后文');
  await expect(paragraph.locator('a')).toHaveText('局部选区');
  await expect(paragraph.locator('em')).toHaveText('前文 ');
  await expect(paragraph.locator('u')).toHaveText(' 后文');
});

test('mouse formatting keeps editor shortcuts and immediate typing active', async () => {
  const note = await api('page.create', { title: '格式按钮焦点验收', color: 'white', blocks: [
    { type: 'paragraph', content: '格式后继续编辑' },
  ] });
  await api('page.open', { pageId: note.id });
  await selectText();
  await page.locator('.selection-toolbar [data-test="bold"]').click();
  await expect(page.locator('.bn-editor strong')).toHaveText('格式后继续编辑');
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.bn-editor strong')).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.locator('.bn-editor strong')).toHaveText('格式后继续编辑');
  await page.keyboard.insertText('直接替换选区');
  await expect(page.locator('.bn-editor .bn-inline-content')).toHaveText('直接替换选区');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.bn-editor .bn-inline-content')).toHaveText('直接替换选区');
});

test('cross-paragraph selection preserves AI quote boundaries and surrounding text styles', async () => {
  const note = await api('page.create', { title: '跨段选区验收', color: 'white', blocks: [
    { type: 'paragraph', content: [
      { type: 'text', text: '前文 ', styles: { italic: true } },
      { type: 'text', text: '第一段选中', styles: {} },
    ] },
    { type: 'paragraph', content: [
      { type: 'text', text: '第二段选中', styles: {} },
      { type: 'text', text: ' 后文', styles: { underline: true } },
    ] },
  ] });
  await page.setViewportSize({ width: 760, height: 560 });
  await api('page.open', { pageId: note.id });
  const paragraphs = page.locator('.bn-editor .bn-inline-content');
  await expect(paragraphs).toHaveCount(2);
  let reverse = false;
  const select = async () => {
    const points = await paragraphs.evaluateAll(elements => {
      const point = (element: Element, marker: string, last: boolean) => {
        const offset = element.textContent!.indexOf(marker) + (last ? marker.length - 1 : 0);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let consumed = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (offset < consumed + node.length) {
            const range = document.createRange();
            range.setStart(node, offset - consumed);
            range.setEnd(node, offset - consumed + 1);
            const rect = range.getBoundingClientRect();
            return { x: last ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
          }
          consumed += node.length;
        }
        throw new Error('Selection character not found');
      };
      return { from: point(elements[0], '第一段选中', false), to: point(elements[1], '第二段选中', true) };
    });
    const from = reverse ? points.to : points.from, to = reverse ? points.from : points.to;
    reverse = !reverse;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('第一段选中\n\n第二段选中');
    await expect(page.locator('.selection-toolbar')).toBeVisible();
  };
  await api('settings.set', { changes: { selectionAI: { prompt: '只解释选区', mode: 'edit', employeeId: '' } } });
  await select();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
  const assistant = page.getByRole('dialog', { name: '选区 AI 聊天', exact: true });
  await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('只解释选区\n\n第一段选中\n\n第二段选中');
  await assistant.getByRole('button', { name: 'AI 提示词与发送设置', exact: true }).click();
  for (const control of [
    assistant.getByRole('button', { name: '关闭选区 AI', exact: true }),
    assistant.getByRole('textbox', { name: '前置提示词', exact: true }),
    assistant.getByRole('textbox', { name: 'AI 消息', exact: true }),
  ]) expect(await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight &&
      element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(assistant).toHaveCount(0);
  await select();
  await page.locator('.selection-toolbar [data-test="bold"]').click();
  await expect(paragraphs.locator('strong')).toHaveText(['第一段选中', '第二段选中']);
  await page.keyboard.press('Meta+z');
  await expect(paragraphs.locator('strong')).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(paragraphs.locator('strong')).toHaveText(['第一段选中', '第二段选中']);
  await select();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '居中对齐', exact: true }).click();
  await expect.poll(() => page.locator('.bn-editor .bn-block-content').evaluateAll(elements => elements.map(element => getComputedStyle(element).textAlign))).toEqual(['center', 'center']);
  await select();
  await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '清除文字格式', exact: true }).click();
  await expect(paragraphs.locator('strong')).toHaveCount(0);
  await expect(paragraphs.locator('em')).toHaveText('前文 ');
  await expect(paragraphs.locator('u')).toHaveText(' 后文');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraphs).toHaveText(['前文 第一段选中', '第二段选中 后文']);
  await expect(paragraphs.locator('em')).toHaveText('前文 ');
  await expect(paragraphs.locator('u')).toHaveText(' 后文');
});

test('cross-paragraph links cover the full selection without changing text or surrounding styles', async () => {
  const note = await api('page.create', { title: '跨段链接验收', color: 'white', blocks: [
    { type: 'paragraph', content: [
      { type: 'text', text: '前文 ', styles: { italic: true } },
      { type: 'text', text: '第一段链接', styles: { bold: true } },
    ] },
    { type: 'paragraph', content: [
      { type: 'text', text: '第二段链接', styles: {} },
      { type: 'text', text: ' 后文', styles: { underline: true } },
    ] },
  ] });
  await api('page.open', { pageId: note.id });
  const paragraphs = page.locator('.bn-editor .bn-inline-content');
  await expect(paragraphs).toHaveCount(2);
  let reverse = false;
  const select = async () => {
    const points = await paragraphs.evaluateAll(elements => {
      const point = (element: Element, marker: string, last: boolean) => {
        const offset = element.textContent!.indexOf(marker) + (last ? marker.length - 1 : 0);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let consumed = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (offset < consumed + node.length) {
            const range = document.createRange();
            range.setStart(node, offset - consumed);
            range.setEnd(node, offset - consumed + 1);
            const rect = range.getBoundingClientRect();
            return { x: last ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
          }
          consumed += node.length;
        }
        throw new Error('Selection character not found');
      };
      return { from: point(elements[0], '第一段链接', false), to: point(elements[1], '第二段链接', true) };
    });
    const from = reverse ? points.to : points.from, to = reverse ? points.from : points.to;
    reverse = !reverse;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('第一段链接\n\n第二段链接');
  };
  await select();
  await page.locator('.selection-toolbar [data-test="createLink"]').click();
  const url = page.locator('input[name="url"]');
  await url.fill('https://example.com/selection-test');
  await url.press('Enter');
  await expect(paragraphs).toHaveText(['前文 第一段链接', '第二段链接 后文']);
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  for (const link of await paragraphs.locator('a').all()) await expect(link).toHaveAttribute('href', 'https://example.com/selection-test');
  await expect(paragraphs.locator('strong')).toHaveText('第一段链接');
  await expect(paragraphs.locator('em')).toHaveText('前文 ');
  await expect(paragraphs.locator('u')).toHaveText(' 后文');
  await page.keyboard.press('Meta+z');
  await expect(paragraphs.locator('a')).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraphs).toHaveText(['前文 第一段链接', '第二段链接 后文']);
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  await expect(paragraphs.locator('strong')).toHaveText('第一段链接');
  await expect(paragraphs.locator('em')).toHaveText('前文 ');
  await expect(paragraphs.locator('u')).toHaveText(' 后文');
  await select();
  await page.keyboard.press('Meta+k');
  await expect(url).toBeFocused();
  await expect(url).toHaveValue('https://example.com/selection-test');
  await url.fill('example.com/updated-selection');
  await url.press('Enter');
  for (const link of await paragraphs.locator('a').all()) await expect(link).toHaveAttribute('href', 'https://example.com/updated-selection');
  await expect(paragraphs).toHaveText(['前文 第一段链接', '第二段链接 后文']);
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(url).toHaveValue('https://example.com/updated-selection');
  await url.fill('example.com/canceled-selection');
  await url.press('Escape');
  await expect(url).toBeHidden();
  await expect(page.locator('.bn-editor')).toBeFocused();
  for (const link of await paragraphs.locator('a').all()) await expect(link).toHaveAttribute('href', 'https://example.com/updated-selection');
  await page.keyboard.press('Meta+k');
  await expect(url).toBeFocused();
  await expect(url).toHaveValue('https://example.com/updated-selection');
  await url.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-toolbar')).toBeHidden();
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(url).toBeFocused();
  await expect(url).toHaveValue('https://example.com/updated-selection');
  await url.fill('example.com/discarded-by-selection-change');
  await paragraphs.last().click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await expect(url).toBeHidden();
  await expect(page.locator('.bn-editor')).toBeFocused();
  await page.keyboard.press('Meta+a');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('前文 第一段链接\n\n第二段链接 后文\n\n');
  await expect(url).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-toolbar')).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(url).toBeFocused();
  await expect(url).toHaveValue('https://example.com/updated-selection');
  await url.press('Escape');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  for (const link of await paragraphs.locator('a').all()) await expect(link).toHaveAttribute('href', 'https://example.com/updated-selection');
  await select();
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('button', { name: '移除链接', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除链接', exact: true }).click();
  await expect(paragraphs.locator('a')).toHaveCount(0);
  await expect(paragraphs).toHaveText(['前文 第一段链接', '第二段链接 后文']);
  await expect(paragraphs.locator('strong')).toHaveText('第一段链接');
  await page.keyboard.press('Meta+z');
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  await page.keyboard.press('Meta+Shift+z');
  await expect(paragraphs.locator('a')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(paragraphs.locator('a')).toHaveCount(0);
  await expect(paragraphs.locator('strong')).toHaveText('第一段链接');
  await expect(paragraphs.locator('em')).toHaveText('前文 ');
  await expect(paragraphs.locator('u')).toHaveText(' 后文');
  await select();
  await page.keyboard.press('Meta+k');
  await url.fill('https://example.com/removable');
  await url.press('Enter');
  await expect(paragraphs.locator('a')).toHaveText(['第一段链接', '第二段链接']);
  await select();
  await page.keyboard.press('Meta+k');
  await url.fill('');
  await url.press('Enter');
  await expect(paragraphs.locator('a')).toHaveCount(0);
  await expect(paragraphs).toHaveText(['前文 第一段链接', '第二段链接 后文']);
  await expect(page.locator('.save-status')).toContainText('已保存');
});

test('background link clicks never open an external browser and internal links still navigate', async () => {
  await app.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { externalOpenAttempts: string[] };
    state.externalOpenAttempts = [];
    shell.openExternal = async url => { state.externalOpenAttempts.push(url); };
  });
  const target = await api('page.create', { title: '后台内部链接目标', color: 'white', blocks: [] });
  const note = await api('page.create', { title: '后台链接验收', color: 'white', blocks: [
    { type: 'paragraph', content: [
      { type: 'link', href: 'https://example.com/background-test', content: [{ type: 'text', text: '外部测试链接', styles: {} }] },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: `mininotion://page/${target.id}`, content: [{ type: 'text', text: '内部测试链接', styles: {} }] },
    ] },
  ] });
  await api('page.open', { pageId: note.id });
  await page.locator('.bn-editor a').filter({ hasText: '外部测试链接' }).click();
  await page.evaluate(() => window.native!.openExternal('https://example.com/background-api-test'));
  expect(await app.evaluate(() => (globalThis as typeof globalThis & { externalOpenAttempts: string[] }).externalOpenAttempts)).toEqual([]);
  await expect(page.locator('.page-title')).toHaveValue(note.title);
  await page.locator('.bn-editor a').filter({ hasText: '内部测试链接' }).click();
  await expect(page.locator('.page-title')).toHaveValue(target.title);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  expect((await api('page.get', { pageId: note.id })).blocks).toEqual(note.blocks);
});

test('native forward-line deletion of a mixed document preserves undo, redo and saved content', async () => {
  for (const codeFirst of [false, true]) {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: '原生删除前文', styles: { bold: true } }] },
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'const nativeDeletionFixture = 1;\nconst secondLine = 2;' },
    ];
    const note = await api('page.create', { title: `原生删除 ${codeFirst}`, color: 'white', blocks: codeFirst ? blocks.reverse() : blocks });
    await api('page.open', { pageId: note.id });
    const editor = page.locator('.bn-editor');
    await editor.locator('[data-content-type="codeBlock"] .bn-inline-content').click();
    await page.keyboard.press('Meta+a');
    await expect(editor).toBeFocused();
    await expect.poll(() => editor.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual({ type: 'all' });
    const before = await editor.evaluate(element => (element as any).editor.state.doc.toJSON());
    const saved = await api('page.get', { pageId: note.id });
    await page.keyboard.press('Control+k');
    await expect(editor).not.toContainText('nativeDeletionFixture');
    await expect(editor).not.toContainText('原生删除前文');
    await expect(page.locator('input[name="url"]')).toBeHidden();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Meta+z');
    await expect.poll(() => editor.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(before);
    await expect.poll(async () => (await api('page.get', { pageId: note.id })).blocks).toEqual(saved.blocks);
    await page.keyboard.press('Meta+Shift+z');
    await expect(editor).not.toContainText('nativeDeletionFixture');
    await expect(editor).not.toContainText('原生删除前文');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor).not.toContainText('nativeDeletionFixture');
    await expect(editor).not.toContainText('原生删除前文');
    const cleared = await api('page.get', { pageId: note.id });
    expect(cleared.blocks).toHaveLength(1);
    expect(cleared.blocks[0].type).toBe('paragraph');
    expect(cleared.blocks[0].content).toEqual([]);
  }
});

test('native code deletion keeps caret behavior and removes only selected text', async () => {
  for (const mode of ['all', 'range', 'caret']) {
    const note = await api('page.create', { title: `代码删除 ${mode}`, color: 'white', blocks: [
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'prefixSUFFIX\nsecond line' },
    ] });
    await api('page.open', { pageId: note.id });
    const editor = page.locator('.bn-editor');
    const code = editor.locator('[data-content-type="codeBlock"] .bn-inline-content');
    await code.click();
    if (mode === 'all') {
      await page.keyboard.press('Meta+a');
      await expect.poll(() => editor.evaluate(element => (element as any).editor.state.selection.toJSON())).toEqual({ type: 'all' });
    } else {
      await page.keyboard.press('Meta+ArrowUp');
      await page.keyboard.press('Meta+ArrowLeft');
      for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowRight');
      if (mode === 'range') {
        for (let index = 0; index < 6; index++) await page.keyboard.press('Shift+ArrowRight');
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('SUFFIX');
      }
    }
    const before = await editor.evaluate(element => (element as any).editor.state.doc.toJSON());
    const saved = await api('page.get', { pageId: note.id });
    await page.keyboard.press('Control+k');
    if (mode === 'all') {
      await expect(editor).not.toContainText('prefix');
      await expect(editor).not.toContainText('second line');
    } else await expect(code).toHaveText('prefix\nsecond line');
    await expect(page.locator('input[name="url"]')).toBeHidden();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Meta+z');
    await expect.poll(() => editor.evaluate(element => (element as any).editor.state.doc.toJSON())).toEqual(before);
    await expect.poll(async () => (await api('page.get', { pageId: note.id })).blocks).toEqual(saved.blocks);
    await page.keyboard.press('Meta+Shift+z');
    if (mode === 'all') await expect(editor).not.toContainText('prefix');
    else await expect(code).toHaveText('prefix\nsecond line');
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(editor).toBeVisible();
    if (mode === 'all') await expect(editor).not.toContainText('prefix');
    else await expect(code).toHaveText('prefix\nsecond line');
  }
});

test('releasing a click inside selected text commits a caret without consuming the next arrow', async () => {
  const note = await api('page.create', { title: '选区内单击释放', color: 'white', blocks: [
    { type: 'paragraph', content: '保留周围段落' },
    { type: 'codeBlock', props: { language: 'javascript' }, content: 'prefixSUFFIX\nsecond line' },
  ] });
  await api('page.open', { pageId: note.id });
  const editor = page.locator('.bn-editor');
  const code = editor.locator('[data-content-type="codeBlock"] .bn-inline-content');
  await expect(code).toBeVisible();
  const point = await code.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const range = document.createRange();
    range.setStart(walker.currentNode, 6);
    range.setEnd(walker.currentNode, 7);
    const character = range.getBoundingClientRect(), bounds = element.getBoundingClientRect();
    return { x: character.left + 1 - bounds.left, y: character.top + character.height / 2 - bounds.top };
  });
  await page.evaluate(() => {
    (window as any).releasedSelection = undefined;
    document.addEventListener('mouseup', () => {
      const element = document.querySelector('.bn-editor') as any;
      (window as any).releasedSelection = element.editor.state.selection.toJSON();
    });
  });
  for (const mode of ['all', 'range']) {
    await code.click({ position: point });
    if (mode === 'all') await page.keyboard.press('Meta+a');
    else {
      await page.keyboard.press('Meta+ArrowLeft');
      for (let index = 0; index < 12; index++) await page.keyboard.press('Shift+ArrowRight');
      await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('prefixSUFFIX');
    }
    await code.click({ position: point });
    const released = await page.evaluate(() => (window as any).releasedSelection);
    expect(released.type).toBe('text');
    expect(released.anchor).toBe(released.head);
    await page.keyboard.press('ArrowRight');
    const offset = await code.evaluate(element => {
      const native = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(native.focusNode!, native.focusOffset);
      return range.toString().length;
    });
    expect(offset).toBe(7);
    await expect(code).toHaveText('prefixSUFFIX\nsecond line');
    await expect(editor.locator('[data-content-type="paragraph"]')).toHaveText('保留周围段落');
  }
});

test('collapsing a full-document selection before native deletion never removes surrounding blocks', async () => {
  for (let index = 0; index < 20; index++) {
    const note = await api('page.create', { title: `收起选区删除 ${index}`, color: 'white', blocks: [
      { type: 'paragraph', content: '保留周围段落' },
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'prefixSUFFIX\nsecond line' },
    ] });
    await api('page.open', { pageId: note.id });
    const editor = page.locator('.bn-editor');
    const code = editor.locator('[data-content-type="codeBlock"] .bn-inline-content');
    const point = await code.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      walker.nextNode();
      const range = document.createRange();
      range.setStart(walker.currentNode, 6);
      range.setEnd(walker.currentNode, 7);
      const character = range.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      return { x: character.left + 1 - bounds.left, y: character.top + character.height / 2 - bounds.top };
    });
    await code.click({ position: point });
    await page.keyboard.press('Meta+a');
    await code.click({ position: point });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    const caret = await code.evaluate(element => {
      const selection = element.ownerDocument.getSelection()!;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.setEnd(selection.focusNode!, selection.focusOffset);
      const offset = range.toString().length;
      const text = element.textContent!;
      const lineEnd = text.indexOf('\n', offset);
      const end = lineEnd === offset ? offset + 1 : lineEnd < 0 ? text.length : lineEnd;
      return { collapsed: selection.isCollapsed, text, offset, contains: element.contains(selection.focusNode), expected: text.slice(0, offset) + text.slice(end) };
    });
    expect(caret.contains).toBe(true);
    expect(caret.offset).toBe(7);
    expect(caret.expected).not.toBe(caret.text);
    await page.keyboard.press('Control+k');
    expect(caret.collapsed).toBe(true);
    await expect(editor.locator('[data-content-type="paragraph"]')).toHaveText('保留周围段落');
    await expect(code).toHaveText(caret.expected);
    await expect(page.locator('input[name="url"]')).toBeHidden();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Meta+z');
    await expect(code).toHaveText(caret.text);
    await expect.poll(async () => (await api('page.get', { pageId: note.id })).blocks).toEqual(note.blocks);
    await page.keyboard.press('Meta+Shift+z');
    await expect(code).toHaveText(caret.expected);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(editor.locator('[data-content-type="paragraph"]')).toHaveText('保留周围段落');
    await expect(code).toHaveText(caret.expected);
    expect((await api('page.get', { pageId: note.id })).blocks.map((block: any) => block.type)).toEqual(['paragraph', 'codeBlock']);
  }
});

test('link shortcut leaves code-only and mixed plain-content selections unchanged', async () => {
  for (const mixed of [false, true]) {
    const note = await api('page.create', { title: mixed ? '混合代码选区' : '纯代码选区', color: 'white', blocks: [
      ...(mixed ? [{ type: 'paragraph', content: '可格式化文本' }] : []),
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'const fixture = 1;' },
    ] });
    await api('page.open', { pageId: note.id });
    await page.locator('.bn-editor [data-content-type="codeBlock"] .bn-inline-content').click();
    await page.keyboard.press('Meta+a');
    await expect(page.locator('.bn-editor')).toBeFocused();
    await expect(page.locator('.selection-toolbar')).toBeHidden();
    const saved = await api('page.get', { pageId: note.id });
    await page.keyboard.press('Meta+k');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('input[name="url"]')).toBeHidden();
    await expect(page.locator('.selection-toolbar')).toBeHidden();
    await expect(page.locator('.bn-editor a')).toHaveCount(0);
    expect((await api('page.get', { pageId: note.id })).blocks).toEqual(saved.blocks);
  }
});

test('narrow database keeps overflowing saved views and toolbar controls reachable', async () => {
  await page.setViewportSize({ width: 760, height: 650 });
  const db = await api('database.create', { title: '窄窗口数据库', color: 'white' });
  for (let i = 1; i <= 8; i++) await api('view.create', { databaseId: db.id, type: 'table', name: `项目进度与交付检查视图 ${i}` });
  await api('page.open', { pageId: db.id });
  const tabs = page.locator('.view-tabs > button[data-view-id]');
  await expect(tabs).toHaveCount(9);
  for (const sidebarHidden of [false, true]) {
    await api('settings.set', { changes: { sidebarHidden } });
    await tabs.first().focus();
    await page.keyboard.press('End');
    const last = tabs.last();
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => last.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      const actions = element.parentElement!.querySelector('.view-tab-actions')!.getBoundingClientRect();
      return bounds.left >= parent.left - 1 && bounds.right <= actions.left + 1;
    })).toBe(true);
    await last.click();
    await expect(page.locator('.popover-layer')).toBeVisible();
    await page.keyboard.press('Escape');
    for (const label of ['全部视图', '添加视图', '筛选', '排序', '设置分组与分类', '数据库设置', '新建记录']) {
      const control = page.getByRole('button', { name: label, exact: true });
      await expect(control).toBeVisible();
      expect(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
          element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), label).toBe(true);
    }
    const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
    await search.fill('无结果');
    await expect(page.locator('.database-search-results')).toContainText('没有匹配的记录');
    await page.getByRole('button', { name: '清除数据库搜索', exact: true }).click();
    await expect(search).toHaveValue('');
    await tabs.last().focus();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => tabs.first().evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  await page.screenshot({ path: 'test-results/database-narrow-many-views.png' });
});

test('database column sorting, search recovery and keyboard view navigation persist', async () => {
  const db = await api('database.create', { title: '数据库体验验收', color: 'white', columns: [
    { id: 'amount', name: '工时', type: 'number' }, { id: 'notes', name: '说明', type: 'text' },
  ] });
  for (const amount of [20, 2, 10]) await api('record.create', { databaseId: db.id, color: 'white', title: `任务${amount}`, values: { amount, notes: `说明${amount}` } });
  await api('page.open', { pageId: db.id });
  await page.locator('.database-table').waitFor();
  await page.getByRole('button', { name: '工时列选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '升序排列', exact: true }).click();
  await expect(page.locator('.database-table .record-title-copy strong')).toHaveText(['任务2', '任务10', '任务20']);
  await page.getByRole('button', { name: '工时列选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '降序排列', exact: true }).click();
  await expect(page.locator('.database-table .record-title-copy strong')).toHaveText(['任务20', '任务10', '任务2']);
  await page.getByRole('button', { name: '说明列选项', exact: true }).click();
  await page.getByRole('menuitem', { name: '隐藏此属性', exact: true }).click();
  await expect(page.getByRole('button', { name: '说明列选项', exact: true })).toHaveCount(0);
  const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
  await search.fill('不存在的记录');
  await expect(page.getByRole('status').filter({ hasText: '没有匹配的记录' })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('.database-table [data-row-id]')).toHaveCount(3);
  await search.fill('任务10');
  await expect(page.locator('.database-search-results')).toContainText('找到 1 条记录');
  await page.getByRole('button', { name: '清除数据库搜索', exact: true }).click();
  await expect(page.locator('.database-table [data-row-id]')).toHaveCount(3);
  await api('view.create', { databaseId: db.id, type: 'list', name: '紧凑列表' });
  const firstView = page.locator('.view-tabs > button[data-view-id]').first();
  const firstId = await firstView.getAttribute('data-view-id');
  await firstView.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.view-tabs > button[data-view-id]').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home');
  await expect(firstView).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.screenshot({ path: 'test-results/database-column-ux.png' });
  await page.reload();
  await page.locator('.database-table').waitFor();
  await expect(page.locator('.database-table .record-title-copy strong')).toHaveText(['任务20', '任务10', '任务2']);
  const views = await api('view.list', { databaseId: db.id });
  const saved = views.find((view: { id: string }) => view.id === firstId);
  expect(saved.sorts[0].direction).toBe('desc');
  expect(saved.hiddenProperties).toContain('notes');
});

test('wide database searches text and checkbox columns through hidden Electron views', async () => {
  test.setTimeout(150000);
  const columns = [
    ...Array.from({ length: 48 }, (_, index) => ({
      id: `field-${index}`, name: `扩展属性${index}`, type: 'text',
    })),
    { id: 'done', name: '已处理', type: 'checkbox' },
  ];
  const database = await api('database.create', {
    title: '宽表搜索验收', color: 'white', columns,
  });
  for (let index = 0; index < 80; index++) {
    await api('record.create', {
      databaseId: database.id, color: 'white', title: `记录${index}`,
      values: {
        'field-47': index === 63 ? '唯一列值' : '常规内容',
        done: index === 63,
      },
    });
  }
  const list = await api('view.create', {
    databaseId: database.id, type: 'list', name: '列表验证',
  });
  const views = await api('view.list', { databaseId: database.id });
  const table = views.find((view: { type: string }) => view.type === 'table');
  await api('view.select', { databaseId: database.id, viewId: table.id });
  await api('page.open', { pageId: database.id });
  await page.locator('.database-table').waitFor();
  const search = page.getByRole('textbox', { name: '搜索数据库', exact: true });
  await search.fill('唯一列值');
  await expect(page.locator('.database-search-results')).toContainText('找到 1 条记录');
  await expect(page.locator('.database-table .record-title-copy strong')).toHaveText(['记录63']);
  await search.fill('true');
  await expect(page.locator('.database-search-results')).toContainText('找到 1 条记录');
  await expect(page.locator('.database-table .record-title-copy strong')).toHaveText(['记录63']);
  await api('view.select', { databaseId: database.id, viewId: list.id });
  await expect(page.locator('.database-search-results')).toContainText('找到 1 条记录');
  await search.fill('记录17');
  await expect(page.locator('.database-search-results')).toContainText('找到 1 条记录');
  await expect(page.locator('.database')).toContainText('记录17');
  await page.getByRole('button', { name: '清除数据库搜索', exact: true }).click();
  await expect(page.locator('.database-search-results')).toHaveCount(0);
  expect((await api('record.list', { databaseId: database.id })).length).toBe(80);
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.screenshot({ path: 'test-results/database-wide-search.png' });
});

test('many board categories preserve custom order and open their actual cards', async () => {
  test.setTimeout(150000);
  const categories = Array.from({ length: 48 }, (_, index) => `阶段${index}`);
  const database = await api('database.create', {
    title: '多分类看板验收', color: 'white',
    columns: [{ id: 'stage', name: '阶段', type: 'select', options: categories }],
  });
  const board = await api('view.create', {
    databaseId: database.id, type: 'board', name: '自定义顺序',
    config: { groupBy: 'stage', groupOrder: [...categories].reverse(), hideEmptyGroups: true },
  });
  for (let index = 0; index < categories.length; index++) {
    await api('record.create', {
      databaseId: database.id, color: 'white', title: `记录${index}`,
      values: { stage: categories[index] },
    });
  }
  await api('page.open', { pageId: database.id });
  const groups = page.locator(`.database[data-database-id="${database.id}"] .board-column[data-group-key]`);
  await expect(groups).toHaveCount(categories.length);
  await expect(groups.first()).toHaveAttribute('data-group-key', '阶段47');
  await expect(groups.last()).toHaveAttribute('data-group-key', '阶段0');
  await groups.first().locator('.database-card').click();
  await expect(page.locator('.peek-panel .page-title')).toHaveValue('记录47');
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(groups.first()).toHaveAttribute('data-group-key', '阶段47');
  await expect(groups.last()).toHaveAttribute('data-group-key', '阶段0');
  const saved = (await api('view.list', { databaseId: database.id }))
    .find((view: { id: string }) => view.id === board.id);
  expect(saved.groupOrder[0]).toBe('阶段47');
  await page.screenshot({ path: 'test-results/database-many-groups.png' });
});

test('wide editable tables apply sparse cell colors and update rules without stale styles', async () => {
  test.setTimeout(150000);
  const columns = [
    ...Array.from({ length: 36 }, (_, index) => ({
      id: `field-${index}`, name: `扩展列${index}`, type: 'text',
    })),
    { id: 'score', name: '得分', type: 'number' },
  ];
  const database = await api('database.create', {
    title: '宽表条件颜色验收', color: 'white', columns,
  });
  const highlighted = await api('record.create', {
    databaseId: database.id, title: '需要高亮的记录', color: 'white',
    values: { score: 50, 'field-35': '可编辑末列' },
  });
  for (let index = 0; index < 72; index++) {
    await api('record.create', {
      databaseId: database.id, title: `常规记录${index}`, color: 'white',
      values: { score: 5 },
    });
  }
  const table = (await api('view.list', { databaseId: database.id }))[0];
  const filter = {
    id: 'color-filter', conjunction: 'and',
    rules: [{ id: 'minimum', property: 'score', operator: 'gte', value: '40' }],
  };
  const rules = [
    { id: 'highlight-row', filter, color: 'green' },
    { id: 'highlight-cell', filter, color: 'blue', targetProperty: 'field-35' },
  ];
  await api('view.update', {
    databaseId: database.id, viewId: table.id, changes: { conditionalColors: rules },
  });
  await api('page.open', { pageId: database.id });
  const row = page.locator(`.database-table tr[data-row-id="${highlighted.id}"]`);
  const cell = row.locator('td').nth(37); // selection, title, then field-0 through field-35
  await expect(row).toHaveCSS('background-color', 'rgb(234, 242, 235)');
  await expect(cell).toHaveCSS('background-color', 'rgb(234, 242, 251)');
  await api('view.update', {
    databaseId: database.id, viewId: table.id,
    changes: { conditionalColors: [rules[0], { ...rules[1], color: 'green' }] },
  });
  await expect(cell).toHaveCSS('background-color', 'rgb(234, 242, 235)');
  await row.getByRole('textbox', { name: '扩展列35', exact: true }).fill('编辑成功');
  await row.getByRole('textbox', { name: '扩展列35', exact: true }).press('Tab');
  await expect.poll(async () =>
    (await api('record.list', { databaseId: database.id }))
      .find((record: { id: string }) => record.id === highlighted.id)?.values['field-35'],
  ).toBe('编辑成功');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(cell).toHaveCSS('background-color', 'rgb(234, 242, 235)');
  expect((await api('record.list', { databaseId: database.id })).length).toBe(73);
  await page.screenshot({ path: 'test-results/database-wide-conditional-colors.png' });
});
