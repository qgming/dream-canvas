# 梦想画布节点插件

在浏览器画布内扩展节点类型，使用画布中的「节点插件」管理器加载。Codex 的 MCP 与 Skill 集成见 [Codex 插件](../codex/README.md)。

给画布扩展自定义节点。每个插件是一个**独立目录**,用 **TypeScript** 编写,自带 `package.json` / `build.mjs` / `src/index.tsx` / `dist/`,互不耦合,可单独构建、发布、升级。

内置节点只有文本、图片、视频、音频、生成配置、组六种;其余节点(Markdown、SVG、HTML、3D 全景、便利贴……)都是插件。

作者只写节点 UI 与逻辑,**类型、JSX、宿主 React、构建全部由 [`@dream-canvas/plugin-sdk`](./sdk/README.md) 提供**,写 TSX 全程有代码提示;产物仍是宿主加载器现有契约的 ESM(React external、宿主单例)。

## 目录约定

```
plugins/canvas/
  sdk/            # 插件 SDK(类型 + automatic JSX 运行时 + 构建助手)
  template/       # 起步模板:复制它开始写新插件
  markdown/       # 每个插件一个独立目录
    package.json
    build.mjs     # 一行 buildPlugin,产物名取目录名 → dist/markdown.js
    tsconfig.json
    src/index.tsx # 插件源码(默认导出 definePlugin(...))
    README.md
  svg/ html/ panorama/ sticky-note/ ...
```

## 快速开始

```bash
cp -r plugins/canvas/template plugins/canvas/my-plugin
cd plugins/canvas/my-plugin
# 改 package.json 的 name;改 src/index.tsx 里的 id / nodes[].type
npm install
npm run dev        # watch 构建,产物同步到 web/public/plugins/my-plugin.js
npm run typecheck  # tsc --noEmit,类型自检
```

产物名取**目录名**,复制后记得把目录改成插件名。

## 构建 / 发布 / 升级

```bash
cd plugins/canvas/<name>
npm install
npm run build   # → dist/<name>.js,并同步到 web/public/plugins/<name>.js
npm run dev     # watch,改动自动构建并同步
```

把 `dist/<name>.js` 托管到任意静态地址(CDN、GitHub Raw、对象存储),用户在画布「节点插件」管理器填该 URL 安装。升级时重新构建覆盖同一 URL,用户点「更新」即可。

## 官方插件注册表

本仓库插件通过 [`registry/`](./registry/README.md) 集中构建并同步到 `web/public/plugins/official/`，画布「节点插件」面板的官方插件区默认读取本地清单。未构建时显示空列表；需要自行托管时可用 `VITE_PLUGIN_REGISTRY_URL` 指定清单地址。第三方插件仍支持通过 JS URL 安装。

## 本地开发

`npm run dev` 起 watch,产物会同步到 `web/public/plugins/<name>.js`。此后有两种方式在画布里用到它:

**方式一(推荐):自动发现。** 画布启动时会扫描 `web/public/plugins/` 下的插件,自动加入「节点插件」管理器列表,**默认关闭**;打开开关即启用。无需手动填 URL,启用时会按文件重新拉取,配合 watch 改完刷新即最新。

**方式二:`VITE_DEV_PLUGINS`。** 在 `web/.env.local` 声明(逗号分隔多个),这些插件每次刷新页面都**重新拉取并直接激活**(不缓存、不落库、无开关):

```env
VITE_DEV_PLUGINS=/plugins/markdown.js,/plugins/svg.js
```

再起画布 `web`(`npm run dev`)。流程即:改 `src/index.tsx` → watch 自动构建 → 刷新画布看到最新效果,无需反复安装。

## 用 SDK 写插件

默认导出 `definePlugin({...})`(对象形式,**无需再 `const { React } = runtime`**):

```tsx
import { definePlugin, useState } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@dream-canvas/plugin-sdk";

function Content({ ctx }: CanvasNodeContentProps) {
    const [n, setN] = useState(0);
    return (
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setN((v) => v + 1)} style={{ color: ctx.theme.node.text }}>
            {ctx.node.title}: {n}
        </button>
    );
}

export default definePlugin({
    id: "my-plugin",
    name: "我的插件",
    version: "1.0.0",
    css: "…",                 // 可选:插件样式,自动注入/清理
    nodes: [ /* CanvasNodeDefinition[] */ ],
    setup(app) { return () => {}; }, // 可选,返回清理函数;app 含 injectCSS/emit/on
});
```

SDK 导出的 hooks(`useState/useEffect/useMemo/useRef/...`)运行时转发宿主 React,类型来自 `@types/react`。SDK 与依赖接入见 [`sdk/README.md`](./sdk/README.md)。

### CanvasNodeDefinition

```ts
{
    type: string;                 // 建议 "<pluginId>:<name>",全局唯一
    title: string;                // 创建菜单/默认标题
    icon: ReactNode;              // emoji 字符串或任意 ReactNode
    description?: string;
    defaultSize: { width, height };
    defaultMetadata?: object;     // 新建节点初始 metadata(文本内容放 content)
    minimapColor?: string;
    showInCreateMenu?: boolean;   // 默认 true
    hasSourceHandle?: boolean;    // 右侧输出连接点,默认 true
    keepAspectRatio?: (node) => boolean;
    resource?: (node) => { kind: "text"|"image"|"video"|"audio", text?, url? } | null; // 作为上游输入被消费时输出什么
    Content: ({ ctx }) => ReactNode;         // 节点主体渲染
    Panel?: ({ ctx, onClose }) => ReactNode; // 可选:节点下方面板
    toolbar?: (ctx) => Array<{ id, title, label, icon, onClick, danger? }>; // 追加到 hover 工具栏
    onDoubleClick?: (ctx) => boolean;        // 返回 true 表示已处理双击
}
```

### ctx:节点与画布交互接口

`Content` / `Panel` / `toolbar` 都会拿到 `ctx`(类型 `CanvasNodeContext`):

| 能力 | 说明 |
| --- | --- |
| `ctx.node` | 当前节点数据(含 `metadata.content` 等) |
| `ctx.theme` / `ctx.scale` | 当前画布主题 token 与缩放,用来让 UI 跟随主题 |
| `ctx.updateMetadata(patch)` | 更新自身 metadata(如保存内容) |
| `ctx.updateNode(patch)` | 更新自身 title/width/height |
| `ctx.getNode(id)` / `ctx.getNodes()` / `ctx.getConnections()` | 读画布 |
| `ctx.getUpstream()` / `ctx.getDownstream()` | 取上/下游相连节点 |
| `ctx.applyOps(ops)` | 用画布指令集增删节点/连线、选择、触发生成(见下) |
| `ctx.emit(event, payload)` / `ctx.on(event, handler)` | 节点/插件间事件通信 |
| `ctx.ai` | 绑定当前项目和节点，经业务后端提交生成；按渠道模型的声明传递参数，真实链路仍待验收 |
| `ctx.storage` | 按账号与插件隔离的浏览器偏好缓存；项目内容写入节点 metadata，媒体引用服务端资产 |

> `metadata` 的**内置字段**(content、status、model…)是强类型;插件写入的**自定义字段**读出为 `unknown`,按需 `as` 断言(参考 `sticky-note` 的 `pluginColor`)。

`ctx.ai.generateImage` 的 `images` 返回当前账号可访问的稳定资产地址；无需转换成 Base64，可直接预览并保存到节点。生成前会保存目标节点并检查项目版本，保存失败或发生冲突时不提交供应商。完整后端化范围与当前限制见 [Unreleased](../../CHANGELOG.md#已确认的后端化规划待实施)。

生成选项统一使用 `parameters` 传递当前渠道模型声明的参数，例如 `ctx.ai.generateVideo(prompt, { model, parameters: { duration: 6 } })`。参数名和类型以管理员配置为准，尺寸、时长与供应商单次返回张数均放在此对象中；不支持未声明参数。缺省值依次取节点已保存值、个人模型默认值、管理员模型默认值，提交前固定到节点与任务记录中。

### 画布指令集(ctx.applyOps)

```ts
ctx.applyOps([
    { type: "add_node", id?, nodeType, title?, x?, y?, width?, height?, metadata? },
    { type: "update_node", id, patch?, metadata? },
    { type: "delete_node", id? | ids? },
    { type: "connect_nodes", fromNodeId, toNodeId },
    { type: "delete_connections", id? | ids? | all? },
    { type: "select_nodes", ids },
    { type: "set_viewport", viewport },
    { type: "run_generation", nodeId, mode?, prompt? },
]);
```

## 重依赖 / 资源

- **重依赖**(three.js、marked 等):不要打进 bundle,运行时 `await import("https://esm.sh/...")` 动态加载(esbuild 自动 external);在 `src/env.d.ts` 声明该模块以通过 tsc。参考 `panorama/`、`markdown/`。
- **CSS**:写独立 `.css`,`import css from "./styles.css"` 拿到字符串(esbuild `text` loader),放到 `css` 字段自动注入/清理;`src/env.d.ts` 声明 `*.css`。参考 `markdown/`。
- **HTML**:HTML 节点把 HTML 字符串塞进 sandbox iframe 的 `srcDoc`,自带 `<style>`,不需要插件级 CSS。参考 `html/`。

## 兼容说明

加载器仍接受**默认导出为工厂函数** `(runtime) => CanvasPlugin`(用 `runtime.React`)或**普通对象**;老的 JS 插件无需改动即可运行。SDK 的 automatic JSX 让新插件走对象形式,更简洁。

## 注意

- 插件代码会在画布页面内**直接执行**，可访问当前账号页面、草稿及同源 API；渠道密钥保存在业务后端。插件不是隔离环境，只应安装可信来源。
- 交互控件记得 `onMouseDown={(e) => e.stopPropagation()}`(避免触发节点拖拽),滚动区域加 `onWheel={(e) => e.stopPropagation()}` 与容器 `data-canvas-no-zoom`(避免被画布缩放拦截)。
