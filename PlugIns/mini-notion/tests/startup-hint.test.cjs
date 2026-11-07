const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { startupContent } = require('../electron/startup.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-startup-hint-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'cache/pages'), { recursive: true });
  const manifest = { format: 'mininotion.snapshot/v2', workspace: { activePageId: null }, pages: [] };
  const publish = () => fs.writeFileSync(path.join(directory, 'workspace-manifest.json'), JSON.stringify(manifest));
  const select = page => {
    const body = JSON.stringify(page), hash = createHash('sha256').update(body).digest('hex');
    fs.writeFileSync(path.join(directory, 'cache/pages', hash + '.json'), body);
    manifest.pages = [{ id: page.id, hash }]; manifest.workspace.activePageId = page.id; publish();
  };
  return { directory, manifest, publish, select };
}
test('the loading hint selects only the saved native page, leaving Home and files editor-free', t => {
  const { directory, manifest, publish, select } = fixture(t);
  publish(); assert.equal(startupContent(directory), 'home');
  select({ id: 'note', blocks: [] }); assert.equal(startupContent(directory), 'page');
  select({ id: 'folder', sourceFile: { kind: 'directory' } }); assert.equal(startupContent(directory), 'page');
  select({ id: 'image', sourceFile: { kind: 'image' } }); assert.equal(startupContent(directory), 'file');
  select({ id: 'table', database: {} }); assert.equal(startupContent(directory), 'database');
  select({ id: 'deleted', trashedAt: 1 }); assert.equal(startupContent(directory), undefined);
  manifest.workspace.activePageId = 'missing'; publish(); assert.equal(startupContent(directory), undefined);
});
test('stale, malformed or unsafe hint caches fall back without reading the legacy notebook', t => {
  const { directory, manifest, publish } = fixture(t);
  fs.writeFileSync(path.join(directory, 'workspace.json'), '{invalid legacy must remain unread');
  assert.equal(startupContent(directory), undefined);
  manifest.workspace.activePageId = 'note'; manifest.pages = [{ id: 'note', hash: '../../workspace' }];
  publish(); assert.equal(startupContent(directory), undefined);
  manifest.pages[0].hash = 'a'.repeat(64); publish(); assert.equal(startupContent(directory), undefined);
  fs.writeFileSync(path.join(directory, 'cache/pages', 'a'.repeat(64) + '.json'), '{broken');
  assert.equal(startupContent(directory), undefined);
  fs.writeFileSync(path.join(directory, 'workspace-manifest.json'), '{broken');
  assert.equal(startupContent(directory), undefined);
});
