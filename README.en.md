# Aexus Bot · Your Private AI Intelligence Team

[简体中文](README.md) · [English](README.en.md)

**Information access, for everyone.**

Follow the world's information. Let your AI team read, discuss, check the evidence, and keep delivering the results you care about.

Aexus Bot brings information channels, documents, multiple Agents, and persistent tasks into one workspace. Use **Message** to gather information and delegate work, **Team** to organize members and follow progress, and **Mission** to schedule ongoing attention and deliveries.

[Get started](#getting-started) · [Deployment](docs/DEPLOYMENT.md) · [CLI / API](API.md)

## Let your team help you read the foreign press

Choose a magazine, report, or long document and ask a member to download it into their workspace. Specify the questions, articles, or pages that matter, and let the team read with your interests in mind.

![Aexus Bot report reading: image excerpts and explanations alternate within one message](docs/images/magazine-reading.png)

<p align="center"><sub>Report image excerpts and explanations alternate within one message, with the complete source attached.</sub></p>

> Read the articles about the AI industry in this issue. Explain each topic, place the original page images alongside the explanation, and finish with questions worth following. Send it as one illustrated message.

Members can export selected PDF pages as images and alternate **text, image, text, image within a single message**, or split the material into several messages by topic. Preview, zoom, and download images while reading at your own pace.

The workflow connects private conversations, groups, and threads, with the same APIs for local and cloud workspaces. [Explore the reading workflow](docs/MAGAZINE_READING.md).

## From information worth following to work worth doing

| What you want to accomplish | How the team works |
| --- | --- |
| Follow an industry, technology, or topic | Subscribe to sources, divide reading by subject, and prepare briefings with original references. |
| Understand papers, reports, and long documents | Read the material, identify key points, and explain arguments alongside original pages and charts. |
| Compare different judgments | Ask members to analyze independently, review the evidence, and discuss the same material together. |
| Receive a useful daily briefing | Choose the timing, assignees, and format while building a record of reading and delivery. |
| Turn findings into follow-up work | Save your decisions, assign tasks, and follow results through reminders and supervision. |

You arrange the sources, documents, workspaces, and responsibilities. Information work that once required several people can become part of your daily routine.

## Three views connect reading, collaboration, and delivery

### Message · The center of information and discussion

Keep information channels, private conversations, and groups together. When something deserves attention, continue with a question, a discussion, or a task.

- **Information channels:** gather content from Telegram, X, YouTube, Zhihu, and LinkedIn; filter by source, keywords, and time. Members can read and search through the same APIs.
- **Rich conversations:** use illustrated messages, quotes, threads, polls, and collaborative checklists to discuss, add context, and bring findings together.
- **Shared material:** preview images and documents, read PDFs in Margin Reader, edit and manage files, and return to the related conversation.

External Workers such as Dot and Grok retain their native identities and histories. Manage Bots, native groups, members, and runtime configuration in Message through the same operations used by the CLI. After installing and signing in to the official apps on macOS, Aexus Bot connects their local execution channels so desktop and Web conversations can use your Mac. [Native Bot integration](docs/BOT_WORKERS.md) · [The Message workspace](docs/MESSAGE_EXPERIENCE.md).

### Team · Organize your intelligence members

Assign responsibilities such as source monitoring, document reading, topic analysis, independent review, and briefing preparation. A Secretary coordinates work, and you can open a member's workbench to follow actual progress.

Role-based employees and native **Workers** share one concurrent work board, with unified search, categories, and progress tracking. Conversations, files, terminals, tool calls, approvals, and queues live in each member's workbench. Workers use independent native sessions and retain clean native context.

Connect **Codex, Claude Agent, Cline, Pi, OpenCode, Kilo Code, DeepSeek Harness, and Google Antigravity**. Choose your models and native configuration, then arrange execution locally or in registered remote environments. [Explore engine capabilities](ENGINE_CAPABILITIES.md).

![Aexus Bot Team: independent member workbenches and conversations side by side](docs/images/team-board.png)

### Mission · Keep important work moving

Organize one-time, recurring, event-triggered, and persistent goals in calendars, boards, lists, and timelines. Save filters and views around the subjects you follow.

![Aexus Bot Mission: a weekly calendar of scheduled topics and deliveries](docs/images/mission-calendar.png)

Choose Secretary supervision or independent member execution. Reminders, run records, and deliverables stay connected, and persistent goals end with explicit confirmation of success.

Decisions stay in the conversation: define the choices, use **Other** to write your own answer, and select a timeout decision or continued waiting. Handle other messages and return when you are ready to decide. [Persistent goals and user decisions](docs/MISSIONS_AND_QUESTIONS.md).

## Connect your documents, tools, and workspaces

Bind workspaces to local directories or registered cloud hosts. Members use their assigned workspace, groups organize shared material, and files and native sessions retain stable identities across upgrades.

| Plugin | What it brings |
| --- | --- |
| **Margin Reader** | Read PDFs and documents, collect excerpts, and organize references. |
| **MiniNotion** | Organize notes, databases, and knowledge. |
| **Cloud Hosts** | Manage remote hosts, connections, and terminals. |

Grant members read, modify, or create access to specific content. Desktop, browser, CLI / API, and native member tools share one Core, so the same work can continue through different interfaces.

Information collection and server storage are maintained in the separate [xhs_publisher](https://github.com/Daijunfan/xhs_publisher) project. Subscription management and reading come together in Aexus Bot. [Information channels](docs/CHANNELS.md) · [Workspaces and files](docs/FILES_WORKBENCH.md) · [Permissions](PERMISSIONS.md).

## Getting started

1. Start the desktop application or connect to your Core Web backend.
2. Choose an engine in Settings, then configure and authenticate your models.
3. Create a team, bind its workspace, and assign responsibilities.
4. Connect information sources, provide documents, or ask a specific question.
5. Discuss in Message, follow progress in Team, and arrange ongoing deliveries through Mission.

[Explore deployment options](docs/DEPLOYMENT.md): macOS / Windows desktop, or Linux Core / Web with a browser.

<details>
<summary>Run from source, package, and deploy</summary>

Use Node.js **22.18+** (**22.19+** for Pi) and npm. SSH workflows also require Python and OpenSSH.

```sh
git clone https://github.com/Daijunfan/Aexus-Bot.git
cd Aexus-Bot
npm ci
npm run setup
npm run build:plugins
npm run build
npm run dev
```

macOS packaging and installation:

```sh
python3 build.py
npm run install:mac -- --source 'release/mac-arm64/Aexus Bot.app'
```

Browser backend:

```sh
npm run build:server
npm run build:web
node bin/agents serve --web --port 5151
```

Run `node bin/agents web token` in another terminal, then sign in at `http://127.0.0.1:5151`. See [deployment](docs/DEPLOYMENT.md) for remote connections and service configuration.

</details>

## Explore further

- [Deployment](docs/DEPLOYMENT.md) · [CLI / API](API.md) · [Architecture](ARCHITECTURE.md)
- [Reading the foreign press](docs/MAGAZINE_READING.md) · [Group collaboration](docs/GROUP_COLLABORATION.md) · [Information channels](docs/CHANNELS.md)
- [Engine capabilities](ENGINE_CAPABILITIES.md) · [Plugin development](PLUGIN_SPEC.md) · [Contributing](CONTRIBUTING.md)
- [Permissions](PERMISSIONS.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

Project code is licensed under **GNU GPL v3**. [LICENSE](LICENSE) · [Licensing details](LICENSING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md).
