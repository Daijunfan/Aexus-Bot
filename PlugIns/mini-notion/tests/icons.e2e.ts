import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage } from '../src/model';

test('offline icon picker stays bounded and custom images survive inline use, reactions and restart', async ({}, info) => {
  test.setTimeout(120000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-icons-')));
  const metadata = path.join(root, '.mininotion');
  fs.mkdirSync(metadata);
  fs.writeFileSync(
    path.join(metadata, 'collection.json'),
    JSON.stringify({ format: 'mininotion.collection/v1' }),
  );
  fs.mkdirSync(path.join(root, 'Icons'));
  fs.writeFileSync(
    path.join(root, 'Icons/index.mininotion.json'),
    JSON.stringify({
      format: 'mininotion.page/v1',
      page: makePage({
        id: 'icons-page',
        title: 'Icons',
        icon: '📚',
        blocks: [{ type: 'paragraph', content: '' }],
      }),
    }),
  );
  const env = {
    ...process.env,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_WORKSPACE: root,
    MINI_NOTION_DATA_DIR: path.join(metadata, 'desktop'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined, page: Page;
  const errors: string[] = [],
    requests: string[] = [];
  const launch = async () => {
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'],
      env,
    });
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(request.url()))
        requests.push(request.url());
    });
    await page.locator('.sidebar-page[data-page-id="icons-page"]').click();
    await expect(page.locator('.page-title')).toHaveValue('Icons');
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await page.evaluate(({ method, params }) => window.native!.api(method, params), {
      method,
      params,
    });
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const openPicker = async () => {
    await page.getByRole('button', { name: '更换页面图标', exact: true }).click();
    return page.getByRole('dialog', { name: '选择图标' });
  };
  const saved = async (icon: string) =>
    expect.poll(async () => (await api('page.get', { pageId: 'icons-page' })).icon).toBe(icon);
  const image = {
    name: 'rocket.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#337ea9"/><path d="M32 10 44 45 32 36 20 45Z" fill="white"/></svg>',
    ),
  };
  try {
    await launch();
    let picker = await openPicker();
    await expect(picker.locator('.icon-picker-count')).toHaveText('3953 个表情');
    expect(await picker.locator('.icon-picker-grid button').count()).toBeLessThanOrEqual(135);
    await picker.getByRole('textbox', { name: '搜索图标' }).press('ArrowDown');
    await page.keyboard.press('End');
    await expect(picker.locator('[data-index="3952"]')).toBeFocused();
    expect(await picker.locator('.icon-picker-grid button').count()).toBeLessThanOrEqual(135);
    await page.keyboard.press('Home');
    await expect(picker.locator('[data-index="0"]')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(picker.locator('[data-index="72"]')).toBeFocused();
    await picker.getByRole('textbox', { name: '搜索图标' }).fill('：ＦＩＲＥ：');
    await picker.getByRole('textbox', { name: '搜索图标' }).press('Enter');
    await saved('🔥');

    picker = await openPicker();
    await picker.getByRole('tab', { name: '图标', exact: true }).click();
    await expect(picker.locator('.icon-picker-count')).toHaveText('1703 个图标');
    await picker.getByRole('textbox', { name: '搜索图标' }).fill('home');
    await expect(picker.getByRole('button', { name: 'House', exact: true })).toBeVisible();
    await picker.getByRole('textbox', { name: '搜索图标' }).fill('BookOpen');
    await picker.getByRole('button', { name: '蓝色', exact: true }).click();
    await picker.getByRole('button', { name: 'BookOpen', exact: true }).click();
    await saved('icon:BookOpen:blue');

    picker = await openPicker();
    await picker.getByRole('tab', { name: '我的表情' }).click();
    await picker.getByRole('button', { name: '上传新表情' }).click();
    await picker.getByRole('textbox', { name: '自定义表情名称' }).fill('小火箭');
    await picker.getByRole('textbox', { name: '自定义表情关键词' }).fill('launch rocket');
    await picker.locator('input[type="file"]').setInputFiles(image);
    await expect.poll(async () => (await api('settings.get')).customEmojis?.length).toBe(1);
    const custom = (await api('settings.get')).customEmojis[0];
    expect(custom.url).toMatch(/^asset:\/\/local\//);
    await saved(custom.url);
    await expect
      .poll(() =>
        page.locator('.page-large-icon img').evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(64);

    picker = await openPicker();
    await picker.getByRole('tab', { name: '我的表情' }).click();
    await picker.getByRole('textbox', { name: '搜索图标' }).fill('launch');
    await picker.getByRole('button', { name: '小火箭', exact: true }).click();
    await saved(custom.url);
    await page.locator('.bn-editor').click();
    await page.locator('.bn-editor').pressSequentially(':launch');
    await page.getByRole('option', { name: '小火箭', exact: true }).click();
    await expect(page.locator('.bn-editor img.inline-custom-emoji')).toHaveAttribute('src', custom.url);
    await expect
      .poll(async () => JSON.stringify((await api('page.get', { pageId: 'icons-page' })).blocks))
      .toContain('customEmoji');

    await page.getByRole('button', { name: '打开页面评论' }).click();
    await page.getByRole('textbox', { name: '新评论' }).fill('图片表情测试');
    await page.locator('.new-comment').getByRole('button', { name: '评论', exact: true }).click();
    await expect.poll(async () => (await api('comment.list', { pageId: 'icons-page' })).length).toBe(1);
    await page.getByRole('button', { name: '添加表情反馈' }).click();
    await page.getByRole('button', { name: '更多表情', exact: true }).click();
    picker = page.getByRole('dialog', { name: '选择图标' });
    await picker.getByRole('tab', { name: '我的表情' }).click();
    await picker.getByRole('button', { name: '小火箭', exact: true }).click();
    await expect(page.locator('.comment-reaction img')).toHaveAttribute('src', custom.url);
    await expect
      .poll(
        async () =>
          (await api('comment.list', { pageId: 'icons-page' }))[0].messages[0].reactions?.[custom.url],
      )
      .toBe(true);
    await page.getByRole('button', { name: '关闭评论' }).click();

    await page.locator('.bn-editor').click();
    await page.keyboard.press('End');
    await page.locator('.bn-editor').pressSequentially(':newupload');
    await page.getByRole('option', { name: '上传自定义表情', exact: true }).click();
    picker = page.getByRole('dialog', { name: '选择图标' });
    await picker.getByRole('textbox', { name: '自定义表情名称' }).fill('小星星');
    await picker.locator('input[type="file"]').setInputFiles({ ...image, name: 'star.svg' });
    await expect(page.locator('.bn-editor img.inline-custom-emoji')).toHaveCount(2);
    await expect.poll(async () => (await api('settings.get')).customEmojis?.length).toBe(2);
    await expect
      .poll(async () => JSON.stringify((await api('page.get', { pageId: 'icons-page' })).blocks))
      .toContain('小星星');
    await page.screenshot({ path: info.outputPath('custom-emojis.png'), animations: 'disabled' });

    await app!.close();
    app = undefined;
    await launch();
    expect((await api('settings.get')).customEmojis).toHaveLength(2);
    await expect(page.locator('.bn-editor img.inline-custom-emoji')).toHaveCount(2);
    await saved(custom.url);
    picker = await openPicker();
    await picker.getByRole('tab', { name: '我的表情' }).click();
    await picker.getByRole('button', { name: '管理表情' }).click();
    await picker.getByRole('textbox', { name: '自定义表情名称' }).fill('火箭二号');
    await picker.getByRole('button', { name: '保存', exact: true }).click();
    await picker.getByRole('button', { name: '管理表情' }).click();
    await picker.getByRole('button', { name: '从表情库移除' }).click();
    await expect.poll(async () => (await api('settings.get')).customEmojis?.length).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.bn-editor img.inline-custom-emoji')).toHaveCount(2);
    await expect
      .poll(() =>
        page.locator('.page-large-icon img').evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(64);
    await page.getByRole('button', { name: '打开页面评论' }).click();
    await expect(page.locator('.comment-reaction img')).toHaveAttribute('src', custom.url);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    console.log(
      'ICON PICKER PASS',
      JSON.stringify({
        emojis: 3953,
        icons: 1703,
        maxRenderedButtons: 135,
        customLibrary: true,
        inlineImages: 2,
        reactions: true,
        restart: true,
        networkRequests: requests.length,
      }),
    );
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
