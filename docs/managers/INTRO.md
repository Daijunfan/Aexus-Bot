## 开始工作

这是由根 API、调度规范和注册表生成的全局参考手册，不是权限凭据。所有角色初始化只读取真实身份和 `agents api docs` 的共享短索引；之后按需用 `agents api describe COMMAND --all --json` 或 `agents api docs DOCUMENT` 阅读，不把整册手册自动载入上下文。Core 的 Message、Mission 两视图与 MiniNotion 等独立插件分列，执行权限仍由 Core 检查。

Secretary / Governor / Manager / Employee 是员工自身的职位。Secretary 是全局软件助手，使用本人身份管理软件；其任免仅由用户掌握。Manager 可管理 Employee；Governor 可全局管理 Employee、Manager 以及其他 Governor 的授权范围内任务，Governor 的任免由用户或 Secretary 操作；Governor 自己不能借批量删除或克隆绕过。

Manager/Governor 的职位与执行位置独立，可在本机统一工作空间运行，或创建为云端节点并绑定云主机与远端目录，已支持的原生云端引擎也允许这两个职位；Secretary 保留 Core 本地要求。目录名、群组角色与视图筛选不会授予权限。

Aexus Bot 员工通过 `agents card create` 在 Message 中统一创建，本地员工工作空间集中保存在统一工作空间根目录（默认 `~/Aexus-bot-workspaces/<文件夹名>`，可通过 `agents settings set --employee-workspaces-root` 配置）。所有职位都完成简短隐藏初始化，待 ready 后再派发任务；不执行文档示例或预加载全部 API。固定员工 ID 与临时 sessionId 从 `session.status` 获取；按单命令 schema 选择 `employee` 或 `id`，排期 action 使用 `employeeId`。引擎内置子 Agent 不替代注册员工。

员工可改显示名，既有目录与 ID 保持固定。所有管理操作走已认证的 Core API（原生 `agents_company_api` 或同一 CLI），不直接修改宿主 JSON。`api.list` 紧凑目录 → `api.describe` 单命令 schema → 执行 → 回读；升级后用 `apiRevision` 确认契约。大结果按 `api.result` 续读，不为获取结果重复写入。返回发送成功只表示请求已接受，完成状态需继续查询。错误恢复与参数示例见 `core/secretary-api`。

按操作系统创建云端员工先使用 `host list --summary --json`，按 os / distribution 选择已登记主机，在 `agents card create --title NAME --host-id ID --remote-dir DIR` 中直接绑定云主机与远端目录；职位名称不代表操作系统，也无需先建团队。私聊记录与附件储存在独立的本机 `APP_HOME/direct/` 中，与员工自身 `cwd` 工作空间完全解耦。

每条输入独立选择回复位置：原生会话、CLI 或没有私聊/群聊来源标签时直接用原生正文；Message 私聊来源使用 `direct.post`，群聊来源显式向原群 `chat.post` 或调用 `agents_company_discussion_post`。用户本条明确要求其他目的地时再切换，不沿用历史来源。不要给自己调用 `session.send/enqueue` 冒充私聊。旁观消息静默阅读，不自动续聊。Messages 私聊仅展示显式发布的回复，完整原生对话在嵌入的 Agent 工作台会话中保留。
