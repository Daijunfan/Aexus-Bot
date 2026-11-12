# Message 中的外部 Worker

Dot、Grok Bot 和 Grok 原生群组都作为 Worker 会话出现在 Message 中。它们不是 Company 员工，不签发本软件凭据，不拥有团队、插件、频道或计划管理权限。软件只向它们投递明确选中的任务正文、引用和附件，不注入本项目身份、系统包裹提示词或 Core 工具。既有官方会话、账号与历史继续保留。

`bot.sync` 复用本机 ChatGPT/Codex 与 Grok Bot 官方登录态，导入主 Dot、现有 Grok Bot 和原生群组。凭据在 Core 内存中读取，不传给调用员工、云主机或 Bot。中转不另开未认证 HTTP 服务，也不依赖 Bots-API 源码目录或它的 App 运行。连接代码参考本机 Bots-API；支持的真实接口以原生应用协议为准。

## 自动连接 Mac

macOS Core 启动后，会为已经接入的 Dot 和 Grok 自动启动各自的原生后台执行组件。只使用 Web 界面时也有效：Mac 上的 Aexus Core 保持运行即可，ChatGPT 和 Grok Bot 主应用不必打开。官方应用需要已经安装并登录；本项目直接调用其本机组件，不重新分发这些运行时。

Dot 沿用原生 Mac 安装标识、登录和已启用插件，使用 ChatGPT 自带的 `exec-server` 连接原生执行通道；Grok 沿用既有机器 ID、加密文件密钥、原生本机执行服务及执行权限。启动不改变已有权限，不注入 Company 身份或 Core token，不更换执行主机。已有原生进程由原来的程序管理；Aexus 只停止自己启动的执行进程，Grok 主应用接管监督后不会被 Aexus 退出终止。

`bot.list[].bot.localComputer` 是当前 Core 的运行投影，不写入聊天历史：`starting`、`connected`、`reconnecting`、`external`（已有原生进程管理）、`error`、`unsupported` 或 `stopped`，可附带 `connectedAt/error`。`connected` 只在收到原生连接确认后出现；进程存在、消息已发送或历史可读都不代表本机已连通。启动失败后后台重试，断线由原生通道重连，不重发用户任务。删除一个 Bot 保留同提供方其他会话的本机连接；移除最后一个会话后停止该提供方由 Aexus 管理的组件。Linux/Windows Core 不会自动改到另一台 Mac 执行。

本机连接与模型账户额度分别检查。Grok 额度耗尽仍可维持 Mac 通道，但模型任务需要等待账户额度恢复；不会自动开通按量付费或冒报任务完成。

用户与 Secretary 自动拥有全部会话的操作能力。其他员工必须由 `bot.access {id,employeeIds,expectedRevision}` 授权；撤销后不能继续发送、读取、下载，依赖该来源的事件计划也会失效。云端员工使用同一身份和同一 API，不接收用户 token。外部 Worker 自身永远不能调用这些管理接口。

`bot.create` 创建 Grok Bot；`bot.group-create` 用已导入的 Grok Worker 会话 ID 创建原生群组。`clientRequestId` 必须为稳定 UUID，相同参数重试复用同一个远端创建身份。Grok 群组原生 Bot 成员与本软件的员工授权名单分别保存。不会把本软件的员工身份注册为 Grok Bot，也不会自动重置或删除官方历史。

## 同一套消息与文件接口

Grok 的消息送达与任务执行分开记录：`direct.send-status.status=accepted` 仅表示远端接收；原生执行失败保存在 `executionFailure`，并保留原来的发送 ID，重试查询不会重复投递。`bot.list[].bot.issue` 返回当前用量或执行问题的 `code/message/retryAt/at`，会话显示原因和本地时区的重置时间；失败信息保留至重启后。用量检查为只读，不改变套餐或开通按量付费。额度耗尽时新发送在远端投递前被拒绝，输入草稿保留；额度恢复后可显式重新发送。正常发送先唤醒原生运行环境，原生 `turnFailed` 通过服务端 turn ID 关联原消息，实时通道断线后只重连，不重放已接收任务。

先用 `bot.list` 取得 ID 和 `conversation`，不要按名称或猜测 ID：

- 私聊：`direct.send {employee:Worker会话ID,text,images?,files?,clientMessageId}`，`direct.history`，`direct.send-status`。普通员工可调用获授权的外部 Worker；向原生员工发送用户私聊输入仍仅限用户与 Secretary。
- Grok 群组：`chat.send` / `chat.post`、`chat.history`、`chat.context`，参数与其他群组相同。只有显式调用才发送；接收 Bot 回复不会自动转发或触发成员互相回应。
- 文件：`conversation.entry` 返回附件 ID；`conversation.download` 默认复制到调用员工的 Company 执行工作区，云端员工对应远程主机的工作区。轮询 `conversation.download-status` 后再使用。用户与 Secretary 可用 `conversation.download-local` 保存到明确选择的 Mac 路径。
- 修改与发送：在自己的工作区编辑，使用 `conversation.upload` / `upload-status` 上传共享副本，再发送返回的 `@workspace/…` 路径。更新共享原件仍需 `expectedVersion`，创建不会覆盖已有文件。图片和文件可单独发送。Dot 使用原生每文件 20 MiB 限制；Grok 继承服务端文件额度与格式能力。

私聊也返回规范 `group:ID` 文件/事件引用，`employee:WorkerID` 作为私聊文件 API 的别名。界面与 CLI 读取同一消息记录、附件和已读水位。未知发送结果保存为 uncertain；先查状态与历史，不会自动以新 ID 重投。稳定消息 ID 的相同重试不会重复发送。

## 委派与唤醒

Grok Bot 拥有原生 X 工具。需要检索或研究 X 内容时，可把任务交给获授权的 Grok Worker。此部署中的 Dot 使用用户配置的 GPT 6 Astra，适合复杂推理与长任务；响应可能较慢。

**委派前先保存持续事件计划，再发任务。** 例如给自己的 `schedule.create` 规则：

```json
{
  "name": "处理 Dot 后续回复",
  "action": {"type":"agent","employeeId":"self","prompt":"读取 Dot 新到的回复，核对委派任务的进度；有结果后继续完成用户的工作，并在私聊报告。"},
  "rule": {"kind":"event","event":"message.received","conversation":"group:从bot.list取得的ID","cooldownSeconds":0}
}
```

Dot 可以先确认收到，几分钟后再发多条结果，间隔没有固定上限。第一条消息或一段安静时间都不是结束信号。持续等待时不要设置 `maxOccurrences:1`，不要在确认消息后删除计划；完成整个委派后先发布结果，再暂停后续唤醒。员工在当前轮次删除自己的计划时，未来触发立即移除，返回 continuingRunIds，当前轮次可完成收尾；主动取消才停止当前工作。事件以公开消息 ID/版本去重，员工忙碌、冷却或暂时不在允许时间窗时持久排队，最多每次合并 100 个待处理事件，其余继续等待。重启保留待处理事件；已经启动而中断的 Agent 轮次保留中断记录，不盲目重做。

消息历史只展示平台公开的发言与附件；本软件不会获取外部模型的隐藏推理。待回复动画表示已投递并尚未收到后续公开发言，不代表平台确认整个任务完成。

## Dot native appearance

Dot uses the original OpenAI Codey blue computer atlas, independent of the employee catalog. Waiting, replying, idle and attention states use the original animation frames; invisible views and reduced-motion settings stop playback. bot.appearance reports native:true and editable:false. Other local character overrides fail explicitly; saved legacy appearance records remain archived and native bot identity, prompts, history, connectivity and permissions are unchanged.
