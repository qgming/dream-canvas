# 安全说明

梦想画布目前处于开发阶段，安全修复以本仓库当前代码为准，不承诺固定响应时间。

## 反馈渠道

如仓库已启用，请通过 [GitHub 私密漏洞报告](https://github.com/qgming/dream-canvas/security/advisories/new) 联系维护者；否则先在 [Issue](https://github.com/qgming/dream-canvas/issues) 中请求私密联系方式，不要公开漏洞利用细节、API Key、连接 Token 或其他凭据。

请提供受影响的提交、复现步骤、影响范围及脱敏后的日志。

## 数据与扩展

- AI API Key 保存在浏览器本地，由前端直接请求用户配置的服务；开启本地代理时请求会经本机转发。
- 画布、素材和生成记录主要保存在浏览器本地，WebDAV 同步由用户自行配置。
- 远程节点插件在页面内执行，可访问页面及本地数据，包括 API Key；仅安装可信来源的插件。
- Canvas Agent 默认仅监听本机，连接 Token 用于网页连接鉴权。请求代理默认仅监听本机，不应直接暴露到公网。
