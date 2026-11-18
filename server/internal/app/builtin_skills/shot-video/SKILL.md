---
name: shot-video
description: 将分镜和首帧转成独立视频镜头，编写动作、表演、对白、运镜与首尾衔接，适用于 Seedance 等目录中已接入的视频模型。
---

# 分镜转镜头视频 / Storyboard to video shots

用户已指定模型或首帧就保持该选择。点名模型不代表必须文生；需要角色一致性时优先使用已有真实参考。MiniMax H3 的专用写法可用 `skill_get` 读取 `minimax-h3-video`。

1. 从镜头记录提取开场、动作因果、结束和相邻衔接；先读有效定义判断是文生、图生、首尾帧还是多参考。首帧图是实际起点，多参考图只按指定用途参考，不能混为同一语义。
2. 正文按可观察顺序描述：起始构图与身份 → 主要动作及接触反馈 → 表情或环境反应 → 结束状态。运镜服务信息揭示，每个连续镜头给一个清楚的主要运动，避免互斥堆叠。写重量、重心、持物手、目光和环境声，不只堆“电影感、超清、震撼”。风格沿用项目，真人与动画不互相强制替换。
3. Seedance 等自然语言模型使用连贯简洁的画面描述。对白紧跟实际说话动作、保留原文只写一次；嘴部、语气和听者反应清楚，画外音不让画内人物开口。只有实际模型具备音画能力才把声音作为生成目标，否则单独交声音方案或用户要求的 TTS，不能承诺口型同步。
4. 按有效时长分配动作与自然语速。内容过密时先拆镜或缩减非必要动作；不要改写必须保留的台词。时间点为生成意图，不是逐帧保证。首尾帧之间要有物理可行路径，最后落到目标构图；当前接口不支持尾帧单独输入时不伪造该模式。
5. 使用干净首帧、必要角色/场景/道具参考和真实字段创建镜头任务，制作说明不混入正文。不确定的原任务先查询恢复，不自动重投或换渠道。交付独立成品、镜序及剪辑衔接说明；没有拼接工具就不宣称已导出整片。

Honor the chosen model and distinguish a real first frame from identity or style references. Describe visible starting state, causal action, reaction and ending state with purposeful camera movement. Natural-language models such as Seedance benefit from concrete connected prose. Attach each exact line once to its speaker, and distinguish off-screen voice. Audio generation and lip sync depend on real model capabilities. Fit action and delivery to supported duration; timing is intent, not a frame guarantee. Bind real clean references and actual parameters. Deliver generated clips and an honest edit handoff rather than a fictional assembled film.
