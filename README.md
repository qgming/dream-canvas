# 梦想画布（dream-canvas）

面向图片创作的 AI 画布工作台，基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) v0.20.0 二次开发，由 [qgming](https://github.com/qgming) 维护。

项目面向个人或小团队自托管使用。已确定保留 React + Vite 无限画布，新增 Go + Gin + GORM + SQLite 业务后端，统一管理账号、渠道、私有资产、生成任务、全局助手与远程 MCP；业务、组件样式和动效参考 [DEEIX-Chat](https://github.com/DEEIX-AI/DEEIX-Chat)，颜色与交互仍遵循当前画布主题。完整范围与实施顺序见 [Unreleased 规划](CHANGELOG.md#已确认的后端化规划待实施)。

> 当前处于后端化实施阶段：账号、项目、私有本地资产、渠道配置、会话 / Skill 和部分远程 MCP 已写入代码，尚未验收。真实模型生成、云端助手执行、OSS、持久任务调度与用量统计仍待完成；生成入口目前明确返回尚未启用，不会提交供应商。

## 核心功能

- 无限画布：多项目、节点与连线、小地图、撤销重做、导入导出。
- 服务端项目：按账号保存画布，自动保存携带版本，冲突时保留未保存编辑并提供副本与重新读取。
- 私有资产：图片、视频、音频原件保存在服务器持久目录，图片按需生成缩略图，删除项目只解除引用，全局删除需确认。
- 管理配置：管理员创建与停用账号、重置密码、配置渠道模型和凭据，编辑与发布未验证接口版本；供应商执行尚未接入。
- 素材与提示词：提示词来源管理、按账号保存的创作偏好和工作台展示记录。
- 助手与工具：沿用全局右侧面板管理会话和个人 Skill；个人设置可创建、撤销和限制项目范围的 MCP 令牌，目前提供项目、资产元数据、模型目录与删除确认工具。
- 画布扩展：[节点插件](plugins/canvas/README.md)，在网页画布内增加自定义节点类型。

## 快速开始

安装 Go 1.25+、Node.js 22.12+（包含 npm）。先在仓库中初始化管理员并启动业务服务：

```bash
cd server
go mod download
go run ./cmd/server -init-admin admin
go run ./cmd/server
```

初始化会在终端隐藏输入管理员密码，只允许在空数据库中执行。默认持久目录为 `server/data/`，服务监听 `127.0.0.1:8080`。另开终端启动前端：

```bash
cd web
npm ci
npm run dev
```

使用支持 Web Locks 的现代浏览器，通过 `localhost` 或 HTTPS 打开 Vite 地址并登录，默认进入画布列表；左侧栏切换主要功能，底部「设置」集中管理语言、主题与个人偏好，管理员额外看到「账号管理」「渠道与模型」。画布使用浏览器锁隔离标签页草稿，开发服务将 `/api` 和 `/mcp` 转发到业务后端；普通用户按「渠道 → 模型」选择。配置渠道和发布版本均不会调用供应商，真实生成仍待实施。

项目、资产、偏好和会话以服务端为准；浏览器使用 localforage 暂存未保存编辑与缓存，不迁移旧本地数据。网页已移除浏览器供应商凭据、直连调用、WebDAV 与本机 Codex 连接入口。旧 [Canvas Agent](canvas-agent/README.md)、[Codex 本地插件](plugins/codex/README.md) 和 [请求代理](canvas-proxy/README.md) 源码仍保留，当前网页不再使用其连接流程。

## 部署说明

当前代码先用于本地开发。前端可在 `web/` 中执行 `npm run build`，业务服务默认从 `../web/dist` 提供静态文件并回退 SPA 路由。在 `server/` 中可通过 `go run ./cmd/server -data /absolute/path/data -web ../web/dist -listen 127.0.0.1:8080` 明确目录与监听地址；单独静态托管前端时，需将 `/api`、`/mcp` 同源转发到 Go 服务。生产部署应由同机反向代理提供 HTTPS，SSE 路由关闭响应缓冲。

持久目录包含 SQLite、原件、缩略图和 `credentials.key`，部署时一起保护和备份；丢失加密密钥后不能解密渠道凭据。OSS、自动重试、请求限制、登录防刷和真实生成尚待实施，不将当前树视为可直接公开运行的完成版本。资源以 1 核 CPU、1 GiB 内存 Linux 为待实测目标，不承诺最低配置。首版不提供公开注册、商业支付、对外分享、实时协同及备份恢复页面。

## 开源协议

使用 [MIT License](LICENSE)，保留原始版权声明 `Copyright (c) 2026 basketikun`。安全问题反馈见 [SECURITY.md](SECURITY.md)。
