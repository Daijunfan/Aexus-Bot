# MarginReader

独立、本地优先的 CLI 阅读与知识整理工具：导入文档、检索、带来源摘录、层级脑图、笔记、FSRS 复习和可交换导出。终端工作区 TUI 提供阅读与大纲联动；无需 Avalon/AgentsCompany、账号、模型或图形窗口完成本地任务。

当前版本 0.9.4。CLI 与 TUI 共用现有公共 runtime 契约。可选 `serve` 提供本机浏览器阅读器；宿主插件兼容保留，但不是独立安装前提。产品仍有明确的兼容性和人体工学差距，详见 [验收范围](docs/CLI_PRODUCT_ACCEPTANCE.md) 与 [竞品差距](docs/COMPETITIVE_GAPS.md)。本项目与 MarginNote、XMind 无隶属关系。

## 安装

需要 Node.js **>=22.13.0** 和 npm。先查看 Node/npm 版本；目前只在验收记录列出的实际平台测试，不将 `engines` 当作全平台保证。

从本地已构建 tarball 安装到独立目录（POSIX shell）：

```sh
mkdir -p "$HOME/marginreader-local"
npm install --prefix "$HOME/marginreader-local" /absolute/path/to/marginreader-0.9.4.tgz \
  --ignore-scripts --no-audit --no-fund
"$HOME/marginreader-local/node_modules/.bin/margin-reader" --help
```

后续示例假定该 `node_modules/.bin` 已加入 PATH。安装会由 npm 下载目标 OS/架构的依赖，包括 native 可选依赖；发布时从 lock 生成的 npm-shrinkwrap 固定传递版本。它不是完全离线安装包。安装后本地工作流不需要外网。没有发布到 npm，包名归属未核验；请勿将这里的名称理解为注册表可用性承诺。

源码开发：`npm ci --ignore-scripts --no-audit --no-fund`，然后 `node cli.cjs --help`。npm tarball 由 [独立发布流程](docs/RELEASING.md) 生成；不要分发本机 node_modules 冒充跨平台包。

## 五分钟 CLI 上手

以下例子使用自制资料和已有空目录；没有默认用户文库回退。POSIX shell 中设置工作区：

```sh
export MR_WORKSPACE="$(mktemp -d)"
margin-reader --workspace "$MR_WORKSPACE" mkdir Books
margin-reader --workspace "$MR_WORKSPACE" api fs.write \
  --data '{"path":"Books/start.md","content":"# 本地学习\n\n中文与 English offline reading.\n\n## 下一步\n\n整理知识。"}'
margin-reader --workspace "$MR_WORKSPACE" document open Books/start.md
```

复制 open 输出的 `result.id` 为 DOCUMENT_ID：

```sh
margin-reader --workspace "$MR_WORKSPACE" document read DOCUMENT_ID --text
margin-reader --workspace "$MR_WORKSPACE" document search DOCUMENT_ID offline
margin-reader --workspace "$MR_WORKSPACE" study create '学习集'
margin-reader help study.note.create
margin-reader help study.card.create
margin-reader help study.review.configure
margin-reader help study.mindmap.export
```

写入操作使用最新 `result.revision`，不会在冲突时悄悄重试。`help METHOD` / `schema METHOD` 给出准确参数，`commands keyword` 搜索友好命令；`api METHOD --data JSON|@file|-` 保留脚本兼容。默认输出 JSON-RPC，失败非零退出。完整例子、类型化选项和 shell 补全见 [CLI_REFERENCE](docs/CLI_REFERENCE.md)。

本地 PDF 导入不会移动外部原件：

```sh
margin-reader --workspace "$MR_WORKSPACE" import /absolute/path/book.pdf --to Books/book.pdf
margin-reader --workspace "$MR_WORKSPACE" tree
```

## 终端工作区 TUI

```sh
margin-reader tui --help
margin-reader --workspace "$MR_WORKSPACE" tui
```

`tui --help` 无需工作区即可查看启动要求和主要键位。进入交互终端后，按 `?` 查看完整快捷键，Tab 切换文库、阅读和知识面板，`g` 切换空间脑图。TUI 通过公共 runtime 读取完整学习集和布局，支持查找折叠分支中的卡片、定位来源、恢复原地图视角。其能力与终端要求见 [TERMINAL_WORKSPACE](docs/TERMINAL_WORKSPACE.md) 和 [TERMINAL_VISUALS](docs/TERMINAL_VISUALS.md)。

本轮针对连续阅读与编辑打磨了以下已有操作：

- 长章节首次排版后复用当前文本布局；切换内容或改变终端宽度时重排，缓存容量有上限。
- 上下翻行与翻页保留视觉列；中文、组合音标和 emoji 按完整字素移动。调整窗口宽度后仍保留源文位置。
- 回到摘录来源时显示完整原选区，Esc 恢复原学习集、卡片、阅读位置和地图视角。跨学习集来源打开失败时保留原界面上下文。
- 地图或复习全屏中，Tab / Shift-Tab 先返回分栏并切换到实际可见的文库/阅读面板，保留地图视角、选区、草稿和复习会话。知识大纲与地图可按 Space 编辑标题；输入框内的空格和复习中的揭示操作保持各自语义。
- 多行括号粘贴只修改草稿，中文与 emoji 保留，CRLF 归一为换行；检查后按 Enter 保存。Ctrl-J 可直接插入换行，粘贴中的回车和命令字母不会触发快捷键。
- 非 TTY 或 `TERM=dumb` 启动 TUI 时，在初始化 Core 前返回 `TTY_REQUIRED` 和非零退出码。管道与自动化使用普通 CLI 子命令。

基础终端以文字、来源位置和层级/空间大纲呈现知识；原页像素、图像协议、字体和输入硬件仍受实际终端能力约束。源码中的空间脑图、回源及退出恢复已通过本轮真实 OS PTY 验收；安装包与跨平台能力分别验收，不从文字界面推定原页、自由画布或手写体验等同于商业 GUI。

0.9 旧浏览器界面撤下了卡片盒、学习大纲、复习及学习仪表板入口；旧数据和公共 API 保留。新 TUI 是独立入口，不代表这些旧 GUI 面板已恢复。

### 同机长文性能证据

2026-10-18，在 Apple M5 Pro、macOS arm64、Node 26.5.0 上，用相同脚本、文本、真实 `string-width` 和 132 × 36 视口，分别运行修改前后源码。以下每项为 24 次热导航与完整帧生成的毫秒数，首次排版单独计量：

| 合成章节（UTF-16 长度） | 修改前 p50 | 修改前 p95 | 修改后 p50 | 修改后 p95 |
| --- | ---: | ---: | ---: | ---: |
| 英文 270,000 | 297.022 | 542.797 | 1.678 | 2.227 |
| 中英、emoji、组合音标 252,000 | 209.396 | 391.789 | 1.038 | 1.626 |

修改后首次排版的 p50 分别为 28.904 ms 和 19.779 ms（各 3 次）。原始报告为 `artifacts/cli-polish-20261018/tui-baseline.json` 与 `tui-after.json`，复跑方法见 [终端验收说明](docs/TERMINAL_WORKSPACE.md#verification-and-evidence)。此测试只计阅读呈现，不计文件解析、Core 请求、PDF 图片解码或物理终端输出耗时。

## 格式、平台与可选依赖

| 能力 | 依赖与边界 |
| --- | --- |
| PDF、DOC/DOCX、EPUB、MOBI/KF8、文本、HTML、常见图片 | 本地解析；MOBI parser 固定 0.4.6；不含 DRM 解密或 OCR |
| 终端阅读 PDF | 使用已有文字层；扫描 PDF 不能凭空产生可检索文字 |
| RTF | 需 macOS textutil；其他平台明确不支持 |
| 朗读、系统词典 | macOS say、Python3、DictionaryServices；其他平台有能力限制 |
| 音视频 | 需另装 FFmpeg/ffprobe；不会作为基础阅读的必需项自动安装 |
| PNG、摘录渲染 | canvas native 包须匹配 OS/CPU；不建议省略 optional dependencies |
| 中文矢量 PDF | 需兼容本地字体；缺字会明确报错。栅格导出同样依赖可用字形，转换格式不能保证修复缺字 |
| XMind | 公开 JSON ZIP 检查/导入/导出；旧 XML、加密、未知私有扩展不保证无损 |
| Windows/Linux/macOS x64 | 规划验收平台；没有对应实机记录时保持未测 |

## 可靠性与可选兼容入口

所有业务路径限于明确的工作区；持久更改通过公共 Core，保留版本冲突、可恢复删除与有界撤销。导出拒绝覆盖已有目标。复习正面只定义问题，默认知识背面同步；移出复习不删除知识卡。安装包测试核验原件 hash、重启、冲突和来源定位，但不能代替真实断电、硬盘故障或硬件输入验收。

可选 `margin-reader --workspace "$MR_WORKSPACE" serve` 仅输出本机随机令牌 URL，不自动开窗口；Ctrl+C 停止。不要公开该 URL。宿主环境下继续使用宿主授予的 workspace/mailbox；员工身份绝不自动回退为独立用户。

## 开发与测试

```sh
npm run check
npm run test:release   # 临时源码副本：check、npm test、安全预检和日志
npm run test:package   # pack → 干净本地安装 → 安装后 OS 断网业务闭环
```

`test:package` 目前以 macOS sandbox-exec 做系统级网络隔离；无该机制的平台明确 blocked，不计为 pass。网络依赖安装在断网业务阶段之前执行。验收报告以 `overall: passed|partial|failed` 区分结果；适用源码或安装包通过但 required legacy gates blocked 时，整体为 partial，不称完整回归通过。独立发布报告在 `artifacts/cli-product-20261018/`，本轮终端性能与真实 PTY 证据在 `artifacts/cli-polish-20261018/`；只使用自制临时夹具，不扫描 Downloads 或用户 default 文库。

`build:plugin` 是旧宿主可选构建，会生成源目录内契约和 vendor，并复制当前平台 node_modules；不得当作常规 npm 发布。`test:agent-acceptance` / `test:deep-audit` 依赖旧宿主、Electron/Playwright，独立流程先预检，不绕过失败断言。历史真实书籍/用户文件测试本轮不运行。详见 [CONTRIBUTING](CONTRIBUTING.md)。

## 许可证与历史

原始代码使用 [MIT](LICENSE)；分发依赖和生成资产的许可见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。旧 README 完整保存在源码 [docs/HISTORY.md](docs/HISTORY.md)，其中安装路径、历史测试与旧 GUI 描述不是当前独立包的承诺；历史私有材料不进入 npm 包。
