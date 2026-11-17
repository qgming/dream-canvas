# 模型接口脚本示例

这些示例用于管理员主动导入为自建脚本，不加入内置目录，不携带渠道凭据，也不代表对应供应商的全部模型均可用。导入前核对供应商当前文档、模型 ID、权限和参数；项目本轮已构建并重启，示例尚未执行真实调用或项目端到端验收。

- `agnes-image/`：映射 Agnes 图片尺寸、比例、`extra_body` 与参考图片。
- `agnes-video-flash/`：映射文生、首尾帧及图片 / 音频参考，提交获得 `video_id`，由平台持久查询根路径 `/agnesapi`。

参考 [Agnes 文档](https://www.agnes-ai.cn/zh-Hans/docs/overview)与 [API 文本说明](https://wiki.agnes-ai.cn/llms.txt)。示例使用实际 API Base URL 加相对路径，平台不会自动补 `/v1`。兼容 OpenAI 的调用可直接选择相应内置脚本，只有差异接口才需要自建脚本。

在「设置 → 接口脚本」导入整个文件夹或 ZIP，查看输入表单与代码，保存草稿并发布；随后在渠道模型中选择该脚本版本。也可以在模型编辑时创建脚本，发布后返回原模型草稿并保存。真实测试由管理员明确确认费用，测试结果只针对当次配置。

每个包使用以下结构：

```text
script.json       名称、能力、阶段、输入路径、认证和工具 / 流式声明
inputs.json       控件、默认值、选项、素材要求和 when 条件
adapter.js        具名导出 submit/result 及可选阶段
lib/*.js          可选的包内共享模块
```

脚本接收 `model/prompt/messages/images/videos/audios/params/tools/upstreamId`，只返回受控请求或规范结果。平台执行网络传输、私有素材解析、持久查询、成品保存与统计。不能使用 `fetch`、浏览器 `File/Blob/FormData`、任意 npm、服务器文件或系统命令；真实密钥由服务端注入。

完整且与当前服务一致的约定在脚本页「变量与适配指南」，外部 MCP 可读取 `admin_script_contract`。内置 `model-api-adapter` Skill 可由全局助手或外部 MCP 读取，指导 AI 按供应商文档生成完整文件草稿。助手不代为真实测试或发布。
