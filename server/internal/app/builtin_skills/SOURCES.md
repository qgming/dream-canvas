# 影视提示词与技能编写依据

内置提示词及影视 Skill 由本项目针对自己的画布、服务端资产、动态模型目录、任务等待与版本检查重新编写。以下是编写时阅读的资料；它们不是运行时订阅源，应用不会从这些地址抓取提示词或更新技能。

| 资料 | 核对版本 | 采用的工作流思路 |
| --- | --- | --- |
| [seedance-storyboard-generator-realman](https://github.com/liangdabiao/seedance-storyboard-generator-realman/tree/5f94d9e6cabaa6e838582bdf3406e843299641ca) | `5f94d9e6cabaa6e838582bdf3406e843299641ca` | 剧本→人物/场景/道具→镜头图→视频的依赖、写实动作与表演、制作记录与纯生成正文分开 |
| [tigerowo/infinite-canvas 的 H3 Skills](https://github.com/tigerowo/infinite-canvas/tree/e4bdd2bb1bc97cb2cd9c20c61b8477b7d26a3450/service/skills) | `e4bdd2bb1bc97cb2cd9c20c61b8477b7d26a3450` | H3 文生/关键帧/多参考语义，音画段落、参考标签、说话人和音轨用途；动画前期与镜头交接的分阶段组织 |
| [shuohao-skills](https://github.com/eternityspring/shuohao-skills/tree/8af10e0ea1a550e4575666884f4deef780bf38ff) | `8af10e0ea1a550e4575666884f4deef780bf38ff` README | 人物基准与独立视角、场景美术、开场站位、剧本与分镜分层交接 |
| [drama-skills](https://github.com/zenstory-ai/drama-skills/tree/37232f6d22e174c36e321d2e3a1a3ae871e7d602) | `37232f6d22e174c36e321d2e3a1a3ae871e7d602` README | 短剧阶段划分、人物固定外貌/场次造型/逐镜状态、首帧与动作提示词区分、逐镜连戏与交付 |
| [OpenAI Sora 视频提示指南](https://cookbook.openai.com/examples/sora/sora2_prompting_guide) | 网页资料（页面标为归档） | 可见动作节拍、一个清楚的主要运镜、光线连续、参数与正文分开；不将归档 API 能力带入本项目 |
| [MiniMax H3 产品页](https://metaso.cn/minimax-h3/) | 网页资料 | 核对不同分辨率与片长存在组合差异；不引入页面价格、固定能力范围或默认渠道 |

这些资料的代码与长篇指令未直接复制或捆绑。`tigerowo/infinite-canvas` 使用 AGPL-3.0；本次采用工作流概念并独立表达，未把该仓库实现、CLI、脚本、素材或大段 Skill 文本引入本项目。其 H3 字段名和标记只用于描述对应提示格式。Realman 根目录未提供可据以直接整包复用的许可证，因此同样只作为流程研究依据。其他资料也按独立编写处理。

本项目的 `catalog_list` 有效参数与接口插件始终是可提交能力的依据。参考资料不能证明当前配置支持尾帧单独输入、视频编辑、视频续接、音乐生成、逐帧时码、音轨逐样复制或剪辑导出；内置内容不会自动扩展这些能力。
