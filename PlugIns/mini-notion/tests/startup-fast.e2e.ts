import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage } from '../src/model';
import { createRequire } from 'node:module';
const { BackendClient } = createRequire(import.meta.url)(path.resolve('dist-cli/client.cjs'));

test('startup shares one notebook snapshot, receives early CLI edits, and keeps folder notes durable', async () => {
  test.setTimeout(120000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mn-fast-startup-')));
  const meta = path.join(root, '.mininotion');
  fs.mkdirSync(meta);
  fs.writeFileSync(path.join(meta, 'collection.json'), JSON.stringify({ format: 'mininotion.collection/v1' }));
  const total = 240;
  for (let i = 0; i < total; i++) {
    const dir = path.join(root, 'Page-' + i);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.mininotion.json'), JSON.stringify({
      format: 'mininotion.page/v1',
      page: makePage({ id: 'speed-' + i, title: 'Speed page ' + i, color: 'white',
        blocks: [{ type: 'paragraph', content: 'Important content ' + i, children: [] }] }),
    }));
  }
  const env = { ...process.env,
    MINI_NOTION_TEST: '1', MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_WORKSPACE: root, MINI_NOTION_DATA_DIR: path.join(meta, 'desktop') };
  delete env.ELECTRON_RUN_AS_NODE;
  const installed = process.env.MINI_NOTION_EXECUTABLE;
  const cli = new BackendClient({ workspace: root, autoStart: false, clientId: 'cli-startup-race' });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: installed || undefined,
      args: installed ? [] : ['.'], env, timeout: 120000 });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // This request may race the initial full snapshot fetch and must not be
    // overwritten by stale state when React mounts.
    await expect.poll(async () => cli.ping(), { timeout: 20000 }).toBe(true);
    await cli.call('page.update', { pageId: 'speed-0', title: 'Changed during startup' });
    await page.locator('.sidebar').waitFor({ timeout: 30000 });
    await expect(page.locator('.sidebar')).toContainText('Changed during startup', { timeout: 30000 });
    const status = await cli.call('status');
    expect(status.pages).toBeGreaterThanOrEqual(total);
    expect(errors).toEqual([]);
    const again = await cli.call('page.get', { pageId: 'speed-0' });
    expect(again.title).toBe('Changed during startup');
    await app.close();
    app = undefined;
    // The native page survives the desktop process exit without data loss.
    const pages = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
    const saved = pages.flatMap(entry => {
      const file = path.join(root, entry.name, 'index.mininotion.json');
      return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf8')).page] : [];
    });
    expect(saved.find(page => page.id === 'speed-0')?.title).toBe('Changed during startup');
  } finally {
    await app?.close().catch(() => {});
    try { await cli.call('service.stop'); } catch { /* service may already be stopped */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
