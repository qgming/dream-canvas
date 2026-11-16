# 梦想画布 Codex 插件

让 Codex 通过本仓库的 Canvas Agent 读取和操作画布，包含 MCP 配置和打开、操作画布的 Skill。画布内的自定义节点扩展见[节点插件](../canvas/README.md)。

## 准备本地 Agent

安装 Node.js 与 npm，在仓库中执行：

```bash
cd canvas-agent
npm install
npm run build
npm link --ignore-scripts
```

这会将 `dream-canvas-agent` 链接到本地源码，不从 npm 下载其他项目的 Agent。确保启动 Codex 的环境能够找到该命令；首次链接后可重新打开应用。

## 安装到 Codex

从仓库根目录添加本地 marketplace。PowerShell：

```powershell
codex plugin marketplace add "$PWD"
```

macOS / Linux：

```bash
codex plugin marketplace add "$(pwd)"
```

在应用插件目录中选择 `dream-canvas-local`，安装 `dream-canvas`，然后新建对话并输入“打开梦想画布”。插件使用 `dream-canvas-agent mcp` 提供工具，配套 Skill 启动普通 Agent 并打开本地前端。

## 运行约定

- 默认打开本地前端，以 Vite 输出的地址为准。
- 仓库根目录的 `.agents/plugins/marketplace.json` 是唯一市场入口，指向本目录的 `.codex-plugin/plugin.json`。
- 插件标识为 `dream-canvas`，MCP 工具协议名保留 `infinite-canvas`。
- 本地 Agent 源码修改后需要重新构建；本插件清单或 Skill 修改后，需要刷新本地插件。
- 不使用时在应用中卸载插件；手动注册的 MCP 可用 `codex mcp remove infinite-canvas` 移除。
