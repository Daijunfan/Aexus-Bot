# Shared conversation files and employee workspaces

An employee has one execution workspace: the directory assigned in Team. Joining a group never creates another employee directory, changes cwd, switches host, or changes a native session. `workspace.catalog` returns this assigned `company:EMPLOYEE_ID` workspace only. Use `conversation.file` to read shared group content and `conversation.upload` to share results from the employee’s own workspace.

## Shared content locations

`conversation.workspace {conversation,employee?}` returns the stable Core shared content root, current members and rights. Groups do not return `members[].directory`, `memberDirectory` or `memberPath`. `personalWorkspace`, when returned, is the existing Team cwd. `conversation.workspaces` lists shared content locations, not extra execution workspaces. Remote employees access Core files through these APIs; a Core path is not a remote-local path.

The ID parent isolates same-name conversations. Renaming a group or employee does not move files. Existing legacy member folders and their files remain at their original paths as ordinary shared content; they are not advertised or recreated as employee workspaces. Leaving or archiving a group preserves the files and revokes former members’ API access.

```sh
agents workspace catalog --employee self --json
agents conversation workspace group:GROUP_ID --json
agents conversation file group:GROUP_ID --operation list --json
agents conversation file group:GROUP_ID --operation read --path brief.txt --json
```

All current group members have equal read/create/upload/edit/delete rights over shared content. User and Secretary administer without joining. Company position and group Owner/Admin office do not confer access to another employee’s private Team workspace. Core checks do not sandbox arbitrary same-account Trusted native tools.

Channel news feeds use reading grants, without new employee membership or personal folders. Channel roots retain the user’s explicit downloads and legacy content. Existing channel member-subfolder restrictions remain compatible for old layouts; they do not allocate another execution workspace in `workspace.catalog`.

## Unified shared file manager

The group header has one **Shared files** entry, opening the existing Media / Files / Links library. There is no second folder-browser entry or per-employee group-folder selector. The Files manager includes completed uploads, published files/images and retained files inside old subdirectories. Paths, versions and message provenance come from Core; files with no message have no fabricated sender or message ID. Topic/sender filters exclude unknown provenance.

`conversation.files` returns unique current paths, exact versions, sizes, preview IDs and recoverable trash. A path shared in several messages appears once with its reference count. `assets.preview` uses Margin Reader’s bounded preview worker for local PDF/image/text thumbnails; it never fetches an original from a remote host just to create a cover. Legacy published attachments receive valid preview IDs too. Images open in the existing image viewer.

```sh
agents conversation files group:GROUP_ID --sort name --json
agents conversation file-open group:GROUP_ID --path '@workspace/Paper.pdf' --version CURRENT_VERSION --json
```

`conversation.file-open` is available to the user/Secretary. It rechecks current group access, exact version and regular local PDF identity, invokes Margin Reader’s public `document.open`, then opens/focuses its existing plugin window. The reader uses the original shared file in its existing root; it does not run download/import, request Save As, copy the PDF into another library, change the main conversation, or grant plugin rights to group members. Margin Reader’s reading state lives in its own protected `.margin-reader` metadata. The original PDF is retained.

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
