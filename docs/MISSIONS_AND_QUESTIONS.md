# 持续任务与聊天选择题

`mission.*` 保存“必须真正完成”的目标，`schedule.*` 保留原有定时、周期及事件排期。两者统一出现在 Mission → Plan 的查询、看板、日历和时间线中，原生会话、员工身份和工作目录保持不变。原生引擎运行成功只说明一次执行结束，不能自动完成持续任务。

界面的 **新建任务** 使用同一张表单：选择“由我确认成功”登记持续目标，选择“每次定时执行后”设置定时、周期或事件排期。切换时保留名称、说明和规划字段。它们复用下文既有 Core/CLI 接口与生命周期，不因统一入口而把一次执行成功当作目标验收。Engineering 与 Research 暂为空白子页。

## 持续任务

```sh
agents mission create --spec '{"name":"发布已验收的成果","prompt":"完成实现并检查验收证据，直到结果真正可用。","employeeIds":["EMPLOYEE_ID"],"type":"supervised","secretaryId":"SECRETARY_ID","reminderSeconds":1800}' --client-request-id stable-request --json
agents mission get --id MISSION_ID --json
agents mission fail --id MISSION_ID --expected-revision 2 --result '缺少真实的验收证据，仍需继续工作' --json
agents mission complete --id MISSION_ID --expected-revision 3 --result '已检查实际结果，验收标准全部达到' --json
```

- `supervised` 提醒所有执行员工和负责 Secretary，相同人员只投递一次；`independent` 只提醒执行员工，不给秘书发送额外提醒。提醒间隔为 10–31536000 秒，界面支持秒、分钟、小时、天。
- 创建时首次提醒，后续由 Core 定时提醒。忙碌时进入原工作队列；同一员工已有该任务在执行或排队时合并提醒，不用抢占正在做的工作。重启后不补发一串错过的提醒。
- 用户给 Secretary 的新私聊正文，在原生派发之前自动登记为持续任务，默认 30 分钟督办一次。重复提交同一个私聊发送键不会重复创建。原正文、附件和发送回执仍属于原私聊。Secretary 应读取随请求附带的 Mission ID，按实际任务调整类型、员工和时间，完成后显式记录成功。不要再次为同一输入盲目新建任务。
- 所有职位可设定给自己，上级仅可设定其当前权限内的下级；Secretary 可设定所有合法员工，包括其他 Secretary。多选任务的管理和成功确认要求对全部执行人有当前管理权，参与员工可报告阻塞。创建者记录保留；修改不会重写创建来源。
- `mission.fail` 记录问题并显示红色督办计数，提醒继续。`mission.complete` 必须包含实际结果，只有它停止未来提醒。归档仅改变显示，未完成和失败任务仍计数、提醒。删除只允许已明确成功的持续任务。
- Governor 任务需要固定 `viewId`，不跟随后续的用户视图切换。提醒在执行和排队恢复时重新核验当前身份、职位、凭据、目标及秘书身份；失效的委派不会被提升成用户权限。原授权失效后，即使原职位恢复，也必须由当前有权限的人读取并通过 mission.update 重新确认；旧的排队提醒不会因重新授权而复活。

## 聊天中的应用选择题

这是 Messages 中的持久化选择卡，不调用 Coding Agent 原生的审批/提问控件。所有 Aexus 员工均可在自己的私聊或有权发布的 Aexus 群里提问；外部 Dot/Grok 原生会话不被伪装成本地选择题。

```sh
agents question ask --conversation employee:MY_ID --question '这项任务采用哪种交付方式？' --options '[{"id":"brief","label":"简短报告"},{"id":"full","label":"完整报告和证据"}]' --timeout-seconds 600 --fallback '{"optionId":"full"}' --client-request-id decision-1 --json
agents question ask --conversation group:GROUP_ID --question '这一关键变更是否执行？' --options '[{"id":"continue","label":"执行"},{"id":"revise","label":"修改方案"}]' --timeout-seconds null --client-request-id critical-1 --json
agents question wait --id QUESTION_ID --seconds 25 --json
agents question get --id QUESTION_ID --json
```

选项数量不固定，ID 必须唯一；`other` 是保留 ID，由界面自动增加。用户选择 Other 后可提交自由文本。有限等待必须同时声明秘书/员工判断出的 fallback，界面会显示超时采用的方案；`timeoutSeconds:null` 不允许自动 fallback，必须等真实用户。只有用户能调用 `question.answer`，Secretary 不能冒充用户作答。

手动创建的目标在 `question.ask` 中传 `missionId`；私聊或提醒中的当前 Mission 会自动关联。可用 `question.list --mission-id MISSION_ID` 恢复已保存的决定。Team、群聊中的正式用户目标由 Secretary 先用 mission.create 登记，保留返回 ID，不能只完成原生轮次而不登记或验收。

`question.ask` 先保存记录，再发布选择卡，返回稳定 ID。`question.wait` 是最长 25 秒的单次网络等待，不是决策期限；返回 pending 时应暂停这项任务并让出轮次，不能伪造答案或用循环付费轮次等待。等待中的原任务不能继续执行 Core 写操作，仍可读取、发布等待说明或记录任务阻塞。新到达的上级消息、群消息和其他 Mission 使用独立任务，不能覆盖原选择题。同一 Mission 的后续提醒仍受原问题约束，不会借新轮次跳过等待；同一道未回答的问题不会因提醒而重复创建。问题保存原 Mission ID，原生上下文重启后可据此恢复目标。秘书不能绕过仍未处理的关联问题来确认成功；用户本人明确验收目标后，已失去用途的关联问题会撤回。等待连接关闭不会删除记录；重启仍能查询与选择。没有活跃等待者时，作答或超时决定会通过正常工作队列通知原提问员工。

左侧会话条目显示红点与“待处理”，打开会话不会清除它；只有真正作答、超时决定或撤回才清除。会话顶部的待处理入口可集中处理多道题，Other 草稿在本客户端刷新后保留。已经决定的记录保留实际答案和来源，不能被迟到/并发的第二个选择覆盖。

## 全局筛选与清理

`plan.preferences` 供用户/Secretary 保存跨 Mission 布局的筛选、熟悉任务隐藏列表和自动归档/删除策略，写入使用当前 `expectedRevision`。筛选与隐藏不影响执行；员工的 CLI 查询不会暗中继承用户的显示筛选，仍按各自授权和显式查询条件返回。

成功/失败可分别选择保留、归档或删除，以及经过多少秒后处理。默认均保留。尚未成功的持续任务永不自动删除；失败任务可自动归档并继续督办。排期只有最后一次工作已经结束、没有后续发生时间且没有活跃轮次，才进入自动清理，不清理暂停的例行任务或仍待触发的事件监听。旧排期删除继续保留其原有执行历史。

持久状态为 `missions.json`、`chat-questions.json`、`plan-preferences.json`，均在 Core 用户目录原子写入，不放入用户工作区、插件或原生引擎配置。Core 需保持运行，主机需保持唤醒；关闭或休眠期间不承诺实时通知。

Mission 的 Feed 展示真实提醒活动，明确标记“提醒已入队/投递失败”，不把它当作原生执行成功或目标验收。原生运行历史与运行统计仍只统计真实引擎轮次。
