// Synthetic, isolated desktop profile. Never opens a personal workspace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { buildSync } = require(root + '/node_modules/esbuild');
const { _electron: electron } = require(root + '/node_modules/@playwright/test');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-large-'));
buildSync({
  stdin: {
    contents: "export {makePage} from './src/model'; export {createWorkspace} from './src/seed';",
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: data + '/models.cjs',
  logLevel: 'silent',
});
const { makePage, createWorkspace } = require(data + '/models.cjs');
const count = Number(process.env.PROFILE_PAGES || 2000),
  blockCount = Number(process.env.PROFILE_BLOCKS || 200);
const ws = createWorkspace();
ws.pages = Array.from({ length: count }, (_, i) =>
  makePage({
    id: 'large-' + i,
    title: 'Large page ' + String(i).padStart(4, '0'),
    blocks: Array.from({ length: i === 0 ? blockCount : 5 }, (_, b) => ({
      id: 'block-' + i + '-' + b,
      type: 'paragraph',
      content: [{ type: 'text', text: 'Editable offline performance content ' + i + ' ' + b, styles: {} }],
    })),
  }),
);
ws.activePageId = ws.pages[0].id;
ws.expanded = [];
ws.recent = [];
ws.spaces = {};
fs.writeFileSync(data + '/workspace.json', JSON.stringify(ws));
(async () => {
  const t = performance.now();
  let app;
  try {
    const env = {
      ...process.env,
      MINI_NOTION_TEST: '1',
      MINI_NOTION_BACKGROUND_TEST: '1',
      MINI_NOTION_DATA_DIR: data,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MINI_NOTION_WORKSPACE;
    app = await electron.launch({
      executablePath: root + '/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      args: [root],
      cwd: root,
      env,
      timeout: 120000,
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.locator('.page-title').waitFor({ timeout: 90000 });
    await page.locator('.bn-editor').waitFor({ timeout: 30000 });
    const startupMs = Math.round(performance.now() - t);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) =>
        window.__long.push(...list.getEntries().map((e) => ({ duration: e.duration, start: e.startTime }))),
      ).observe({ entryTypes: ['longtask'] });
    });
    const timings = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await page.locator('.page-title').fill('Large page 0000 ' + i);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      timings.push(Math.round(performance.now() - start));
      await page.waitForTimeout(150);
    }
    const typingStart = performance.now();
    await page.locator('.bn-editor [contenteditable=true]').first().count();
    await page.locator('.bn-editor [data-content-type=paragraph]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Speed sample', { delay: 10 });
    const typingMs = Math.round(performance.now() - typingStart);
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => ({
      dom: document.getElementsByTagName('*').length,
      sidebar: document.querySelectorAll('.sidebar-page').length,
      longTasks: window.__long,
    }));
    console.log(
      JSON.stringify(
        { count, blockCount, startupMs, titleMs: timings, typingMs, ...result, errors },
        null,
        2,
      ),
    );
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
