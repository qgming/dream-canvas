---
name: storyboard-images
description: 将剧本或画布文本拆成镜头并生成逐镜分镜图片，组织人物、场景、道具参考与开场站位，适用于文本生成分镜图片。
---

# 文本生成分镜图片 / Script to storyboard images

已有分镜时复用；只有剧情文本时先做必要的镜头拆解。交付必须对应用户要求的范围，联系表、单镜首帧和视频是不同产物。

1. 读取目标项目与用户指向的文本；只在选区已由明确客户端返回时称作当前选区。梳理已有角色、场景、道具和素材，优先复用用户选定版本。关键角色缺少图且要求一致性时，先建立基准，不能把每个镜头当作重新设计人物。
2. 按叙事单元分配 EP01-SH001 等编号。每镜记录信息目的、人物与场景、景别机位、开场站位/手势/持物/视线、动作与结束状态、对白或声音、建议时长和相邻衔接。对话场次先定轴线和开场空间。剧情信息只呈现一次，避免为了镜头数重复拍。
3. 将镜头记录与纯生成正文分开。单镜图片只描述开场或选定关键瞬间，不塞入“然后、最后”多个时刻。正文明确人物身份、服装、前中后景、地标和光源，实际素材按身份/空间/道具/构图分工绑定。图片无镜号、箭头、对白气泡与水印，除非用户要可标记的草稿。
4. 用户要逐镜分镜图片时，为每镜保存文本说明与图片目标节点，按顺序或依赖提交独立生成任务，绑定真实资产。多个不同镜头不能合并成同一提示词加 count。用户仅要一张多宫格审稿图时可交联系表，明确这不是独立图集，也不要默认拿含字草稿作成片首帧。
5. 布局让镜头从左到右、按场次换行，说明和结果对应，已有内容不覆盖。保存镜号→节点→任务→成品资产对应关系，等待后保留成功图及失败项。最后给出可用于视频的首帧与需要用户核对的身份、轴线、手势、光位，不假装自动审图通过。

Read the actual screenplay and reuse existing shot plans and assets. Establish character references and scene geography before dependent frames. Plan each shot's purpose, opening blocking, hands, props, eyeline, action, end state, sound and transition. Keep production records separate from clean model prompts. A still prompt describes one moment. Generate each requested shot as its own node and task with actual references; count is not a shot list. Contact sheets are for review and are not independent first frames. Lay out and report real shot/node/task/asset mappings, preserving partial results.
