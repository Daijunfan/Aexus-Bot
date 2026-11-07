import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataService } from '../src/backend/service.ts';
import { makePage } from '../src/model.ts';

test('single-page commits touch only that space directory and preserve space cleanup', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mininotion-commit-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = new DataService(directory);
  let sequence = 0;
  const call = async (method: string, params = {}) => {
    const response = await service.request({ jsonrpc: '2.0', id: ++sequence, method, params });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result;
  };
  await call('workspace.replace', { workspace: {
    version: 1, name: 'Commit fixture', pages: Array.from({ length: 200 }, (_, i) => makePage({ id: `p${i}`, title: `Page ${i}` })), expanded: [], recent: [], activePageId: null,
    settings: { theme: 'light', sidebarWidth: 248, sidebarHidden: false, spellcheck: false },
  } });
  const mkdir = fs.mkdirSync;
  const touched: string[] = [];
  fs.mkdirSync = ((file, options) => {
    if (String(file).startsWith(service.storage.spacesDirectory + path.sep)) touched.push(String(file));
    return mkdir(file, options as any);
  }) as typeof fs.mkdirSync;
  try { await call('page.update', { pageId: 'p100', title: 'Changed' }); }
  finally { fs.mkdirSync = mkdir; }
  assert.deepEqual(touched, [service.storage.spaceRoot('p100')]);
  assert.equal(new DataService(directory).workspace!.pages.find(page => page.id === 'p100')!.title, 'Changed');
  const created = await call('page.create', { title: 'New root', color: 'white' });
  assert.ok(fs.existsSync(service.storage.spaceRoot(created.id)));
  const stopped: string[] = [];
  service.agents.stop = ((id: string) => { stopped.push(id); }) as typeof service.agents.stop;
  await call('page.trash', { pageId: created.id });
  assert.deepEqual(stopped, [created.id]);
  assert.ok(fs.existsSync(service.storage.spaceRoot(created.id)));
  await call('page.purge', { pageId: created.id, confirm: true });
  assert.equal(fs.existsSync(service.storage.spaceRoot(created.id)), false);
  assert.ok(fs.existsSync(service.storage.spaceRoot('p100')));
});
