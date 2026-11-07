# MarginReader 与商业产品的实际差距

**2026-10-18 核对的官方版本基线：MarginNote 4.4.6；XMind 桌面 26.05.01107。** 官方版本与功能文档说明比较对象，不能证明本项目通过。本轮打磨已有的阅读、摘录、整理、复习、终端空间和导出；不以方法数、布局数、开源身份或有 CLI 宣称全面超越。

## 官方比较来源

| 来源 | 本轮使用方式 |
| --- | --- |
| [MarginNote App Store](https://apps.apple.com/us/app/marginnote-4-ai-notes-mindmap/id1531657269?platform=mac) | 页面显示 4.4.6、Aug 23；不补写未显示的年份，不从无版本标签的更新段落猜测新版本 |
| [MarginNote 官方更新时间线](https://www.marginnote.com/en/whats-new/index.html) | 追踪阅读、整理、复习与新版交互的变化；后续评估前重新核对版本 |
| [MarginNote：卡片为轴](https://www.marginnote.com/en/features/card-axis/index.html) | 文档、知识卡与脑图来源联动的操作语义 |
| [MarginNote：沉浸模式](https://www.marginnote.com/en/features/immersive-mode/index.html) / [官方手册](https://manual.marginnote.com.cn/mn4/en/) | 阅读、书写、回忆与复习场景；不把纯文本呈现等同于触控/笔操作 |
| [XMind changelog](https://xmind.com/changelog) | 桌面 26.05.01107（2026-09-09）；版本记录包含打印修复，前版涉及浮动工具栏、添加主题与编辑界面 |
| [XMind Topic](https://xmind.com/user-guide/topic-editing-new) / [Outliner](https://xmind.com/user-guide/outliner-new) | 主题编辑、结构操作和大纲/地图切换的熟悉度基线 |
| [XMind Skill & CLI](https://xmind.com/user-guide/xmind-cli) | 官方已提供创建、读取、编辑和检查本地 `.xmind` 的 CLI；“有 CLI”不是 MarginReader 的独有优势 |

## 当前实现与已验证边界

MarginReader 的 CLI、三栏 TUI 与 `terminal-visuals` 已接入同一公共 runtime。TUI 的空间导航、来源回跳和返回视角已在真实 OS PTY 中操作；它不依赖旧浏览器学习面板。旧 GUI 被撤下的入口、可选 `serve` 和终端能力分别记录，不能把历史界面测试迁移为当前产品承诺。

最终 macOS arm64 / Node 26.5.0 适用源码为 564/564、0 fail/cancelled/skipped/todo，check 与隔离构建通过；required legacy 仍 blocked、overall partial。默认 PNG/raster PDF 已通过公开学习集与独立 worker 的实际像素检查和绑定文件 hash 的独立目视。上述证据说明本轮自身实现的具体改进，不提供竞品 A/B 或所有平台结论。

精确平台、测试阶段、原始报告及最终安装包的身份规则见 [CLI_PRODUCT_ACCEPTANCE](CLI_PRODUCT_ACCEPTANCE.md)。下表的“部分”指完整用户任务仍有差距；同一行内可以有明确已验证子项。旧 `MARGINNOTE_COVERAGE.md` / `XMIND_COVERAGE.md` 仅作源码研究索引，不提供新包全项通过证明。

| 任务 / 品质 | 已有实现与本轮证据 | 实际差距与下一道证据 |
| --- | --- | --- |
| 独立安装与无宿主本地使用 | 受控 npm tarball、逐文件 hash、干净 consumer 与已安装 bin 的 OS 断网验收流程 | 结论绑定最终 tarball 的 packageStatus / overall 和平台；安装依赖需要网络，不称完全离线分发；其他 OS 与最低 Node 未测 |
| CLI 帮助、参数与脚本输出 | 类型化参数、统一 help/schema、JSON、非零失败、别名；TUI help 无 Core / 工作区副作用，非 TTY 提前拒绝 | 与 XMind CLI 的同任务 A/B 未执行；所有 shell/长输入/批量组合未穷尽，Fish 运行环境未验证 |
| 长章节阅读与 Unicode | 当前章节有界布局复用；垂直导航保视觉列；中文、组合音标、emoji 按字素；同机自制 270k / 252k UTF-16 夹具显著降低热导航呈现时间 | 只是自身前后合成比较，非真实大书长期负载、物理终端 I/O 或竞品同机速度结论；复杂 PDF 原页另验 |
| 摘录、来源与上下文返回 | 完整 flow 引文选区；跨专题真实目标；失败/过时读不切界面；Esc 恢复原卡片、阅读位置与地图 camera；真实 PTY 中文持久化已测 | 全格式、源文重排、PDF 几何、复杂脚注/栏布局和打开独立客户端仍需各自证据 |
| 层级、笔记与键盘人体工学 | 标题/笔记/重排/折叠；Space 编辑标题；Tab 只切可见 pane；完整多行粘贴草稿、Ctrl-J、冲突恢复；真实 PTY 已操作 | 没有宣称逐键复制 XMind：当前 Tab 是 pane 切换、Enter 在大纲折叠，N 建笔记、m 重排；XMind 熟悉键位仍需用户任务学习成本比较 |
| 空间脑图与焦点 | CLI/TUI 已使用真实空间模块；平移、缩放、折叠搜索、首次远处选择入视口和来源返回；完整 camera 状态专项与真实 PTY 已测 | 终端单元格与图像协议不是商业 GUI 自由画布的同一种直接操纵；动画、触控板细节、全终端渲染兼容与大图长期使用未完成 A/B |
| 撤销、版本与数据恢复 | 跨专题 owner 与旧来源 alias、group 原子预检、有界大笔记逆操作、版本恢复身份冲突、负坐标/appearance 学习包往返均有专项；新文件失败清理有真实故障注入 | 不从逻辑故障注入推导真实断电、存储失联、多进程长期压力通过；历史宿主 required gates 仍 blocked |
| 问题正面 / 知识背面 | 问题编辑不改知识；默认背面随知识同步；自定义答案另存；已有公开 API 与安装包业务断言 | 全部题型、Markdown/公式/图像视觉、长内容可访问性和竞品相同复习任务未全面验收 |
| FSRS 与移出复习 | 评分、撤销/重做、重开、单次日志和会话已在源码 PTY 验证；移出复习保留知识卡；切 pane 不评分 | 长期统计、所有时区/调参情境未覆盖；纯文本不能忠实展示的图像遮挡题在 TUI 阻止评分，不把限制隐藏为完整题型支持 |
| 导出范围与大图媒体 | all / branch / visible 先解范围；折叠子孙、全局 ink、目标图片与总预算；10 项范围专项和最终 32 项字体/合成/边界专项分别通过；生产函数累计/去重采用小阈值边界验证 | 不是实际 40MP 内存压力或真实大书长期负载验收；需要继续以实际数据和平台记录规模边界，不能从字节限额推导解码内存峰值 |
| PNG、SVG、PDF、PPTX/Office 视觉 | 自制 10 主题、2 图片的默认 PNG/raster PDF 各 13 像素断言通过；独立 worker 各 4 几何断言通过；完整尾字、中文/emoji/公式/图片、裁剪、层序和编码后透明度有最终文件及独立目视记录；SVG 仍保留文字与来源 | 通过范围限本次 Mac 字体和夹具；不等于矢量 PDF、任意 SVG 查看器、全部公式/分页、各 Office/XMind 软件的视觉与可编辑性通过；缺字不能以转为 raster 保证修复 |
| XMind 文件互操作 | JSON ZIP 检查、导入、导出和既有结构数据 | 旧 XML、加密、未知私有扩展不保证无损；必须由真实独立 XMind 客户端打开、编辑、保存后再比对，包内 XML/JSON 合法性不等于保真 |
| OCR | 未实现；PDF 使用已有文字层 | 扫描 PDF 没有本地识别，不能写“已超过”；本轮不横向补建 OCR 系统 |
| DRM 解密 | 未实现 / 明确不提供 | 不把解密或绕过限制作为补齐方式 |
| 压感、掌触、笔尖与触控板 | 需硬件；纯 CLI 的输入和显示方式有明确边界 | 无真实设备数据；合成轨迹不能代表 Pencil 与 GUI 交互品质 |
| 可访问性、多显示器、外置盘与断电 | 部分或需硬件 | 键盘可用、NO_COLOR 与 PTY 不是屏幕阅读器、真实视听障碍用户、设备故障和耐久性验收 |
| 跨平台 / 最低 Node | 正式结果目前限报告列出的 macOS arm64 / Node 26.5.0 | 最低 Node 22.13、其他 LTS、Windows、Linux、macOS x64、字体、native 依赖和可选系统功能逐组合验收 |
| 联网研究、AI、云同步、备份 | 本轮范围之外；保留现有能力 | 不计入本轮阅读/整理/复习的改进或超越结论 |

## 怎样判定“更好”

后续比较必须使用同一份可公开夹具、同一硬件和实际安装的官方版本，录制完整任务：首次打开、检索第二处重复引文、摘录、回源、建层级、修正错误、复习、导出与重开。记录任务完成与数据正确性，再记录用时、操作次数、错误恢复、视觉可读性及新用户学习成本。长文性能要将冷加载、热操作和终端输出分开，导出要检查实际文字、图片、线条与分页，不用函数计数代替用户结果。

本轮已取得现有实现的改进和限定范围的验证；尚未取得 MarginNote / XMind 的同机任务 A/B、全部平台、硬件与真实交换验收。因此本文件没有“全面超过 MarginNote 4.4.6”或“每个操作均优于 XMind”的结论。新增证据应细化上述任务的状态，不能消除没有实际测试的差距。
