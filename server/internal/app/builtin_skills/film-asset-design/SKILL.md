---
name: film-asset-design
description: 从影视剧本拆解人物、场景与道具，建立美术设定和参考图，包含空间、机位、服装及状态变体。
---

# 影视美术资产 / Film asset development

从剧本与现有项目中找可复用的真实设计，再补缺项。把固定身份、场次造型与逐镜状态分开，避免每次出图重新创造人物或场景。

- 角色记录年龄感、体态、脸与发型等辨识特征、服装层次和鞋；道具不要长期挡住人物身体。完整三视图任务可通过 `skill_get` 读取 `character-turnaround` 的具体流程。
- 场景先建立无人空间基准图，明确门窗、出入口、主陈设和走位通道；再按实际拍摄需要补侧向或反向机位。反打是摄影机到另一位置，同一门窗和光源仍在同一物理位置，不是原图水平翻转。原图未显示区域的延伸属于新设计，要明确记录。
- 道具单独出图，以轮廓、材质、颜色和尺寸参照保持身份；合拢/打开/破损、干燥/湿润等叙事变化使用变体。记录持有人和出现镜头。不要为普通物件无意义地扩充资产数量。
- 用户只要清单时输出「编号、设定、变体、用途、已有资产、缺少参考」；用户要求出图时建立对应文本说明和图片节点，以实际能力生成。依赖参考的变体必须等基准资产保存成功，再把真实资产传给任务，不凭相同文案声称完成视觉绑定。

Reuse existing designs before adding assets. Separate permanent identity, scene-specific looks and per-shot states. Establish empty location geography before reverse coverage, retaining physical layout and lighting. Define narrative props independently and track meaningful state variants. A requested inventory is text only; requested images use real generation tasks. Wait for saved anchor assets before binding them to dependent variants. Use the character-turnaround Skill for detailed multi-view character work.
