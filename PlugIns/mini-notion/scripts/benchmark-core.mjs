import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

// Synthetic data only: this benchmark never opens a user's workspace.
const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, 'mininotion-core-benchmark-'));
try {
  const bundle = path.join(directory, 'model.cjs');
  await build({ entryPoints: [path.join(root, 'src/model.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
  const require = createRequire(import.meta.url);
  const { makePage, descendants, ancestors, searchPages } = require(bundle);
  const { validateWorkspace } = require('../electron/storage.cjs');
  const deep = Array.from({ length: 4000 }, (_, i) => makePage({ id: `deep-${i}`, parentId: i ? `deep-${i - 1}` : null, title: `Page ${i}`, updatedAt: i }));
  const reverse = [...deep].reverse();
  const wide = Array.from({ length: 10000 }, (_, i) => makePage({ id: `wide-${i}`, title: `Page ${i}`, updatedAt: i, blocks: [{ type: 'paragraph', content: `Local notes ${i} searchable content`.repeat(20) }] }));
  const workspace = pages => ({ version: 1, name: 'Synthetic benchmark', pages, expanded: [], recent: [], activePageId: null, settings: { theme: 'light', sidebarWidth: 248, sidebarHidden: false, spellcheck: false } });
  const results = {};
  function measure(name, run) {
    run();
    const samples = Array.from({ length: 5 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
    results[name] = { medianMs: Number(samples[2].toFixed(3)), minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples[4].toFixed(3)) };
  }
  measure('descendants_reverse_4000', () => descendants(reverse, 'deep-0'));
  measure('ancestors_depth_4000', () => ancestors(deep, 'deep-3999'));
  measure('search_deep_empty_4000', () => searchPages(deep, ''));
  measure('search_wide_fulltext_10000', () => searchPages(wide, 'searchable content'));
  measure('search_wide_empty_10000', () => searchPages(wide, ''));
  measure('validate_deep_4000', () => validateWorkspace(workspace(reverse)));
  measure('validate_wide_10000', () => validateWorkspace(workspace(wide)));
  process.stdout.write(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, results }, null, 2) + '\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
