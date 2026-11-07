# Cloud Hosts

Aexus Bot 的 CLI-first 云端工作台：主机管理与持久 SSH 终端。所有业务操作通过共享 `host.*` Core API，无需创建员工，也不需要 Electron 窗口即可从 CLI 使用。

- 概览：主机搜索、系统、认证、指纹与缓存连接状态；仅显式刷新触发 SSH 检查。
- 终端：xterm.js + 现有 SSH PTY，支持会话恢复、Ctrl+C、Unicode、窗口缩放。
- 权限、凭据和主机数据始终由宿主 Core 管理，不维护第二份数据库。

```sh
npm ci
npm run build:plugin -- --out /tmp/cloud-hosts-plugin
npm test
agents serve
node cli.cjs --workspace /existing/folder hosts.list
```

完整参数、远端前提和平台边界见 [API.md](API.md)。Windows/Linux Core 需分别进行原生平台验收。
