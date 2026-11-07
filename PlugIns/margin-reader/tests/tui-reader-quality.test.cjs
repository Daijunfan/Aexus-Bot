"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Workspace } = require("../tui/workspace.cjs"),
  { TextLayout } = require("../tui/text.cjs"),
  { render } = require("../tui/screen.cjs");
const width = async () => (await import("string-width")).default;
const key = (app, name) => app.key("", { name });

test("reader up/down and page movement preserve the visual column through short lines and soft wraps", async () => {
  const app = new Workspace({});
  app.width = await width();
  app.focus = 1;
  app.readWidth = 10;
  app.readHeight = 2;
  app.text = "0123456789\nabcdefghij\nABCDEFGHIJ";
  app.cursor = 5;
  await key(app, "down");
  assert.equal(app.cursor, 16);
  await key(app, "up");
  assert.equal(app.cursor, 5);
  await key(app, "pagedown");
  assert.equal(app.cursor, 27);
  await key(app, "pageup");
  assert.equal(app.cursor, 5);

  app.text = "ab中文👩‍👩‍👧‍👦éZ\n1\nab中文👩‍👩‍👧‍👦éZ";
  app.readWidth = 30;
  app.cursor = 4; // Six visual columns, before the complete family emoji.
  await key(app, "down");
  assert.equal(app.cursor, app.text.indexOf("\n", app.text.indexOf("\n") + 1));
  await key(app, "down");
  assert.equal(app.cursor, app.text.lastIndexOf("ab中文") + 4);
  await key(app, "up");
  await key(app, "up");
  assert.equal(app.cursor, 4);

  app.text = "0123456789ABCDEFGHIJ";
  app.readWidth = 10;
  app.cursor = 8;
  await key(app, "down");
  assert.equal(app.cursor, 18);
  await key(app, "up");
  assert.equal(app.cursor, 8);
  app.text = "中🙂文👩‍👩‍👧‍👦";
  app.readWidth = 6;
  app.cursor = 3; // Before 文, after the whole astral emoji.
  await key(app, "down");
  assert.equal(app.cursor, app.text.length);
  await key(app, "up");
  assert.equal(app.cursor, 3);
});

test("reader resize and horizontal movement reset the desired column without splitting Unicode", async () => {
  const app = new Workspace({});
  app.width = await width();
  app.focus = 1;
  app.text = "0123456789ABCDEFGHIJabcdefghij";
  app.readWidth = 10;
  app.cursor = 6;
  await key(app, "down");
  assert.equal(app.cursor, 16);
  app.readWidth = 8; // The unchanged source cursor now starts a new visual row.
  await key(app, "down");
  assert.equal(app.cursor, 24);
  await key(app, "up");
  assert.equal(app.cursor, 16);
  await key(app, "right");
  await key(app, "down");
  assert.equal(app.cursor, 25);
  app.text = "中👩‍👩‍👧‍👦é🙂文";
  app.cursor = 1;
  await key(app, "right");
  assert.equal(app.cursor, 12);
  await key(app, "right");
  assert.equal(app.cursor, 14);
  await key(app, "left");
  assert.equal(app.cursor, 12);
  await key(app, "home");
  assert.equal(app.cursor, 0); // Existing Home/End chapter semantics remain.
  await key(app, "end");
  assert.equal(app.cursor, app.text.length);
});

test("warm reader navigation and paint reuse chapter layout; content, columns and measurer invalidate it", async () => {
  const measure = await width();
  let measured = 0;
  const app = new Workspace({});
  app.width = (text) => { measured++; return measure(text); };
  app.focus = 1;
  app.text = "The quick brown fox jumps over the lazy dog. ".repeat(6000);
  app.cursor = 1000;
  render(app, 132, 36);
  const before = measured;
  await key(app, "right");
  await key(app, "down");
  render(app, 132, 36);
  assert(measured - before < 10000, "a warm frame must not remeasure 270,000 source characters");
  const sourceOffset = app.cursor;
  render(app, 80, 24);
  assert.equal(app.cursor, sourceOffset);

  const layout = new TextLayout();
  let calls = 0;
  const normal = (text) => { calls++; return measure(text); };
  assert.equal(layout.get("abcdef", 6, normal).lines.length, 1);
  const count = calls;
  layout.get("abcdef", 6, normal);
  assert.equal(calls, count);
  assert.equal(layout.get("abcdef", 3, normal).lines.length, 2);
  assert.equal(layout.get("中文", 3, normal).lines.length, 2);
  assert.equal(layout.get("abcdef", 6, (text) => 2 * measure(text)).lines.length, 2);
  assert.equal(layout.get("", 6, normal).lines.length, 1);
  assert.equal(layout.boundary(0, 1), 0);
});

test("bracketed paste retains CRLF, Chinese and emoji until explicit save, without interpreting shortcuts", async () => {
  const app = new Workspace({});
  const saved = [];
  app.prompt("Note", "before after", async (value) => saved.push(value));
  app.modal.cursor = 7;
  await key(app, "paste-start");
  for (const text of ["中文👩‍👩‍👧‍👦", "\r", "\n", "qSNR🙂é", "\x1b]52;c;blocked\x07"])
    await app.key(text, { sequence: text, name: text === "\r" ? "return" : undefined });
  await key(app, "paste-end");
  assert.equal(saved.length, 0);
  assert.equal(app.modal.type, "input");
  assert.equal(app.modal.value, "before 中文👩‍👩‍👧‍👦\nqSNR🙂é�]52;c;blocked�after");
  assert(!app.modal.value.includes("\x1b"));
  await app.key("\n", { name: "enter" }); // Real readline name for physical Ctrl-J.
  await app.key("尾行");
  await key(app, "return");
  assert.equal(saved.length, 1);
  assert.match(saved[0], /\n尾行after$/);
  assert.equal(app.modal, null);

  let stopped = false;
  app.stop = () => { stopped = true; };
  await key(app, "paste-start");
  for (const text of "qSNRue") await app.key(text);
  await key(app, "paste-end");
  assert.equal(stopped, false);
  assert.equal(app.modal, null);
  assert.match(app.status, /no command executed/);
});

test("paste cannot overflow or cross an input identity, and never submits a partial prefix", async () => {
  const app = new Workspace({});
  app.prompt("Note", "original", async () => { throw Error("must not save"); });
  await key(app, "paste-start");
  await app.key("x".repeat(1024 * 1024 + 1));
  await key(app, "paste-end");
  assert.equal(app.modal.value, "original");
  assert.match(app.status, /draft unchanged/);
  await key(app, "paste-start");
  await app.key("must not leak");
  app.prompt("Different note", "other", async () => {});
  await key(app, "paste-end");
  assert.equal(app.modal.value, "other");
});

function sourceFixture({ failContent = false, delayContent = false } = {}) {
  const original = {
    id: "origin", revision: 1, title: "Origin",
    cards: [{ id: "reference", title: "Reference" }],
    reviewSession: { id: "origin-review" },
  }, target = {
    id: "target", revision: 2, title: "Target",
    cards: [{ id: "unrelated", title: "First unrelated card" }, { id: "source-card", title: "Actual source card" }],
    reviewSession: { id: "target-review" },
  }, text = "🙂 prefix 中文👩‍👩‍👧‍👦 suffix",
    quote = "中文👩‍👩‍👧‍👦", start = text.indexOf(quote),
    content = { section: 0, html: "<p>" + text + "</p>" };
  let releaseContent, enteredContent;
  const entered = new Promise((resolve) => { enteredContent = resolve; });
  const app = new Workspace({
    async request({ method }) {
      if (method === "study.card.activate")
        return { result: {
          set: target, setId: target.id, cardId: "source-card", linked: true,
          source: { documentId: "source-doc", locator: { section: 0, textOffset: start }, selection: { start, end: start + quote.length } },
        } };
      if (method === "document.get") return { result: { id: "source-doc", format: "html" } };
      if (method === "document.content") {
        if (failContent) throw Object.assign(Error("Source disappeared during open"), { code: "NOT_FOUND" });
        if (delayContent) { enteredContent(); return new Promise((resolve) => { releaseContent = () => resolve({ result: content }); }); }
        return { result: content };
      }
      if (method === "study.get") return { result: { ...original, revision: 3 } };
      throw Error("Unexpected request " + method);
    },
  });
  app.acceptSet(original);
  app.cardId = "reference";
  app.focus = 2;
  app.doc = { id: "prior-doc" };
  app.content = { section: 4, html: "<p>Previous reader</p>" };
  app.text = "Previous reader";
  app.cursor = 7;
  app.anchor = 2;
  app.filter = "Reference";
  return { app, original, quote, start, entered, release: () => releaseContent() };
}

test("cross-study source selects the returned card and full range, then restores the original reader and review context", async () => {
  const { app, quote, start } = sourceFixture();
  const before = { doc: app.doc, content: app.content, text: app.text, cursor: app.cursor, anchor: app.anchor, filter: app.filter };
  await app.source();
  assert.equal(app.set.id, "target");
  assert.equal(app.cardId, "source-card", "the resolved card need not be the target study's first card");
  assert.equal(app.session.id, "target-review");
  assert.deepEqual(app.selection(), { start, end: start + quote.length, text: quote });
  await app.back();
  assert.equal(app.set.id, "origin");
  assert.equal(app.set.revision, 3, "return refreshes the origin through public Core");
  assert.equal(app.cardId, "reference");
  assert.equal(app.session.id, "origin-review");
  assert.equal(app.focus, 2);
  assert.deepEqual({ doc: app.doc, content: app.content, text: app.text, cursor: app.cursor, anchor: app.anchor, filter: app.filter }, before);
  assert.equal(app.returnPoint, null);
});

test("source content failure or stale navigation cannot replace the origin study/card or install a false return point", async () => {
  const { app, original } = sourceFixture({ failContent: true });
  app.mapMode = true;
  await assert.rejects(app.source(), { code: "NOT_FOUND" });
  assert.equal(app.set, original);
  assert.equal(app.cardId, "reference");
  assert.equal(app.doc.id, "prior-doc");
  assert.equal(app.text, "Previous reader");
  assert.equal(app.mapMode, true);
  assert.equal(app.returnPoint, null);
  const stale = sourceFixture({ delayContent: true }), opening = stale.app.source();
  await stale.entered;
  await key(stale.app, "tab");
  stale.release();
  await opening;
  assert.equal(stale.app.focus, 0);
  assert.equal(stale.app.set, stale.original);
  assert.equal(stale.app.cardId, "reference");
  assert.equal(stale.app.doc.id, "prior-doc");
  assert.equal(stale.app.returnPoint, null);
});
