---

持续目标与原有排期不同：`mission.*` 保存需要明确验收成功才结束的目标，支持秘书监督/独立完成、多名执行人和提醒时间；`schedule.*` 保持本文件所述的定时、重复与事件运行语义。原生运行成功不等于目标成功。私聊/群聊中的持久选择题使用 `question.*`，跨布局筛选及清理使用 `plan.preferences`。完整说明可通过 `agents api docs core/missions` 或 [持续任务与聊天选择题](docs/MISSIONS_AND_QUESTIONS.md) 阅读。
schema: agents-company.cli/v1
module: host-scheduler
version: '1'
workspace: employee
---

# Host scheduler CLI API

## Purpose

持久化地安排某个员工在指定时间使用指定模型、思考程度执行任务。调度器属于
Avalon Core，不依赖窗口或任何插件。CLI、Plan 视图与插件使用同一个
`schedule.*` 协议。**本版本未向 MiniNotion 接入此调度器**；MiniNotion 原有的页面
提醒/重复事项是另一项领域功能。

`action.prompt` 是发给员工的完整指令，可以包含要执行的 CLI 命令，例如
“运行 npm test，将失败原因写入 test-report.md”。调度器不会把文本直接交给本机 shell，
而是复用员工的 Codex/Claude Code 会话。是否成功完成业务目标仍以员工结果和工作文件为准；
`succeeded` 表示引擎正常完成该轮，不是对测试、部署等业务结果的断言。

## Workspace

任务保存员工 ID，目录和权限始终由现有员工/Team 决定，执行前重新检查。
Build 使用本地目录，cloud 使用 Team 的 SSH 连接，Work 使用插件授权目录。
任务不会覆盖工作目录、切换引擎或提升权限。创建时记录员工当前引擎；员工后来切换
引擎后，需要更新任务的 `action`（省略 engine 可重新推导）再运行，防止模型错配。

## Quick start

先保持桌面应用运行，或者在终端/自己的进程管理器中运行无窗口服务：

```sh
agents serve
```

另一个终端创建任务（替换员工 ID）：

```sh
agents schedule schema --json
agents session list --json
agents schedule create --name '工作日检查' --employee EMPLOYEE_ID \
  --time 09:00 --days 1,2,3,4,5 --timezone Asia/Shanghai \
  --window 09:00-18:00 --window-days 1,2,3,4,5 \
  --model gpt-5.6-luna --effort low \
  --prompt '运行项目现有的检查命令，将结果写入 daily-check.md。' \
  --timeout 1800 --json
agents schedule preview JOB_ID --count 5 --json
agents schedule history JOB_ID --json
```

指定一次时间，必须带 UTC 偏移：

```sh
agents schedule create --name '一次检查' --employee EMPLOYEE_ID \
  --at '2026-12-01T09:00:00+08:00' --prompt-file ./task.md --json
```

每小时执行，并限制在工作日夜间（跨午夜时段归属于开始的那天）：

```sh
agents schedule create --name '夜间任务' --employee EMPLOYEE_ID \
  --every-seconds 3600 --timezone Asia/Shanghai \
  --window 22:00-02:00 --window-days 1,2,3,4,5 \
  --prompt '检查工作目录中的任务清单并处理待办。' --json
```

`--start ISO` 指定间隔锚点；省略则从创建后一个间隔开始。`--time` 不带 `--days`
表示每日；不带 `--timezone` 使用当前机器时区并在创建时固定保存。`--until ISO`
是排期和自动执行的截止时间。默认启用自动运行；`--enabled false`（或 `--enabled off`）
创建禁用任务，`--paused` 保留为同义的无值 flag；`--enabled true` / `--enabled on`
明确启用。`--enabled` 缺值或非法值、`--paused` 带值、两者同时出现都会在创建前拒绝，
不会静默启用。使用 `--spec` 时请在 JSON 内设置布尔值 `enabled`，不能再混用这两个 flag。
例如先保存、检查后再决定是否启用：

```sh
agents schedule create --name '待确认检查' --employee EMPLOYEE_ID \
  --after-seconds 1800 --prompt '检查项目并报告。' --enabled false --json
agents schedule get JOB_ID --json
```

Governor 目标还必须提供 `--view VIEW_ID`，见下文“Governor 任务的视图目标”。`--source plugin-id`
用于未来插件查询自己创建的任务，是调用方标签，不是权限凭证。

## Commands

所有命令支持 `--json`。Socket 请求为 `{cmd:"schedule.METHOD",args:{...}}`。
返回宿主统一 `{ok:true,data:...}` 或 `{ok:false,error:"..."}`；失败 CLI 非零退出。

| CLI | Socket args | 语义 |
| --- | --- | --- |
| `schedule schema` | `{}` | 机器可读的字段、默认值、运行策略 |
| `schedule status` | `{}` | 是否运行、错误、活动 run ID、持久化路径 |
| `schedule list [--employee ID --source NAME]` | `{employee?,source?}` | 查询排期 |
| `schedule get ID` | `{id}` | 完整配置和 nextAt；事件规则等待时为 null，不代表已完成 |
| `schedule create --spec @job.json` | `{spec}` | 创建排期；也可使用上述 flags |
| `schedule update ID --patch @patch.json` | `{id,patch}` | 顶层部分更新；action/rule/window 提供完整对象；活动任务先取消 |
| `schedule pause ID` | `{id}` | 暂停后续触发，不停止当前轮 |
| `schedule resume ID` | `{id}` | 从当前时间之后重新计算，不补跑暂停期间任务 |
| `schedule preview [ID [--patch JSON] / --spec @job.json] --after ISO --count 5` | `{id?,spec?,patch?,after?,count?}` | 只计算未来时间，不执行；保存任务的 patch 预览保留已用次数且不写入；count 1–100 |
| `schedule run ID` | `{id}` | 明确立即执行一次，即使排期暂停/已结束；忽略日历和工作时段，保留超时与权限；不消耗 nextAt |
| `schedule history [ID] --employee ID --limit 50` | `{id?,employee?,limit?}` | 最新在前；保留最近 1000 条完成记录及全部活动记录 |
| `schedule trigger ID --event-id KEY` | `{id,eventId}` | 向 signal 事件规划发送去重信号；校验当前调用者和原委派，无法伪造原生事件 |
| `schedule cancel RUN_ID` | `{id:runId}` | 终止该次执行，等待引擎停止；不暂停后续排期 |
| `schedule delete [ID \| --ids JSON]` | `{id,expectedRevision?}` 或 `{ids,expectedRevisions?}` | 整批校验确切 ID、权限与修订后暂停并取消活动执行，再删除排期；保留审计记录 |

配置例子（`engine` 创建时可省略；下例为 Claude；Codex 使用 effort，不接受 thinking）：

```json
{
  "name": "整理工作清单",
  "source": "my-plugin",
  "enabled": true,
  "action": {
    "type": "agent",
    "employeeId": "EMPLOYEE_ID",
    "engine": "claude",
    "prompt": "阅读工作目录中的任务并更新清单。",
    "model": "YOUR_CLAUDE_MODEL_ID",
    "effort": "low",
    "thinking": true
  },
  "rule": {"kind":"weekly","time":"09:00","days":[1,2,3,4,5],"timezone":"Asia/Shanghai"},
  "window": {"start":"09:00","end":"18:00","timezone":"Asia/Shanghai","days":[1,2,3,4,5]},
  "timeoutSeconds": 1800,
  "graceSeconds": 60
}
```

`rule` 还支持 `{kind:"once",at:"ISO"}`、`{kind:"interval",everySeconds:3600,anchor:"ISO"}`。
`window:null` 和 `until:null` 清除限制。模型 ID 原样交给员工引擎，权限和可用性由引擎检查，
引擎拒绝会记为失败，不会偷偷切换模型。`effort` 支持 low/medium/high/xhigh/max，
具体模型仍须支持该值。模型/思考覆盖仅用于当前轮，不写入员工持久设置，完成后恢复。

## Files

- `$AGENTS_COMPANY_HOME/schedules.json`：版本 1 配置与有界运行记录，原子替换写入。
- 员工原有 transcript：包含定时任务的指令与输出，可用 `agents session transcript EMPLOYEE_ID` 读取。
- 每次记录含 jobId、执行时的 action、scheduledAt、startedAt、finishedAt、sessionId、status、message。
- 源码：`src/shared/scheduler.ts`、`src/main/scheduler/{time,execute,service}.ts`。

## Errors

- 员工忙碌或被另一任务占用：记录 `skipped`，不会打断人工对话，也不排无限队列。
- 执行期间：可读取/查看同一会话；发送新指令、修改模型/权限/引擎或目录需要先取消任务。
- `failed`：引擎报错、目录/引擎改变、连接失败等；不自动重试有副作用的命令。
- `timed_out`：达到 timeoutSeconds，或自动执行时抵达 window/until 截止；终止当前轮。
- `cancelled`：显式取消、任务删除或正常服务关闭。`interrupted`：上次进程异常结束。
- 删除员工或 Team：关闭会话，相关任务自动停用并标记 employee_removed，不能再次运行。
- 超过 graceSeconds（默认 60 秒）的过期触发记为 skipped，一次推进到未来；不连续补跑。
- 先保存执行声明，再启动员工。重启后不重放已声明的任务；这不是外部命令“恰好一次”的保证。
  崩溃、网络断开时应先检查工作文件，再决定手动重跑。
- 时段开始包含、结束不包含；夏令时缺失时刻向后平移，重复时刻只取较早一次。
  带窗口的未来匹配最多查找 366 天，不匹配的启用排期会被拒绝。
- 系统休眠、关机或没有服务进程时不能执行。恢复后按 graceSeconds 跳过或执行，**不会自动唤醒 Mac**。
  此版本不自动修改 launchd 或登录项。损坏的调度文件停止调度并通过 status 报错，不重置文件。

## Compatibility

契约为宿主 `schedule.*` v1；通过宿主 CLI/socket 使用，不依赖 MiniNotion 或 Electron。
未来插件复用此接口，不能为宿主员工再创建自己的隐藏会话或绕过员工目录权限。
插件自有的文档提醒可以继续独立存在。Plan 提供 Table、Board、Timeline、Calendar、Planner、List、Gallery、Chart、Feed、Form 十种调度数据库界面，仍使用同一套 API。

验证：`npm run test:scheduler`。测试使用隔离数据与确定性引擎替身，Codex 参数固定
`gpt-5.6-luna` / `low`，没有模型推理费用。

## Management authorization

Jobs and runs preserve the requesting principal. Visual relation IDs never grant scheduling authority.
Every role may create, read, modify, pause/resume and delete its own one-off,
recurring and event tasks regardless of `createdBy`. Authorization follows the
current target, not the original author: Manager covers itself and lower-role
Employees in its Team; Governor covers itself and global Employees/Managers, but not
another Governor or Secretary; Secretary covers itself and every legitimate employee,
including other Secretaries. Changing the target requires authority over both the old
and new target; `createdBy` remains unchanged audit history. Creation, explicit
update/resume, manual run and signal trigger revalidate the current actor's authority.
Manual run and trigger use the caller's current authorization, never the original
author's credentials, and do not re-enable a revoked automatic delegation. Background
due runs recheck the saved authorization. Missing-employee orphans may have metadata
maintained only by the user or Secretary and can never execute. Revocation disables
future automatic jobs and cancels matching active runs; the old automatic authorization
stays disabled until a legitimate actor explicitly updates or resumes the task.
Unrelated user/Manager work is retained. Legacy jobs without delegation remain
operator-owned. `source` is only a label and never grants permission. Manager schedule
listings cover records within their current target scope, not the global scheduler store.

## Governor 任务的视图目标

Governor 定时任务必须在 `action.viewId` 指定稳定 Team 视图 ID，简写命令可用 `--view VIEW_ID`。创建、修改和执行时校验；模型收到同一目标视图，运行时不查询当前标签作为兜底。视图删除后任务失败，不退回 All Team；此字段不授予权限。普通 Employee / Team Manager 不接收该字段。

```sh
agents schedule create --name "研发视图检查" --employee GOVERNOR_ID --view VIEW_ID --prompt "查看这个视图的团队布局" --every-seconds 3600 --paused
```

## Detailed scenario checks

Saved-job preview accepts `{id,patch?,after?,count?}`. A patch is temporary and follows the update replacement rules; it is never persisted. Moving the preview cursor or calendar range does not reset a finite remaining quota. Notes-only edits preserve the next scheduled instant and can annotate a completed one-shot without replaying it. UI fields retain unchanged absolute seconds/milliseconds and the recurrence timezone's cutoff. See `docs/PLAN_SCENARIOS.md` for practical case-by-case assertions, including actual scheduled MiniNotion writes and rich database rendering.

## Plan extension (additive v1)

Plan is now a first-class view over this same scheduler. `afterSeconds`, `employeeId:"self"`, monthly rules, `maxOccurrences`, Plan metadata, creation idempotency and revision checks are documented in [PLAN.md](PLAN.md). All previous job IDs and schedules remain valid. Ordinary Employees may schedule themselves through a self-target-only delegation; scheduling others requires a strictly lower role within the existing Team/global control scope. `schedule:changed` broadcasts saved database changes. The host must remain online and awake.

## Read-model layout extension

`plan.durationMinutes` (1–43,200) supplies an optional future work estimate. It is not a timeout, scheduling reservation or automatic stop time. Timeline uses actual timestamps for recorded attempts, displays missing estimates as instants, and uses half-open spans at date boundaries. `plan.analytics` counts all authorized matching schedules or retained actual runs; `plan.feed` never fabricates activity from forecasts. See `docs/PLAN_VIEW_PARITY.md` for APIs and interactive cases.

## Plan 统一调度与严格下行权限

所有角色的定时、重复、事件触发员工工作统一使用本 API，并能在 Core Plan 中查询和调整。各职位都可创建、读取、修改、暂停恢复或删除自己及可管理目标的一次/重复/事件任务，不论记录由谁创建。Employee 只能给自己排期；Manager 可给自己及本 Team 的 Employee 排期；Governor 可给自己及全局 Employee/Manager 排期，不能管理另一 Governor 或 Secretary；Secretary 代表用户管理全局合法员工排期，包括同级其他 Secretary。Manager/Governor 仍不能向同级或上级分派。修改按当前目标权限判定，不按 `createdBy` 作者；变更目标须同时可管理原目标和新目标，原 `createdBy` 审计不重写。用户与 Secretary 可调整全部合法员工规划；Secretary 任免仍由用户控制。

`schedule.create/update/preview/run/resume/trigger` 等目标操作均受同一权限边界保护。撤权后旧自动授权保持停用；合法调用者显式 update/resume 才重新授权，manual run/signal trigger 使用当前调用者的本次授权，不能借用原作者凭据，manual run 也不会重新启用旧自动委派。后台到期运行复核保存的授权，实际执行和异步准备之后再次复核。新增 `action.channelId` 明确关联员工引擎频道，要求目标持续具有发布成员身份。旧 UI 的 `source:channel:ID` 仅迁移为经过校验的频道引用，不授予权限。移除成员会停用关联任务。

事件规则现支持 `signal`、`channel.posted`、`message.received`、`session.completed`、`monitor.output`、`monitor.exited`。来源分别使用 channelId、conversation、employeeId 或 monitorId，只有对应字段可填写。先保存事件再执行委派/启动监测程序。忙碌、冷却和工作时间窗将事件持久排队，每次最多合并 100 条，其余继续等待；稳定 ID 去重，重启保留队列，已开始后中断的执行不盲目重做。Dot 的首条确认或安静间隔不表示整个任务完成。见 [事件计划与程序监控](docs/EVENT_TASKS.md) 和 [外部 Worker](docs/BOT_WORKERS.md)。

事件计划立即出现在 Plan，等待时 nextAt 为 null；预览不虚构日期，日历展示真实执行记录。事件与定时任务共用原有持久化、保留策略、执行器和取消入口，不另建计时器或员工会话。频道表单复用完整 PlanEditor，尚未配置发布计划时明确显示自动发布未配置。详细字段和 CLI 示例见 PLAN.md 的 Unified automation 章节。

专项复验：`node test/plan-authority-core-test.mjs` 与 `node test/plan-authority-ui-test.mjs`，均使用隔离构建/数据和确定性协议替身。

## Record administration and bulk cleanup

For task discovery use `plan.query`: it returns IDs/revisions, names, target identity,
role/Team, exact rules/times and current action capabilities. `schedule.list/get` retain
the raw-job contract. Secretary reads all Plan records, including orphaned schedules;
maintenance of missing-target records is separated from actual execution authorization.
A removed target can be cleaned up or reassigned, never implicitly recreated or run.
See PLAN.md for the canonical permission and null-identity behavior.

`schedule.delete` accepts either `id` with optional `expectedRevision`, or `ids` with
an optional complete `expectedRevisions` map. Every selected record is preflighted
before any side effect; deletion preserves run history and workspace files. A pending
deletion cannot be re-enabled by a concurrent update/resume. `pause`, `resume` and `run`
also accept `--expected-revision` to guard against a changed task.

## Conversation notices are separate from Plan

Current conversation offices (Group Owner/Admin/Member, channel Admin) are independent of Company managementRole. Ordinary employees need actual conversation Owner/Admin to configure mute, quiet mode and fixed-text notifications; user/Secretary administer all groups; Secretary administers all groups without joining; other Company roles still need the actual conversation office. Owner alone dissolves groups or transfers ownership, with user/Secretary administrative recovery. `conversation.notice-*` posts saved text through an independent Core timer/storage without running an Agent or entering Plan. Plan `schedule.*` remains the exclusive API for scheduled employee work. See [CONVERSATION_CONTROLS.md](docs/CONVERSATION_CONTROLS.md) for the current, detailed boundary.


## Secretary 应用管理

Secretary 代表用户全局管理合法员工的 Plan，包括其他 Secretary。Manager/Governor 保持严格下行和原 Team 范围。任务执行仍检查当前目标、原始委派、初始化、原生执行许可与时效；用户独占 Secretary 任免，不借排期变更身份。
