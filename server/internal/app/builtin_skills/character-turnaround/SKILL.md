---
name: character-turnaround
description: 在画布中从角色文本或参考图生成正面全身基准、正侧背三视图、独立视角与表情参考，保持同一人物和服装。
---

# 人物三视图 / Character turnaround

目标是供分镜和视频复用的同一角色设计，不是三张独立随机人物。用户已提供清楚的角色参考时直接沿用，不强制重新生成。

1. 读取角色文字与真实参考。确定不变的脸、年龄感、体态、发型、服装层次、材质、配色及鞋，未给出的设计按用户美术方向提出。除非用户要求，基准不带遮挡身体的手持道具。
2. 没有基准时先生成正面全身：中性姿态、自然垂手、头至鞋底完整入画、简洁背景、均匀光线、克制透视。使用角色文本与用户给定参考；任务成功后记录稳定资产 ID。不要在基准仍排队时创建假参考。
3. 用户要一张三视图设定图时，生成一张横向图：从左到右正面、严格 90 度侧面、背面，等高同比例、头脚对齐、清楚间距、同一身份服装、不加剧情或文字。实际绑定基准图，服装背面不可见部分作为设计延伸记录。
4. 用户要三张独立图片时，为正面、侧面、背面分别建节点和独立提示词；基准符合正面要求可直接复用。其余视角都引用同一基准，避免正面→侧面→背面的层层漂移。count 不是三个不同视角，不声称可自动裁开拼图。
5. 表情、头部近景、服装细节按需求补充，继续绑定基准。检查任务与资产实际状态；没有可用视觉读取工具时提供人工核对要点，不宣称已肉眼确认没有走样。用户反馈改设计时保留旧图，指明新基准及受影响镜头。

Use an existing suitable anchor when available. Otherwise create a neutral full-body front view first and wait for its saved asset. For a single turnaround sheet, request aligned front/profile/back views of the same person. For independent views, create separate nodes and tasks, each referencing the same anchor; reuse a suitable front anchor. Image count does not select different view prompts, and a sheet is not automatically cropped. Add expressions or details only when requested. Track real results, changes and downstream dependencies without claiming unperformed visual inspection.
