import { test, expect, _electron as electron, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage } from '../src/model';
import { createWorkspace } from '../src/seed';

async function screenshot(page: Page, info: TestInfo, name: string) {
  const directory = process.env.MINI_NOTION_UI_ARTIFACTS;
  if (directory) fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: directory ? path.join(directory, name) : info.outputPath(name) });
}

const image = { name: 'cover.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="#76917c"/><circle cx="800" cy="400" r="200" fill="#eddfc6"/></svg>') };

test('deferred surfaces preserve navigation, bounded home, original covers and keyboard crop', async ({}, info) => {
  test.setTimeout(120000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-media-startup-'));
  const ws = createWorkspace();
  ws.pages = Array.from({ length: 700 }, (_, index) => makePage({ id: `media-${index}`, title: `Media page ${index}`, icon: index === 0 ? 'icon:BookOpen:blue' : '', blocks: [{ type: 'paragraph', content: 'Write something useful.' }] }));
  ws.activePageId = null; ws.spaces = {}; ws.recent = []; ws.expanded = [];
  fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify(ws));
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_DATA_DIR: data };
  delete env.MINI_NOTION_WORKSPACE; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.MINI_NOTION_EXECUTABLE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const errors: string[] = [];
  try {
    app = await electron.launch({ executablePath: executable, args: executable ? [] : ['.'], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.home-page-list > button')).toHaveCount(60);
    await screenshot(page, info, 'home-light.png');
    await page.getByRole('button', { name: /显示更多页面/ }).click();
    await expect(page.locator('.home-page-list > button')).toHaveCount(120);
    await page.locator('.sidebar-page[data-page-id="media-0"]').click();
    await expect(page.locator('.page-title')).toHaveValue('Media page 0');
    await expect(page.locator('.bn-editor')).toBeVisible();
    await page.locator('.note-editor').evaluate(element => { element.dataset.editorSession = 'retained'; });
    await expect(page.locator('.page-large-icon .page-symbol')).toBeVisible();
    await page.getByRole('button', { name: '添加封面', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '选择封面' });
    await picker.getByRole('tab', { name: '上传', exact: true }).click();
    await picker.locator('input[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.getByRole('alert').filter({ hasText: '无法读取图片' })).toBeVisible();
    await expect(page.locator('.toast-error .lucide-circle-alert')).toBeVisible();
    await expect(picker).toBeVisible();
    await picker.locator('input[type=file]').setInputFiles(image);
    await expect(picker).toBeHidden();
    await expect(page.locator('.page-cover .cover-media img')).toBeVisible();
    await expect.poll(() => page.locator('.page-cover .cover-media img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1600);
    await page.locator('.page-cover').hover();
    await page.getByRole('button', { name: '调整位置', exact: true }).click();
    const slider = page.getByRole('slider', { name: '封面垂直位置' });
    await slider.focus(); await slider.press('ArrowDown');
    await expect(slider).toHaveAttribute('aria-valuenow', '52');
    await slider.press('Enter');
    await expect(page.locator('.save-status')).toContainText('已保存');
    const persisted = await page.evaluate(async () => (await window.native!.api('page.get', { pageId: 'media-0' })).result);
    expect(persisted.coverPosition).toBe(52);
    await expect(page.locator('.note-editor')).toHaveAttribute('data-editor-session', 'retained');
    expect(persisted.cover).toMatch(/^asset:\/\/local\//);
    expect(fs.readFileSync(path.join(data, 'attachments', decodeURIComponent(new URL(persisted.cover).pathname.slice(1))))).toEqual(image.buffer);
    // Mount the already-prefetched branch, then keep its editor across a store update.
    await page.locator('.sidebar-page[data-page-id="media-1"]').click();
    await expect(page.locator('.note-editor')).toHaveAttribute('data-editor-page', 'media-1');
    await page.locator('.sidebar-page[data-page-id="media-0"]').click();
    await expect(page.locator('.note-editor')).toHaveAttribute('data-editor-page', 'media-0');
    await page.locator('.note-editor').evaluate(element => { element.dataset.editorSession = 'cached-retained'; });
    await page.locator('.page-title').fill('Media page 0 updated');
    await expect(page.locator('.note-editor')).toHaveAttribute('data-editor-session', 'cached-retained');
    await screenshot(page, info, 'media-workspace.png');
    await page.evaluate(() => window.native!.api('settings.set', { changes: { theme: 'dark' } }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await screenshot(page, info, 'media-workspace-dark.png');
    expect(errors).toEqual([]);
  } finally { await app?.close().catch(() => {}); fs.rmSync(data, { recursive: true, force: true }); }
});

test('folder files keep recoverable drafts, bounded CSV rows and image zoom', async ({}, info) => {
  test.setTimeout(120000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mn-file-media-')));
  fs.mkdirSync(path.join(root, '.mininotion'));
  fs.writeFileSync(path.join(root, '.mininotion/collection.json'), JSON.stringify({ format: 'mininotion.collection/v1' }));
  fs.mkdirSync(path.join(root, 'Files'));
  fs.writeFileSync(path.join(root, 'Files/index.mininotion.json'), JSON.stringify({ format: 'mininotion.page/v1', page: makePage({ id: 'file-home', title: 'Files' }) }));
  fs.writeFileSync(path.join(root, 'Files/notes.txt'), 'Original text');
  fs.writeFileSync(path.join(root, 'Files/data.csv'), 'name,value\n' + Array.from({ length: 5000 }, (_, i) => `Row ${i},${i}`).join('\n'));
  fs.writeFileSync(path.join(root, 'Files/photo.svg'), image.buffer);
  const env = { ...process.env, MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1', MINI_NOTION_WORKSPACE: root, MINI_NOTION_DATA_DIR: path.join(root, '.mininotion/desktop') };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.MINI_NOTION_EXECUTABLE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const errors: string[] = [];
  try {
    app = await electron.launch({ executablePath: executable, args: executable ? [] : ['.'], env, timeout: 60000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    const open = async (name: string) => {
      await page.locator('.sidebar-page[data-page-id="file-home"]').click();
      await page.locator('.page-workspace-files').getByRole('button', { name, exact: true }).click();
    };
    await open('notes.txt');
    await page.getByRole('button', { name: '编辑文件', exact: true }).click();
    await page.getByRole('textbox', { name: '文件内容' }).fill('Recoverable draft');
    await expect.poll(() => page.evaluate(async () => (await window.native!.api('fs.draft-read', { key: 'Files/notes.txt' })).result?.content)).toBe('Recoverable draft');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await expect(page.locator('.folder-plain')).toHaveText('Original text');
    await page.getByRole('button', { name: '编辑文件', exact: true }).click();
    await page.getByRole('textbox', { name: '文件内容' }).fill('Saved without losing original conflict checks');
    await page.getByRole('button', { name: '保存文件', exact: true }).click();
    await expect(page.locator('.folder-plain')).toHaveText('Saved without losing original conflict checks');
    expect(fs.readFileSync(path.join(root, 'Files/notes.txt'), 'utf8')).toBe('Saved without losing original conflict checks');
    await open('data.csv');
    await expect(page.locator('.folder-csv tbody tr')).toHaveCount(201);
    await page.getByRole('button', { name: /显示更多行/ }).click();
    await expect(page.locator('.folder-csv tbody tr')).toHaveCount(401);
    await open('photo.svg');
    await expect(page.locator('.file-image-toolbar')).toContainText('1,600 × 800');
    await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await expect(page.getByRole('button', { name: '原始尺寸', exact: true })).toHaveText('125%');
    await page.getByRole('button', { name: '适应窗口', exact: true }).click();
    await expect(page.locator('.file-image-canvas')).toHaveClass(/fit/);
    await screenshot(page, info, 'file-image-viewer.png');
    await page.evaluate(() => window.native!.api('settings.set', { changes: { theme: 'dark' } }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await screenshot(page, info, 'file-image-viewer-dark.png');
    expect(errors).toEqual([]);
  } finally { await app?.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); }
});
