# Group and channel workspaces

Current channel scope: news feeds have reading grants (`channel.access`), without
employee membership or shared member folders. Employees read full news/attachments
with `conversation.entry` and explicitly copy them with `conversation.download`;
the default destination is their personal Company workspace. Channel workspaces
hold the user's explicit downloads and retained legacy files. Group members keep
equal shared-file rights. References to channel member folders below describe
existing legacy layouts only and do not enable new channel membership.

Groups and channels have a persistent workspace on the Core host. The workspace is independent of every employee's existing personal workspace, native session, company Team and execution host.

## Location and identity

The current path is returned by `conversation.workspace`; do not reconstruct it from display names. New workspaces use:

```text
APP_HOME/conversation-workspaces/group/CONVERSATION_ID/Group name/
APP_HOME/conversation-workspaces/channel/CONVERSATION_ID/Channel name/
    user-uploaded-image.png
    user-uploaded-file.txt
    Alice/
    Bob/
```

The ID parent separates conversations with the same name. Current members have named child folders. Duplicate or filesystem-unsafe names receive a safe, unique directory name. `members[].directory` and `memberDirectory` are authoritative. Existing folder names remain stable after display-name changes so active files and native working paths are not moved. Leaving, archiving or deleting a conversation does not delete its workspace files. Removed members lose Core API access; their outputs remain for current members.

```sh
# Authenticated employee: discover your group and channel workspaces.
agents conversation workspaces --json
agents conversation workspace group:GROUP_ID --json
agents conversation workspace channel:CHANNEL_ID --json
# User: inspect the member folder belonging to a specific employee.
agents conversation workspace group:GROUP_ID --employee EMPLOYEE_ID --json
```

The descriptor includes `root`, `folderName`, `members`, and, for a selected employee, `memberDirectory`, `memberPath`, `personalWorkspace` and `nativeAccess`. All paths describe the Core or employee execution host, never the browser's local filesystem. Remote employees should use these APIs and explicit copies; a Core path is not a remote-local path.

## Member access

Rights depend on the conversation kind.

- **Groups:** every current member has equal read, create, upload, edit and delete rights over shared file contents, both at the shared root and inside every peer member folder. Membership alone is sufficient; an Agent does not need a Company office, and Owner/Admin group office grants no extra file authority. The human user and Secretary administer all group content without joining.
- **Channels:** an Agent member may read shared files, including other members' working files, but `conversation.file` writes (create, edit, delete) are limited to that member's own named subfolder. `conversation.upload` is group-only. The user and Secretary have global channel content authority without membership; an existing Secretary root-file exception therefore remains only as part of that global authority, not an Agent privilege.
- **All conversations:** named member directory identities (`members[].directory`, `memberDirectory`, `memberPath`) and host-managed metadata are protected. They cannot be renamed, replaced, moved, trashed or uploaded over. The internal `.agents-company` and `.agents-transfer-…` paths are never exposed.

Copying into another employee's private Company workspace is not allowed by these APIs. Ordinary employees require current membership. User and Secretary retain application-level authority; conversation office alone never grants access to a private employee transcript.

This is application authorization, not an operating-system sandbox for arbitrary shell processes running as the same trusted macOS account. Native tools keep their existing access/approval mode. No engine is granted a broader execution sandbox by joining a conversation.

```sh
agents conversation file group:GROUP_ID --operation list --json
agents conversation file group:GROUP_ID --operation read --path brief.txt --json
agents conversation file group:GROUP_ID --operation image --path reference.png --json
# A group member may edit a peer folder or a root file directly.
agents conversation file group:GROUP_ID --operation write --path 'Alice/result.md' --content 'Review completed.' --create --json
# In a channel, an Agent writes only inside its own named subfolder.
agents conversation file channel:CHANNEL_ID --operation write --path 'Alice/result.md' --content 'Review completed.' --create --json
```

Use the returned file `hash`/`version` to update an existing text file. Text writes are limited to 4 MiB; `chunk` reads bounded binary data. Absolute paths, parent traversal, symlinks and internal transfer/trash paths are rejected. Managed member-root directories cannot be renamed or removed through this API. Trash and restore follow the same group/peer versus channel-own-subfolder boundary. A group root-file trash returns a `root:…` receipt; restoration rechecks current access and the protected member-directory boundary.

## Explicit copies and work location

`workspace.catalog` returns the employee's Company workspace and all joined Message member workspaces, with exact paths, host location and permissions. The employee selects the location appropriate to the task. The catalog and APIs impose no task-to-workspace placement rule.

```sh
# Copy a root original to your named folder, without modifying the original.
agents conversation copy --from '{"conversation":"group:GROUP_ID","path":"@workspace/brief.txt"}' --to '{"conversation":"group:GROUP_ID","path":"Alice"}' --json
# Or copy it to your original personal Workspace.
agents conversation copy --from '{"conversation":"group:GROUP_ID","path":"@workspace/brief.txt"}' --to '{"employee":"self","path":"."}' --json
# Copy a result back from your own personal Workspace.
agents conversation copy --from '{"employee":"self","path":"result.md"}' --to '{"conversation":"group:GROUP_ID","path":"Alice"}' --json
agents conversation transfer TRANSFER_ID --json
agents conversation transfer TRANSFER_ID --cancel --json
```

A destination is an existing directory. Transfers preserve source files, never overwrite an existing target, and recheck membership and workspace identity during IO. A queued/running transfer is not a completed copy. An interrupted Core does not silently replay the transfer. `conversation.transfer` belongs to its authenticated initiating identity.

## Published content and document downloads

`conversation.entry {conversation,id}` returns complete stored public text, links, reply data, images, document descriptors (`attachmentId`, size, MIME type, SHA-256, `version` where available) and available platform metadata. Pass those exact IDs to `conversation.download`.

The default destination is the authenticated employee's own Company execution workspace (`company:EMPLOYEE_ID`). An employee may explicitly choose another own entry from `workspace.catalog`, including a joined Message member workspace. The default does not select a workspace for later tasks. `conversation.download-status` reports the committed path or failure. Existing files are never overwritten; membership and SHA-256 are checked during transfer. A download receipt's `sourceVersion` is the version of the shared source file that was copied.

The human user or Secretary may instead call `conversation.download-local` to stream the same published attachment to an explicitly chosen absolute file path on the Mac/Core host. It refuses an existing destination unless `overwrite:true` is explicit. The GUI download save dialog remains the user-facing equivalent.

Remote sources and destinations execute on the employee's execution host. Core streams bounded chunks between hosts and never materializes a whole large file in a renderer Blob. The old human-only `channel.file-download` still imports into the shared root. See [Message collaboration](MESSAGE_COLLABORATION.md) for exact schemas, retry keys, remote-host semantics and per-Agent channel post-count rules.

## Employee workflow: edit and republish a shared file

A native employee edits shared content on a personal copy rather than mutating shared bytes in place:

```sh
# 1. Read the published entry and find attachment descriptors.
agents conversation entry group:GROUP_ID --id MESSAGE_ID --json
# 2. Copy the chosen attachment to the default own Company execution workspace.
agents conversation download group:GROUP_ID --entry-id MESSAGE_ID \
  --attachment-id ATTACHMENT_ID --client-request-id edit-brief-1 --json
# 3. Poll until completed; only then use the committed destination and sourceVersion.
agents conversation download-status DOWNLOAD_ID --json
# 4. Modify the downloaded personal file with normal workspace tools.
# 5. Upload it back. Omit expectedVersion to create a new shared file.
agents conversation upload --conversation group:GROUP_ID \
  --from '{"employee":"self","path":"brief.txt"}' \
  --path 'shared/brief.txt' --client-request-id upload-brief-1 --json
# 6. Poll the upload receipt.
agents conversation upload-status UPLOAD_ID --json
```

For an overwrite, read the current shared target first and pass its `version`:

```sh
agents conversation file group:GROUP_ID --operation info --path 'shared/brief.txt' --json
agents conversation upload --conversation group:GROUP_ID \
  --from '{"employee":"self","path":"brief.txt"}' \
  --path 'shared/brief.txt' --expected-version CURRENT_VERSION \
  --client-request-id upload-brief-2 --json
```

Use the downloaded receipt's `sourceVersion` when the target has not changed since the download. A new file is never committed over an existing shared file: without `expectedVersion` an existing target rejects the request. An update commits only when the current shared version still equals `expectedVersion`; otherwise the newer shared file is preserved and the upload fails. Inspect the current file, reconcile your copy, then retry with a fresh `clientRequestId`. Receipts are durable and deduplicate an identical retry; after a Core restart an in-flight request becomes `interrupted` and is never replayed, so inspect before issuing a new key.

`conversation.upload` accepts only group conversations. The source must be a file in the caller's own personal workspace, not a peer workspace or another employee's private folder. The destination's parent directory must already exist in the shared workspace; create it with `conversation.file --operation mkdir` if needed. Text writes remain limited to 4 MiB; binary uploads support files up to 2 GiB.

After a successful upload, publish the file reference explicitly if recipients should see it in chat:

```sh
agents chat post GROUP_ID --text 'Updated brief attached.' \
  --files '["@workspace/shared/brief.txt"]' --images '["@workspace/shared/reference.png"]' --json
```

Text is optional: attachments may be published alone. Uploading never posts a group message by itself, and native assistant output never publishes anything.

## User attachments and task routing

A message may contain text, up to 16 combined images/files, or attachments alone. Files are limited to 2 GiB each and images included in a message to 10 MiB each. New user uploads are committed directly under the conversation root. Simultaneous duplicate filenames receive suffixes such as `brief (2).txt`. Completed uploads are readable by current members immediately; pressing Send notifies them. Upload staging remains hidden. The system does not overwrite another upload or a member folder. Private-chat uploads retain their existing storage behavior.

Published attachments keep stable `@workspace/relative-path` references and file metadata in the group/channel message. Members may explicitly publish shared attachment references with optional public text; arbitrary private paths are not accepted. The visible message still displays the user's original text, image album and file cards. Files persist independently of channel news retention.

Each addressed employee receives one **text-only task** containing the original user text plus a structured list of uploaded filenames, references, byte sizes and types. No image/file array is added to the employee's private transcript, no attachment bytes are automatically sent to its native model, and no automatic employee-workspace copy occurs. Non-addressed recipients keep the existing context-only behavior. An employee reads or copies files explicitly when needed. Legacy group attachments remain readable through their existing `chat.file` references; this feature does not move or delete old attachment storage.

```sh
# User or UI: begin one upload. Complete it with the existing transfer upload protocol.
agents messenger upload-begin group:GROUP_ID --name brief.txt --bytes 120 --json
# After successful upload, use the returned destination references.
agents chat send GROUP_ID --text 'Review these materials.' --files '["@workspace/brief.txt"]' --images '["@workspace/reference.png"]' --mentions all --json
agents channel message-send CHANNEL_ID --text 'Review these materials.' --files '["@workspace/brief.txt"]' --images '["@workspace/reference.png"]' --json
```

Creating/importing a file directly in the workspace does not send a chat message. Explicit publication remains necessary. Group/channel work still does not create a private unread badge; real private unread and group/channel reading remain independent.

## Interface

Only Company displays `Add Team` and `Add Employee`, with readable labels at compact widths. Messages has an explicit **Archived chats** entry that combines private employees, groups and channels. Each archived row can be restored directly, and the existing context-menu/bulk operations remain available. Archiving does not change file access, group membership or message read receipts.

Both group and channel headers expose **Shared workspace**. The dialog opens the root or a chosen named member folder using the existing file browser. A Company employee workbench exposes **Employee work folder** to switch between personal files and joined conversation folders; it does not change that employee's configured working directory, native identity or terminal host. The same business operations are available through CLI/API.
