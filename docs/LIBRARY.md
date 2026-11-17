# Library 资料库、精读工作台与云主机管理

Aexus Bot 的 **`Library`（资料库）** 主视图（顶栏顺序：`Library` | `Message` | `Mission`）统一管理本软件的所有存储空间、超级搜索、内置 PDF/EPUB/脑图精读工作台与 SSH 云主机管理。

## 存储全景与 7 个核心存储域

`library.overview` 按 7 个物理域统计磁盘占用、文件数、最近活跃文件、大文件排行及类型分布：

1. **Employee Workspaces**：集中本地工作空间（默认 `~/Aexus-bot-workspaces/<员工目录>`，可配置）与云端绑定目录。
2. **Private Chat Storage（与工作空间完全解耦）**：保存于 Mac 本机 `~/AgentsCompany/direct/<employeeId>/` 的私聊账本与附件，清空私聊存储（`direct.clear`）绝不影响员工工作区或原生会话。
3. **Groups & Channels**：群共享工作区、已发布群附件及频道归档。
4. **Study Reader Library**：默认精读文献库 `~/AgentsCompany/library-reader/`（首次启动自动从旧 `workspaces/margin-reader-workspace/default/` 与 `plugin-access.json` 中的 `margin-reader` 授权无损迁移）。
5. **Mission Notebook & Exports**：内置超级 Notion 笔记本与任务导出（`~/AgentsCompany/mission-notebook`）。
6. **Shared Workspace**：跨成员共享中转目录（`~/AgentsCompany/Shared`）。
7. **Cloud Hosts**：已登记 SSH/VM 主机配置、密钥及状态目录（`~/AgentsCompany/cloud-hosts`，自动从 `plugin-access.json` 中的 `cloud-hosts` 授权迁移至 `host-access.json`）。

## 五大子页面

- **Storage Overview（存储全景）**：堆叠占比条、7 域卡片、文件类型分布、近期活跃文件缩略预览与一键“在精读中打开”、大文件空间分析与快捷上传。
- **All Files（全部文件）**：全屏分栏文件树与可视化画廊，支持内联编辑、重命名、回收站撤销、Finder 定位及兼容格式一键进入 Study Reader。
- **Super Search（超级搜索）**：`library.search` 实时检索文件名、文本正文行片段（含行号）、私聊消息/附件、Mission Notebook 页面、Study Reader 文献/摘录/脑图学习集与云主机，支持多域过滤、类型、员工、云主机、体积与时间窗口筛选。
- **Study Reader（精读与脑图）**：内置 PDF / EPUB / DOCX / MOBI / HTML / Markdown / 音视频精读、手写批注、摘录卡、XMind 脑图与 FSRS 间隔复习，提供 `reader.*` Core/CLI 接口与逐文献/学习集员工权限管理（`reader.access`）。
- **Cloud Hosts（云主机管理）**：SSH 与虚拟机配置管理、凭据加密存储与查看（`host.credentials`）、指纹扫描与信任、远端 SFTP 文件浏览器（`host.files`）、多标签 `@xterm/xterm` 交互终端（`host.terminal-*`）、单次远端命令（`host.exec`）及逐主机员工权限（`host.access`）。

## 权限模型

- **用户 / Secretary**：拥有全部存储浏览、`library.overview`、`library.search`、精读工作台打开/关闭及员工内容授权权。
- **普通员工 / Manager / Governor**：`library.overview`、`library.search`、`reader.access`、`host.access`、`host.files` 默认对用户/Secretary 开放；普通员工通过 `reader.resources` + `reader.call` 操作明确授权的文献/学习集，通过 `host.resources` + `host.*`（含 `host.files`）操作明确授权或绑定的云主机。读取本文档不授予任何执行权限。
