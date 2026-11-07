// Diagnostic only: a caller-supplied disposable clone, never the live notebook.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const folder = process.env.MINI_NOTION_PROFILE_WORKSPACE;
const live = path.join(os.homedir(), 'Library/Application Support/Toolbox/MiniNotion/Workspace');
if (!folder || !fs.existsSync(path.join(folder, '.mininotion/collection.json')) ||
    (fs.existsSync(live) && fs.realpathSync(folder) === fs.realpathSync(live))) throw Error('Pass a disposable workspace clone.');
const project = path.resolve(import.meta.dirname, '..');
const cache = path.join(project, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const temporary = fs.mkdtempSync(path.join(cache, 'mn-startup-breakdown-'));
const bundle = path.join(temporary, 'profile.cjs');
buildSync({ stdin: { contents: "export {DataService} from './src/backend/service'; export {FolderStorage} from './src/backend/folderStorage';", resolveDir: project }, outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent', nodePaths: [path.join(project, 'node_modules')] });
const { DataService, FolderStorage } = createRequire(import.meta.url)(bundle);
const methods = ['readFileSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'mkdirSync', 'writeFileSync', 'fsyncSync'];
const originals = new Map(methods.map(name => [name, fs[name]]));
const parse = JSON.parse, stringify = JSON.stringify, load = FolderStorage.prototype.load;
let counters, storageLoadMs;
const timed = (key, fn) => (...args) => {
  const start = performance.now();
  try { return fn(...args); }
  finally { const item = counters[key] ||= { calls: 0, ms: 0 }; item.calls++; item.ms += performance.now() - start; }
};
const results = [];
try {
  for (const [name, fn] of originals) fs[name] = timed(name, fn);
  JSON.parse = timed('JSON.parse', parse); JSON.stringify = timed('JSON.stringify', stringify);
  FolderStorage.prototype.load = function(...args) { const start = performance.now(); try { return load.apply(this, args); } finally { storageLoadMs += performance.now() - start; } };
  for (let run = 0; run < 3; run++) {
    counters = {}; storageLoadMs = 0;
    const start = performance.now();
    const service = new DataService(path.join(fs.realpathSync(folder), '.mininotion'), fs.realpathSync(folder));
    const constructorMs = performance.now() - start;
    const constructorCalls = counters; counters = {};
    const scanStart = performance.now();
    const changed = service.folder.scan(service.workspace);
    const scanMs = performance.now() - scanStart;
    const rounded = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { calls: item.calls, ms: Math.round(item.ms) }]));
    results.push({ run: run + 1, pages: service.workspace?.pages.length, constructorMs: Math.round(constructorMs), storageLoadMs: Math.round(storageLoadMs), constructorCalls: rounded(constructorCalls), scanMs: Math.round(scanMs), scanChanged: !!changed, scanCalls: rounded(counters) });
  }
} finally {
  for (const [name, fn] of originals) fs[name] = fn;
  JSON.parse = parse; JSON.stringify = stringify; FolderStorage.prototype.load = load;
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ note: 'timed sections overlap; no document contents or names are reported', results }, null, 2));
