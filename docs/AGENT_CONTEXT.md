# Agent 上下文与消息协议

## 信息放在哪里

- 原生会话首次建立时提供一份简短路由，初始化只读取真实身份 `identity` 和文档目录 `index`。
- 固定规则不再附在每条用户消息后。Core 按实际原生会话 ID 保存已送达版本；关闭窗口、重开员工、应用重启和消息排队都不构成重新发送整套规则的理由。
- 职位、所属 Team 或规则版本变化时，只补发一次更新。身份以只读身份工具的实时结果为准，权限始终由 Core 检查，缓存只用于避免重复文本。
- 当前消息保留来源、回复方式、群组/消息 ID、引用、附件及关联 Mission 等动态信息；这些事实不能从上一次任务继承。
- API 参数和具体操作流程按任务查询 `describe` 或对应文档，禁止初始化时加载整套手册。执行成功后按需回读真实结果。

## 三个视图

| 显示名称 | 内容 | 接口示例 |
| --- | --- | --- |
| Team | 员工、原生工作会话和分配的工作区 | `card.*`、`session.*`、`workspace.*` |
| Message | 私聊、群聊、外部 Worker 和只读资讯频道 | `direct.*`、`chat.*`、`bot.*`、`channel.*` |
| Mission | 持续目标、排期、提醒与执行记录 | `mission.*`、`plan.*`、`schedule.*` |

内部兼容标识 `company/messages/plan`、工具名 `agents_company_*`、既有目录和原生会话 ID 保持稳定。它们不是界面名称，不代表另一个视图。MiniNotion 是独立插件，不能代替 Mission 的任务记录。

## 回复到哪里

1. 本条来源为 Team、CLI 或普通 Mission 工作：使用原生正文回复，结果留在 Team。
2. 本条为 Message 私聊：显式调用 `direct.post` 给用户发消息。
3. 本条为群聊：需要公开答复时，用本条真实群组/消息 ID 调用 `chat.post` 或 `agents_company_discussion_post`。
4. 用户本条明确指定其他目的地时按其要求发送；不要因为历史任务曾私聊就把 Team 对话发到私聊。
5. 静默阅读阶段只接收上下文，不能发言、写入或产生互相唤醒。阅读回执由 Core 维护。

引用只代表对应原文；附件需要在实际执行工作区读取。原生思考与工具过程保留在 Team 完整会话，不能把内部 ID、路由提示或工具结果当成面向用户的答复。

## 任务与工具

持续目标用 `mission.*`，只有显式成功确认才停止；一次原生轮次结束不等于任务完成。排期和事件触发使用 `schedule.*`，群组固定通知使用 `conversation.notice-*`。具体参数读取 `core/missions`、`core/scheduler`、`core/event-tasks`，不要用独立计时器代替员工排期。

秘书私聊请求可能已由 Core 登记 Mission，保留当前请求携带的 ID，先读取再调整，不能重复创建。必须由用户决定的问题用 `question.*`，保留 Other 与原有等待结果；新消息不覆盖未处理问题。

固定目标视图只用于当前任务，用户后来切换标签不改变它。显式要求另一个目标时先查询真实视图 ID；目标已删除应报告，不能退回所有 Team。视图和来源不授予权限。

工具入口是 `agents_company_documentation` 与 `agents_company_api`。先缩小命令范围，再查询准确 schema；只传 `command/args`，不用伪造身份或凭据。大结果按 `nextCall` 续读已完成操作的输出，不能为取结果再次执行写操作。

## 按需阅读

| 需要什么 | 文档 |
| --- | --- |
| 真实身份与职位范围 | 文档工具 `identity` |
| 私聊、群组、引用与投递 | `core/message-collaboration`、`core/group-collaboration` |
| 外刊、PDF 原页和同一条消息图文交替 | `core/magazine-reading` |
| 工作区、共享附件和本地/云端下载 | `core/conversation-workspaces` |
| Dot/Grok 委派与后台连接 | `core/bot-workers` |
| 权限、原生批准与执行主机 | `core/permissions` |
| 插件内容操作 | `plugin/ID/index`，再读对应 `plugin/ID/command/METHOD` |

本次改动不改写已有原生历史，不切换执行主机或扩大权限。独立 Worker 与外部 Bot 继续使用干净的原生上下文，不注入员工身份或本应用规则。

## Worker 与角色员工共用看板

Worker 在 Team 中作为员工类型展示，仍使用独立的 `worker.*` 执行通道，不转换成角色员工会话。成员分类、Team 显示归属及所属负责人都不生成角色提示、入职轮次、Team 合约或其他成员的聊天上下文，也不向原生 Worker 注入 Aexus 工具或员工令牌。只有明确提交的 Worker 输入进入它自己的原生会话；原生用户配置、项目指令、工作文件与自身历史照常保留。

角色员工通过原有 `session.*` 工作台发送；Worker 通过 `worker.send/steer/command` 发送。两类草稿、队列、原生 ID 和权限各自保留，分类成员关系不能授予 Worker 访问权。`test/team-worker-core-test.mjs` 使用七种引擎的确定性协议记录验证连接不产生初始化轮次、实际输入无额外包裹、直属 Worker 同样隔离，以及重启后身份和历史不变。
