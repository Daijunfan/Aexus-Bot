# Message 中的外部 Worker

Dot、Grok Bot 和 Grok 原生群组都作为 Worker 会话出现在 Message 中。它们不是 Aexus 员工，不签发本软件凭据，不拥有团队、插件、频道或计划管理权限。软件只向它们投递明确选中的任务正文、引用和附件，不注入本项目身份、系统包裹提示词或 Core 工具。既有官方会话、账号与历史继续保留。

Message 主列表直接展示完整原生目录，包括尚未打开的 Bot 和群组；可按名称搜索，Private 默认同时包含原生 Bot 与 Grok 原生群组，和其他私聊在同一列表展示，不设置单独的 Bot 分区；Outsource 保留为可选筛选。目录数量覆盖整个账户，不把已接入的少数会话当作总数。点击项目直接打开对应会话，旁边的设置按钮直接定位到该原生对象。已接入会话不重复显示，已断开项目保留标识，只有用户明确打开才恢复，旧员工授权不会自动恢复。原生群组用最多四位真实 Bot 成员组成头像。

左侧顶部的 Bot 图标及目录数量栏打开统一管理器：分别显示 Dot、Grok 的 Bot 数量、Grok 群组数量，以及已接入 Aexus 的会话数量。目录包括尚未接入的原生对象；搜索、平台和类型筛选不改变账户总数。凭据在 Core 内存中读取，不传给调用员工、云主机或 Bot。中转不另开未认证 HTTP 服务，也不依赖 Bots-API 源码目录或它的 App 运行。支持的真实接口以本机原生应用协议为准。

## 原生账户管理

管理器顶部提供 **新增 Bot** 和 **新增群组** 两个入口。选中对象后可直接修改原生资料并保存；群组的成员分区支持搜索、多选后一次保存。对象标题旁的垃圾桶删除的是原生账户中的 Bot／群组，需要明确确认；“断开 Aexus”只移除本项目的接入，两者不会混用。

界面和 CLI 共用同一 Core 操作：

| 操作 | CLI |
| --- | --- |
| 列出完整目录 | `agents bot catalog --json` |
| 新增 Bot | `agents bot native-create --provider grok --kind private --name NAME --client-request-id UUID --json` |
| 新增原生群组 | `agents bot native-create --provider grok --kind group --name NAME --members '["NATIVE_BOT_ID"]' --client-request-id UUID --json` |
| 读取当前资料与版本 | `agents bot profile --provider grok --native-id ID --json` |
| 编辑 Bot／群组资料 | `agents bot configure --provider grok --native-id ID --expected-version VERSION --patch '{"name":"NAME","description":"GOAL"}' --json` |
| 编辑群成员 | `agents bot members --provider grok --native-id GROUP_ID --expected-version VERSION --members '["NATIVE_BOT_ID"]' --json` |
| 删除原生 Bot／群组 | `agents bot native-delete --provider grok --native-id ID --expected-version VERSION --confirm-native-id ID --client-request-id UUID --json` |

Dot 的增删和名称编辑使用相同命令，将 `--provider` 改成 `dots`；说明保持原生协议的只读限制，原生群组由 Grok 提供。版本来自 `bot profile`；一次操作的 UUID 应在重试时保持不变，新操作再生成新的 UUID。

`bot.catalog` 只读取原生资料，不批量导入历史、订阅会话或发送消息。Grok 查询包含账户团队对象；Dot 遍历全部分页。平台返回不完整列表时明确标注；离线时只显示同一账户的上次同步结果和错误，不把读取失败当作零个 Bot。选择“打开会话”才用 `bot.connect` 接入这一对象，原生 ID、已有 Aexus ID 和历史保持稳定。

| 管理操作 | Grok Bot / 原生群组 | OpenAI Dot |
| --- | --- | --- |
| 完整目录、数量、打开会话 | 支持 Bot 与群组 | 支持全部 Dot，按需建立消息会话 |
| 名称与设置 | 名称、职责称谓、说明/指令、原生形状和颜色 | 名称；说明只读，形象固定为原生 Codey |
| 群成员 | 原生 Bot 多选、搜索、一次保存 | 当前协议未提供对应群组能力 |
| 创建 | Bot、原生群组 | 账户允许时创建额外 Dot |
| 运行控制 | 停止当前任务、开始新会话、复制 Bot | 暂停、恢复、设为主 Dot |
| 删除原生对象 | 显示具体对象并确认后删除 | 显示具体对象并确认后删除 |

这些操作直接改变原生账户中的对象。管理器根据原生所有者/管理权限显示可写操作；只读共享对象不能借 Aexus 身份提升原生权限。未验证或未开放的能力明确不提供，不承诺替代官方应用的账户登录、订阅付款或全部平台设置。

UI、CLI 与 API 使用相同操作：

```sh
agents bot catalog --json
agents bot profile --provider grok --native-id NATIVE_ID --json
agents bot configure --provider grok --native-id NATIVE_ID --expected-version VERSION --patch '{"name":"Research desk","description":"Read and compare sources"}' --json
agents bot members --provider grok --native-id NATIVE_GROUP_ID --expected-version VERSION --members '["NATIVE_BOT_ID"]' --json
agents bot connect --provider dots --native-id NATIVE_DOT_ID --json
agents bot native-create --provider grok --name "Research desk" --client-request-id STABLE_UUID --json
agents bot control --provider dots --native-id NATIVE_DOT_ID --action pause --expected-version VERSION --client-request-id STABLE_UUID --json
agents bot native-delete --provider grok --native-id NATIVE_ID --expected-version VERSION --confirm-native-id NATIVE_ID --client-request-id STABLE_UUID --json
```

`nativeId` 来自原生目录，与 `bot.list` 返回的 Aexus 会话 ID 不同。保存设置和成员前重新核验 `version`，使用局部更新并读回结果。官方应用发生并发修改时保留草稿，用户合并或明确重新加载后再保存；在对象之间切换也保留草稿。原生接口没有跨客户端原子版本写入时，本软件不会宣称具备服务端事务隔离。

创建、复制、重置、删除使用持久化 `clientRequestId`。相同请求重试返回原结果；身份被不同参数复用会拒绝。远端可能已接受但响应丢失时，不盲目再执行一次：Grok 创建／复制按原请求 UUID 核验既有对象，原生删除核验完整目录中的目标缺失后完成本地归档。并行的同一请求等待同一结果。Dot 创建的原生 ID 由平台分配，未知结果不能按名称猜测或自动重发，必须先检查目录。已经确认的创建／编辑不会因为后续目录刷新失败被误报为失败；此时返回 `directorySyncPending:true`，界面保留已保存对象并提示同步待恢复。开始新会话和原生删除还要求准确的 `confirmNativeId`。原生删除会归档关联的 Aexus 会话，保留已接收的文字记录与工作区；原生远端文件之后可能不可用。

Aexus 显示别名、员工访问授权、断开连接与原生设置分别管理。`bot.update` 只改本地别名；`bot.delete` 只断开本地连接，不删除原生 Bot。重新连接恢复原 Aexus 身份与历史，不恢复旧员工授权。原有 `bot.sync` 批量导入主 Dot 与完整 Grok 目录（含团队 Bot 和原生群组），兼容数字、简写和完整枚举的群组类型，且不会自动恢复已断开的项目；管理器使用元数据目录和按需连接，避免同时拉取整个账户的消息。

## 自动连接 Mac

macOS Core 启动后，会为已经接入的 Dot 和 Grok 自动启动各自的原生后台执行组件。只使用 Web 界面时也有效：Mac 上的 Aexus Core 保持运行即可，ChatGPT 和 Grok Bot 主应用不必打开。官方应用需要已经安装并登录；本项目直接调用其本机组件，不重新分发这些运行时。

Dot 沿用原生 Mac 安装标识、登录和已启用插件，使用 ChatGPT 自带的 `exec-server` 连接原生执行通道；Grok 沿用既有机器 ID、加密文件密钥、原生本机执行服务及执行权限。启动不改变已有权限，不注入 Aexus 身份或 Core token，不更换执行主机。已有原生进程由原来的程序管理；Aexus 只停止自己启动的执行进程，Grok 主应用接管监督后不会被 Aexus 退出终止。

`bot.list[].bot.localComputer` 是当前 Core 的运行投影，不写入聊天历史：`starting`、`connected`、`reconnecting`、`external`（已有原生进程管理）、`error`、`unsupported` 或 `stopped`，可附带 `connectedAt/error`。`connected` 只在收到原生连接确认后出现；进程存在、消息已发送或历史可读都不代表本机已连通。启动失败后后台重试，断线由原生通道重连，不重发用户任务。删除一个 Bot 保留同提供方其他会话的本机连接；移除最后一个会话后停止该提供方由 Aexus 管理的组件。Linux/Windows Core 不会自动改到另一台 Mac 执行。

本机连接与模型账户额度分别检查。Grok 额度耗尽仍可维持 Mac 通道，但模型任务需要等待账户额度恢复；不会自动开通按量付费或冒报任务完成。

用户与 Secretary 自动拥有全部会话的操作能力。其他员工必须由 `bot.access {id,employeeIds,expectedRevision}` 授权；撤销后不能继续发送、读取、下载，依赖该来源的事件计划也会失效。云端员工使用同一身份和同一 API，不接收用户 token。外部 Worker 自身永远不能调用这些管理接口。

`bot.create` 创建 Grok Bot；`bot.group-create` 用已导入的 Grok Worker 会话 ID 创建原生群组。`clientRequestId` 必须为稳定 UUID，相同参数重试复用同一个远端创建身份。Grok 群组原生 Bot 成员与本软件的员工授权名单分别保存。不会把本软件的员工身份注册为 Grok Bot，也不会自动重置或删除官方历史。

## 同一套消息与文件接口

Grok 的消息送达与任务执行分开记录：`direct.send-status.status=accepted` 仅表示远端接收；原生执行失败保存在 `executionFailure`，并保留原来的发送 ID，重试查询不会重复投递。`bot.list[].bot.issue` 返回当前用量或执行问题的 `code/message/retryAt/at`，会话显示原因和本地时区的重置时间；失败信息保留至重启后。用量检查为只读，不改变套餐或开通按量付费。额度耗尽时新发送在远端投递前被拒绝，输入草稿保留；额度恢复后可显式重新发送。正常发送先唤醒原生运行环境，原生 `turnFailed` 通过服务端 turn ID 关联原消息，实时通道断线后只重连，不重放已接收任务。

先用 `bot.list` 取得 ID 和 `conversation`，不要按名称或猜测 ID：

- 私聊：`direct.send {employee:Worker会话ID,text,images?,files?,clientMessageId}`，`direct.history`，`direct.send-status`。普通员工可调用获授权的外部 Worker；向原生员工发送用户私聊输入仍仅限用户与 Secretary。
- Grok 群组：`chat.send` / `chat.post`、`chat.history`、`chat.context`，参数与其他群组相同。只有显式调用才发送；接收 Bot 回复不会自动转发或触发成员互相回应。
- 文件：`conversation.entry` 返回附件 ID；`conversation.download` 默认复制到调用员工的 Aexus 执行工作区，云端员工对应远程主机的工作区。轮询 `conversation.download-status` 后再使用。用户与 Secretary 可用 `conversation.download-local` 保存到明确选择的 Mac 路径。
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
