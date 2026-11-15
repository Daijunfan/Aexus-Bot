# 知乎与 LinkedIn 信息频道

两个平台与 Telegram、X、YouTube 使用相同的订阅、采集回执、频道阅读授权、收藏、原文查看和 Secretary CLI。采集实现位于独立的 `Daijunfan/xhs_publisher` 项目；本仓库不重新嵌入爬虫。

## 知乎

公开路径读取知乎日报的精选原文、作者署名、图片及有实质内容的公开评论，并保留对应知乎原文链接。选刊日期按天记录为**精选日期**；原回答的创建时间不能由此推断。评论使用自身的原生发布时间，保留讨论原题和可用的回复上下文。

这是公开精选覆盖，不能冒充所列作者的全部动态。作者主页可以登记为候选，但完整作者内容需要另行验证授权接口；当前采集端会明确报告访问要求，不绕过 403 或登录限制，不把采集说明当作平台文章发布。

作者候选依据近期公开精选及原文署名筛选，排除栏目期号、重复署名和匿名占位。候选条目保留原文证据；头像和署名不能替代已核验的账号 ID。不自动把缺少主页核验的候选当作已成功关注的完整信息源。

## LinkedIn

优先收录持续发布原创研究、数据和方法论的公开账号，覆盖 AI、科学、经济金融、产品管理和健康研究。使用公开页面的结构化原帖、明确的 `datePublished`、作者与原帖 URL；不把发现时间充当发布时间，不收集非公开会员数据。

默认每两小时读取最多十条公开原帖，过滤其他作者的转载、招聘、抽奖和报名推广。按正文与媒体指纹增量处理。HTTP 401/403/999 保留为访问受限，429 退避，不切换 IP 或伪装浏览器来规避限制。来源数量、订阅已应用和实际内容采集是三个独立事实。

## 管理与 CLI

```sh
agents channel source-add --data '{"plugin":"zhihu","locator":"https://daily.zhihu.com/","name":"知乎公开精选"}'
agents channel source-add --data '{"plugin":"linkedin","locator":"https://www.linkedin.com/company/ourworldindata","name":"Our World in Data"}'
agents channel sources --plugin zhihu --include-disabled --json
agents channel sources --plugin linkedin --json
agents channel source-update SOURCE_ID --patch '{"enabled":false}'
agents channel subscription-status --json
```

用户和 Secretary 使用同一 Core 授权入口；普通员工只读取获授权频道。关闭订阅保留原文和收藏，恢复保持原 source/target ID。采集服务应用实际调度快照后才确认 revision，收到快照不等于已完成采集。

五个平台使用同一服务端存储与独立容量记账，不预分配磁盘。新增来源不修改现有 Telegram、X、YouTube 凭据、单独的 Frontier YAML、阅读状态或工作区。
