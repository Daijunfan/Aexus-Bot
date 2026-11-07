"use strict";
const { randomUUID } = require("node:crypto");
const T = require("./text.cjs");
class Workspace {
  constructor(client) {
    this.client = client;
    this.focus = 0;
    this.folder = ".";
    this.files = [];
    this.fileIndex = 0;
    this.doc = null;
    this.content = null;
    this.text = "";
    this.cursor = 0;
    this.anchor = null;
    this.set = null;
    this.cardId = null;
    this.filter = "";
    this.modal = null;
    this.status = "Ready / 就绪";
    this.pending = false;
    this.intent = null;
    this.nav = 0;
    this.dead = false;
    this.review = false;
    this.reviewScroll = 0;
    this.lastDue = null;
    this.session = null;
    this.face = null;
    this.preview = null;
    this.returnPoint = null;
    this.changed = () => {};
    this.drafts = new Map();
    this.textLayout = new T.TextLayout();
    this.readerGoal = null;
    this.paste = null;
  }
  async rpc(method, params = {}) {
    const r = await this.client.request({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params,
    });
    if (r.error) {
      const e = new Error(r.error.message);
      e.code = r.error.data?.code || "RPC_ERROR";
      e.details = r.error.data?.details;
      throw e;
    }
    return r.result;
  }
  notify() {
    if (!this.dead) this.changed();
  }
  error(e) {
    this.status = (e.code || "ERROR") + ": " + e.message;
    this.notify();
  }
  async init() {
    await this.loadFolder(".");
    if (this.dead) return;
    const r = await this.rpc("study.list");
    this.sets = r.sets || [];
    this.notify();
  }
  async loadFolder(folder) {
    const token = ++this.nav,
      r = await this.rpc("fs.list", { path: folder });
    if (this.dead || token !== this.nav) return;
    this.folder = folder;
    this.files = r.entries || [];
    this.fileIndex = 0;
    this.status = r.truncated
      ? "Folder results truncated; open subfolders."
      : "Ready / 就绪";
    this.notify();
  }
  rows() {
    return T.outline(this.set?.cards || [], new Set(), this.filter);
  }
  readerLayout(columns = this.readWidth || 60) {
    return this.textLayout.get(this.text, columns, this.width);
  }
  moveReaderRows(delta) {
    const layout = this.readerLayout();
    if (
      !this.readerGoal || this.readerGoal.generation !== layout.generation ||
      this.readerGoal.cursor !== this.cursor
    )
      this.readerGoal = {
        generation: layout.generation,
        column: layout.columnAt(this.cursor), cursor: this.cursor,
      };
    const current = layout.lineAt(this.cursor),
      target = Math.max(0, Math.min(layout.lines.length - 1, current + delta));
    if (target !== current)
      this.cursor = layout.offsetAtColumn(target, this.readerGoal.column);
    this.readerGoal.cursor = this.cursor;
  }
  handlePaste(str, key = {}) {
    if (key.ctrl && key.name === "c") return false;
    if (key.name === "paste-start") {
      this.paste = {
        target: !this.pending && this.modal?.type === "input" ? this.modal : null,
        value: "", overflow: false,
      };
      return true;
    }
    if (!this.paste) return key.name === "paste-end";
    const paste = this.paste;
    if (key.name !== "paste-end") {
      const value = str || key.sequence || "";
      if (paste.target && !paste.overflow) {
        if (paste.value.length + value.length > 1024 * 1024) {
          paste.value = "";
          paste.overflow = true;
        } else paste.value += value;
      }
      return true;
    }
    this.paste = null;
    if (paste.overflow)
      this.status = "Paste exceeds 1 Mi UTF-16 units; draft unchanged / 粘贴过长，草稿未变";
    else if (!paste.target || this.modal !== paste.target || this.pending)
      this.status = "Paste requires an active text input; no command executed / 请在输入框粘贴";
    else {
      const m = paste.target,
        value = T.safe(paste.value.replace(/\r\n?/g, "\n"));
      m.value = m.value.slice(0, m.cursor) + value + m.value.slice(m.cursor);
      m.cursor += value.length;
      this.status = "Pasted into draft; Enter to save / 已粘贴到草稿，按 Enter 保存";
    }
    this.notify();
    return true;
  }
  currentCard() {
    return this.set?.cards.find((c) => c.id === this.cardId);
  }
  acceptSet(r) {
    const s = r?.set || (r?.cards ? r : null);
    if (s) {
      this.set = s;
      if (!s.cards.some((c) => c.id === this.cardId))
        this.cardId = s.cards[0]?.id || null;
      this.session = s.reviewSession || null;
    }
    return s;
  }
  async loadSet(id) {
    const token = ++this.nav,
      s = await this.rpc("study.get", { setId: id });
    if (token !== this.nav || this.dead) return;
    this.acceptSet(s);
    this.notify();
  }
  async openFile(entry) {
    if (entry.kind === "folder") return this.loadFolder(entry.path);
    if (!entry.readable) {
      this.status = "Unsupported file / 无法读取";
      return this.notify();
    }
    const token = ++this.nav,
      doc = await this.rpc("document.open", { path: entry.path });
    if (token !== this.nav || this.dead) return;
    await this.read(doc, doc.position || {}, token);
    if (token === this.nav) {
      this.focus = 1;
      this.notify();
    }
  }
  async read(doc, locator = {}, token = ++this.nav) {
    const content = await this.rpc("document.content", {
      id: doc.id,
      ...(doc.kind === "pdf" || doc.format === "pdf"
        ? { page: locator.page || 1 }
        : { section: locator.section || 0 }),
    });
    if (token !== this.nav || this.dead) return;
    this.doc = doc;
    this.content = content;
    this.text = T.sourceText(content);
    this.cursor = Math.min(this.text.length, locator.textOffset || 0);
    this.anchor = null;
    this.readerGoal = null;
    this.notify();
    return true;
  }
  async jump(locator) {
    if (!this.doc) return;
    const doc = this.doc,
      token = ++this.nav;
    await this.rpc("reader.position.set", { id: doc.id, locator });
    if (token === this.nav) await this.read(doc, locator, token);
    if (token === this.nav && !this.dead) {
      this.focus = 1;
      this.notify();
      return true;
    }
    return false;
  }
  async turn(delta) {
    if (!this.doc) return;
    const index =
        this.content.page !== undefined
          ? this.content.page - 1
          : this.content.section,
      limit = this.doc.sectionCount || this.doc.pageCount || 1,
      next = Math.max(0, Math.min(limit - 1, index + delta));
    await this.jump(
      this.content.page !== undefined ? { page: next + 1 } : { section: next },
    );
  }
  prompt(title, value, submit, captureKey) {
    const draftKey =
      captureKey || title + ":" + (this.set?.id || "") + ":" + (this.cardId || "");
    const text = this.drafts.get(draftKey)?.value ?? String(value || "");
    this.modal = {
      type: "input",
      title,
      draftKey,
      setId: this.set?.id,
      cardId: this.cardId,
      value: text,
      cursor: text.length,
      submit,
    };
    this.notify();
  }
  choose(title, items, submit) {
    this.modal = { type: "choice", title, items, index: 0, submit };
    this.notify();
  }
  async chooseSet(after) {
    const r = await this.rpc("study.list");
    this.sets = r.sets || [];
    this.choose(
      "学习集 / Study set",
      [{ title: "+ New study / 新建学习集", create: true }, ...this.sets],
      async (item) => {
        if (item.create)
          this.prompt("New study title", "", async (title) => {
            if (this.intent)
              throw new Error(
                "Resolve retained operation with ! before creating another study",
              );
            await this.executeIntent({
              method: "study.create",
              params: { title },
              draftKey: this.submitting,
              onSuccess: async () => after?.(),
            });
          });
        else {
          const s = await this.rpc("study.get", { setId: item.id });
          this.acceptSet(s);
          await after?.();
        }
      },
    );
  }
  // Freeze params once. Refresh never implicitly replays this intent.
  async mutate(method, params = {}, onSuccess) {
    if (this.pending) {
      this.status = "Operation pending / 操作处理中";
      return;
    }
    if (this.intent)
      throw new Error(
        "Resolve retained operation with ! before another write / 请先恢复或放弃旧操作",
      );
    if (!this.set) throw new Error("Select a study first / 请先选择学习集");
    const intent = {
      method,
      draftKey: this.submitting,
      questionKey: this.session?.current?.key,
      params: {
        setId: this.set.id,
        expectedRevision: this.set.revision,
        ...params,
      },
      onSuccess,
    };
    return this.executeIntent(intent);
  }
  async executeIntent(intent) {
    if (this.pending) return;
    this.pending = true;
    this.notify();
    try {
      const r = await this.rpc(intent.method, intent.params);
      if (this.dead) return;
      if (!this.acceptSet(r))
        this.acceptSet(
          await this.rpc("study.get", { setId: intent.params.setId }),
        );
      this.intent = null;
      if (intent.draftKey) this.drafts.delete(intent.draftKey);
      await intent.onSuccess?.(r);
      this.status = "Saved / 已保存";
    } catch (e) {
      if (e.code === "CONFLICT") {
        this.intent = intent;
        this.modal = {
          type: "conflict",
          title: "CONFLICT — draft and original intent retained",
          refreshed: false,
        };
      } else {
        intent.uncertain =
          !e.code ||
          [
            "RPC_ERROR",
            "HOST_UNAVAILABLE",
            "TIMEOUT",
            "TRANSPORT_ERROR",
          ].includes(e.code);
        this.intent = intent;
        this.status =
          (e.code || "ERROR") +
          ": " +
          e.message +
          " — ! recover/query retained intent";
      }
      throw e;
    } finally {
      this.pending = false;
      this.notify();
    }
  }
  async refreshConflict() {
    if (!this.intent) return;
    const intent = this.intent;
    if (intent.method === "study.create") {
      const r = await this.rpc("study.list");
      this.sets = r.sets || [];
      this.modal = {
        type: "conflict",
        refreshed: true,
        blocked: true,
        title:
          "Queried study list: creation result uncertain; replay disabled.",
        candidates: this.sets
          .filter((x) => x.title === intent.params.title)
          .map((x) => ({ id: x.id, title: x.title })),
      };
      return this.notify();
    }
    const s = await this.rpc("study.get", { setId: intent.params.setId });
    this.acceptSet(s);
    const p = intent.params,
      card = s.cards.find((c) => c.id === p.cardId);
    let committed = false;
    if (intent.method === "study.documents.add")
      committed = p.paths.every((path) =>
        s.documents.some((d) => d.path === path),
      );
    if (intent.method === "study.card.create")
      committed = s.cards.some((c) => c.captureId === p.captureId);
    if (intent.method === "study.review.session.action" && p.action === "grade")
      committed = Boolean(
        s.reviewSession?.id === p.sessionId &&
          s.reviewSession?.answers?.[intent.questionKey],
      );
    if (intent.method === "study.card.update" && card)
      committed = Object.entries(p)
        .filter(([k]) => !["setId", "expectedRevision", "cardId"].includes(k))
        .every(([k, v]) => JSON.stringify(card[k]) === JSON.stringify(v));
    if (intent.uncertain && committed) {
      this.intent = null;
      this.modal = null;
      if (intent.draftKey) this.drafts.delete(intent.draftKey);
      this.status = "Query confirms committed; no replay / 查询确认已提交";
      if (intent.method === "study.card.create") {
        this.captureDraft = null;
        this.anchor = null;
      }
      if (this.review) await this.loadReview();
      return this.notify();
    }
    const changedQuestion =
      intent.method === "study.review.session.action" &&
      (s.reviewSession?.id !== p.sessionId ||
        s.reviewSession?.current?.key !== intent.questionKey);
    this.modal = {
      type: "conflict",
      refreshed: true,
      blocked: Boolean(intent.uncertain || changedQuestion),
      title: intent.uncertain
        ? "Result uncertain: queried latest state. Replay disabled; inspect/discard and act again."
        : "Refreshed. Compare current value; Enter explicitly retries draft.",
    };
    this.notify();
  }
  async retryConflict() {
    if (!this.modal?.refreshed || this.modal.blocked || !this.intent) return;
    const old = this.intent;
    if (
      old.method === "study.review.session.action" &&
      old.params.action === "grade" &&
      (this.imageBlocked() || !this.session?.revealed)
    ) {
      this.status =
        "Grading still blocked: hidden answer or unsupported image occlusion";
      return this.notify();
    }
    this.modal = null;
    await this.executeIntent({
      ...old,
      params: { ...old.params, expectedRevision: this.set.revision },
    });
  }
  async recover() {
    const items = [];
    if (this.intent)
      items.push({
        title: "Query retained operation / 查询待恢复操作",
        kind: "intent",
      });
    if (this.captureDraft)
      items.push({
        title: "Restore excerpt preview / 恢复摘录预览",
        kind: "capture",
      });
    for (const [id, draft] of this.drafts)
      items.push({
        title: draft.title + " · " + (draft.cardId || draft.setId || "new"),
        kind: "input",
        id,
        draft,
      });
    if (!items.length) {
      this.status = "No retained drafts / 无待恢复草稿";
      return this.notify();
    }
    this.choose("Recover drafts / 恢复草稿", items, async (item) => {
      if (item.kind === "intent") return this.refreshConflict();
      if (item.kind === "capture") {
        this.modal = { type: "capture", title: "Excerpt preview / 摘录预览" };
        return;
      }
      const d = item.draft;
      if (d.setId) {
        this.acceptSet(await this.rpc("study.get", { setId: d.setId }));
        this.cardId = d.cardId;
      }
      this.modal = { ...d, cursor: d.value.length };
    });
  }
  selection() {
    if (this.anchor === null) return null;
    const start = Math.min(this.anchor, this.cursor),
      end = Math.max(this.anchor, this.cursor);
    return { start, end, text: this.text.slice(start, end) };
  }
  capture() {
    const selection = this.selection();
    if (!this.doc || !selection?.text) {
      this.status = "v or Shift+arrows to select text, then c / 先选中文字";
      return this.notify();
    }
    if (selection.text.length > 12000) {
      this.status = "Selection exceeds 12000 UTF-16 units; shorten before c / 选区过长";
      return this.notify();
    }
    this.captureDraft = {
      ...selection,
      documentId: this.doc.id,
      path: this.doc.path,
      sourceVersion: this.doc.sourceVersion,
      locator:
        this.content.page !== undefined
          ? { page: this.content.page }
          : { section: this.content.section },
      pdf: this.content.page !== undefined,
      captureId: randomUUID(),
    };
    this.modal = { type: "capture", title: "Excerpt preview / 摘录预览" };
    this.notify();
  }
  captureOption(option) {
    const d = this.captureDraft;
    if (!d) return;
    const type = this.modal?.type === "capture-confirm" ? "capture-confirm" : "capture";
    const preview = () => {
      this.modal = {
        type,
        title: type === "capture" ? "Excerpt preview / 摘录预览" : "Confirm target / 确认目标学习集",
      };
      this.notify();
    };
    if (option === "note")
      return this.prompt(
        "Excerpt note / 摘录批注 (Ctrl-J newline)",
        d.note || "",
        (value) => { d.note = value; preview(); },
        "capture:" + d.captureId + ":note",
      );
    if (option === "tags")
      return this.prompt(
        "Excerpt tags / 标签 (comma-separated)",
        (d.tags || []).join(", "),
        (value) => {
          const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean);
          if (tags.length > 30 || tags.some((tag) => tag.length > 60 || /[\r\n]/.test(tag)) || new Set(tags).size !== tags.length) {
            const error = new Error("Use at most 30 unique comma-separated tags, each 1–60 characters");
            error.code = "INVALID_PARAMS";
            throw error;
          }
          d.tags = tags;
          preview();
        },
        "capture:" + d.captureId + ":tags",
      );
    if (option === "style")
      return this.choose(
        "Excerpt style / 摘录样式",
        [
          { title: "Use study preset / 使用预设", style: null },
          ...["highlight", "underline", "strike", "box"].map((style) => ({ title: style, style })),
        ],
        (item) => {
          if (item.style) d.annotationStyle = item.style;
          else delete d.annotationStyle;
          preview();
        },
      );
  }
  async captureTarget() {
    const d = this.captureDraft;
    if (!d) return;
    await this.chooseSet(async () => {
      this.modal = {
        type: "capture-confirm",
        title: "Confirm target / 确认目标学习集",
      };
    });
  }
  async commitCapture() {
    const d = this.captureDraft;
    if (!d || !this.set) return;
    this.modal = null;
    const create = async () =>
      this.mutate(
        "study.card.create",
        {
          documentId: d.documentId,
          expectedSourceVersion: d.sourceVersion,
          captureId: d.captureId,
          text: d.text,
          color: "yellow",
          locator: d.locator,
          ...(!d.pdf ? { selection: { start: d.start, end: d.end } } : {}),
          ...(d.note !== undefined ? { note: d.note } : {}),
          ...(d.tags !== undefined ? { tags: d.tags } : {}),
          ...(d.annotationStyle ? { annotationStyle: d.annotationStyle } : {}),
        },
        (r) => {
          this.cardId = r.card?.id || this.cardId;
          this.captureDraft = null;
          this.anchor = null;
          this.focus = 2;
        },
      );
    if (
      !(this.set.documents || []).some(
        (x) =>
          (typeof x === "string" ? x : x.id || x.documentId) === d.documentId,
      )
    ) {
      await this.mutate(
        "study.documents.add",
        { paths: [d.path] },
        async () => {
          this.status = "Membership saved; creating excerpt";
        },
      );
      // Membership can already be deduplicated by Core; use returned revision.
    }
    await create();
  }
  async edit(field) {
    const card = this.currentCard();
    if (!card) return;
    const id = card.id;
    this.prompt(
      field === "title"
        ? "Edit title / 标题"
        : "Edit note / 笔记 (Ctrl-J newline)",
      card[field] || "",
      (value) =>
        this.mutate("study.card.update", { cardId: id, [field]: value }),
    );
  }
  move() {
    const c = this.currentCard();
    if (!c) return;
    const forbidden = new Set([c.id]);
    let more = true;
    while (more) {
      more = false;
      for (const x of this.set.cards)
        if (forbidden.has(x.parentId) && !forbidden.has(x.id)) {
          forbidden.add(x.id);
          more = true;
        }
    }
    this.choose(
      "Move subtree: choose new parent / 子树移至",
      [
        { id: null, title: "(Root / 顶层)" },
        ...this.set.cards.filter((x) => !forbidden.has(x.id)),
      ],
      (item) =>
        this.mutate("study.card.move", { cardId: c.id, parentId: item.id }),
    );
  }
  async source() {
    const c = this.currentCard();
    if (!c) return;
    const token = ++this.nav;
    const point = {
      focus: this.focus,
      set: this.set,
      mapMode: Boolean(this.mapMode),
      cardId: this.cardId,
      filter: this.filter,
      doc: this.doc,
      content: this.content,
      text: this.text,
      cursor: this.cursor,
      anchor: this.anchor,
    };
    const r = await this.rpc("study.card.activate", {
      setId: this.set.id,
      cardId: c.id,
      force: true,
    });
    if (token !== this.nav || this.dead) return;
    if (!r.source) {
      this.status = "No original source / 无原文";
      return this.notify();
    }
    const doc = await this.rpc("document.get", { id: r.source.documentId });
    if (token !== this.nav) return;
    const read = await this.read(doc, r.source.locator, token);
    if (read && token === this.nav && !this.dead) {
      this.acceptSet(r);
      if (this.set?.cards.some((card) => card.id === r.cardId)) this.cardId = r.cardId;
      this.returnPoint = point;
      const selection = r.source.selection;
      if (
        this.content?.page === undefined &&
        Number.isInteger(selection?.start) && Number.isInteger(selection?.end) &&
        selection.start >= 0 && selection.end > selection.start && selection.end <= this.text.length
      ) {
        // Keep the cursor at the original start while the full saved range is
        // visibly selected. Core already validated the source version/locator.
        this.cursor = selection.start;
        this.anchor = selection.end;
      }
      this.focus = 1;
      this.mapMode = false;
    }
    this.notify();
  }
  async back() {
    const token = ++this.nav;
    if (this.returnPoint) {
      const point = this.returnPoint;
      if (point.set) {
        point.set = await this.rpc("study.get", { setId: point.set.id });
        if (token !== this.nav || this.dead) return;
      }
      Object.assign(this, point);
      if (point.set) this.acceptSet(point.set);
      this.readerGoal = null;
      this.returnPoint = null;
      if (this.mapMode && this.spatial) await this.spatial.refresh();
    } else if (this.review) {
      this.review = false;
      this.focus = 2;
    } else if (this.mapMode) {
      this.mapMode = false;
      this.focus = 2;
    } else {
      this.anchor = null;
      this.focus = Math.max(0, this.focus - 1);
    }
    this.notify();
  }
  async toc() {
    if (!this.doc) return;
    const r = await this.rpc("toc.list", { id: this.doc.id }),
      items = [],
      stack = [...(r.toc || [])].reverse();
    while (stack.length) {
      const n = stack.pop();
      items.push(n);
      for (const c of (n.children || []).slice().reverse()) stack.push(c);
    }
    this.choose("Document outline / 书内目录", items, (n) =>
      this.jump(n.locator),
    );
  }
  async search(query, offset = 0) {
    if (this.focus === 2) {
      this.filter = query;
      const rows = this.rows();
      this.cardId = (rows.find((r) => r.matched) || rows[0])?.card.id;
      if (this.mapMode && this.cardId)
        await this.spatial.action({ type: "select", cardId: this.cardId });
      return this.notify();
    }
    const document = this.focus === 1 ? this.doc : null;
    const token = ++this.nav,
      r = await this.rpc(
        document ? "document.search" : "library.search",
        document
          ? { id: document.id, query, limit: 1000 }
          : { query, kind: "documents", offset, limit: 100 },
      );
    if (token !== this.nav) return;
    const hits = r.matches || r.hits || [];
    this.choose(
      "Search results" +
        (r.truncated || (r.nextOffset !== null && r.nextOffset !== undefined)
          ? " — MORE results available; refine query"
          : ""),
      [
        ...(offset > 0
          ? [
              {
                title: "← Previous results",
                resultPage: Math.max(0, offset - 100),
              },
            ]
          : []),
        ...hits.map((x) => ({
          ...x,
          title: x.excerpt || x.snippet || x.title || x.path || "Match",
        })),
        ...(r.nextOffset !== null && r.nextOffset !== undefined
          ? [{ title: "Next results →", resultPage: r.nextOffset }]
          : []),
      ],
      async (hit) => {
        if (hit.resultPage !== undefined)
          return this.search(query, hit.resultPage);
        if (document && hit.locator) return this.jump(hit.locator);
        if (hit.documentId || hit.id) {
          const navigation = ++this.nav,
            d = await this.rpc("document.get", {
              id: hit.documentId || hit.id,
            });
          if (navigation !== this.nav || this.dead) return;
          await this.read(d, hit.locator || {}, navigation);
          if (navigation === this.nav && !this.dead) {
            this.focus = 1;
            this.notify();
          }
        }
      },
    );
  }
  async startReview() {
    if (!this.set) return this.chooseSet(() => this.startReview());
    const r = await this.rpc("study.review.session.get", {
      setId: this.set.id,
    });
    this.choose(
      "Review / 复习",
      [
        { title: "Resume saved session / 恢复会话", resume: true },
        { title: "Start scheduled due session / 开始到期复习", resume: false },
      ],
      async (item) => {
        if (item.resume) {
          if (!r.session) throw new Error("No saved review session");
          this.session = r.session;
          this.review = true;
          this.focus = 2;
          await this.loadReview();
        } else
          await this.mutate(
            "study.review.session.start",
            { mode: "scheduled", sort: "due" },
            async () => {
              this.review = true;
              this.focus = 2;
              await this.loadReview();
            },
          );
      },
    );
  }
  async loadReview() {
    const token = ++this.nav,
      r = await this.rpc("study.review.session.get", { setId: this.set.id });
    if (token !== this.nav || this.dead) return;
    this.session = r.session;
    this.face = null;
    this.preview = null;
    const current = this.session?.current;
    if (current) {
      const [face, preview] = await Promise.all([
        this.rpc("study.review.render", {
          setId: this.set.id,
          cardId: current.cardId,
          sessionId: this.session.id,
          ...(current.variantId ? { variantId: current.variantId } : {}),
        }),
        this.rpc("study.review.preview", {
          setId: this.set.id,
          cardId: current.cardId,
          ...(current.variantId ? { variantId: current.variantId } : {}),
        }),
      ]);
      if (token !== this.nav) return;
      this.face = face;
      this.preview = preview;
    }
    this.notify();
  }
  imageBlocked() {
    const c = this.session?.current,
      card = this.set?.cards.find((x) => x.id === c?.cardId);
    return Boolean(
      this.face?.occlusions?.length ||
        c?.occlusions?.length ||
        card?.review?.occlusions?.length ||
        card?.review?.variants?.some((v) => v.occlusions?.length) ||
        (card?.review?.generation?.rules?.imageEmphasis &&
          card?.emphasis?.images?.length),
    );
  }
  async reviewAction(action, rating) {
    if (this.pending) return;
    if (!this.session) return;
    if (action === "grade" && (this.imageBlocked() || !this.session.revealed)) {
      this.status = this.imageBlocked()
        ? "Image occlusion unsupported: grading blocked / 图片遮挡题不可评分"
        : "Reveal answer before grading / 请先揭示答案";
      return this.notify();
    }
    const cardId = this.session.current?.cardId,
      variantId = this.session.current?.variantId;
    await this.mutate(
      "study.review.session.action",
      { sessionId: this.session.id, action, ...(rating ? { rating } : {}) },
      async () => {
        if (action === "grade") {
          const c = this.set.cards.find((c) => c.id === cardId);
          this.lastDue =
            c?.review?.variants?.find((v) => v.id === variantId)?.schedule
              ?.due ||
            c?.review?.schedule?.due ||
            this.set.review?.nextDue;
        }
        this.reviewScroll = 0;
        await this.loadReview();
      },
    );
  }
  async key(str, key = {}) {
    if (this.dead) return;
    const name = key.name || str;
    if (key.ctrl && name === "c") {
      this.stop?.();
      return;
    }
    if (this.handlePaste(str, key)) return;
    if (this.modal) {
      const m = this.modal;
      if (name === "escape") {
        if (m.type === "input") this.drafts.set(m.draftKey, { ...m });
        this.modal = null;
        this.status = "Cancelled; draft retained in memory / 已取消";
        return this.notify();
      }
      if (m.type === "input") {
        if (name === "return") {
          this.drafts.set(m.draftKey, { ...m });
          this.modal = null;
          this.submitting = m.draftKey;
          try {
            await m.submit(m.value);
            this.drafts.delete(m.draftKey);
          } finally {
            this.submitting = null;
          }
          return this.notify();
        }
        if (name === "left") m.cursor = T.boundary(m.value, m.cursor, -1);
        else if (name === "right") m.cursor = T.boundary(m.value, m.cursor, 1);
        else if (name === "home" || (key.ctrl && name === "a")) m.cursor = 0;
        else if (name === "end" || (key.ctrl && name === "e"))
          m.cursor = m.value.length;
        else if (name === "backspace") {
          const before = T.boundary(m.value, m.cursor, -1);
          m.value = m.value.slice(0, before) + m.value.slice(m.cursor);
          m.cursor = before;
        } else if (name === "delete")
          m.value =
            m.value.slice(0, m.cursor) +
            m.value.slice(T.boundary(m.value, m.cursor, 1));
        else if (key.ctrl && name === "u") {
          m.value = "";
          m.cursor = 0;
        } else if ((key.ctrl && name === "j") || name === "enter") {
          m.value = m.value.slice(0, m.cursor) + "\n" + m.value.slice(m.cursor);
          m.cursor++;
        } else if (
          str &&
          !key.ctrl &&
          !key.meta &&
          !["tab", "up", "down", "pageup", "pagedown"].includes(name) &&
          !str.includes("\x1b")
        ) {
          const value = T.safe(str).replace(/[\r\n]/g, "");
          m.value =
            m.value.slice(0, m.cursor) + value + m.value.slice(m.cursor);
          m.cursor += value.length;
        }
        return this.notify();
      }
      if (m.type === "choice") {
        if (name === "up" || str === "k") m.index = Math.max(0, m.index - 1);
        else if (name === "down" || str === "j")
          m.index = Math.min(m.items.length - 1, m.index + 1);
        else if (name === "return" && m.items[m.index]) {
          this.modal = null;
          await m.submit(m.items[m.index]);
        }
        return this.notify();
      }
      if (
        ["help", "conflict", "capture", "capture-confirm"].includes(m.type) &&
        (["up", "down", "pageup", "pagedown"].includes(name) ||
          str === "j" ||
          str === "k")
      ) {
        const delta =
          name === "up" || str === "k"
            ? -1
            : name === "pageup"
              ? -8
              : name === "pagedown"
                ? 8
                : 1;
        m.scroll = Math.max(
          0,
          Math.min((m.lineCount || 30) - 1, (m.scroll || 0) + delta),
        );
        return this.notify();
      }
      if (m.type === "conflict") {
        if (str === "r") await this.refreshConflict();
        else if (name === "return") await this.retryConflict();
        else if (str === "d") {
          this.modal = null;
          this.intent = null;
        }
        return this.notify();
      }
      if (m.type === "capture" || m.type === "capture-confirm") {
        if (str === "n") this.captureOption("note");
        else if (str === "t") this.captureOption("tags");
        else if (str === "s") this.captureOption("style");
        else if (name === "return") {
          if (m.type === "capture") await this.captureTarget();
          else await this.commitCapture();
        }
      }
      else if (m.type === "help" && name === "return") this.modal = null;
      return this.notify();
    }
    if (str === "q") {
      if (this.drafts.size || this.intent || this.captureDraft) {
        this.choose(
          "Unsaved drafts: exit and discard? / 退出会丢失内存草稿",
          [
            { title: "Keep working / 继续", exit: false },
            { title: "Discard drafts and exit / 放弃并退出", exit: true },
          ],
          (item) => {
            if (item.exit) this.stop?.();
          },
        );
        return;
      }
      this.stop?.();
      return;
    }
    if (name === "escape") return this.back();
    if (str === "!") return this.recover();
    if (str === "?") {
      this.modal = {
        type: "help",
        title: "Context help / 快捷键 · ↑/↓ scroll",
      };
      return this.notify();
    }
    if (name === "tab") {
      ++this.nav;
      const fullscreen = this.mapMode || this.review,
        current = fullscreen ? 2 : this.focus;
      this.mapMode = false;
      this.review = false;
      this.focus = (current + (key.shift ? 2 : 1)) % 3;
      if (fullscreen) this.status = "Returned to panes / 已返回分栏";
      return this.notify();
    }
    if (str === "/") {
      this.prompt(
        this.focus === 2
          ? "Search all cards / 全模型搜索"
          : "Search text / 全文搜索",
        "",
        (q) => this.search(q),
      );
      return;
    }
    if (str === "f") {
      if (this.mapMode) await this.spatial.refresh();
      else if (this.set) await this.loadSet(this.set.id);
      else await this.loadFolder(this.folder);
      return;
    }
    if (str === "S") return this.chooseSet();
    if (str === "R") return this.startReview();
    if (str === "u" || str === "U") {
      await this.mutate(
        str === "u" ? "study.undo" : "study.redo",
        {},
        async () => {
          if (this.review) await this.loadReview();
          else if (this.mapMode) await this.spatial.refresh();
        },
      );
      return;
    }
    if (str === "g" && !this.review) {
      if (this.mapMode) {
        this.mapMode = false;
        return this.notify();
      }
      this.spatial ||= new (require("./spatial.cjs").SpatialAdapter)(this);
      return this.spatial.open();
    }
    if (this.review) {
      if (name === "down" || str === "j") {
        this.reviewScroll++;
        return this.notify();
      }
      if (name === "up" || str === "k") {
        this.reviewScroll = Math.max(0, this.reviewScroll - 1);
        return this.notify();
      }
      if (name === "pagedown" || name === "pageup") {
        this.reviewScroll = Math.max(
          0,
          this.reviewScroll + (name === "pagedown" ? 10 : -10),
        );
        return this.notify();
      }
      if (str === " ") await this.reviewAction("reveal");
      else if (/^[1-4]$/.test(str))
        await this.reviewAction(
          "grade",
          ["again", "hard", "good", "easy"][Number(str) - 1],
        );
      else if (name === "right") await this.reviewAction("next");
      else if (name === "left") await this.reviewAction("previous");
      return;
    }
    if (this.mapMode) {
      const direction = ["up", "down", "left", "right"].includes(name)
        ? name
        : str === "j"
          ? "down"
          : str === "k"
            ? "up"
            : null;
      if (direction) {
        if (key.shift)
          return this.spatial.action({
            type: "pan",
            dx: direction === "left" ? -4 : direction === "right" ? 4 : 0,
            dy: direction === "up" ? -2 : direction === "down" ? 2 : 0,
          });
        return this.spatial.action({ type: "navigate", direction });
      }
      if (["H", "J", "K", "L"].includes(str))
        return this.spatial.action({
          type: "pan",
          dx: str === "H" ? -4 : str === "L" ? 4 : 0,
          dy: str === "K" ? -2 : str === "J" ? 2 : 0,
        });
      if (str === "+" || str === "=")
        return this.spatial.action({ type: "zoom", factor: 1.25 });
      if (str === "-")
        return this.spatial.action({ type: "zoom", factor: 0.8 });
      if (str === "0") return this.spatial.action({ type: "fit" });
      if (str === ".") return this.spatial.action({ type: "center-selection" });
      if (name === "return") {
        this.mapMode = false;
        this.focus = 2;
        this.status = "Selected card in outline / 已返回选中卡片的大纲";
        return this.notify();
      }
    }
    const down = name === "down" || str === "j",
      up = name === "up" || str === "k";
    if (
      down ||
      up ||
      ["left", "right", "home", "end", "pageup", "pagedown"].includes(name) ||
      str === "v" ||
      str === "c"
    )
      ++this.nav;
    if (this.focus === 0) {
      if (down)
        this.fileIndex = Math.min(this.files.length - 1, this.fileIndex + 1);
      if (up) this.fileIndex = Math.max(0, this.fileIndex - 1);
      if (name === "return" && this.files[this.fileIndex])
        await this.openFile(this.files[this.fileIndex]);
      if (name === "backspace" && this.folder !== ".")
        await this.loadFolder(
          this.folder.includes("/")
            ? this.folder.slice(0, this.folder.lastIndexOf("/"))
            : ".",
        );
    } else if (this.focus === 1) {
      if (key.shift && ["left", "right", "up", "down", "home", "end", "pageup", "pagedown"].includes(name) && this.anchor === null)
        this.anchor = this.cursor;
      if (str === "v") this.anchor = this.anchor === null ? this.cursor : null;
      else if (str === "c") this.capture();
      else if (str === "t") await this.toc();
      else if (str === "[") await this.turn(-1);
      else if (str === "]") await this.turn(1);
      else if (name === "left" || name === "right") {
        this.cursor = this.readerLayout().boundary(this.cursor, name === "right" ? 1 : -1);
        this.readerGoal = null;
      } else if (down || up) this.moveReaderRows(down ? 1 : -1);
      else if (name === "home" || name === "end") {
        this.cursor = name === "home" ? 0 : this.text.length;
        this.readerGoal = null;
      } else if (name === "pagedown" || name === "pageup")
        this.moveReaderRows((name === "pagedown" ? 1 : -1) * (this.readHeight || 15));
    } else {
      const rows = this.rows(),
        i = Math.max(
          0,
          rows.findIndex((r) => r.card.id === this.cardId),
        ),
        c = this.currentCard();
      if (down || up)
        this.cardId =
          rows[
            Math.max(0, Math.min(rows.length - 1, i + (down ? 1 : -1)))
          ]?.card.id;
      else if ((name === "return" || name === "left" || name === "right") && c)
        await this.mutate("study.card.update", {
          cardId: c.id,
          collapsed:
            name === "left" ? true : name === "right" ? false : !c.collapsed,
        });
      else if (str === "e" || str === " ") await this.edit("title");
      else if (str === "n") await this.edit("note");
      else if (str === "m") this.move();
      else if (str === "o") await this.source();
      else if (str === "a" && c)
        await this.mutate("study.review.configure", {
          cardId: c.id,
          enabled: true,
          frontMode: "title",
          backMode: "card",
        });
      else if (str === "N")
        this.prompt("New note title", "", (title) =>
          this.mutate("study.note.create", { title }),
        );
    }
    this.notify();
  }
}
module.exports = { Workspace };
