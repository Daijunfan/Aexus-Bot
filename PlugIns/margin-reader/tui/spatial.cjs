"use strict";
const T = require("./text.cjs");
// Presentation only. Public requests stay on the Workspace client boundary.
class SpatialAdapter {
  constructor(app) {
    this.app = app;
    this.visual = null;
    this.scene = null;
    this.state = null;
    this.viewport = { columns: 100, rows: 24 };
    this.effects = [];
  }
  async refresh({ fit = false } = {}) {
    const a = this.app,
      token = ++a.nav,
      study = await a.rpc("study.get", { setId: a.set.id });
    if (token !== a.nav || a.dead) return false;
    const geometry = await a.rpc("study.map.geometry", { setId: study.id });
    if (token !== a.nav || a.dead) return false;
    if (!this.visual) {
      const {
        createTerminalVisuals,
      } = require("../terminal-visuals/index.cjs");
      this.visual = await createTerminalVisuals({
        measure: a.width,
        segment: (s) => T.graphemes(T.safe(s)).map((g) => g.text),
      });
    }
    if (token !== a.nav || a.dead) return false;
    const scene = this.visual.prepare({ study, geometry });
    const old = this.scene?.study.id === study.id ? this.state : null;
    this.scene = scene;
    a.acceptSet(study);
    a.geometry = geometry;
    this.state = this.visual.initialState(
      old ? { ...old, selectedId: a.cardId } : { selectedId: a.cardId },
    );
    if (fit || !old)
      this.state = this.visual.reduce(
        scene,
        this.state,
        { type: "fit" },
        this.viewport,
      ).state;
    if (a.cardId && (!old || old.selectedId !== a.cardId))
      this.state = this.visual.reduce(
        scene,
        this.state,
        { type: "select", cardId: a.cardId },
        this.viewport,
      ).state;
    return true;
  }
  async open() {
    if (!this.app.set) return this.app.chooseSet(() => this.open());
    if (await this.refresh()) {
      this.app.mapMode = true;
      this.app.focus = 2;
      this.app.status =
        "SPACE: arrows select · HJKL pan · +/- zoom · 0 fit · o source · Esc outline";
      this.app.notify();
    }
  }
  async action(action) {
    ++this.app.nav;
    const r = this.visual.reduce(this.scene, this.state, action, this.viewport);
    this.state = r.state;
    this.effects = r.effects || [];
    this.app.cardId = this.state.selectedId;
    const hidden = this.effects.find((e) => e.type === "reveal-required");
    if (hidden) {
      this.app.mapRevealId = hidden.cardId;
      this.app.status =
        "reveal-required: selected node has no view geometry; Esc returns to outline";
    } else {
      this.app.mapRevealId = null;
      this.app.status =
        "SPACE: arrows select · HJKL pan · +/- zoom · 0 fit · o source · Esc outline";
    }
    this.app.notify();
  }
  frame(columns, rows) {
    const resized =
      this.viewport.columns !== columns || this.viewport.rows !== rows;
    this.viewport = { columns, rows };
    if (resized)
      this.state = this.visual.reduce(
        this.scene,
        this.state,
        { type: "resize" },
        this.viewport,
      ).state;
    return this.visual.render(this.scene, this.state, {
      columns,
      rows,
      color: "none",
      glyphs: "unicode",
    });
  }
}
module.exports = { SpatialAdapter };
