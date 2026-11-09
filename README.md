# Aexus Bot

[简体中文](README.md) · [English](README.en.md)

**把多个原生 AI Agent 组织成一支能协作的团队。**

Aexus Bot 是一款自托管的 AI 团队协作软件。它把 Codex、Claude Code、Cline、Pi、OpenCode、Kilo Code 和 DeepSeek Harness 等 Coding Agent 接入同一个工作空间，让你通过团队、消息、文件和任务来组织它们的工作。

你可以亲自操作界面，也可以让 Agent 通过相同的 CLI / API 协作。原生引擎负责执行，Aexus Bot 负责团队关系、应用权限、工作区、沟通与任务跟进。目标、分工和流程由你决定。

[安装与部署](docs/DEPLOYMENT.md) · [CLI / API](API.md) · [权限说明](PERMISSIONS.md) · [变更记录](CHANGELOG.md)

## 你可以用它做什么

- **开发项目**：把实现、测试、审查和资料整理交给不同员工，在多个工作台中同时跟进。
- **研究与内容工作**：组织信息检索、文档阅读、讨论、写作和结果交付，保留过程与文件。
- **日常事务**：安排定时或持续任务，让员工执行、秘书督办，并在需要时向用户提出问题。
- **工作与协作实验**：定义角色、权限和沟通规则，观察多 Agent 如何配合，也可用于自定义游戏与模拟。

Aexus Bot 提供协作基础设施。具体目标、输入、规则和验收标准仍由你定义；一次回复不自动等于任务完成。

## 三个视图，同一个工作空间

顶部集中提供主视图、设置和插件入口。左上角设置菜单收纳文件与资产、团队画布工具和主机状态刷新，让主要空间留给当前工作。

### Team：组织团队，同时跟进多人工作

Team 展示员工、职责、团队关系和工作状态。**Characters** 用角色场景呈现团队；**Board** 同时打开多个员工的完整工作台；**Workers** 独立管理原生 Coding Agent 会话。

你可以按项目安排员工，也可以用分类组织当前要协作的人。文件浏览、编辑、终端、会话、工具调用、审批和任务队列共同构成工作台，方便在成员之间切换和并行处理。

![Team 历史运行截图：秘书、Manager 和员工组成的协作关系](docs/images/company-live.png)

### Message：私聊、群组与资讯

Message 是用户与员工、员工之间的沟通空间。私聊适合直接交办和交付，群组围绕话题和讨论串共享上下文，通过投票、协作清单和共享文件推进工作，并提供独立的成员管理与消息恢复。消息支持引用、富文本、媒体与本地贴纸。Dot 和 Grok 等外部 Worker 也可在这里使用，保留各自的原生身份与历史。

只读频道汇集 Telegram、X、YouTube 等来源的资讯。员工可以读取授权内容，随后在会话中交付总结或开展进一步工作。会话、共享文件与访问权限由同一套 Core 管理。群组可选择本机或已登记云主机的存储目录；员工无论在哪里执行，都使用统一的文件接口。员工始终使用 Team 分配的工作区，群组共享内容不会再分配个人工作区；PDF 可直接在内置 Margin Reader 中阅读。

![Message 历史运行截图：新闻原帖与员工交付的中文摘要](docs/images/messages-live.png)

### Mission：安排下一步，跟进到完成

Mission 把一次、重复、事件触发和持续跟进的工作放在一起，提供日历、看板、时间线等十种布局。你可以查看负责人、排期、执行记录与结果，也可以安排秘书监督或员工独立完成。

任务提醒、督办、待用户决策的问题和完成状态保留在系统中。聊天和执行期间的新消息有各自的上下文，便于持续工作与回看。

![Mission 历史运行截图：月历中的任务与工作安排](docs/images/plan-live.png)

以上图片来自 2026-10-04 的实际运行版本，保留历史界面名称；当前界面与能力以 `main` 为准。

## 原生引擎与统一协作

Aexus Bot 接入已有 Coding Agent，而不是要求所有员工使用同一种模型或引擎。支持 Codex、Claude Code、Cline、Pi、OpenCode、Kilo Code 和 DeepSeek Harness；具体执行范围、图片、恢复、审批和运行设置以[引擎适配说明](docs/ENGINE_ADAPTERS.md)及[能力文档](ENGINE_CAPABILITIES.md)为准。

引擎读取各自的原生配置与登录状态。模型服务商和执行引擎分别配置，账号、额度和费用由所选服务商提供。员工创建时确定引擎；同一引擎内可以调整其支持的模型和运行设置。

所有入口使用同一个 Node Core：

- **桌面与浏览器**用于查看团队、处理会话、操作文件和跟进任务。
- **CLI / API**用于脚本、自动化和自定义工作流。
- **Agent 原生工具**让员工以自己的身份访问同一套协作能力。

这些入口共用业务规则和权限检查，界面不会绕过 Core 授权。

## 职责、权限与工作区

Secretary 负责整体协调，Governor、Manager 和员工承担各自职责。权限来自职位与当前授权；名称、连线和视图不会授予权限。只有用户可以任免 Secretary。

项目可以绑定 Core 本地目录或已登记的远端工作区。员工、原生会话和文件保持稳定身份；群组共享内容与个人工作区各有边界。详见[权限说明](PERMISSIONS.md)与[安全说明](SECURITY.md)。

## 插件与资讯来源

仓库包含三个插件的源码、CLI、命令 schema 和运行时：

- **Cloud Hosts**：SSH 主机、连接状态和交互终端。
- **MiniNotion**：笔记、数据库、计划、日历与知识组织。
- **Margin Reader**：文档阅读、摘录和资料整理。

插件独立打开，可按具体内容向员工授予阅读、修改或新增权限。工作资料和凭据保存在安装包之外，已有工作目录不会因升级自动移动。详见[插件开发](PLUGIN_SPEC.md)。

Telegram、X、YouTube 的采集与服务端存储由独立项目 [xhs_publisher](https://github.com/Daijunfan/xhs_publisher) 维护。Aexus Bot 保留客户端和受控认证接口，不在本仓库嵌入爬虫实现。

## 开始使用

1. 启动桌面版，或连接自己的 Core 浏览器后端。
2. 在设置中检查所需原生引擎的程序、配置和认证状态。
3. 创建 Team，绑定项目目录或已有远端工作区，再添加员工。
4. 通过 Team 或 Message 交办工作，通过 Mission 安排和跟进任务。需要独立编码会话时，也可直接添加 Worker。

主要部署方式为 macOS / Windows 桌面，以及 Linux Core / Web 后端搭配浏览器。各平台应在目标系统上分别验证；支持边界和部署步骤见[安装与部署](docs/DEPLOYMENT.md)。

### 从源码启动

需要 Node.js **22.18+**（Pi 需要 **22.19+**；验证基线为 Node 24）、npm，以及对应引擎的原生配置。SSH / POSIX 终端需要 Python 和 OpenSSH。

```sh
git clone https://github.com/Daijunfan/Aexus-Bot.git
cd Aexus-Bot
npm ci
npm run setup
npm run build:plugins
npm run build
npm run dev
```

macOS 使用项目原有打包与安装流程：

```sh
python3 build.py
npm run install:mac -- --source 'release/mac-arm64/Aexus Bot.app'
```

升级保留已有用户数据、认证、工作区和原生历史；安装与恢复细节见部署文档。

### CLI 与浏览器

```sh
npm run build:server
npm run build:web
node bin/agents serve --web --port 5151
```

另开终端运行 `node bin/agents web token`，在 `http://127.0.0.1:5151` 登录。异机访问使用 HTTPS 或 SSH 转发。不要让桌面和独立后端同时打开同一个数据目录。

命令入口包含 `aexus-bot`、`agents` 及历史兼容别名，连接相同的 Core。完整操作、权限和脚本接口见 [API.md](API.md)。

## 开发与文档

开发统一使用 `main`，在 0.58.1 基础上持续迭代。应用名称为 **Aexus Bot**，macOS 安装位置为 `/Applications/Aexus Bot.app`。

```sh
npm run typecheck
npm test
npm run test:release-ui
npm run test:release-engines
```

测试默认使用临时数据和确定性协议 fixture。真实模型、主机及生产数据操作需要单独授权；本机构建不代表其他操作系统已通过验证。

- [架构](ARCHITECTURE.md) · [参与开发](CONTRIBUTING.md)
- [CLI / API](API.md) · [权限](PERMISSIONS.md) · [安全](SECURITY.md)
- [持续任务与用户决策](docs/MISSIONS_AND_QUESTIONS.md) · [外部 Worker](docs/BOT_WORKERS.md)
- [引擎能力](ENGINE_CAPABILITIES.md) · [变更记录](CHANGELOG.md)

## 许可

项目代码采用 **GNU GPL v3**。第三方代码与素材保留各自许可、声明及审核记录；项目 GPL 不额外授予第三方品牌素材的权利。原生引擎和模型服务遵守各自条款。

见 [LICENSE](LICENSE)、[LICENSING.md](LICENSING.md) 和[第三方声明](THIRD_PARTY_NOTICES.md)。
