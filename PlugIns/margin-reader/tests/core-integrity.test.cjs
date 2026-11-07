'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const H = require('../lib/study-history.cjs');
const { locate } = require('../lib/card-location.cjs');
const card = (id, text = '') => ({ id, parentId: null, title: id, text });
const study = (id, cards = []) => ({ id, title: id, description: '', revision: 1, documentIds: [], cards, cardTrash: [] });
const largeCards = count => Array.from({ length: count }, (_, i) => card(`large-${i}`, 'x'.repeat(17000)));
function move(state, from, to, id) {
  const source = state.studySets[from], target = state.studySets[to];
  const owners = Object.values(state.studySets).filter(s => s === source || s === target || Object.values(s.cardRedirects || {}).some(r => r.setId === from && r.cardId === id));
  H.checkpointGroup(owners);
  target.cards.push(...source.cards.filter(c => c.id === id));
  source.cards = source.cards.filter(c => c.id !== id);
  source.cardRedirects = { ...source.cardRedirects, [id]: { setId: to, cardId: id } };
  for (const owner of owners) for (const redirect of Object.values(owner.cardRedirects || {})) if (redirect.setId === from && redirect.cardId === id) redirect.setId = to;
}

test('both old and newly created card URIs survive a linked move, undo and redo', () => {
  const a = study('A', [card('node')]), b = study('B'), state = { studySets: { A: a, B: b } };
  move(state, 'A', 'B', 'node');
  const referenceMadeAfterMove = { setId: 'B', cardId: 'node' };
  assert.equal(locate(state, 'B', 'node').set.id, 'B');
  H.restoreGroup(state, b, 'undo');
  for (const owner of ['A', 'B']) assert.equal(locate(state, owner, 'node').set.id, 'A');
  assert.equal(locate(state, referenceMadeAfterMove.setId, referenceMadeAfterMove.cardId).card.id, 'node');
  H.restoreGroup(state, a, 'redo');
  for (const owner of ['A', 'B']) assert.equal(locate(state, owner, 'node').set.id, 'B');
  assert.equal(a.revision, 1); assert.equal(b.revision, 1);
});

test('repeated moves preserve every established URI while undo and redo traverse different participant groups', () => {
  const a = study('A', [card('node')]), b = study('B'), c = study('C'), state = { studySets: { A: a, B: b, C: c } };
  move(state, 'A', 'B', 'node'); move(state, 'B', 'C', 'node');
  for (const [set, direction, expected] of [[c, 'undo', 'B'], [a, 'undo', 'A'], [b, 'redo', 'B'], [c, 'redo', 'C']]) {
    H.restoreGroup(state, set, direction);
    for (const owner of ['A', 'B', 'C']) assert.equal(locate(state, owner, 'node').set.id, expected);
  }
  assert.throws(() => locate(state, 'unrelated-study', 'node'), error => error.code === 'NOT_FOUND');
});

test('a legal study exceeding 8 MiB retains one complete undo and redo step within the 32 MiB hard bound', () => {
  const set = study('large', largeCards(500));
  H.checkpoint(set); set.cards[0].title = 'Edited title'; H.checkpoint(set);
  set.cards[0].title = 'Latest title';
  assert.equal(set.history.undo.length, 1);
  H.restore(set, 'undo'); assert.equal(set.cards[0].title, 'Edited title');
  assert.equal(set.history.redo.length, 1);
  H.restore(set, 'redo'); assert.equal(set.cards[0].title, 'Latest title');
  assert.equal(set.history.undo.length, 1);
  assert(Buffer.byteLength(JSON.stringify(set.history)) <= 32 * 1024 * 1024);
});

test('ordinary history keeps 30 steps, clears redo on a new edit and accepts legacy unmarked snapshots', () => {
  const set = study('small', [card('node')]);
  for (let i = 0; i < 35; i++) { H.checkpoint(set); set.cards[0].title = `Edit ${i}`; }
  assert.equal(set.history.undo.length, 30);
  H.restore(set, 'undo'); assert.equal(set.cards[0].title, 'Edit 33');
  assert.equal(set.history.redo.length, 1);
  H.checkpoint(set); set.cards[0].title = 'New branch';
  assert.equal(set.history.redo.length, 0);
  H.restore(set, 'undo'); assert.equal(set.cards[0].title, 'Edit 33');
});

test('an oversized checkpoint rejects before replacing any participant history', () => {
  const small = study('small', [card('node')]), large = study('large', largeCards(2000));
  H.checkpoint(small); const prior = small.history;
  assert.throws(() => H.checkpointGroup([small, large]), error => error.code === 'TOO_LARGE' && /32 MiB/.test(error.message));
  assert.equal(small.history, prior); assert(!Object.hasOwn(large, 'history'));
  assert.throws(() => H.checkpoint(large), error => error.code === 'TOO_LARGE');
  assert(!Object.hasOwn(large, 'history'));
});

test('a linked undo preflights all redo snapshots and leaves every owner untouched if a later one exceeds the hard bound', () => {
  const a = study('A', [card('node')]), b = study('B'), state = { studySets: { A: a, B: b } };
  move(state, 'A', 'B', 'node');
  b.cards.push(...largeCards(2000));
  const histories = [a.history, b.history], cards = [a.cards, b.cards], redirects = a.cardRedirects;
  assert.throws(() => H.restoreGroup(state, a, 'undo'), error => error.code === 'TOO_LARGE');
  assert.equal(a.history, histories[0]); assert.equal(b.history, histories[1]);
  assert.equal(a.cards, cards[0]); assert.equal(b.cards, cards[1]); assert.equal(a.cardRedirects, redirects);
  assert.equal(locate(state, 'A', 'node').set.id, 'B');
});

test('mismatched or duplicate linked participants are rejected without changing history', () => {
  const a = study('A', [card('node')]), b = study('B'), state = { studySets: { A: a, B: b } };
  move(state, 'A', 'B', 'node');
  b.history.undo.at(-1).historyTransaction = { ...b.history.undo.at(-1).historyTransaction, owners: ['B', 'B'] };
  const before = JSON.stringify(state);
  assert.throws(() => H.restoreGroup(state, a, 'undo'), error => error.code === 'STATE_CORRUPT');
  assert.equal(JSON.stringify(state), before);
});

test('linked restoration checks the final alias-enriched state before a successful undo could strand redo', () => {
  const sourceId = '00000000-0000-4000-8000-000000000001', targetId = '00000000-0000-4000-8000-000000000002';
  const moved = { id: '00000000-0000-4000-8000-000000000003', title: 'N', color: 'yellow', parentId: null };
  const a = study(sourceId, [moved]), b = study(targetId, largeCards(1900));
  const marker = { id: '00000000-0000-4000-8000-000000000004', owners: [sourceId, targetId] };
  const size = set => Buffer.byteLength(JSON.stringify({ ...H.snapshot(set), historyTransaction: marker })) + Buffer.byteLength('{"undo":[],"redo":[]}');
  const initial = size(b), added = size({ ...b, cards: [...b.cards, moved] }) - initial;
  const redirected = size({ ...b, cardRedirects: { [moved.id]: { setId: sourceId, cardId: moved.id } } }) - initial;
  // Minimal imported cards can be smaller than a complete relocation address.
  assert(redirected > added);
  let padding = 32 * 1024 * 1024 - added - initial;
  for (const card of b.cards) { const n = Math.min(20000 - card.text.length, padding); card.text += 'p'.repeat(n); padding -= n; }
  assert.equal(padding, 0);
  const state = { studySets: { [sourceId]: a, [targetId]: b } };
  move(state, sourceId, targetId, moved.id);
  assert.equal(size(b), 32 * 1024 * 1024);
  const histories = [a.history, b.history], cards = [a.cards, b.cards];
  assert.throws(() => H.restoreGroup(state, a, 'undo'), error => error.code === 'TOO_LARGE');
  assert.equal(a.history, histories[0]); assert.equal(b.history, histories[1]);
  assert.equal(a.cards, cards[0]); assert.equal(b.cards, cards[1]);
  assert.equal(locate(state, sourceId, moved.id).set.id, targetId);
});
