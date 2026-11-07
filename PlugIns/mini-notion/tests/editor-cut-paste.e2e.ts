import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('full-document cut and cross-page paste never add indentation guides', async () => {
  test.setTimeout(120000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-editor-cut-'));
  const env = {
    ...process.env, MINI_NOTION_DATA_DIR: data,
    MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MINI_NOTION_WORKSPACE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.AGENTS_COMPANY_PLUGIN_RPC;
  const app = await electron.launch({
    executablePath: process.env.MINI_NOTION_EXECUTABLE,
    args: process.env.MINI_NOTION_EXECUTABLE ? [] : [path.resolve(import.meta.dirname, '..')], env,
  });
  try {
    let page = await app.firstWindow();
    await page.locator('.page-title').waitFor();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    const api = async (method: string, params: Record<string, unknown> = {}) => {
      const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), { method, params });
      expect(response.error).toBeUndefined();
      return response.result as any;
    };
    const block = (text: string, type = 'paragraph', styles: Record<string, boolean> = {}) => ({
      type, content: [{ type: 'text', text, styles }], children: [],
    });
    const sourceText = [
      '第一段 我想给当前的应用添加功能',
      '第二段 文本粘贴应该保持结构',
      '第三段 反复剪切也不能增加竖线',
    ];
    const createPage = (title: string, blocks?: any[]) =>
      api('page.create', { title, color: 'white', ...(blocks ? { blocks } : {}) });
    const source = await createPage('剪切原始页', sourceText.map(text => block(text)));
    const targets = await Promise.all([
      createPage('第一目标页'), createPage('第二目标页'), createPage('第三目标页'),
    ]);
    const persisted = async (id: string): Promise<any[]> => (await api('page.get', { pageId: id })).blocks;
    const flatText = (blocks: any[]): string[] => blocks.map(item =>
      Array.isArray(item.content)
        ? item.content.map((span: any) => span.text || '').join('')
        : typeof item.content === 'string' ? item.content : '');
    const counts = () => page.locator('.note-editor .bn-editor').evaluate(editor => ({
      blockGroups: editor.querySelectorAll('.bn-block-group').length,
      guideCount: Array.from(editor.querySelectorAll<HTMLElement>('.bn-block-outer')).filter(outer => {
        const style = getComputedStyle(outer, '::before');
        return style.content !== 'none' && style.borderLeftWidth !== '0px';
      }).length,
    }));
    const cutAll = async (id: string) => {
      const title = (await api('page.get', { pageId: id })).title;
      await api('page.open', { pageId: id });
      await expect(page.locator('.page-title')).toHaveValue(title);
      const editor = page.locator('.note-editor .bn-editor').first();
      const marker = (await editor.innerText()).split('\n').find(line => line.trim())?.trim().slice(0, 20) || '';
      await editor.locator('.bn-inline-content').first().click();
      await page.keyboard.press('Meta+a');
      const clipboard = await editor.evaluate(element => {
        const transfer = new DataTransfer();
        const event = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: transfer });
        element.dispatchEvent(event);
        return Object.fromEntries(Array.from(transfer.types).map(type => [type, transfer.getData(type)]));
      });
      expect(clipboard['blocknote/html']).toContain('data-pm-slice="0 0 []"');
      // Ensure the cut is durable before a test-only API navigation. Real
      // page changes also pass through the writer, but an immediate synthetic
      // cut+navigate can race the 120 ms optimistic write debounce.
      if (marker) await expect.poll(async () => JSON.stringify(await persisted(id))).not.toContain(marker);
      return clipboard;
    };
    const paste = async (id: string, clipboard: Record<string, string>, position = 0) => {
      const { title, blocks } = await api('page.get', { pageId: id });
      await api('page.open', { pageId: id });
      await expect(page.locator('.page-title')).toHaveValue(title);
      const editor = page.locator('.note-editor .bn-editor').first();
      if (position) await expect(editor.locator('.bn-inline-content')).toHaveCount(blocks.length);
      const insertion = editor.locator('.bn-inline-content').nth(position);
      await insertion.click();
      // Synthetic paste has no preceding Cmd+V keydown to flush the DOM selection.
      await expect.poll(() => insertion.evaluate(element => {
        const view = (element.closest('.bn-editor') as any).editor.view;
        const { $from } = view.state.selection;
        return $from.node($from.depth - 1).attrs.id === element.closest('[data-node-type="blockContainer"]')!.getAttribute('data-id');
      })).toBe(true);
      const handled = await editor.evaluate((element, data) => {
        const transfer = new DataTransfer();
        for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, clipboard);
      expect(handled).toBe(true);
    };

    // Three complete transfers previously yielded 2, 3, then 4 nesting levels.
    let from = source.id;
    for (const [index, to] of targets.map(item => item.id).entries()) {
      const copied = await cutAll(from);
      await paste(to, copied);
      await expect(page.locator('.note-editor .bn-editor')).toContainText(sourceText[0]);
      await expect.poll(async () => flatText(await persisted(to))).toEqual(sourceText);
      expect((await persisted(to)).every(item => !item.children?.length)).toBe(true);
      expect(await counts()).toEqual({ blockGroups: 1, guideCount: 0 });
      await page.screenshot({ path: test.info().outputPath('paste-' + (index + 1) + '.png'), animations: 'disabled' });
      from = to;
    }
    await page.reload();
    await page.locator('.page-title').waitFor();
    await api('page.open', { pageId: from });
    await expect(page.locator('.note-editor .bn-editor')).toContainText(sourceText[2]);
    expect(await counts()).toEqual({ blockGroups: 1, guideCount: 0 });

    // A document created by the old broken paste path contains contentless
    // paragraph parents. A full-page transfer removes only those wrappers.
    const legacy = await createPage('历史异常缩进', [{
      type: 'paragraph', content: [], children: [{
        type: 'paragraph', content: [], children: [
          block('原有第一段'), block('原有第二段'),
        ],
      }],
    }]);
    const restored = await createPage('恢复成普通段落');
    await paste(restored.id, await cutAll(legacy.id));
    await expect.poll(async () => flatText(await persisted(restored.id))).toEqual(['原有第一段', '原有第二段']);
    expect(await counts()).toEqual({ blockGroups: 1, guideCount: 0 });

    // Intentional nested lists, styled headings and quotes keep their semantics.
    const rich = await createPage('富文本和合法缩进', [
      { ...block('真正的标题', 'heading', { bold: true }), props: { level: 2 } },
      { ...block('父级列表', 'bulletListItem'), children: [block('有意义的子项', 'bulletListItem')] },
      block('引用内容', 'quote'),
    ]);
    const richDest = await createPage('富文本粘贴目标');
    await paste(richDest.id, await cutAll(rich.id));
    await expect.poll(async () => (await persisted(richDest.id)).length).toBe(3);
    const richBlocks = await persisted(richDest.id);
    expect(richBlocks.map(item => item.type)).toEqual(['heading', 'bulletListItem', 'quote']);
    expect(richBlocks[0].content[0].styles.bold).toBe(true);
    expect(richBlocks[1].children.map((item: any) => item.type)).toEqual(['bulletListItem']);
    expect((await counts()).blockGroups).toBe(2);
    // A blank insertion point in an existing page replaces just that blank
    // block; preceding text survives.
    const withContent = await createPage('已有内容的页面', [
      block('已有记录'), { type: 'paragraph', content: [], children: [] },
    ]);
    await paste(withContent.id, await cutAll(richDest.id), 1);
    await expect.poll(async () => (await persisted(withContent.id)).length).toBe(4);
    expect(flatText(await persisted(withContent.id))).toEqual(['已有记录', '真正的标题', '父级列表', '引用内容']);
    expect((await persisted(withContent.id))[2].children).toHaveLength(1);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(data, { recursive: true, force: true });
  }
});
