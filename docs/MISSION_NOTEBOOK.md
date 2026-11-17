# Mission 超级 Notion 工作流笔记本

Aexus Bot 的 `Mission` 视图内置了工作区级超级 Notion 笔记本与 10 视图工作流/排期引擎（默认数据目录：`~/AgentsCompany/mission-notebook`；旧版 `~/.mini-notion` / `~/AgentsCompany/workspaces/mini-notion-workspace` 启动时自动迁移，并沿用 `plugin-access.json` 既有页面授权到 `mission-notebook-access.json`）。

## 视图与导航

- **超级笔记本（默认）**：BlockNote 多列富文本编辑器、`/workflow` 工作流按钮、10 种视图数据库（`table` / `board` / `gallery` / `list` / `calendar` / `timeline` / `chart` / `feed` / `form` / `plan`）、关系/汇总/公式/依赖属性、评论、同步块、子页面与文件目录树。
- **工作流与排期切换**：侧边栏及顶栏提供 **工作流与排期** 入口，可切到 Mission 排期面板（`plan.*` / `schedule.*` / `mission.*`），并通过 **返回超级笔记本** 切回笔记本。
- **内置工作流动作**：笔记本按钮与自动化除支持原生动作外，还直接集成三种 Aexus Bot 动作：
  - `agent`：通过 `direct.send` / `session.send` 派发员工执行提示词，可选同时授予该员工本页 `read` / `write` / `create` 权限（`grantPageAccess`）。
  - `mission`：调用 `mission.create` 创建持续督办或独立目标。
  - `schedule`：调用 `schedule.create` 创建一次性、周期、每周或事件驱动的定时工作流。

## Core / CLI 接口

- `notebook.status`：查看笔记本根目录、版本号、页面与数据库统计。
- `notebook.guide`：按主题读取实操指南（`start` / `pages` / `blocks` / `databases` / `workflows` / `delegation` / `verify`）。
- `notebook.methods`：检索内置笔记本子命令列表与描述（支持 `--query`）。
- `notebook.resources`：列出获授权访问的页面、子页面与数据库树（`plugin.resources` 同语义）。
- `notebook.access`：读取或原子更新指定员工对具体页面/数据库的 `read` / `write` / `create` 权限（仅用户与 Secretary 可修改）。
- `notebook.call`：执行具体笔记本方法，例如 `page.create`、`page.read-markdown`、`page.write-markdown`、`database.create`、`record.create`、`view.render`、`button.create`、`button.run`、`fs.audit`（完整参数查 `notebook.call` 的 `schema` 子命令）。
- `notebook.asset`：读取笔记本物理资源（图片/附件/头像）字节与 MIME 类型。

## 权限模型

- **用户 / Secretary**：拥有笔记本全部页面读写与授权能力（`Secretary` 为应用最高管理角色）。
- **普通员工**：按页面粒度检查 `read` / `write` / `create` 授权；拥有 `create` 或在授权父页面下创建的新子页面自动向创建者授予管理能力。读取本文档本身不授予任何执行权，权限由 Core 逐次检查。
