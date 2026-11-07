# News channels

Channels are Core-owned read-only news feeds populated by external collectors. External collection can run on the Core host, another machine, or behind a tunnel.
The renderer never calls social platforms or reads a collector's configuration files.

The deployed Linux integration and its CLI/service commands are documented in
[`Collectors/README.md`](../Collectors/README.md). YouTube channels receive
DeepSeek summaries and source links; full translations are disabled in that
worker. All Messages channel backgrounds use the original Telegram Web A pattern
with theme-specific colors, independently of whether a channel stores documents.

## Read-only employee channel API

Channels are news feeds with explicit reading grants, not employee discussion groups.
The Channel access button assigns employees who may read/search through the API;
Secretary automatically accesses and administers every channel. There are no news
discussion, moderation, automatic employee notifications or post-count tasks. The UI
shows browsing, source filters, access, search, Save, Download and subscription settings.
Group chat keeps its independent members, roles, replies and notices.

Initialized Employee/Manager/Governor discover only their authorized channels.
The user or Secretary grants/revokes readers atomically; Secretary needs no grant.
Use the existing Agent credential, without borrowing another identity:

```sh
# User or Secretary: get revision, then replace the reader list.
agents channel access CHANNEL_ID --json
agents channel access CHANNEL_ID --employees '["EMPLOYEE_ID"]' --expected-revision REVISION --json
```

```sh
agents channel list --json
agents channel get CHANNEL_ID --json
agents channel sources --query 'OpenAI' --json
agents channel source-info SOURCE_ID --json
agents channel fetch-text CHANNEL_ID --limit 50 --json
agents channel fetch-images CHANNEL_ID --limit 20 --json
agents channel search CHANNEL_ID --query 'LLM' --limit 50 --json
agents channel search CHANNEL_ID --sources '["SOURCE_A","SOURCE_B"]' --keywords-any '["AI","芯片"]' --json
# Use the returned cursor with the same channel, filters and search query.
agents channel fetch-text CHANNEL_ID --limit 50 --cursor NEXT_CURSOR --json
```

The canonical API commands are `channel.fetch-text`, `channel.fetch-images` and
`channel.search`. Arguments are `{id,limit?,sourceId?|sourceIds?,since?,until?,
timeRanges?,keywordsAll?,keywordsAny?,excludeKeywords?,cursor?}`; search also
accepts `query?` and `images?:boolean` (default false). `query` may be omitted when
`keywordsAll` or `keywordsAny` is supplied. `sourceIds` selects several authorized
sources with OR semantics; legacy `sourceId` remains accepted but the two forms
cannot be combined. `limit` is 1–100, default 20. Responses are
`{kind:"channel-messages",channelId,mode,messages,limit,total,nextCursor}`.
Messages are ordered by original publication time descending, then stable ID
descending, and include `id,sourceId,sourceName,platform,authorName,title,text,
publishedAt`, optional URL and document metadata. Text is complete, without the
browsing feed's excerpt truncation. Search matches title, text and source name.

`keywordsAll` requires every lowercased literal term, `keywordsAny` requires at
least one, and `excludeKeywords` rejects any; the groups combine with AND.
`since`/`until` accept epoch milliseconds or ISO date-times with `Z` or an explicit
offset such as `+08:00`, and bound `[since, until)`. `timeRanges` supplies up to 31
`{since,until}` windows combined with OR; using both time forms intersects them.
A cursor is bound to the channel, normalized filter and query, so following
`nextCursor` requires the same parameters. See
[CHANNEL_FILTERS.md](CHANNEL_FILTERS.md) for source discovery, pagination and
worked employee examples.

`channel.sources` searches subscribed authors by name/handle, including `query`
matching, and returns stable source IDs, original avatars and order. It and
`channel.source-info SOURCE_ID` are available to ordinary employees with a reading
grant. `channel.source-info` returns the author/channel profile (name,
handle/locator, linked channel and platform URL), original avatar, retained count,
latest publication time and subscriber count when available; it never starts
collection. `channel.source-order CHANNEL_ID` is readable by every authorized
reader. Reordering with `--sources JSON --expected-revision N` is reserved for the
user or Secretary and changes only display order, not subscriptions or articles.

Text mode never loads image bytes. Image mode additionally includes
`images:[{id,mimeType,data}]`, where `data` is base64 for CLI/HTTP clients.
The built-in native API tool delivers real text/image content blocks through
Claude, Codex MCP, Cline MCP and Pi, with message/image IDs associating each image
with its text. Server previews use a 640-pixel maximum edge; originals remain
available through the user's Download action. Vision understanding still depends
on the employee's configured native model.

Pages are bounded to 2 MiB text, 32 images and 8 MiB decoded image bytes; a page
may contain fewer than `limit`. Follow `nextCursor` to continue without omissions
or duplicate messages. A single message exceeding a response budget reports an
explicit error. Document metadata never downloads the original document.

Reading requires a channel grant, except for the user and Secretary. User Save and
human read acknowledgment are not needed, and no task dispatch or model call occurs.
Explicit API retrieval authorizes putting the fetched
content in the employee's native context/history; it does not automatically Save
an article, mark it read, or create a local channel-content file. Normal channel browsing remains
memory-only. Explicit Save/Download and other user-facing business APIs are also
available to Secretary; these never happen as a side effect of reading.

Automatic Channel, Board and Posts acknowledgment only covers entries whose end is visible in the active foreground. Explicitly clicking the Channel down-arrow also marks the current source selection (or all sources) read, including unloaded history, using `channel.acknowledge {all:true,sourceIds?}`. Search/saved results and programmatic scrolling never perform that bulk action. A failed write retains its unread count and exposes retry; new arrivals remain unread. Board detail follows the same visible-end rule,
and source/view switches share the read state of the same entry ID. Unread badges
show the real count without a `99+` cap.

Channel `message-send/message-post`, employee publishing engines, `channel.update`
with `adminIds`, channel member/role/moderation/notice writes and post-count rule
writes are rejected. Existing legacy records/files are retained, without automatic
news delivery or post-count execution. `channel.context` returns enabled source IDs and the exact text/image/search API
routes; select one or more authors inside a platform aggregate with `sourceIds`.
Use explicit fetch/search for news; old discussion history is not the news feed.

## External collectors and channel identity

External engines require a process name and local/remote location. Remote engines additionally
require the process IP/hostname and a Core receiver URL reachable **from that process**:

```sh
agents channel create --name 'Cloud news' --engine '{"kind":"external","location":"remote","name":"News worker","host":"203.0.113.10","endpoint":"https://core.example.com/api/channels/collector"}' --json
agents channel connection CHANNEL_ID --json
agents channel collector-add --name 'Replacement worker' --channel CHANNEL_ID --json
```

`host` records where the process runs; `endpoint` is where it pushes messages, not an SSH
address or the process's own API. Core does not deploy, log into, or start the cloud process.
The local collector listener remains loopback-only and disabled until explicitly enabled.
Use an HTTPS reverse proxy or an HTTP loopback tunnel for remote access. Saving a host does
not prove reachability. Connection status reports unconfigured, waiting, the last successful
authenticated request, or a revoked credential; it never asserts that a quiet worker is online.

Creation returns a dedicated token once in `setup`, unless an active collectorId was chosen.
Pass it as `Authorization: Bearer TOKEN` to the receiver using a POST body `{cmd,args}`.
Read `channel.collector-config` for source IDs; publish using `sourceId`, not an employee
channelId. A custom process has a generic `process` source. Telegram/X/YouTube keep their
existing adapters and may use social sources routed into an external channel. Once explicitly
bound, only the selected collector credential may publish that channel's external sources;
a legacy wildcard token does not bypass the binding and cannot reach employee sources.
Replacing the channel credential invalidates the old credential's access to this channel
without revoking unrelated channels. Tokens are not returned by later channel reads.
Existing channels retain their source-scoped compatibility and show an unconfigured origin
until explicitly configured; no fictitious host is inferred.

Names and avatars are independent of source/article metadata. Upload PNG/JPEG/GIF/WebP up
to 8 MiB as `avatar:{name,mimeType,data}` during create/update. Original validated bytes are
stored independently of news expiry. `channel.avatar-image {id}` reads the image; the channel
view projects `{channelId,sourceId:channelId,sha256}`. A custom image overrides any platform
icon. Send `avatar:null` to restore the platform/default image. Updating engine location,
connection, name or avatar supports expectedRevision; a stale save preserves the
UI draft and offers an explicit reload. Engine kind itself is fixed after configuration.

## Ownership and routing

- Core persists subscriptions, routes, read IDs and explicit saves under
  `AGENTS_COMPANY_HOME/channels`. Unsaved content and original author images are
  held in Mac memory and the Linux server only. An archive `read-mark` writes the
  Mac read IDs and forces a new summary/broadcast only after Core confirms the
  read-mark is persisted; it does not attach an older in-flight summary, and a
  failure neither fakes a read nor prevents retry. The Mac keeps only read IDs and
  other metadata, never news bodies.
- Telegram, X and YouTube each start with one aggregate channel. An X or YouTube author can be moved to any external-engine channel;
  all their retained articles, including saved articles, follow the route immediately.
- Unfollowing disables collection while preserving the author's identity and saved
  articles. Re-following reuses that identity.
- Worker authentication, platform cookies and plugin options stay on the worker.
  Import only public target fields: `targetId`, `plugin`, `locator`, `name`, `enabled`
  and `pollSeconds`. Preserve disabled entries and existing target IDs.
- Categories are personal collections of conversation references. They can mix
  private chats, groups and channels, and overlap. Deleting a category does not delete
  its contents. All is the only built-in category.

An article's stable identity is its source ID and external item ID. History has
no age TTL. Each social platform has its own 1 TB budget and pressure removes
the oldest unsaved/unrequested items first. Saved/downloaded content is protected.
Core fetches only indexed pages and keeps bounded RAM caches. Explicit Save and
Download persist channel content on the Mac; deliberate employee API retrieval may also
persist the returned content in that native engine's own history. Deleted identities
remain authoritative and cannot be revived by collector retries.

## Views and native author images

Telegram, X and YouTube each appear as one aggregate channel. Every channel, including future platform/process channels,
offers Channel, Board and Posts. Old Posts preferences migrate to Board.
Board uses a Xiaohongshu-style masonry layout with covers, short titles and round
author images. Posts uses a vertical timeline, refresh/pull-to-refresh and
infinite scrolling. Each refresh has stable ranked pages and avoids the previous
first item when alternatives exist. No engagement counts are fabricated.

Posts and subscription rows use original platform-author images. X can reuse
verified original author images from collected records, and YouTube uses the
public channel image. A missing/unreachable profile is not replaced with a
fabricated author portrait. These bytes remain in Mac RAM unless saved.

## Collector connection

The dedicated listener is disabled by default and binds only to Core loopback.
Enable it with the operator CLI, then inspect the returned `runtime.listening` field:

```sh
agents channel settings --patch '{"enabled":true,"port":5152}' --json
agents channel settings --json
```

Create a dedicated credential with `channel.collector-add`. Its token is returned
once; store it in a worker-readable file with mode `0600`. Never copy the company's
`control.token` to a collector. `channel.collector-revoke` disables one connection
without changing subscriptions or articles.

The service uses `POST /api/channels/collector` with `Content-Type: application/json`,
`Authorization: Bearer <collector token>`, and a body containing `{cmd,args}`. Only
the following operations are available through this listener:

1. `channel.collector-config`: fetch public subscriptions on startup, then pass
   `sinceRevision` to poll for changes. Reconcile by stable source/target IDs.
2. `channel.media-put`: upload image bytes, including optional author avatars,
   associated with a source and external article ID. Core does not fetch arbitrary
   remote image URLs. PNG, JPEG, GIF and WebP are accepted, up to 8 MiB each.
3. `channel.publish`: publish the article using the returned media IDs. A body may
   be empty for an image, title or source-link-only item. An avatar alone is not news.
4. `channel.source-avatar-put`: replace the original source identity image independently
   of article retention. It uses the same image validation and source capability;
   an identical hash is a no-op. No message or administrator operation is exposed.

5. `channel.collector-ack`: confirm the delivered subscription revision only after
   the runtime scheduler applies it.
6. `channel.storage-exchange/result`: only the configured all-source storage
   credential can service issued channel-content requests. No general Core or
   terminal permission is granted.

Responses use `{ok:true,data}` or `{ok:false,error,code}`. A successful publish reports
`created`, `updated`, `duplicate`, `deleted` or `expired`. Treat the last two as final
for that article. If an upload returns `POST_DELETED` or `POST_EXPIRED`, stop uploading
its remaining media and reconcile through publish. Other failed operations remain
retryable; do not acknowledge publication before Core confirms it.

See [API.md](../API.md) for complete request/response fields and
[PERMISSIONS.md](../PERMISSIONS.md) for the capability boundary.

For another host, expose only this listener through an authenticated deployment
transport, such as an SSH reverse forward or an HTTPS reverse proxy. The collector's
endpoint remains ordinary HTTP/HTTPS; SSH details are not part of its business API.
An SSH deployment should own a separate connection (`ControlMaster=no`,
`ControlPath=none`) so restarting the bridge cannot terminate an unrelated session.

## Xhs service adapter

The external Xhs service's managed mode uses `app.agents`. In `config/app.yaml`,
add the following top-level section alongside the existing application settings:

```yaml
agents:
  enabled: true
  endpoint: http://127.0.0.1:5152
  token_file: ../runtime/secrets/agents-collector.token
  poll_seconds: 5
```

The endpoint is resolved from the worker, so a remote deployment may point at the
worker end of a tunnel. The service fetches Core subscriptions before starting its
scheduler and applies later changes while running. Its target YAML becomes a
replaceable cache; local subscription mutation is disabled in managed mode. Cached
configuration is only reusable for the same endpoint. Existing worker secrets,
collection logic and worker-side cleanup remain local. YouTube enrichment runs on
the worker: download the cover and complete audio, transcribe with its local Whisper
model, then use DeepSeek for a Chinese summary. Full translations are disabled.
Only the finished article and images are published. Preparation is checkpointed; completed original audio/transcripts are removed.
Review, scoring and publication to public social accounts remain disabled.

An already published title-only YouTube item is completed by updating its original
source/external identity and publication time with a new content hash. This preserves
the Core article ID, saved state and archive capacity policy. Deleted or
expired articles are never recreated. The Core requires no ASR or model credentials;
the worker uses its existing private DeepSeek key file (or `DEEPSEEK_API_KEY`).

Before switching an existing service, make private rollback copies of its exact
configuration, import public targets without replacing existing Core choices, test
the dedicated connection, and then restart the service once. Verify configuration
revision, new articles and original image bytes after startup. If Core is temporarily
unreachable, pending publication retries must not be recorded as successful.

## Reading and export

Private messages, group messages and news share GFM Markdown and offline KaTeX
rendering. Copy and forwarding preserve original source text. Formula selections
are excluded from precise text quoting rather than creating an incorrect range.
Message action rails stay within their message and follow the visible reading area.

Downloads contain `story.md` and original local images in a self-contained `.tar.gz`.
Web clients use the authenticated download endpoint; desktop clients use the native
save dialog. Export staging files expire after one hour, independently of saved news.

## Verification

Deterministic Core/API/integration tests use isolated homes. Renderer tests cover
mixed categories, source moves, saved navigation, downloads, formula rendering and
sticky actions. `test/channels-collector-live-test.mjs --confirm-live` is an opt-in
cross-host read/publication probe against a disposable Core. Set
`AGENTS_COMPANY_COLLECTOR_PROBE` to a private JSON configuration containing the
authorized `host`, `project`, `probeScript`, and three existing `recordIds` (Telegram,
X, YouTube). It does not change real collector configuration or publication marks.

## Server retention and on-demand magazines

Configure the existing SSH host and all-source collector with `channel.storage`.
The server store has independent 1 TB budgets for X, YouTube and Telegram,
without age expiry. Oldest unsaved/unrequested entries are evicted only under
capacity pressure; explicit saves and requested documents remain protected. The Mac verifies complete server
row/image hashes before erasing legacy unsaved local copies. A server outage
never creates a local disk fallback.

Telegram documents are metadata-only during collection/listing, including no
automatically generated full-file previews. Click Download to retrieve the
original on Linux, then transfer it to the Mac channel workspace with exact
size/SHA-256 checks. Progress distinguishes server retrieval and Mac transfer.
The server retains that requested copy; repeat downloads reuse it. The Mac file
survives message expiration. Existing documents in legacy `engine.fileStorage`
remain compatible. Read [API.md](../API.md#channel-views-memory-policy-and-cloud-documents)
for CLI and transport fields.

Channel, Board and Posts share one searchable, multi-select source bar directly
below the main toolbar. `All sources` and specific sources are mutually exclusive;
selecting `All sources` again restores the previous source selection. Source chips
drag to reorder (or use Alt + arrow keys), and the order persists across restarts
through `channel.source-order` without changing subscriptions. Author avatars open
independent author information. Board and Posts offer manual refresh; Channel has
no refresh button. The bar uses complete subscription metadata, not the currently
loaded article page. Changing sources uses Core `sourceIds` paging and keeps the
platform identity. No status/retention caption or loaded-item banner separates the
bar from the toolbar. `channel.aggregate --plugin telegram` consolidates compatible
empty legacy wrappers and keeps aliases for their old links and personal
organization.


## Telegram wallpaper colors

Messages settings exposes the original Telegram Web A light/dark gradients and all twelve solid color chips, plus pink/purple/blue/gray variants and custom one-to-four RGB colors with rotation. `settings.set {messageWallpaper:{pattern:"telegram",palette:"pink"}}` selects the same palette as the UI; use `palette:"custom",colors:["#c6c1ed","#edc7dd"],rotation:90` for a gradient. Channels reuse the original Telegram SVG; a static64x64 gradient uses the upstream resting blend with no animation loop or network request. These are bundled decoration/configuration, not a cache of channel content.
