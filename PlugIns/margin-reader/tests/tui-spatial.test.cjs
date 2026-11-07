"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { setup } = require("./fixtures.cjs"),
  { Workspace } = require("../tui/workspace.cjs"),
  { render } = require("../tui/screen.cjs"),
  T = require("../tui/text.cjs");
async function fixture(t) {
  const f = await setup(t);
  await fs.writeFile(
    path.join(f.workspace, "source.html"),
    "<h1>Source</h1><p>中文精确来源</p>",
  );
  const a = new Workspace(f.runtime);
  a.width = (await import("string-width")).default;
  await a.init();
  await a.openFile(a.files[0]);
  a.acceptSet(await f.api("study.create", { title: "Spatial" }));
  await a.mutate("study.documents.add", { paths: ["source.html"] });
  const start = a.text.indexOf("中文");
  await a.mutate(
    "study.card.create",
    {
      documentId: a.doc.id,
      expectedSourceVersion: a.doc.sourceVersion,
      captureId: require("node:crypto").randomUUID(),
      text: "中文",
      color: "yellow",
      locator: { section: 0 },
      selection: { start, end: start + 2 },
    },
    (r) => (a.cardId = r.card.id),
  );
  const excerpt = a.cardId;
  await a.mutate("study.note.create", { title: "Parent" });
  const parent = a.set.cards.find((c) => c.title === "Parent").id;
  await a.mutate("study.card.move", { cardId: excerpt, parentId: parent });
  a.cardId = parent;
  a.focus = 2;
  return { ...f, a, excerpt, parent, start };
}
test("spatial ABI adapter uses complete public model, navigation/pan/zoom/fit, exact source and camera return", async (t) => {
  const { a, excerpt, start } = await fixture(t);
  await a.key("g");
  assert(a.mapMode);
  let image = render(a, 132, 32);
  assert(image.includes("SPACE"));
  assert.equal(a.spatial.scene.cards.size, 2);
  const old = a.spatial.state.zoom;
  await a.key("+");
  assert(a.spatial.state.zoom > old);
  await a.key("H");
  const pan = a.spatial.state.centerX;
  render(a, 132, 32);
  assert.equal(a.spatial.state.centerX, pan);
  await a.key("", { name: "right" });
  assert(a.set.cards.some((c) => c.id === a.cardId));
  await a.spatial.action({ type: "select", cardId: excerpt });
  await a.key("H");
  render(a, 132, 32);
  const camera = { ...a.spatial.state };
  await a.key("o");
  assert(!a.mapMode);
  assert.equal(a.cursor, start);
  await a.key("", { name: "escape" });
  assert(a.mapMode);
  assert.equal(a.cardId, excerpt);
  assert.deepEqual(a.spatial.state, camera);
  for (const [cols, rows] of [
    [132, 32],
    [64, 18],
    [28, 7],
    [132, 32],
  ]) {
    image = render(a, cols, rows);
    assert.equal(image.split("\r\n").length, rows);
    for (const line of image.split("\r\n")) assert(a.width(line) <= cols);
  }
  await a.key("0");
  await a.key("", { name: "escape" });
  assert(!a.mapMode);
  assert.equal(a.set.cards.length, 2);
});
test("full-model map search keeps hidden nodes reveal-required without persistent expansion", async (t) => {
  const { a, excerpt, parent, api } = await fixture(t);
  await a.mutate("study.card.update", { cardId: parent, collapsed: true });
  await a.key("g");
  assert(!a.spatial.scene.boxes.has(excerpt));
  await a.key("/");
  await a.key("中文");
  await a.key("", { name: "return" });
  assert.equal(a.cardId, excerpt);
  assert.equal(a.mapRevealId, excerpt);
  assert.equal(a.set.cards.length, 2);
  const revision=a.set.revision;
  await a.spatial.action({type:'center-selection'});
  assert.match(a.status,/reveal-required/);
  assert(!a.spatial.scene.boxes.has(excerpt));
  const current=await api('study.get',{setId:a.set.id});
  assert.equal(current.revision,revision);
  assert(current.cards.find(c=>c.id===parent).collapsed);
});
test("cross-study reference returns to original study and card focus", async (t) => {
  const { a, excerpt, api } = await fixture(t),
    targetSet = a.set.id;
  let other = await api("study.create", { title: "Reference study" });
  other = await api("study.card.reference", {
    setId: other.id,
    expectedRevision: other.revision,
    targetSetId: targetSet,
    targetCardId: excerpt,
  });
  a.acceptSet(other);
  const originalCard = (a.cardId = other.cards[0].id);
  a.focus = 2;
  await a.key("o");
  assert.equal(a.set.id, targetSet);
  await a.key("", { name: "escape" });
  assert.equal(a.set.id, other.id);
  assert.equal(a.cardId, originalCard);
  assert.equal(a.focus, 2);
});

test("Tab leaves the full-screen map for a visible pane without changing camera, selection, drafts or Core", async (t) => {
  const { a } = await fixture(t),
    direct = a.rpc.bind(a),
    calls = [];
  a.rpc = async (method, params) => { calls.push(method); return direct(method, params); };
  a.cursor = 2;
  a.anchor = 0;
  a.drafts.set("retained", { value: "中文草稿", cardId: a.cardId });
  for (const shift of [false, true]) {
    await a.key("g");
    render(a, 64, 18);
    await a.key("+");
    await a.key("H");
    const camera = structuredClone(a.spatial.state),
      selected = a.cardId,
      selection = a.selection(),
      drafts = structuredClone(a.drafts),
      revision = a.set.revision;
    calls.length = 0;
    await a.key("\t", { name: "tab", shift });
    const image = render(a, 64, 18);
    assert.equal(a.mapMode, false);
    assert.equal(a.review, false);
    assert.equal(a.focus, shift ? 1 : 0);
    assert(!image.includes("SPACE 空间脑图"));
    assert.match(image, shift ? /▶ READ 阅读/ : /▶ LIBRARY 文库/);
    assert.deepEqual(a.spatial.state, camera);
    assert.equal(a.cardId, selected);
    assert.deepEqual(a.selection(), selection);
    assert.deepEqual(a.drafts, drafts);
    assert.equal(a.set.revision, revision);
    assert.deepEqual(calls, []);
    if (!shift) {
      await a.key("n");
      assert.equal(a.modal, null, "a library key must not edit an invisible selected card");
    } else {
      await a.key("", { name: "home" });
      assert.equal(a.cursor, 0);
      assert.match(render(a, 64, 18), /▶ READ 阅读/);
    }
    await a.key("g");
    render(a, 64, 18);
    assert.deepEqual(a.spatial.state, camera, "reopening the same map retains its complete camera state");
    await a.key("", { name: "escape" });
  }
  calls.length = 0;
  for (const focus of [0, 1, 2]) {
    await a.key("\t", { name: "tab" });
    assert.equal(a.focus, focus);
  }
  await a.key("", { name: "tab", shift: true });
  assert.equal(a.focus, 1);
  assert.deepEqual(calls, [], "ordinary pane cycling remains local");
});

test("Space edits the selected outline or map title as a draft; input spaces remain text until explicit save", async (t) => {
  const { a, api } = await fixture(t);
  for (const map of [false, true]) {
    if (map) await a.key("g");
    const cardId = a.cardId,
      original = a.currentCard().title,
      revision = a.set.revision,
      calls = [],
      direct = a.rpc.bind(a);
    a.rpc = async (method, params) => { calls.push({ method, params }); return direct(method, params); };
    await a.key(" ", { name: "space" });
    assert.equal(a.modal?.type, "input");
    assert.match(a.modal.title, /Edit title/);
    assert.equal(a.modal.value, original);
    await a.key(" ", { name: "space" });
    await a.key("中文 alias");
    assert.equal(a.modal.value, original + " 中文 alias");
    assert.equal(a.currentCard().title, original);
    assert.deepEqual(calls, []);
    const unchanged = await api("study.get", { setId: a.set.id });
    assert.equal(unchanged.revision, revision);
    assert.equal(unchanged.cards.find((card) => card.id === cardId).title, original);
    await a.key("", { name: "return" });
    const saved = await api("study.get", { setId: a.set.id });
    assert.equal(saved.cards.find((card) => card.id === cardId).title, original + " 中文 alias");
    assert(calls.some(({ method, params }) => method === "study.card.update" && params.cardId === cardId && params.expectedRevision === revision));
    a.rpc = direct;
    await a.key("e");
    assert.equal(a.modal?.type, "input", "the existing e alias remains available");
    await a.key("", { name: "return" });
  }
});
