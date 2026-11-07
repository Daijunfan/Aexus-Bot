'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), JSZip = require('jszip');
const { setup } = require('./fixtures.cjs');

async function fixture(t) {
  const f = await setup(t);
  let set = await f.api('study.create', { title: '自由布局与外观' });
  const change = async (method, params) => set = await f.api(method, { setId: set.id, expectedRevision: set.revision, ...params });
  await change('study.note.create', { title: '负坐标卡片', text: '原始正文', x: -4200, y: -3100 });
  const cardId = set.cards[0].id;
  await change('study.appearance.set', { background: '#112233', paper: 'dots', inkBehind: false, cardStyle: { background: '#eeddcc', fontSize: 20, bold: true } });
  await change('study.card.position', { cardId, x: -1000000000, y: 1000000000 });
  await change('study.card.update', { cardId, note: '布局和外观都必须可往返' });
  await f.api('study.package.export', { setId: set.id, expectedRevision: set.revision, path: 'layout.mrpkg' });
  return { ...f, set, cardId };
}

test('complete study packages roundtrip signed world coordinates and both map and card appearance, including undo history', async t => {
  const f = await fixture(t), stateFile = path.join(f.workspace, '.margin-reader/state.json');
  const before = await fs.readFile(stateFile);
  await f.api('study.package.inspect', { path: 'layout.mrpkg' });
  assert.deepEqual(await fs.readFile(stateFile), before);
  const result = await f.api('study.package.import', { path: 'layout.mrpkg', folder: 'Recovered', activate: false });
  let copy = await f.api('study.get', { setId: result.setId });
  assert.notEqual(copy.cards[0].id, f.cardId);
  assert.deepEqual(copy.cards[0].position, { x: -1000000000, y: 1000000000 });
  assert.deepEqual(copy.appearance, f.set.appearance);
  copy = await f.api('study.undo', { setId: copy.id, expectedRevision: copy.revision });
  copy = await f.api('study.undo', { setId: copy.id, expectedRevision: copy.revision });
  assert.deepEqual(copy.cards[0].position, { x: -4200, y: -3100 });
  assert.deepEqual(copy.appearance, f.set.appearance);
});

test('package parity keeps validation bounded and rejects malformed coordinates and appearance before writing a destination', async t => {
  const f = await fixture(t), bytes = await fs.readFile(path.join(f.workspace, 'layout.mrpkg'));
  const changes = [
    set => set.cards[0].position.x = -1000000001,
    set => set.cards[0].position.y = 1000000001,
    set => set.cards[0].position.x = '12',
    set => set.cards[0].position.y = null,
    set => set.appearance.mapBackground = 'url(javascript:bad)',
    set => set.appearance.inkBehind = 'false',
    set => set.appearance.paper = ''
  ];
  for (const [index, change] of changes.entries()) {
    const zip = await JSZip.loadAsync(bytes), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    change(manifest.sets[0]); zip.file('manifest.json', JSON.stringify(manifest));
    const filename = `invalid-${index}.mrpkg`, folder = `Rejected-${index}`;
    await fs.writeFile(path.join(f.workspace, filename), await zip.generateAsync({ type: 'nodebuffer' }));
    const before = await fs.readFile(path.join(f.workspace, '.margin-reader/state.json'));
    await f.error('study.package.import', { path: filename, folder }, 'INVALID_PACKAGE');
    assert.equal(await fs.stat(path.join(f.workspace, folder)).catch(() => null), null);
    assert.deepEqual(await fs.readFile(path.join(f.workspace, '.margin-reader/state.json')), before);
  }
});

test('references and bookmarks made after a move still resolve after linked undo, redo and a complete package roundtrip', async t => {
  const f = await setup(t), get = setId => f.api('study.get', { setId });
  const change = async (setId, method, params = {}) => f.api(method, { setId, expectedRevision: (await get(setId)).revision, ...params });
  let a = await f.api('study.create', { title: 'Source' }), b = await f.api('study.create', { title: 'Destination' });
  const d = await f.api('study.create', { title: 'Later references' });
  a = await change(a.id, 'study.note.create', { title: 'Stable identity', text: 'Live body' });
  const cardId = a.cards[0].id, oldUri = (await f.api('link.create', { kind: 'card', setId: a.id, id: cardId })).uri;
  const { clipboard } = await f.api('study.clipboard.set', { setId: a.id, expectedRevision: a.revision, cardIds: [cardId], mode: 'cut' });
  await f.api('study.clipboard.paste', { setId: b.id, expectedRevision: b.revision, clipboardId: clipboard.id });
  const newUri = (await f.api('link.create', { kind: 'card', setId: b.id, id: cardId })).uri;
  await change(d.id, 'study.card.reference', { targetSetId: b.id, targetCardId: cardId });
  const beforeUndo = (await get(b.id)).revision;
  b = await change(b.id, 'study.undo'); assert(b.revision > beforeUndo);
  for (const uri of [oldUri, newUri]) assert.equal((await f.api('link.resolve', { uri })).setId, a.id);
  let mirror = (await get(d.id)).cards[0]; assert.equal(mirror.referenceStatus, 'live'); assert.equal(mirror.text, 'Live body');
  await change(a.id, 'study.redo');
  for (const uri of [oldUri, newUri]) assert.equal((await f.api('link.resolve', { uri })).setId, b.id);
  await change(b.id, 'study.undo');
  await f.api('study.package.export', { setId: d.id, path: 'references.mrpkg' });
  const restored = await f.api('study.package.import', { path: 'references.mrpkg', folder: 'Imported references', activate: false });
  mirror = (await get(restored.setId)).cards[0]; assert.equal(mirror.referenceStatus, 'live'); assert.equal(mirror.text, 'Live body');
  assert.notEqual(mirror.referenceTarget.cardId, cardId);
});
