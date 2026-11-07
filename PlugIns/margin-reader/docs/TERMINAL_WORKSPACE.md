# MarginReader Terminal Workspace

The terminal workspace is a local, keyboard-driven presentation of the existing public Core. It does not maintain a second library. Start it through the CLI integration:

```sh
margin-reader tui --help
margin-reader --workspace /absolute/path/to/library tui
```

`tui --help`, `--help tui` and `help tui` use the ordinary CLI discovery path. They work without a workspace, do not open Core or load the terminal module, and print startup requirements, main keys and this document's location.

For an embedding application:

```js
const { runTui } = require("./tui/index.cjs");
await runTui({ client, workspace, input, output, errorOutput });
```

The caller creates and closes `client` in `finally`. The TUI restores the terminal, removes its input/output/process listeners, unsubscribes, and settles outstanding requests before returning. It never calls `process.exit()`.

## Runtime and dependency

Node >=22.13.0. Width measurement uses the exact dependency `string-width@7.2.0`, loaded with dynamic `import('string-width')`. npm's package metadata declares ESM and Node >=18. Grapheme segmentation uses `Intl.Segmenter`. There is no handwritten wcwidth replacement or dependency on a temporary install path.

Every business operation goes through `client.request({jsonrpc:'2.0',id,method,params})`. Optional `client.subscribe` only indicates that the workspace changed; it does not silently replace editor revisions or replay writes.

## Workspace layout

At 110 columns and above, the screen presents the library, reader, and knowledge outline/context together. At 76–109 columns it presents two panes. At 38–75 columns it presents the focused pane. Below 38 columns or 10 rows it presents a clipped resize/exit message.

The reader retains a source UTF-16 cursor, not a wrapped-row position. Resize reflows the screen around that cursor. Up/down and PageUp/PageDown retain the desired visual column across short lines, CJK characters and emoji; horizontal movement or a changed wrap width establishes a new column. Home/End retain their existing chapter-start/chapter-end meaning. The full study remains in memory; only visible rows are drawn. Search includes collapsed descendants, with `[path]` ancestors and `[match]` results.

Tab and Shift-Tab always move to a visible pane. From a full-screen map or review, they first return to the normal workspace: Tab focuses the library and Shift-Tab focuses the reader. Map camera, selected card, source selection, drafts and saved review state are retained; switching panes does not call Core or grade a question. Press g to reopen the map, or R and choose the saved session to resume review. Review opens with knowledge focus.

Repeated reader navigation and painting reuse one current chapter layout. Content, column count or the width-measuring function invalidates it. The cache retains one wrap width and at most 512 short grapheme measurements; it does not retain every visited chapter or resize. First layout, later navigation and actual terminal I/O are separate performance costs.

All screens currently use monochrome indicators; focus, selection, conflict, and review state remain readable with `NO_COLOR`. The CLI rejects unsupported TTY input/output or `TERM=dumb` with exit status 1 and a `TTY_REQUIRED` JSON error before opening Core or creating workspace metadata. The embedding `runTui` interface still returns `{degraded:true}` and an ordinary-text diagnostic. Neither path enters raw mode or emits cursor escape sequences. Use the existing JSON CLI or `read --text` in pipelines.

## Keys

| Context    | Keys                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| Navigation | arrows or j/k; Tab / Shift-Tab pane; Enter confirm; Esc return; ? help       |
| Library    | Enter open file/folder; Backspace parent folder                              |
| Reading    | left/right grapheme; up/down screen line; Home/End; PageUp/PageDown          |
| Reading    | [ / ] previous/next PDF page or flow section; t document TOC                 |
| Selection  | v anchor/cancel; move cursor; c excerpt preview                              |
| Search     | / document text or indexed library; / in knowledge searches all cards        |
| Study      | S choose/create study; f explicitly refresh; N new note                      |
| Knowledge  | Enter fold/unfold; e / Space title; n note; m choose new subtree parent      |
| Source     | o exact original source; Esc restores original study/card/focus              |
| Review     | a enables selected card; R resume/start scheduled session                    |
| Review     | Space reveals next group/answer; 1 Again, 2 Hard, 3 Good, 4 Easy             |
| Review     | left/right previous/next question; up/down or PageUp/PageDown scroll         |
| History    | u public study undo; U public study redo                                     |
| Recovery   | ! input/excerpt/failed-operation recovery; q exits, confirming draft discard |
| Text input | arrows/Home/End caret; Backspace/Delete; Ctrl-U clear; Ctrl-J newline        |
| Exit       | Ctrl-C, SIGINT, SIGTERM restore and exit; q exits normally                   |

Letter shortcuts and spaces are ordinary text while an input dialog is open. Space opens the selected card's title draft in the knowledge outline or map; in review it retains its reveal meaning. Enter saves the input; Esc retains it in memory. Help, excerpt previews and conflict comparisons scroll with arrows; long text editors keep the caret visible. Draft identity includes the study, card, and operation/field, so another card or study cannot inherit its note draft.

Bracketed paste is enabled for the TUI session and disabled on exit. A multiline paste becomes one draft edit: CRLF becomes a newline, Chinese/emoji remain intact, and pasted shortcut letters or return characters cannot submit the dialog or trigger commands. Press Enter after reviewing the draft to save it. Paste outside a text input is ignored with a visible diagnostic. An oversized paste (more than 1 Mi UTF-16 units) or one targeting a replaced dialog leaves the draft unchanged. Physical Ctrl-J inserts a newline in text inputs.

## A complete learning flow

1. Open a file from the library and browse its TOC, pages/sections or search hits.
2. Press v, move by grapheme or screen line, and press c. Inspect the exact selected text.
3. Enter chooses an existing study or creates one. A second confirmation shows the target study before capture.
4. Tab to knowledge. Edit title/note, fold branches, or press m and choose a valid new parent. Descendants move with the card.
5. Press o to follow the source. A flow excerpt shows its complete saved UTF-16 selection with the cursor at its start. Esc restores the originating card, study, focus, reader position/selection and spatial camera.
6. Press a to enable the card, then R and choose a saved session or a new scheduled due session.
7. Space reveals groups in Core order. A grade becomes available only after the full answer is revealed. The screen displays progress, FSRS due previews, and the last graded due time. u/U use the public history.

Flow selection is computed from sanitized HTML `body.textContent` with original UTF-16 offsets. The wrapped display is never used as an offset source. Selection markers are presentation only. Capture sends the original quote, selection, source version, study revision, and a stable capture UUID.

PDF support in this first terminal workflow is page text and page-linked excerpts. It does not invent rectangle coordinates or claim that a text-generated card is a pixel crop of the original PDF.

## Spatial view through terminal-visuals

Press g to enter or leave the spatial map. The `tui/spatial.cjs` adapter loads the `terminal-visuals/index.cjs` ABI and obtains both the full study and deterministic geometry through public requests. A mismatched revision is rejected. No private Core or browser renderer is used.

| Spatial action                                  | Keys                    |
| ----------------------------------------------- | ----------------------- |
| Select neighboring visible node                 | arrows; j/k down/up     |
| Pan camera                                      | H/J/K/L or Shift-arrows |
| Zoom                                            | + / -                   |
| Fit all positioned nodes                        | 0                       |
| Center selection                                | .                       |
| Inspect selected card in outline                | Enter                   |
| Edit selected card title                        | Space or e              |
| Find any card, including hidden descendants     | /                       |
| Open selected original and return to map/camera | o, then Esc             |
| Return to outline                               | Esc or g                |

The viewport may omit offscreen labels and collapsed positions; the scene retains the full study. Statistics report visible and total cards. Spatial layout uses character cells and cannot reproduce PDF pixels, native touch, pressure handwriting, rich typography or image occlusion. Hidden nodes retain a reveal-required diagnostic; view navigation never persists an expansion. Spatial-renderer warnings remain visible as a count; full card text is available in the outline context panel.

## Concurrency and recovery

Study writes freeze their original `expectedRevision`. Captures additionally freeze `expectedSourceVersion` and `captureId`. File-version contracts remain with the existing public APIs.

A CONFLICT retains the old intent and draft. Press r in its dialog to read current state, inspect the comparison, and Enter to explicitly retry. No revision is swapped until this explicit action. A changed review question, hidden answer, or unsupported image occlusion cannot be replayed as a grade.

For a transport failure or uncertain result, ! first queries current state. A capture UUID, matching edited fields, document membership, or session answer can confirm an already committed operation. Such a result is not submitted again. If the result remains uncertain, replay is blocked: inspect current state, discard the retained intent explicitly, and choose the next action. Uncertain study creation queries candidate studies and never blindly creates a duplicate.

Cancelled excerpts and text drafts have a visible ! recovery entry. Drafts are memory-only and do not survive process termination. q asks before discarding retained work; Ctrl-C/signals exit immediately.

Review display reads the Core session's masked current front. It never derives a question from unmasked HTML or from the answer side. Back-side text is displayed only when the session is fully revealed. Grading is blocked for image occlusion questions even after their reveal, because this text terminal cannot show their visual question faithfully. Pending mutations suppress repeated ratings.

Async navigation tokens prevent old document/search results from reclaiming a newer focus or cursor. Source return also refreshes the originating study before restoring its selection. Reading position itself retains the public API's last-writer-wins semantics.

## Ownership

- `tui/index.cjs`: terminal lifecycle and fixed embedding signature.
- `tui/workspace.cjs`: focus, dialogs, request boundary, drafts, versions and learning flow.
- `tui/text.cjs`: source mapping, Unicode segmentation, control sanitization and full-model outline.
- `tui/screen.cjs`: responsive monochrome workbench.
- `tui/spatial.cjs`: presentation adapter to terminal-visuals.
- `tests/tui-*.test.cjs`: isolated workflow, lifecycle and ABI integration tests.
- `tests/tui-pty.cjs`: real OS pseudoterminal input, resize, restore and process-exit tests.

The CLI owns client creation and closure. The terminal layer owns input, views and terminal-state restoration; `terminal-visuals` owns spatial rendering. Persistent business behavior stays behind the public Core contract.

## Verification and evidence

Run from Engine:

```sh
node --test tests/cli-product*.test.cjs tests/tui-*.test.cjs
node tests/tui-pty.cjs
node tests/tui-pty.cjs --record tui/evidence/pty-session.cast
node tests/tui-performance.cjs --root /absolute/path/to/Engine
```

Final applicable-source validation on 2026-10-18, macOS arm64 / Node 26.5.0, passed check and 564/564 tests, with zero failures, cancellations, skips or todo cases. The isolated compatibility build passed and contained its TUI copy. Evidence: `artifacts/cli-product-20261018/checks/run-2026-10-18T04-59-17-644Z/results.json`. Its `applicableSourceStatus` is `passed`; required legacy host gates remain blocked, so `overall` is `partial`. This source result and the separate actual PTY evidence below do not certify the installed tarball; package conclusions follow [CLI_PRODUCT_ACCEPTANCE](CLI_PRODUCT_ACCEPTANCE.md).

Earlier 0.9.4 validation on 2026-10-18 (Asia/Shanghai), before the reader-cache/paste refinement: 20 TUI tests passed with no failures or skips. The real PTY workflow, normal q, Ctrl-C, SIGINT, SIGTERM, runtime exception and initialization failure processes all exited naturally; the reopened workspace verification also passed. That retained output recording is `tui/evidence/pty-session.cast`, and its captured spatial screen is `tui/evidence/pty-session-map.txt`. The final-source and revised PTY results supersede this historical evidence for the newer behavior.

### Reader, paste and source refinement results

On 2026-10-18, the reader/paste/source refinement passed 64 targeted CLI/TUI tests on macOS arm64 with Node 26.5.0, with 0 failures and 0 skips. Command: `node --test tests/cli-product*.test.cjs tests/tui-*.test.cjs`; log: `artifacts/cli-polish-20261018/tui-targeted.log`. This result covers visual-column navigation and cache invalidation, exact cross-study source selection, failed or stale source loads, complete spatial-camera return state, multiline paste and noninteractive startup. It predates the later help and full-screen focus changes and is not a complete test count for the final source.

After the help addition, `tests/cli-product-tui-guard.test.cjs` passed 4/4, including both new discovery tests. After the full-screen focus/Space changes, `node --test tests/tui-spatial.test.cjs tests/tui-workflow.test.cjs` passed 18/18 with 0 failures and 0 skips in 4.239 seconds on the same Mac. These tests verify visible-pane switching, preserved complete camera/selection/draft/session state with no request or grade, the title-edit draft/save boundary, literal input spaces and review reveal. These overlapping subsets are not added together. Fish completion runtime was unavailable and remains unverified; a test runner's zero-skip count does not establish Fish compatibility.

The final source harness passed `node tests/tui-pty.cjs --record artifacts/cli-polish-20261018/pty-session-final.cast`: the real OS PTY learning workflow plus normal q, Ctrl-C, SIGINT, SIGTERM, runtime exception and initialization-failure processes. The workflow physically uses Space to edit a title and Tab/Shift-Tab to leave and reopen maps or resume reviews. All seven modes exited naturally and restored terminal attributes, cursor, alternate screen and bracketed-paste mode. Reopening the temporary workspace verified the exact Chinese excerpt, source binding, Chinese/emoji/Ctrl-J note, subtree parent, FSRS log and persisted session. Evidence: `artifacts/cli-polish-20261018/tui-pty-final.log`, `pty-session-final.cast` and `pty-session-final-map.txt`. This final run includes all dialog-disappearance barriers described below. Earlier PTY attempts and recordings remain separate historical evidence in the same directory. The installed package and other platforms require their own validation.

### Same-machine synthetic presentation comparison

The benchmark uses Apple M5 Pro, macOS arm64, Node 26.5.0, a 132 × 36 viewport and real `string-width`. Both source versions use the same text and repeated key sequence: right, down, left, up, PageDown, PageUp, right, left. Each warm sample includes one key handler plus generation of a complete frame after the first layout; there are 24 warm samples per fixture. Cold layout is measured separately using three fresh TUI state instances in memory; any attempt to call Core fails the benchmark.

| Fixture (UTF-16 units) | Baseline warm p50 (ms) | Baseline warm p95 (ms) | Revised warm p50 (ms) | Revised warm p95 (ms) | Revised warm max (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| English, 270,000 | 297.022 | 542.797 | 1.678 | 2.227 | 5.445 |
| Mixed CJK/English/emoji/combining marks, 252,000 | 209.396 | 391.789 | 1.038 | 1.626 | 2.903 |

Revised cold-layout p50 was 28.904 ms for English and 19.779 ms for mixed Unicode. The three-sample cold result describes initial layout cost and is not a tail-latency estimate. Raw reports are `artifacts/cli-polish-20261018/tui-baseline.json` and `tui-after.json` in the source checkout. To repeat with one copy of the harness and each source version's own dependencies:

```sh
node /path/to/refined/Engine/tests/tui-performance.cjs --root /path/to/baseline/Engine --samples 24
node /path/to/refined/Engine/tests/tui-performance.cjs --root /path/to/refined/Engine --samples 24
```

The updated PTY workflow additionally pastes CRLF-separated Chinese and family emoji into a note, checks that the input remains open, inserts a physical Ctrl-J newline, then explicitly saves and verifies exact persisted text after reopening. It also pastes command letters outside an input and verifies that no command is executed, opens title editing with a physical Space, and uses Tab/Shift-Tab to leave full-screen maps and reviews before reopening or resuming them. The performance harness accepts a source `--root` so the same real `string-width` fixtures and key sequence can compare baseline and revised sources on one machine. Its cold-layout and warm-key-plus-frame p50/p95 timings are synthetic presentation evidence, not PDF-image, parsing, physical-terminal or cross-platform parity claims.

### PTY method and evidence format

The PTY harness uses Python's standard-library pty/termios/fcntl with a real Node child process. It creates a temporary HTML document and isolated workspace, drives actual keyboard input through search, Chinese selection, excerpt, notes, subtree movement, spatial view, source return, resize, FSRS review and undo/redo, then reopens the runtime and verifies persisted state. It also starts independent processes for normal q, Ctrl-C, SIGINT, SIGTERM, uncaught runtime failure and initialization failure. Each must exit naturally within the test deadline; process.exit is not used to hide cleanup defects.

Success waits require a complete new frame without `[PENDING]`. Where an old input/choice frame can retain the same success text or focus footer, the wait also requires that dialog to have disappeared; for example, a previous `Saved` status inside the title editor cannot acknowledge the next save. This state check avoids using a timing delay as proof of completion.

Terminal attributes are compared before/after, excluding only macOS's OS-managed PENDIN pending-retype flag. Raw/canonical, echo, signal flags, control characters, cursor restoration and alternate-screen restoration are checked. Extreme-width assertions check the visible clipped text rather than an impossible full-width message.

The retained recording is asciinema v2 JSON-lines with output and input events. Replay with `asciinema play tui/evidence/pty-session.cast`. It contains only the artificial test workspace. This evidence need not be shipped in production packages.

Core, host compatibility and installed-package gates are recorded separately; these TUI tests do not claim native GUI, cross-platform terminal, hardware-image or handwriting parity.
