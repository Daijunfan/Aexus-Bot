# Group collaboration

A group is a shared collaboration space for existing Aexus employees. It is independent of a Aexus Team, native Coding Agent session, and Mission. The desktop, browser, CLI and native MCP tool use the same authenticated Core operations. No feature in this document needs a Telegram account, Telegram server, or billed model request to manage its state.

## Identity and appearance

Click the group title to open its overview, members and topics. The group portrait remains a mosaic of up to four actual members. An Owner/Admin can set a name, description and one of eight group colors. Content types have distinct visual accents: media, audio, files, links, saved messages and pins. The surrounding Message theme, wallpaper, floating sidebar, rounded header and input remain the user's chosen appearance.

`chat.details` returns the profile, `details.revision`, current authority and counts. `chat.details-update` accepts an atomic patch and that independent revision. Receiving a message or acknowledging it does not invalidate a profile edit. A legacy `chat.update` rename also advances the profile revision. `chat.member-tag` sets a visible local label; labels never appoint an Admin or Aexus role.

```sh
agents chat details GROUP_ID --json
agents chat details-update GROUP_ID --patch '{"description":"Decisions and delivery","color":"ocean"}' --expected-revision 1 --json
agents chat member-tag GROUP_ID --employee EMPLOYEE_ID --tag 'Design lead' --json
```

## Topics and threads

`General` includes all pre-topic history. Enabling topics does not migrate or duplicate messages. Topics have names, icons, colors, pin/closed/archive state and their own revision. An ordinary member needs the topic-creation permission; creators may manage their own topics, while only Owner/Admin can pin them. General cannot be archived. Archiving a topic keeps its history; closing it prevents new Member posts while Owner/Admin can still post.

`chat.send`, `chat.post`, `chat.history` and `chat.get` accept `topicId`. Replies inherit the original topic; explicitly replying in another topic is rejected. Existing topic history remains accessible if navigation is turned off. A new Admin-created topic enables navigation. Archived topics remain readable, show a clear read-only state and keep their existing drafts.

`chat.thread` resolves the actual root and nested replies and pages with `before`/`limit`. The interface has a separate discussion drawer with files, images, voice recording, formatting and a durable thread draft. It adds no second history: replies are real group messages linked by `replyTo`.

```sh
agents chat topic-create GROUP_ID --name Release --icon '🚀' --color rose --client-request-id release-topic-1 --json
agents chat topic-list GROUP_ID --include-archived --json
agents chat post GROUP_ID --topic-id TOPIC_ID --text 'Review ready.' --client-message-id review-1 --json
agents chat thread GROUP_ID --message-id MESSAGE_ID --limit 40 --json
```

Reading one topic updates its watermark only. Reading a thread uses exact message IDs, leaving unseen siblings and other topics unread. The aggregate group badge disappears only after all relevant incoming messages have been read. This remains separate from employees acknowledging receipt of assigned work.

`chat.acknowledge` accepts one `messageId` with optional `topicId`, or `messageIds` (1–200 exact IDs). `exact:true` also makes a single acknowledgment exact. These operations remain user/Secretary operations; an employee cannot mark the user's messages read.

Draft scopes reuse `messenger.draft`: `messages`, `topic`, `thread` and `form`. A non-General topic draft is returned under `topic:TOPIC_ID:group:GROUP_ID`, a thread under `thread:ROOT_ID:group:GROUP_ID`, and a poll/checklist form under `form:poll-TOPIC_ID:group:GROUP_ID` or `form:checklist-TOPIC_ID:group:GROUP_ID`. General and All topics share the ordinary group composer. The send identity and conditional clear protect newer drafts from an older accepted response. Forms survive closing and restarting without replacing a normal message draft.

## Polls, quizzes and checklists

`chat.poll-create` publishes a real interactive message as the caller. The spec supports 2–50 distinct answers, single or multiple selection, anonymous/public voting, changing or withdrawing votes, optional member-added answers, a timezone-qualified close time, hidden results and quizzes with correct answer indices and an explanation. A quiz cannot accept additional answers. The same caller/request ID and unchanged input returns the original card rather than publishing again.

```sh
agents chat poll-create GROUP_ID --spec '{"question":"Which direction?","options":[{"label":"Ocean"},{"label":"Forest"}],"anonymous":true,"multiple":false}' --client-request-id design-poll-1 --json
agents chat poll-get GROUP_ID --poll-id POLL_ID --json
agents chat poll-vote GROUP_ID --poll-id POLL_ID --options '["option_0"]' --json
agents chat poll-close GROUP_ID --poll-id POLL_ID --expected-revision 2 --json
```

The Core derives the voter from authentication. Raw vote maps and anonymous identities are never returned in public messages or poll results. A quiz's correct answers stay private until the caller has answered, or until closing; `hideResults` keeps them private until closing. The creator or Owner/Admin closes a poll. An expired unpublished attempt must receive a new closing time instead of publishing a stale closed poll. Equal votes and repeated closes are safe to retry.

Checklists have 1–100 items, optional current-member assignees and timezone-qualified due dates, completion actors/times, and separate add/complete permissions. Checking a box is immediate in the UI and rolls back on failure. Edits preserve existing completion state. `expectedEditRevision` checks definitions independently of checkbox activity; legacy `expectedRevision` remains supported. New items in an edit may carry a stable `item_UUID` ID to make a repeated append safe.

```sh
agents chat checklist-create GROUP_ID --title 'Release readiness' --items '[{"text":"Review design","assignee":"EMPLOYEE_ID"},{"text":"Verify restart recovery"}]' --client-request-id release-list-1 --json
agents chat checklist-check GROUP_ID --checklist-id CHECKLIST_ID --item-id ITEM_ID --done true --json
```

A completed checklist item is not a successful Mission. `mission.*` still requires its own explicit success action. Private/group `question.*` decision cards also retain their separate blocking, timeout and Other-answer semantics; a poll does not answer or unblock one.

## Shared reactions and pins

`chat.react {id,messageId,emoji,selected}` records the real caller's reaction, with at most three emoji selections per message. Repeating the same selection does not increase the count. Public history returns aggregate counts, names and the caller's selection. The menu includes a full local emoji picker.

`chat.pin {id,messageId,pinned}` pins for the whole group. Owner/Admin or a member explicitly granted pin permission may change shared pins. Multiple pins, the pin strip and the shared-content search use the same public state. Existing personal saved messages, pins, reactions and hidden preferences are retained; a shared group action does not silently change another employee's identity.

## Content browser and files

The shared-content panel links directly from the group overview and header. It includes media, audio/video, unique files, links, saved messages and pins. Search and file lists support exact sender, date range and topic filters, with real totals and pagination. Historical image browsing keeps the same filters. Searching does not mark messages read.

Files can be staged for sharing from the panel and reviewed in the existing composer. File actions include preview when supported, download, go to message, selection, sorting, recoverable Trash, restore and Undo. The Core rechecks current membership and exact file versions. Same-version deletion retries reuse the recovery record. Restore never overwrites a replacement file at the old path. Shared file permissions remain equal for current group members. File deletion and message removal are distinct operations.

`conversation.files` adds `topicId`, `authorId`, numeric `from`/`to` timestamps to its existing filter/sort/pagination contract. `messenger.search` and `messenger.gallery` support the same group-only constraints. `author` still accepts `all`, `you`, `employee`; `authorId` selects a specific identity (`operator` or employee ID).

## Message removal, recovery and retention

`chat.message-trash` removes 1–200 selected messages for everyone using each message's `expectedRevision` (0 before the first edit). Authors may remove their own messages; Owner/Admin may remove any. The visible record becomes a tombstone with its identity, author, sequence and delivery receipts. A separate recovery ledger keeps the original body and attachment references. Search and exports exclude removed content.

`chat.trash` lists recoverable records permitted to the caller. `chat.message-restore` restores by tombstone revision without replaying a task or overwriting newer message changes. Both actions are retry-safe. Removing an unread message dismisses its own badge while leaving unrelated unread messages and employee delivery receipts intact. `chat.clear-history` requires Owner/Admin, `confirm:true` and a captured `through` sequence; new messages arriving after that boundary are retained. Neither removing a message nor clearing history cancels employee work that already accepted the original prompt, deletes a native transcript, or unlinks user files.

Auto-delete is configured by `autoDeleteSeconds` (0 disables; otherwise at least 60 seconds). It applies to new messages, including static notices, and stores the expiry on each accepted message. Maintenance checks on startup and every 30 seconds. Expired content becomes recoverable removed content; restoring it starts the current retention period again. Changing the setting does not retroactively expire older messages.

## Membership, permissions and invitations

Existing `conversation.policy/member/role/mute/silence/audit` remain authoritative. Aexus rank, a member tag or a group color does not grant a conversation office. Only Owner transfers ownership; the user and Secretary retain application-administration rights. An Owner must be transferred before removal or ban.

`conversation.policy.policyRevision` is independent of normal message/read activity. New clients send `expectedPolicyRevision` with the existing `expectedRevision` on member/role/mute/silence writes. The Core uses the policy version when supplied, preserving strict conflict detection; old clients retain the original revision behavior.

The group profile controls ordinary Member text, media/files, poll/checklist creation, topic creation, invitation creation and pinning. Defaults preserve existing text/media/poll rights; topic creation, invitations and pinning require a grant. Slow mode enforces a minimum Member posting interval; Owner/Admin are exempt. Announcement-only groups use the existing Mute Members control. Read access and private work remain independent of posting restrictions.

Local invitations admit existing authenticated employees. A code does not sign in, create an employee, confer Aexus rank, change an execution host or appoint an Admin. Invitations support a name, expiry, use limit, revocation and optional approval. Ordinary Members can create invitations only when explicitly permitted, and can see/revoke only their own links. The creator's current authority and Agent credential are rechecked at redemption.

```sh
agents chat invite-create GROUP_ID --name 'Design review' --approval true --use-limit 4 --client-request-id review-invite-1 --json
agents chat join GROUP_ID --code INVITATION_CODE --json
agents chat join-requests GROUP_ID --json
agents chat join-decide GROUP_ID --request-id REQUEST_ID --approve true --expected-revision 1 --json
agents chat ban GROUP_ID --employee EMPLOYEE_ID --banned true --json
```

`chat.join` uses the authenticated employee; user/Secretary may explicitly choose an existing employee. Approval requests persist across new messages and restart. Approval rechecks current invitation availability, employee, ban and capacity. A ban removes membership and prevents rejoining through both invitations and legacy member-add APIs. Unbanning does not silently add membership. Accepted invitation use counts are committed with the membership change, so a stopped response cannot consume a second use. Group profile, topics, membership, invitations, pins and message recovery join the existing audit trail. Metadata, read receipts, reactions, pins and recovery events never masquerade as a new `message.received` event or replay employee work.

## Formatting, stickers, announcements and exports

The shared formatter supports Markdown, links, lists, code blocks, tables, math, strikethrough, `++underline++` and `||hidden text||`. Hidden text is a visual spoiler with a keyboard-accessible reveal action, not encryption. Raw HTML and code remain literal. The quote projection uses the same inline formatting so selected excerpts retain correct offsets. Emoji search and reactions work locally.

Local sticker packs accept signature-checked PNG/JPEG/WebP and animated GIF images up to 2 MiB. Use `messenger.sticker-list/save/image/remove`. Import and collection management do not send a message. Choosing a sticker stages an ordinary authenticated image upload in the group draft; sending remains explicit. Shared images are independent copies, so removing a sticker from the library does not break past messages. Thumbnail reads are lazy and limited to the current viewport.

The Announcements section reuses `conversation.notice-*`: publish fixed text now, once, at an interval, daily or weekly, with timezone/DST preview, pause/resume, history and durable occurrence identities. Its actual Agent publisher and current rights are preserved; a notification is not a Plan task or a model request. Quiet notifications suppress its attention banner. The group overview also stores a personal all / replies-and-questions / off notification preference through `messenger.conversation`; this does not mute members or mark messages read. In-app notifications link to the actual message and do not open or focus a desktop window. Group members/roles and ownership remain in the same settings dialog.

`chat.export` returns paged published message content and attachment references without internal retry keys, delivery delegation, credentials or private votes. The UI downloads JSON or a standalone escaped HTML transcript. Exports do not fetch external images, load remote scripts or execute Markdown. Actual attachment download is an explicit separate operation.

Content protection rejects app forwarding, cross-conversation quoting, exports, downloads and shared-file copies out of the group, including direct CLI calls. It does not claim to stop screenshots, an operating-system file copy, or an already received native model context. This is a trusted local workstation, not a DRM boundary.

## Comparison scope and verification

The local group comparison covers identity, themes and portraits; text/rich text, emoji/stickers/media/files; replies/quotes/threads/topics; polls/quizzes/checklists; shared reactions/pins/search/organization/drafts/read state; roles/permissions/mutes/slow mode; local invitation approval/bans/audit; scheduled fixed announcements; removal/recovery/retention/content protection and exports. Existing capabilities use their established Core APIs rather than duplicate UI state.

Telegram's phone-number accounts, address book, public discovery/username links, Telegram-hosted bots/mini-app services, translation/transcription services, server/cloud synchronization, live voice/video calls/streams, paid gifts/stars/boosts, sponsored messages and premium service entitlements require external services and are outside this local group implementation. Aexus groups have a deliberate limit of 200 employee identities, rather than Telegram's public-community scale.

Reference scope is based on the [Telegram FAQ](https://telegram.org/faq), [official thread protocol](https://core.telegram.org/api/threads), [official poll protocol](https://core.telegram.org/api/poll) and [Telegram Web feature inventory](https://github.com/TelegramOrg/Telegram-web-k/blob/master/TELEGRAM_FEATURES.md). This comparison is a feature map, not a claim that subjective design quality or every Telegram service has been verified as equivalent.

Engineering acceptance lives in `test/group-collaboration-core-test.mjs`, `test/group-rebuild-ui-test.mjs` (hidden desktop and headless browser), the existing group/file/receipt/forwarding/announcement suites and CLI/schema/translation checks. Run `npm run test:group-collaboration` after building. Test state, workspaces and native protocols are isolated; production conversations and billed model calls are not test fixtures. Platform reports must state what actually ran; a macOS result does not establish Windows/Linux desktop support.
