---
name: model-api-adapter
description: 为梦想画布创建或修订供应商模型的接口插件，将文本、图片、视频和 TTS 输入映射到真实 API，并规范化响应、工具调用和用量。适用于管理员接入模型、配置生图或视频创作模式、定义参数与条件素材、修复脚本或分析已有测试记录。
---

# 模型 API 适配

这是应用内置的管理员 Skill。先读取 `admin_script_contract` 获取当前运行约定，再用 `admin_script_get` 读取目标草稿、版本与模型绑定；不要凭记忆生成旧版接口插件。

## 先核实接口

从用户提供的官方文档、cURL 或脱敏请求响应确定实际 API Base URL、相对路径、认证、模型 ID、能力、参数类型、单位与限制。模型名称不能证明能力。图片与视频先列出模式对照：每种模式的必需 / 可选素材、数量与顺序、适用参数、上游字段和限制；只声明有依据的模式。资料不足时列出缺失信息，可以先保存明确标注未完成的草稿，不能虚构供应商接口或声称测试通过。不要索取密钥；渠道保存凭据，脚本只能使用平台认证和受控签名能力。

## 编写完整文件包

使用 `script.json`、`inputs.json`、`adapter.js`；复杂公共逻辑可用包内相对 JS/JSON import。`adapter.js` 具名导出 submit/result，按需导出 validate/query/stream/usage/cancel。各阶段只转换 JSON，不联网、不读服务器文件、不安装 npm、不使用浏览器 File、Blob、FormData、fetch 或定时轮询。

- 输入为 model、prompt、messages、images、videos、audios、params、tools、upstreamId。prompt 在音频任务中是待朗读文本。素材是资产描述符，不是临时 URL 或浏览器文件；按接口选择 https/file/data 传输。
- `inputs.json` 是输入定义的唯一来源，包含中文和英文名称、适用模式、默认值、类型和必要约束。模型只配置已有字段的默认值、显示设置和更窄的选项，不另存一套完整定义。仅使用契约支持的字段，不自建 `supportedModes`、`uiRole` 等无效元数据。
- `options` 是限定选项，值必须保留实际字符串、数字或布尔类型；文本或数字的 `suggestions` 仅提供快捷选择并允许自定义，不能放宽其他约束。契约的 `builtinMedia` 仅描述对应内置脚本，不是所有供应商都支持的参数或默认值。
- 精确列出供应商接受的参数，不盲目展开 params。保留显式 false、0 与空值语义；说明秒/毫秒、像素、采样率等单位。不要将个人资产写入共享默认值。
- 请求 path 相对完整 API Base URL；不自动补 /v1，前导 / 表示域名根路径。认证由平台注入，不在代码和非秘密 headers 中写 key。
- 图片区分生成与编辑；multipart 使用 assetId，让平台流式读取原件并处理 boundary。不要转码或压缩输入。
- 异步图片或视频的 submit 只映射请求；必须分别核对提交响应和查询响应的结构，在 result 中把真实编号归一为 upstreamId（例如提交为顶层 task_id、查询为 task.id），排队 / 运行时不能遗漏，并声明 query。query 每次只发一个查询，平台持久轮询。result 映射 running/completed/failed 等真实状态。供应商提供百分比时将其按文档单位映射为 progress（0–100 数值），stream 也可累计该字段；不提供时省略，不按时间伪造。需要取文件时返回只读后续请求，并在该结果提供 usage / usageState，后续通过 input.previousResult 取回并带入最终结果；不在脚本中长时间等待或重复提交。
- 音频仅内置 OpenAI TTS，输入 voice / format / speed / instructions，默认 alloy / mp3 / 1 / 无指令；format 映射 audio/speech 的 response_format，不保留旧参数别名，不自动使用参考音频或注册音色覆盖 voice。读取 binary MIME，PCM 原件标为 audio/pcm，不改成音乐生成。
- 文本保留完整 messages 与 tools，规范化工具编号、函数名和 JSON 字符串参数。只有真实支持工具调用时才声明 features.tools。流式阶段累计文本、推理、工具与用量；只有真实终止事件才设置 complete=true，断流不能伪装完成。非流式响应不要伪称流式。
- 用量只写有依据的数据；区分实际、估算、未知，不按返回次数猜 token 或成本。保留供应商任务编号和可恢复依据。

## 生图与视频创作模式

新建视频脚本优先使用一个无条件的 `mode`、`type: "select"` 字段，包含简短的 `label/labelEn`、合法默认值和真实支持的选项。文生视频、图生视频、仅首帧、仅尾帧、首尾帧、多模态参考是待核实的能力，不是必须全部提供的模板；只有同时支持图片、视频和音频参考时才称为「全能参考」。选项值是脚本枚举，在 adapter 中明确映射请求，不假定供应商接受同名 `mode`。

- 用 `when: {"key":"mode","values":["reference"]}` 声明该模式的参数与素材。条件只能引用无条件的普通参数，不能嵌套、同时判断多个字段或在某个 option 上写 when。条件不成立的普通参数不会传给脚本。
- 文生模式不激活不支持的素材控件；图生 / 首尾帧模式明确必需帧与可选帧，多模态参考按实际支持的角色声明。模式所需素材、可混用类型和顺序须与 submit 的映射一致，缺帧不能猜测或用另一张替代。
- 已有脚本可用 `keyframe` select 表达 `none/first/last/both`。无真实 `mode` 且存在可用图片参考定义时，视频工作台会将 `none` 展示为参考入口；参考均可省略时还提供文生入口。两者仍提交 `params.keyframe="none"`，区别是是否提交素材；其他入口保留实际 first/last/both 值。`workbench_mode` 仅供界面使用，不能写入 inputs、params 或上游请求。网页筛选不能替代服务端定义与 validate。
- 生图按接口核实文生图、参考图生成或编辑。可以像内置图片脚本一样根据 images 是否为空选择不同路径，前提是供应商确实支持；需要显式模式时声明 mode 与条件素材，不额外制造上游参数。
- 模式相关的比例 / 分辨率 / 时长组合、参考总量、帧比例一致性、编码等复合要求在 `validate` 校验。when 不能表达同一字段随模式改变的选项范围；在说明中交代限制并返回明确错误，不静默换默认值、删参数或丢素材。

## 素材字段与映射

- `type: "asset"` 是单个命名素材位，例如 `first_frame`、`last_frame`；值由用户选资产 ID，运行时对应素材带 `parameterKey`。通过 `images.find(item => item.parameterKey === "first_frame")` 定位首帧，不用数组位置猜命名素材的角色。
- `type: "reference"` 是按角色连接的有序素材列表，通过 images/videos/audios 读取，不从 `params[control.key]` 取数组，也不假设它有 parameterKey。若使用列表表达首尾帧，在中英文说明中明确顺序并校验数量；不要擅自重排。
- 同一时刻每个 role 最多一个有效 reference 控件；不同模式的同角色定义使用互斥 when。命名 asset 优先匹配，该素材不会再计入同角色 reference；混用时分别校验数量。
- 按真实文档声明 role、transport、required、minCount/maxCount、mimeTypes/maxBytes、minWidth/maxWidth/minHeight/maxHeight、minDurationMs/maxDurationMs。required 的参考至少一项，时长约束与素材 durationMs 均为毫秒；供应商参数如用秒，在映射处换算。未声明的素材类型会被服务端拒绝，不能只在网页隐藏。
- 素材限制缺少依据时标记未核实，不拿其他模型或示例的数值补齐。跨素材的总量、总时长、混用禁令等写入 validate；校验阶段仅使用元数据，不依赖提交时才提供的 url/dataUrl，也不裁切、转码或压缩原件。

## 参数与工作台呈现

- 图片张数使用数值 `count`，表示单次请求返回张数；支持时默认 1，按文档定义 options 或 min/max/step。内置图片将其映射为 n，自建脚本以真实接口为准。不新增「批量请求次数」，不循环 submit 模拟多张；一次工作台提交对应一个任务，多张结果完整返回。
- 比例、像素尺寸、分辨率档位分别建模；需要时在脚本内将比例与分辨率转换成像素。不要将 `16:9` 直接发给只接受 `WIDTHxHEIGHT` 的字段。视频时长保留真实单位与数值类型；默认视频 generateAudio 映射 generate_audio 仅适用于对应适配。
- 有限选项用 select 或类型正确的 options；允许自定义时使用 text/number 加 suggestions。count、seconds、duration 的合法连续范围可用 min/max/step，工作台会据此生成下拉项；离散取值用 options，不能只列建议却声称限制了范围。
- label/labelEn 只写简短名称，单位必要时放标题；解释、适用条件和特殊值写 description/descriptionEn，供标题右侧提示使用。模式与必要参数保持可见，次要参数才设 advanced，不为套用布局隐藏必要字段。
- 工作台在参考素材下选择模型，模式位于模型下方，其余参数按两列展示；这些由输入定义驱动，不在脚本中写 React、Select 或 Tooltip 实现。4:3 仅是历史缩略图裁切比例，不能据此限制生成比例或裁切原件。
- 工作台自动保存的是当前用户的本机创作草稿，不据此改共享脚本默认值或管理员模型配置。脚本仅返回规范结果；记录删除、手动加入资产库和当前浏览器下载由应用处理，不在脚本中执行。

## 保存与交接

通过 `admin_script_create` 创建自建脚本，再使用读取到的 revision 调用 `admin_script_draft_save` 保存完整文件映射。内置脚本只读且不可复制。版本冲突时重新读取，保留用户修改，不直接覆盖。

可以使用 `admin_script_check` 做无供应商调用的编译与样例映射检查，也可用 `admin_script_evidence` 读取管理员已提交测试的脱敏记录。检查不能证明实际模型可用；真实测试的结论仅对应记录中的渠道、模型、脚本版本、参数和素材。不要把媒体 Base64、临时签名地址、服务器路径或凭据放入对话。

助手只保存草稿。真实付费测试、发布和模型升级均由管理员在网页主动触发，不代为执行这些操作。新增字段或改变语义通过草稿和新版本完成，不为适配界面直接改已有发布版本、模型绑定或任务快照。

完成后说明已保存的草稿、模式 / 参数 / 素材到上游的映射、所据文档和未知项，并列出各模式的合法样例及需要拒绝的边界组合（缺帧、超量、不支持的类型、非法参数组合）。分别说明哪些仅做了定义 / 样例映射检查、哪些有真实调用证据，交由管理员逐模式测试。
