// Measure backend initialization and folder scanning in a cloned workspace.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const folder = process.env.MINI_NOTION_PROFILE_WORKSPACE;
if (!folder || !fs.existsSync(path.join(folder, '.mininotion', 'collection.json'))
  || fs.realpathSync(folder) === fs.realpathSync(path.join(process.env.HOME, 'Library/Application Support/Toolbox/MiniNotion/Workspace')))
  throw Error('Only an isolated workspace clone is allowed.');
const project = path.resolve(import.meta.dirname, '..');
const bundle = path.join(project, 'node_modules/.cache', 'mini-notion-startup-service.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
buildSync({ entryPoints: [path.join(project, 'src/backend/service.ts')],
  outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
const { DataService } = createRequire(import.meta.url)(bundle);
const root = fs.realpathSync(folder), directory = path.join(root, '.mininotion');
const results = [];
for (let i = 0; i < 3; i++) {
  const start = performance.now(), service = new DataService(directory, root);
  const constructorMs = Math.round(performance.now() - start);
  const scanStart = performance.now();
  const changed = service.folder.scan(service.workspace);
  const scanMs = Math.round(performance.now() - scanStart);
  results.push({constructorMs, scanMs, changed: !!changed, pages: service.workspace?.pages.length});
}
console.log(JSON.stringify({runs:results},null,2));
