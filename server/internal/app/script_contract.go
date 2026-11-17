package app

import "github.com/gin-gonic/gin"

func modelScriptContract(locale ...string) gin.H {
    english := len(locale) > 0 && locale[0] == "en-US"
    choose := func(zh, en string) string { if english { return en }; return zh }
    return gin.H{
        "version": 3,
        "package": choose("script.json: schemaVersion/name/capability/description/entry/inputs/phases/features/auth。默认 entry=adapter.js、inputs=inputs.json。阶段为具名 async 函数导出，支持包内 JS/JSON 相对 import。", "script.json declares schemaVersion/name/capability/description/entry/inputs/phases/features/auth. Defaults: adapter.js and inputs.json. Export named async phase functions; relative JS/JSON imports stay inside the package."),
        "runtime": choose("脚本在服务端隔离执行，返回请求或结果对象；不使用浏览器 File/Blob/FormData、fetch、npm、文件系统或进程。密钥只由服务端注入，不提供 apiKey 变量。", "Scripts run in the server sandbox and return request or result objects. No browser File/Blob/FormData, fetch, npm, filesystem or processes. The server injects credentials; apiKey is never exposed."),
        "input": gin.H{
            "model": choose("供应商模型 ID，不包含渠道前缀", "Provider model ID without channel prefix"),
            "prompt": choose("提示词或 TTS 待朗读文本，不自动把系统提示词混入朗读正文", "Prompt or TTS input text; system instructions are not appended to spoken content"),
            "messages": choose("完整文本消息及工具结果，素材块使用 image_asset 与 assetId", "Conversation and tool results; image_asset blocks reference assetId"),
            "params": choose("脚本输入定义与模型 / 个人 / 本次设置合并并校验后的参数", "Declared inputs resolved from script, model, personal defaults and explicit values"),
            "images/videos/audios": choose("分类素材数组：assetId/role/parameterKey/transport/mimeType/bytes/width/height/durationMs/fps/videoCodec/audioCodec/voiceId。https 在提交时提供 url，data 提供 dataUrl，file 由 multipart 里的 assetId 流式读取。校验与预览阶段不签发地址。", "Media arrays with assetId/role/parameterKey/transport/mimeType/bytes/width/height/durationMs/fps/videoCodec/audioCodec/voiceId. https resolves to url, data to dataUrl, file uses multipart assetId. Validation and preview do not issue signed URLs."),
            "tools": choose("Agent 本轮允许的 OpenAI function tools。脚本只转换定义与结果，不执行业务工具。", "Allowed OpenAI function tools for this Agent request. Scripts adapt definitions and calls; application code executes tools."),
            "upstreamId": choose("平台保存的供应商任务编号，查询与取消时提供", "Persisted provider job ID for query and cancel"),
        },
        "phases": gin.H{
            "validate": "optional: standard input -> {valid:true} or {valid:false,error}",
            "submit": "required: standard input -> request descriptor",
            "query": "optional asynchronous jobs: standard input with upstreamId -> ONE query request; platform schedules polling",
            "stream": "optional SSE: {event,state,input} -> cumulative state {text,reasoning,toolCalls,usage,responseItems,complete,status}; complete=true only after a real protocol terminal event",
            "result": "required: {response,phase,input} -> normalized result or {request:{method:'GET',path:...}} for a read-only follow-up",
            "usage": "optional: {response,input} -> usage measurements; omit unknown values",
            "cancel": "optional: standard input with upstreamId -> cancel request; do not delete the evidence needed to query results",
        },
        "request": gin.H{"method":"GET/POST/PUT/PATCH/DELETE", "path": choose("相对实际 API Base URL，不自动补 /v1。/ 开头从域名根路径解析。生成请求须保持渠道 origin。", "Relative to the actual API Base URL, with no implicit /v1. Leading / resolves from the origin root. Generation requests must stay on the channel origin."), "headers":"optional non-secret string headers; authentication and transport headers are server-managed", "body":"JSON object or raw text", "form":"URL-encoded object, mutually exclusive with body/multipart", "multipart":"[{name,value} or {name,assetId}] — platform streams the original and sets the boundary", "responseType":"json | sse | binary | image-json; binary/image-json require a durable generation task and return responseFile"},
        "result": gin.H{"status":"queued/running/completed/incomplete/failed/cancelled/confirmation_required", "upstreamId":"required while queued/running", "text":"text output", "url":"HTTPS media output, saved by the platform", "outputs":"[{url} or {b64_json}]", "responseFile":"pass through response.responseFile only", "mimeType":"original MIME type, including audio/pcm when applicable", "toolCalls":"[{id,type:'function',function:{name,arguments:'JSON string'}}]", "usage":"input_tokens/cached_tokens/output_tokens/images/seconds/characters/requests; input_tokens includes cache", "usageState":"actual/estimated/unknown", "error":"visible error; preserve partial outputs and usage"},
        "inputs": choose("控件 key/label/labelEn/type/required/default/description/descriptionEn。type: text/textarea/number/switch/select/asset/reference；select.options=[{label,labelEn,value}]；number: min/max/step；文本: minLength/maxLength；素材: role=image/video/audio、transport=https/file/data、minCount/maxCount、mimeTypes/maxBytes、尺寸和时长范围。when:{key,values} 引用无条件普通参数，条件成立时显示并校验。模型覆盖只能修改显示、默认值与缩小范围。", "Controls use key/label/labelEn/type/required/default/description/descriptionEn. Types: text/textarea/number/switch/select/asset/reference. Options use label/labelEn/value. Numeric/text/media constraints are declarative. when:{key,values} references an unconditional scalar input and controls display plus validation. Model overrides only change presentation, defaults or narrow allowed values."),
        "auth": "script.json auth.type=bearer (default), header with header/prefix, or none. Credentials stay server-side. sign(value) provides HMAC-SHA256 hex; encode(kind,value) supports base64/hex/url/sha256.",
        "preview": choose("包检查只编译与校验定义，不需要真实调用；样例映射使用已确认运行边界，按用户归属读取资产元数据，HTTPS 使用 preview.invalid 占位地址，data 不读取原件。不会签发素材地址、联网或注入凭据，不能作为真实可用证据。", "Package checks compile and validate definitions without provider calls. Sample mapping uses confirmed execution limits and owner-checked asset metadata, with preview.invalid HTTPS placeholders and no original data. It issues no private URLs, network requests or credentials and does not prove API availability."),
        "lifecycle": choose("内置只读且不可复制；自建草稿按 revision 保存，可不付费测试就发布。模型固定发布版本，任务固定脚本、参数和价格。助手可编写草稿与读取脱敏记录，真实测试和发布由管理员主动执行。", "Builtins are immutable and cannot be copied. Custom drafts use revision checks; publishing does not require paid testing. Models pin published versions and tasks pin code, inputs and prices. The assistant writes drafts and reads redacted evidence; administrators actively test and publish."),
        "authoringSkill": "model-api-adapter",
    }
}

func (a *App) getModelScriptContract(c *gin.Context) { c.JSON(200, modelScriptContract(c.Query("locale"))) }
