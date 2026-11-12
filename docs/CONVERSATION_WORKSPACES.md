# Shared conversation files and employee workspaces

An employee has one execution workspace: the directory assigned in Team. Joining a group never creates another employee directory, changes cwd, switches host, or changes a native session. `workspace.catalog` returns this assigned `company:EMPLOYEE_ID` workspace only. Use `conversation.file` to read shared group content and `conversation.upload` to share results from the employee’s own workspace.

## One shared-file manager

Message uses one manager for shared files, previews, uploads, new text files, editing, renaming and recoverable removal. It does not allocate employee folders or open a second group folder browser. Text saves use the `hash` returned by `conversation.file --operation read`; concurrent changes retain the editor draft until the user explicitly reloads or cancels. Native Bot files and legacy published media keep their existing connector boundaries.

Group `conversation.file --operation move --path OLD --to NEW --expected-version VERSION` renames a file or folder and updates affected published attachment paths and message-recovery records. Message IDs, text, authors, accepted work and delivery/read receipts remain unchanged. Existing message links resolve the renamed resource through its updated conversation entry. Current members retain equal shared-file rights; an outside caller cannot rename files. `expectedVersion` comes from `conversation.file --operation info` or `conversation.files`; collisions and stale versions are rejected without overwriting data. Metadata-write failure attempts to restore the original location. Accepted native prompts and external OS paths remain their original snapshots; consumers should refresh `conversation.entry` after a path change.

## Choose storage when creating a group

User and Secretary may pass `storage:{mode:"create"|"bind",hostId?,directory?,folderName?}` to `chat.create`. With hostId the directory belongs to that registered cloud host; otherwise it belongs to the Core host. In create mode, directory is the parent and folderName defaults to a filesystem-safe group label. In bind mode, directory must already exist and is used directly; no rename or overwrite occurs. Omitting storage retains a managed Core folder. Ordinary employee creators use this default and cannot grant themselves arbitrary host/path access.

```sh
agents chat create --name 'Research' --members '["EMPLOYEE_ID"]' --storage '{"mode":"create","directory":"/data/groups","folderName":"Source library"}' --client-request-id group-1 --json
agents chat create --name 'Cloud research' --members '["EMPLOYEE_ID"]' --storage '{"mode":"create","hostId":"HOST_ID","directory":"/srv/groups","folderName":"Originals"}' --client-request-id group-2 --json
agents chat create --name 'Existing data' --members '["EMPLOYEE_ID"]' --storage '{"mode":"bind","hostId":"HOST_ID","directory":"/srv/existing"}' --client-request-id group-3 --json
```

The committed storage directory is stable across group rename/restart. Existing groups keep their original locations. A host storing group files cannot be removed while referenced. Storage gives current members scoped file access, not general SSH administration or host credentials. Local employees, workers on the storage host, and workers on another cloud host use the same conversation APIs and opaque versions; cross-host copies keep the employee’s assigned execution directory.

Team creation uses the same folder choice. `group.add --folder-name NAME --parent-directory PATH` creates an independent local folder label; add `--mode cloud --host-id HOST_ID` for a cloud parent. `--directory-mode bind --root LOCAL_PATH` or `--remote-dir REMOTE_PATH` binds an existing location. No existing employee/native workspace is moved automatically.

## Shared content locations

`conversation.workspace {conversation,employee?}` returns the stable Core or registered-host shared content root, current members and rights. Groups do not return `members[].directory`, `memberDirectory` or `memberPath`. `personalWorkspace`, when returned, is the existing Team cwd. `conversation.workspaces` lists shared content locations, not extra execution workspaces. Remote employees access Core files through these APIs; a Core path is not a remote-local path.

The ID parent isolates same-name conversations. Renaming a group or employee does not move files. Existing legacy member folders and their files remain at their original paths as ordinary shared content; they are not advertised or recreated as employee workspaces. Leaving or archiving a group preserves the files and revokes former members’ API access.

```sh
agents workspace catalog --employee self --json
agents conversation workspace group:GROUP_ID --json
agents conversation file group:GROUP_ID --operation list --json
agents conversation file group:GROUP_ID --operation read --path brief.txt --json
```

All current group members have equal read/create/upload/edit/delete rights over shared content. User and Secretary administer without joining. Aexus position and group Owner/Admin office do not confer access to another employee’s private Team workspace. Core checks do not sandbox arbitrary same-account Trusted native tools.

Channel news feeds use reading grants, without new employee membership or personal folders. Channel roots retain the user’s explicit downloads and legacy content. Existing channel member-subfolder restrictions remain compatible for old layouts; they do not allocate another execution workspace in `workspace.catalog`.

## Unified shared file manager

The group header has one **Shared files** entry, opening the existing Media / Files / Links library. There is no second folder-browser entry or per-employee group-folder selector. The Files manager includes completed uploads, published files/images and retained files inside old subdirectories. Paths, versions and message provenance come from Core; files with no message have no fabricated sender or message ID. Topic/sender filters exclude unknown provenance.

`conversation.files` returns unique current paths, exact versions, sizes, preview IDs and recoverable trash. A path shared in several messages appears once with its reference count. `assets.preview` uses Margin Reader’s bounded preview worker for local PDF/image/text thumbnails; other unselected remote assets are never fetched automatically. Legacy published attachments receive valid preview IDs too. Images open in the existing image viewer.

```sh
agents conversation files group:GROUP_ID --sort name --json
agents conversation file-open group:GROUP_ID --path '@workspace/Paper.pdf' --version CURRENT_VERSION --json
```

`conversation.file-open` is available to the user/Secretary. It rechecks current group access, exact version and regular PDF identity, invokes Margin Reader’s public `document.open`, then opens/focuses its existing plugin window. Local originals open in place. For registered-host storage, bounded preview scratch space is deleted after cover generation, and a PDF is fetched on demand into a tracked reading cache. Reader-close releases unchanged cached originals while preserving annotations and locally edited files. This does not mirror the group, request Save As, change the main conversation, or grant plugin rights to group members. Margin Reader’s reading state lives in its own protected `.margin-reader` metadata. The original PDF is retained.

## Edits and recoverable removal

`conversation.file` supports list/read/image/info/chunk/write/mkdir/move/trash/restore. Paths are relative to the shared root; `@workspace/relative/path` is the stable attachment form. Text updates require the returned hash and are limited to 4 MiB. Internal `.agents-company`, `.margin-reader`, transfer staging, traversal and symlinks are rejected.

`conversation.file-trash {conversation,files:[{path,version}]}` preflights the entire batch and moves files to recoverable Trash. Restore uses `{path,trashId}`, refuses overwrite and rechecks membership. This works for completed uploads even before a chat message references them. Removing a file never rewrites original messages or receipts. External native Bot files remain read-only when the connector cannot delete them.

## Copy, edit and republish

```sh
agents conversation entry group:GROUP_ID --id MESSAGE_ID --json
agents conversation download group:GROUP_ID --entry-id MESSAGE_ID --attachment-id ATTACHMENT_ID --client-request-id edit-brief-1 --json
agents conversation download-status DOWNLOAD_ID --json
# Edit the completed copy in the existing Team workspace, then share it explicitly.
agents conversation upload --conversation group:GROUP_ID --from '{"employee":"self","path":"brief.txt"}' --path 'brief.txt' --client-request-id upload-brief-1 --json
agents conversation upload-status UPLOAD_ID --json
```

The download destination is the employee’s assigned `company:EMPLOYEE_ID`; another group member’s private workspace and old Message member-workspace IDs are not destinations. Remote copies run on the employee’s existing execution host. Transfers stream bounded chunks, preserve sources, verify size/version/digest, never silently overwrite and do not replay interrupted requests. User/Secretary can use `conversation.download-local` for an explicitly selected Mac/Core-host path.

To replace a shared file, read `conversation.file --operation info`, then pass its exact `version` as `conversation.upload --expected-version`. A new file omits it and refuses collision. An upload alone does not post a message: publish the completed `publishedPath` with `chat.post` when a group notification is intended.

`conversation.copy` remains available for explicit copies between a shared directory and the caller’s own Team workspace. `conversation.transfer` reads/cancels only the initiating caller’s transfer. No shared-content operation silently changes employee identity, host, model, role or working directory.


Chosen group storage locations and their names remain fixed during `assets.naming` directory organization, including local/remote ancestor paths and overlapping Team/Shared roots. The migration preview identifies preserved group bindings. Existing legacy managed layouts remain compatible. This does not authorize a change of storage host or inspect unrelated adjacent workspace metadata.

## Copy between shared content and the assigned Team workspace

Download/edit in your existing Team workspace, then explicitly copy or upload the result back. Neither operation creates a personal group folder or publishes a message:

```sh
agents conversation copy --from '{"conversation":"group:GROUP_ID","path":"brief.md"}' --to '{"employee":"self","path":"."}' --json
agents conversation transfer TRANSFER_ID --json
agents conversation copy --from '{"employee":"self","path":"review.md"}' --to '{"conversation":"group:GROUP_ID","path":"."}' --json
```

Wait for `state:completed`; acceptance/queued status is not a completed copy. Source files remain, same-name destinations are refused, and an explicit `chat.post` or `direct.post` is still needed to publish a result.
