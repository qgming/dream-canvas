# 梦想画布 Codex 插件

保留的本机 Canvas Agent 插件源码，包含 stdio MCP 配置和打开、操作画布的 Skill。画布内的自定义节点扩展见[节点插件](../canvas/README.md)。

> 当前网页已移除本机 Canvas Agent 连接，以下旧插件流程与当前网页不互通。新 Go 业务服务已写入 `/mcp` Streamable HTTP 入口，登录网页后在「个人设置 → 远程 MCP 访问令牌」创建令牌并复制接入配置，无需此本机插件。当前提供项目、资产元数据、模型目录和删除确认，生成与页面选区操作尚未接入；完整进度见[后端化规划](../../CHANGELOG.md#已确认的后端化规划待实施)。

## 维护保留的本机插件源码

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

原流程在应用插件目录选择 `dream-canvas-local` 并安装 `dream-canvas`，以 `dream-canvas-agent mcp` 提供工具，配套 Skill 启动普通 Agent 并打开本地前端；当前网页已不支持该连接，应使用个人设置生成的新远程接入配置。

## 运行约定

- 默认打开本地前端，以 Vite 输出的地址为准。
- 仓库根目录的 `.agents/plugins/marketplace.json` 是唯一市场入口，指向本目录的 `.codex-plugin/plugin.json`。
- 插件标识为 `dream-canvas`，MCP 工具协议名保留 `infinite-canvas`。
- 本地 Agent 源码修改后需要重新构建；本插件清单或 Skill 修改后，需要刷新本地插件。
- 不使用时在应用中卸载插件；手动注册的 MCP 可用 `codex mcp remove infinite-canvas` 移除。
