# 梦想画布（dream-canvas）

面向个人与小团队自托管的 AI 无限画布，基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) v0.20.0 二次开发，由 [qgming](https://github.com/qgming) 维护。React、TypeScript、Vite 前端沿用暖灰浅深主题与 shadcn/ui + Radix，Go、Gin、GORM、SQLite 后端统一管理账号、项目、私有资产、渠道、任务、助手与统计；业务及组件细节参考 [DEEIX-Chat](https://github.com/DEEIX-AI/DEEIX-Chat)。

当前处于后端化实施阶段。持久调度、模型接口脚本、对象存储、云端助手和用量账本已写入代码，**本轮脚本重梳已按用户要求完成前后端构建与重启，页面、健康接口及前端代理可访问；项目端到端、安全与性能验收仍待完成**。既有 UI 验收不覆盖本轮新增功能。完整进度、真实供应商证据和待办集中在 [CHANGELOG](CHANGELOG.md#渠道模型与接口脚本重梳)。

## 核心功能

- 无限画布、独立图片 / 视频工作台、多项目、节点连线、导入导出；服务端按用户保存项目，版本冲突保留未保存编辑。
- 图片、视频、音频私有资产库；成品先持久落盘，再后台同步；删除项目或节点只解除引用，全局资产删除需确认。
- 渠道默认使用 OpenAI 兼容连接；模型分别选择内置 OpenAI Chat Completions / Responses、图片生成 / 编辑、TTS、Seedance / MiniMax 视频，或自建接口脚本。脚本包包含 `script.json`、`inputs.json`、`adapter.js` 及可选相对导入模块，内置只读且不可复制，自建支持草稿、请求预览、可选真实测试与不可变发布版本。
- Cloudflare R2、阿里云 OSS、腾讯云 COS、七牛云 S3、通用 S3 配置模板；可保存多份，最多启用一份，历史文件保留原存储归属。
- 持久排队、异步查询、待确认恢复、取消意愿和文件同步 / 删除队列；不确定的付费提交不自动重提或切换渠道。
- 全局文本 Agent 助手，可调用工具创建和编辑节点、连线、项目、素材、生成任务及自建脚本草稿；内置模型 API 适配 Skill，服务端会话与持久审批，明确目标项目与在线页面。外部 Streamable HTTP MCP 复用同一套工具定义、分发及业务层，大文件经同权限 Bearer HTTP 上传 / 读取。
- 按调用记录实际、估算和未知用量、价格与汇率快照、成本和积分，支持人工修正并保留依据；积分只统计使用，不设余额或支付。
- 脚本输入定义是参数唯一来源，模型通过可视表单调整默认值、选项与价格；画布、工作台、助手与 MCP 共用条件控件及校验，生成记录保留当次参数与版本。
- 支持中文与英文，以及网页内的[画布节点插件](plugins/canvas/README.md)。节点插件与服务端接口脚本是两种不同扩展。

## 快速开始

安装 Go 1.25+、Node.js 22.12+（包含 npm）。视频封面与音视频元数据还需要在业务服务的 `PATH` 中安装 `ffmpeg` 和 `ffprobe`；缺失时保留原件并报告原因，需要核实时长的模型会拒绝未核实素材。

```bash
cd server
go mod download
go run ./cmd/server -init-admin admin
go run ./cmd/server
```

初始化只允许空账号数据库，密码在终端隐藏输入。默认持久目录为 `server/data/`，监听 `127.0.0.1:8080`。另开终端：

```bash
cd web
npm ci
npm run dev
```

使用支持 Web Locks 的现代浏览器，通过 `localhost` 或 HTTPS 登录。Vite 将 `/api` 与 `/mcp` 同源转发到后端。管理员在设置中完成以下配置：

1. 在「运行参数」查看时限、大小、并发与失败处理，按实际需求修改并明确保存、启用；建议值不会自动生效，未配置时不提交模型。
2. 在「渠道与模型」仅填写名称、完整 API Base URL 和 Key 保存渠道；通过标准模型列表或手动输入添加模型，逐个选择类型与调用方式。URL 必须包含服务实际需要的路径，系统不自动补 `/v1`。
3. 在模型表单设置参数默认值与价格；非标准接口在「接口脚本」创建或导入文件夹 / ZIP。可视配置输入，`adapter.js` 具名导出提交、结果及按需的查询等阶段，可复制适配说明给 AI，或调用全局助手的 `model-api-adapter` Skill 编写草稿。检查不调用供应商；真实测试可选且需确认费用，发布不要求先测试。模型固定所选发布版本，已有任务保留完整快照。
4. 需要公网 HTTPS 素材时，在「对象存储」配置私有 Bucket。平台等待素材同步完成后按任务签发受限地址；无需公开 Bucket。

OpenAI 格式的其他服务可直接选择对应内置调用方式；Agnes 的差异字段通过自建脚本适配，不提供专用内置分支。[可导入的 Agnes 脚本示例](examples/model-scripts/README.md)包含图片和视频 Flash 两个独立目录，未携带密钥，完整项目验收待完成。音频内置接口是 TTS `/audio/speech`，不提供音乐生成。

业务数据以服务端为准，localforage 仅保存浏览器缓存与未保存编辑，不迁移旧本地数据。网页不再使用浏览器供应商凭据、直连请求、WebDAV 或本机 Codex 连接；旧本机 Agent、Codex 集成插件、代理源码及市场入口已移除。提示词按保存的刷新周期由服务端调度，关闭浏览器后继续刷新。

外部 MCP 在「设置 → 访问令牌」生成连接配置，按需授予读取、编辑、生成与删除权限；助手会话、账号令牌及管理员配置使用独立的 `assistant`、`account`、`admin` 权限，要求不限项目的令牌，`admin` 还要求账号为管理员。渠道与存储凭据只写不读。云端助手只能保存自建接口草稿，真实调试及发布仍由管理员主动操作。

## 部署说明

前端静态产物可在 `web/` 执行 `npm run build` 后交给 Go 服务，默认路径为 `../web/dist`。在 `server/` 可用 `go run ./cmd/server -data /absolute/path/data -web ../web/dist -listen 127.0.0.1:8080` 明确持久目录、静态目录与监听地址；独立托管静态文件时，将 `/api`、`/mcp` 同源转发。反向代理提供 HTTPS，并关闭 SSE 响应缓冲。

持久目录包含 SQLite、原件、缩略图、待处理供应商响应及 `credentials.key`，需要一起保护与备份；丢失加密密钥将无法解密渠道、存储和任务快照。原始响应在可靠入库后清理，未完成或待确认任务仍需保留恢复依据。

首版按单进程 SQLite 部署，不依赖 PostgreSQL、Redis；1 核 CPU / 1 GiB 内存是待实测目标，不是配置保证。当前登录防刷和诊断日志保留策略仍待确认与实施，真实云存储、恢复、隔离及性能仍待验收。首版不提供公开注册、支付、对外分享、实时协同或产品内备份恢复页面。

## 开源协议

使用 [MIT License](LICENSE)，保留原始版权声明 `Copyright (c) 2026 basketikun`；QuickJS WASM 绑定的局部修改与来源见 [第三方说明](server/third_party/qjs/NOTICE.md)。安全问题反馈见 [SECURITY.md](SECURITY.md)。
