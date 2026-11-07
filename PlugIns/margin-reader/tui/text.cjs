"use strict";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Never let source content emit terminal escape sequences or bidi controls.
// Keep one replacement per UTF-16 code unit, preserving source offsets.
function safe(s) {
  return String(s ?? "").replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    "�",
  );
}
function graphemes(s) {
  const result = [];
  for (const g of segmenter.segment(String(s)))
    result.push({ text: g.segment, start: g.index, end: g.index + g.segment.length });
  return result;
}
function sourceText(content) {
  if (content.page !== undefined) return content.text || "";
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(content.html || "");
  try {
    return dom.window.document.body.textContent || "";
  } finally {
    dom.window.close();
  }
}
function displayWidth(text, width, measured) {
  if (measured?.has(text)) return measured.get(text);
  const cells = width(text);
  // One active layout owns this small cache; arbitrary document text must not
  // accumulate in a process-wide or unbounded glyph cache.
  if (measured && measured.size < 512 && text.length <= 64) measured.set(text, cells);
  return cells;
}
function wrapSegments(text, columns, width, segments, measured) {
  columns = Math.max(1, columns);
  const lines = [];
  let start = 0,
    end = 0,
    line = "",
    cells = 0;
  for (const g of segments) {
    if (g.segment === "\n" || g.segment === "\r\n") {
      lines.push({ text: line, start, end: g.index });
      start = g.index + g.segment.length;
      end = start;
      line = "";
      cells = 0;
      continue;
    }
    const display = safe(g.segment).replace(/\t/g, "    "),
      w = displayWidth(display, width, measured);
    if (cells + w > columns && line) {
      lines.push({ text: line, start, end });
      line = "";
      cells = 0;
      start = g.index;
    }
    line += display;
    cells += w;
    end = g.index + g.segment.length;
  }
  lines.push({ text: line, start, end });
  return lines;
}
function wrap(text, columns, width) {
  text = String(text ?? "");
  return wrapSegments(text, columns, width, segmenter.segment(text), new Map());
}
function clip(s, n, width) {
  let out = "",
    w = 0;
  for (const g of graphemes(safe(s))) {
    const v = g.text.replace(/[\r\n\t]/g, " "),
      k = width(v);
    if (w + k > n) break;
    out += v;
    w += k;
  }
  return out + " ".repeat(Math.max(0, n - w));
}
function boundary(text, offset, delta) {
  return segmentBoundary(segmenter.segment(text), text.length, offset, delta);
}
function segmentBoundary(segments, length, offset, delta) {
  if (delta > 0) {
    if (offset >= length) return length;
    const g = segments.containing(Math.max(0, offset));
    return g ? g.index + g.segment.length : length;
  }
  return offset <= 0 ? 0 : segments.containing(Math.min(length, offset) - 1)?.index ?? 0;
}
// A Workspace retains only its current chapter, one wrap width and one measurer.
// Intl.Segments supplies random-access boundaries without materializing a second
// whole-chapter array of grapheme objects on every keypress.
class TextLayout {
  constructor() {
    this.text = null;
    this.columns = null;
    this.width = null;
    this.segments = null;
    this.lines = [];
    this.measured = new Map();
    this.generation = 0;
  }
  get(text, columns, width) {
    text = String(text ?? "");
    columns = Math.max(1, columns);
    if (this.text !== text || this.width !== width) {
      this.text = text;
      this.width = width;
      this.segments = segmenter.segment(text);
      this.columns = null;
      this.lines = [];
      this.measured.clear();
    }
    if (this.columns !== columns) {
      this.lines = wrapSegments(text, columns, width, this.segments, this.measured);
      this.columns = columns;
      this.generation++;
    }
    return this;
  }
  lineAt(offset) {
    let low = 0, high = this.lines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.lines[middle].start <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }
  boundary(offset, delta) {
    return segmentBoundary(this.segments, this.text.length, offset, delta);
  }
  columnAt(offset, index = this.lineAt(offset)) {
    const row = this.lines[index];
    let at = row.start, cells = 0;
    const limit = Math.min(offset, row.end);
    while (at < limit) {
      const g = this.segments.containing(at), end = g.index + g.segment.length;
      if (end > limit) break;
      cells += displayWidth(safe(g.segment).replace(/\t/g, "    "), this.width, this.measured);
      at = end;
    }
    return cells;
  }
  offsetAtColumn(index, column) {
    const row = this.lines[index];
    let at = row.start, previous = at, cells = 0;
    while (at < row.end) {
      const g = this.segments.containing(at),
        size = displayWidth(safe(g.segment).replace(/\t/g, "    "), this.width, this.measured);
      if (cells + size > column) break;
      previous = at;
      at = g.index + g.segment.length;
      cells += size;
    }
    // A soft-wrap end is the next row's start. Keep vertical movement on the
    // requested row instead of accidentally jumping over it.
    if (at === row.end && at > row.start && this.lines[index + 1]?.start === at)
      return previous;
    return at;
  }
}
function outline(cards, localCollapsed = new Set(), query = "") {
  const byParent = new Map(),
    all = new Map(cards.map((c) => [c.id, c])),
    matched = new Set(),
    keep = new Set(),
    q = query.toLocaleLowerCase();
  for (const c of cards) {
    const p = all.has(c.parentId) ? c.parentId : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
    if (
      q &&
      [c.title, c.editedText ?? c.text, c.note, ...(c.tags || [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q)
    )
      matched.add(c.id);
  }
  if (q)
    for (const id of matched) {
      let c = all.get(id);
      while (c && !keep.has(c.id)) {
        keep.add(c.id);
        c = all.get(c.parentId);
      }
    }
  const rows = [],
    seen = new Set(),
    stack = (byParent.get(null) || [])
      .slice()
      .reverse()
      .map((card) => ({ card, depth: 0 }));
  while (stack.length) {
    const { card, depth } = stack.pop();
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    if (q && !keep.has(card.id)) continue;
    rows.push({
      card,
      depth,
      children: (byParent.get(card.id) || []).length,
      matched: matched.has(card.id),
      context: Boolean(q && !matched.has(card.id)),
    });
    if (q || (!card.collapsed && !localCollapsed.has(card.id)))
      for (const child of (byParent.get(card.id) || []).slice().reverse())
        stack.push({ card: child, depth: depth + 1 });
  }
  return rows;
}
module.exports = { safe, graphemes, sourceText, wrap, clip, boundary, outline, TextLayout };
