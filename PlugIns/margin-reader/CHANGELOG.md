# Changelog

## Unreleased — standalone CLI/TUI delivery (0.9.4 contract retained)

- Independent npm package metadata, curated files and existing margin-reader bin.
- CLI discovery, typed command options and terminal workspace use the public runtime.
- Release preparation in a temporary source copy; generated browser assets support optional serve.
- Actual npm pack, file hashes, clean consumer install and inherited OS network-denial workflow checks.
- README separates present product, retired GUI, platform limits and historical evidence.

### Reading and terminal interaction refinement — 2026-10-18

- Reuse a bounded layout for the current chapter; invalidate it when source text, terminal columns or the width measurer changes. Reader navigation no longer segments and wraps the entire chapter for every key and paint.
- Preserve the desired visual column across vertical/page navigation, short lines, CJK, combining marks and emoji. Keep source UTF-16 positions through resize and retain the existing Home/End semantics.
- Highlight the complete saved flow quote when following a source. Select the actual resolved card across studies, commit the new UI context only after a successful current read, and restore the originating reader, study and camera on Esc.
- Make Tab/Shift-Tab leave full-screen map/review before focusing a visible pane. Retain camera, source selection, drafts and saved review state without a request or grade; enter review with knowledge focus. Add Space as an alias for the existing card-title editor while retaining literal spaces in text inputs and answer reveal in review.
- Treat bracketed multiline paste as one draft edit. Normalize CRLF, retain Unicode, prevent pasted shortcuts or return characters from submitting actions, restore terminal paste mode on exit, and accept physical Ctrl-J as a text-input newline.
- Reject noninteractive TUI startup with exit status 1 and `TTY_REQUIRED` before Core initialization. Add `tui --help`, `--help tui` and `help tui` to the existing discovery path, with no workspace or terminal-mode requirement.
- Extend regressions for layout reuse, visual columns, source success/failure/stale results, draft identity, paste limits and non-TTY startup. Extend the actual OS PTY learning workflow with Chinese/emoji paste and exact persisted multiline text.

On Apple M5 Pro, macOS arm64, Node 26.5.0, the same synthetic 132 × 36 presentation harness measured warm key-plus-frame p50 from 297.022 to 1.678 ms for 270,000 UTF-16 units of English and from 209.396 to 1.038 ms for 252,000 units of mixed Unicode (24 samples each). Revised cold-layout p50 was 28.904 and 19.779 ms respectively (3 samples each). Raw reports: `artifacts/cli-polish-20261018/tui-baseline.json` and `tui-after.json`. The scope excludes Core, document parsing, PDF images and actual terminal I/O; full p50/p95 figures and reproduction commands are in `docs/TERMINAL_WORKSPACE.md`.

The reader/paste/source refinement passed 64 targeted CLI/TUI source tests before the later help/focus changes. The TUI-help/non-TTY guard file then passed 4/4, including both added help tests. After the full-screen focus/Space changes, the spatial/workflow suites passed 18/18 with no failures or skips in 4.239 seconds on the same Mac. These overlapping subsets are not summed or presented as a complete final-source test count.

The final actual OS PTY workflow physically exercised Space title editing, Tab/Shift-Tab out of maps and reviews, resume, Chinese/emoji paste and Ctrl-J. The workflow, normal quit, Ctrl-C, SIGINT, SIGTERM, runtime exception and initialization failure all exited naturally with terminal state restored; reopened-workspace verification checked exact Chinese/source bindings, multiline notes, hierarchy, a single FSRS log and persisted session. Evidence: `artifacts/cli-polish-20261018/tui-pty-final.log`, `pty-session-final.cast` and `pty-session-final-map.txt`. This run includes all state-based waits requiring the previous dialog to disappear where its old status or focus footer could match the next operation's result. These source results do not certify an installed package or an untested platform. Fish completion was generated but its runtime was unavailable; it remains unverified despite the test-run skip count of zero.

### Source identity, reversible changes and file integrity — 2026-10-18

- Preserve old source URIs when undoing or redoing cross-study cuts and moves, using each participant's actual before/after card owner. Reject corrupt linked-history markers and ambiguous identities instead of guessing from an equal card ID.
- Retain the existing snapshot format and a usable last inverse operation for legitimate large notes. Normal history remains bounded to 8 MiB; a single necessary inverse may use the 32 MiB hard limit. Reject larger reversible changes with `TOO_LARGE` before writing, rather than silently removing the last undo step.
- Preflight every linked-history participant and recheck the final budget after generated state refresh. Failure rolls back state, media, clipboard and automatic versions together; reading and navigation of an existing large library remain available. Use an equivalent Set membership check for participants without changing history semantics.
- Before version restoration, check recoverable card identities across other live/deleted studies and their card trash, including card trash retained in the restored snapshot. Report `CONFLICT` without a partial write, and preserve provable external source aliases even when restoring an empty old version.
- Keep negative map coordinates and `mapBackground` / `inkBehind` appearance when exchanging study packages.
- Clean up a newly created incomplete export after write, sync or close failure only when its file identity can be confirmed. Preserve existing files, externally replaced paths and symbolic links; do not turn a cleanup error into a false success.
- Validate every unpacked archive file against its exact byte count and SHA-256 manifest, including safe paths and regular-file types; record verifier and installed-workflow harness hashes with package evidence.

The seven Core history/source/version/package subsets passed 34/34, with no skips, in 2.536 seconds on macOS arm64 / Node 26.5.0 (`artifacts/cli-polish-20261018/core-targeted.log`). The later participant Set lookup is a semantic-equivalence refinement, not a measured product speed claim. Actual new-file failure injection passed 7/7 with no skips in 61.342 ms (`artifacts/cli-polish-20261018/safety-write-new.log`), covering partial writes, sync/close/stat failures, pre-existing targets, replacements and cleanup failure. The manifest validator passed its four targeted cases. These subsets do not replace final-source, final-tarball, real power-loss or storage-disconnection verification.

### Export scope, readable labels and raster composition — 2026-10-18

- Apply all, branch and visible export scopes before reading attachments. An unavailable image outside the selected scope no longer blocks that export or consumes its media budget. Full exports include descendants hidden by collapse/submaps and the appropriate global ink, independently of the current UI focus.
- Preserve whole Unicode graphemes and original UTF-16 rich-text ranges while wrapping titles. Keep ordinary Chinese closing punctuation off the next line and opening punctuation off the preceding line, with bounded fallback for an impossibly narrow label.
- Give each exported title line its own absolute baseline, retaining rich-text spans without depending on inconsistent nested relative tspan layout.
- Render PNG/raster-PDF text with installed local fonts through native Canvas, retaining whole-run shaping and complete mixed-script bounds, including fallback glyphs, decorations and trailing text. Keep ordinary SVG text searchable and source-linked; missing local glyphs produce `FONT_UNAVAILABLE` instead of a successful file containing boxes.
- Compose those text images in their original map positions through the existing PDF/PDF.js dependencies, retaining transforms, nested clips, layer order and transparent output. Account for nested MathJax coordinates when sampling text; reject unsupported masks, filters, external SVG resources and luminosity transparency effects explicitly.
- Inspect embedded PNG/JPEG dimensions before native decoding: at most 24 megapixels per image, 16,000 pixels per side and 40 megapixels of unique decoded images per composition, including text images. Reuse the validated decoded image when an asset appears repeatedly, with separate encoded-image and intermediate-PDF byte limits.
- Bring the first spatial keyboard selection into view even when all topics start far from the current viewport; retain explicit reveal semantics for hidden selections.

The export-scope/media/grapheme/navigation subset passed 10/10 with no failures or skips in 609.813 ms on macOS arm64 / Node 26.5.0 (`artifacts/cli-polish-20261018/visual-scope-targeted.log`). Later Chinese line-break, PNG/JPEG dimension-preflight and nested-coordinate sampling helpers passed 18/18 pure source tests with no skips in 56.697 ms (`visual-bounds-targeted.log`). These subsets overlap. They establish their declared geometry and boundary cases, not default-font raster pixels, aggregate decoded-image limits in the production worker or final-package acceptance.

The final raster/font/line-break/resource subset then passed 32/32 with no failures or skips in 450.731 ms (`artifacts/cli-polish-20261018/visual-v5-targeted.log`). It verifies the production compositor's cumulative decoded-image boundary and deduplication using reduced thresholds, not a real 40-megapixel memory stress test.

The public-runtime production proof passed PNG and raster PDF on a self-authored 10-topic, 2-image study, with 13 pixel checks per format. The same production worker passed four geometry checks per format for nested clips, rotation, bitmap paint order and encoded transparency: red/blue alpha 127, both clip exteriors transparent. All 34 pixel assertions passed without temporary font registration. Final public PNG and PDF-rendered PNG were byte-identical to the independently reviewed full diagram; final worker PNG and PDF-rendered PNG were also identical and independently inspected. Full mixed-script tails, Chinese, emoji, flags, combining accents, rich text, MathJax, images and source page labels were readable. Evidence and complete PNG hashes: `artifacts/cli-polish-20261018/export-production-v5/proof.json` and `visual-review.json`. The original automated report remains `awaiting-manual-review`; the separate review records three AI agents' actual inspection scopes and file identities. This does not claim human usability testing, other platforms, arbitrary SVG viewers or vector-PDF parity.

### Final applicable-source validation — 2026-10-18

On macOS arm64 / Node 26.5.0, check passed in 12.196 seconds and npm test passed 564/564 in 24.559 seconds, with zero failures, cancellations, skips or todo cases. The isolated compatibility build passed and included the TUI copy. Report: `artifacts/cli-product-20261018/checks/run-2026-10-18T04-59-17-644Z/results.json`. Its `applicableSourceStatus` is `passed`; four missing legacy host paths still block `test:agent-acceptance` and `test:deep-audit`, so `overall` remains `partial`. Earlier targeted counts above overlap with this complete applicable source suite and are not added to it.

No npm publication, remote push, user-app replacement or runtime contract migration is part of this change. The local name marginreader is not a verified registry claim. Exact final-source and installed-package outcomes are recorded with each release artifact using the identity and scope rules in `docs/CLI_PRODUCT_ACCEPTANCE.md`; required legacy gates remain explicitly blocked rather than being recast as a complete pass.

## Previous development history

The previous README is preserved byte-for-byte in source at docs/HISTORY.md. It records earlier versions and local verification claims; those claims are not automatically transferred to this release. Historical material is excluded from the npm payload.
