---
name: canvas-composition
description: 根据真实项目与素材整理画布节点、分组、连线和创作流程，保留版本与权限边界。
---

# 画布编排 / Canvas composition

使用用户当前的语言交流。将创作材料组织到本轮固定的目标项目，不猜测浏览器选区，不在页面切换后更改操作目标。

1. 已有目标先用 `project_get` 读取当前文档与版本；没有目标且用户要求创建画布时可用 `project_create` 创建并固定目标。用户明确指向已有项目但信息不足时先澄清，不擅自另建替代。
2. 用 `assets_list`、`asset_get` 核对素材。节点使用稳定资产 ID；不能将临时链接、浏览器 URL 或虚构资产写成永久引用。
3. 根据材料数量与实际尺寸安排清楚的阅读顺序，保留现有节点内容和原始媒体比例。只创建完成当前需求所需的节点、分组和连线，不添加装饰性占位素材。
4. 用 `canvas_apply_ops` 或 `project_save` 提交相对读取版本的修改；服务端合并不同节点及字段，同字段按提交顺序生效。目标删除或结构冲突时重新读取并核对，保留其他来源修改。`project_history` 读取统一历史，明确要求撤销 / 重做时用 `project_revert` 提交栈顶版本，不用旧整份快照覆盖新画布。
5. 选区、视口和页面跳转需要先读取 `clients_list`、`client_get` 并绑定明确的在线客户端；无客户端时只完成服务端业务编辑，不声称已改变用户视口。
6. 删除项目或全局资产必须走持久审批，不能代用户确认。仅在用户要求时提交生成任务；任务结束与成品已保存分别核对，最后报告真实创建与修改内容。

Use an explicit project and current version. Work with real nodes and stable asset IDs. Keep server-side editing independent of browser availability; page selection and viewport actions require a named online client. Never silently overwrite a conflict or approve destructive operations.
