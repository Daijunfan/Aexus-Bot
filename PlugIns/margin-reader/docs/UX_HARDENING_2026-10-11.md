# Margin Reader 0.9.8 — Existing UX/Performance Hardening

Date: 2026-10-11. Scope: narrow improvements to existing product surfaces only.
Authoritative project: /Users/djf/develop/CS/Toolbox/MarginReader.

## Previous audit: six confirmed blockers

1. Escape cancels the color selection and clears text ranges; selection-change timers cannot reopen the stale palette.
2. Clearing native text selection immediately invalidates the palette and its pending capture.
3. Focused buttons, menu items and sliders own Space/arrow keys, preventing PDF page shortcuts from hijacking color choices.
4. TOC divider owns outlineWidth; StudySplit alone owns studyRatio.
5. Explicit 'reselect/rebind excerpt' now invokes the existing study.excerpt.revise API to retain card ID, notes, links and undo.
6. Markdown 'visible' export uses the same layout visibility as on-screen collapsed/focused mind maps.

## Existing features polished

- Split reader: at 780×530, study bar collapsed from 66px into one 38px row. Content viewport measured approximately 292.5px tall versus 236.5px in the prior audit. Reading controls horizontally scroll within their own rows, without hiding commands.
- Mindmap: existing menu, detail, collapse and resize handles keep a trackpad-friendly screen-space hit target across zoom states. Forty existing overflow actions can be searched inside the same menu.
- Export: irrelevant PDF fields are hidden and disabled for Markdown; user-supplied filename stems are preserved across format switches.
- Study picker: 96-card lazy batches instead of mounting hundreds of selectable cards together; existing checkbox selections survive search/scroll, with the preview queue preserved across growing batches.
- Study navigation: 'back to study' actually returns to study home even when split view remembers the previously open document.
- Document tabs: unchanged refreshes keep button DOM and keyboard focus.

## Completed isolated regression checks

- Original six reported scenarios exercised by the prior WebKit probe and followup test, confirmed in the candidate build.
- WebKit and Chromium each pass five hardening scenarios (narrow reader, 320 files, menu filter, zoomed node targets, export fields).
- WebKit and Chromium each pass four excerpt scenarios (study PDF, HTML, EPUB, standalone PDF).
- Five reader continuity scenarios pass (TOC left/right, touchpad-style zoom, thumbnails, Markdown file export and copy).
- Full node:test core suite: 410 passing, zero failing.
- Sidebar scenario suite passes. Some legacy host/mindmap artifact suites are environment-dependent and can still fail due to missing standalone Toolbox host bin/agents or historic test-pointer files; record these independently.

## Synthetic performance sample (not comparable to real-book/trackpad performance)

- 100-node map ready: 117.98ms.
- 1000-node map ready: 144.73ms, one 53ms initial long task; overview mounts 1 topic representing 1000.
- Synthetic 300-page PDF parse: 385.80ms; first ready: 244.07ms; last-page navigation: 88.66ms; 2 canvases mounted.
- Simulated pan-frame p95 remains noisy (~75ms / ~87ms), including significant headless scheduler jitter. This is not a 60Hz or 120Hz hardware guarantee.

## Not yet proved

- Complete feature-for-feature MarginNote 4 equivalence and pixel-perfect matching.
- Physical Mac trackpad/stylus feel, large image-heavy PDF books, multi-hour memory residency, crash injection and production-workspace endurance.
- Full end-to-end host legacy suites until their checkout-specific fixtures/host dependencies are restored.

No real user-workspace files or originals were touched by isolated testing. All edits are scoped to MarginReader.
