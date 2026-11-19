# @dream-canvas/plugin-sdk

梦想画布节点插件的 **TypeScript SDK**。插件作者只写节点 UI 与逻辑,类型、JSX、运行时桥接、构建全部由 SDK 提供;产物仍是宿主加载器现有契约的 ESM(React external,宿主单例)。

## 提供什么

| 能力 | 说明 |
| --- | --- |
| **完整类型** | `CanvasPlugin` / `CanvasNodeDefinition` / `CanvasNodeContext` / `CanvasAgentOp` / `CanvasTheme` / `CanvasNodeData` … 全部有提示 |
| `definePlugin(...)` | 给插件对象(或工厂)补全类型;对象形式无需再 `const { React } = runtime` |
| automatic JSX | `jsxImportSource` 指向本包,TSX 自动转发到宿主 React,**不打包第二份 React** |
| 类型化 hooks | `import { useState, useEffect, useMemo, useRef, ... }`,运行时转发宿主 React |
| `buildPlugin(...)` | 统一 esbuild 构建,插件 `build.mjs` 只需一行 |

## 最小插件

```tsx
// src/index.tsx
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
    nodes: [
        {
            type: "my-plugin:node",
            title: "示例",
            icon: "✨",
            defaultSize: { width: 240, height: 160 },
            Content,
        },
    ],
});
```

```js
// build.mjs
import { buildPlugin } from "@dream-canvas/plugin-sdk/build";
await buildPlugin(import.meta.url);
```

`npm run build` 仅导出 `dist/<目录名>.js` 供源码开发参考。应用内置节点由前端直接打包，自建节点由后台发布编译；不再扫描或安装浏览器插件目录。

## 依赖接入

插件 `package.json`:

```json
{
    "type": "module",
    "scripts": { "build": "node build.mjs", "dev": "node build.mjs --watch", "typecheck": "tsc --noEmit" },
    "devDependencies": {
        "@dream-canvas/plugin-sdk": "file:../sdk",
        "@types/react": "19.1.12",
        "typescript": "^5"
    }
}
```

插件 `tsconfig.json` 关键项:`"jsx": "react-jsx"`、`"jsxImportSource": "@dream-canvas/plugin-sdk"`、`"moduleResolution": "bundler"`。

## 设计约束

- **React 单例**:JSX 与 hooks 惰性读取 `globalThis.InfiniteCanvasRuntime.React`(宿主在加载插件前注入),react 全程 external,绝不打包第二份。
- **依赖**:后台自建包仅解析包内相对模块、宿主 React 与 SDK，不提供 npm 或远程模块导入。现有内置全景与 Markdown 的源码仍按需加载 three / marked。
- **类型真源**:`src/types.ts` 是宿主 `web/src/types/canvas-plugin.ts` 公开契约的镜像;宿主契约变更时同步此处。

后台草稿必须同时维护 `plugin.json` 和入口，元数据从清单读取，固定插件 ID 不可修改。此 SDK 的独立源码示例需要按当前后台包约定适配，完整流程见 [节点插件说明](../README.md)。

`ctx.ai.generateVideo(prompt, { videos: [...] })` 可传入稳定视频资产地址，原有 `references` 继续仅表示图片，不改变旧调用含义；命名素材仍通过 `parameters` 中声明的 `asset:<id>` 显式绑定。`ctx.ai.stopGeneration()` 调用宿主统一停止确认，刷新或重新打开面板后同样可针对当前节点请求取消；关闭面板本身不取消服务端任务。
