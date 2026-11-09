# Aexus Bot contributor instructions

## Current development baseline

后续开发统一以 `main` 最新已提交的 Bot 版本为准，不再回退到其他历史版本。社交媒体爬虫代码由独立开源项目 `Daijunfan/xhs_publisher` 维护；本仓库保留客户端与认证 API，不重新嵌入采集实现。

用户已于 2026-11-04 选定 0.58.1（原始基线提交 `25d686e`），并要求重建仓库历史、只保留当前版本。唯一开发分支为 `main`。后续开发以此版本的 Company / Messages / Plan 和频道功能为基础；Secretary 保持为 Company 角色，不恢复独立秘书侧栏或后来的多看板外壳，不自行切换开发基线。

正式 App 名称为 `Aexus Bot`，安装位置为 `/Applications/Aexus Bot.app`，GitHub 主仓库为 `Daijunfan/Aexus-Bot`。用户图标原图为根目录 `Aexus-bot.png`，现有图标构建输入为 `app_icon.png`。macOS 统一通过根目录 `python3 build.py` 调用此版本原有打包流程；安装仍使用下文的项目安装器，保留用户数据、认证及工作区。

Keep changes small and preserve the existing CLI-first boundaries. Read `CONTRIBUTING.md`, `SECURITY.md`, `API.md` and `PERMISSIONS.md` before changing execution or authority. Do not launch child Agents unless the task explicitly requests them.

## Core and presentation

- Business behavior belongs to the Node Core. Electron and browser UI call the same authenticated operations; UI behavior cannot bypass the CLI/API.
- Update the command registry, Core dispatch, CLI parser, API documentation and tests together. Run `npm run docs:managers` after changing API or permission documentation.
- Keep Team, employee, native-session and workspace identities stable. Employee engines are fixed at creation; using another engine requires deleting the employee and creating a new one. Preserve archived native references from older versions. Never silently change execution host or elevate permissions.
- “Local” means the Core host. Browser-local files must be uploaded, not treated as server paths. Client navigation/cameras are separate from shared company geometry.
- Secretary/Governor/Manager authority comes from the role policy. Secretary is the highest Agent application-administration role; only the user may appoint, demote or delete Secretaries. Creation lines, directory names and view membership do not grant permissions.

## Plugins and engines

- All three first-release plugins are source-versioned under `PlugIns/`. Keep their licenses, CLI, runtime, schema, UI and build inputs together; update `plugins.lock.json` deliberately.
- User workspaces and credentials are not source. Portable plugin workspaces live outside application binaries; existing bound directories are never moved automatically.
- An engine adapter handles its documented execution protocol and normalizes results. It cannot bypass Core permissions. Unsupported capabilities must fail explicitly.
- Never mark a pending redistribution review approved without actual evidence. Attribution does not establish permission to redistribute vendor artwork or runtimes.

## Verification and user data

- Promotional output directories, including per-post and per-view folders, must use English names. Keep asset links and generation paths synchronized when renaming.

- Test with temporary `AGENTS_COMPANY_HOME`, workspace and native-profile directories. Never create/delete test employees or run sample schedules in real user state.
- Use deterministic protocol/model fixtures by default. Billed model calls, real-host changes and native child Agents require explicit authorization; record what actually ran.
- Test desktop rendering in hidden windows and Web rendering in headless browsers. Do not claim another operating system passed based on a local build.
- 构建、测试和验收默认全部在后台执行。禁止自动弹出、聚焦或切换用户窗口；安装后也不主动打开可见应用窗口，除非用户明确要求打开界面。
- macOS 必要重启使用 `open -g -j --env AGENTS_COMPANY_BACKGROUND_START=1`，由应用在初始化时保持窗口隐藏，并只读确认屏幕上没有应用窗口。用户主动点击 Dock 时才显示界面。生产界面不用于自动导航验收。
- Preserve existing edits. Never reset the repository, clear credentials, overwrite user documents, or publish a repository/tag/package without explicit permission.
- Builds do not imply installation. Do not stop or replace another developer's running app automatically. When a user explicitly requests installation, inspect active tasks, back up state and stop the old process before replacing its ASAR.
- For an authorized macOS installation, use `npm run install:mac -- --source '/path/Aexus Bot.app'`, then verify the installed app in an isolated hidden-window test. Do not hand-roll hot replacement.

## Release

`npm run release:check -- --technical` checks engineering prerequisites. Full `release:check` also enforces unresolved redistribution reviews. Candidate archives are private artifacts until those reviews are complete. Every validation report must separate passed, failed, skipped and untested platforms.

## Plugin content access

新团队仅为本地或云端项目，不新增 Work/plugin 团队。插件独立打开，按具体内容授予员工 read/write/create；Secretary 始终拥有用户级插件能力。保留旧 Work 目录与原生会话，禁止改名迁移或复制数据来绕过授权。更新资源适配器、Core/CLI、原生工具与插件宿主界面时一起验证数据投影、修改/新增隔离、撤销及多项原子保存。
