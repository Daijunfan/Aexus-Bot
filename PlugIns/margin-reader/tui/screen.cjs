"use strict";
const T = require("./text.cjs");
function sliceAround(rows, index, height) {
  const start = Math.max(
    0,
    Math.min(Math.max(0, rows.length - height), index - Math.floor(height / 2)),
  );
  return rows.slice(start, start + height);
}
function frame(title, lines, w, h, width) {
  return [
    T.clip("┌ " + title + " " + "─".repeat(w), w, width),
    ...Array.from(
      { length: h - 2 },
      (_, i) => "│" + T.clip(lines[i] || "", w - 2, width) + "│",
    ),
    T.clip("└" + "─".repeat(w - 2) + "┘", w, width),
  ];
}
function render(w, columns, rows) {
  const width = w.width,
    cols = Math.max(1, columns),
    height = Math.max(1, rows);
  if (cols < 38 || height < 10)
    return Array.from({ length: height }, (_, i) =>
      T.clip(
        [
          "MarginReader — terminal too small",
          "Resize to at least 38 × 10",
          "q / Ctrl-C exit",
        ][i] || "",
        cols,
        width,
      ),
    ).join("\r\n");
  const bodyHeight = height - 4,
    wide = cols >= 110,
    medium = cols >= 76;
  const sizes = wide
    ? [Math.floor(cols * 0.2), Math.floor(cols * 0.47)]
    : medium
      ? [Math.floor(cols * 0.42)]
      : [];
  if (wide) sizes.push(cols - sizes[0] - sizes[1]);
  else if (medium) sizes.push(cols - sizes[0]);
  else sizes.push(cols);
  const focused = wide
    ? [0, 1, 2]
    : medium
      ? w.focus === 0
        ? [0, 1]
        : [1, 2]
      : [w.focus];
  const panes = focused.map((id, i) => {
    const pw = sizes[i],
      inner = pw - 2;
    let title = "",
      lines = [];
    if (id === 0) {
      title = (w.focus === 0 ? "▶ " : "") + "LIBRARY 文库";
      lines = [
        w.folder + "  Backspace ↑",
        ...sliceAround(
          w.files.map(
            (f, j) =>
              (j === w.fileIndex ? "> " : "  ") +
              (f.kind === "folder" ? "▸ " : "  ") +
              (f.title || f.name),
          ),
          w.fileIndex,
          bodyHeight - 3,
        ),
      ];
    }
    if (id === 1) {
      title = (w.focus === 1 ? "▶ " : "") + "READ 阅读";
      w.readWidth = Math.max(1, inner - 6);
      w.readHeight = bodyHeight - 4;
      const layout = w.readerLayout(w.readWidth),
        wrapped = layout.lines,
        line = layout.lineAt(w.cursor),
        selection = w.selection();
      lines = [
        (w.doc?.title || "Open a document") +
          " " +
          (w.content?.page !== undefined
            ? "p." + w.content.page
            : "§" + ((w.content?.section || 0) + 1)),
        ...(w.doc?.format === "pdf"
          ? ["PDF text + page source (no pixel regions)"]
          : []),
        ...sliceAround(wrapped, line, bodyHeight - 5).map((l) => {
          let text = "";
          for (const g of T.graphemes(w.text.slice(l.start, l.end))) {
            const at = l.start + g.start;
            if (selection && at === selection.start) text += "‹";
            if (at === w.cursor) text += "▏";
            text += T.safe(g.text).replace(/\t/g, "    ");
            if (selection && l.start + g.end === selection.end) text += "›";
          }
          if (w.cursor === l.end && l === wrapped[line]) text += "▏";
          return (
            (l === wrapped[line] ? ">" : " ") +
            (selection && selection.end > l.start && selection.start < l.end
              ? "▌"
              : " ") +
            text
          );
        }),
        "UTF16 " +
          w.cursor +
          (selection
            ? "  SELECT " + selection.start + "…" + selection.end +
              " (" + (selection.end - selection.start) + "/12000)"
            : ""),
      ];
    }
    if (id === 2) {
      title = (w.focus === 2 ? "▶ " : "") + "KNOWLEDGE 知识";
      const all = w.rows(),
        index = Math.max(
          0,
          all.findIndex((r) => r.card.id === w.cardId),
        ),
        card = w.currentCard(),
        listHeight = Math.max(2, Math.floor((bodyHeight - 4) * 0.58));
      lines = [
        (w.set?.title || "S select/create study") +
          " r" +
          (w.set?.revision || "—") +
          " · " +
          (w.set?.cards.length || 0) +
          " cards",
        ...sliceAround(all, index, listHeight).map(
          (r) =>
            (r.card.id === w.cardId ? "> " : "  ") +
            " ".repeat(Math.min(14, r.depth) * 2) +
            (r.children ? (r.card.collapsed ? "▸ " : "▾ ") : "· ") +
            (r.context ? "[path] " : r.matched ? "[match] " : "") +
            r.card.title,
        ),
        "─ CONTEXT 上下文 ─",
        ...T.wrap(
          card
            ? [
                card.title,
                card.editedText ?? card.text,
                card.note,
                card.source ? "o → original source" : "Independent note",
              ]
                .filter(Boolean)
                .join("\n")
            : "No card selected",
          inner,
          width,
        ).map((l) => l.text),
      ];
    }
    return frame(title, lines, pw, bodyHeight, width);
  });
  let screen = Array.from({ length: bodyHeight }, (_, i) =>
    panes.map((p) => p[i]).join(""),
  );
  if (w.mapMode && w.spatial?.scene) {
    const map = w.spatial.frame(
      Math.max(1, cols - 2),
      Math.max(1, bodyHeight - 4),
    );
    const selected = w.currentCard();
    screen = frame(
      "SPACE 空间脑图",
      [
        selected ? "SELECT " + selected.title : "No selection",
        ...map.lines,
        "VISIBLE " +
          map.stats.visibleCards +
          "/" +
          map.stats.totalCards +
          " · zoom " +
          w.spatial.state.zoom.toFixed(2) +
          " · " +
          map.warnings.length +
          " warnings",
      ],
      cols,
      bodyHeight,
      width,
    );
  }
  if (w.review) {
    const s = w.session,
      c = s?.current,
      face = w.face,
      lines = [
        "FSRS REVIEW / 复习 · " +
          (s?.completed || 0) +
          " / " +
          (s?.total || 0) +
          " · " +
          (s?.mode || "scheduled"),
        "Space reveal · 1 Again 2 Hard 3 Good 4 Easy · ←/→ previous/next · Esc return",
        ...(w.imageBlocked()
          ? ["IMAGE OCCLUSION: unsupported in text terminal — GRADING BLOCKED"]
          : []),
        "QUESTION",
        ...T.wrap(
          c?.front || "Session complete / 本次完成",
          cols - 4,
          width,
        ).map((l) => l.text),
        ...(s?.revealed
          ? [
              "ANSWER",
              ...T.wrap(face?.back?.text || c?.back || "", cols - 4, width).map(
                (l) => l.text,
              ),
            ]
          : ["[Answer hidden / 答案未揭示]"]),
        "LAST GRADED DUE / 已评分下次到期: " + (w.lastDue || "—"),
        "NEXT DUE / 下次到期",
        ...Object.entries(w.preview || {}).map(
          ([k, v]) =>
            k + ": " + (typeof v === "object" ? JSON.stringify(v) : v),
        ),
      ];
    const header = lines.slice(0, 2);
    const content = lines.slice(2);
    w.reviewScroll = Math.min(
      w.reviewScroll,
      Math.max(0, content.length - (bodyHeight - 4)),
    );
    screen = frame(
      "REVIEW",
      header.concat(content.slice(w.reviewScroll)),
      cols,
      bodyHeight,
      width,
    );
  }
  if (w.modal) {
    const m = w.modal;
    let lines = [];
    if (m.type === "input") {
      const wrapped = T.wrap(
          m.value.slice(0, m.cursor) + "▏" + m.value.slice(m.cursor),
          cols - 6,
          width,
        ),
        cursorLine = Math.max(
          0,
          wrapped.findLastIndex((l) => l.start <= m.cursor),
        );
      lines = [
        m.title,
        "Text input: Enter save · Ctrl-J newline · Esc cancel",
        ...sliceAround(wrapped, cursorLine, Math.max(1, bodyHeight - 4)).map(
          (l) => l.text,
        ),
      ];
    } else if (m.type === "choice")
      lines = [
        m.title,
        "↑/↓ j/k choose · Enter confirm · Esc cancel",
        ...sliceAround(
          m.items.map(
            (item, i) =>
              (i === m.index ? "> " : "  ") +
              (item.title || item.name || item.id),
          ),
          m.index,
          bodyHeight - 5,
        ),
      ];
    else if (m.type === "capture" || m.type === "capture-confirm") {
      const d = w.captureDraft || {};
      lines = [
        m.title,
        m.type === "capture"
          ? "n note · t tags · s style · Enter choose study"
          : "Target: " + w.set?.title + " · n note · t tags · s style · Enter save",
        "Style: " + (d.annotationStyle || "study preset") +
          " · Tags: " + (d.tags?.join(", ") || "(none)"),
        "Note: " + (d.note || "(none)"),
        d.pdf
          ? "PDF text excerpt, page locator only"
          : "Exact original UTF-16 selection " + d.start + "…" + d.end,
        ...T.wrap(d.text || "", cols - 6, width).map((l) => l.text),
        "Esc keep draft; ! recover from the workspace",
      ];
    }
    else if (m.type === "conflict")
      lines = [
        m.title,
        "r refresh · Enter explicit retry after refresh · d discard intent · Esc keep draft",
        "Original revision: " +
          w.intent?.params.expectedRevision +
          " · current: " +
          w.set?.revision,
        "METHOD " + w.intent?.method,
        ...(m.candidates
          ? ["Matching studies: " + JSON.stringify(m.candidates)]
          : []),
        "DRAFT " +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(w.intent?.params || {}).filter(
                ([key]) =>
                  !["setId", "cardId", "expectedRevision"].includes(key),
              ),
            ),
          ),
        "CURRENT " +
          (w.review
            ? JSON.stringify({
                revision: w.set?.revision,
                sessionId: w.session?.id,
                revealed: w.session?.revealed,
                currentKey: w.session?.current?.key,
              })
            : JSON.stringify(
                Object.fromEntries(
                  Object.keys(w.intent?.params || {})
                    .filter((key) => key in (w.currentCard() || {}))
                    .map((key) => [key, w.currentCard()[key]]),
                ),
              )),
        m.blocked
          ? "Replay disabled: inspect state, d discard intent."
          : "No automatic stale-write retry.",
      ];
    else
      lines = [
        "NAVIGATION: ↑/↓ or j/k · Tab/Shift-Tab pane · Enter open/collapse · Esc back · q quit",
        "LIBRARY: Backspace parent · / search · S select/create study",
        "READ: ←/→ grapheme · ↑/↓ screen line · Home/End · PgUp/PgDn · [/] page/section",
        "READ: t contents · v anchor or Shift+arrows select · c excerpt (max 12000 UTF-16 units)",
        "EXCERPT: n inline note · t tags · s annotation style · Enter choose study/save",
        "KNOWLEDGE: / search ALL cards (including collapsed) · e/Space title · n note · m move subtree",
        "KNOWLEDGE: o source (Esc returns focus) · a enable review · N new note",
        "SPACE: g toggle · arrows select · HJKL/Shift-arrows pan · +/- zoom · 0 fit · . center",
        "SPACE: Enter outline · / full-model search · o source · hidden = reveal-required",
        "STUDY: R review resume/start · u undo · U redo · f explicit refresh · g spatial map",
        "REVIEW: Space reveal groups · 1/2/3/4 grade after full reveal · ←/→ navigate",
        "FULLSCREEN: Tab/Shift-Tab returns to panes; camera and review session are retained.",
        "Conflict: r refresh then Enter explicit retry. Never auto-overwrite.",
        "Text prompts: navigation shortcuts are ordinary text; Ctrl-J inserts newline.",
        "Paste: bracketed multiline text stays in the draft; Enter explicitly saves.",
        "! recover input/excerpt/failed operation · Esc retains draft · q confirms discard · Ctrl-C exits.",
        "PDF: text/page only. Image occlusion questions cannot be graded.",
        "Enter/Esc close help",
      ];
    if (!["input", "choice"].includes(m.type)) {
      lines = lines.flatMap((line) =>
        T.wrap(line, cols - 4, width).map((l) => l.text),
      );
      m.lineCount = lines.length;
      lines = lines.slice(m.scroll || 0);
    }
    screen = frame(m.title || "HELP", lines, cols, bodyHeight, width);
  }
  return [
    T.clip("MarginReader  TERMINAL WORKSPACE / 学习工作台", cols, width),
    ...screen,
    T.clip((w.pending ? "[PENDING] " : "") + w.status, cols, width),
    T.clip(
      "Tab panes · v select · c excerpt · S study · R review · ? help · q exit",
      cols,
      width,
    ),
    T.clip(
      "Focus " +
        ["Library 文库", "Read 阅读", "Knowledge 知识"][w.focus] +
        " · " +
        (w.captureDraft ? "excerpt draft retained (! recover) · " : "") +
        (w.intent ? "unsaved intent retained (! recover)" : ""),
      cols,
      width,
    ),
  ]
    .slice(0, height)
    .join("\r\n");
}
module.exports = { render };
