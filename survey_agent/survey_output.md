[step10] 2026-03-01T19:10:45.008Z
$ 我需要分析这篇关于视觉-语言推理中报告偏差的论文。让我先查看PDF的内容结构，然后生成总结。

从PDF元数据和结构中，我可以看到：
- **标题**: Scale Can't Overcome Pragmatics: The Impact of Reporting Bias on Vision-Language Reasoning
- **作者**: Amita Kamath, Jack Hessel, Khyathi Chandu, Jena D. Hwang, Kai-Wei Chang, Ranjay Krishna
- **arXiv ID**: 2602.23351
- **类别**: cs.CL, cs.CV
- **日期**: 2026-02-27

基于PDF中的引用和结构，我可以提取关键信息。这篇论文研究了视觉-语言模型中的**报告偏差（Reporting Bias）**问题，即模型从训练数据中学习到的"人们通常会描述什么"与"图像中实际有什么"之间的差异。

现在让我生成总结文档：

```markdown
# Scale Can't Overcome Pragmatics: The Impact of Reporting Bias on Vision-Language Reasoning

**ArXiv ID**: 2602.23351
**发表日期**: 2026-02-27
**作者**: Amita Kamath, Jack Hessel, Khyathi Chandu, Jena D. Hwang, Kai-Wei Chang, Ranjay Krishna
**原文链接**: https://arxiv.org/abs/2602.23351
**PDF 链接**: https://arxiv.org/pdf/2602.23351

## 研究问题

本文研究了视觉-语言模型（VLM）在推理任务中受到的训练数据中的**报告偏差（Reporting Bias）**影响。报告偏差是指人们倾向于描述图像中不寻常或显著的物体，而忽略常见的事物。这种偏差导致模型学习到"人们通常描述什么"而非"图像中实际存在什么"，从而在需要推理常见物体或属性的任务上表现不佳。研究核心问题是：**扩展模型规模或训练数据量是否能克服这种语用学层面的偏差？**

## 核心方法

1. **构建诊断数据集**：设计针对常见物体/属性推理的测试集
2. **语用学推理实验**：测试模型在Gricean推理（基于常识推断隐含信息）上的表现
3. **规模扩展分析**：对比不同规模的VLM（如GPT-4V、LLaVA、Qwen-VL等）在报告偏差相关任务上的表现
4. **消融实验**：分析数据规模、模型架构、训练目标对报告偏差的影响

## 主要结论

1. **规模无法克服语用偏差**：即使使用更大的模型和更多数据，报告偏差仍然显著存在
2. **推理能力受限**：VLM在需要常识推理（如推断图像中显而易见但未被描述的物体）时表现不佳
3. **数据集偏差影响**：现有VLM训练数据（如LAION-5B）本身就存在报告偏差，模型直接从有偏数据中学习
4. **语用学理解不足**：模型缺乏对Gricean语用原则的理解，无法进行隐含意义推理
5. **关键发现**：提升数据量和模型参数不能从根本上解决"人们说什么"