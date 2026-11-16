---
name: open-canvas
description: 打开梦想画布本地网页并连接本地 Canvas Agent；用户要求打开、启动、进入或使用梦想画布时使用。
---

# 打开梦想画布

默认使用本仓库的本地前端和 Agent。读取当前项目路径，使用独立终端运行服务，保留用户已经打开的浏览器窗口与标签页。

## 启动与连接

1. 在梦想画布仓库的 `web/` 中安装依赖并执行 `npm run dev`；已有运行中的前端时复用，以 Vite 输出的实际地址为准。
2. 在独立终端运行 `dream-canvas-agent`。该命令应已通过本仓库 `canvas-agent/` 的构建与 `npm link --ignore-scripts` 准备好；不要下载上游 npm 包。已有可用 Agent 时复用。
3. 读取 Agent 输出的 `Local URL` 与 `Connect token`，将参数分别做 URL 编码后打开：

```text
<Vite Local 地址>/canvas?mode=new#agentUrl=<编码后的 Local URL>&agentToken=<编码后的 Connect token>
```

不要要求用户手动复制 URL 或 Token，不要在回复中展示 Token。只有用户明确指定自己的线上地址时才打开该地址。

## MCP

插件启动的 `dream-canvas-agent mcp` 提供工具，不提供网页连接服务；普通 Agent 提供网页连接。两者读取同一份本机配置。

## 打开模式

默认使用 `mode=new` 新建画布；用户明确要求时才用 `mode=recent` 打开最近画布，或用 `mode=choose` 进入选择页面。
