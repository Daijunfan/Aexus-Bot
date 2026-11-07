'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { setup } = require('./fixtures.cjs'), H = require('../lib/study-history.cjs');
const HARD = 32 * 1024 * 1024;

// Populate only the disposable fixture's state, using supported card counts
// and body lengths. Thousands of API writes would obscure this one boundary.
async function fillStudy(f, setId, targetBytes, { legacyHistory = false, automaticVersions = false } = {}) {
  const file = path.join(f.workspace, '.margin-reader/state.json'), state = JSON.parse(await fs.readFile(file));
  const set = state.studySets[setId], now = new Date().toISOString();
  const empty = H.snapshot(set);
  set.cards = Array.from({ length: 1850 }, (_, i) => ({ id: randomUUID(), title: `Card ${i}`, text: 'x'.repeat(17000), note: '', tags: [], color: 'yellow', source: null, image: null, parentId: null, collapsed: false, createdAt: now, updatedAt: now }));
  let padding = targetBytes - Buffer.byteLength(JSON.stringify(H.snapshot(set))) - Buffer.byteLength('{"undo":[],"redo":[]}');
  assert(padding >= 0);
  for (const card of set.cards) { const n = Math.min(20000 - card.text.length, padding); card.text += 'p'.repeat(n); padding -= n; }
  assert.equal(padding, 0);
  if (legacyHistory) set.history = { undo: [empty], redo: [] };
  if (automaticVersions) set.versionPolicy = { enabled: true, intervalSeconds: 1 };
  await fs.writeFile(file, JSON.stringify(state));
  return { file, revision: set.revision, cards: set.cards.length, firstId: set.cards[0].id };
}

test('an edit crossing the final history budget fails before state or automatic versions are committed', async t => {
  const f = await setup(t), set = await f.api('study.create', { title: 'Near history limit' });
  const filled = await fillStudy(f, set.id, HARD - 8192, { automaticVersions: true }), before = await fs.readFile(filled.file);
  await f.error('study.note.create', { setId: set.id, expectedRevision: filled.revision, title: 'Would strand undo', text: 'n'.repeat(20000) }, 'TOO_LARGE');
  assert.deepEqual(await fs.readFile(filled.file), before);
  assert.equal(await fs.stat(path.join(f.workspace, '.margin-reader/versions', set.id)).catch(() => null), null);
});

test('cross-study paste rolls back both journals, the clipboard and copied media when the destination would exceed the final bound', async t => {
  const f = await setup(t);
  let source = await f.api('study.create', { title: 'Source with an immutable attachment' });
  const target = await f.api('study.create', { title: 'Near-full destination' });
  const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  source = await f.api('study.media.import', { setId: source.id, expectedRevision: source.revision, kind: 'audio', mimeType: 'audio/wav', title: 'Retained audio', text: 'a'.repeat(20000), contentBase64: wav.toString('base64') });
  const cardId = source.lastMedia.cardId, mediaId = source.lastMedia.mediaId;
  const filled = await fillStudy(f, target.id, HARD - 8192);
  const { clipboard } = await f.api('study.clipboard.set', { setId: source.id, expectedRevision: source.revision, cardIds: [cardId], mode: 'cut' });
  const before = await fs.readFile(filled.file);
  await f.error('study.clipboard.paste', { setId: target.id, expectedRevision: filled.revision, clipboardId: clipboard.id }, 'TOO_LARGE');
  assert.deepEqual(await fs.readFile(filled.file), before);
  assert.equal(await fs.stat(path.join(f.workspace, '.margin-reader/study-media', target.id, `${mediaId}.wav`)).catch(() => null), null);
  assert.deepEqual(await fs.readFile(path.join(f.workspace, '.margin-reader/study-media', source.id, `${mediaId}.wav`)), wav);
  assert.equal((await f.api('study.clipboard.get')).clipboard.id, clipboard.id);
});

test('reading and revision-changing navigation remain available in a legacy large study without replacing its history', async t => {
  const f = await setup(t), set = await f.api('study.create', { title: 'Legacy large workspace' });
  const filled = await fillStudy(f, set.id, HARD + 8192, { legacyHistory: true });
  const read = await f.api('study.get', { setId: set.id });
  assert.equal(read.cards.length, filled.cards); assert.equal(read.cards[0].id, filled.firstId);
  const shown = await f.api('study.view.set', { setId: set.id, expectedRevision: filled.revision, view: 'outline' });
  assert.equal(shown.revision, filled.revision + 1); assert.equal(shown.view, 'outline');
  assert.equal(shown.cards.length, filled.cards); assert.equal(shown.cards[0].id, filled.firstId);
  const state = JSON.parse(await fs.readFile(filled.file));
  assert.equal(state.studySets[set.id].history.undo.length, 1);
  assert.equal(state.studySets[set.id].history.undo[0].cards.length, 0);
});
