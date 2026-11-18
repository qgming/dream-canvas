# 模型接口脚本示例

这些示例用于管理员主动导入为自建脚本，不加入内置目录，不携带渠道凭据，也不代表对应供应商的全部模型均可用。导入前核对供应商当前文档、模型 ID、权限和参数；示例尚未执行真实调用或项目端到端验收。

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

异步接口须将实际提交响应中的任务编号归一为 `upstreamId` 并声明 `query` 阶段；结果状态按契约映射为 `queued/running/completed/failed/cancelled` 等值，查询只构造一次请求。`result` 或 SSE `stream` 可返回供应商真实 `progress`（0–100 数值），没有百分比时省略，不能按等待时间推算。供应商 100% 不代表原件已保存或云同步已完成。发布修订后须主动更新模型绑定，已有任务仍使用原快照。

生图与视频工作台根据脚本有效定义显示参数和模式，编写时遵循以下规则：

- 新视频脚本优先声明无条件 `mode` select，只列真实支持的模式，用 `when` 联动参数与素材；图生图可在接口支持时按是否有图片选择生成或编辑路径。不要将文生、仅首帧、仅尾帧、首尾帧和全能参考当作所有模型都支持的固定菜单。
- 命名首尾帧用 `asset`，在素材数组中按 `parameterKey` 取值；有序参考用 `reference`，通过 `images/videos/audios` 读取，同一时刻每个角色最多一个有效参考控件。声明真实数量、格式、尺寸与毫秒时长，复合条件在 `validate` 检查。
- 图片 `count` 表示单次返回张数，支持时默认 1，不增加批量请求次数。有限参数用 `select/options`，允许自定义时用 `suggestions`；比例、像素尺寸和分辨率档位分别映射，保留数字与布尔类型。
- `label/labelEn` 保持简短，说明写入 `description/descriptionEn` 供标题提示使用。工作台专用 `workbench_mode` 不属于脚本参数；历史封面 4:3 只影响展示，不改变生成比例或原件。

完整且与当前服务一致的约定在脚本页「变量与适配指南」，外部 MCP 可读取第 7 版 `admin_script_contract`。内置第 2 版 [model-api-adapter Skill](../../server/internal/app/builtin_skills/model-api-adapter/SKILL.md) 可由全局助手或外部 MCP 读取，指导 AI 按供应商文档生成完整文件草稿；示例仅描述自己的输入，不作为新脚本全部能力的模板。更新内置 Skill 需重新构建并重启后端，不会自动修改现有脚本、发布或模型绑定。助手不代为真实测试或发布。
