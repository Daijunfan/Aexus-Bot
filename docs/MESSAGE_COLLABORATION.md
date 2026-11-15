# Message collaboration API

## Native conversation, published direct messages and explicit group publication

**Default reply is native.** A Team/CLI input or an input without a private/group
source tag is answered with ordinary Coding Agent text in Team. Do not publish a
private message unless the current input carries a private source tag or the user
explicitly requests private delivery. Message private inputs contain
`[Aexus Bot message source]` with `conversationType:"private"` and
`replyVia:"direct.post"`; group inputs contain `from [group: NAME]` and a
`[Group request]` with the real group ID. Mission work defaults to a native result
unless its task specifies publication. A following untagged input returns to the
native default even after private or group work. API/tool descriptions do not
override the actual input source. These tags route replies and never grant authority.

All native Agent text, reasoning, tool calls/results and completion events belong
only to that employee's full Aexus native conversation. The same is true of every
group/shared input, channel input and silent/awareness read: these inputs and their
exact Aexus wrapped prompts are recorded in Team and are never projected into a
Messages direct conversation.

Messages direct conversations are an independent published ledger. A direct entry
exists only when the user or Secretary explicitly calls `direct.send`, or when the
authenticated employee explicitly calls `direct.post`. Native output alone never
publishes a direct message. For a tagged Message private reply, do not call
`session.send/enqueue` on yourself or rely on ordinary output to publish that reply.
`session.send/enqueue` assign native work whose ordinary output remains in Team.

Only an explicit authenticated `chat.post` or `agents_company_discussion_post`
call publishes a group reply. `direct.post` addresses only the caller's own user
conversation; it never assigns work to another Agent, posts to a group, or fans out
to group members. When the user asks in a group for a private answer, call
`direct.post`. When the user asks for a group summary and private details, publish
only the intended summary through the group API and send the private details with
`direct.post`. Assistant text, JSON, reasoning, tool results and completion events
never become group messages by themselves.

Every group publication reaches current recipients once. User mentions/replies
select work recipients; unmentioned members and recipients of employee reports
read silently, with no tools or automatic follow-up work. Reading acknowledgments
are internal protocol, not user-visible private speech. A new deliberate task or
API publication remains possible; there is no recursive relay of native answers.
Stable client request IDs deduplicate retries, and membership/mute/revocation are
rechecked by Core.

Current scope: group chat only. Channels are read-only news feeds: member/role,
moderation, notice and post-count writes are rejected; legacy records remain
readable for compatibility and active count rules are paused. Legacy channel records are for historical inspection, not supported write workflows.
Employees use [channel fetch/search](CHANNELS.md#read-only-employee-channel-api)
without joining or saving.

`conversation.entry` and `conversation.download` also honor the current
`channel.access` reading grant for news articles and attachments; Secretary is
automatically authorized. Revocation applies again while an asynchronous download
is running. The default destination is the employee's personal Team workspace,
including its actual cloud execution host. Reading a channel does not create a
channel member folder or grant access to user-downloaded files in its workspace.
The user's explicit document downloads retain their files and completion status
across restarts, independently of the news held in memory. Image-only and file-only
`direct.post` entries remain visible, searchable and downloadable without text.

## Published direct-message API

### User and Secretary input: `direct.send`

`direct.send {employee,text?,images?,files?,mode?,clientMessageId?,replyTo?,replyQuote?,replyConversation?,replyTextOnly?,viewId?}`
publishes one user-authored entry in the employee's direct-message ledger and
dispatches or queues the matching work in that employee's existing native session.

| Field | Meaning |
| --- | --- |
| `employee` | Required exact employee ID. |
| `text` | Optional text, up to 100,000 characters. |
| `images`, `files` | Optional own workspace paths, with no fixed combined attachment-count cap. |
| `mode` | `enqueue` (default), `send` or `steer`. `send` dispatches immediately in the existing native session; `enqueue` queues it; `steer` appends to the active native turn and rejects attachments. |
| `clientMessageId` | Optional stable retry key up to 160 characters. Core generates one when omitted; persist an explicit key to retry safely and query acceptance. |
| `replyTo`, `replyQuote`, `replyConversation`, `replyTextOnly`, `viewId` | Existing reply/view references, validated by Core. |

Only the user or Secretary may call `direct.send`. An Agent cannot use it on
itself; an employee replies with `direct.post`. The entry carries delivery evidence
`preparing`, `queued`, `accepted`, `failed` or `interrupted`.
`direct.send-status {employee,clientMessageId}` reads that acceptance without
reopening an engine or replaying work. An identical retry with the same key and content returns the same
receipt; changed content with that key is rejected.

### Employee publication: `direct.post`

`direct.post {text?,images?,files?,replyTo?,replyQuote?,clientMessageId}` is an
authenticated employee's explicit message to the user as itself. It supports
combined or separate text, images and files, at most 16 attachments, and requires a
stable `clientMessageId` (1–160 characters).

- Different `clientMessageId` values create separate messages, so an employee may
  send several text, image and file messages in sequence.
- Retrying an unchanged call with the same ID returns the same message. Reusing the
  ID for different content is rejected.
- `direct.post` only publishes to the caller's own user conversation. It never
  addresses a peer, assigns work, triggers another Agent, or publishes to a group.
- An employee cannot supply another author, and the user or Secretary cannot spoof
  an employee's publisher identity.

`direct.post` is communication with the user, not a workspace write. It is allowed
during a normal native work turn in Plan, Ask and `dontAsk` modes without a
file-write approval. Other generic API writes still follow the engine's Ask/Full
access and planning rules. Initialization and silent/awareness reading cannot
publish.

### History and read state

`direct.history {employee,limit?,before?,around?}` reads only the published ledger.
`limit` is 1–500 (default 200); `before` selects entries below a direct sequence,
and `around` centers a page on an exact direct message ID. It returns
`{items,revision,latestIncoming,readSequence,nextBefore}`. It never includes native
output, shared inputs, wrapper prompts or silent reads, and querying does not mark
anything read.

`direct.acknowledge {employee,messageId}` acknowledges one exact published incoming
employee message. A stale message ID never acknowledges a newer post; reading the
ledger or querying an entry does not acknowledge it. Native Aexus unread state
remains the separate `session.acknowledge`/`lastReply` record.

### Attachments and preserved media

Attachment paths are resolved in the employee's own workspace on its execution host
at post time. At most 16 image/file attachments may accompany one entry.

- For a local employee, Core copies the media into the private direct-media store
  while sending and checks that the source did not change during the copy. The sent
  media remains readable after the source file is edited, moved or deleted.
- For a remote employee, only metadata is published. Bytes remain lazily on the
  original execution host and each read rechecks the current workspace/host binding
  and the recorded size/modification version. Core never silently downloads a
  remote file to the Mac.
- A changed, unavailable or moved remote source is reported as unavailable; ask the
  sender to publish it again rather than substituting another file.

Published attachments use opaque `@direct/…` references. They are read-only through
the workspace APIs; destination writes and arbitrary-path substitution are
rejected.

### Aexus provenance for native input

The full Team conversation displays the exact Aexus-owned wrapper and origin for
newly captured work and read inputs: `from [groupname]` for group/shared input,
`from [Private · name]` (or `from [Private]`) for private input, and `[Channel · name]`
for channel input. Read-phase inputs are marked `Read silently`, and the expandable
**System wrapper prompt** shows the wrapper verbatim. Existing raw histories are
preserved unchanged; the application does not claim to reconstruct wrapper or
origin metadata that was never stored for older entries.

### Permission boundaries

Existing roles, transcript-reading scope, workspace boundaries and credentials are
unchanged. The user and Secretary may administer a readable employee's private
input, published history and read state through `direct.send`, `direct.history`,
`direct.send-status` and `direct.acknowledge`. A Secretary still publishes only
through its own authenticated employee identity (`direct.post`) and cannot spoof
another employee as publisher.

```sh
# User or Secretary input; the default mode is enqueue.
agents direct send --employee EMPLOYEE_ID --text "Please review the draft." \
  --client-message-id dm-input-1 --json
# Dispatch immediately in the existing native session.
agents direct send --employee EMPLOYEE_ID --text "Answer now." \
  --mode send --client-message-id dm-input-2 --json
# Steer the active turn; steer rejects attachments.
agents direct send --employee EMPLOYEE_ID --text "Also check the appendix." \
  --mode steer --client-message-id dm-input-3 --json
agents direct send-status --employee EMPLOYEE_ID --client-message-id dm-input-1 --json
agents direct history --employee EMPLOYEE_ID --limit 50 --before 120 --json
agents direct history --employee EMPLOYEE_ID --around dm_MESSAGE_ID --limit 20 --json
agents direct acknowledge --employee EMPLOYEE_ID --message-id dm_MESSAGE_ID --json
```

```json
{"command":"direct.post","args":{"text":"The first pass is attached.","clientMessageId":"dm-reply-1"}}
{"command":"direct.post","args":{"images":["/work/shot-1.png"],"clientMessageId":"dm-reply-2"}}
{"command":"direct.post","args":{"files":["/work/report.pdf"],"text":"Full source.","clientMessageId":"dm-reply-3"}}
```

In a multi-message exchange, the user may send text plus images/files once with
`direct.send`; the employee then sends a text answer, images and a file as separate
`direct.post` calls with distinct stable IDs. Each call becomes its own published
ledger entry, and retrying any call with its original ID returns that same entry.


## Scope and authority

Message groups use the independent offices `owner`, `admin`, and `member`. These offices do not change an employee's Team role, engine permissions, credentials or Mission authority. `group.*` addresses Teams; `chat.*` addresses Message groups. Always use the exact returned IDs.

For a group, `conversation.policy {conversation:"group:ID"}` supplies current members, offices, moderation state, revisions and `allowedActions`. Owner/Admin manage members, Admin appointments, mute and fixed-text announcements. An Admin cannot remove, demote or individually mute Owner. Ownership transfer makes the target Owner and the former Owner Admin; transfer before removing the Owner. The user and Secretary retain application-administration access without acquiring an Owner/Admin office.

Use `conversation.member {conversation,employee,action:"add"|"remove",expectedRevision}` to change group membership. Use `conversation.role {conversation,employee,role,expectedRevision}` to change an office without removing membership. Removal preserves the employee, published history and shared files. `conversation.audit {conversation,before?,limit?}` returns actual governance actors, actions and timestamps, with `nextBefore` pagination and a limit of 1–100. Stale revisions reject; reload before reconsidering a change.

Channels are read-only news feeds. **Channel options → Channel access** assigns reading/search grants through `channel.access {id,employeeIds,expectedRevision}`. Secretary is always authorized and is omitted from the explicit reader list. A grant creates no membership, office, employee workspace, notification or task. Use `channel.fetch-text`, `channel.fetch-images`, `channel.search` and the returned entry identities. See [Channel reading grants](CHANNELS.md#read-only-employee-channel-api).

Channel member/role/mute/silence/notice writes, `channel.update {adminIds}`, discussion publication and post-count writes are rejected. Existing channel policy, notice, discussion and batch read APIs remain for authorized historical inspection; they are not current write workflows.

## Announcements and Mission work

| Feature | API | Effect |
| --- | --- | --- |
| Group announcement | `conversation.notice-*` with `group:ID` | Publishes literal saved text through the independent notice timer. No model, employee task queue or Mission schedule/run. |
| Employee task | `schedule.*`, `plan.*` | Explicit work with its own scheduling, authority and Mission records. |

Static announcement text is not a prompt and accepts no executable `action`, work target or Plan job ID. Channel post-count tasks are retired; incoming news does not dispatch employees automatically. An explicitly configured Mission may read authorized channel content as part of its task.

See [Conversation controls](CONVERSATION_CONTROLS.md) for group announcement timing, mute deadlines, quiet banners, publication history and restart rules.

## Workspace discovery

`workspace.catalog {employee?:"self"|EMPLOYEE_ID}` returns exactly the employee's assigned Team execution workspace. An ordinary Agent queries itself; the user or Secretary can select an employee explicitly. The query creates no directory, changes no working directory and invokes no model.

```json
{
  "employeeId": "EMPLOYEE_ID",
  "total": 1,
  "workspaces": [
    {
      "id": "company:EMPLOYEE_ID",
      "view": "company",
      "employeeId": "EMPLOYEE_ID",
      "employeeName": "Reader",
      "name": "Editorial / Reader",
      "team": "Editorial",
      "path": "/actual/team/reader",
      "location": "core",
      "nativeAccess": true,
      "fileApi": {"command": "workspace.list", "args": {"employee": "EMPLOYEE_ID", "path": "."}}
    }
  ]
}
```

The stable `company:EMPLOYEE_ID` and `view:"company"` values are protocol identifiers for Team; retain them unchanged. Use the returned path and host, not a directory constructed from a display name. Renaming a Team or employee does not move existing work. Cloud employees keep their configured execution host; use the same APIs when `nativeAccess` is false.

Joining a group creates no employee subfolder or alternate workspace. Group shared files remain conversation content. A channel reading grant likewise adds no workspace. `conversation.workspaces` remains a compatibility query for existing shared content; its results are not employee execution destinations.

## File permissions

| Caller | Group shared content | Channel publications |
| --- | --- | --- |
| Ordinary employee | With current membership: equal group read/create/upload/edit/delete rights | With a current reading grant: read/search and copy attachments into the caller's own Team workspace |
| User or Secretary | Administer shared content without joining | Manage reading grants, saved content and explicit user downloads |

Conversation offices add no separate file privilege. Group root and existing shared subdirectories have equal member access; new groups allocate no private member folders. Removing membership revokes future group file access while preserving existing files. Channel readers do not acquire legacy channel member folders or feed editing authority.

`conversation.file` supplies `list`, `read`, `image`, `info`, `chunk`, `write`, `mkdir`, `move`, `trash` and `restore` for authorized shared content. Paths are relative to the shared root. Host-managed `.agents-company` / `.margin-reader` metadata, parent traversal and escaped symlinks are rejected; text writes are limited to 4 MiB. Group root trash returns `root:TRASH_ID`; restore rechecks current membership and the original file scope. Historical channel folders retain their existing access checks and are not new employee workspaces.

`conversation.copy` explicitly copies an existing file into a writable group destination or an own Team workspace; `conversation.transfer` reads/cancels its transfer. `conversation.upload` copies an own Team file into group shared content, with a 2 GiB file limit and a 10 MiB limit for images included in messages. These operations neither change cwd nor publish a message. They do not grant access to another employee's private Team workspace or change native engine/OS permissions.

## Complete published entries and attachments

`conversation.entry {conversation,id}` returns a published private/group message or channel article in that exact authorized conversation. Retained channel discussion records remain readable for compatibility. The response contains:

- `entry`: the complete currently stored public record, including text/body/title, source and author information, timestamps, reply metadata, published attachment descriptors, and collected platform metadata.
- `links`: HTTP(S) links found in the public content; original text and structured URLs remain in `entry`.
- `attachments`: exact attachment IDs, original filename, size, MIME type and SHA-256 where available, plus `read` and `download` command descriptors.

News attachments use `image:MEDIA_ID` and `document:FILE_ID`. Message attachments use a stable `attachment:…` identity. Do not guess IDs from filenames. `channel.image` returns authenticated image bytes and MIME type; `chat.file` and `conversation.file` provide published message attachment reads/chunks. Large documents are not embedded in the metadata response. Download them explicitly.

`channel.fetch-text` / `channel.search`, `channel.timeline` and `chat.history` provide paged discovery within their respective reading scopes. Authorized channel readers can read a complete article through `channel.post` or `conversation.entry`; the latter also returns attachment download descriptors. Queries do not fabricate user-read receipts or access private employee transcripts. Missing, expired or removed original data is reported as unavailable; the API cannot recreate information a collector never stored.

## Download a document into an own workspace

`conversation.download` accepts:

| Field | Meaning |
| --- | --- |
| `conversation`, `entryId`, `attachmentId` | Exact source identities from `conversation.entry`. |
| `clientRequestId` | Required stable key for one unchanged copy request, max 160 characters. |
| `workspace` | Optional `company:EMPLOYEE_ID` from `workspace.catalog`; omission selects that same assigned Team workspace. |
| `employee` | User/Secretary selection; an ordinary Agent specifies itself or omits. Group sources require current membership; channel sources require a reading grant. |
| `path` | Optional relative subdirectory within that employee's destination workspace; default `.`. |
| `name` | Optional destination filename, not a path. |

The destination remains the employee's assigned Team workspace, whether selected by default or by its explicit protocol ID. Conversation references and peer workspace IDs are not alternate execution destinations.

The human user or Secretary may instead use `conversation.download-local` with an explicit absolute destination file path on the Mac/Core host. It streams the published source directly to that path; an existing file is refused unless `overwrite:true` is explicitly supplied. The GUI's save-as dialog remains the user-facing equivalent and keeps its normal overwrite confirmation.

Sources retain their configured storage host; the destination uses the employee's assigned execution host. Core transfers bounded chunks between those endpoints without building one giant renderer Blob.

The response is an asynchronous receipt `{id,state,bytes,totalBytes,workspace,workspacePath,…}`. Query `conversation.download-status {id}` until `completed`, `failed`, `cancelled` or `interrupted`; only `completed` supplies a committed file path. `queued` and `running` are not completed downloads. `{id,cancel:true}` cancels the caller's own copy. Another Agent cannot read or cancel its receipt.

The source remains intact. Downloads stream bounded chunks through staging, recheck current source access and target ownership, and verify file length and SHA-256 before commit where a source digest is available. Group member workspace IDs are not download destinations. Local filename collisions get a distinct suffix; existing files are never overwritten. A remote destination collision is reported rather than silently replacing files. A saved local source copy is checked against the published digest before it can be accepted as the original document.

Retries with the same caller/key and identical arguments return the same receipt. Changed arguments with that key reject. After restart, a completed receipt remains completed. An unknown in-flight transfer becomes `interrupted`; it is not automatically replayed. Inspect the destination before issuing a new key. Cloud file availability still depends on the collector's retention window and configured connection; downloading a local copy before expiry preserves that copy independently.

The application-administration `channel.file-download` imports into the channel root and remains available for the user's UI. Agent document work should use the own-workspace download API instead; no human token or filesystem credential is returned.

```sh
agents workspace catalog --json
agents channel timeline CHANNEL_ID --kind news --limit 20 --json
agents conversation entry channel:CHANNEL_ID --id POST_ID --json
agents conversation download channel:CHANNEL_ID --entry-id POST_ID \
  --attachment-id document:FILE_ID --client-request-id magazine-copy-1 --json
agents conversation download-status DOWNLOAD_ID --json
# Alternative explicit destination:
agents conversation download channel:CHANNEL_ID --entry-id POST_ID \
  --attachment-id document:FILE_ID --workspace company:MY_EMPLOYEE_ID \
  --client-request-id magazine-company-copy-1 --json
```

The channel document UI exposes **Download to channel** for the user's local copy. Employees use the authenticated entry/download APIs above for their Team copies; no channel member-folder picker or post-count editor is part of the channel UI. Agent-authored group replies may explicitly include shared `@workspace/…` attachments with optional text. Private files are not automatically published.

## Edit and upload a shared group file

The standard native workflow keeps shared content intact until an explicit upload:

1. `conversation.entry {conversation,id}` returns the message and its attachment descriptors. Use the returned `attachmentId`; never guess one from a filename.
2. `conversation.download` copies the chosen attachment to the employee's own Aexus execution workspace by default. Poll `conversation.download-status {id}` until `completed`; only then use the committed path. The receipt's `sourceVersion` identifies the shared source version that was copied.
3. Modify the downloaded personal file with normal workspace tools.
4. `conversation.upload {conversation,from,path,clientRequestId,expectedVersion?}` copies a personal workspace file to a group shared path. `from` is `{"employee":"self","path":"RELATIVE_PERSONAL_FILE"}`; `path` is relative to the shared root. New files must not exist. To overwrite, pass `expectedVersion`: use the download receipt's `sourceVersion` if the target is unchanged, otherwise read the current target with `conversation.file --operation info` and use its `version`.
5. Poll `conversation.upload-status {id}` until `completed`; only `completed` means the shared file committed.
6. Publish explicitly if recipients need the file: `chat.post` with `images`/`files` containing the returned `@workspace/…` paths. Text is optional. Uploading never posts a message itself.

A new file without `expectedVersion` never replaces an existing shared file. An update fails if the current shared version differs from `expectedVersion`; the newer shared file is preserved. Inspect the current file, reconcile the personal copy, then retry with a fresh `clientRequestId`. Reusing a request key with different arguments is rejected. Upload receipts are durable; after a Core restart an in-flight request becomes `interrupted` and is not replayed. Uploads never copy into another employee's private workspace.

```sh
agents conversation entry group:GROUP_ID --id MESSAGE_ID --json
agents conversation download group:GROUP_ID --entry-id MESSAGE_ID \
  --attachment-id ATTACHMENT_ID --client-request-id edit-1 --json
agents conversation download-status DOWNLOAD_ID --json
agents conversation file group:GROUP_ID --operation info --path 'shared/brief.txt' --json
agents conversation upload --conversation group:GROUP_ID \
  --from '{"employee":"self","path":"brief.txt"}' \
  --path 'shared/brief.txt' --expected-version CURRENT_VERSION \
  --client-request-id upload-1 --json
agents conversation upload-status UPLOAD_ID --json
agents chat post GROUP_ID --files '["@workspace/shared/brief.txt"]' \
  --text 'Updated brief.' --json
```

## Retained channel history APIs

Channel post-count work is retired. `channel.post-trigger-set` and `channel.post-trigger-remove` reject requests; existing active rules are paused. There is no current **Post counts** UI, automatic per-post employee awareness or count-triggered execution.

The following read-only compatibility APIs preserve authorized access to old records:

- `channel.post-trigger-list {id}` reads retained rule configuration and progress.
- `channel.post-trigger-history {id,employee?,offset?,limit?}` reads actual historical delivery states and message references.
- `channel.post-trigger-batch {id,batchId,offset?,limit?}` reads the exact historical post IDs with paged content or explicit unavailable entries.

These reads use the existing historical scope: user/Secretary administration or retained conversation membership. A new channel reading grant does not create an old office. Reading history starts no model, creates no Mission, acknowledges no user messages and replays no work. New integrations should use explicit channel fetch/search and own-workspace download APIs.

## Verification

`node test/message-collaboration-core-test.mjs` exercises authenticated Core/CLI with disposable native/filesystem fixtures: group offices and shared file rights, assigned Team workspaces, complete published entries, exact PDF/image transfers, idempotency, collision/hash rejection, reading-grant revocation and Mission isolation.

`node test/message-collaboration-ui-test.mjs` uses disposable state with the real browser and hidden Electron UI. It verifies group member/role/Owner/mute operations, static announcements and draft protection; channel access grant/revocation with Secretary always authorized; exact remote PDF copies into the employee Team workspace and explicit user channel download; rejected retired writes with unchanged histories/no dispatch; Chinese dark compact layout and empty Mission records. It reuses the local tunnel protocol fixture with the current host OS. `AGENTS_COMPANY_PROFILE_APPLICATION` can select existing build output without rebuilding it. Fixtures call no paid providers or production hosts; source validation is separate from installed-app validation.

Magazine PDF reading, original-page PNG export and ordered text/images use the same identities and workspace boundary. See [MAGAZINE_READING.md](MAGAZINE_READING.md).
