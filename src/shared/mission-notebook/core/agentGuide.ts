import { CommandError } from './errors';

const topics: Record<string, string> = {
  start:
    "你正在操作 Aexus Bot 内置的 Mission 超级 Notion 工作流笔记本（核心命令组 notebook.*）。\n" +
    "1. agents notebook status --json：确认笔记本根目录 ~/AgentsCompany/mission-notebook、页面数与数据库数；agents notebook call fs.info --json 确认物理目录。\n" +
    "2. agents notebook guide --topic pages / blocks / databases / workflows / delegation / verify 获取分主题实操说明。\n" +
    "3. 新建原生页面：agents notebook call page.create --params '{\"title\":\"技术分析\",\"color\":\"white\"}' --json，保留返回的 id。\n" +
    "4. 写富正文用 page.write-markdown；需要复杂原生块或工作流按钮时先 block.validate。\n" +
    "5. page.create 传 parentId 可创建任意深度子页面；物理目录树与页面树一一对应。\n" +
    "6. 数据库多视图工作流用 database.create + record.create + view.create。\n" +
    "7. 笔记本页面可通过 /workflow 或 button.create / automation.create 直接绑定派发员工（agent）、督办目标（mission）与定时工作流（schedule）。\n" +
    "8. 最后用 fs.audit（需 valid:true）、page.audit 和 view.render 验收。\n" +
    "员工身份受每页阅读/修改/新增授权保护；如无权限，请请求用户或 Secretary 通过 agents notebook access 授权。",
  pages:
    "原生页面创建返回 {id,title,parentId,...}；所有新建 page/database/record 需传 color:white（或支持预设色/#RRGGBB）。\n" +
    "agents notebook call page.create --params '{\"title\":\"架构主页面\",\"color\":\"white\"}' --json\n" +
    "agents notebook call page.create --params '{\"title\":\"Core 分析\",\"color\":\"white\",\"parentId\":\"ROOT_ID\"}' --json\n" +
    "agents notebook call page.write-markdown --params @request.json --json\n" +
    "request.json 为 {\"pageId\":\"返回的ID\",\"mode\":\"replace\",\"markdown\":\"## 架构\\n\\n正文\\n\\n|模块|职责|\\n|---|---|\\n|Core|共享服务|\"}\n" +
    "修改已有正文前先用 page.read-markdown 读取 expectedHash；CONFLICT 时先重新读取合并再重试。\n" +
    "agents notebook call fs.path --params '{\"pageId\":\"PAGE_ID\"}' --json 返回 absoluteDirectory、parentPageId、depth 与 mainPage。",
  blocks:
    "优先使用 page.write-markdown 转换标题、代码、列表与表格。\n" +
    "查看完整块字段：agents notebook call schema --params '{\"method\":\"block.append\",\"compact\":true}' --json\n" +
    "先校验再写入：agents notebook call block.validate --params '{\"blocks\":[{\"type\":\"table\",\"content\":{\"type\":\"tableContent\",\"rows\":[{\"cells\":[\"模块\",\"职责\"]},{\"cells\":[\"Core\",\"共享后端\"]}]}}]}' --json\n" +
    "页面内按钮与工作流块请使用 button.create / button.update，避免手拼内部 JSON。",
  databases:
    "数据库支持 10 种视图：table / board / gallery / list / calendar / timeline / chart / feed / form / plan。\n" +
    "1) database.create 创建数据库；2) property.list 核对实际属性 ID 与选项；3) record.create 写入记录；4) view.create 添加多视图；5) database.embed 将视图嵌入任意页面。\n" +
    "日历与时间线需配合 date 属性并写入记录日期，验收时检查 view.render 结果中的分组、days.records 或 series。",
  workflows:
    "Mission 笔记本支持页面内工作流按钮（/workflow / button.*）与数据库自动化（automation.*），并在保留全部原生动作（set/create/edit/insert/notify/reminder/variable/open/trash）之外支持三种 Aexus Bot 编排动作：\n" +
    "1) agent：派发给指定员工（employeeId、deliveryMode: direct|session、grantPageAccess: none|read|write|create、prompt）。\n" +
    "2) mission：创建持续督办目标（employeeIds、missionType: supervised|independent、reminderSeconds、title、prompt）。\n" +
    "3) schedule：创建定时或事件工作流（employeeId、scheduleKind: once|interval|weekly|event 及对应规则参数、prompt）。\n" +
    "文案和指令字段均支持 {{title}}、{{pageId}} 或公式对象 {formula:\"...\"}。",
  delegation:
    "协作委派请使用 Core 的 agents card / direct / session / mission / schedule 命令。\n" +
    "用户或 Secretary 可通过 notebook.resources 查看页面树，并用 notebook.access 为指定员工授予精确到页面/数据库的 read/write/create 权限；新增子页面会自动继承创建者权限。\n" +
    "Secretary 默认拥有全部笔记本读写与授权能力；普通员工只能访问获授权的页面及在其下方新建的子页面。",
  verify:
    "完成条件须同时验证数据结构与物理目录：\n" +
    "1) agents notebook call fs.audit --json（valid 必须为 true，errors 为空）\n" +
    "2) agents notebook call page.audit --params '{\"pageId\":\"ROOT_ID\"}' --json\n" +
    "3) agents notebook call view.render --params '{\"databaseId\":\"DB_ID\",\"viewId\":\"VIEW_ID\"}' --json",
};

export function agentGuide(topic = 'start') {
  if (!Object.hasOwn(topics, topic))
    throw new CommandError('INVALID_ARGUMENT', 'guide topic: ' + Object.keys(topics).join(' / '));
  return { topic, topics: Object.keys(topics), markdown: topics[topic] };
}
