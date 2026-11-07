"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { setup } = require("./fixtures.cjs");
const { Workspace } = require("../tui/workspace.cjs"),
  T = require("../tui/text.cjs"),
  { render } = require("../tui/screen.cjs");
async function width() {
  return (
    await import(
      require.resolve("string-width", {
        paths: [path.join(__dirname, "../tui")],
      })
    )
  ).default;
}
async function appFixture(t) {
  const f = await setup(t),
    app = new Workspace(f.runtime);
  app.width = await width();
  await fs.writeFile(
    path.join(f.workspace, "中文.html"),
    "<h1>学习标题</h1><p>前缀🙂 中文目标👩‍👩‍👧‍👦 é 后缀</p><p>第二段 needle needle</p>",
  );
  await app.init();
  await app.openFile(app.files.find((x) => x.name === "中文.html"));
  return { ...f, app };
}
const key = (a, name, str = "") => a.key(str, { name });
test("Unicode display uses grapheme cells while source selections preserve HTML UTF16 offsets", async () => {
  const w = await width(),
    raw = "甲👩‍👩‍👧‍👦é乙\x1b]52;c;secret\x07";
  assert.equal(w("中文"), 4);
  assert.equal(w("👩‍👩‍👧‍👦"), 2);
  const gs = T.graphemes(raw);
  assert.equal(gs[1].text, "👩‍👩‍👧‍👦");
  assert.equal(T.boundary(raw, 1, 1), 12);
  const wrapped = T.wrap(raw, 5, w);
  for (const row of wrapped) assert(w(row.text) <= 5);
  assert(!T.safe(raw).includes("\x1b"));
  assert.equal(T.safe(raw).length, raw.length);
  const text = T.sourceText({ html: "<h1>标题</h1><p> 前缀🙂</p><p>中文</p>" });
  assert.equal(text, "标题 前缀🙂中文");
  assert.notEqual(text, "标题\n 前缀🙂\n中文");
});
test("excerpt preview saves a recovered initial note, tags and annotation style together", async (t) => {
  const { app: a, api, workspace } = await appFixture(t);
  a.cursor = a.text.indexOf("中文目标");
  await a.key("v");
  await key(a, "right");
  await key(a, "right");
  await a.key("c");
  assert.equal(a.modal.type, "capture");
  await a.key("n");
  assert.equal(a.modal.type, "input");
  await a.key("现场批注");
  await key(a, "escape");
  assert.equal(a.captureDraft.text, "中文");
  await a.key("!");
  assert.equal(a.modal.type, "choice");
  a.modal.index = a.modal.items.findIndex((item) => item.kind === "input");
  await key(a, "return");
  assert.equal(a.modal.value, "现场批注");
  await a.key("\n", { name: "j", ctrl: true });
  await a.key("第二行");
  await key(a, "return");
  assert.equal(a.modal.type, "capture");
  assert.equal(a.captureDraft.note, "现场批注\n第二行");
  await a.key("t");
  await a.key("中文, 深读");
  await key(a, "return");
  assert.deepEqual(a.captureDraft.tags, ["中文", "深读"]);
  await a.key("s");
  assert.equal(a.modal.type, "choice");
  a.modal.index = a.modal.items.findIndex((item) => item.style === "underline");
  await key(a, "return");
  assert.equal(a.captureDraft.annotationStyle, "underline");
  assert.match(render(a, 132, 30), /Style: underline/);
  await key(a, "return");
  await key(a, "return");
  await a.key("现场学习集");
  await key(a, "return");
  assert.equal(a.modal.type, "capture-confirm");
  await key(a, "return");
  const set = await api("study.get", { setId: a.set.id });
  const excerpt = set.cards.find((card) => card.source);
  assert(excerpt);
  assert.equal(excerpt.text, "中文");
  assert.equal(excerpt.note, "现场批注\n第二行");
  assert.deepEqual(excerpt.tags, ["中文", "深读"]);
  assert.equal(excerpt.annotation.style, "underline");
  assert.equal(a.captureDraft, null);
  assert.equal((await fs.readFile(path.join(workspace, "中文.html"), "utf8")).includes("中文目标"), true);
});
test("long selections fail before preview; Shift+arrows establishes a new range", async (t) => {
  const { app: a } = await appFixture(t);
  a.text = "x".repeat(12001);
  a.anchor = 0;
  a.cursor = 12001;
  await a.key("c");
  assert.equal(a.modal, null);
  assert.equal(a.captureDraft, undefined);
  assert.match(a.status, /Selection exceeds 12000 UTF-16/);
  a.anchor = null;
  a.cursor = 0;
  await a.key("", { name: "right", shift: true });
  assert.deepEqual(a.selection(), { start: 0, end: 1, text: "x" });
  await a.key("c");
  assert.equal(a.modal.type, "capture");
});
test("complete keyboard learning flow, exact Chinese capture, outline, source, review, undo/redo and reopen", async (t) => {
  const { app: a, api, runtime, workspace } = await appFixture(t);
  await a.key("/");
  await a.key("needle");
  await key(a, "return");
  assert.equal(a.modal.type, "choice");
  await key(a, "return");
  assert.equal(a.cursor, a.text.indexOf("needle"));
  a.cursor = a.text.indexOf("中文目标");
  await a.key("v");
  for (let i = 0; i < 5; i++) await key(a, "right");
  const quote = a.selection().text;
  assert.equal(quote, "中文目标👩‍👩‍👧‍👦");
  await a.key("c");
  assert.equal(a.modal.type, "capture");
  await key(a, "return");
  assert.equal(a.modal.type, "choice");
  await key(a, "return");
  await a.key("中文学习集");
  await key(a, "return");
  assert.equal(a.modal.type, "capture-confirm");
  await key(a, "return");
  assert.equal(a.set.cards.length, 1);
  const cardId = a.cardId,
    setId = a.set.id;
  assert.equal(a.set.cards[0].text, quote);
  const start = a.captureDraft?.start ?? a.text.indexOf("中文目标");
  await a.key("e");
  await key(a, "backspace");
  await a.key("题");
  await key(a, "return");
  await a.key("n");
  await a.key("我的笔记");
  await key(a, "return");
  assert.equal(a.currentCard().note, "我的笔记");
  await a.key("N");
  await a.key("父节点");
  await key(a, "return");
  const parent = a.set.cards.find((c) => c.title === "父节点");
  a.cardId = cardId;
  await a.key("m");
  a.modal.index = a.modal.items.findIndex((x) => x.id === parent.id);
  await key(a, "return");
  assert.equal(a.currentCard().parentId, parent.id);
  a.cardId = parent.id;
  await key(a, "return");
  assert(a.currentCard().collapsed);
  await a.key("/");
  await a.key("我的笔记");
  await key(a, "return");
  assert.equal(a.cardId, cardId);
  assert.equal(a.rows().length, 2);
  assert(a.rows()[0].context);
  const beforeSource = { doc: a.doc.id, cursor: a.cursor, anchor: a.anchor, filter: a.filter };
  await a.key("o");
  assert.equal(a.cursor, start);
  assert.equal(a.focus, 1);
  assert.deepEqual(a.selection(), { start, end: start + quote.length, text: quote });
  assert.match(render(a, 132, 36), /SELECT/);
  await key(a, "escape");
  assert.equal(a.focus, 2);
  assert.equal(a.cardId, cardId);
  assert.deepEqual({ doc: a.doc.id, cursor: a.cursor, anchor: a.anchor, filter: a.filter }, beforeSource);
  await a.key("a");
  await a.key("R");
  await key(a, "down");
  await key(a, "return");
  assert(a.review);
  assert.equal(a.session.total, 1);
  await a.key("3");
  assert.match(a.status, /Reveal/);
  await a.key(" ");
  assert(a.session.revealed);
  await a.key("3");
  assert.equal(a.session.completed, 1);
  const graded = await api("study.get", { setId });
  assert.equal(graded.cards.find((c) => c.id === cardId).review.logs.length, 1);
  assert(graded.review.nextDue);
  await a.key("u");
  assert.equal(a.set.cards.find((c) => c.id === cardId).review.logs.length, 0);
  await a.key("U");
  assert.equal(a.set.cards.find((c) => c.id === cardId).review.logs.length, 1);
  await runtime.close();
  const reopened = await require("../runtime.cjs").createPlugin({ workspace });
  t.after(() => reopened.close());
  const b = new Workspace(reopened);
  b.width = await width();
  await b.init();
  await b.loadSet(setId);
  await b.startReview();
  await key(b, "return");
  assert.equal(b.session.completed, 1);
  assert.equal(b.set.cards.find((c) => c.id === cardId).note, "我的笔记");
});
test("CONFLICT retains old intent/draft; refresh does not write; explicit retry required", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "conflict" }));
  await a.mutate("study.note.create", { title: "Original" });
  a.cardId = a.set.cards[0].id;
  a.focus = 2;
  await a.key("e");
  a.modal.value = "My retained draft";
  const old = a.set.revision;
  await api("study.card.update", {
    setId: a.set.id,
    expectedRevision: old,
    cardId: a.cardId,
    title: "Other process",
  });
  await assert.rejects(key(a, "return"), (e) => e.code === "CONFLICT");
  assert.equal(a.intent.params.title, "My retained draft");
  assert.equal(a.intent.params.expectedRevision, old);
  assert.equal(a.modal.type, "conflict");
  await a.key("r");
  assert.equal(a.currentCard().title, "Other process");
  assert.equal(a.intent.params.expectedRevision, old);
  assert.equal(
    (await api("study.get", { setId: a.set.id })).cards[0].title,
    "Other process",
  );
  await key(a, "return");
  assert.equal(a.currentCard().title, "My retained draft");
  assert.equal(a.intent, null);
  await a.key("n");
  await a.key("cancelled note");
  await key(a, "escape");
  await a.key("n");
  assert.equal(a.modal.value, "cancelled note");
});
test("image occlusion cannot grade even after reveal; duplicate pending rating cannot grade next question", async (t) => {
  const { app: a, api, runtime } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "review" }));
  await a.mutate("study.note.create", { title: "Image" });
  a.cardId = a.set.cards[0].id;
  await a.mutate("study.review.configure", {
    cardId: a.cardId,
    enabled: true,
    occlusions: [{ x: 0, y: 0, width: 0.2, height: 0.2 }],
  });
  await a.mutate("study.review.session.start", { mode: "scheduled" });
  a.review = true;
  await a.loadReview();
  await a.reviewAction("reveal");
  await a.reviewAction("grade", "good");
  assert.match(a.status, /GRADING|grading/);
  assert.equal(a.set.cards[0].review.logs.length, 0);
  await a.mutate("study.review.configure", {
    cardId: a.cardId,
    enabled: true,
    occlusions: [],
  });
  await a.mutate("study.note.create", { title: "Other" });
  await a.mutate("study.review.configure", {
    cardId: a.set.cards[1].id,
    enabled: true,
  });
  await a.mutate("study.review.session.start", { mode: "scheduled" });
  await a.loadReview();
  await a.reviewAction("reveal");
  const direct = a.rpc.bind(a);
  let release, entered;
  const started = new Promise((r) => (entered = r));
  a.rpc = async (method, p) => {
    if (method === "study.review.session.action" && p.action === "grade") {
      entered();
      await new Promise((r) => (release = r));
    }
    return direct(method, p);
  };
  const first = a.reviewAction("grade", "good");
  await started;
  await a.reviewAction("grade", "easy");
  release();
  await first;
  assert.equal(a.session.completed, 1);
  assert.equal(
    a.set.cards.reduce((n, c) => n + (c.review?.logs?.length || 0), 0),
    1,
  );
});

test("review opens with knowledge focus; Tab reveals a real pane without changing the saved session or grading", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "Review focus" }));
  await a.mutate("study.note.create", { title: "Question", text: "Answer" });
  a.cardId = a.set.cards[0].id;
  await a.mutate("study.review.configure", {
    cardId: a.cardId, enabled: true, frontMode: "title", backMode: "card",
  });
  a.cursor = 5;
  a.anchor = 0;
  a.drafts.set("retained", { value: "保持草稿", cardId: a.cardId });
  const direct = a.rpc.bind(a), calls = [];
  a.rpc = async (method, params) => { calls.push(method); return direct(method, params); };
  for (const [index, mode] of [
    { focus: 1, shift: false, map: false },
    { focus: 0, shift: true, map: false },
    { focus: 2, shift: false, map: true },
  ].entries()) {
    a.focus = mode.focus;
    if (mode.map) {
      await a.key("g");
      render(a, 64, 18);
      await a.key("+");
      await a.key("H");
    }
    await a.key("R");
    if (index === 0) await key(a, "down"); // New scheduled session; later iterations resume it.
    await key(a, "return");
    assert.equal(a.focus, 2);
    assert.equal(a.review, true);
    assert.match(render(a, 64, 18), /FSRS REVIEW/);
    if (index === 0) {
      await a.key(" ", { name: "space" });
      assert.equal(a.modal, null, "review Space must reveal, not open the title editor");
      assert.equal(a.session.revealed, true);
      assert.equal(a.currentCard().title, "Question");
      assert.equal(a.currentCard().review.logs.length, 0);
    }
    a.reviewScroll = 1;
    const saved = structuredClone({
      session: a.session, face: a.face, preview: a.preview, scroll: a.reviewScroll,
      cardId: a.cardId, selection: a.selection(), drafts: a.drafts,
      camera: a.spatial?.state,
    });
    const publicSession = await api("study.review.session.get", { setId: a.set.id });
    calls.length = 0;
    await a.key("\t", { name: "tab", shift: mode.shift });
    const image = render(a, 64, 18);
    assert.equal(a.review, false);
    assert.equal(a.mapMode, false, "Tab leaves any map under the review screen as well");
    assert.equal(a.focus, mode.shift ? 1 : 0);
    assert(!image.includes("FSRS REVIEW") && !image.includes("SPACE 空间脑图"));
    assert.match(image, mode.shift ? /▶ READ 阅读/ : /▶ LIBRARY 文库/);
    assert.deepEqual({
      session: a.session, face: a.face, preview: a.preview, scroll: a.reviewScroll,
      cardId: a.cardId, selection: a.selection(), drafts: a.drafts,
      camera: a.spatial?.state,
    }, saved);
    assert.deepEqual(calls, []);
    assert.deepEqual(await api("study.review.session.get", { setId: a.set.id }), publicSession);
    const set = await api("study.get", { setId: a.set.id });
    assert.equal(set.cards.find((card) => card.id === a.cardId).review.logs.length, 0);
  }
});
test("10000-card full model search includes collapsed descendants, no model truncation; resize stable offset", async () => {
  const a = new Workspace({});
  a.width = await width();
  a.set = {
    title: "10k",
    revision: 1,
    cards: Array.from({ length: 10000 }, (_, i) => ({
      id: String(i),
      title: i === 9999 ? "hidden needle" : "Card " + i,
      parentId: i ? "0" : null,
      collapsed: i === 0,
      text: "中文🙂",
    })),
  };
  a.cardId = "0";
  assert.equal(a.rows().length, 1);
  a.focus = 2;
  await a.search("needle");
  assert.equal(a.cardId, "9999");
  assert.equal(a.rows().length, 2);
  assert(a.rows()[0].context);
  assert.equal(a.set.cards.length, 10000);
  a.text = "中文👩‍👩‍👧‍👦é".repeat(100);
  a.cursor = 63;
  a.focus = 1;
  for (const [c, r] of [
    [140, 35],
    [80, 24],
    [40, 12],
    [20, 5],
    [140, 35],
  ]) {
    const image = render(a, c, r);
    assert.equal(image.split("\r\n").length, r);
    for (const line of image.split("\r\n")) assert(a.width(line) <= c);
    assert.equal(a.cursor, 63);
  }
});
test("stale navigation result cannot steal newer focus", async () => {
  let release;
  const a = new Workspace({ request: () => new Promise((r) => (release = r)) });
  a.files = [];
  const opening = a.openFile({ path: "x.html", readable: true });
  await key(a, "tab");
  release({ result: { id: "old" } });
  await opening;
  assert.equal(a.doc, null);
  assert.equal(a.focus, 1);
});

test("draft identity separates cards, fields and studies; recovery returns to original object", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "A" }));
  await a.mutate("study.note.create", { title: "Card A", text: "A body" });
  await a.mutate("study.note.create", { title: "Card B", text: "B body" });
  const setA = a.set.id,
    cardA = a.set.cards[0].id,
    cardB = a.set.cards[1].id;
  a.focus = 2;
  a.cardId = cardA;
  await a.key("n");
  await a.key("A private draft");
  await key(a, "escape");
  a.cardId = cardB;
  await a.key("n");
  assert.equal(a.modal.value, "");
  await a.key("B private draft");
  await key(a, "escape");
  a.cardId = cardA;
  await a.key("e");
  assert.equal(a.modal.value, "Card A");
  await key(a, "escape");
  await a.key("n");
  assert.equal(a.modal.value, "A private draft");
  await key(a, "escape");
  a.acceptSet(await api("study.create", { title: "B" }));
  await a.mutate("study.note.create", { title: "Other set card" });
  a.cardId = a.set.cards[0].id;
  await a.key("n");
  assert.equal(a.modal.value, "");
  await key(a, "escape");
  await a.key("!");
  const index = a.modal.items.findIndex(
    (x) =>
      x.draft?.setId === setA &&
      x.draft?.cardId === cardB &&
      x.draft?.title.startsWith("Edit note"),
  );
  assert(index >= 0);
  a.modal.index = index;
  await key(a, "return");
  assert.equal(a.set.id, setA);
  assert.equal(a.cardId, cardB);
  assert.equal(a.modal.value, "B private draft");
  await key(a, "return");
  assert.equal(a.currentCard().note, "B private draft");
  assert.equal(a.set.cards.find((c) => c.id === cardA).note, "");
});
test("real grouped cloze screen never leaks hidden answers, including duplicate groups and conflict overlays", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "Cloze" }));
  await a.mutate("study.note.create", {
    title: "Question",
    text: "Context only",
  });
  a.cardId = a.set.cards[0].id;
  await a.mutate("study.review.configure", {
    cardId: a.cardId,
    enabled: true,
    cloze:
      "{{c1::秘密答案}} / {{c1::重复秘密}} / {{c2::第二机密}} / {{c10::最后秘密}}",
  });
  await a.mutate("study.review.session.start", { mode: "scheduled" });
  a.review = true;
  await a.loadReview();
  const screen = () => render(a, 132, 36);
  let text = screen();
  for (const secret of ["秘密答案", "重复秘密", "第二机密", "最后秘密"])
    assert(!text.includes(secret), secret + " leaked before reveal");
  await a.reviewAction("reveal");
  text = screen();
  assert(text.includes("秘密答案"));
  assert(text.includes("重复秘密"));
  assert(!text.includes("第二机密"));
  assert(!text.includes("最后秘密"));
  assert(!a.session.revealed);
  await a.reviewAction("grade", "good");
  assert.equal(a.set.cards[0].review.logs.length, 0);
  a.modal = { type: "conflict", title: "CONFLICT" };
  a.intent = {
    method: "study.review.session.action",
    params: {
      setId: a.set.id,
      expectedRevision: a.set.revision,
      action: "grade",
      rating: "good",
    },
  };
  text = screen();
  assert(!text.includes("第二机密"));
  assert(!text.includes("最后秘密"));
  a.modal = null;
  a.intent = null;
  await a.reviewAction("reveal");
  text = screen();
  assert(text.includes("第二机密"));
  assert(!text.includes("最后秘密"));
  assert(!a.session.revealed);
  await a.reviewAction("reveal");
  text = screen();
  assert(text.includes("最后秘密"));
  assert(a.session.revealed);
  await a.reviewAction("grade", "good");
  assert.equal(a.session.completed, 1);
});
test("cancelled excerpt has visible recovery; unknown commit result queries before any replay", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.cursor = a.text.indexOf("中文目标");
  await a.key("v");
  await key(a, "right");
  await a.key("c");
  const capture = a.captureDraft;
  await key(a, "escape");
  await a.key("!");
  a.modal.index = a.modal.items.findIndex((x) => x.kind === "capture");
  await key(a, "return");
  assert.equal(a.modal.type, "capture");
  assert.equal(a.captureDraft, capture);
  a.modal = null;
  a.acceptSet(await api("study.create", { title: "Unknown" }));
  await a.mutate("study.note.create", { title: "Before" });
  a.cardId = a.set.cards[0].id;
  const rpc = a.rpc.bind(a);
  let writes = 0;
  a.rpc = async (method, p) => {
    if (method === "study.card.update") {
      writes++;
      await rpc(method, p);
      throw new Error("lost transport response");
    }
    return rpc(method, p);
  };
  await assert.rejects(
    a.mutate("study.card.update", {
      cardId: a.cardId,
      title: "Committed once",
    }),
    /lost transport/,
  );
  assert(a.intent.uncertain);
  await a.key("!");
  await key(a, "return");
  assert.equal(writes, 1);
  assert.equal(a.intent, null);
  assert.match(a.status, /confirms committed/);
  assert.equal(a.currentCard().title, "Committed once");
});
test("unknown non-idempotent operation stays blocked after query; changed review question cannot be regraded", async (t) => {
  const { app: a, api } = await appFixture(t);
  a.acceptSet(await api("study.create", { title: "blocked" }));
  a.intent = {
    method: "study.note.create",
    params: {
      setId: a.set.id,
      expectedRevision: a.set.revision,
      title: "Unknown",
    },
    uncertain: true,
  };
  await a.refreshConflict();
  assert(a.modal.blocked);
  await a.retryConflict();
  assert.equal((await api("study.get", { setId: a.set.id })).cards.length, 0);
});

test("uncertain study creation queries candidates and blocks duplicate creation", async (t) => {
  const { app: a, api } = await appFixture(t),
    rpc = a.rpc.bind(a);
  let creates = 0;
  a.rpc = async (method, p) => {
    if (method === "study.create") {
      creates++;
      await rpc(method, p);
      throw Error("lost create response");
    }
    return rpc(method, p);
  };
  await a.key("S");
  await key(a, "return");
  await a.key("One creation");
  await assert.rejects(key(a, "return"), /lost create/);
  assert.equal(a.intent.method, "study.create");
  assert(a.intent.uncertain);
  await a.key("!");
  await key(a, "return");
  assert(a.modal.blocked);
  assert.equal(a.modal.candidates.length, 1);
  await key(a, "return");
  assert.equal(creates, 1);
  assert.equal((await api("study.list")).sets.length, 1);
});
test("screen-line movement advances past wrap boundaries and library search exposes next/previous result pages", async () => {
  const a = new Workspace({});
  a.width = await width();
  a.focus = 1;
  a.text = "中文🙂".repeat(80);
  render(a, 40, 16);
  await key(a, "down");
  const first = a.cursor;
  await key(a, "down");
  assert(a.cursor > first);
  await key(a, "up");
  assert.equal(a.cursor, first);
  const calls = [];
  a.focus = 0;
  a.doc = { id: "already-open" };
  a.rpc = async (method, params) => {
    require("../runtime.cjs").validate(method, params);
    calls.push({ method, params });
    return {
      hits: [{ documentId: "doc", title: "Hit", snippet: "found" }],
      nextOffset: params.offset === 0 ? 100 : null,
    };
  };
  await a.search("found");
  assert.equal(calls[0].method, "library.search");
  a.modal.index = a.modal.items.findIndex((x) => x.resultPage === 100);
  await key(a, "return");
  assert.equal(calls[1].params.offset, 100);
  assert(a.modal.items.some((x) => x.resultPage === 0));
});
