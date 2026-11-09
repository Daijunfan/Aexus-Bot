# Character catalog and appearances

The catalog is shared by Team, Message, Mission, employee forms and Dot. Discover it
at the time of use: IDs, available styles and enabled characters may change. Do not
hard-code a character list or assume a fixed count in an Agent prompt.

```sh
agents avatar list --json
agents avatar list --status archived --json
agents avatar list --all --query Saber --json
agents avatar get fate-saber-chibi --json
```

`avatar.list` defaults to enabled entries. `status` accepts `active`, `archived` or
`all`; the older `--all` spelling remains supported. An entry contains its stable
`id`, name, character, style, aliases, `enabled`, `status`, `selectable`, `revision`,
`displayId`, `assignedCount`, `usageCount` and `inUse`. `assignedCount` counts saved
employee/Dot assignments, including archived IDs. `usageCount` / `inUse` describe the
currently displayed artwork, including compatibility replacements. Counts do not
expose conversations or grant authority.
Any employee may query the catalog, including during initialization.

The user and Secretary can change availability without restarting:

```sh
agents avatar update fate-saber-anime --enabled true --expected-revision 0 --json
agents avatar update fate-saber-anime --enabled false --expected-revision 1 --json
```

Use the revision returned by the latest list/get result, rather than copying the
example number. A stale write fails without changing the catalog. An uncertain
response is resolved with a read; do not replay a write blindly. Keep at least one
enabled entry, enabling a replacement before archiving the last current entry.
Availability applies immediately to open pickers and all views. The API changes
registered artwork availability, not source files or native Agent configuration.

By default, the 21 Fate chibi characters are enabled. Other complete assets remain
archived and can be re-enabled. Existing stored IDs, employee identity, native
session, workspace and history remain intact. An archived assignment displays its
enabled chibi counterpart, or a stable enabled fallback; `displayId` reports it.
Legacy aliases keep working whenever their underlying artwork is enabled.

Creation without appearance parameters randomly chooses from the **current enabled
catalog**. No special random ID or style is required:

```sh
agents card create --title Researcher --group Research --engine claude --json
agents card avatar EMPLOYEE_ID --json
```

`card.avatar` without appearance parameters also chooses a random enabled character.
An exact enabled `avatar` ID is the simplest explicit choice. `character` and optional
`avatarStyle` remain compatible; ambiguous names require a precise style/ID. Disabled
or invented choices fail clearly. Employee-management scope remains unchanged:
Manager controls its own Team's Employees; Governor and Secretary retain their
existing scopes. Catalog updates themselves require user/Secretary administration.

The character picker previews locally. Cancel, Escape, the close button or an outside
click retain the original form/appearance; confirming applies the chosen character.
Settings → Characters manages enabled/archived entries through the same Core API.

Complete pre-rework animation sources, previews, portraits, generators, provenance
and licenses are backed up in `Archive/Avatars/2026-11-07`. The manifest records each
file's SHA-256. Archiving does not establish additional redistribution permissions.


Character portraits have transparent UI surfaces throughout Team, Message and Mission. The live sprite uses the same portrait framing and original artwork; working/responding/attention comes from that employee ID's actual session, not a shared avatar name. Visible active portraits animate continuously; idle portraits use short greetings. Reduced motion, background documents and off-screen portraits stop playback. Worker engine marks preserve their native logos with restrained activity motion, without an outer plate.
