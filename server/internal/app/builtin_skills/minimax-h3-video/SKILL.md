---
name: minimax-h3-video
description: 为 MiniMax H3 编写文生、关键帧和多参考音画提示词，将剧本、分镜和真实素材绑定为画布中的独立视频任务。
---

# MiniMax H3 音画镜头 / MiniMax H3 audiovisual shots

本技能提供 H3 提示词编排方法，不安装第三方 CLI，不调用外部生成网站，不修改接口脚本或渠道。先核对用户选定 H3 条目的有效定义；名称相同不证明连接支持全部能力。

## 选择模式 / Choose the actual mode

策划上区分 T2VA（文本）、I2VA（首帧）、FL2VA（首尾帧）、L2VA（尾帧）、Ref2VA（多参考）。这些是提示词语义，不是可以直接塞进参数的新枚举。以 `catalog_list` 返回的 mode 与素材字段映射；未声明的模式不提交。尤其只有“首帧必需、尾帧可选”的条目不能执行尾帧单独输入。时长、分辨率、比例、素材数量和音轨能力来自当前条目，不沿用网站或教程的固定范围。

Distinguish text, first-frame, first/last-frame, last-frame and full-reference intentions, then map only to modes the configured adapter exposes. These names are not new parameter values. A required first frame prevents last-frame-only input. Use current effective limits rather than a tutorial's duration or resolution defaults.

## 基础音画正文 / Base audiovisual prompt

正文通常用英文描述镜头，用户台词和可见文字保留原语言。按顺序使用下面三个字段；这是一个 prompt 字符串，不是请求 JSON 新字段：

```text
integrated_multimodal_description: [Shot 1] Live action. A medium close-up frames the established character beside the open drawer. She lifts the envelope with her right hand, studies the seal, then looks toward the doorway. The camera slowly pushes toward her face. The woman with a quiet, steady voice (S1) says, <d>[Mandarin Chinese] 原封未动的台词</d>. Her fingers stop at the unbroken seal.

overall_soundscape: A ventilation hum continues under the soft rustle of paper.

non_diegetic_music: N/A
```

示例只说明语法，人物动作和台词应替换为用户剧情。首镜 `[Shot 1]` 不加切镜时间，后续有意切镜用 `[Shot 2] At 00:03.500, ...`；时间必须递增并落在实际片长内，不为凑结构强行切镜。首帧任务先说明真实 Picture 1 为起点；首尾帧任务说明两图分别锚定开头和结尾，描述中间过程而非重复两张静态图。

Use the three ordered labels above as one prompt. Preserve original dialogue and visible text. First shot has no cut timestamp; later cuts use increasing `MM:SS.mmm` times within the actual duration. Reference a real opening image at the start, and describe a plausible path to a bound final frame when supported. Do not invent cuts merely to fill a format.

## 多参考正文 / Full-reference prompt

先做挂图表：真实资产 ID、媒体类型内的顺序、提示标签、唯一用途。图片 `<Picture 1>`、视频 `<Video 1>`、音频 `<Audio 1>` 分别按实际提交顺序编号；不能按画布位置、文件名或全媒体混排猜编号。`<Subject N>` 表示被引用的人物、场景、物件或动作内容，不是额外上传项，也不等于说话人。

完整正文按六段顺序一次提交：

1. `subject_definitions`：定义真正会使用的主体及来源。身份、服装、空间、构图、动作、声线各自说明用途；作具体首帧的图片另外说明帧锚点。
2. `summary`：概述目标片段和参考关系。参考视频只提供运镜时属于 reference generation，不能自动宣称 video editing；只有能力与实际用途都支持才规划编辑或续接。
3. `retention_analysis`：对已定义内容写保留或变化的属性，可用 fully_preserved、partially_preserved、attribute_transfer、weak_reference。音频的 signal reuse（fully_copy / partially_copy）和 timbre/style reference 要区别；不把参考声线说成已复制声音。
4. `detailed_description`：先写整体美术方向，再按镜头时间写构图、主体位置和初始状态、动作、运镜、光源、声音与结束。引用标签在真正生效的位置出现，不能只列素材关系而没有可生成动作。
5. `overall_soundscape`：贯穿的环境与物理声；同步动作声也可在对应动作处描述，不重复完整对白。
6. `non_diegetic_music`：观众听到而角色听不到的配乐，写具体器乐、节奏和变化，无配乐用 N/A。场内收音机等属于画内声。

Build an explicit asset-to-label table before writing. Number images, videos and audio separately in actual submission order. Subject labels identify reusable content, not extra uploads or speaker IDs. Submit all six ordered sections together. Define reference roles, summarize the actual task, state preserved or transferred attributes, and describe concrete shot action with references at their point of effect. Distinguish sound-signal reuse from voice/style reference; never promise unsupported editing, continuation or exact audio copying.

## 对白与连续性 / Dialogue and continuity

实际发声来源使用稳定 `(S1)`、`(S2)`，与 Subject 编号独立；第一次发声交代可见身份、画内/画外、音色语气。对白紧接说话动作，只在 `<d>[语言] 原文</d>` 出现一次，标签外写表演说明。人物做旁白时注明画内嘴闭合；听者有清楚的不说话反应，避免两个正脸抢口型。跨镜同一句话可用 `<scenetrans>` 标记交接并说明连续，明确要求末尾截断才用 `<cutoff>`，不要凭空补台词。对用户必须保留的文字不翻译、不润色。

为相邻镜头记录同一人物造型、道具归属与状态、光位、地标、视线和动作交接。对白过长就提出拆镜或延长到合法时长，不按固定语速公式承诺完整说完。用户只要提示词时给出挂图顺序与完整正文；要求生成时绑定真实素材，记录参数、任务和结果。不确定任务先找回，不用“换个通道再试”替代核对。

Assign stable speaker IDs independently from subject labels. Put exact dialogue once inside `<d>[Language] ...</d>` beside the speaking action, with performance outside. Distinguish voiceover from visible speech and give listeners closed-mouth reactions. Preserve required wording. Cross-cut lines may use `<scenetrans>`; `<cutoff>` is only for intentional truncation. Maintain costume, props, light, landmarks, eyelines and action handoffs. Split excessive dialogue instead of promising a fixed delivery rate. Deliver prompts only when requested; otherwise bind real assets, submit supported tasks and recover uncertain results before any new generation.
