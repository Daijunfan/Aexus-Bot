// Profile an APFS-cloned folder workspace only. Never open the live notebook.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';

const root = process.env.MINI_NOTION_PROFILE_WORKSPACE;
if (!root || !fs.existsSync(path.join(root, '.mininotion', 'collection.json'))
    || fs.realpathSync(root) === fs.realpathSync(path.join(process.env.HOME, 'Library/Application Support/Toolbox/MiniNotion/Workspace')))
  throw new Error('MINI_NOTION_PROFILE_WORKSPACE must be an independent workspace clone.');
const appDir = path.resolve(import.meta.dirname, '..');
const executablePath = process.env.MINI_NOTION_PROFILE_EXECUTABLE || electronBinary;
const samples = Math.max(1, Number(process.env.MINI_NOTION_PROFILE_SAMPLES || 3));
const manifestFile = path.join(root, '.mininotion', 'workspace-manifest.json');
const expectedPageId = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).workspace.activePageId : undefined;
const results = [];
for (let i = 0; i < samples; i++) {
  const traceFile = path.join(root, '.mininotion', 'desktop', 'startup-main.jsonl');
  fs.rmSync(traceFile, { force: true });
  const t0 = performance.now(), launchAt = Date.now(), errors = [];
  let app;
  try {
    const env = { ...process.env, MINI_NOTION_STARTUP_PROFILE: '1', MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
      MINI_NOTION_WORKSPACE: root, MINI_NOTION_DATA_DIR: path.join(root, '.mininotion', 'desktop') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, args: process.env.MINI_NOTION_PROFILE_EXECUTABLE ? [] : ['.'],
      cwd: appDir, env, timeout: 120000 });
    const appReadyMs = Math.round(performance.now() - t0);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(String(error)));
    const firstWindowMs = Math.round(performance.now() - t0);
    await page.evaluate(() => {
      const selector = '.note-editor .bn-editor[contenteditable="true"], .note-editor .bn-editor [contenteditable="true"]';
      const readiness = window.__miniStartupReadiness = { installedAt: Date.now(), sidebarAt: null, editorAt: null, editorPaintAt: null, editorAlreadyPresent: !!document.querySelector(selector) };
      const inspect = () => {
        if (!readiness.sidebarAt && document.querySelector('.sidebar-page')) readiness.sidebarAt = Date.now();
        const editable = document.querySelector(selector);
        if (!readiness.editorAt && editable?.isContentEditable && editable.getBoundingClientRect().height) {
          readiness.editorAt = Date.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { readiness.editorPaintAt = Date.now(); observer.disconnect(); }));
        }
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
      inspect();
    });
    await page.locator('.sidebar').waitFor({ timeout: 120000 });
    const sidebarMs = Math.round(performance.now() - t0);
    await page.locator('.sidebar-page').first().waitFor({ timeout: 120000 });
    const sidebarPagesMs = Math.round(performance.now() - t0);
    // A virtual sidebar can mount before a deferred editor has even loaded.
    // Compare the same saved document and wait for its editable, focused body.
    const editable = page.locator('.note-editor .bn-editor[contenteditable="true"], .note-editor .bn-editor [contenteditable="true"]').first();
    await page.waitForFunction(() => window.__miniStartupReadiness?.editorPaintAt, undefined, { timeout: 120000, polling: 'raf' });
    if (expectedPageId && await page.locator('.note-editor').first().getAttribute('data-editor-page') !== expectedPageId)
      throw Error('Startup selected a different document; do not compare these samples.');
    await editable.focus();
    const inputReady = await editable.evaluate(element => element.isContentEditable && (document.activeElement === element || element.contains(document.activeElement)));
    if (!inputReady) throw Error('The document body did not accept keyboard focus.');
    // Exercise keyboard handling without modifying the cloned document bytes.
    await editable.press('ArrowRight');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const editorReadyMs = Math.round(performance.now() - t0);
    const state = await page.evaluate(() => ({
      startupHint: window.native?.startupContent || null,
      observed: window.__miniStartupReadiness,
      contentResources: performance.getEntriesByType('resource').filter(entry => /\/(?:Editor|PageView)[^/]*\.js(?:\?|$)/.test(entry.name)).map(entry => ({ file: entry.name.split('/').at(-1), startMs: Math.round(entry.startTime), responseMs: Math.round(entry.responseEnd), durationMs: Math.round(entry.duration) })),
      blocks: document.querySelectorAll('.bn-block').length,
      pages: document.querySelectorAll('.sidebar-page').length,
      domNodes: document.getElementsByTagName('*').length,
      marks: performance.getEntriesByType('mark').map(e => ({ name: e.name, ms: Math.round(e.startTime) })),
      nav: performance.getEntriesByType('navigation').map(e => ({
        domContentLoadedMs: Math.round(e.domContentLoadedEventEnd - e.startTime),
        loadMs: Math.round(e.loadEventEnd - e.startTime),
      })),
    }));
    state.observed = Object.fromEntries(Object.entries(state.observed).map(([key, value]) => [key.endsWith('At') && value ? key.replace(/At$/, 'Ms') : key, typeof value === 'number' ? value - launchAt : value]));
    const main = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    results.push({ run: i + 1, appReadyMs, firstWindowMs, sidebarMs, sidebarPagesMs, editorReadyMs, inputReady, ...state, main, errors });
  } finally {
    await app?.close().catch(() => {});
  }
}
console.log(JSON.stringify({ workspaceType: 'isolated APFS clone', results }, null, 2));
if (results.some(result => result.errors.length)) process.exitCode = 1;
