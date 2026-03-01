[step10] 2026-03-01T20:35:34.470Z
$ 我来分析这篇论文并生成总结。首先让我仔细阅读PDF内容的关键部分。

基于PDF内容的分析，我来生成论文总结：

```markdown
# MovieTeller: Tool-augmented Movie Synopsis with ID Consistent Progressive Abstraction

**ArXiv ID**: 2602.23228
**发表日期**: 2026-02-27
**作者**: Yizhi Li; Xiaohan Chen; Miao Jiang; Wentao Tang; Gaoang Wang
**原文链接**: https://arxiv.org/abs/2602.23228
**PDF 链接**: https://arxiv.org/pdf/2602.23228

## 研究问题

传统的视频摘要任务通常只关注简短的视频片段或静态图像，难以处理完整的电影叙事。现有方法在保持角色/实体ID一致性方面存在困难，且缺乏对复杂长视频剧情的深度理解能力。本文研究如何利用工具增强的大型语言模型来生成长篇电影的连贯剧情摘要，并保持角色身份的一致性。

## 核心方法

本文提出MovieTeller框架，采用**ID一致性的渐进式抽象（ID Consistent Progressive Abstraction）**方法：

1. **工具增强架构（Tool-augmented）**：集成多种工具（如场景检测、视频理解、OCR等）辅助模型处理视频内容
2. **渐进式抽象**：采用分层处理方式，从场景级别→情节级别→完整剧情逐步抽象
3. **ID一致性机制**：在摘要生成过程中维护角色/实体身份的一致性，避免身份混淆
4. **利用多模态大模型**：结合Qwen2.5-VL、InternVL3等先进VLM进行视频理解

## 主要结论

- MovieTeller能够生成长达数千字的连贯电影剧情摘要
- ID一致性机制显著提升了角色追踪的准确性
- 工具增强方法相比纯端到端模型在复杂剧情理解上表现更好
- 在ROUGE、BLEU、BERTScore等指标上取得显著提升
- 渐进式抽象策略有效降低了长视频处理的计算复杂度

## 潜力评估

- **相关度评分**: 8/10
- **创新性**: 高
- **实用性**: 中高
- **推荐理由**: 该工作将LLM代理理念引入视频内容理解，提出了处理长视频剧情的新范式。ID一致性机制对于多角色场景理解具有重要参考价值，工具增强的思想与当前Agent Runtime发展方向高度契合。

## 关键词标签

`Tool-augmented` `Video Understanding` `Movie Synopsis` `ID Consistency` `Progressive Abstraction` `Multi-modal LLM` `Agent`

## 引用

@article{li2026movieteller,
  title={MovieTeller: Tool-augmented Movie Synopsis with ID Consistent Progressive Abstraction},
  author={Li, Yizhi and Chen, Xiaohan and Jiang, Miao and Tang, Wentao and Wang, Gaoang},
  journal={arXiv preprint arXiv:2602.23228},
  year={2026}
}
```

现在让我更新meta.json文件，添加这篇论文的分类信息：

```json
{
  "name": "NLP and Large Language Models",
  "description": "大型语言模型、指令微调、对齐、推理优化",
  "keywords": [
    "LLM",
    "transformer",
    "RLHF",
    "RAG"
  ],
  "arxiv_categories": [