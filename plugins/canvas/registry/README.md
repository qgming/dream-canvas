# 本地插件注册表

集中构建仓库中的 Markdown、SVG、HTML、全景与便利贴插件，生成 `official-plugins.json`。产物写入本目录 `dist/` 并同步到 `web/public/plugins/official/`，均不提交到 Git；独立子目录避免与开发插件的自动发现重复。

```bash
cd plugins/canvas/registry
npm install
npm run build
```

完成后打开画布的节点插件管理器，即可从本地清单安装。新增插件时在 `build.mjs` 的 `OFFICIAL` 中登记，版本取自各插件的 `package.json`。

前端默认读取 `/plugins/official/official-plugins.json`，未构建时显示空列表。若自行托管，将 `dist/` 上传到静态服务器，并用 `VITE_PLUGIN_REGISTRY_URL` 指向清单。清单中的相对 `entry` 会以清单地址为基准解析。

仓库不包含自动发布工作流，也不依赖远程发布分支。第三方插件仍可通过 JS URL 安装。
