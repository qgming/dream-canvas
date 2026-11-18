---
name: model-api-adapter
description: 为梦想画布创建或修订供应商模型的接口脚本，将文本、图片、视频和 TTS 输入映射到真实 API，并规范化响应、工具调用和用量。适用于管理员要求接入模型、适配请求参数、修复脚本或分析已有测试记录。
---

# 模型 API 适配

这是应用内置的管理员 Skill。先读取 `admin_script_contract` 获取当前运行约定，再用 `admin_script_get` 读取目标草稿、版本与模型绑定；不要凭记忆生成旧版接口插件。

## 先核实接口

从用户提供的官方文档、cURL 或脱敏请求响应确定实际 API Base URL、相对路径、认证、模型 ID、能力、参数类型、单位与限制。模型名称不能证明能力。资料不足时列出缺失信息，可以先保存明确标注未完成的草稿，不能虚构供应商接口或声称测试通过。不要索取密钥；渠道保存凭据，脚本只能使用平台认证和受控签名能力。

## 编写完整文件包

使用 `script.json`、`inputs.json`、`adapter.js`；复杂公共逻辑可用包内相对 JS/JSON import。`adapter.js` 具名导出 submit/result，按需导出 validate/query/stream/usage/cancel。各阶段只转换 JSON，不联网、不读服务器文件、不安装 npm、不使用浏览器 File、Blob、FormData、fetch 或定时轮询。

- 输入为 model、prompt、messages、images、videos、audios、params、tools、upstreamId。prompt 在音频任务中是待朗读文本。素材是资产描述符，不是临时 URL 或浏览器文件；按接口选择 https/file/data 传输。
- `inputs.json` 是输入定义的唯一来源，包含中文和英文名称、适用模式、默认值、类型和必要约束。使用 when 表达模式条件。模型只配置已有字段的默认值、显示设置和更窄的选项，不另存一套完整定义。
- `options` 是限定选项，值必须符合字段类型；文本或数字的 `suggestions` 仅提供快捷选择并允许自定义，不能放宽其他约束。尺寸可以在脚本内将比例与分辨率转换成像素；不要未经接口约定就将 `16:9` 原样发送到只接收 `WIDTHxHEIGHT` 的字段。默认图片 `count` 映射供应商 `n`，批量请求次数由应用另行控制；默认视频 `generateAudio` 映射 `generate_audio`。默认参数以契约的 builtinMedia 和目标脚本版本为准。
- 精确列出供应商接受的参数，不盲目展开 params。保留显式 false、0 与空值语义；说明秒/毫秒、像素、采样率等单位。不要将个人资产写入共享默认值。
- 请求 path 相对完整 API Base URL；不自动补 /v1，前导 / 表示域名根路径。认证由平台注入，不在代码和非秘密 headers 中写 key。
- 图片区分生成与编辑；multipart 使用 assetId，让平台流式读取原件并处理 boundary。不要转码或压缩输入。
- 异步图片或视频的 submit 只映射请求；必须分别核对提交响应和查询响应的结构，在 result 中把真实编号归一为 upstreamId（例如提交为顶层 task_id、查询为 task.id），排队 / 运行时不能遗漏，并声明 query。query 每次只发一个查询，平台持久轮询。result 映射 running/completed/failed 等真实状态。供应商提供百分比时将其按文档单位映射为 progress（0–100 数值），stream 也可累计该字段；不提供时省略，不按时间伪造。需要取文件时返回只读后续请求，并在该结果提供 usage / usageState，后续通过 input.previousResult 取回并带入最终结果；不在脚本中长时间等待或重复提交。
- 音频仅内置 OpenAI TTS，输入 voice / format / speed / instructions，默认 alloy / mp3 / 1 / 无指令；format 映射 audio/speech 的 response_format，不保留旧参数别名，不自动使用参考音频或注册音色覆盖 voice。读取 binary MIME，PCM 原件标为 audio/pcm，不改成音乐生成。
- 文本保留完整 messages 与 tools，规范化工具编号、函数名和 JSON 字符串参数。只有真实支持工具调用时才声明 features.tools。流式阶段累计文本、推理、工具与用量；只有真实终止事件才设置 complete=true，断流不能伪装完成。非流式响应不要伪称流式。
- 用量只写有依据的数据；区分实际、估算、未知，不按返回次数猜 token 或成本。保留供应商任务编号和可恢复依据。

## 保存与交接

通过 `admin_script_create` 创建自建脚本，再使用读取到的 revision 调用 `admin_script_draft_save` 保存完整文件映射。内置脚本只读且不可复制。版本冲突时重新读取，保留用户修改，不直接覆盖。

可以使用 `admin_script_check` 做无供应商调用的编译与样例映射检查，也可用 `admin_script_evidence` 读取管理员已提交测试的脱敏记录。检查不能证明实际模型可用；真实测试的结论仅对应记录中的渠道、模型、脚本版本、参数和素材。不要把媒体 Base64、临时签名地址、服务器路径或凭据放入对话。

助手只保存草稿。真实付费测试、发布和模型升级均由管理员在网页主动触发，不代为执行这些操作。完成后说明已保存的草稿、映射规则、所据文档、尚未核实之处以及管理员接下来需要测试的模式。
