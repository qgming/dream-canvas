# 梦想画布 Agent

保留的本机 Codex 连接工具源码，原先通过浏览器桥接提供画布操作、对话、历史、附件、审批与 Skill 管理，源码保留 Claude Code Adapter。

> 当前网页已移除本机 Codex / Connect token 连接入口，不再与此工具互通。Go 服务已经写入账号、项目、资产、会话 / Skill 及部分远程 MCP，云端助手执行尚未完成；当前进度见[后端化规划](../CHANGELOG.md#已确认的后端化规划待实施)。以下命令仅用于维护保留源码，不是当前网页的启动步骤；网页开发请使用根目录 README。

## 服务端化目标（待实施）

- 每个用户一个全局助手入口，支持多对话和跨页面使用；每轮固定明确的项目，不因页面切换改动已开始操作的目标。
- 助手通过管理员配置的渠道模型工作，项目、任务、对话和审批按用户持久保存到服务端；后台接口编写在同一助手中提供独立上下文和草稿权限。
- 现有画布、资产和生成工具改为调用统一业务层，网页关闭仍可操作；选区、视口等页面状态只作用于明确绑定的在线页面。
- 对外提供远程 Streamable HTTP MCP，使用用户可撤销且可限制项目、操作范围的令牌；与网页、助手执行相同的业务权限，项目与资产删除按统一确认规则处理。
- 不原样将当前单个本机 Connect token、站点工作区或 Codex 进程直接暴露为多用户云服务；不另造一套助手面板。具体 Agent 执行库待实现验证，不强制依赖 Pi 或完整 Codex 运行时。
- 本机 stdio MCP 入口依赖原浏览器连接，当前网页已移除此连接；新远程 MCP 是独立的 Go 业务入口，不能将此进程视为其替代品。

## 本地启动

在仓库内安装本项目依赖并启动：

```bash
cd canvas-agent
npm install
npm run dev
```

排查保留工具源码时使用 `npm run debug`。

此工具默认监听 `http://127.0.0.1:17371`，终端输出 `Local URL` 和 `Connect token`；当前网页没有填写或连接入口。保留工具的配置与消息元数据位于 `~/.infinite-canvas/`，Debug 日志位于其 `logs/`，本次后端化不移动或清理它们。

原连接协议首次携带正确 Token 的网页 Origin 会写入本机配置；新业务服务不读取或复用这些本机配置。

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

保留工具的 Codex Adapter 使用 `codex app-server --stdio`，按线程、轮次和条目同步消息；当前网页助手已不调用此 Adapter。

上传附件会临时写入本机文件，再作为 Codex 的本地图片输入。单次请求体上限保持为 30MB。消息存储与通信协议独立管理，清理工程文件不会删除本机对话。
