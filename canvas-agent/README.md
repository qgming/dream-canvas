# 梦想画布 Agent

连接梦想画布网页与本机 Codex，通过 MCP 读取和操作画布，并提供对话、历史、附件、审批与 Skill 管理。网页侧边栏目前只开放 Codex，源码保留 Claude Code Adapter。

## 本地启动

在仓库内安装本项目依赖并启动：

```bash
cd canvas-agent
npm install
npm run dev
```

排查问题时使用 `npm run debug`。前端需要在另一个终端从 `web/` 启动。

默认监听 `http://127.0.0.1:17371`，终端会输出 `Local URL` 和 `Connect token`，在网页 Agent 面板填写后连接。配置与消息元数据保存在 `~/.infinite-canvas/`，Debug 日志位于该目录的 `logs/`。此目录是既有数据位置，项目名称调整不会移动或清理它。

首次携带正确 Token 连接的网页 Origin 会写入本机配置，后续连接需符合已记录的 Origin。AI 生成仍使用网页中配置的接口。

## 本地命令与插件

如需使用 [Codex 插件](../plugins/codex/README.md)，先构建并将本项目链接为本地命令：

```bash
cd canvas-agent
npm install
npm run build
npm link --ignore-scripts
```

完成后可运行 `dream-canvas-agent`，MCP 模式为 `dream-canvas-agent mcp`。修改源码后重新构建；无需发布 npm 包。

## 手动注册 MCP

普通 Agent 进程提供网页连接服务，`mcp` 进程提供外部工具；两者读取同一份本机配置。只启动普通 Agent 不会安装 MCP。安装插件后无需再手动重复注册。

已完成本地链接时：

```bash
codex mcp add infinite-canvas -- dream-canvas-agent mcp
```

也可使用构建产物的绝对路径：

```bash
codex mcp add infinite-canvas -- node /absolute/path/dream-canvas/canvas-agent/dist/index.js mcp
```

Claude Code 可注册同一工具服务：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- dream-canvas-agent mcp
```

移除手动注册的 MCP：`codex mcp remove infinite-canvas`。工具协议名仍为 `infinite-canvas`，与现有会话保持一致。

## 对话与媒体

侧边栏使用本项目依赖的 Codex CLI 启动 `codex app-server --stdio`，按线程、轮次和条目同步消息。画布操作按网页中的确认设置执行。

上传附件会临时写入本机文件，再作为 Codex 的本地图片输入。单次请求体上限保持为 30MB。消息存储与通信协议独立管理，清理工程文件不会删除本机对话。
