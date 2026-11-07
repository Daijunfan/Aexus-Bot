import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, 'mininotion-projections-benchmark-'));
try {
  const bundle = path.join(directory, 'commands.cjs');
  await build({ entryPoints: [path.join(root, 'src/core/commands.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
  const { executeWorkspaceCommand } = createRequire(import.meta.url)(bundle);
  const page = (i, parentId) => ({ id: `p${i}`, parentId, title: `Page ${i}`, icon: '', trashedAt: null, values: {}, blocks: [{ type: 'paragraph', content: 'Synthetic note' }] });
  const workspace = pages => ({ version: 1, name: 'Projection benchmark', pages, expanded: [], recent: [], activePageId: null, settings: {} });
  const wide = workspace(Array.from({ length: 10000 }, (_, i) => page(i, i ? 'p0' : null)));
  const deep = workspace(Array.from({ length: 1500 }, (_, i) => page(i, i ? `p${i - 1}` : null)));
  const results = {};
  for (const [name, state, method, params] of [
    ['list_deep_1500', deep, 'page.list', {}],
    ['tree_deep_1500', deep, 'page.tree', {}],
    ['tree_wide_10000', wide, 'page.tree', {}],
    ['audit_wide_10000', wide, 'page.audit', { pageId: 'p0' }],
  ]) {
    const run = () => executeWorkspaceCommand(state, method, params);
    run();
    const samples = Array.from({ length: 5 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
    results[name] = { medianMs: Number(samples[2].toFixed(3)), minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples[4].toFixed(3)) };
  }
  process.stdout.write(JSON.stringify({ node: process.version, results }, null, 2) + '\n');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
