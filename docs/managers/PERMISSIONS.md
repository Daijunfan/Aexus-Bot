# Aexus Bot 权限说明

管理权限属于员工的 `managementRole`，与 Team 名称、工作目录、目录标记和视图无关。CLI 与 UI 进入相同的 Core 授权入口。完整命令见 [API.md](API.md)。`management.topology.teams` 从同一授权入口返回逐 Team 的 allowedActions、deleteBlockedReason、governorIds 和 isOwnTeam，避免把少数受保护 Team 误判为全部不可删除。

## 四种职位

Secretary 是用户的软件执行助手，拥有全局 **Agent 应用管理权限**。界面可完成的业务操作通过同一 Core API 向 Secretary 开放，包括频道阅读授权、订阅、排序、群组治理、文件、头像、收藏下载、已读、主机、插件、Worker 统一管理和 Plan。无需加入频道或群组；不借用 operator token，不改变真实 Agent 身份、原生引擎执行许可或操作系统身份。API 中的 `operator` 权限分类包含 Secretary，不代表必须冒充用户。

| 能力 | Employee | Manager | Governor | Secretary | 用户 |
| --- | --- | --- | --- | --- | --- |
| 读取全部公开 Core/插件文档 | 允许 | 允许 | 允许 | 允许 | 允许 |
| 管理员工 | 自身 | 本 Team 的 Employee | 跨 Team 的 Employee/Manager/Governor 会话 | 全局，包括 Governor；可管理应用及插件 | 全部 |
| 创建、删除 Employee | 不允许 | 本 Team | 全局 | 全局 | 全部 |
| 创建、删除 Manager | 不允许 | 不允许 | 全局 | 全局 | 全部 |
| 创建、删除或变更 Governor 职位 | 不允许 | 不允许 | 不允许 | 允许 | 允许 |
| 创建、删除或变更 Secretary 职位 | 不允许 | 不允许 | 不允许 | 不允许 | 仅用户 |
| 群成员、禁言、静音与会话通知 | 取决于群内 Owner/Admin | 同左 | 同左 | 全局，无需加入 | 管理与恢复入口 |
| 频道采集、订阅、阅读授权、排序与个人会话分类 | 不允许 | 不允许 | 不允许 | 全局 | 允许 |
| 发布群聊回复 | 实际成员/管理员范围 | 同左 | 同左 | 无需加入，显式 API，以 Secretary 身份发布 | 允许 |
| 私聊消息：用户输入、历史与已读 | 本人 `direct.post` 发布、`direct.history` 读取本人已发布历史；不能代为发送用户输入或确认用户已读 | 同左 | 同左 | 代用户 `direct.send/history/send-status/acknowledge`；自身发言仅以 Secretary 身份 `direct.post` | 允许 |
| 已读、用户消息编辑、转发、头像、Messages 附件上传与 Core 主机保存 | 不允许；共享文件复制使用 `conversation.download` | 同左 | 同左 | 可代表用户操作，客户端许可仍绑定发起者 | 允许 |
| 签发 Agent 身份凭据 | 不允许 | 不允许 | 不允许 | 不允许冒用其他身份 | 仅用户 |
| 阅读频道新闻 | 逐频道授权 | 同左 | 同左 | 自动访问全部频道 | 允许 |

Governor 仍不能创建、删除、升降级自己或其他 Governor，不能管理 Secretary。任何 Agent 都不能任免 Secretary，包括自己。批量删除 Team/员工、角色变更和克隆入口均在副作用前检查；克隆始终为 Employee，不复制管理授权。

职位定义集中于 `src/shared/roles.ts`，包含控制/创建/删除/赋予的目标角色、执行位置与 `appAdministrator`。`userManaged` 仅标记只能由用户任免的最高职位 Secretary；Governor 的生命周期由各角色的目标列表保护。更名、Team、工作目录和视图都不会授予职位。旧名为 Secretary 的员工不会自动升级。

Secretary 可出现在 Company、Messages、Plan 中；视图只过滤展示。它使用 Core 主机的本地引擎和本地工作区，Cloud Team 可选择 `workEnvironment:local`。它没有 Governor 的任务视图绑定。Manager/Governor 的员工管理能力保持原有职位规则；插件和云主机内容使用逐项授权，不因职位自动开放全库。

秘书使用自己的普通认证 Core/CLI 管理软件，与 UI 进入相同 dispatcher。`channel.access {id}` 读取授权；写入 `{id,employeeIds,expectedRevision}` 替换阅读人员，只有用户或 Secretary 可调用。普通员工只能发现和读取获授权频道；Secretary 自动访问所有频道。阅读授权不赋予发布、群组办公室或自动任务能力。`messenger.state` 读取用户保存的分类与顺序，`messenger.reorder {scope,order,expectedOrder}` 修改同一持久化列表；并发冲突必须回读。

个人消息头像的 `messenger.profile/profile-image` 向用户和 Secretary 开放；头像不改变真实作者。

Secretaries 的任免和 `auth.agent-token` 身份凭据签发仍由用户掌握。Secretary 保持实际 Agent principal；其显式 `session/chat/channel.acknowledge`、`chat.edit`、转发、客户端文件/媒体和 UI 操作可用，与用户执行同一参数、revision、幂等和发起客户端许可检查。普通查询不会自动标记用户已读，文件只在显式收藏/下载时落盘。原生 Ask/Full access 与 planning 许可仍独立执行。

用户或 Secretary 向员工发送私聊输入使用 `direct.send {employee,text?,images?,files?,mode?,clientMessageId?}`。`mode` 默认为 `enqueue`，也可显式 `send`（立即在现有原生会话派发）或 `steer`（追加到活动轮次，不接受附件）。它以用户身份发布独立的私聊条目并派发/排队工作；`direct.send-status` 用同一 `clientMessageId` 读取接受状态，不重开引擎、不重放工作。`session.send/enqueue` 仍用于原生工作派发，不发布 Messages 私聊条目。员工回复带有当前私聊来源标签的 Message 输入时调用 `direct.post`；Team/CLI/无私聊群聊标签的输入默认用原生正文回复，只有用户明确要求跨会话发送时才改变目标，不能对自己调用 `session.send/enqueue` 冒充私聊。同一请求的重试确认仍检查当前权限、员工身份及初始化状态；其他调用者不能用相同编号读取或冒用该确认。发送确认不等于员工已读，不改变阅读回执。转发草稿及状态查询也不能派发工作；放弃转发草稿不取消已发送的消息或任务。

原生会话 `session.send/enqueue/steer` 可携带 `sourceView`（company/messages/plan），由发送客户端声明，仅供理解当前消息。该字段与 Governor 的目标团队视图 viewId 独立，不改变真实作者、角色、委派范围、执行主机或群组成员资格。四种角色遵循同一来源协议；Team 普通输入不伪造私聊标签，优先遵循正文，不能仅依据来源自动建群或群发。未提供或 company 来源的输入不附加私聊/群聊来源标签，默认原生回复，不读取其他客户端的当前界面，也不沿用历史私聊标签。排队和未变请求重试保留发送时快照；新回执绑定来源，改变来源的同键请求拒绝，旧回执仍可确认且不补造历史。追加消息单独记录来源，不覆盖原始任务来源。原始正文和引用不含应用提示；完整原生会话的 context 保留实际包装。用户 DM 输入经 `direct.send` 发布时固定标记为 Messages 来源。

频道个人阅读状态通过 `channel.read-state` 向用户和 Secretary 开放；`channel.acknowledge` 由用户或 Secretary 显式调用，支持 entryIds/all/sourceId/sourceIds，查询不标记。手动点击频道到底部箭头时，可一次标记当前所选来源（或全部来源）的保留未读，包括未加载的历史；搜索/收藏和自动滚动不触发批量已读。员工工作阅读回执与用户阅读状态彼此独立；没有旧记录仍保持未知。

## 使用方法

```sh
# 用户创建最高应用管理秘书；无需特殊 Team 或目录。
agents card create --title Secretary --group "Any Team" --management-role secretary --kind worker --json
# 用户或 Secretary 可创建 Governor。
agents card create --title Governor --group "Any Team" --management-role governor --kind worker --model gpt-6-luna --effort low --json
# 用户也可以改变已有员工的职位。
agents card management-role EMPLOYEE_ID governor --json
agents auth whoami --json
agents management roles --json
agents management topology --json
agents api docs
```

Manager / Governor 可使用 Core 本地工作区、Core 引擎加 Tunnel 云端工作区，以及已支持引擎的 Cloud Native Worker。职位选择不会自动改变引擎位置或工作目录，启动恢复保留已授予的职位。Manager 仍仅管理本 Team，Governor 仍按全局角色范围管理；Plan 继续只允许本人或职级下行。Secretary 保留 Core 本地引擎与本地工作区要求。`kind`、`workEnvironment`、`managementRole` 和 `permissionMode` 分别校验；云端身份通过员工专属反向 CLI 通道认证，不能取得用户控制令牌。

新员工默认使用 Ask，Full access 需要用户明确选择。升级保留原有执行权限，不把已有受限配置自动提升。公司职位与引擎执行权限分别校验；`workspace.*` 和 Work 插件仍使用各自明确的文件范围。云端命令失败不会回退到 Core 本机。

## 旧授权迁移

首次升级将 `access.version` 从 1 更新为 2。已有显式全局授权，以及旧 `access.managerTeam` 中已获得全局权限的本地员工，会逐一成为 Governor。原员工 ID、工作目录、原生会话引用、历史和已有全局委派授权标识保留；升级不额外调用模型初始化。

随后清除旧 Team 授权来源。新加入旧管理 Team 的员工默认仍是 Employee；复制目录标记不会获得权限。迁移后的 `globalManagerIds` / `managerTeam` 不再是授权来源。`auth.whoami.globalManager` 是角色计算出来的兼容投影，`globalByTeam` 固定为 false，`managerTeam` 固定为 null。

旧 `management.team` 只保留只读发现，设置或清除 Team 授权会返回已停用错误。用户调用 `management.global ID on` 兼容为授予 Governor；`off` 将 Governor 降为 Manager。推荐统一使用 `card.management-role`。

## 连线、委派和调度

`createdBy` 只能由后台写入，始终表示真实创建历史。符合现有职位范围的管理者创建下属后默认有常驻来源线；用户创建的员工也可显式绑定逻辑来源。未绑定或已解绑的员工仍受上述范围内的 Manager / Governor 管理。来源线和显式绑定均不授予权限。`management topology` 返回 createdBy、createdByMe、createdAt 和 allowedActions，并支持 `--creator self|others|operator|unknown|EMPLOYEE_ID`；历史来源缺失时为 null，查询筛选不扩大本来的职位范围。

`management.bind {manager?,employee}` 新增普通常驻有向箭头；`management.unbind {manager?,employee}` 或 `{id}` 只取消指定的一条，包括默认创建来源线。多个 Manager/Governor 可以指向同一员工，同对端点重复操作幂等，解绑后保存及重启不重生。`createdBy`、职位、操作权限、已有任务、队列、调度、凭据及员工位置均不改变。

Agent 省略 manager 时指向自己作为来源；用户须明确指定。Manager 只能增删自己发出的关系，绑定目标限本 Team Employee；Governor/用户可指定其他合规的管理者来源，但不能借绑定扩大该来源的控制范围。普通 Employee 不可调用。取消自己的既有关系允许清理目标职级变化后已不再可控的旧线；这不会恢复已失去的控制权限。

真实消息/控制请求、回复订阅建立或委派任务开始时，来源/绑定线短暂变绿，单次最多 600 毫秒；没有常驻关系时显示同样时限的临时绿色虚线。到期仅结束显示提示，不影响实际任务、订阅和原有权限。`management.activity` 用 kind=request/task 区分正在通信与正在协作的任务，任务线有 messageId，结束即清除。查询、发送、订阅、排队、停止和调度都使用稳定员工 ID，不依赖原生引擎的多 Agent 功能。

消息、队列、调度、订阅保存原始发起者；接收者仍使用自己的身份。接受请求、准备执行及异步准备后均复核权限。Governor 降级或凭据撤销后，旧的跨 Team 委派失效；重新授予权限不会恢复旧任务。其他用户或管理者的独立任务不受影响。

## 初始化、手册与运行隔离

所有新建 Employee / Manager / Governor / Secretary 都在自己的原生会话完成同一简短隐藏初始化：只读本人真实身份和共享 API 索引，然后简短确认。就绪只依据本人身份和索引工具均成功返回且引擎正常结束；文本写出 OK 不能替代真实读取，多一句隐藏说明也不构成失败。初始化期间显示黄灯，未就绪前不接受正式请求；失败可重试。初始化轮不进入本项目可见历史或已读回执，但保留在原生引擎上下文中；不预加载完整手册、不执行其中示例。

初始化员工仅能调用必要的只读身份与文档入口，不执行写操作或请求工具提权。完整 Core 三视图与所有已安装插件 API/schema 统一投影到 `APP_HOME/api-docs`，原生只读文档工具及 `api.docs {document?}` 按文档 ID 读取；远端、隔离环境无需复制手册或放宽文件权限。Company、Messages、Plan 是 Core 视图，Plan 的 `plan.*` / `schedule.*` 不等于 MiniNotion 插件 API。

所有角色都可读完整公开文档；`api.list/describe --all` 只扩展文档发现，缺省仍过滤当前身份可调用的命令。插件先读 `plugin/<id>/index` 的方法摘要，再按需读 `plugin/<id>/command/<method>` 单条真实 schema，无须为一个操作加载整册。知道命令不等于能执行：Employee / Manager / Governor 的现有控制与写入权限、群成员检查和插件工作区边界不变；频道主动读取见下文。统一路由要求遵循身份中的 roleDescription；正式请求只附一段当前认证职位，Secretary 还附简短的应用管理/委派职责，升降级后立即刷新。公开文档不按角色复制到工作区。

Trusted 保留系统账号的实际文件权限；API 授权不等于对同用户无限制进程的操作系统级防篡改沙箱。Isolated 使用现有外层系统隔离，不支持时拒绝启动。Governor/Secretary 的分级生命周期保护在所有公司管理 API 入口强制执行。

## 布局和已读状态

`office.layout` 返回实际几何、正交连线与 editable；`room.bounds`、`room.place`、`card.place`、`management.relayout` 共用作用范围检查。视图只过滤显示，不改变权限、目录或任务。手动拖动一个 Team 不移动其他 Team；角色和创建来源变化通过现有布局服务处理。

`session.acknowledge` 只允许用户确认 Company/原生会话中确切的 replyId；Messages 私聊条目的已读由用户或 Secretary 通过 `direct.acknowledge` 按确切 messageId 确认，两者互不清除。任何 Agent 的读取或订阅都不会清除用户未读状态；隐藏窗口也不代用户确认。初始化不产生未读消息。Web 端使用认证用户会话及页面可见性检查；桌面端额外验证原生窗口状态。

Cloud Hosts 按具体主机授权，与直接 host.* API 共用权限：普通员工只看到授权主机和已有 Team 必需的绑定主机；阅读查看配置/状态，不返回凭据；修改可调整连接并执行远端操作；@root 新增可注册新主机。仅用户/Secretary 可读 SSH 私钥、完整 SSH 配置文件或删除主机，普通修改权不会导出这些文件。原生执行仍受其 OS/工作目录和审批模式约束。

## 人物形象

`avatar.list` / `avatar.get` 对所有员工开放，返回实时启用/归档状态、目录版本和匿名使用数量。`avatar.update` 仅允许用户和 Secretary 启用或归档已注册角色，并即时同步全部界面；不会删除素材或变更员工、引擎、会话和工作目录。创建时省略形象，或仅调用 `card.avatar {id}`，从当前启用目录中随机选择。归档的历史形象保留原 ID，展示对应的已启用可爱版或稳定替代形象。完整契约见 `core/avatars`。

所有职位都可用 `avatar.list` 查询完整可选目录，包括初始化期间。`character`/`avatarStyle` 或 `avatar` 仅选择视觉形象；`profession`（旧字段 `role`）仅描述职业；职级仍由 `managementRole` 控制。Manager 可用 `card.avatar` 修改自己及本 Team Employee，Governor 可在其控制范围内跨 Team 修改；该接口不修改名字、引擎、权限、职位、目录或历史。

## Messages 视图

Messages 与原会话复用相同权限、阅读范围和员工身份，但私聊内容来自独立的已发布账本：只有用户/Secretary 显式 `direct.send` 或认证员工显式 `direct.post` 才产生条目。`direct.history` 只读返回已发布的正文、媒体与投递证据，沿用现有 `session.transcript` 可读范围（本人、管理范围或用户/Secretary）。它不返回原生输出、共享输入、包装提示或静默阅读，不发起模型调用，不替用户确认已读。`session.inbox` 仍只读返回原生 Company 公开摘要，不是私聊账本。选择员工后的输入使用 `direct.send`（默认排队），停止、审批和工作区仍走已有原生 Core API；绑定关系和真实权限不变。

未指定 `replyConversation` 时，`direct.send`/`direct.post` 的 `replyTo` 只能指向该员工已发布的私聊条目。Core 在原有权限校验后解析引用，不信任客户端提供的引用正文或作者；其他会话的 ID 不可引用。发送或排队执行时重新校验引用与原发起者权限。引用不会授予原消息作者的权限，不跨员工读取文件，不清除已读状态，也不改写已执行的历史。新消息的发送者来自认证委派，时间来自 Core 实际记录；旧记录缺失的信息保留为未知。

精确选段通过 `replyQuote: {text, offset}` 提交，必须同时指定 `replyTo`。Core 使用与界面一致的公开 Markdown/GFM 文本投影核对内容和位置，不接受伪造、过期、越界或切断 Unicode 代理对的选段。群聊选段沿用原有成员检查；实际发送按 work/awareness 契约共享引用上下文，用户回复可将仍在群内的原 Agent 作者纳入工作对象。仅生成选段或预览引用不启动投递。选段、跳转与高亮不会提升权限，也不会代替真正的已读确认。

用户可显式提供 `replyConversation`，把另一个私聊或群聊的公开消息片段带入当前回复。跨会话分享及 `messenger.reference` 预览只允许用户，Governor 也不能借此跨读或转发。Core 解析来源和作者并保存接受时的引用快照，客户端不能提供内部 `crossReply`。已接受的排队快照不会因个人隐藏状态而改写；派发仍检查原发送者和目标权限。群成员只能读到用户明确分享到群里的片段，不能据引用访问原私聊、凭据或文件。图片不会静默复制；整条含图消息须显式选择文字引用，或通过已有转发流程分享图片。来源跳转与返回只是用户端导航，不修改原消息或真实已读记录。

Message 的右键菜单复用原有 Core 授权；移除悬浮操作条不改变阅读、引用、转发、收藏、编辑和删除边界。用户选择的 @员工 保留在正文位置，`mentions` 仍使用稳定员工 ID；UI 删除该标签时同步移除该已选对象，Core 不根据同名文本自行提升权限或猜测收件人。

## 群聊与共享视图

群成员可读取本群消息、共享上下文并在未禁言时发布。群组 Owner/Admin 管理成员和禁言，Owner 解散群组，用户保留恢复入口；Company 职位不授予群内治理或他人私聊权限。

`chat.send`、`chat.post` 投递到发送时的全部当前成员，Agent 作者不接收自己的发文。用户消息的 mentions 与同群回复原作者确定工作对象；未指定对象时全员处理。员工只能向其控制权限内的显式 mentions 分配工作，其余成员接收上下文。`chat.post` 不分配正式工作。

全员在各自原生会话与 FIFO 中阅读。Core 校验凭据和成员资格后记录接收/已读；awareness 表示知悉，work 随后执行任务。公开发言使用明确的 `chat.post` 或讨论工具；原生会话输出只属于 Company 完整会话，不会自动成为私聊或群聊消息。给用户私聊使用 `direct.post`。发言不改变员工控制权限或工作区范围。

用户对 Company/原生会话、Messages 私聊、群聊和频道的已读按精确 reply/direct message/entry 记录：原生工作台与 Company 共用同一 `lastReply` 的精确 `replyId`/`readAt`；Messages 私聊条目使用独立的 `direct.acknowledge`/`readSequence`，与原生 `lastReply` 互不清除。原生工作 turn 中最后一次显式 `chat.post` 到群的 `groupReply` 绑定本轮最终原生 `lastReply`，任一侧已读经同一 Core `session.acknowledge`/`chat.acknowledge` 同步，群读水印覆盖该序号时关联 `lastReply` 同为已读。没有群发布的原生回执只在原生工作台/Company 间共通，不会写入 Messages；不同 turn、消息 ID 或群不会仅因文字相同而合并。旧 `replyId` 不清除新回复读态；群先读、turn 稍后结束时新 `lastReply` 继承已读，绑定跨重启保留。关联只同步读态，不向群成员暴露 Company 正文。Agent 的 `delivery.readAt` 仍是独立工作回执，普通员工不能代用户确认，用户或 Secretary 可显式调用 API。用户仅可编辑本人发布的消息。删除群组保留可恢复历史、员工、工作区及独立调度。接口参数见 [API.md](API.md)。

## Plan 与自主排期

所有 Employee / Manager / Governor / Secretary 都可通过 schedule.create 为自己排期，self 只能解析成认证员工自己的稳定 ID。各职位都可创建、读取、修改、暂停恢复或删除自己及可管理目标的一次/重复/事件任务，不论记录由谁创建。Manager 的范围是本人和本 Team 低职位 Employee；Governor 是本人和全局 Employee/Manager，不能管理另一 Governor 或 Secretary；Secretary 是本人和所有合法员工，包括同级其他 Secretary。修改按当前目标权限判定，不按 createdBy 作者；变更目标须同时可管理原目标和新目标，createdBy 保持原始审计。群组、视图、标签和备注不扩权。自我排期使用后台专用的自目标委派，不开放普通 Employee 的他人会话发送权限。撤权后旧自动授权保持停用；合法调用者显式 update/resume 才重新授权，manual run/signal trigger 使用当前调用者的本次授权，不能借用原作者凭据，manual run 也不会重新启用旧自动委派。后台到期运行复核保存的授权，执行与异步准备后再次复核凭据和目标权限。缺失员工的孤儿记录仅用户或 Secretary 可维护元数据，不能执行。

Plan 的十种数据库视图（Table / Board / Timeline / Calendar / Planner / List / Gallery / Chart / Feed / Form）共享 schedules.json；status、nextAt、occurrences 由 Core 计算，不能伪造。保存的数据库视图保留创建者身份，用户和 Secretary 可管理全部，其他员工仅能编辑自己创建的视图；删除视图保留排期。定时器不会关闭或打断已有人工任务，也不会唤醒休眠主机。完整 API 见 PLAN.md 与 schedule.schema。

`plan.timeline/analytics/feed` 只投影现有调度权限允许的记录，不绕过角色范围。durationMinutes 仅为预计时长，不授予并发执行或超时豁免。Form 和时间线改期使用 schedule.create/update；Feed 读取不清除私聊未读。历史聚合中的 Team/priority 来自当前仍存在的关联对象；缺失信息明确标为未知。

## 用户的 Messages 整理状态

`messenger.state/conversation/message/draft/search` 仅用户可用；Employee、Manager 和 Governor 均不能读取或修改用户草稿、收藏、表情标记或会话整理。数据独立保存在 `messenger.json`。置顶、归档、个人未读提醒、隐藏和搜索不改变成员身份、管理权限、任务执行、原生上下文或真实已读回执。群聊权限仍由既有成员和调用者身份检查；`chat.history --around` 不扩大读取范围。

Message attachment uploads, file forwarding and explicit Core-host save are user/Secretary
operations; employees use the authenticated APIs below. Group membership grants
`chat.file` reads of explicitly published group attachment paths, never unpublished
upload staging, another group's files, or a private employee workspace. Agents cannot
publish arbitrary group file paths. Group/channel attachment delivery sends one text-only file notice together with the
user's original text. It does not copy bytes or private-chat attachments automatically.
In a group, every current member has equal conversation.file rights plus conversation.upload
over shared content at the root and in peer member folders. Channel members use conversation.file,
and an Agent member may edit only its own named subfolder; conversation.upload is group-only. The user and Secretary administer both without
joining; named member directories and host metadata stay protected. Members may also use
conversation.copy to explicitly copy originals into any shared destination they may write,
or into their unchanged personal Workspace, never another employee's private workspace.
Current membership and delegation are rechecked before enqueueing. A file upload, preview, search or download does not start inference. Public group
posts notify recipients through the bounded awareness lifecycle; they do not assign
formal work. Silent acknowledgments create no further delivery.

`messenger.gallery` 仅用户可用，沿用可见员工和群聊的公开历史读取范围。返回分页图片引用，不读取图片字节、不运行任务、不标记已读，也不包含推理或工具私有内容。游标只定位已存在的消息与图片，不授予访问其他会话或工作区的权限。后续图片读取仍分别经过原有 workspace.image / chat.file 授权。

音视频预览的 media-open/info/read/close 仅用户可用，许可绑定创建它的客户端；Web Cookie 播放还绑定登录会话。每次读取重新校验原工作区与文件版本，不会随配置变化切换到另一个主机或文件。代理不能获得媒体许可；现有 chat.file 的群成员公开附件读取规则不变。播放不触发推理、消息或已读确认。退出登录撤销活动流，播放器释放许可后不再提供字节。


## 群组与频道共享工作区

`conversation.workspace/workspaces/file/copy/transfer` 使用真实群组/频道成员身份。群组中，每个当前成员对共享根目录以及所有成员目录内的文件拥有相同的读取、创建、上传、编辑和删除权限；群内 Owner/Admin 身份本身不额外增加文件权限。频道中，Agent 成员可读取全部共享文件，但 `conversation.file` 写入仅限自己的一级姓名子目录；`conversation.upload` 仅适用于群组。用户和 Secretary 无需加入即可管理群组和频道的全部内容；命名成员目录身份和宿主管理元数据始终受保护，不能被重命名、替换、移动、放入回收站或被上传覆盖。任何职位都不能代替成员身份，也不能写入其他员工的私有 Company Workspace。个人 Company Workspace 继续独立可用。归档不改变权限，移除成员立即撤销 API 访问，但保留已有文件。`workspace.catalog` 只返回本人所有 Company/Message 工作区及权限，不规定任务必须存放的位置。

同名群组用稳定 ID 父目录隔离，同名员工目录映射到真实员工 ID。目录名称在首次创建后保持稳定，重命名显示名称不会移动运行中的工作目录。用户完成上传后文件即对成员共享，发送消息才触发文字通知；临时上传分块不向成员展示。以上为 Core API 授权，不是同一操作系统账号下任意 Trusted 原生进程的文件沙箱，也不会因加入群组而放宽引擎权限。

`Archived chats` 统一显示已归档的员工、群组和频道；Restore 继续调用 `messenger.conversation {patch:{archived:false}}`，不改变历史、未读回执、成员身份或工作区。

## 自建混合会话分类

`messenger.folder-save/delete` 允许用户或 Secretary 调用，默认 API 发现对二者列出；与其他个人整理操作共用 `messenger.json`。分类只保存已验证的私聊、群聊、频道引用；同一会话可以加入多个分类。每个分类有独立 revision，同名及相同成员重试保持幂等；并发修改同一分类时显式 expectedRevision 冲突拒绝。无关草稿写入不会造成分类冲突。删除分类保留全部会话、消息、草稿、置顶、收藏和归档；固定 All 没有可编辑或删除的分类记录。

频道会话可使用相同的个人置顶、收藏夹、归档和未读提醒；这些仍只影响用户整理状态。新闻文章收藏始终属于频道 Core 中的稳定 postId，不复制到随作者路由变化的 messenger key。`messenger.search` 以同一用户权限合并仍保留的新闻，外部作者不冒充 operator 或 agent。新闻可作为用户明确选择的引用或转发来源；目标仍为已有私聊或群聊，图片复制继续使用原有认证文件传输。频道讨论支持文字、图片、文件、mentions 和同频道 replyTo 草稿。用户附件保存在频道共享根目录；员工仅收到原文与文件清单，不自动收到私聊附件。

`view.open messages --channel` 与返回导航仅选择展示对象，不能签发采集凭据、调用模型或确认其他会话已读。新闻图片读取和下载仍检查文章在当前频道的真实归属；收藏后移动来源不会授予对旧频道路径的继续读取权限。

## 独立新闻频道与采集凭据

频道为纯只读资讯流，没有员工成员、Owner/Admin、讨论、@派工、禁言、群通知或按帖数自动任务。群聊的成员、职位、通知和工作区权限保持独立。

所有已初始化的 Employee、Manager、Governor、Secretary 都可用自己的凭据调用 `channel.list/get` 发现频道，并使用 `channel.fetch-text`、`channel.fetch-images`、`channel.search` 主动读取未收藏新闻；无需加入频道。条数 `limit` 默认20、范围1–100，通过返回的 `nextCursor` 分页；可指定 `sourceId`，搜索要求 `query`，可选 `images:true`。只文本接口不加载图片字节；图文接口返回真实图片内容块，CLI/HTTP 为 base64。正文不截断，不含用户收藏偏好或本机文件路径。正文每页2 MiB、图片32张/8 MiB边界通过续页处理；超大的单条明确报错。

这些查询不调用模型、不派工、不下载外刊原件、不修改用户已读或收藏。用户已明确允许员工主动获取频道资讯，返回内容可以进入该员工原生上下文和历史；该操作不在本机创建频道正文缓存。普通频道浏览仍只用内存。`channel.save/export/file-download`、`messenger.message/state` 和 UI 正文/DOM/截图保持用户专属，员工不能冒用用户身份。

频道消息发送/回复、员工发布引擎、`channel.update.adminIds`、频道成员/职位/禁言/通知写入、按帖数规则写入均拒绝。旧记录和文件保留；旧启用计数规则暂停，新新闻不自动进入员工原生队列。群聊功能不受影响。

采集服务、订阅、频道名称/头像/连接参数仍由用户或 Secretary 管理。普通员工的 `channel.list/get` 不返回服务器地址或采集凭据 ID。外部采集服务使用独立 source-scoped capability，不获得 operator 身份或控制令牌；专属入口只允许已配置采集、头像和受限存储交换操作，逐次核对凭据及来源范围。不能修改订阅、路由、用户收藏、Core 设置或调用其他 API。令牌仅签发时返回一次明文，SQLite 只存哈希。服务自己的 cookies、TG session 和平台凭据留在原主机。

## 每个主视图的外观

`settings.set` 沿用既有全局管理能力，Secretary 也可代用户配置。`viewAppearance.company/messages/plan` 分别保存配色与自定义颜色，局部修改在 Core 合并，不会覆盖未提供的其他视图；非法视图、字段或颜色整次拒绝。旧 `theme/themeColor` 仅映射 Messages。界面语言、模型默认值和页面大小继续共用，外观不改变员工、原生会话、工作区、计划权限、画布几何或群消息/新闻数据。设置导航与颜色预览不运行计划任务。

`settings.set {messageWallpaper:{pattern,layout,density,opacity}}` 复用既有设置权限和偏好存储。它只调整 Messages 装饰：五组原创小图案、整齐/散落布局、密度和浓淡；局部修改保留其他字段，非法输入整次拒绝。预览、改变花纹和恢复默认都不读取或修改消息、任务、已读、成员或凭据。Company/Plan 配色和权限保持独立。

### Message 拖动排序

`messenger.reorder` 允许用户或 Secretary 整理 category 与混合会话顺序，沿用个人 Messenger 状态和既有授权。Core 验证 scope、当前会话/分类引用及分类成员；每个 scope 可独立比较 expectedOrder，避免覆盖其他窗口。拖动只保存位置，不读取历史、标记已读、触发员工或改变公司/群组/频道权限。手动顺序不修改置顶/收藏/归档标记；恢复自动排序只删除指定 scope 的位置记录。

## Plan 调度的独立下行边界

所有四种角色具有 Plan 自我排期能力。Manager 仅管理本 Team Employee，Governor 仅跨 Team 管理 Employee/Manager 的排期；Secretary 代表用户全局管理合法员工排期，包括其他 Secretary。执行时仍验证目标、委派、初始化、原生许可及引擎位置，不能恢复已删除员工。

调度元数据和视图不授予角色权限。Core 在创建、修改、预览、触发、恢复、执行及异步准备后校验目标和原始委派。旧同级调度在恢复时停用，保留历史和稳定 ID。`action.channelId` 要求目标仍是该员工引擎频道的发布者；channel.posted 事件同时要求目标及普通调度发起者具有来源频道成员资格。Collector 凭据无权调用任何 Plan 调度 API。

所有角色通过本人身份说明获得统一指引：员工自动任务应调用 Core Plan API，读取返回 ID 并核对规则；不要用临时 sleep、cron、第二套调度器或插件文档提醒代替。此行为指引与 API 授权共同工作，不宣称给共享系统账号上的任意 shell 进程提供额外操作系统沙箱。


## 跨视图员工资料

`card.profile {id,offset?,limit?}` 复用 employee.read 目标授权，只读返回 Company 身份、可见群组/频道中的真实成员身份、稳定工作目录和分页 Plan 摘要。管理员可读员工不等于能读其未加入的群聊；普通 Agent 的会话身份投影按本人成员关系过滤；用户与 Secretary 可全局查看和管理。资料不返回提示词、凭据或私聊正文，不创建目录、不启动引擎、不改变本人已读。异步读排期之后重新核对权限与成员关系。初始化状态不妨碍只读查看身份，仍不能以此启动正式任务。

员工资料中管理职位与编码引擎只读；原有独立任免接口继续按职位能力矩阵授权。更换角色仅在显式展开后使用原外观编辑流程。用户通过资料的 Workspaces 入口可编辑群/频道全部共享内容；群组 Agent 成员可读写根目录及同伴成员目录，频道 Agent 成员只可写本人一级姓名目录；Secretary 无需加入即可维护会话文件，包括根目录和成员目录；命名目录的稳定身份不可重命名、替换或删除，并可显式复制到个人 Workspace，所有者和已有会话/目录标识保持不变。

## 云端角色与编码引擎凭据

Manager/Governor 的控制、布局、招聘、身份、反向 CLI 和重启恢复均按职位与 Team 校验，云端位置不再一律拒绝。已有员工的 ID、主机、工作目录、原生历史和引擎不迁移。撤销凭据和职位变化继续立即影响 Core 权限。

Cline/Pi 在 Work 插件目录中使用本人插件授权与专属运行目录；不能借新引擎选择访问其他员工或用户的插件数据。API Key/服务地址按编码引擎独立保存，学校兼容服务和 Claude 的个人服务互不继承。此配置隔离不改变 Trusted 系统账号本身的文件权限。

## Secretary 的 Plan 记录管理与统一 API 工具

Secretary 可查询全部 Plan 排期与保留的执行记录，包含目标员工已删除的任务；这类任务的原 ID、引擎和时间规则仍可读取，已无法确认的旧名字/职位返回 null。秘书可清理、暂停、维护停用记录，或把完整 action 改派到当前有权排期的目标。记录读取和清理不授予执行权限；Secretary 也可管理其他在职 Secretary 的合法排期。用户保存的 Plan 数据库视图可由秘书通过原 plan.view-* 管理。

统一原生 agents_company_api 使用启动时绑定的员工凭据，进入 UI/CLI 同一 Core 分发器，不接受调用者自行提交身份、委派或用户 token。查询无需额外批准；`direct.post` 是对用户的通信而非工作区写入，正常原生工作轮次在 Plan/Ask/dontAsk 模式可直接发布，不需要文件写入批准；其他写入仍遵循引擎的 Ask/Full access，原生 planning 模式只读。初始化和静默阅读不开放通用操作，也不能发布。批准后再检查当前任务和有效权限。该工具不扩大当前员工、成员文件或宿主的操作系统权限。

私聊用户输入、历史与已读，以及用户消息编辑、引用/转发、上传下载及文件管理均可由 Secretary 代表用户使用原 API 操作，保留真实作者和客户端许可；Secretary 不能冒充其他员工作为私聊发布者。仅 Secretary 任免、Agent 身份签发保持用户控制；Worker 的直属归属与原生上下文不变，用户与 Secretary 可统一管理。


## 自定义分类与社交元素

`messenger.social`、规则分类和 source:ID 列表偏好沿用用户/Secretary 的应用管理授权。普通员工不能查询或改动用户分类；社交元素不创建新频道、身份或执行权限。`channel.acknowledge --all --source` 由用户或 Secretary 显式调用，按当前父频道校验并只确认该来源的保留文章，不修改其他作者或私聊/群组回执。分类 include/excluded 只过滤列表，删除分类不删除原消息或订阅。

## 云端文档与频道存储

外部频道 fileStorage 由用户或 Secretary 显式绑定既有 Cloud Hosts hostId 和云端内容寻址媒体目录。采集器只能提交本来源文件名、MIME、大小、SHA-256 和缩略图等元数据；不能指定任意主机路径、取得用户凭据或自动写入 Mac。channel.file-download 可由用户或 Secretary 显式调用，复用现有 SSH 传输与频道 conversation.workspace。每次远端读取核对当前帖子、路由和绑定，提交前校验大小与 SHA-256；同名用户文件保留。channel.file-status 只查询进度，不能开始传输。员工取用已发布附件走 `conversation.download`，默认落入本人 Company 执行工作区；用户或 Secretary 可用 `conversation.download-local` 保存到明确选择的 Mac/Core 主机绝对路径，默认拒绝覆盖已有文件。远端源和目标在员工执行主机上分块流式处理，不在渲染器构造整文件 Blob。

所有平台均使用容量策略，不按一周自动清理；外刊只在用户点击后取回并保留请求缓存。本地已下载件遵循已有共享原件/成员工作区权限，不因云端过期、帖子删除或服务重启删除。

## 全部会话目录

`messenger.directory` 沿用用户/Secretary的应用管理权限，只读查询当前员工、群组、父频道及平台来源元数据，可按类型、分类、搜索、归档和分页过滤；不读取私聊正文、启动引擎或标记已读。普通员工仍通过原 `chat.list` 仅看到自己加入的群组，不因目录功能扩大权限。动态分类由显式include规则决定，不按名字自动改写用户手选名单。

## Conversation notices are separate from Plan

Current group conversation offices (Owner/Admin/Member) are independent of Company managementRole and grant no extra file authority. Ordinary employees need actual conversation Owner/Admin to moderate; the user and Secretary administer all groups without joining, while retaining the actual caller identity. `conversation.notice-*` posts saved text through an independent Core timer/storage without running an Agent or entering Plan. Plan `schedule.*` retains its own employee scheduling contracts. Channel post-count workflows are retired; employees explicitly use channel.fetch-text, channel.fetch-images or channel.search.

`conversation.entry/download/download-status` provides full stored published content and a verified copy into the caller's own Company execution workspace by default (or another explicitly selected own catalog workspace), never a peer's private workspace. `conversation.download-local` is limited to the user or Secretary and writes to an explicitly chosen absolute Mac/Core-host path, refusing an existing file unless overwrite is explicit. Group members may then edit the personal copy and use `conversation.upload` to create (never overwrite) or update a shared file with `expectedVersion`; group files are limited to 2 GiB and message images to 10 MiB. Uploading never publishes a message: use explicit `chat.post` with `@workspace/…` paths. Receipts are durable, deduplicate identical retries, and an interrupted request is not replayed after restart. See [MESSAGE_COLLABORATION.md](docs/MESSAGE_COLLABORATION.md) for these separate contracts. See [CONVERSATION_CONTROLS.md](docs/CONVERSATION_CONTROLS.md) for the current, detailed boundary.

## Asset center

`assets.tree`, `assets.children`, `assets.search`, `assets.locate`, `assets.file` and `assets.naming`
are available to the user and Secretary. File operations reuse current workspace/conversation boundaries;
index metadata does not grant file authority. Published files are read-only.
Employees cannot mutate conversation originals or peer folders, or use an asset
reference to bypass those restrictions. Directory migration requires a current
preview and rejects busy affected employees and active transfers.

`workspace.reveal` is available to the user and Secretary and resolves the same file scopes as transfers.
It reveals local Core-host paths only after scope and symlink validation. Remote
and Web requests cannot open a Core path in the client's file manager. Revealing
fixed roots or published attachments grants no write or rename permission;
existing read-only and member workspace boundaries remain unchanged. Downloads
continue through the existing authenticated transfer/channel operations.
`assetDrawerWidth` uses existing `settings.set` authority and only affects display.

## 原生 Worker

`worker.*` 向四种员工职位开放，按 Worker 的直属创建者校验，不继承跨员工管理权。用户可统一管理；员工仅能列出、创建和控制自己直属的 Worker。Worker 无 Company principal、令牌和初始化上下文，不能调用 Core。普通 `terminal.*` 不暴露或控制 Worker 终端，必须通过 `worker.*` 重新检查所有权。工作目录与执行主机受直属员工现有边界限制；不支持的严格隔离或执行目标明确拒绝，不能回退或提升权限。

## 订阅同步回执

`channel.subscription-status` 由用户或 Secretary 读取。`channel.collector-ack` 仅接受经过专属入口认证的采集器凭据，由服务端实际应用配置后发送；不能通过普通 Core 用户或员工请求伪造。回执绑定认证出的采集器，不能指定其他采集器，不能确认尚未下发的未来版本。新增回执不扩展采集器的其他权限，不涉及用户阅读状态。

## 频道内存与服务器存储约束

当前频道内容策略：Mac 未收藏的频道正文、
讨论、作者头像、图片及频道草稿只在内存中处理。用户明确收藏或下载才
写入本机；订阅、身份、已读 ID、视图偏好仍持久保存。Linux 各平台按 1 TB 容量保留，收藏和按需下载的文件缓存受到保护。迁移须逐项校验服务器正文和图片
哈希后才清除旧本机副本；不修改私聊、群聊、原生会话或认证历史。

原生员工会话有自己的持久历史，因此不自动投递频道内容。
用户授权的主动 `channel.fetch-text/fetch-images/search` 无须先收藏，返回内容可进入原生历史。
通过用户界面引用、转发仍要求先收藏；频道工作讨论已关闭。`channel.save/export`、
`messenger.message/state` 和 UI 正文/DOM/截图仅用户可用，Agent 不能替用户收藏或读取界面以绕过限制。

`channel.storage` 绑定已有 SSH 主机、根目录及一个 all-sources 采集器。
仅用户可修改。专属入口的 `channel.storage-exchange/result` 只接受此
凭据，只服务 Core 已发出且绑定当前采集器的请求；不授予用户、员工或
任意终端执行权限。普通 Core 身份、其他采集器及撤销凭据均不能完成
请求。文档元数据不触发文件读取；仅用户点击下载才在 Linux 获取原件、
校验并经既有 SSH 传输至 Mac，随后复用已下载的服务器缓存。

配置的 all-source 归档采集器可使用 `channel.media-register` 登记服务器已有原图；Core 仍校验来源及媒体身份，服务器校验 SHA-256、大小及图片格式。该接口不接收任意主机或路径，不对普通 operator/Agent 或其他采集凭据开放。浏览缩略图不会授予原图或文件的跨频道权限。

`channel.aggregate` 仅用户可调用：合并相同采集凭据的空平台包装频道，保留来源、文章、收藏和已读标识，并为旧频道建立兼容别名；不会移动或复制正文、媒体、凭据或工作文件。存在独立成员、讨论、计数规则或不同发布凭据时，在写入前拒绝。来源筛选仍调用既有 sourceId 查询，不授予跨频道原图或文件权限。

## 团队创建位置

新团队只有本地项目、云端项目，不再绑定插件，也不新增插件工作组。旧 Work Team 的目录、数据、员工身份和历史保持原位兼容；新插件权限通过 plugin.access 按员工、内容与阅读/修改/新增授权。Secretary 默认全部权限。

## 已发布私聊与显式群发

原生 Agent 的普通正文、思考和工具过程只属于该员工的 Company 完整会话，任务来自群聊时也一样；它们从不会自动成为 Messages 私聊或群聊消息。给用户发私聊必须显式调用 `direct.post`（可用 text、images、files；每个 `clientMessageId` 对应一条消息，不同 ID 可连续发送多段文字、图片或文件）。不要用 `session.send/enqueue` 给自己创建任务来回复。用户在群里要求私聊时调用 `direct.post`；只有显式 `chat.post` 或 `agents_company_discussion_post` 才发布群消息，`direct.post` 不派发工作、不触发其他 Agent、也不群发。群内点名/回复选择工作对象，其他成员及员工报告的接收者只静默阅读；阅读协议没有工具，不派生自动互答。静默阅读不是私聊发言。普通输出、JSON、工具结果和完成事件都不自动转发私聊或群聊。群发仍检查真实成员、禁言、凭据和幂等请求。

Messages 私聊是独立已发布账本，只显示显式 `direct.send`/`direct.post` 产生的正文、图片和文件；Company 完整原生历史保留原生文本、思考、工具和共享输入，并为新捕获的工作/阅读输入显示 `[群名]` 或 `[Private · 姓名]` 来源及完整 Aexus 包装提示，旧历史缺失的包装不补造。每条消息最多 16 个附件；本机发送副本在源文件修改或删除后仍保留，远端媒体留在原执行主机并逐次校验版本与工作区/主机绑定，不静默下载到 Mac。工作期间持续显示头像动作和三点提示，完成、中断或失败后结束。原生最终答复属于 Company，不自动写入 Messages；仅当该原生 turn 最后一次显式 `chat.post` 的群消息通过 `groupReply` 绑定本轮最终 `lastReply` 时，群读水印才同步这份已关联原生回执。Messages 私聊未读由 `direct.acknowledge` 管理，与 Company/群已读互不清除；关联只同步原生读态，不向群成员暴露 Company 正文。

## 原生引擎服务来源

`engine.providers` 对用户和 Secretary 返回完整原生服务/路由及已保存配置，普通员工不得读取；仅提供地址、模型、来源和密钥指纹，不返回明文 Key。默认继承各引擎自己的 CLI/VS Code 原生配置，不跨引擎借用凭据。员工运行目录仅复制连接配置，原生历史、权限和任务上下文仍独立。配置变化在新进程/会话读取，不打断运行中的工作。显式 API 独立覆盖须如实标记不一致；inheritNative:true 恢复共享且不删除旧加密凭据。


## 频道阅读授权与 Secretary 全局操作

`channel.access` 的无 employeeIds 查询不需要写入批准，设置人员必须携带当前 revision。授权与撤销在发现、文本、图片和搜索接口中立即重查；分页及远端异步读取结束后再次校验。旧频道别名归一到同一授权记录，人员变更不重发旧消息、不创建员工任务。Secretary 不需要任何逐频道授权。


## 插件内容授权

插件与团队独立。用户或 Secretary 在插件窗口的“授权人员”选择一个或多个页面、文档、学习集、主机，分别设置员工阅读、修改、新增权限。plugin.resources 只向员工发现其获授权内容；plugin.access 查询/修改授权，写入携带当前 expectedRevision，混合多选 updates 整批原子保存。员工不能自行授权，也不能取得覆盖全库的 UI/SSE/asset URL；Core、原生 API、CLI、旧邮箱入口使用同一运行边界。

MiniNotion 只暴露获授权页面，数据库包含记录且记录可单独覆盖；新增允许创建子页，@root 仅新增顶层内容，新页自动授予创建者继续编辑权。批量操作不能越界，未授权页面、全局 Agent 配置和私密正文不进入响应。Reader 文档与学习集分别授权，学习集不自动开放关联原文；修改与新增分别检查已有内容和新内容。Cloud Hosts 插件与 host.* 共享同一主机权利。删除、系统配置、备份和原始全库文件入口仍只由用户/Secretary 管理。查询读取不改变员工原生会话、引擎、工作目录或团队。

## 外部 Worker 与监控程序

Dot/Grok 不是 Company 员工，不获取 Core token、管理角色或本项目的系统上下文。bot.access 按会话授权员工显式调用同一 direct/chat/conversation API；Secretary 自动可用。bot.create/group-create/sync/access 由用户/Secretary 管理，外部 Bot 自身不可调用。本地和云端员工的资源权限相同，文件默认下载到本人的 Company 执行主机。程序监控使用所属员工的主机与工作区，没有 Core 身份；普通员工仅管理自己的监控，Secretary 全局管理。事件来源权限同时检查计划创建者和执行员工，撤销后待处理任务不再执行。详见 docs/BOT_WORKERS.md、docs/EVENT_TASKS.md。


`bot.appearance` 的外观修改仅向用户和 Secretary 开放，使用独立版本号；授权员工不能修改。Dot 的本地动画选择不改变外部 Worker 身份、提示词、权限或文件授权。Grok 外观由原生 shape/color 同步，应用内不能将其换成员工形象。


`bot.update/delete/restore` 仅向用户和 Secretary 开放。移除只删除 Aexus 接入与本地授权，不删除原生 Bot；普通同步不会重新接入。`bot.list --include-removed` 也仅限应用管理员。恢复时核对原生身份，恢复历史和外观但不恢复员工授权。员工条目删除复用 `card.remove` 的职位和文件删除边界，在 Agents 和 Message 中移除同一身份。
