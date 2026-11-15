# 产品截图与资料来源

首页三张图片来自 **Aexus Bot 0.58.1** 的实际桌面界面，拍摄于 2026-11-15。使用同一紫色主题与独立示例工作区，按阅读、协作、持续跟进的顺序展示产品。

| 图片 | 内容 | 尺寸 | 文件大小 |
| --- | --- | --- | --- |
| `magazine-reading.png` | Message：报告图像摘录与中文讲解交替呈现在同一条消息中，附完整报告与原页 | 3200 × 2800 | 1.87 MB |
| `team-board.png` | Team：阅读助理与证据复核成员的并行工作会话 | 3520 × 2080 | 0.52 MB |
| `mission-calendar.png` | Mission：四项周计划在月历中的排期 | 3200 × 2240 | 0.50 MB |

发布截图采用无损 PNG 优化，优化前后的 RGB 像素一致。

## 阅读示例

展示资料为 NASA 出版的 **[Earth at Night](https://www.nasa.gov/ebooks/earth-at-night/)**，对应书中第 5、13 页，即 [官方 PDF](https://www.nasa.gov/wp-content/uploads/2019/11/earth_at_night_508.pdf) 的第 21、29 页。

- PDF：200 页，40,758,835 字节。
- 原始 PDF SHA-256：`8e622ca8f6d1ba0cf809549bddfee69e6754c3a3480d151c1fb54baf49b09be0`。
- 图像署名：NASA；夜间地球观测资料来自 NASA Earth Observatory、NOAA 与 DOD。
- 书中 Acknowledgments（第 xiv 页）说明本书材料属于公有领域。资料使用依据见 [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)。

拍摄流程执行了员工身份下的 `workspace.pdf`：提取指定两页正文，再将两页分别渲染为 1800 × 1980 PNG。用普通图像处理忠实裁取两页中的相关图像区域，消息正文标明“图像摘录”及来源页码；完整 PDF 和完整原页同时作为文件附上。随后通过 `direct.post` 将“讲解、图像摘录、讲解、图像摘录”发送为一条消息，逐一确认两幅图片与中间讲解在同一屏完整可见。

截图中的中文说明根据对应原页编排。图像摘录保留原始像素，未补画、修饰或重新采样。

### 图像摘录记录

坐标为完整 1800 × 1980 原页图中的像素矩形 `[左, 上, 右, 下]`。

| PDF 页码 | 原书页码 | 裁切坐标 | 摘录尺寸 |
| --- | --- | --- | --- |
| 21 | 5 | `[92, 52, 1628, 565]` | 1536 × 513 |
| 29 | 13 | `[150, 968, 1570, 1682]` | 1420 × 714 |

| 文件 | SHA-256 |
| --- | --- |
| 完整 PDF 第 21 页 PNG | `0b6d642654eb87082077cf6cff4bad629363fe7bbda853f9f70b81cedd3cef6f` |
| 第 21 页图像摘录 PNG | `4bac02bc2a68c5bde8169a427103836102f8364a0cae931e50d2765aa4d82666` |
| 完整 PDF 第 29 页 PNG | `8cfda0dc8046fe6f1680e31564defc616e253ac0d2b0b956c7c79d75a38d3d5c` |
| 第 29 页图像摘录 PNG | `398d4f225774db7786608f89ea0ec4777635fa446342b1583c8af417be5b324e` |

## 运行记录

截图运行基线为提交 `d0c4104`。数据目录、工作区、HOME 和原生引擎配置位于独立临时环境；界面使用隐藏窗口拍摄。成员会话通过本地确定性协议样例提供，模型付费调用次数为零。日历展示未来排期，拍摄结束时计划执行记录为零。

| 发布文件 | SHA-256 |
| --- | --- |
| `magazine-reading.png` | `0c39a56efd14f6ad4dca06230f745e86537508a5b6c8a9e550c0267827f7e5b7` |
| `team-board.png` | `afba180e47f605fccb1e9bf97b69f8f733e74925f1a1d228f9d767a1f0283d19` |
| `mission-calendar.png` | `fb756bd04a869e35d6a049731a7212b964404458e3db26aa728ca0fc8b8baa0d` |
