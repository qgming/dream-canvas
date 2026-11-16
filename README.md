# 梦想画布（dream-canvas）

面向图片创作的 AI 画布工作台，基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) v0.20.0 二次开发，由 [qgming](https://github.com/qgming) 维护。

## 核心功能

- 无限画布：多项目、节点与连线、小地图、撤销重做、导入导出。
- AI 创作：图片、文本、视频、音频生成与参考图编辑，支持 OpenAI / Gemini 格式和自定义调用脚本。
- 素材与提示词：本地素材库、提示词来源管理与工作台生成记录。
- 画布扩展：[节点插件](plugins/canvas/README.md)，在网页画布内增加自定义节点类型。
- Codex 集成：[Codex 插件](plugins/codex/README.md)，通过 [Canvas Agent](canvas-agent/README.md) 读取和操作画布。
- 本地工具：[请求代理](canvas-proxy/README.md)，用于转发浏览器请求。

## 快速开始

安装 Node.js 22.12+（建议使用 LTS 版本，包含 npm），然后在仓库中运行：

```bash
cd web
npm install
npm run dev
```

打开终端输出的地址，进入配置填写自己的 Base URL 和 API Key。依赖统一使用 npm 管理，提交 `package-lock.json`；按锁文件安装时使用 `npm ci`。

画布、素材和生成记录主要保存在浏览器本地；AI API Key 同样保存在浏览器本地，请求由前端直连所配置的服务。WebDAV 同步需要自行配置。项目处于开发阶段，不保证历史数据兼容。

## 静态托管

在 `web/` 中执行 `npm run build`，将 `web/dist/` 托管到支持 SPA 路由回退的静态服务器，所有前端页面路由回退到 `index.html`。平台部署模板和自动发布流程由使用者自行配置。

## 开源协议

使用 [MIT License](LICENSE)，保留原始版权声明 `Copyright (c) 2026 basketikun`。安全问题反馈见 [SECURITY.md](SECURITY.md)。
