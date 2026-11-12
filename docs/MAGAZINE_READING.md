# 外刊阅读与图文交付

用户可以要求员工阅读指定频道中的外刊、杂志或报告，下载到该员工在 Team 中分配的工作区，阅读相关页并总结，再将原页图片与解释发回私聊或群组。一本 PDF 可以产生一条完整的图文讲解，也可以按主题拆成多条消息。不会为入群成员创建另一套个人工作目录。

## 一条完整流程

1. 通过 `channel.fetch-text` / `channel.search` 找到已获阅读授权的来源与文章。
2. `conversation.entry {conversation:"channel:CHANNEL_ID",id:"POST_ID"}` 返回实际附件，以及各自的 download 调用参数。
3. 用附件返回的 ID 调用 `conversation.download`，提供稳定的 `clientRequestId`；省略目标时使用调用员工自己的 `workspace.catalog` Company 工作区。
4. 轮询 `conversation.download-status`，直到 completed；queued/running 不代表文件已经可用。外刊原件尚未取回时先显示 phase=server，随后 phase=transfer。取消只取消自己的副本，撤权后不继续复制。
5. 对返回的工作区相对路径调用 `workspace.pdf`。
6. 用 `direct.post` 回复用户；群内公开交付先 `conversation.upload` 图片，等上传完成后用返回的 publishedPath 调用 `chat.post`。

`local` 指 Core 主机。云端员工的副本保存在该员工已配置的远程工作区；解析由 Core 的 Reader Worker 完成，远程原件仅按请求暂存并在处理后清除；结果写回原工作区，不改变员工的原生执行主机或工作目录。下载验证原件的大小与 SHA-256，不覆盖既有文件；相同请求 ID 复用同一回执。

## PDF 接口

```sh
agents workspace pdf magazine.pdf --employee EMPLOYEE_ID --operation info
agents workspace pdf magazine.pdf --employee EMPLOYEE_ID --operation text --page 1 --limit 4
agents workspace pdf magazine.pdf --employee EMPLOYEE_ID --operation page --page 3
agents workspace pdf magazine.pdf --employee EMPLOYEE_ID --operation render --page 3 --to page-3.png
```

- `info`：页数、标题及 sourceVersion。
- `text`：从 page 开始返回分页文本、每页 textLayer 和 nextPage；按 nextPage 继续，不静默丢掉后续页。
- `page`：返回实际 PNG 和该页文本。MCP/Pi 等原生工具收到真实 image 内容块，文字元数据不会包含重复的 base64。没有文字层的扫描页应使用这个入口交给支持视觉的模型读取，不声称内置 OCR。
- `render`：将指定原页导出为工作区 PNG；默认文件名为原文件名-page-N.png，可指定 to。原件保持不变；同名相同内容直接复用，同名不同内容报冲突。子目录须先通过 workspace.mkdir 创建。

页码从 **1** 开始。width 控制导出清晰度，默认 1600；页面比例始终保留。expectedVersion 可绑定 info 返回的 sourceVersion。需要密码的 PDF 可在单次请求提供 password，不保存密码。处理复用已安装的 Margin Reader 渲染器，不会注册到用户书库或改变阅读位置。原件处理上限 512 MiB；超出、加密或损坏会明确报错。PDF 处理在受限并发的独立 Worker 中执行。

## 在同一条消息中交替排列文字与图片

沿用现有 text/images 字段，images 保持附件顺序。正文使用 `attachment:1`、`attachment:2` 引用去重后第 1、2 张图片，同一编号可重复引用；这些只是已发布附件的编号，不能访问未授权路径。原来的“正文 + 底部相册”消息继续可用；未在正文引用的图片仍显示在相册中。

```json
{
  "text": "## 本期重点\n先看第 3 页的论点。\n\n![原刊第 3 页](attachment:1)\n\n这里解释图表与正文的关系。\n\n![原刊第 5 页](attachment:2)\n\n最后是要点与需要继续核实的问题。",
  "images": ["page-3.png", "page-5.png"],
  "clientMessageId": "magazine-reading-brief-1"
}
```

将上例参数传给 `direct.post`；群聊将 images 换成已完成上传的群共享路径，并补充 id。要拆成多条消息，每条使用不同 clientMessageId；同一内容的不确定重试复用原 ID。

消息发布、草稿和转发不再有固定的 16 张图片/附件数量限制。文件大小、请求体、模型及外部服务仍遵守各自的实际资源边界。图像按可见区域读取，单条长图文不一次性加载全部像素。转发多条图文时重新映射附件编号；纯文本转发保留图片说明。私聊、群聊、讨论串和图片查看器继续使用当前会话的权限与历史。
