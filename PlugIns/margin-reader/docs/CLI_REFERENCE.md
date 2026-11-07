# Margin Reader CLI reference

The CLI calls the existing public runtime through client.request. It does not implement a second business model. Ordinary commands run without a browser or GUI. The optional serve command starts a browser service; it is separate from terminal use.

## Requirements and discovery

Use Node.js 22.13 or newer. From Engine, substitute node cli.cjs for margin-reader if the executable is not installed.

```sh
margin-reader --version
margin-reader commands
margin-reader commands excerpt
margin-reader help
margin-reader help study
margin-reader help card create
margin-reader help study card create
margin-reader help study.card.create --output text
margin-reader schema study.card.create
```

These commands do not require a workspace or initialize Core. Help labels schema.examples as contract examples and preserves their original shape; automatically generated parameter skeletons are explicitly incomplete, especially empty arrays and nested objects. They are not runnable examples until completed. The full learning example below has been executed successfully. Historical help METHOD with a dotted method still returns the schema object as JSON; use --output text for friendly help. Group help lists descendant commands. commands searches command names, methods and descriptions.

Every schema method is accessible by its exact dotted name, or namespace words with camelCase segments converted to kebab-case. For example, study.review.session.start and study review session start invoke the same public method. All parameters use schema-derived kebab-case flags. The current schema remains the authority for available methods, types, required fields, enums and bounds.

## Convenient workflow commands

| Command | Public method | Positional arguments |
| --- | --- | --- |
| document open | document.open | path |
| document read | document.content | id |
| document search | document.search | id, query |
| document outline | toc.list | id |
| study list/create/get | study.list/create/get | none / title / setId |
| study add | study.documents.add | setId |
| study export | study.export | setId, path |
| card create | study.card.create | setId |
| card note | study.note.create | setId, title |
| card move | study.card.move | setId, cardId |
| cards move | study.cards.move | setId |
| card update/remove | study.card.update/remove | setId, cardId |
| study update | study.update | setId |
| card source | study.card.activate | setId, cardId |
| map show | study.get | setId |
| map render | read-only study.get + study.map.geometry adapter | --set-id required |
| map export | study.mindmap.export | setId, path |
| review configure | study.review.configure | setId, cardId |
| review queue | study.review.queue | setId |
| review preview | study.review.preview | setId, cardId |
| review grade | study.review.grade | setId, cardId, rating |
| xmind inspect/import/export | study.mindmap.xmind.inspect/import/export | path |

Positional arguments can instead be supplied as flags, but not both. Canonical methods otherwise use named parameters. card source is an explicit source jump and defaults to force:true, even when automatic linkage is off. --force=false overrides this alias default. Canonical study.card.activate keeps its original behavior. card move moves one card with its descendants; cards move is the explicit bulk operation. No command implicitly reads and retries a newer revision after a conflict.

## Complete isolated learning example

This example uses bash or zsh and jq, and creates a new temporary library. It never reads your existing library. Each invocation is a fresh process, so the example also exercises persistence across restarts.

```sh
export MR_WORKSPACE="$(mktemp -d)"
mr() { margin-reader --workspace "$MR_WORKSPACE" "$@"; }

# Create a document using the public file API.
mr fs write --path '课程 一.md' --content '# Lesson: Hello world'
DOC="$(mr document open '课程 一.md')"
DOC_ID="$(printf '%s' "$DOC" | jq -r '.result.id')"
SOURCE_VERSION="$(printf '%s' "$DOC" | jq -r '.result.sourceVersion')"
mr document read "$DOC_ID" --output text
mr document outline "$DOC_ID" --output text

SET="$(mr study create '终端学习')"
SET_ID="$(printf '%s' "$SET" | jq -r '.result.id')"
REV="$(printf '%s' "$SET" | jq -r '.result.revision')"
mr study add "$SET_ID" --expected-revision "$REV" --paths '["课程 一.md"]'

# Read an explicit current revision before each independent edit.
REV="$(mr study get "$SET_ID" | jq -r '.result.revision')"
CAPTURE_ID="$(node -p 'crypto.randomUUID()')"
mr card create "$SET_ID" --expected-revision "$REV" \
  --document-id "$DOC_ID" --expected-source-version "$SOURCE_VERSION" \
  --capture-id "$CAPTURE_ID" --text 'Hello world' \
  --locator '{"section":0}' --color yellow --title '核心摘录'

CARD_ID="$(mr study get "$SET_ID" | jq -r '.result.cards[0].id')"
REV="$(mr study get "$SET_ID" | jq -r '.result.revision')"
mr card note "$SET_ID" '解释与联系' --expected-revision "$REV" \
  --parent-id "$CARD_ID" --text '这是一条子主题'
mr map show "$SET_ID" --output text
mr map render --set-id "$SET_ID" --columns 100 --rows 30 --output text

REV="$(mr study get "$SET_ID" | jq -r '.result.revision')"
mr review configure "$SET_ID" "$CARD_ID" --expected-revision "$REV" --enabled true
mr review queue "$SET_ID" --output pretty
mr review preview "$SET_ID" "$CARD_ID" --output pretty
REV="$(mr study get "$SET_ID" | jq -r '.result.revision')"
mr review grade "$SET_ID" "$CARD_ID" good --expected-revision "$REV"

# Resolve and persist the original-source navigation via the same public API.
REV="$(mr study get "$SET_ID" | jq -r '.result.revision')"
mr study navigation set --set-id "$SET_ID" --expected-revision "$REV" --mode off
mr card source "$SET_ID" "$CARD_ID"
mr study export "$SET_ID" '学习导出.json' --include-images=false
mr study get "$SET_ID" --output pretty

# Optional JSON-based XMind workbook export, with explicit revisions.
REVISIONS="$(mr study get "$SET_ID" | jq -c '.result | {(.id): .revision}')"
SETS="$(printf '%s' "$SET_ID" | jq -R -s -c '[.]')"
mr xmind export '学习脑图.xmind' --set-ids "$SETS" --expected-revisions "$REVISIONS"
mr xmind inspect '学习脑图.xmind' --output pretty
```

Inspect a XMind file before importing it. Pass its returned sourceVersion to --expected-version; review warnings and explicitly choose --allow-lossy only when acceptable. XMind support is limited to the existing public implementation's unencrypted JSON ZIP format. Reader source bindings become readable notes in exported XMind, rather than live foreign-reader links. No MarginNote format interoperability is implied.

For PDF text or region excerpts, use the source document's real page locator and selection geometry. No OCR is implied. Flow-document selection offsets are UTF-16 positions in sanitized content, as specified by schema. Omit selection for a text-only excerpt; Core still validates the locator and source version.

## Parameter semantics

- Strings are literal, including empty strings supplied as ''. Quote paths, titles and queries containing spaces. @filename and - are literal for string parameters.
- Booleans accept --enabled, --enabled=true, --enabled false or --enabled=false. No --no-* inference exists. A bare boolean is true. Prefer =false before positional words.
- Nullable schema fields accept the token null as JSON null. For a nullable string whose literal value must be null, use api METHOD --data JSON to disambiguate.
- Numbers use decimal/scientific numeric syntax; finite values, integer constraints and schema ranges are checked. NaN, Infinity and empty values are rejected.
- Objects and arrays accept inline JSON, @file.json or - for UTF-8 JSON on stdin. Only one typed parameter can consume stdin in an invocation. JSON must have the correct top-level type.
- Repeated options, positional/flag duplicates, unknown flags and extra positionals are errors. Options are case-sensitive kebab-case. Use -- to end option processing before dash-prefixed positional strings; an inline flag value such as --title=--help is literal.
- Global flags are --workspace DIR, --output MODE, --json, --help and --version. --version takes no command. A business text field uses --text STRING; legacy read --text and api --text retain their historical output meaning.

```sh
printf '["课程 一.md"]' | margin-reader --workspace "$MR_WORKSPACE" \
  study add "$SET_ID" --expected-revision "$REV" --paths -
margin-reader --workspace "$MR_WORKSPACE" study cards move \
  --set-id "$SET_ID" --expected-revision "$REV" \
  --card-ids '["CARD_ID"]' --parent-id null --expand-parent=false
```

expectedVersion identifies a file; expectedRevision identifies a document outline or study revision according to its method; expectedSourceVersion identifies the excerpt source. They are not interchangeable. Conflict failures require inspecting current state and making a new deliberate edit. Mailbox timeouts may mean an operation completed; they are not automatically retried.

## Global option collisions

The current schema has no business parameter whose kebab-case name collides with workspace/output/json/help/version. A schema-wide regression checks this explicitly. Global flags keep their CLI meaning. If a future public schema introduces a collision, use api METHOD --data JSON (or @file / stdin): JSON object keys are passed unchanged, and never interpreted as CLI globals. This escape hatch applies to all public methods.

## Legacy API, imports and output

```sh
margin-reader --workspace "$MR_WORKSPACE" api fs.list --data '{"path":"."}'
margin-reader --workspace "$MR_WORKSPACE" api fs.list --data @params.json
printf '{"path":"."}' | margin-reader --workspace "$MR_WORKSPACE" api fs.list --data -
margin-reader --workspace "$MR_WORKSPACE" import /absolute/source.pdf --to Books/source.pdf
margin-reader --workspace "$MR_WORKSPACE" open Books/source.pdf
margin-reader --workspace "$MR_WORKSPACE" read DOCUMENT_ID --page 1 --text
```

Import reads a caller-authorized external source, then uses public import.begin/chunk/finish requests. It preserves the source. The destination is workspace-relative. New imports and exports do not imply overwrite permission.

Business command default output and --json / --output json are compact, newline-terminated JSON-RPC envelopes, including failures. --output pretty formats the same envelope. --output text prints readable content, trees or outlines and falls back to formatted result JSON for other shapes. Legacy --text returns result.text when available, retaining its exact text content.

Text lists show at most 200 rows and depth indentation up to 20, with explicit clipping notices. API truncation/pagination is reported separately. Rendering never changes or truncates the underlying result; use JSON for all data returned by the API and follow the method's pagination contract for remaining data.

Diagnostics go to stderr. stdout contains the selected result only, with no progress decoration. Nonzero exit status indicates failure. There are no ANSI colors, so NO_COLOR is honored without configuration. A closed downstream stdout pipe exits cleanly without EPIPE stack traces. No batch-transaction or automatic-retry promise is added.

## Shell completion

Generate a script, inspect it if desired, and load it using your shell's normal configuration mechanism. The generated content is derived only from command/schema identifiers; no document text is evaluated.

```sh
margin-reader completion bash > margin-reader.bash
source margin-reader.bash
margin-reader completion zsh > margin-reader.zsh
source margin-reader.zsh
margin-reader completion fish > margin-reader.fish
source margin-reader.fish
```

Zsh requires compinit before loading its script. The generated adapters invoke margin-reader from PATH (or a shell function of that name); when running from source, define that function to invoke the absolute cli.cjs path. Bash and zsh adapters were executed against real CLI enum completions in tests. Fish is not installed in the current development environment, so its runtime verification remains outstanding. Completion follows the current command path: root groups, next subcommands, the selected method’s flags, then schema enum/boolean values. Exact dotted method names are offered when typing a dotted prefix, or after api/schema. It does not query the library, complete document IDs, or infer current revisions. Shells pass words as ordinary arguments to the lightweight _complete helper; no user input is evaluated.

## Workspace and TUI

`margin-reader tui --help`, `margin-reader --help tui` and `margin-reader help tui` print startup requirements and main keys without a workspace, Core initialization or terminal-mode changes. They use the same discovery path as other command help.

Business commands require an existing --workspace directory or AGENTS_WORKSPACE. Assigned employee scope cannot be overridden. Employee transport failures never fall back to a standalone library. Scope checks and all business validation remain in the public runtime.

```sh
margin-reader --workspace "$MR_WORKSPACE" tui
```

TUI requires interactive TTY input and output and a TERM value other than dumb. A redirected invocation fails with exit status 1 and a TTY_REQUIRED JSON error before loading Core, entering raw mode or creating workspace metadata. Use ordinary CLI commands for pipelines. TUI is loaded lazily from tui/index.cjs. For an interactive invocation, the CLI creates the client and closes it in finally; TUI owns raw-mode, bracketed-paste and signal restoration. TUI availability depends on the corresponding module being packaged. serve remains available as a separate browser-based interface.

## Verification scope

CLI product tests use real child processes and disposable temporary workspaces. They cover all schema mappings, discovery without Core initialization, legacy syntax, Unicode paths, parameter errors, pipelines, completion syntax, explicit conflicts, excerpt hierarchy, review grading, source activation, export and process restart. Host-wide acceptance remains a separate coordinated gate.

## Spatial map snapshots

`map render` is a CLI adapter to the independently packaged terminal-visuals/cli.cjs module. It injects public requests that return Core results, reads study.get and study.map.geometry, and never edits layout, cards, selection or camera state. No map.render method is added to the public runtime schema. A snapshot is not a new atomic transaction across concurrent edits.

```sh
margin-reader --workspace "$MR_WORKSPACE" map render --set-id "$SET_ID"
margin-reader --workspace "$MR_WORKSPACE" map render --set-id "$SET_ID" \
  --columns 120 --rows 36 --select "$CARD_ID" --zoom 1 --output text
margin-reader help map render
```

Defaults are 120 columns and 36 rows with fit-to-map. Dimensions must be integers from 1 to 100000, and their product must not exceed 100000 cells. Explicit zoom must be finite and within 0.02–16. Omit zoom to fit. --select is a snapshot-local card identity, not a persistent selection edit. Unknown/duplicate flags, extra positionals and invalid ranges fail before Core initialization.

Default JSON-RPC result contains text, revision, state, stats and warnings. --output pretty formats that same envelope. --output text emits the full fixed-size plain-text viewport without JSON decoration; use JSON to inspect clipping statistics and warnings. Offscreen/omitted geometry remains in Core. The adapter is loaded only when map render runs; discovery/help/completion need neither the visual module nor Core initialization.

## Final applicable-source validation — 2026-10-18

On macOS arm64 / Node 26.5.0, the final source passed check and 564/564 tests with zero failures, cancellations, skips or todo cases; its isolated compatibility build passed and included the TUI copy. The report is `artifacts/cli-product-20261018/checks/run-2026-10-18T04-59-17-644Z/results.json`: `applicableSourceStatus=passed`, required legacy host gates blocked, `overall=partial`. Actual TUI keyboard and cleanup evidence is recorded separately in [TERMINAL_WORKSPACE](TERMINAL_WORKSPACE.md). Exact installed-bin and tarball outcomes follow [CLI_PRODUCT_ACCEPTANCE](CLI_PRODUCT_ACCEPTANCE.md); source results are not substituted for package gates.

## Historical execution record — 2026-10-18, before reader/paste refinement

- Revision gate before spatial integration: 85/85 combined tests passed; documented learning workflow exited 0 with empty stderr and linked:true while automatic linkage was off.
- Spatial integration targeted run: 4/4 tests passed against the actual terminal-visuals module interface. It verified JSON/text output, 80×24 buffer dimensions, selection/zoom, invalid arguments, unwrapped request results, client close and byte-identical workspace state before/after rendering.
- Real PTY TUI check: q exited naturally with status 0, approximately 0.012 seconds after the key. stdin had zero data listeners, was paused and non-raw; SIGINT/SIGTERM listener identities matched the pre-TUI baseline. The CLI awaited client.close in finally and added no TUI signal handlers. Dependency-owned pre-existing signal handlers are preserved.
- bash and zsh completion adapters were executed, including enum completion and zsh cursor position. fish is unavailable and remains unverified at runtime.
- No forced process.exit was added. The older serve signal handler was also changed to await graceful server close and remove only its own signal listeners.

That integration gate: **89 tests, 89 passed, 0 failed**. CLI product subset: **35/35**. The PTY run in this combined gate exited approximately 0.020 seconds after q with the same cleanup invariants. The documented learning workflow, including map render, exited 0 with empty stderr. A real serve subprocess started successfully and exited naturally with status 0 after SIGTERM. These historical counts do not certify later source changes; later reader/focus and actual PTY evidence is recorded in [TERMINAL_WORKSPACE](TERMINAL_WORKSPACE.md).

Command used for the combined gate:

```sh
node --test tests/cli-product*.test.cjs tests/core.test.cjs tests/agent-contract.test.cjs tests/study.test.cjs tests/extended.test.cjs tests/batch.test.cjs tests/preview.test.cjs
```

This historical gate tested its then-current source, not a newly rebuilt clean-install package. Final source and clean-install conclusions follow the exact tarball and run-report rules in [CLI_PRODUCT_ACCEPTANCE](CLI_PRODUCT_ACCEPTANCE.md). No --scope option is exposed for map render in this revision; future geometry scope support requires its public contract.
