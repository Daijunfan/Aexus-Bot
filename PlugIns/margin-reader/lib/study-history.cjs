'use strict';
const { assert } = require('./safety.cjs');
// Images are immutable assets, so history stores metadata only. Revisions never rewind.
const fields = ['title', 'description', 'documentIds', 'cards', 'cardTrash', 'links', 'ink', 'canvasInk', 'layers', 'activeLayer', 'map', 'decks', 'reviewSettings', 'navigation', 'boards', 'captureSettings', 'appearance', 'mediaAssets', 'linkSettings', 'inkSettings', 'inkBinding', 'inkRulers', 'recall', 'reviewSession', 'presentation', 'tools', 'inkToolbar', 'activeTools', 'palette', 'menuSettings','cardRedirects','documentNotebooks','activeNotebooks'];
function snapshotFields(set) { return Object.fromEntries(fields.map(k => [k, set[k] ?? ({documentNotebooks:{},activeNotebooks:{},cardRedirects:{},activeLayer:'default',map:{},navigation:{mode:'both'},captureSettings:{},appearance:{},mediaAssets:{},linkSettings:{},inkSettings:{},inkBinding:{},inkRulers:{},inkToolbar:{},activeTools:{},palette:[],menuSettings:{},recall:{enabled:false,scope:'both',mode:'mask',revealedIds:[]},reviewSession:{},presentation:{},reviewSettings:{},layers:[{id:'default',title:'默认图层',visible:true,locked:false}]}[k] ?? [])])); }
function snapshot(set) { return structuredClone(snapshotFields(set)); }
const HISTORY_BYTES = 8 * 1024 * 1024;
const STEP_BYTES = 32 * 1024 * 1024;
const EMPTY_BYTES = Buffer.byteLength('{"undo":[],"redo":[]}');
function assertReversible(set) {
  const value = snapshotFields(set);
  // Either inverse direction may be linked. Reserve the larger marker so a
  // successful restoration cannot strand the next undo or redo at the limit.
  const markers = [set.history?.undo?.at(-1)?.historyTransaction, set.history?.redo?.at(-1)?.historyTransaction].filter(Boolean);
  if (markers.length) value.historyTransaction = markers.reduce((a, b) => Buffer.byteLength(JSON.stringify(a)) >= Buffer.byteLength(JSON.stringify(b)) ? a : b);
  assert(Buffer.byteLength(JSON.stringify(value)) + EMPTY_BYTES <= STEP_BYTES, 'TOO_LARGE', 'This change exceeds the 32 MiB limit for one reversible step. No changes were applied.');
}
function historyOf(set) {
  const history = set.history ?? { undo: [], redo: [] };
  assert(Array.isArray(history.undo) && Array.isArray(history.redo), 'STATE_CORRUPT', 'Study history is corrupt.');
  return { undo: [...history.undo], redo: [...history.redo] };
}
function trim(history, keep) {
  // Keep the next inverse operation. A large study may retain one step up to
  // 32 MiB, while ordinary histories remain within 8 MiB and 30 steps.
  // Measure each entry once; repeatedly serializing the whole history made
  // large edits quadratic in the number of snapshots being discarded.
  const sizes = { undo: history.undo.map(v => Buffer.byteLength(JSON.stringify(v))), redo: history.redo.map(v => Buffer.byteLength(JSON.stringify(v))) };
  assert(sizes[keep].at(-1) + EMPTY_BYTES <= STEP_BYTES, 'TOO_LARGE', 'This change exceeds the 32 MiB limit for one reversible step. No changes were applied.');
  let bytes = EMPTY_BYTES + [...sizes.undo, ...sizes.redo].reduce((n, size) => n + size, 0);
  const total = () => history.undo.length + history.redo.length;
  const commas = () => Math.max(0, history.undo.length - 1) + Math.max(0, history.redo.length - 1);
  while (total() > 30 || bytes + commas() > HISTORY_BYTES) {
    const discard = history.undo.length > (keep === 'undo' ? 1 : 0) ? 'undo' : history.redo.length > (keep === 'redo' ? 1 : 0) ? 'redo' : null;
    if (!discard) break;
    history[discard].shift(); bytes -= sizes[discard].shift();
  }
  return history;
}
function checkpointPlan(set, marker) {
  const history = historyOf(set), value = snapshot(set);
  if (marker) value.historyTransaction = marker;
  history.undo.push(value); history.redo = [];
  return trim(history, 'undo');
}
function checkpoint(set) { set.history = checkpointPlan(set); }
function restorePlan(set, direction, marker) {
  assert(direction === 'undo' || direction === 'redo', 'INVALID_PARAMS', 'Choose undo or redo.');
  const history = historyOf(set), opposite = direction === 'undo' ? 'redo' : 'undo';
  assert(history[direction].length, 'NOT_FOUND', direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
  const current = snapshot(set);
  if (marker) current.historyTransaction = marker;
  history[opposite].push(current);
  const { historyTransaction, ...value } = history[direction].pop();
  return { set, history: trim(history, opposite), value };
}
function apply(plan) { Object.assign(plan.set, plan.value); plan.set.history = plan.history; }
function restore(set, direction) {
  const plan = restorePlan(set, direction);
  assertReversible({ ...set, ...plan.value, history: plan.history });
  apply(plan);
}
function checkpointGroup(sets) {
  assert(Array.isArray(sets) && sets.length > 0 && sets.length <= 1000 && new Set(sets.map(s => s.id)).size === sets.length, 'TOO_LARGE', 'A linked change requires 1–1000 distinct studies.');
  const marker = { id: require('node:crypto').randomUUID(), owners: sets.map(s => s.id) };
  const plans = sets.map(set => ({ set, history: checkpointPlan(set, marker) }));
  for (const plan of plans) plan.set.history = plan.history;
  return marker.id;
}
function relocatedAliases(plans) {
  const before = new Map(), after = new Map(), bySet = new Map(plans.map(p => [p.set.id, p]));
  for (const plan of plans) {
    for (const card of plan.set.cards) {
      assert(!before.has(card.id), 'STATE_CORRUPT', 'Linked studies contain a duplicate card identity.');
      before.set(card.id, plan.set.id);
    }
    for (const card of plan.value.cards) {
      assert(!after.has(card.id), 'STATE_CORRUPT', 'Linked history contains a duplicate card identity.');
      after.set(card.id, plan.set.id);
    }
    // Aliases created after the original move remain valid across its undo.
    plan.value.cardRedirects = { ...plan.set.cardRedirects, ...plan.value.cardRedirects };
  }
  const moves = new Map();
  for (const [cardId, oldSetId] of before) {
    const newSetId = after.get(cardId);
    if (!newSetId || newSetId === oldSetId) continue;
    const target = { setId: newSetId, cardId };
    moves.set(`${oldSetId}/${cardId}`, target);
    bySet.get(oldSetId).value.cardRedirects[cardId] = target;
  }
  for (const plan of plans) {
    const redirects = plan.value.cardRedirects;
    for (const [cardId, target] of Object.entries(redirects)) {
      if (after.get(cardId) === plan.set.id) delete redirects[cardId];
      else if (target && moves.has(`${target.setId}/${target.cardId}`)) redirects[cardId] = moves.get(`${target.setId}/${target.cardId}`);
    }
    assert(Object.keys(redirects).length <= 100000, 'TOO_LARGE', 'Relocation history capacity reached. No changes were applied.');
  }
}
function restoreGroup(state, set, direction) {
  const entry = set.history?.[direction]?.at(-1), marker = entry?.historyTransaction;
  if (!marker) { restore(set, direction); return [set]; }
  const participantIds = new Set(Array.isArray(marker.owners) ? marker.owners : []);
  assert(typeof marker.id === 'string' && marker.id && Array.isArray(marker.owners) && marker.owners.length > 0 && marker.owners.length <= 1000 && participantIds.has(set.id) && participantIds.size === marker.owners.length, 'STATE_CORRUPT', 'Invalid linked history participants.');
  const owners = marker.owners.map(id => {
    const other = Object.hasOwn(state.studySets, id) ? state.studySets[id] : null;
    const otherMarker = other?.history?.[direction]?.at(-1)?.historyTransaction;
    assert(other && !other.deletedAt && otherMarker?.id === marker.id, 'CONFLICT', 'A linked study was edited after this move. Undo its later changes first; no study was overwritten.');
    assert(Array.isArray(otherMarker.owners) && otherMarker.owners.length === marker.owners.length && new Set(otherMarker.owners).size === marker.owners.length && otherMarker.owners.every(id => participantIds.has(id)), 'STATE_CORRUPT', 'Linked history participants disagree.');
    return other;
  });
  // Budget and identity validation complete for every owner before any mutation.
  const plans = owners.map(owner => restorePlan(owner, direction, marker));
  relocatedAliases(plans);
  for (const plan of plans) assertReversible({ ...plan.set, ...plan.value, history: plan.history });
  plans.forEach(apply);
  return owners;
}
module.exports = { checkpoint, restore, snapshot, checkpointGroup, restoreGroup, assertReversible };
