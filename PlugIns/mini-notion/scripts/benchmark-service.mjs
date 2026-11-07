import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

// Exercise real durable commits in a temporary workspace, with no agent process.
const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const bundleDirectory = fs.mkdtempSync(path.join(cache, 'mininotion-service-benchmark-'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mininotion-service-benchmark-'));
try {
  const bundle = path.join(bundleDirectory, 'service.cjs');
  await build({ entryPoints: [path.join(root, 'src/backend/service.ts')], outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'warning' });
  const require = createRequire(import.meta.url);
  const { DataService } = require(bundle);
  const pages = Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, parentId: null, title: `Page ${i}`, icon: '', cover: null, coverPosition: 50, favorite: false, trashedAt: null, createdAt: 1, updatedAt: 1, fullWidth: false, smallText: false, font: 'default', locked: false, values: {}, blocks: [{ id: `b${i}`, type: 'paragraph', content: 'Synthetic notes '.repeat(20) }] }));
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify({ version: 1, name: 'Synthetic benchmark', pages, expanded: [], recent: [], activePageId: null, settings: { theme: 'light', sidebarWidth: 248, sidebarHidden: false, spellcheck: false } }));
  const service = new DataService(directory);
  let sequence = 0;
  const commit = async () => {
    const id = ++sequence;
    const result = await service.request({ jsonrpc: '2.0', id, method: 'page.update', params: { pageId: 'p1500', title: `Updated ${id}` }, stateMode: 'delta' });
    if (result.error) throw new Error(result.error.message);
  };
  await commit();
  let spaceMkdirCalls = 0;
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = function (file, ...args) {
    if (String(file).startsWith(service.storage.spacesDirectory + path.sep)) spaceMkdirCalls++;
    return mkdir.call(fs, file, ...args);
  };
  const samples = [];
  try {
    for (let i = 0; i < 5; i++) { const start = performance.now(); await commit(); samples.push(performance.now() - start); }
  } finally { fs.mkdirSync = mkdir; }
  samples.sort((a, b) => a - b);
  const reloaded = new DataService(directory);
  if (reloaded.workspace.pages.find(page => page.id === 'p1500').title !== `Updated ${sequence}`) throw new Error('Durable reload mismatch');
  process.stdout.write(JSON.stringify({ node: process.version, pages: pages.length, commitMedianMs: Number(samples[2].toFixed(3)), minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples[4].toFixed(3)), spaceMkdirCallsPerCommit: spaceMkdirCalls / samples.length, durableReload: true }, null, 2) + '\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(bundleDirectory, { recursive: true, force: true });
}
