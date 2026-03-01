[step14] 2026-03-01T19:52:47.020Z
$ 我来分析这篇论文并生成总结。让我先从PDF中提取关键信息。

根据PDF元数据和内容分析：

**论文信息：**
- **标题**: Conformalized Neural Networks for Federated Uncertainty Quantification under Dual Heterogeneity
- **作者**: Quang-Huy Nguyen, Jiaqi Wang, Wei-Shinn Ku
- **ArXiv ID**: 2602.23296
- **分类**: cs.LG, cs.AI
- **日期**: 2026年2月

**主要研究内容**：该论文研究联邦学习中的不确定性量化问题，特别关注双重异构性（数据异构性和模型异构性）。提出使用共形化神经网络（Conformalized Neural Networks）来提供可靠的预测区间和不确定性估计。

让我创建总结文件：
```markdown
# Conformalized Neural Networks for Federated Uncertainty Quantification under Dual Heterogeneity

**ArXiv ID**: 2602.23296
**发表日期**: 2026-02-26
**作者**: Quang-Huy Nguyen; Jiaqi Wang; Wei-Shinn Ku
**原文链接**: https://arxiv.org/abs/2602.23296
**PDF 链接**: https://arxiv.org/pdf/2602.23296

## 研究问题
联邦学习中的双重异构性（数据分布异构性和模型架构异构性）给不确定性量化带来挑战。现有方法难以在保护隐私的同时，为每个客户端提供可靠的不确定性估计和预测区间。

## 核心方法
1. **共形化预测（Conformal Prediction）**: 引入基于共形化预测的不确定性量化框架
2. **双重异构性建模**: 同时处理数据异构性和模型异构性
3. **联邦学习框架**: 在分布式数据场景下实现不确定性量化
4. **客户端级校准**: 为每个客户端提供个性化的不确定性估计

## 主要结论
- 提出的方法在多个数据集上实现了有效的 uncertainty quantification
- 能够在联邦学习环境中保持预测区间的覆盖率
- 处理双重异构性时表现出鲁棒性

## 潜力评估
- **相关度评分**: 7/10
- **创新性**: 高
- **实用性**: 高
- **推荐理由**: 联邦学习与不确定性量化的结合是重要研究方向，该工作为分布式机器学习中的可信预测提供了新思路

## 关键词标签
`Federated Learning` `Uncertainty Quantification` `Conformal Prediction` `Deep Learning` `Distributed Systems`

## 引用
```bibtex
@article{Nguyen2026Conformalized,
  title={Conformalized Neural Networks for Federated Uncertainty Quantification under Dual Heterogeneity},
  author={Quang-Huy Nguyen and Jiaqi Wang and Wei-Shinn Ku},
  journal={arXiv preprint arXiv:2602.23296},
  year={2026}
}
```

---
*由 Survey Agent 自动生成于 2026-02-27*
```

现在让我更新meta.json文件：
```json
{
  "name": "Reinforcement Learning",
  "description": "强化学习、策略优化、奖励建模、多智能体系统",
  "keywords": ["PPO", "MCTS", "Multi-agent", "Reward", "RLHF"],
  "arxiv_categories": ["cs.LG", "cs.AI"],
  "created_at": "2025-01-01",
  "updated_at": "2026-02-27",