'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { setup } = require('./fixtures.cjs');

async function fixture(t, snapshotInTrash = false) {
  const f = await setup(t), get = setId => f.api('study.get', { setId });
  const change = async (setId, method, params = {}) => f.api(method, { setId, expectedRevision: (await get(setId)).revision, ...params });
  let a = await f.api('study.create', { title: 'Original owner' }), b = await f.api('study.create', { title: 'Recoverable owner' });
  a = await change(a.id, 'study.note.create', { title: 'Stable identity', text: 'Retain this source once' });
  const cardId = a.cards[0].id;
  if (snapshotInTrash) a = await change(a.id, 'study.card.remove', { cardId });
  a = await change(a.id, 'study.versions.create', { title: snapshotInTrash ? 'Retained in card trash' : 'Before move' });
  const versionId = a.lastVersionId;
  if (snapshotInTrash) a = await change(a.id, 'study.card.restore', { trashId: a.cardTrash[0].id });
  const { clipboard } = await f.api('study.clipboard.set', { setId: a.id, expectedRevision: a.revision, cardIds: [cardId], mode: 'cut' });
  await f.api('study.clipboard.paste', { setId: b.id, expectedRevision: b.revision, clipboardId: clipboard.id });
  const reject = async () => {
    const file = path.join(f.workspace, '.margin-reader/state.json'), before = await fs.readFile(file);
    await f.error('study.versions.restore', { setId: a.id, expectedRevision: (await get(a.id)).revision, versionId }, 'CONFLICT');
    assert.deepEqual(await fs.readFile(file), before);
  };
  return { ...f, a, b, cardId, versionId, get, change, reject };
}

test('a version cannot duplicate a card owned by a study in recoverable trash', async t => {
  const f = await fixture(t), removed = await f.change(f.b.id, 'study.remove');
  await f.reject();
  let b = await f.api('study.restore', { setId: f.b.id, expectedRevision: removed.revision });
  assert.equal(b.cards[0].id, f.cardId); assert.equal((await f.get(f.a.id)).cards.length, 0);
  await f.change(b.id, 'study.undo');
  const a = await f.change(f.a.id, 'study.versions.restore', { versionId: f.versionId });
  assert.deepEqual(a.cards.map(c => c.id), [f.cardId]); assert.equal((await f.get(b.id)).cards.length, 0);
});

test('a version cannot duplicate a moved card retained in another study card trash', async t => {
  const f = await fixture(t);
  const b = await f.change(f.b.id, 'study.card.remove', { cardId: f.cardId });
  assert.equal(b.cards.length, 0); assert.equal(b.cardTrash.length, 1);
  await f.reject();
  await f.change(b.id, 'study.undo'); await f.change(b.id, 'study.undo');
  const a = await f.change(f.a.id, 'study.versions.restore', { versionId: f.versionId });
  assert.equal(a.cards[0].id, f.cardId); assert.equal((await f.get(b.id)).cards.length, 0);
});

test('historical card trash is checked for ownership too, then remains recoverable after the linked move is undone', async t => {
  const f = await fixture(t, true);
  await f.reject();
  await f.change(f.b.id, 'study.undo');
  let a = await f.change(f.a.id, 'study.versions.restore', { versionId: f.versionId });
  assert.equal(a.cards.length, 0); assert.equal(a.cardTrash.length, 1);
  a = await f.change(a.id, 'study.card.restore', { trashId: a.cardTrash[0].id });
  assert.equal(a.cards[0].id, f.cardId); assert.equal((await f.get(f.b.id)).cards.length, 0);
});

test('restoring an earlier empty version keeps proven external relocation addresses and rejects an unavailable owner', async t => {
  const f = await setup(t), get = setId => f.api('study.get', { setId });
  const change = async (setId, method, params = {}) => f.api(method, { setId, expectedRevision: (await get(setId)).revision, ...params });
  let a = await f.api('study.create', { title: 'Origin' }), b = await f.api('study.create', { title: 'External owner' });
  a = await change(a.id, 'study.versions.create', { title: 'Before the card existed' });
  const versionId = a.lastVersionId;
  a = await change(a.id, 'study.note.create', { title: 'Later relocated card' });
  const cardId = a.cards[0].id, uri = (await f.api('link.create', { kind: 'card', setId: a.id, id: cardId })).uri;
  const { clipboard } = await f.api('study.clipboard.set', { setId: a.id, expectedRevision: a.revision, cardIds: [cardId], mode: 'cut' });
  await f.api('study.clipboard.paste', { setId: b.id, expectedRevision: b.revision, clipboardId: clipboard.id });
  b = await change(b.id, 'study.remove');
  const file = path.join(f.workspace, '.margin-reader/state.json'), before = await fs.readFile(file);
  await f.error('study.versions.restore', { setId: a.id, expectedRevision: (await get(a.id)).revision, versionId }, 'CONFLICT');
  assert.deepEqual(await fs.readFile(file), before);
  b = await f.api('study.restore', { setId: b.id, expectedRevision: b.revision });
  a = await change(a.id, 'study.versions.restore', { versionId });
  assert.equal(a.cards.length, 0); assert.equal((await get(b.id)).cards[0].id, cardId);
  assert.equal((await f.api('link.resolve', { uri })).setId, b.id);
  await change(a.id, 'study.undo'); assert.equal((await f.api('link.resolve', { uri })).setId, b.id);
  await change(a.id, 'study.redo'); assert.equal((await f.api('link.resolve', { uri })).setId, b.id);
});
