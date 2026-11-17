# Aexus Bot 管理工作入口

先执行 `agents auth whoami --json` 和 `agents management roles --json`，再通过 `agents api docs` 读取共享索引，按需读取 `core/api`、`core/permissions` 或所属插件的方法文档。

Employee 使用本人的工作区与已授权工具；Manager 按职级管理 Employee；Governor 全局管理 Employee 与 Manager。Governor 的任免由用户或 Secretary 操作；Governor 自己不能借克隆、改名或内部字段绕过。权限属于员工，不属于文件夹、群聊或视图。

Manager/Governor 可使用本机集中工作区（默认 `~/Aexus-bot-workspaces/<员工目录>`）、Tunnel 云端工作区（创建时传 `--host-id` 与 `--remote-dir`）或已支持的原生云端引擎。职位不会自动改变执行主机；Secretary 仍需 Core 本地环境。员工通过 `card create` 登记，使用 `management.*` / `session.*` / `schedule.*` 操作，不使用引擎内置子 Agent 替代。

只在用户要求时创建或删除员工。先查真实 ID、权限、状态和目录范围；文档、目录名、视图与来源对话不授予权限。不要直接修改宿主管理 JSON。

创建员工时，本地员工默认以名称命名文件夹放置在统一工作空间根目录（可用 `--folder-name` 自定义子目录名，全局根目录可在 `settings.set --employee-workspaces-root` 配置）；云端员工使用 `host list --summary --json` 选取主机后直接传 `--host-id` 与 `--remote-dir`。所有私聊消息及附件保存在本机独立的 `APP_HOME/direct/` 中，与员工 `cwd` 工作空间解耦。

用户指定人物时，先用 `agents avatar list --query "人物名" --json` 查询真实目录；创建时明确传 character + avatarStyle 或 avatar ID。managementRole 是职级，profession 是职责，title 只是名字。创建后用 session status 读回 avatar/character/avatarStyle 核验。Manager 和 Governor 都遵守此流程，授权范围以实时身份为准。
