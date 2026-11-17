# Aexus Bot CLI Plugin Contract v1

插件是一份独立的软件包：领域逻辑和数据归插件自己的 CLI/API；Avalon
负责发现插件、提供 Team 工作目录、安装文档与启动器，以及承载渲染界面。
宿主不根据 Team 名称识别软件，也不导入插件的业务类型。

## Package

复制 [`examples/plugin-starter`](../../examples/plugin-starter) 即可从一个无依赖示例开始。
每个包必须包含 `agents-company.plugin.json`：

```json
{
  "schemaVersion": 1,
  "id": "workspace-notes",
  "name": "Workspace Notes",
  "version": "1.0.0",
  "description": "A CLI-first workspace tool",
  "runtime": "runtime.cjs",
  "renderer": "ui/index.html",
  "cli": "cli.cjs",
  "documentation": "API.md",
  "schema": "schema.json",
  "autoAttach": true,
  "workspaceDirectory": "workspace-notes-workspace"
}
```

`id` 为稳定的小写字母、数字和连字符标识。所有入口是包内真实文件的相对路径，
不得通过路径或软链接越出包目录。运行环境为 Node 22+ / Electron 的 Node 模式；
运行时和 CLI 入口使用 CommonJS，包自带所需运行依赖。渲染入口使用相对静态资源。

安装、发现和调用：

```sh
agents plugin install /absolute/path/to/plugin
agents plugin list
agents plugin describe workspace-notes
agents plugin call workspace-notes notes.list --workspace /existing/plugin/workspace
```

内置插件位于应用 `Resources/plugins/`；用户插件位于
`$AGENTS_COMPANY_HOME/plugins/`（默认 `~/AgentsCompany/plugins/`）。开发时可通过
`AGENTS_COMPANY_PLUGIN_DIRS` 提供额外目录。优先级依次为内置、用户、额外目录。
同一 ID 使用后读取的包。安装不会覆盖已有用户插件；更新时先停止使用该插件，
备份并替换对应包，然后重启宿主、执行 `workspace docs` 更新文档和启动器。

## Workspace contract

新 Team 只有 **Build** 本机项目与 **cloud** 云端项目；cloud 绑定已登记的主机和远端目录。插件独立打开，不配置插件团队。用户或 Secretary 在插件“授权人员”中选择具体内容和员工的阅读、修改、新增权限；员工通过 `plugin.resources` 发现内容，再使用 `plugin.call`。Mission 内置超级笔记本改由 Core `notebook.*` 命令直接提供。`autoAttach` 与旧 Work 绑定只保留兼容。

```sh
agents group add Planning --mode build
agents group list --details --json
agents notebook resources
agents notebook call page.get --params '{"pageId":"AUTHORIZED_PAGE_ID"}'
```

旧 Work Team 根目录继续使用 `<插件工作区基目录>/<创建时的 Team 名称>`。
便携发布包使用 `$AGENTS_COMPANY_HOME/workspaces/<workspaceDirectory>` 作为基目录；
开发包有有效 `source-location.json` 时继续使用源码目录的 `workspaces/`，例如
`workspaces/`（旧插件工作区示例）。`AGENTS_COMPANY_WORKSPACES` 显式覆盖时，
基目录为 `<该环境变量>/<workspaceDirectory>`。安装到用户插件目录的包同样使用外部
工作区数据目录，不把工作文件放进可替换的软件包。
一个插件的旧 Team 各有独立目录；不再新增此类 Team。已登记的旧 Team 继续使用原目录，
升级不会自动移动文件。`workspaceDirectory` 只允许字母、数字、下划线和连字符；
省略时使用 `<plugin-id>-workspace`。

可选 manifest 字段 `defaultWorkspace` 为 `default`（省略时的默认值）或 `collection`。
前者让用户直接打开插件时使用基目录下的 `default/`；后者使用基目录本身，允许插件
在统一视图中索引各 Team 和用户内容。需要跨目录聚合视图的插件可使用 `collection`；其他插件保持原行为。
这是用户默认视图的选择，不扩大员工权限，不改变 Team/员工的 cwd，也不让插件向父级查找数据库。
旧 `default/` 的文件保留原位，集合视图从子目录读取它们；旧版外部默认目录的首次导入仍
复制到 `default/`，不覆盖集合或已有目录。已退役的旧 Team/Work 目录仍保留在原磁盘路径，不再作为新的工作区类型。
新员工默认在统一本地工作空间根目录（`~/Aexus-bot-workspaces/<员工名>`，可在偏好设置修改）或指定的云主机目录创建，各自工作区与插件目录解耦。
支持按员工、具体内容通过 `plugin.access` 授予阅读/修改/新增权限；Secretary 默认拥有完整权限。
历史兼容目录仍保留原位，不自动迁移或删除用户已有数据。

每个 Work 员工的**自身目录**内生成：

```text
employee-scope/
  AGENTS.md                  # 可选：用户原有指令，保持原位
  CLAUDE.md                  # 可选：用户原有指令，保持原位
  .agents-company/
    AGENTS.md                # 宿主管理的工具入口
    CLAUDE.md
    workspace.json           # schemaVersion 2、mode、scope、所选插件
    README.md                # 当前作用范围和 API 入口
    plugins/<id>/API.md
    plugins/<id>/schema.json
    bin/<id>                 # 固定 --workspace <employee-scope>
    ipc/<id>/<employeeId>/   # 带员工身份的本地 JSON-RPC 通道
  nested-employee/            # 可作为另一个员工更小的作用范围
```

宿主设置 `AGENTS_WORKSPACE` 为员工目录、`AGENTS_TEAM_ROOT` 为 Team 根目录，并将
员工自己的 `.agents-company/bin` 加入 PATH。启动器拒绝覆盖 `--workspace`。
Worker 不需要读取父目录中的文档或管理文件；文档副本位于自身授权范围。

`createPlugin()` 收到的 `workspace` 就是本次操作的完整授权范围。Team 界面使用
Team 根目录，员工 CLI 使用该员工目录。插件不得自行向上查找另一个全局数据库，
必须限制 API 和附件读取在给定目录及其子目录内。父目录可以通过文件变更观察
子工作空间；子工作空间不得向父目录查找附件或数据。

Work 使用固定的目录写入策略：Codex 的目录权限 profile 限制 Team 内的读取和写入；
Claude 的 shell sandbox 和文件工具检查应用同一边界。不会为员工额外放行整个
Team 根目录，也不能切换到 Full access。Build 保留原有 Agent 权限选项。
插件运行时是受信任本地代码，插件作者仍须正确执行 workspace 边界。

切换到 Build 会移除已生成的 CLI 启动器和受管理指令块，保留用户文件及插件数据。
删除 Team 会同时删除其中的员工以及本地、Codex、Claude Code 会话；原生清理失败时保留 Team 和员工记录供重试。卸载软件或删除 Team 不删除工作文件夹。软件元数据应放在自己的隐藏目录，
文档必须明确可直接编辑的文件格式，以及只能通过 API 修改的状态。

## Runtime API

`runtime.cjs` 导出一个工厂；同一个插件在不同目录作用范围中获得不同实例；同一范围内的 GUI/CLI 共享服务：

```js
exports.createPlugin = async ({workspace, pluginRoot, executable}) => ({
  async request({jsonrpc, id, method, params}) {
    return {jsonrpc: '2.0', id, result: {}};
    // 或 {jsonrpc:'2.0',id,error:{code:-32000,message:'...',data:{code:'DOMAIN_ERROR'}}}
  },
  async subscribe(listener) { return () => {}; }, // 可选，返回取消订阅函数
  async readAsset(path) { return {bytes: new Uint8Array(), mimeType: 'text/plain'}; },
  async close() {} // 可选，释放自身持有的服务/资源
});
```

`workspace` 是当前选定的真实目录；可选 `workspaceBase` 是插件全局集合目录，用于计算页面的全局物理层级，旧插件可忽略此字段。`pluginRoot` 是包目录；`executable` 是可使用
`ELECTRON_RUN_AS_NODE=1` 运行 Node 程序的绝对入口。CLI、运行时和 GUI 必须复用同一
领域实现/服务，不能拥有互不相通的持久化副本。多个写入者需要冲突检测。
JSON API 的 `id` 为字符串或数字，`params` 为对象，错误使用 JSON-RPC 数值错误码；
稳定领域错误码放在 `error.data.code`。CLI 失败必须非零退出。

## Sandboxed CLI transport

Work 员工启动前，宿主会准备所选插件的运行时和 Workspace 内的 JSON-RPC 通道。
生成的 CLI 启动器设置 `AGENTS_COMPANY_PLUGIN_RPC`，指向
`.agents-company/ipc/<plugin-id>/<employeeId>`。此通道让受文件系统沙箱约束的 CLI 继续使用
同一个后端，不需要放开网络或任意 Unix socket 权限。

插件 CLI 可以采用以下可选协议：

- 检查目录中的 `host.json`（包含 pid 和已规范化的 workspace）；宿主未运行时可用软件自身的本地服务模式。
- 生成随机 UUID，将 JSON-RPC 请求先写入 `<uuid>.request.json.tmp`，再原子重命名
  为 `<uuid>.request.json`。等待 `<uuid>.response.json`，解析后删除响应。
- 宿主执行 `runtime.request()`，原样返回 JSON-RPC 响应，不另外实现业务操作。
- `events.json` 保存 `{sequence,events:[{seq,data}]}`，保留最近 128 个事件；
  长期订阅按序号去重，发现断档后重新读取领域状态。宿主正常退出时删除 `host.json`。
- CLI 必须有请求超时并报告失败。这个通道位于员工自身可写目录。CLI 使用宿主提供的规范化路径，避免再次遍历无权读取的父目录来 realpath。

普通终端和独立 App 继续使用软件自己的 CLI/后端连接方式。不要将宿主通道加入
个人全局配置，也不要让一个 Team 的 CLI 自动回退到另一个 Team 的数据。

## Renderer transport

点击 Team 标签统一打开工作目录的文件浏览器（Work / Build / Cloud），不打开插件。
点击左侧插件通过 `plugin open ID` 使用其默认工作区打开独立原生窗口，与宿主共用 Dock 图标。
窗口直接加载插件页面，不使用 iframe，也不增加宿主侧栏或工具框；公司画布仍在主窗口中。
没有 Team 也可使用插件。相同插件和工作区重复打开时聚焦已有窗口。
`view open plugin --plugin ID` 保留为兼容入口；`plugin view ID` 是仅返回 URL 的底层接口。
窗口打开、关闭、位置、尺寸、最小化/全屏都可用宿主 CLI 操作，见 [API.md](../../API.md)。
`agents serve` 同样支持这些 Core 命令，返回 `attached:false`，不需要 Electron。
每个插件视图使用独立的本机端口和随机令牌前缀。不暴露 Electron/Node 或宿主 IPC 对象。

从 `new URL('.', location.href)` 得到视图 base URL：

| 相对路由 | 用法 |
| --- | --- |
| `rpc` | POST JSON-RPC 请求，返回完整 JSON-RPC 响应 |
| `events` | GET Server-Sent Events，每个 data 是运行时事件 JSON |
| `data/<path>` | GET，传给 `runtime.readAsset(path)`；插件自行限定工作区路径 |
| 其他路径 | 包内静态文件；入口 URL 带 `?hosted=1` |

浏览器地址不是持久数据 ID。附件应保存稳定引用并在渲染适配层转换成视图 URL。
不要将端口、令牌写进用户文档。视图重开会更换 URL；需要恢复的草稿应通过 API 保存。

窗口消息协议：`token = location.pathname.split('/')[1]`。
独立窗口中 `parent === window`，原有 `parent.postMessage` 插件无须修改。
宿主专用 preload 只转发以下白名单消息，业务操作仍走 `rpc` / `runtime.request`。

1. UI 完成初始化并能处理 API 事件后发送
   `parent.postMessage({type:'agents-plugin:ready',token}, '*')`。
2. 宿主关闭窗口/退出前发送 `{type:'agents-plugin:flush',token,id}`。
   插件核对 `event.source === parent` 和 token，等待编辑器及后台写入完成，回复
   `{type:'agents-plugin:flushed',token,id,error?:'保存失败原因'}`。
   有错误或 12 秒超时，宿主保留视图；必须明确报告失败。
3. 用户点击外部网页时发送 `{type:'agents-plugin:external',token,url}`。
   宿主校验消息来源并仅允许 HTTP/HTTPS，由默认浏览器打开。

4. 可选：从插件自身 CLI 设置推导主题后发送 `{type:'agents-plugin:appearance',token,theme:'light'|'dark'}`。
   插件原生窗口背景随主题显示，不修改公司的主题设置；业务设置仍经插件 API 持久化。

宿主会检查发送窗口、来源和 token。运行时是**受信任的本地代码**，具有当前用户的
系统权限；独立来源和令牌用于隔离视图与路由，并不是恶意插件的系统沙箱。
只安装自己开发或信任的软件包。

## Standard Markdown

每个插件提供 UTF-8 `API.md`，使用统一 front matter：

```yaml
---
schema: agents-company.cli/v1
plugin: workspace-notes
version: '1.0.0'
workspace: required
---
```

正文必须依次包含以下二级标题（标题固定，内容可以中文）：

| 标题 | 必须说明 |
| --- | --- |
| `## Purpose` | 软件用途、主要能力 |
| `## Workspace` | 根目录选择、相对路径规则、员工 cwd 与数据关系 |
| `## Quick start` | 可复制的读取、创建、修改命令；返回值和 ID 获取方式 |
| `## Commands` | 命令入口、参数、读写性质、JSON 请求响应；引用 schema |
| `## Files` | 用户文件格式、内部状态目录、外部修改同步、备份方式 |
| `## Errors` | 稳定错误码、冲突与失败的处理方式 |
| `## Compatibility` | 契约版本、运行环境、独立模式与宿主模式的能力范围 |

`schema.json` 包含 `schemaVersion:1`、`pluginId`、`version`、`commands`；
每个命令至少定义 `method`、`description`，写操作标记 `mutates:true`，参数在
`options` 中声明类型、必填项、描述，复杂对象提供 `examples`。

## Mission 超级笔记本（已内置为 Core 能力）

原 MiniNotion 笔记本与多视图数据库实现已集成至 Aexus Bot Core 的 `Mission` 视图（`src/shared/mission-notebook/`、`src/main/mission-notebook/`、`src/renderer/src/mission-notebook/`），通过 Core 命令 `notebook.*` 直接暴露；原 `margin-reader` 精读与脑图工作台已集成至 `Library` 视图（`resources/library-reader/`、`src/main/library-reader/`、`reader.*`），原 `cloud-hosts` 云主机管理与终端/SFTP 已集成至 `Library` 视图与 Core `host.*`（`host.resources`、`host.access`、`host.files`），均不再作为外部插件打包或通过 `plugin.*` 调用；完整说明见 [docs/MISSION_NOTEBOOK.md](../../docs/MISSION_NOTEBOOK.md) 与 `docs/LIBRARY.md`。

## Source layout and builds

`plugins.lock.json` 为空列表（`"plugins": []`）：内置功能直接随 Core/UI 构建交付。外部或第三方开发插件源代码仍可放在 `PlugIns/<name>/`（参考 [`examples/plugin-starter`](../../examples/plugin-starter)），并通过 `package.json` 的 `build:plugin` 脚本实现 `--out <directory>` 构建协议；`npm run build:plugins` 会遍历 `plugins.lock.json` 中登记的包输出到 `build/plugins/<name>/`，`agents plugin install` 也可安装任意外部插件到 `$AGENTS_COMPANY_HOME/plugins/`。

交付 App 直接包含内置的 `Library`（资料库、超级搜索、`Study Reader` 与 `Cloud Hosts`）和 `Mission` 超级笔记本，不需要额外插件仓库 checkout。源码和用户数据分离，现有 Markdown/API 文档规范保持不变。

创建员工默认在 Team 根目录内生成与员工同名的文件夹，保留中文、空格和大小写。Work 员工绑定已有文件夹时必须在插件权限根目录的子级；Build 可以绑定项目根目录之外的物理文件夹。移除员工会清理其 Codex / Claude 原生会话，工作文件与插件文档仍保留。


## CLI-first enforcement

所有新插件以无窗口 Core/CLI 为基础，界面只渲染或调用这些接口。不能把业务数据、
业务动作或执行状态仅放在 renderer/localStorage 中，也不能通过私有 Electron 方法绕开 Core。
会话与引擎管理由宿主的 CLI API 提供，插件不得另开与宿主员工无关联的隐藏会话。

插件安装要求独立 CLI、共享 `runtime.request`、非空命令 schema 和上述规范 Markdown。
每个方法必须有唯一名称和说明。CLI、HTTP 界面和员工 mailbox 共用同一请求校验：
未声明的方法返回 `-32601`，不能从 GUI 偷渡。界面初始化/就绪等生命周期方法也应声明，
这类命令本身不得以弹出窗口作为业务执行前提。

提交插件必须验证：无 Electron 环境下的创建/读取/修改/错误路径；schema 与 Markdown
同步；GUI 请求均能通过 CLI 重放；不可达接口或冲突不能导致静默数据丢失。
使用 `npm run test:coverage`、`npm run test:cli-foundation`、`npm run test:plugins`、`npm run test:mission-notebook`
以及插件自身的 headless 测试。`examples/plugin-starter` 提供共享运行时与 schema 校验样例。

## Host scheduling foundation (v1)

插件或内置 `Mission` 笔记本需要安排宿主员工工作时，复用 `agents schedule` / socket `schedule.*`。
完整规范见 [SCHEDULER.md](../../SCHEDULER.md)。`source` 可保存来源 ID 以便过滤；它不授予权限。
模型、思考覆盖是临时的，目录和引擎身份来自已有员工；不要另启隐藏会话或私自提升权限。
宿主运行才会触发，工作流必须呈现真实的失败、跳过、取消结果；内置 `Mission` 超级笔记本已通过 `/workflow` 与 `button.*` 直接接入 `direct.send` / `session.send`、`mission.create` 与 `schedule.create`。

Builtin Cloud Hosts 在 `Library -> Cloud Hosts` 中直接使用 Core `host.*`（含 `host.resources`、`host.access`、`host.files`、`host.terminal-*`、`host.exec`）提供完整配置、SFTP 远程文件与 SSH 交互终端，无需外部插件通道；Secretary 默认全权，普通员工仅可访问明确授权或自身绑定的主机（阅读不返回凭据，修改不含导出私钥或删除主机）。

支持 `scope: "application"` 的外部插件同样通过宿主公开 API 管理跨范围平台资源；工作文件仍限定在员工目录内，插件不得通过读取父目录偷偷扩大文件权限。应用级业务能力通过文档和 schema 明确列出，不通过私有 IPC。

新 cloud Team 只能使用已登记 `hostId` 和现有远端 `directory`。旧 SSH 配置自动迁入主机库，数据备份后去重；新 Team 不再新建账号。连接详情与凭据通过 `host` CLI 或 Cloud Hosts UI 修改，密码默认隐藏。

## 调用身份与授权

宿主传入的 `requestHost({cmd,args})` 保留实际调用者身份。插件不得自行读取用户控制凭据来代替员工调用。员工 mailbox 请求携带自己的认证凭据；目录位置不是身份。
普通员工由 runtime.requestScoped 按当前内容授权处理，禁止仅凭 schema 或工作目录扩大权限。旧 Work mailbox 的 `agentAccess: "workspace"` 仅兼容未配置新 ACL 的原有目录。用户与 Secretary 使用完整原生接口；其他职位不会自动获得全库权限。应用级主机插件复用同一 host.* 逐主机检查。插件内部的独立 Agent 启动入口不向普通员工开放。

## Web transport

The host keeps plugin frames in an opaque-origin sandbox. It injects a bridge for same-view `fetch` POSTs to `rpc`; the parent sends declared methods through authenticated `plugin.call` with the original structured JSON-RPC result (`raw`). Plugins must not rely on Core cookies, tokens, or a browser-local loopback server. A page URL alone does not grant RPC authority. Keep existing fetch-based RPC and save/flush acknowledgement behavior shared between desktop and Web.


## Content authorization capability

Built-in plugins expose `resources(): Promise<PluginResource[]>` and `requestScoped(request,scope)` through the existing runtime boundary. Resources carry a stable ID, title, kind, optional nativeId/parentId/inheritFrom/capabilities. Scope contains the authenticated employee and current per-resource read/write/create grants; incoming client identity/scope fields are discarded. A scoped response may return private `createdResources` for Core to grant creators ongoing access before returning the native result. Unknown or unsupported scoped commands fail closed. User/Secretary execute the original plugin request interface unchanged. `mutates` is explicit in packaged command schemas so native read operations do not ask for write approval.
