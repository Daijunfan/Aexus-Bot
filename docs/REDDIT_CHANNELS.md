# Reddit 频道

Reddit 与其他资讯平台共用订阅管理、来源筛选、按原始时间排列的 Channel、Board、Posts、收藏、个人表情与 Secretary CLI。采集实现在独立项目 `Daijunfan/xhs_publisher`，Bot 保留客户端和认证 API。

## 200 个精选社区

本次选择以技术深度、学术/专业讨论、来源线索、社区规则和主题互补为标准，优先长期运作的专业社区，覆盖科技科研之外的产品、商业、健康与人文。它是针对私人情报团队的编辑选集，不是 Reddit 官方排名，也不保证社区里的每一条帖子都可靠。没有为了凑数添加未经核验的作者账号。

200 个社区均核对了自身 About 页面；其中只限制发帖资格的社区仍允许公开阅读。公共主页可读不代表服务端 RSS 已采集成功。完整可复用清单见 [reddit-200.json](subscriptions/reddit-200.json)。

## 实际采集范围

- 接收社区或公开用户主页，使用可访问的 Atom 订阅。社区读取新帖，用户读取公开提交的帖子；不伪造完整评论树、投票数量、会员数或登录能力。
- 保留原作者、帖子链接、原始发布时间、公开正文与可取得的 Reddit 图片；链接帖仍保留外部原文线索。内容按稳定帖子 ID 和正文指纹去重，更新不改原发布时间。
- 默认来源周期 30 分钟，平台请求间隔至少 15 秒，首次启动错峰；遇到 429，所有同一 Reddit 采集实例的来源共同冷却 15 分钟，并由原调度器继续退避。200 个来源的首轮覆盖是渐进过程，不承诺同时完成。
- 403、限流、无效响应或媒体失败保留真实错误；不切换 IP、伪装浏览器、自动重放登录或绕过挑战。

Reddit 已公告调整 RSS/API 支持，参见 [官方 2026-11-10 更新](https://support.reddithelp.com/hc/en-us/articles/55472297340308-Changelog-November-10-2026) 和 [Data API 说明](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)。本次实际请求仍取得部分最新 Atom 原文，同时批量请求遇到 429。因此，配置同步回执与每个来源的实际采集状态分别验收；未来接口不再可用时明确保留失败，不能把“已订阅”显示成“已抓取”。

## 管理

```sh
agents channel source-add --data '{"plugin":"reddit","locator":"r/MachineLearning","name":"r/MachineLearning"}'
agents channel sources --plugin reddit --json
agents channel source-update SOURCE_ID --patch '{"enabled":false}'
agents channel source-remove SOURCE_ID
agents channel subscription-status --json
```

用户与 Secretary 使用相同入口；普通员工只读获授权频道。停用来源禁止迟到发布，恢复保持原身份和收藏。订阅确认由服务端应用实际调度配置后返回，不只是客户端保存成功。

## 主题分布

- 人工智能与数据：19
- 软件开发：30
- 系统与基础设施：22
- 基础科学与研究：30
- 工程与技术前沿：20
- 产品与设计：17
- 经济金融与商业：17
- 健康与运动科学：14
- 人文与社会：15
- 研究工具与方法：14
- 前沿资讯与深度讨论：2

## 社区目录

### 人工智能与数据

| 社区 | 选择依据 |
| --- | --- |
| [r/MachineLearning](https://www.reddit.com/r/MachineLearning/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/artificial](https://www.reddit.com/r/artificial/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/deeplearning](https://www.reddit.com/r/deeplearning/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/LanguageTechnology](https://www.reddit.com/r/LanguageTechnology/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/computervision](https://www.reddit.com/r/computervision/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/reinforcementlearning](https://www.reddit.com/r/reinforcementlearning/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/datascience](https://www.reddit.com/r/datascience/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/dataengineering](https://www.reddit.com/r/dataengineering/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/statistics](https://www.reddit.com/r/statistics/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/AskStatistics](https://www.reddit.com/r/AskStatistics/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/rstats](https://www.reddit.com/r/rstats/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/Julia](https://www.reddit.com/r/Julia/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/MLOps](https://www.reddit.com/r/MLOps/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/RAG](https://www.reddit.com/r/RAG/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/LLMDevs](https://www.reddit.com/r/LLMDevs/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/ollama](https://www.reddit.com/r/ollama/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/ComfyUI](https://www.reddit.com/r/ComfyUI/about/) | 研究论文、开源模型、工程实践与可复现经验 |
| [r/huggingface](https://www.reddit.com/r/huggingface/about/) | 研究论文、开源模型、工程实践与可复现经验 |

### 软件开发

| 社区 | 选择依据 |
| --- | --- |
| [r/programming](https://www.reddit.com/r/programming/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/compsci](https://www.reddit.com/r/compsci/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/ExperiencedDevs](https://www.reddit.com/r/ExperiencedDevs/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/softwarearchitecture](https://www.reddit.com/r/softwarearchitecture/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/ProgrammingLanguages](https://www.reddit.com/r/ProgrammingLanguages/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/Rust](https://www.reddit.com/r/Rust/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/Python](https://www.reddit.com/r/Python/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/golang](https://www.reddit.com/r/golang/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/cpp](https://www.reddit.com/r/cpp/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/C_Programming](https://www.reddit.com/r/C_Programming/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/java](https://www.reddit.com/r/java/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/javascript](https://www.reddit.com/r/javascript/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/typescript](https://www.reddit.com/r/typescript/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/kotlin](https://www.reddit.com/r/kotlin/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/swift](https://www.reddit.com/r/swift/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/csharp](https://www.reddit.com/r/csharp/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/dotnet](https://www.reddit.com/r/dotnet/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/elixir](https://www.reddit.com/r/elixir/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/erlang](https://www.reddit.com/r/erlang/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/haskell](https://www.reddit.com/r/haskell/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/scala](https://www.reddit.com/r/scala/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/ocaml](https://www.reddit.com/r/ocaml/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/lisp](https://www.reddit.com/r/lisp/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/clojure](https://www.reddit.com/r/clojure/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/Zig](https://www.reddit.com/r/Zig/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/SQL](https://www.reddit.com/r/SQL/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/PostgreSQL](https://www.reddit.com/r/PostgreSQL/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/SQLite](https://www.reddit.com/r/SQLite/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/webdev](https://www.reddit.com/r/webdev/about/) | 语言生态、架构权衡、工程经验与工具发布 |
| [r/reactjs](https://www.reddit.com/r/reactjs/about/) | React 工程实践、生态更新与复杂前端设计 |

### 系统与基础设施

| 社区 | 选择依据 |
| --- | --- |
| [r/linux](https://www.reddit.com/r/linux/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/linuxadmin](https://www.reddit.com/r/linuxadmin/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/linuxquestions](https://www.reddit.com/r/linuxquestions/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/sysadmin](https://www.reddit.com/r/sysadmin/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/devops](https://www.reddit.com/r/devops/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/sre](https://www.reddit.com/r/sre/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/kubernetes](https://www.reddit.com/r/kubernetes/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/docker](https://www.reddit.com/r/docker/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/selfhosted](https://www.reddit.com/r/selfhosted/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/homelab](https://www.reddit.com/r/homelab/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/networking](https://www.reddit.com/r/networking/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/netsec](https://www.reddit.com/r/netsec/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/cybersecurity](https://www.reddit.com/r/cybersecurity/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/security](https://www.reddit.com/r/security/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/reverseengineering](https://www.reddit.com/r/reverseengineering/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/AskNetsec](https://www.reddit.com/r/AskNetsec/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/embedded](https://www.reddit.com/r/embedded/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/RISCV](https://www.reddit.com/r/RISCV/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/opensource](https://www.reddit.com/r/opensource/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/commandline](https://www.reddit.com/r/commandline/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/bash](https://www.reddit.com/r/bash/about/) | 操作系统、运维、云计算、可靠性与自托管实践 |
| [r/firefox](https://www.reddit.com/r/firefox/about/) | 浏览器平台、开放网络与隐私保护实践 |

### 基础科学与研究

| 社区 | 选择依据 |
| --- | --- |
| [r/science](https://www.reddit.com/r/science/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/askscience](https://www.reddit.com/r/askscience/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/AskScienceDiscussion](https://www.reddit.com/r/AskScienceDiscussion/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/Physics](https://www.reddit.com/r/Physics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/AskPhysics](https://www.reddit.com/r/AskPhysics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/math](https://www.reddit.com/r/math/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/mathematics](https://www.reddit.com/r/mathematics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/chemistry](https://www.reddit.com/r/chemistry/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/biology](https://www.reddit.com/r/biology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/neuroscience](https://www.reddit.com/r/neuroscience/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/CognitiveScience](https://www.reddit.com/r/CognitiveScience/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/genetics](https://www.reddit.com/r/genetics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/bioinformatics](https://www.reddit.com/r/bioinformatics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/microbiology](https://www.reddit.com/r/microbiology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/Biochemistry](https://www.reddit.com/r/Biochemistry/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/QuantumComputing](https://www.reddit.com/r/QuantumComputing/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/space](https://www.reddit.com/r/space/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/astronomy](https://www.reddit.com/r/astronomy/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/astrophysics](https://www.reddit.com/r/astrophysics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/cosmology](https://www.reddit.com/r/cosmology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/geology](https://www.reddit.com/r/geology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/oceanography](https://www.reddit.com/r/oceanography/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/ecology](https://www.reddit.com/r/ecology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/Evolution](https://www.reddit.com/r/Evolution/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/paleontology](https://www.reddit.com/r/paleontology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/anthropology](https://www.reddit.com/r/anthropology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/Archaeology](https://www.reddit.com/r/Archaeology/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/linguistics](https://www.reddit.com/r/linguistics/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/academia](https://www.reddit.com/r/academia/about/) | 研究成果、专家问答、证据与科学方法 |
| [r/climate](https://www.reddit.com/r/climate/about/) | 气候研究、能源转型与科学证据；社区规则拒绝科学否认和阴谋论 |

### 工程与技术前沿

| 社区 | 选择依据 |
| --- | --- |
| [r/engineering](https://www.reddit.com/r/engineering/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/AskEngineers](https://www.reddit.com/r/AskEngineers/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/MechanicalEngineering](https://www.reddit.com/r/MechanicalEngineering/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/ElectricalEngineering](https://www.reddit.com/r/ElectricalEngineering/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/ECE](https://www.reddit.com/r/ECE/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/robotics](https://www.reddit.com/r/robotics/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/ControlTheory](https://www.reddit.com/r/ControlTheory/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/aerospace](https://www.reddit.com/r/aerospace/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/CivilEngineering](https://www.reddit.com/r/CivilEngineering/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/ChemicalEngineering](https://www.reddit.com/r/ChemicalEngineering/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/materials](https://www.reddit.com/r/materials/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/batteries](https://www.reddit.com/r/batteries/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/energy](https://www.reddit.com/r/energy/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/renewableenergy](https://www.reddit.com/r/renewableenergy/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/solar](https://www.reddit.com/r/solar/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/nuclear](https://www.reddit.com/r/nuclear/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/fusion](https://www.reddit.com/r/fusion/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/semiconductors](https://www.reddit.com/r/semiconductors/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/FPGA](https://www.reddit.com/r/FPGA/about/) | 硬件设计、机器人、制造与能源工程 |
| [r/chipdesign](https://www.reddit.com/r/chipdesign/about/) | 硬件设计、机器人、制造与能源工程 |

### 产品与设计

| 社区 | 选择依据 |
| --- | --- |
| [r/ProductManagement](https://www.reddit.com/r/ProductManagement/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/userexperience](https://www.reddit.com/r/userexperience/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/UXResearch](https://www.reddit.com/r/UXResearch/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/UXDesign](https://www.reddit.com/r/UXDesign/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/UI_Design](https://www.reddit.com/r/UI_Design/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/web_design](https://www.reddit.com/r/web_design/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/design](https://www.reddit.com/r/design/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/DesignSystems](https://www.reddit.com/r/DesignSystems/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/accessibility](https://www.reddit.com/r/accessibility/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/SaaS](https://www.reddit.com/r/SaaS/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/startups](https://www.reddit.com/r/startups/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/Entrepreneur](https://www.reddit.com/r/Entrepreneur/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/smallbusiness](https://www.reddit.com/r/smallbusiness/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/marketing](https://www.reddit.com/r/marketing/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/SEO](https://www.reddit.com/r/SEO/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/analytics](https://www.reddit.com/r/analytics/about/) | 用户研究、产品决策、交互与设计系统 |
| [r/BusinessIntelligence](https://www.reddit.com/r/BusinessIntelligence/about/) | 用户研究、产品决策、交互与设计系统 |

### 经济金融与商业

| 社区 | 选择依据 |
| --- | --- |
| [r/Economics](https://www.reddit.com/r/Economics/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/AskEconomics](https://www.reddit.com/r/AskEconomics/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/finance](https://www.reddit.com/r/finance/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/FinancialCareers](https://www.reddit.com/r/FinancialCareers/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/investing](https://www.reddit.com/r/investing/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/SecurityAnalysis](https://www.reddit.com/r/SecurityAnalysis/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/ValueInvesting](https://www.reddit.com/r/ValueInvesting/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/Bogleheads](https://www.reddit.com/r/Bogleheads/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/personalfinance](https://www.reddit.com/r/personalfinance/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/financialindependence](https://www.reddit.com/r/financialindependence/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/FinancialPlanning](https://www.reddit.com/r/FinancialPlanning/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/CFA](https://www.reddit.com/r/CFA/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/Accounting](https://www.reddit.com/r/Accounting/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/econometrics](https://www.reddit.com/r/econometrics/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/supplychain](https://www.reddit.com/r/supplychain/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/logistics](https://www.reddit.com/r/logistics/about/) | 宏观解释、长期投资、公司分析与财务知识 |
| [r/business](https://www.reddit.com/r/business/about/) | 宏观解释、长期投资、公司分析与财务知识 |

### 健康与运动科学

| 社区 | 选择依据 |
| --- | --- |
| [r/Fitness](https://www.reddit.com/r/Fitness/about/) | 运动训练、营养与公共卫生讨论 |
| [r/AdvancedFitness](https://www.reddit.com/r/AdvancedFitness/about/) | 运动训练、营养与公共卫生讨论 |
| [r/weightroom](https://www.reddit.com/r/weightroom/about/) | 运动训练、营养与公共卫生讨论 |
| [r/bodyweightfitness](https://www.reddit.com/r/bodyweightfitness/about/) | 运动训练、营养与公共卫生讨论 |
| [r/running](https://www.reddit.com/r/running/about/) | 运动训练、营养与公共卫生讨论 |
| [r/AdvancedRunning](https://www.reddit.com/r/AdvancedRunning/about/) | 运动训练、营养与公共卫生讨论 |
| [r/swimming](https://www.reddit.com/r/swimming/about/) | 运动训练、营养与公共卫生讨论 |
| [r/cycling](https://www.reddit.com/r/cycling/about/) | 运动训练、营养与公共卫生讨论 |
| [r/nutrition](https://www.reddit.com/r/nutrition/about/) | 运动训练、营养与公共卫生讨论 |
| [r/ScientificNutrition](https://www.reddit.com/r/ScientificNutrition/about/) | 运动训练、营养与公共卫生讨论 |
| [r/PublicHealth](https://www.reddit.com/r/PublicHealth/about/) | 运动训练、营养与公共卫生讨论 |
| [r/epidemiology](https://www.reddit.com/r/epidemiology/about/) | 运动训练、营养与公共卫生讨论 |
| [r/medicine](https://www.reddit.com/r/medicine/about/) | 运动训练、营养与公共卫生讨论 |
| [r/sleep](https://www.reddit.com/r/sleep/about/) | 运动训练、营养与公共卫生讨论 |

### 人文与社会

| 社区 | 选择依据 |
| --- | --- |
| [r/AskHistorians](https://www.reddit.com/r/AskHistorians/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/history](https://www.reddit.com/r/history/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/AskPhilosophy](https://www.reddit.com/r/AskPhilosophy/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/philosophy](https://www.reddit.com/r/philosophy/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/sociology](https://www.reddit.com/r/sociology/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/AskSocialScience](https://www.reddit.com/r/AskSocialScience/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/politicalscience](https://www.reddit.com/r/politicalscience/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/IRstudies](https://www.reddit.com/r/IRstudies/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/geopolitics](https://www.reddit.com/r/geopolitics/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/NeutralPolitics](https://www.reddit.com/r/NeutralPolitics/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/NeutralNews](https://www.reddit.com/r/NeutralNews/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/education](https://www.reddit.com/r/education/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/HigherEducation](https://www.reddit.com/r/HigherEducation/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/urbanplanning](https://www.reddit.com/r/urbanplanning/about/) | 严肃历史、哲学、社会学与公共政策问答 |
| [r/transit](https://www.reddit.com/r/transit/about/) | 严肃历史、哲学、社会学与公共政策问答 |

### 研究工具与方法

| 社区 | 选择依据 |
| --- | --- |
| [r/ObsidianMD](https://www.reddit.com/r/ObsidianMD/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/Zotero](https://www.reddit.com/r/Zotero/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/LaTeX](https://www.reddit.com/r/LaTeX/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/Notion](https://www.reddit.com/r/Notion/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/PKMS](https://www.reddit.com/r/PKMS/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/GIS](https://www.reddit.com/r/GIS/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/QGIS](https://www.reddit.com/r/QGIS/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/RemoteSensing](https://www.reddit.com/r/RemoteSensing/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/dataisbeautiful](https://www.reddit.com/r/dataisbeautiful/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/datasets](https://www.reddit.com/r/datasets/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/visualization](https://www.reddit.com/r/visualization/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/HPC](https://www.reddit.com/r/HPC/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/privacy](https://www.reddit.com/r/privacy/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |
| [r/cryptography](https://www.reddit.com/r/cryptography/about/) | 文献、知识管理、统计分析、开源工作流与隐私 |

### 前沿资讯与深度讨论

| 社区 | 选择依据 |
| --- | --- |
| [r/technology](https://www.reddit.com/r/technology/about/) | 科技产业、计算、航天与产业变化线索 |
| [r/hardware](https://www.reddit.com/r/hardware/about/) | 科技产业、计算、航天与产业变化线索 |

