# 独立 CLI/TUI 产品验收

本轮保持 **0.9.4 公共 runtime 契约**。产品入口是独立安装后的 `margin-reader` CLI 与 TUI；可选 `serve` 和宿主兼容构建分别验收。源码测试、实际 npm tarball、安装后 bin、导出实物和竞品任务对照是不同的证据，不能相互代替。

## 结论与证据规则

报告使用 `overall: passed | partial | failed`。执行失败为 `failed`；没有执行失败，但声明范围中的 required gate 被阻塞、未运行或有 skip 时为 `partial`；只有该范围的必需门槛全部完成才为 `passed`。`test:release` 另给 `applicableSourceStatus`，包验收另给 `packageStatus` 与 `requiredLegacyGates`。因此“适用源码通过、安装包门槛通过、required legacy blocked、overall partial”是准确表述，不能简写为完整回归通过。进程退出码不代替报告中的状态和 `scope`。

- **已验证子项**：写明被测版本、平台、夹具、断言和日志；小范围通过不扩大为所有格式、设备或竞品全项通过。
- **部分**：有实现或专项证据，但该任务还有未覆盖的交互、视觉、格式、性能或异常路径。
- **未实现**：没有对应能力；例如 OCR 不得从 PDF 文字层搜索推导出来。
- **未测 / blocked**：实际没有执行或前提不可用；保留原因，不记为 pass。
- **需硬件**：笔、压感、掌触、触控板、外置盘和多显示器等，不能用合成事件替代实机结果。

## 最终包的身份与报告

所有路径相对项目根。每个 run 是独立且保留的记录，不用较早的包搭配较晚的源码测试。最终源码冻结后执行验收；任何进入 payload 的后续改动，都需要重新 pack 并验证新的 tarball。验收结果保留在包外的 artifacts 中，不为补写“已通过”而修改已打包文档。

| 证据 | 路径与核对字段 |
| --- | --- |
| 隔离源码 | `artifacts/cli-product-20261018/checks/run-*/results.json`；核对平台、Node、`suites` 原始计数、`applicableSourceStatus`、`blocked` 和 `overall`，并阅读同 run 的 check、npm-test、build 日志 |
| 发布输入与归档 | `artifacts/cli-product-20261018/release/run-*/source-inputs.json`、`npm-pack.json`、`filelist.json`、`SHA256SUMS`；核对最终 tarball SHA-256、大小、逐文件字节数和 hash |
| 安装包总报告 | 同一个 release run 的 `verify-*/package-verification.json`；核对 `tarball`、`sha256`、`manifest`、平台、Node、`verifierSHA256`、各 gate 和 `packageStatus` / `overall` |
| 安装后断网 CLI | 同 verify run 的 `offline-workflow.json` 与 `.log`；核对真实 EPERM 探针、所有 `checks`、`failedCount` 和 `sourceSelection` |
| 安装后 PNG / 栅格 PDF | 同 verify run 的 `installed-map.png`、`installed-map-raster.pdf`，以及 `offline-workflow.json` 的 `rasterExports`；核对 SHA-256、bytes、width/height、PNG `opaquePixels` / `inkPixels` 和 PDF `imageStreams` |
| 安装后真实 PTY | 同 verify run 的 `installed-tui-pty.json`、`.log`、`.cast` 与 `-map.txt`；核对独立 EPERM 探针、各进程结果、持久化断言、录屏和视角帧 |
| 安装后空间渲染 / serve | 同 verify run 的 `terminal-visuals.log`、`terminal-visuals-frame.txt`、`serve.log`；空间探针在断网沙箱内，loopback 资产检查在沙箱外，两者范围分开 |
| 专项回归与实物 | `artifacts/cli-polish-20261018/` 的对应日志和性能报告；视觉实物还须关联生成脚本、默认字体环境、文件和实际检查结果，不能只交 XML/DOM 断言 |

`filelist.json` 不是仅列清单：verifier 检查 tar 项路径与类型，拒绝链接、特殊文件、重复或未列 payload，解包后逐文件比较大小和 SHA-256。报告同时记录 verifier、业务 harness 与 PTY harness 的 hash，避免混用不同校验器。验收现有归档使用 `node scripts/verify-package.cjs /absolute/path/to/file.tgz`，会创建新的 verify run。

## 必测矩阵

| 门槛 | 方法 | 通过标准与边界 |
| --- | --- | --- |
| 包边界 | 实际 npm pack、tar 列表和逐文件 manifest 校验 | 受控 payload；无 node_modules、用户文库、credentials、source-location、artifacts、dist-plugin、私有历史路径或未列文件 |
| 独立安装 | 全新 consumer、临时 HOME、空 npm userconfig、`--ignore-scripts` | npm 安装当前 OS/CPU 依赖；离开源码 cwd 直接运行 POSIX bin；无 NODE_PATH/宿主模块依赖。依赖安装先于断网阶段，不称完全离线安装 |
| 安装后断网 | macOS `sandbox-exec` 的 `deny network*` | TCP 外连必须实际返回 EPERM，相同沙箱及子进程完成业务；仅超时或没有主动请求不证明断网 |
| 导入 / 搜索 | 自制中英文 HTML 与有文字层 PDF | 原件和导入副本 hash 不变；中英文搜索结果可定位；不推导扫描 OCR 或复杂 PDF 排版通过 |
| 精确选区 / 回源 | 重复中英文引文、前缀包含 astral emoji 的 HTML | 选第二处引文，验证 `selection.start/end` 为 UTF-16、引文、sourceVersion、documentId、section、textOffset 和重启后的阅读位置一致 |
| 摘录 / 层级 | 安装后 CLI 调公开 API；真实 PTY 选区与重排 | durable 摘录和父子关系跨进程保存；TUI 中文选区、完整回源高亮与 Esc 返回另有交互证据，图片非空不代表像素正确 |
| 编辑 / 冲突 / 撤销 | 最新与 stale revision；跨专题移动及历史专题专项 | 冲突非零且不覆盖；撤销/重做保留可证明来源 owner；大笔记保留可执行逆操作，超限写前明确拒绝，失败不留下部分状态 |
| 失败写入清理 | 真实文件的部分写、sync、close、stat 与路径替换故障注入 | 只清理本次创建且身份可确认的未完成文件；已有文件、符号链接或外部替换不删除；异常不假报成功。不替代真实断电试验 |
| 复习语义 / FSRS | 正面编辑、知识同步、揭示、评分、禁用与重启 | 问题正面不篡改知识，默认背面同步；移出复习不删知识卡；单次评分日志和会话持久保存；切换面板不评分 |
| CLI 人体工学 | `tests/cli-product*.test.cjs` | 类型化参数、真实 help/discovery、JSON、stdout/stderr、非零错误码、别名和补全分别断言；TUI help 不加载 Core，非 TTY 启动提前拒绝且无 ANSI |
| TUI 可见焦点 / 草稿 | `tests/tui-*.test.cjs` 与真实 OS PTY | 中文/emoji 字素完整，垂直移动保留视觉列；Tab 只进入可见面板；Space 标题编辑与复习揭示不冲突；粘贴不提交快捷键，Esc/冲突恢复保留正确草稿 |
| TUI 退出 / 重开 | `tests/tui-pty.cjs`；安装 bin 独立 PTY harness | 真实键盘闭环并重启核对文本、来源、层级和 FSRS；源码覆盖 q、Ctrl-C、SIGINT、SIGTERM、运行异常、初始化失败，自然退出并恢复 raw/cursor/alternate-screen/bracketed-paste |
| 空间脑图 | terminal-visuals 与 CLI/TUI 集成测试；安装后渲染探针 | 布局、折叠、边界、缩放、首次远处选择、来源回跳与返回视角可检查；准备/呈现不改 Core；控制序列安全和协议降级独立验收 |
| 导出作用域 / 媒体预算 | mindmap-export-scope、media-scope 与字素专项 | all / branch / visible 各自准确；先解析目标再读附件；作用域外坏媒体不阻塞；图片/ink 范围、总预算与失败不写目标均可复现 |
| 安装后真实位图导出 | 断网沙箱内经安装后的 `api study.mindmap.export` 导出 PNG 与 raster PDF | native PNG 解码得到与结果相符的尺寸和实际墨迹；PDF 重开单页，含同尺寸的非空图像流；保留产物与 hash。该门槛不代替下行对每个字形、裁剪和 PDF 渲染像素的精细检查 |
| SVG / PNG / PDF 实物 | 实际默认生产导出路径与本地安装字体；保留生成文件并查看 | 中文、ZWJ 家庭、旗帜、组合音标、行距、富文本、图片与 ink 可见且无遮挡；图像裁剪、层序和透明度正确，透明度须从实际编码文件重新解码检查；SVG 与矢量 PDF 的可用链接另测，PNG 不提供交互链接；缺字明确失败，不能靠临时注册字体、XML 存在或编码前 Canvas 像素宣称通过。SVG 查看器、矢量 PDF、栅格 PDF 分别验收 |
| 长文 / 大图性能 | 同机、同脚本、同夹具和键序列，冷/热分开 | 报 p50/p95、样本数、硬件、Node、视口与测量边界；合成呈现不冒充物理 TTY、真实大书压力或竞品同机对照 |
| 契约 / 全量源码 | 临时副本 check、全部 `.test.cjs`、可选兼容构建 | 语法与 manifest/API/UI 边界一致；原样记录 pass/fail/skip/cancelled；不修改旧断言绕过，不从专项次数推导全量通过 |

## 本轮已完成的源码证据

以下为 **2026-10-18 macOS arm64 / Node 26.5.0** 的最终适用源码结果及保留的历史专项，不是最终 tarball 的替代品。末次源码报告为 `artifacts/cli-product-20261018/checks/run-2026-10-18T04-59-17-644Z/results.json`：`applicableSourceStatus=passed`，required legacy 仍 blocked，`overall=partial`。表中专项与全量存在重叠，不能相加。

| 范围 | 已记录结果 | 证据与限制 |
| --- | --- | --- |
| 最终适用源码 | **564/564**，0 fail/cancelled/skipped/todo，24.559 秒；check 退出 0，12.196 秒；隔离兼容 build 退出 0，含 TUI 副本 | 上述最终 `results.json` 及同 run 的 `check.log`、`npm-test.log`、`build-plugin.log`；四个缺失旧宿主路径仍阻塞两套 required legacy gates，整体不是完整 pass |
| 修改前基线 | check、481/481 源码测试、隔离兼容 build 通过；legacy blocked，整体 partial | `artifacts/cli-product-20261018/checks/run-2026-10-18T02-43-25-296Z/results.json`；只代表修改前 |
| 阅读布局 / 粘贴 / 回源 / CLI | 64/64，0 skip，6.736 秒 | `artifacts/cli-polish-20261018/tui-targeted.log`；早于后续 help 和全屏焦点修复 |
| 无 Core 的 TUI 帮助 / 非 TTY | guard 文件 4/4，含 2 项新增 help | `tests/cli-product-tui-guard.test.cjs`；与前项部分重叠；Fish runtime 未安装，不能从 0 skip 推定已验证 |
| 全屏焦点 / Space / 复习 | spatial 与 workflow 两套 18/18，0 fail/skip，4.239 秒 | `tests/tui-spatial.test.cjs`、`tests/tui-workflow.test.cjs`；真实 Core 和渲染断言，不相加为全套总数 |
| 最终源码真实 PTY | 7 个进程模式与重开验证全部通过 | `artifacts/cli-polish-20261018/tui-pty-final.log`、`pty-session-final.cast`、`pty-session-final-map.txt`；包含所有 modal 消失屏障、Space、Tab/Shift-Tab、中文/emoji/Ctrl-J 与粘贴防误触 |
| 来源 owner / 有界撤销 / 版本冲突 / 学习包 | 7 类指定套件共 34/34，0 skip，2.536 秒 | `artifacts/cli-polish-20261018/core-targeted.log`；后续等价 Set 成员检查不另报产品性能倍数 |
| 新文件失败清理 | 7/7，0 skip，61.342 毫秒 | `artifacts/cli-polish-20261018/safety-write-new.log`；文件故障注入，不是硬件失效证明 |
| 归档完整性校验器 | 4/4 | verifier 的 manifest/路径/类型/逐文件校验专项；不能代替最终实际 tarball 校验 |
| 导出范围 / 媒体 / 字素 / 首次导航 | 4 套共 10/10，0 fail/skip，609.813 毫秒 | `artifacts/cli-polish-20261018/visual-scope-targeted.log`；不是默认 raster 字体实物验收 |
| 中文禁则 / 图片尺寸预检 / 嵌套坐标采样 | 3 套纯源码测试共 18/18，0 skip，56.697 毫秒 | `artifacts/cli-polish-20261018/visual-bounds-targeted.log`；含旧字素项，不与前行累加；单图维度解析和 CTM 通过不代替 40MP 累计生产门槛或公开导出的真实像素 |
| 最终字体 / 栅格合成 / 中文禁则 / 资源边界 | 5 套共 **32/32**，0 fail/skip，450.731 毫秒 | `artifacts/cli-polish-20261018/visual-v5-targeted.log`；含前述图片和坐标项；真实 compositor 的缩小阈值累计/去重边界验证，不是实际 40MP 内存压力测试 |
| 默认公开导出与独立 worker 实物 | public PNG / raster PDF 各 13 个像素断言；worker PNG / raster PDF 各 4 个几何断言；四产物全部通过自动检查并完成绑定 hash 的独立目视 | `artifacts/cli-polish-20261018/export-production-v5/proof.json` 与 `visual-review.json`；34 个像素断言不并入 32 项或 564 项 node:test 计数；原始 proof 状态不事后改写 |

### 默认生产导出的实物证据

`tests/export-production-proof.cjs` 在隔离自制学习集中经公开 `study.mindmap.export` 生成 10 主题、2 图片的 PNG 和 raster PDF，检查完整中英文尾字、家庭 emoji、三面旗帜、组合音标、丰富文字、四色图片、中文 MathJax 及来源页码；另经相同生产 worker 检查旋转、内外两层裁剪、后画覆盖和透明度。测试没有临时注册字体。公开导出的主题/图片范围、SVG 完整标题与来源链接、visible 范围以及工作区状态不变也有断言。

在 `export-production-v5/` 中，`public-map.png` 与实际 PDF 重渲染得到的 `public-raster-pdf.png` 均为 2128 × 2207、193,386 字节，SHA-256 均为 `ba64ffb54724cd023121c4d27202ff123ca999b167394b114a6237c78b016d6a`。两者逐字节等同于已独立查看的公开地图，完整正文目视结论因此绑定到最终产物。此 hash 指 PNG 文件，不是 PDF 文件本身。

`worker-geometry.png` 与 `worker-geometry-pdf.png` 均为 800 × 480、13,406 字节，SHA-256 均为 `caf27b48ce88b051bbf58ded6139e3ea27d7f4104d2087400a7d0c1e78298824`。从实际 PNG 重新解码，红为 `[255,0,0,127]`、蓝为 `[0,0,255,127]`，内外裁剪之外均为 RGBA 0；独立目视核对了裁剪区域、旋转后的覆盖位置、中文、组合音标、家庭/国旗和公式。白底查看副本只辅助阅读，alpha 证据来自原透明文件。

`proof.json` 保留脚本原始 `automatedChecks=passed`、`overall=awaiting-manual-review`；包外 `visual-review.json` 另记录三个 AI 代理的实际独立审核范围与文件身份，不称真人用户可用性测评，也不把自动报告改写成已经包含目视的记录。这次实物通过限于自制夹具、实际 Mac 字体环境和默认 PNG/raster-PDF 路径；矢量 PDF、其他查看器、硬件与竞品同任务对照仍需独立证据。

相同 Apple M5 Pro、132 × 36 视口的长文呈现对照见 [TERMINAL_WORKSPACE](TERMINAL_WORKSPACE.md#verification-and-evidence)：英文 270,000 UTF-16 单元的热导航加完整帧 p50 为 297.022 → 1.678 ms，混合 Unicode 252,000 单元为 209.396 → 1.038 ms，各 24 样本。冷排版单独计量。原始 `tui-baseline.json` / `tui-after.json` 支持此次实现前后比较；它们不涉及 MarginNote 或 XMind 的实机性能。

## 平台、视觉与外部客户端范围

Node 声明 `>=22.13.0` 不等于所有版本都验收。最低 Node、其他 LTS、macOS x64、Windows x64、Linux x64 保持未测，直到有相应实际报告；没有 OS 网络隔离实现的平台，offline gate 为 blocked。容器中的纯逻辑试验或单个依赖能够加载，不升级为该平台完整安装验收。

PDF 原页像素、扫描件 OCR、语音/词典可选依赖、手写压感和掌触、多显示器、真实大书长期压力、实际断电与外置盘失联、各 Office/XMind 版本互操作均不能从基本 CLI 闭环推出。默认系统字体与终端图像协议依赖各平台；纯终端文本复习无法忠实显示的图像遮挡题，不允许据此评分。用户设备与可访问性验收也不能由 PTY 自动化替代。

与商业产品的比较采用 [COMPETITIVE_GAPS](COMPETITIVE_GAPS.md) 的官方版本基线；尚无同机、同资料、同任务、相同熟练程度的竞品 A/B 操作记录。网络研究、AI、云同步与备份不作为本轮阅读/整理/复习的改进指标。

## 历史测试隔离与宿主阻塞

`scripts/release-checks.cjs` 在临时源码副本中运行 check、全部 `.test.cjs` 和可选兼容构建，复用项目自己的只读依赖并使用临时 HOME。历史 `test:acceptance` 扫描 Downloads、`test:pdf-modes` 默认读用户文库，均不运行；网络 live 与大型备份基准列为范围外。范围外 `notRun` 与 required gate 的 blocked 分开记录。

未修改的 host-smoke / employee-host / read-map-native-ui 从项目 `../..` 解析旧 Toolbox 宿主，依赖 `bin/agents`、`test/fixtures/headless-core.mjs`、`node_modules/@playwright/test`、`node_modules/electron`。预检把实际缺失路径写入机器报告。即便路径存在，也必须完成旧协议夹具安全检查与真实运行，不能只凭文件存在标记通过。

当前 `test:agent-acceptance` 与 `test:deep-audit` 整套仍是 **required legacy blocked**。这既不代表套内所有独立用例失败，也不允许记整套通过。迁移后的宿主 PLUGIN_SPEC 并非原协议；独立 CLI 的产品范围选择不能消除历史阻塞，不恢复其他应用或调用模型宿主来冒充缺失的验收。
