import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Changes } from '../src/backend/changes';
import { DataService } from '../src/backend/service';
import { createWorkspace } from '../src/seed';
import { makePage } from '../src/model';
import { normalizeWorkspace } from '../src/core/normalize';

const fixture = () => normalizeWorkspace({ ...createWorkspace(), name: 'Before', pages: [makePage({ title: 'Kept page', color: 'white' })] });
const request = { jsonrpc: '2.0' as const, id: 'edit', method: 'workspace.rename' };

for (const segmented of [false, true]) {
  test(`opening and navigating does not read history; failed lazy load can retry (${segmented ? 'segmented' : 'legacy'})`, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-lazy-history-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'changes.json');
    fs.writeFileSync(file, '{broken');
    const changes = new Changes(directory, segmented), before = fixture();
    assert.equal(changes.prepare(before, { ...before, activePageId: before.pages[0].id }, { ...request, method: 'page.open' }), undefined);
    assert.equal(changes.prepare(before, { ...before, name: 'External update' }, { ...request, method: 'fs.sync' }), undefined);
    assert.equal(fs.existsSync(path.join(directory, 'changes-index.json')), false);
    assert.throws(() => changes.prepare(before, { ...before, name: 'Edited' }, request), SyntaxError);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
    fs.writeFileSync(file, '[]');
    assert.deepEqual(changes.export(), []);
  });
}

test('deferred history retains old undo entries, publishes only after commit, and supports redo after restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const before = fixture(), first = { ...before, name: 'First' }, second = { ...first, name: 'Second' };
  new Changes(directory).record(before, first, request);
  const original = fs.readFileSync(path.join(directory, 'changes.json'), 'utf8');
  const changes = new Changes(directory, true);
  const publish = changes.prepare(first, second, request);
  assert.equal(changes.list().length, 1, 'preparing an edit must not append it');
  assert.equal(changes.apply(first, false, {}).workspace.name, 'Before');
  publish!();
  assert.equal(changes.list().length, 2);
  const undo = new Changes(directory, true).apply(second, false, {});
  assert.equal(undo.workspace.name, 'First');
  undo.committed();
  const redo = new Changes(directory, true).apply(undo.workspace, true, {});
  assert.equal(redo.workspace.name, 'Second');
  redo.committed();
  assert.equal(new Changes(directory, true).list().length, 2);
  assert.equal(fs.readFileSync(path.join(directory, 'changes.json'), 'utf8'), original);
});

test('a corrupt deferred journal blocks an edit before workspace publication and remains repairable', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-durable-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(fixture()));
  const history = path.join(directory, 'changes.json');
  fs.writeFileSync(history, '{broken');
  const service = new DataService(directory), pageId = service.workspace!.pages[0].id;
  const before = service.workspace, disk = fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8');
  const edit = { ...request, method: 'page.update', params: { pageId, title: 'After repair' } };
  const failed = await service.request(edit);
  assert.ok(failed.error);
  assert.equal(service.workspace, before);
  assert.equal(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8'), disk);
  assert.equal(fs.readFileSync(history, 'utf8'), '{broken');
  fs.writeFileSync(history, '[]');
  const saved = await service.request(edit);
  assert.equal(saved.error, undefined);
  assert.equal(new DataService(directory).workspace!.pages[0].title, 'After repair');
  assert.equal(service.changes.list().length, 1);
});

test('segmented history still verifies object hashes before preparing an edit', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-hash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const before = fixture(), first = { ...before, name: 'First' };
  new Changes(directory, true).record(before, first, request);
  const index = JSON.parse(fs.readFileSync(path.join(directory, 'changes-index.json'), 'utf8'));
  const object = path.join(directory, 'cache/changes', index.entries[0].hash + '.json');
  const original = fs.readFileSync(object, 'utf8');
  fs.writeFileSync(object, original + ' ');
  const changes = new Changes(directory, true);
  assert.throws(() => changes.prepare(first, { ...first, name: 'Second' }, request), /校验失败/);
  fs.writeFileSync(object, original);
  const publish = changes.prepare(first, { ...first, name: 'Second' }, request);
  assert.equal(changes.list().length, 1);
  publish!();
  assert.equal(changes.list().length, 2);
});

test('prepared history includes raw file paths relocated by the publishing transaction', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-relocate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const changes = new Changes(directory, true);
  const before = fixture();
  before.pages.push(makePage({ id: 'raw-file', title: 'notes.txt', sourceFile: { path: 'Before/notes.txt', kind: 'text', hash: 'same-bytes' } }));
  const after = { ...before, name: 'Renamed' };
  const publish = changes.prepare(before, after, request);
  after.pages = after.pages.map(page => page.id === 'raw-file' ? { ...page, sourceFile: { ...page.sourceFile!, path: 'After/notes.txt' } } : page);
  publish!();
  assert.deepEqual(changes.list('raw-file')[0].pageIds, ['raw-file']);
  const undo = changes.apply(after, false, {});
  assert.equal(undo.workspace.pages.find(page => page.id === 'raw-file')!.sourceFile!.path, 'Before/notes.txt');
});

test('organizing preflights history even when file relocation is its only eventual change', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-organize-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'changes.json'), '{broken');
  const changes = new Changes(directory), before = fixture();
  assert.throws(() => changes.prepare(before, { ...before }, { ...request, method: 'fs.organize' }), SyntaxError);
  fs.writeFileSync(path.join(directory, 'changes.json'), '[]');
  changes.prepare(before, { ...before }, { ...request, method: 'fs.organize' })!();
  assert.equal(changes.list().length, 0, 'a no-op organization must not create empty undo history');
});

test('valid JSON with an invalid legacy history shape blocks publication and supports repair', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-shape-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify(fixture()));
  const history = path.join(directory, 'changes.json');
  fs.writeFileSync(history, '{}');
  const service = new DataService(directory), before = service.workspace;
  const disk = fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8');
  const edit = { ...request, method: 'page.update', params: { pageId: before!.pages[0].id, title: 'Repaired' } };
  assert.equal((await service.request(edit)).error?.code, 'INVALID_HISTORY');
  assert.equal(service.workspace, before);
  assert.equal(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8'), disk);
  assert.equal(fs.readFileSync(history, 'utf8'), '{}');
  fs.writeFileSync(history, '[]');
  assert.equal((await service.request(edit)).error, undefined);
});

test('malformed legacy entries cannot be migrated into the segmented journal', t => {
  for (const invalid of [[null], [{ id: 'bad', at: 1, method: 'workspace.patch', patch: { id: 'bad', pages: null } }]]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-history-migration-shape-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const original = JSON.stringify(invalid), file = path.join(directory, 'changes.json');
    fs.writeFileSync(file, original);
    const changes = new Changes(directory, true), before = fixture();
    assert.throws(() => changes.prepare(before, { ...before, name: 'Changed' }, request), /操作历史格式无效/);
    assert.equal(fs.existsSync(path.join(directory, 'changes-index.json')), false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    fs.writeFileSync(file, '[]');
    changes.prepare(before, { ...before, name: 'Changed' }, request)!();
    assert.equal(changes.list().length, 1);
  }
});
