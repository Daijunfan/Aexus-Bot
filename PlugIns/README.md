# Plugins

All three first-release workspaces/utilities have been promoted directly into Aexus Bot Core and main views:

| Capability | Built-in Location | CLI / Core Surface |
| --- | --- | --- |
| Mission Workflow Notebook | `Mission` (`src/main/mission-notebook/`) | `notebook.*` |
| Study Reader & Mindmaps | `Library -> Study Reader` (`resources/library-reader/`, `src/main/library-reader/`) | `reader.*` |
| Cloud Hosts & SFTP / SSH | `Library -> Cloud Hosts` (`src/main/cloud-hosts.ts`, `src/main/host-access.ts`) | `host.*` |

`plugins.lock.json` pins `"plugins": []` with 0 bundled third-party plugin directories required at build time. Custom and external CLI-first plugins (starting from [`examples/plugin-starter`](../examples/plugin-starter)) remain supported through `agents plugin install`, `$AGENTS_COMPANY_HOME/plugins/`, and the documented `plugin.*` Core APIs. See `PLUGIN_SPEC.md`, `LICENSING.md` and `docs/DEPLOYMENT.md`.
