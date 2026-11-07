# Terminal visuals module interface

This module is a read-only projection of public Core results. It never creates a
runtime, reads a workspace, writes state, opens a terminal or installs handlers.
The embedding CLI or TUI owns public requests, terminal I/O and lifecycle.

## Integration

```js
const {createTerminalVisuals}=require('../terminal-visuals/index.cjs');
const visual=await createTerminalVisuals({measure,segment});
const scene=visual.prepare({study,geometry});
let state=visual.initialState({selectedId,centerX:0,centerY:0,zoom:1});
({state,effects}=visual.reduce(scene,state,
  {type:'select',cardId:selectedId},{columns:80,rows:24}));
const frame=visual.render(scene,state,
  {columns:80,rows:24,color:'none',glyphs:'unicode'});
// A TUI may directly embed frame.lines; no ANSI is present.
const text=visual.toPlainText(frame);
```

measure defaults to string-width (the shared pinned 7.2.0 dependency).
segment defaults to Intl.Segmenter graphemes; injected functions return strings
or segment records. measure must return integer terminal column widths.
color is accepted for ABI stability; this release always produces plain,
monochrome text. Unicode is default; glyphs:'ascii' changes diagram marks,
not user labels. Focus uses >, *, = and ! without relying on color.

prepare preserves the original study and geometry objects and creates cards,
boxes, children, edges and xIndex lookup structures. Treat inputs/scene as
immutable after preparation; rebuild after a revision changes. No complete
styles are inferred from topics:{}: Core's topics Map is intentionally ignored.
Mismatched study/geometry revisions throw an Error with code STALE_SCENE.
Invalid bounds/duplicate IDs throw INVALID_GEOMETRY or INVALID_SCENE.

The complete cards table survives cropping and collapsed/unpositioned nodes.
stats.totalCards and positionedCards are distinct. UNPOSITIONED_CARDS is explicit.
External relationships remain in scene.study.links and generate EXTERNAL_LINK;
they are not drawn at invented same-map coordinates.

## State and actions

Camera coordinates are Core world coordinates; zoom 1 maps 12 world units per
column and 24 per row. Default cell aspect ratio is an approximation. Negative
coordinates work. No backing buffer is allocated at world/map dimensions.

Actions:

- pan {dx,dy}: terminal-cell movement converted at the current zoom; deliberately
  permits moving away from selection.
- zoom {zoom} or {factor}: bounded to .02–16; selected node is the anchor.
- fit: center complete positioned bounds with margins.
- center-selection: center the positioned selected node.
- select {cardId} (selectedId alias accepted).
- navigate {direction:'left'|'right'|'up'|'down'}: O(N) half-plane search,
  preferring orthogonal overlap, then angle/distance/ID; no pairwise table.
- parent; child {index:0}; sibling {delta:1}; resize.

Selection/navigation/resize automatically reveal a visible title anchor. A
node bigger than the viewport is anchored at its top/left; full content is
still available through scene.cards.
The first directional navigation from an unselected scene chooses a positioned
card and reveals it, including maps whose coordinates start far from the origin.

Hidden selected objects return {type:'reveal-required',cardId}; no Core mutation
or hidden expansion occurs. The caller must explicitly choose the appropriate public
operation and then refetch both results. Unknown IDs produce a diagnostic.
Changing selection alone does not activate source navigation or persist it.

## Frame

frame.lines has exactly rows strings, each exactly columns terminal cells,
without ANSI/control sequences. frame.rows is an optional cell array: a wide
grapheme occupies its first cell and continuation cells contain ''. Ownership
tracking clears entire wide glyphs on overlap. Always prefer lines for embedding.
toPlainText(frame) joins lines with LF. Input C0/C1 and bidi/format controls become visible replacement characters (�), matching TUI identity protection. ZWJ/ZWNJ remain available for emoji/script shaping. Unicode line/paragraph separators cannot create extra screen rows.

frame.hits contains clipped card rectangles and segment bounding rectangles
for relationships/hierarchy. Link rectangles are coarse candidate hit regions;
they are not exact curve-distance tests. Card layer values are 1/2 (selected),
links 0. When rectangles overlap, prefer higher layer/later entries.
visibleIds, selectedId, revision, stats and warnings are also returned.
Relationship ':' differs from hierarchy '·' (ASCII '.'). Curves are bounded
polylines; decorative themes, handwritten ink and exact Core curve geometry are
not reproduced. Below zoom .15 or tiny boxes nodes use density dots/@; titles
are limited to four lines with an ellipsis. Full titles stay in cards.

Viewport maximum is 100000 cells; scene budget 100000 cards and 500000 edges; edges accept at
most 64 segments before explicit simplification. Budget excess is rejected explicitly, never truncated. Current Core creation/import still enforces 10000 cards; renderer policy deliberately allows larger supplied models. Bounds are calculated iteratively without spreading coordinate arrays. Node candidates use a sorted
x index. Edge iteration is linear in edges. Frame storage is O(columns*rows);
the model/index remains O(cards+edges). This is not an R-tree or an all-pairs
navigation index. A full-fit view of a huge map naturally contains collisions;
zoom and navigation recover individual objects.

## CLI: one-shot snapshot

```js
const {renderMapSnapshot}=require('../terminal-visuals/cli.cjs');
const result=await renderMapSnapshot({
  request: (method,params)=>callCoreReturningResult(method,params),
  setId,columns:120,rows:36,selectedId,zoom
});
```

Only study.get and study.map.geometry are invoked, in order. request returns the
Core result, not its JSON-RPC envelope; propagate Core errors in the wrapper.
No automatic retry masks a revision mismatch. The initial camera fits; explicit
zoom overrides fit and select reveals its target. Returns
{text,revision,state,stats,warnings}. No ANSI is emitted, including stream output.
The CLI adapter owns argument parsing, errors, output and client cleanup.

## Image adapter

terminal-visuals/images.cjs exports validatePNG, planImage, createImageEncoder,
MAX_BYTES and MAX_PIXELS. It has no I/O. PNG validation checks signature, chunk
bounds/CRC, IHDR format/dimensions, data/end presence and rejects APNG. Limits
are 16 MiB compressed bytes and 24 MP. This is structural validation, not a full
pixel decoder; it performs no unbounded decompression.

planImage({isTTY,term,mode,confirmed,multiplexer}) returns a capability plan.
mode is off (default), auto, kitty or iterm2. NO_TTY, dumb, no positive protocol
confirmation, or a multiplexer without confirmed passthrough return disabled.
Even an explicit protocol choice requires positive capability confirmation.
Environment names never prove support. The embedding caller owns probe I/O, timeout, response
routing, terminal restoration and the trustworthy confirmed values.

createImageEncoder({allocateId}).encode(bytes,plan,{columns,rows}) returns {chunks,text,id}.
Disabled plans return no chunks/control bytes. Kitty uses direct PNG transport,
base64 chunks <=4096 characters. IDs default to cryptographically random nonzero unsigned 32-bit values (1..4294967295); allocateId is an optional injectable session allocator. Owned collisions retry at most 32 times; invalid IDs fail. Random IDs reduce but cannot mathematically eliminate collisions with other terminal applications. The host can inject a shared allocator/reservation strategy. Only IDs allocated by that encoder are cleared.
Keep one encoder per terminal session and serialize complete image transfers.
The embedding caller must clear active Kitty IDs before replacing panes/exiting. ownedIds() and clearAll(plan) cover a caller throwing after only part of the upload was written; ownership is recorded before chunks are returned. At most 10000 owned IDs may be retained. The official c/r semantics preserve aspect ratio by letterboxing/pillarboxing when both are supplied; no stretch operation is used. No global delete
is used. iTerm2 sets inline=1 and preserveAspectRatio=1. Multipart requires
confirmed.iterm2Multipart; otherwise sequences over 1 MiB fall back. iTerm2 has
no ownership-scoped cleanup here: use a dedicated preview surface/lifecycle.
The encoder never downloads an image or uses terminal file/shared-memory paths.

Official protocol references:

- https://sw.kovidgoyal.net/kitty/graphics-protocol/
- https://iterm2.com/documentation-images.html
- https://iterm2.com/feature-reporting/

Kitty positive query responses and iTerm feature reporting should be parsed
separately from keyboard input. Unknown, delayed or failed replies fall back.
A known terminal environment variable is only a probe candidate.

The built-in TUI currently embeds monochrome spatial text frames. It does not
probe or enable Kitty/iTerm2 image display. The standalone encoder is available
to callers implementing the required capability and cleanup lifecycle; encoder
byte tests do not establish real-terminal display fidelity.

## Image/source fidelity boundaries

study.card.image returns durable excerpt PNG bytes as canonical base64; this
can display the saved excerpt at original stored resolution. Public readAsset
also supports authorized card/media/original assets. Never construct private
cache paths. Missing assets keep their Core errors and text fallback.

document.preview accepts a PDF page and expectedVersion, but renders a bounded
thumbnail (approximately 360x480), not a high-resolution original page. Label it
as a preview. Source-version conflict, missing source or password/render failure
must remain visible. Do not bypass the Core source checks or switch workspaces.
No PDF renderer, region selection, touch, pressure ink, lasso or handwriting
editor is implemented here. High-resolution arbitrary PDF-page rendering is
outside this module's current public contract.

SVG/vector PDF/PNG/PPTX exports remain Core public operations. Export object
IDs/hierarchy/source data through study JSON/package/XMind alongside visual
files. Check actual topic counts, searchable PDF text and rasterized metadata;
a nice image alone does not establish an editable or source-linked export.

The PNG/raster-PDF path converts generated map text into local-coordinate
native Canvas images and preserves their original SVG position, transforms,
clips and paint order during private PDF/PDF.js composition. Ordinary SVG
keeps its searchable text and source links. Raster output requires installed
local fonts; an unsupported glyph raises `FONT_UNAVAILABLE` rather than
silently becoming a missing-glyph box. Changing from vector PDF to raster
cannot supply a font that is absent from the machine.

This compositor supports the existing generated map vocabulary. It is not an
arbitrary SVG renderer: actual mask/filter effects and unsupported image or
external SVG resources fail explicitly. Output generation, automated pixel
checks and independent visual inspection are separate evidence gates. Mixed-script text
must include its complete final segment, not merely one rendered glyph; all
three stages must be checked before claiming visual fidelity. Verify
transparency by decoding the actual PNG bytes and rendering the actual PDF;
correct in-memory Canvas pixels alone cannot establish encoded output fidelity. See
[CLI_PRODUCT_ACCEPTANCE](CLI_PRODUCT_ACCEPTANCE.md) for final-source and exact
tarball evidence rules.

## Verification

Run:

```sh
node --test tests/terminal-visual.test.cjs tests/terminal-visual-images.cjs tests/terminal-visual-core.test.cjs
node --test tests/terminal-visual-navigation.test.cjs tests/mindmap-label-graphemes.test.cjs tests/mindmap-export-scope.test.cjs tests/mindmap-export-media-scope.test.cjs
node --test tests/raster-fonts.test.cjs tests/svg-raster-scale.test.cjs tests/raster-image-budget.test.cjs tests/mindmap-label-graphemes.test.cjs tests/svg-raster-text.test.cjs
node tests/export-production-proof.cjs artifacts/export-production-review
```

The additional regressions cover first-selection visibility, grapheme-safe
label wrapping and ellipsis, complete versus visible branch export, and scoped
image reads with the unchanged 32 MiB aggregate image-byte budget. The separate
raster compositor preflights decoded dimensions, counts unique images including
text images against 40 megapixels, and reuses decoded assets. Its boundary tests
use reduced thresholds; they are not a real 40-megapixel memory stress result.
The production proof uses a self-authored isolated study and the public default
PNG/raster-PDF export path, plus a separate worker geometry fixture. It does not
open a user library or register temporary fonts. Use a new proof directory to
retain each run. Graphical label widths remain deterministic estimates of
platform fonts. Native font and terminal-display fidelity require their
respective checks below.

The original fourteen-test subset covered revision rejection, full hidden-object retention, navigation,
camera, exact Unicode widths/ZWJ, injection, negative coordinates, lines whose
endpoints are offscreen, injected snapshot requests, PNG boundaries, protocol
reassembly, ownership cleanup and conservative capability fallback.
The synthetic stress fixture contains 10000 actual cards and 9999 hierarchy edges and executes 100
navigation/render frames of 120x36, checking selection visibility and full
model count on every frame. Timing distributions and hardware are recorded below. These are synthetic figures, not peak memory or an isolated-machine benchmark; they do not establish heavy-image or cross-platform parity. A 10001-card regression verifies the model is not truncated. A real public Core test creates 9 notes, 8 hierarchy edges and 2 knowledge links in a temporary workspace, serializes responses through JSON, renders without changing study state, then verifies current-view collapse counts and stale revision rejection. It never opens a user library or invokes a model.

tests/terminal-visual-fixtures.cjs exports fixture(count) and navigation actions
for integration harnesses. The current text-space TUI has been exercised through
real OS PTY input, resize, source return, camera preservation and terminal
restoration; current evidence is linked from
[TERMINAL_WORKSPACE](TERMINAL_WORKSPACE.md#verification-and-evidence).
Kitty/iTerm2 images still require actual display checks using corner markers,
Chinese text and aspect-ratio guides. Pure byte tests and successful text-only
PTY operation do not prove image-protocol display correctness.

## Core-generated review preview

Current-view geometry, 100 columns by 24 rows, 9/9 positioned objects. Unicode hierarchy marks are ·; knowledge relationship marks are :. This text is generated by the renderer, not a manually redrawn tree. Images and themes are not represented.

```text
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                        +────────+  
                                                                     +──────────+       │来源定位│  
  +────────+                                                         │阅读      │·······+────────+  
  │空间导航│::::   +──────────+       >=======================*      +──────────+       +────────+  
  +────────+····:::│脑图      │::     !MarginReader           !······           ········│摘录原图│  
  +────────+       +──────────+··:::::*=======================*         ::::::::::::::::+────────+  
  │知识关系│·········        :::::::::::::::::::::::::::::::::::::::::::                            
  +────────+:::::::::::::::::                                  ·····:+──────────+::::   +────────+  
                                                                     │复习      │····:::│主动回忆│  
                                                                     +──────────+       +────────+  
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
```

Knowledge links in the same Core scene: 摘录原图 → 知识关系 (证据支持); 空间导航 → 主动回忆 (检索促进回忆). Card IDs and link IDs remain in scene/hits; the text preview is not the data model.

## Recorded synthetic timing (2026-10-18, local)

Apple M5 Pro, 18 logical CPUs, 48 GiB RAM; macOS arm64, Node v26.5.0.
10000 synthetic cards + 9999 hierarchy edges, 100 frames at 120x36; preparation
20.50 ms, total navigation/render loop 8041.05 ms. Process heapUsed after the
loop was 63.44 MB, not a measured peak. Other project checks were running;
these values are observations, not an SLA or proof of hardware parity.

| Operation (milliseconds) | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Direction navigation | 0.223 | 12.242 | 22.767 |
| One frame render | 82.735 | 118.246 | 144.658 |

The graph deliberately has long crossing links between grid-positioned nodes;
these timings include actual edge clipping/rasterization and grapheme layout.
Dense graphs are not guaranteed 60 fps. Host should coalesce repeated redraws.

## Historical integration findings and current evidence

An earlier local focused suite passed 14/14, and the CLI snapshot integration
passed three cases for JSON/text, request lifecycle and flag validation. At
that earlier stage, a PTY quit check found one remaining SIGINT listener and
one SIGTERM listener. A broader agent-acceptance attempt reported 463/465
before later renderer changes; its snapshot row-count failure subsequently
passed a focused rerun. An attempted deep-audit could not resolve the parent
Playwright dependency, lacked a topic-cover fixture and did not finish
normally. These are retained historical findings, not the current release's
complete-source or package result.

The final source TUI subsequently passed the real learning workflow and six
independent quit/signal/failure modes, including terminal restoration. It
physically exercised Space title editing, map/review Tab and Shift-Tab,
resizing, source activation and return. Evidence:
`artifacts/cli-polish-20261018/tui-pty-final.log`, `pty-session-final.cast` and
`pty-session-final-map.txt`. This module itself installs no terminal handlers.

The export-scope/media/grapheme/navigation subset passed 10/10 on macOS arm64
/ Node 26.5.0 (`artifacts/cli-polish-20261018/visual-scope-targeted.log`). The
later Chinese line-break, image-dimension and nested-coordinate helpers passed
18/18 pure source cases (`visual-bounds-targeted.log`). Those overlapping
historical subsets establish their geometry and boundary cases; final default
raster output has the separate evidence below.

## Final source and production raster evidence — 2026-10-18

On macOS arm64 / Node 26.5.0, the final raster/font/line-break/resource subset
passed 32/32 with no failures or skips in 450.731 ms. The five files are the
third test command above; log:
`artifacts/cli-polish-20261018/visual-v5-targeted.log`.

The default production proof in
`artifacts/cli-polish-20261018/export-production-v5/` passed all four outputs:
public PNG and raster PDF each passed 13 pixel checks on a 10-topic, 2-image
study; worker PNG and raster PDF each passed four geometry checks. These 34
pixel assertions are separate from the 32 node:test cases. Complete mixed-script
tails, all three flags, family emoji, combining accents, rich styles, bitmap
quadrants, Chinese MathJax and source page labels were checked. Nested clips,
rotation, paint order and encoded alpha were checked through the real worker.

`public-map.png` and the PDF-rendered `public-raster-pdf.png` are byte-identical
at 2128 × 2207, with PNG SHA-256
`ba64ffb54724cd023121c4d27202ff123ca999b167394b114a6237c78b016d6a`.
`worker-geometry.png` and `worker-geometry-pdf.png` are byte-identical at
800 × 480, with PNG SHA-256
`caf27b48ce88b051bbf58ded6139e3ea27d7f4104d2087400a7d0c1e78298824`.
Decoded red/blue alpha was 127 and both clip-exterior samples were transparent.
Independent visual inspection confirmed the complete text and geometry; the
hashes bind that inspection to the final actual PNG bytes, including the PDF
renderings. They are not hashes of the PDF files themselves.

The unedited `proof.json` retains `automatedChecks=passed` and
`overall=awaiting-manual-review`; the separate `visual-review.json` records
three AI agents' actual review scopes and artifact identities. This is not
human usability testing, all-viewer PDF/SVG parity or a terminal-image display
test. Ordinary SVG retains semantic text and links; unsupported effects or
missing local glyphs fail explicitly instead of producing an incomplete raster.

Final applicable source passed check, 564/564 tests with no
failures/cancellations/skips/todo cases, and the isolated compatibility build
with its TUI copy. Report:
`artifacts/cli-product-20261018/checks/run-2026-10-18T04-59-17-644Z/results.json`.
Its `applicableSourceStatus` is `passed`; required legacy gates remain blocked
and `overall` is `partial`. Installed-bin results require their exact tarball
reports, and actual Kitty/iTerm2 image display remains unverified.
