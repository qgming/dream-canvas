# 梦想画布节点插件

画布节点由服务端目录统一管理，管理员入口为「设置 → 节点插件」。普通用户直接使用已启用节点，不提供个人安装、URL 安装、官方市场或本地发现开关。节点插件与调用供应商的服务端「接口插件」分别管理。

文本、图片、视频、音频、生成配置、组，以及本目录的 Markdown、SVG、HTML、3D 全景、便利贴、超分均为内置节点插件，默认启用。前六种复用宿主媒体与创作控件，本目录六种节点源码由 Vite 按需打包，无需分别构建或安装。内置实现随应用代码更新，管理页只控制启停。

内置生成节点及全景共用 624px 底部创作面板；Markdown、HTML、SVG 与便利贴共用宿主内容编辑器，点击 / 双击或工具栏编辑时打开，节点内保留渲染预览。输入与颜色即时保存，放大编辑复用同一内容，源码保留等宽字体与行号；便利贴颜色在底栏调色图标中调整。此处内置实现直接复用应用共享组件与依赖，不要求独立导出插件 bundle，自建包仍遵循下方导入边界。

超分节点接收一张图片或一段视频，支持上游连线、资料库与上传，使用同样的紧凑底部面板，仅选择模型与模型实际声明的目标参数，无提示词输入。后端仅针对 `upscale:media` 的空提示词补入保留原内容的默认指令；接口不使用提示词时无需处理该字段。源素材绑定仅发生在此节点，不改变普通节点首尾帧或命名素材的语义，结果沿用持久任务、私有资产、自动保存与恢复。模型适用条件与现有 DMC 直链限制见 [超分说明](upscale/README.md)。

## 自建节点

1. 管理员在节点插件页新建，服务端分配固定插件 ID 并生成 `plugin.json` 与 `index.tsx` 草稿。
2. 在文件编辑器修改完整包，可添加包内 JS、TS、JSX、TSX、JSON、CSS 模块；先保存草稿，再由管理员确认发布。保存草稿不影响已发布代码。
3. 发布使用服务端已有 esbuild 编译并保存整个包及编译结果，不执行插件代码。新建插件发布后还需在列表启用；已启用插件发布新版本后通知使用者重新读取。
4. 助手先读取 `admin_canvas_plugin_contract` 与 `admin_canvas_plugin_get`，再以 `admin_canvas_plugin_draft_save` 保存完整文件映射。助手不提供发布、启停或删除工具。

`plugin.json` 声明 `schemaVersion: 1`、固定 `id`、`name`、`description`、`entry` 和 `nodes`。每个节点包含 `type`、`title`、`defaultSize` 和可选 `defaultMetadata`，类型必须以当前插件 ID 加冒号开头；已发布类型保持稳定。节点清单供网页、助手和 MCP 共用，不依赖浏览器在线。

入口默认导出 `definePlugin({...})`。从 `@dream-canvas/plugin-sdk` 引入 `definePlugin` 与 React hooks，从 `./plugin.json` 引入节点定义，再为节点补充 `icon`、`Content`、可选 `Panel`、`toolbar`、`resource` 和交互选项。JSX 使用宿主 React 单例，CSS 以字符串导入并赋给插件 `css`。

只解析包内相对模块以及宿主 `react` 和 `@dream-canvas/plugin-sdk`，不安装 npm、不解析远程模块、不读取服务器文件、不运行系统命令。已有 Markdown 和全景内置实现暂时沿用运行时按需加载的 marked / three.js；这一源码内置依赖不构成自建包的外部导入入口。

## 宿主能力

`Content({ ctx })` 中可使用：

| 接口 | 用途 |
| --- | --- |
| `node`、`theme`、`scale`、`isSelected` | 当前节点、主题、缩放与选中状态 |
| `updateMetadata(patch)`、`updateNode(patch)` | 编辑项目内容、标题和尺寸，沿用全局自动保存与历史 |
| `getNode/getNodes/getConnections/getUpstream/getDownstream` | 读取当前画布和连接关系 |
| `applyOps(ops)` | 增删改节点与连线、选择、视口和生成指令 |
| `ai.generateImage/generateVideo/generateText` | 通过同一服务端渠道模型和任务业务调用，提交前保存明确目标 |
| `openPanel/closePanel` | 控制节点面板 |
| `storage` | 按账号与插件隔离的浏览器偏好；业务正文写入 metadata，媒体使用稳定服务端资产引用 |

节点可声明 `hidePanel`、`interactionToggle`、`forceInteractive`、`transparentBackground`、`keepAspectRatio` 或 `useBuiltinPanel`。输入控件的 pointerdown、keydown、wheel 要阻止穿透画布；滚动区使用 `data-canvas-no-zoom`，样式沿用 `ctx.theme` 和全站语义 token。SDK 类型见 [sdk/src/types.ts](sdk/src/types.ts)。

停用后创建菜单隐藏该类型，新建项目节点与新的节点生成在服务端同样校验；已有节点内容保留并显示不可用，重新启用后恢复。停用不取消已提交任务、不删除资产。被项目或撤销历史引用的自建插件拒绝删除，可停用；删除须由管理员确认并检查记录版本。

节点代码在使用者浏览器内执行，可访问页面和当前账号获授权的同源业务接口；这与服务端接口插件的 QuickJS WASM 隔离环境不同。发布确认会明确显示此运行边界。完整本轮实施和未验收事项见 [CHANGELOG](../../CHANGELOG.md#unreleased)。
