---
name: short-film-production
description: 在画布中串联短剧或短片的剧本、角色场景资产、分镜图片和视频镜头制作，支持真人与动画，并整理剪辑交接。
---

# 短剧与短片制作 / Short-drama and short-film production

以用户要求的交付范围决定起点和终点。已有剧本、资产或分镜从该阶段接续；只要求人物三视图或提示词时直接使用对应技能，不启动整条产线。

1. 在目标画布保留一份简短制作记录：故事目标、视觉方向、已明确画幅与时长、对白语言、所选模型、产物范围与已完成镜头。未知项标未定，避免不必要的多轮审批或以模型默认片长冒充全片目标。
2. 需要写作时用 `skill_get` 读取 `short-drama-writing`，形成故事因果与可拍场次。写实项目用具体的场景光源、材质、接触和微表情建立真实感；动画项目沿用指定造型，以预备动作、清楚剪影、重心、跟随动作和表情路径表现情绪，不强制某家工作室画风或统一头身比例。
3. 读取 `film-asset-design` 与需要的 `character-turnaround`。以稳定人物、场景、道具编号建立必要资产，生成依赖的基准先完成。每个真实资产注明身份、空间、服装、道具或动作用途。用户原有设计不因切换镜头而重建。
4. 读取 `storyboard-images`，以剧本、资产和开场调度拆镜，保存人读镜头表与单独的生成正文。用户要求图片时逐镜制作干净首帧，保留每镜实际资产；仅要求文字分镜就停在文字阶段。
5. 用户要视频时读取 `shot-video`；明确使用 MiniMax H3 时再读 `minimax-h3-video`。从已保存图片和有效模型定义选择真实模式，完成独立片段。全片超过单次生成能力时分段，不承诺跨任务精确复制音轨、自动抽尾帧或无缝成片。
6. 交付前用 `film-continuity` 的方法核对文字和真实状态。给出有序的镜号、文本、图片、视频、taskId、assetId、未完成项与外部剪辑交接。部分阶段失败保留已完成节点和任务，只续接缺项。故事、美术或基准变化时先指出影响范围，不自行付费重做整片。

Scope the pipeline to the requested deliverables and reuse completed stages. Keep a concise production record in the fixed canvas. Read only relevant Skills via `skill_get`: writing, asset design and turnarounds, storyboard images, video shots, H3 if selected, and continuity handoff. Live action benefits from physical light, materials, contact and microperformance; animation benefits from anticipation, readable silhouettes, weight, follow-through and expressive poses in the user's art direction. Complete anchor assets before dependent frames, then frames before dependent video. Split work according to actual model capabilities. Track real IDs and partial results, and deliver an honest edit handoff without claiming unsupported assembly or silently regenerating downstream work.
