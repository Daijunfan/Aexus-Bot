# Channel employee filters

This page is the practical reference for employees reading authorized channels.
It complements [CHANNELS.md](CHANNELS.md); command schemas remain authoritative in
[API.md](../API.md) and permissions in [PERMISSIONS.md](../PERMISSIONS.md).

## Source discovery and order

An ordinary employee needs a reading grant for the channel. Secretary always has
access. Once authorized:

```sh
agents channel sources --query 'OpenAI' --json
agents channel source-info SOURCE_ID --json
agents channel source-order CHANNEL_ID --json
```

- `channel.sources --query` searches subscribed authors by name or handle in
  channels the employee may read. It returns stable source IDs, original avatars
  and their current order.
- `channel.source-info SOURCE_ID` returns the author/channel profile details
  (name, handle/locator, linked channel and platform URL), original avatar,
  retained article count, latest publication time and subscriber count when
  available. It never starts collection.
- `channel.source-order CHANNEL_ID` is readable by every authorized reader.
  Reordering with `--sources JSON --expected-revision N` is limited to the user or
  Secretary and changes only display order. It does not change subscriptions,
  routes or retained articles; omitted sources keep their relative order after
  the supplied ones.

## Filter groups

`channel.fetch-text`, `channel.fetch-images` and `channel.search` (plus GUI/HTTP
callers) share these filters:

| Field | Semantics |
| --- | --- |
| `sourceIds` | OR across selected sources. Legacy `sourceId` still works; do not send both. Every ID must belong to the channel. |
| `since`, `until` | Half-open `[since, until)` publication window. Epoch milliseconds or ISO date-time with `Z` or an explicit offset such as `+08:00`. |
| `timeRanges` | Up to 31 `{since,until}` windows combined with OR, for several separate days. |
| `keywordsAll` | Every lowercased literal term must occur. |
| `keywordsAny` | At least one term must occur. |
| `excludeKeywords` | No term may occur. |

All groups combine with AND. Time filters use original publication time. Keyword
groups search the title, body and source name. Using both `since`/`until` and
`timeRanges` intersects the two time constraints. `channel.search` may omit
`query` when `keywordsAll` or `keywordsAny` is present; terms are literal
substrings, not regular expressions.

Use only absolute instants in the API. `system.info` exposes the Core clock
(`unixMs`, ISO and IANA `timeZone`) as a reference; honor a user-specified timezone.
Employees must resolve relative dates and
phrases such as "around 3 PM" in the user's timezone, state the chosen window in
the answer, and must not expect the API to parse natural language. For example,
"around 3 PM" may be expressed as 14:30–15:30 only if that is the intended window.

## Worked example

The fixed reference day below is **2026-11-05** and the dates are illustrative
only. The user asked for yesterday and the day before yesterday, 14:30–15:30
Asia/Shanghai (+08:00), mentioning OpenAI and either finance or economics. That
resolves to 2026-11-04 and 2026-11-03:

```sh
agents channel search CHANNEL_ID \
  --sources '["SOURCE_ID_A","SOURCE_ID_B"]' \
  --time-ranges '[{"since":"2026-11-04T14:30:00+08:00","until":"2026-11-04T15:30:00+08:00"},{"since":"2026-11-03T14:30:00+08:00","until":"2026-11-03T15:30:00+08:00"}]' \
  --keywords-all '["OpenAI"]' \
  --keywords-any '["金融","经济"]' \
  --limit 100 --json
```

`SOURCE_ID_A` and `SOURCE_ID_B` are placeholders; replace them with IDs returned
by `channel.sources` from the authorized channel. This example is documentation
only and must not be run against production content.

The call means `(source A OR source B) AND (window 1 OR window 2) AND OpenAI AND
(finance OR economics)`, newest first. To continue, pass the returned
`nextCursor` with exactly the same channel and filter groups:

```sh
agents channel search CHANNEL_ID \
  --sources '["SOURCE_ID_A","SOURCE_ID_B"]' \
  --time-ranges '[{"since":"2026-11-04T14:30:00+08:00","until":"2026-11-04T15:30:00+08:00"},{"since":"2026-11-03T14:30:00+08:00","until":"2026-11-03T15:30:00+08:00"}]' \
  --keywords-all '["OpenAI"]' \
  --keywords-any '["金融","经济"]' \
  --limit 100 --cursor NEXT_CURSOR --json
```

## Pagination and output budgets

`limit` is 1–100 (default 20). Always follow `nextCursor` until it is null; never
report only the first page as a complete result. A cursor is bound to the
channel, the normalized filter and `query`, so changing any filter starts a new
read. Pages may contain fewer than `limit` messages.

Text pages are bounded to 2 MiB. Image modes (`channel.fetch-images`, or
`channel.search --images`) are additionally bounded to 32 images and 8 MiB of
decoded image bytes per page. A single message over budget reports an explicit
error rather than silently truncating. Native API tools return real image blocks;
CLI/HTTP return base64.

## Mac behavior

The Mac channel store keeps unsaved channel content in RAM only. Employee reads
do not automatically Save, Download, mark user read receipts, or start
employees/tasks. Saving and downloading remain explicit user actions.

## Employee-facing UI

Channel, Board and Posts share one searchable, multi-select source bar. `All
sources` and specific sources are mutually exclusive; choosing All again restores
the previous selection. Chips can be dragged into order (Alt + arrow keys also
work), and the order persists across restarts. An avatar opens independent author
information. Board and Posts can be refreshed manually; Channel has no refresh
button.
