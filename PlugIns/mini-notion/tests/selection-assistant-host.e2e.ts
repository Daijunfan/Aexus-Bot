import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);

test('hosted selection assistant discovers, sends to and reads the selected synthetic employee', async () => {
  const project = path.resolve(import.meta.dirname, '..');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mn-selection-host-')));
  fs.mkdirSync(path.join(root, '.mininotion'));
  fs.writeFileSync(path.join(root, '.mininotion/collection.json'), JSON.stringify({ format: 'mininotion.collection/v1' }));
  const pluginRoot = path.join(root, 'runtime');
  fs.mkdirSync(pluginRoot);
  fs.symlinkSync(path.join(project, 'dist-cli'), path.join(pluginRoot, 'backend'));
  fs.symlinkSync(path.join(project, 'node_modules'), path.join(pluginRoot, 'node_modules'));
  const runtimePath = path.join(pluginRoot, 'runtime.cjs');
  buildSync({ entryPoints: [path.join(project, 'src/plugin/runtime.ts')], outfile: runtimePath,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const { createPlugin } = require(runtimePath);
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  let sentText = '';
  const plugin = createPlugin({ workspace: root, pluginRoot, executable: process.execPath, requestHost: async request => {
    calls.push(request);
    if (request.cmd === 'session.status') return [{ id: 'fixture-writer', title: '隔离测试员工', engine: 'fixture', kind: 'worker', busy: false, initialization: { status: 'ready' } }];
    if (request.cmd === 'session.list') return { sessions: [{ id: 'fixture-writer', cwd: root }] };
    if (request.cmd === 'session.send') { sentText = String(request.args!.text); return { sent: true, messageId: 'fixture-message' }; }
    if (request.cmd === 'session.transcript') return { shown: [
      { role: 'user', outbound: { taskId: 'fixture-message' } },
      { role: 'assistant', blocks: [{ kind: 'text', text: '已解释隔离选区，没有修改页面。' }] },
    ] };
    if (request.cmd === 'session.info') return { busy: false };
    throw new Error(`Unexpected fixture host command: ${request.cmd}`);
  } });
  const clients = new Set<http.ServerResponse>();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, 'http://127.0.0.1');
      if (url.pathname === '/fixture/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(': connected\n\n'); clients.add(response);
        request.on('close', () => clients.delete(response));
      } else if (url.pathname === '/fixture/rpc') {
        let body = '';
        for await (const chunk of request) body += chunk;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(await plugin.request(JSON.parse(body))));
      } else {
        const relative = url.pathname === '/fixture/' ? 'index.html' : url.pathname.slice('/fixture/'.length);
        const file = path.join(project, 'dist', relative);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
        response.setHeader('content-type', mime);
        response.end(fs.readFileSync(file));
      }
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    unsubscribe = await plugin.subscribe(event => { for (const response of clients) response.write(`data: ${JSON.stringify(event)}\n\n`); });
    const call = async (method: string, params: Record<string, unknown> = {}) => {
      const response = await plugin.request({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
      expect(response.error).toBeUndefined();
      return response.result;
    };
    const note = await call('page.create', { title: '宿主选区测试', color: 'white', blocks: [
      { type: 'paragraph', content: '仅用于隔离测试的选区' },
      { type: 'paragraph', content: '保留第二段边界' },
    ] });
    await call('settings.set', { changes: { selectionAI: { prompt: '请解释选区', mode: 'edit', employeeId: '' } } });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/fixture/?hosted=1`);
    await page.locator('.sidebar').waitFor();
    expect(await page.evaluate(() => window.native!.hostAssistant)).toBe(true);
    await call('page.open', { pageId: note.id });
    await expect(page.locator('.page-title')).toHaveValue(note.title);
    await page.locator('.bn-editor .bn-inline-content').first().click();
    await page.keyboard.press('Meta+a');
    await expect(page.locator('.selection-toolbar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.selection-toolbar')).toBeHidden();
    await page.keyboard.press('Meta+k');
    const url = page.locator('input[name="url"]');
    await expect(url).toBeFocused();
    await expect(url).toHaveValue('');
    await expect(page.getByRole('textbox', { name: '搜索所有笔记' })).toBeHidden();
    await url.fill('https://example.com/canceled-host-selection');
    await url.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.selection-toolbar')).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(url).toBeFocused();
    await expect(url).toHaveValue('');
    await url.press('Escape');
    await page.getByRole('button', { name: '更多文本操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '发送选区给 Agent', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: '选区 AI 聊天', exact: true });
    await expect(assistant).toContainText('隔离测试员工');
    await expect(assistant.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('请解释选区\n\n仅用于隔离测试的选区\n\n保留第二段边界');
    await assistant.getByRole('button', { name: '发送 AI 消息', exact: true }).click();
    await expect(assistant.locator('.selection-ai-reply')).toContainText('已解释隔离选区，没有修改页面。');
    expect(sentText).toBe('请解释选区\n\n仅用于隔离测试的选区\n\n保留第二段边界');
    expect(calls.find(call => call.cmd === 'session.send')!.args).toMatchObject({ employee: 'fixture-writer', text: sentText });
    expect(calls.filter(call => call.cmd === 'session.send')).toHaveLength(1);
    expect((await call('page.get', { pageId: note.id })).blocks).toEqual(note.blocks);
    await assistant.getByRole('button', { name: '关闭选区 AI', exact: true }).click();
    await page.locator('.bn-editor .bn-inline-content').last().click();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    await page.keyboard.press('Meta+k');
    const search = page.getByRole('textbox', { name: '搜索所有笔记' });
    await expect(search).toBeFocused();
    await expect(url).toBeHidden();
    await search.press('Escape');
    await expect(search).toBeHidden();
    await page.getByRole('textbox', { name: '页面标题', exact: true }).click();
    await page.keyboard.press('Meta+k');
    await expect(search).toBeFocused();
    await expect(url).toBeHidden();
    expect((await call('page.get', { pageId: note.id })).blocks).toEqual(note.blocks);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    unsubscribe?.();
    await plugin.request({ jsonrpc: '2.0', id: 'stop', method: 'service.stop' }).catch(() => {});
    await plugin.close();
    for (const response of clients) response.end();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
