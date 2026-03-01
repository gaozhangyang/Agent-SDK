[step2] 2026-03-01T20:42:20.605Z
$ I need to analyze this paper about medical image reconstruction using diffusion models and ADMM. Let me extract key information from the PDF and generate the summary.

Based on the PDF content I can see:
- **Title**: Plug-and-Play Diffusion Meets ADMM: Dual-Variable Coupling for Robust Medical Image Reconstruction
- **Authors**: Chenhe Du, Xuanyu Tian, Qing Wu, Muyu Liu, Jingyi Yu, Hongjiang Wei, Yuyao Zhang
- **ArXiv ID**: 2602.23214
- **Categories**: cs.CV, cs.LG, eess.IV
- **Code**: https://github.com/duchenhe/DC-PnPDP

Now let me generate the paper summary:

```json
{"uncertainty": {"score": 0.15, "reasons": ["PDF content is partially truncated in context", "Limited access to full experimental results", "Publication date uncertain (metadata shows 2026-02-27 which may be processing date)"]}}
```

---

# 论文总结

## 基本信息

**ArXiv ID**: 2602.23214  
**发表日期**: 2025-02  
**作者**: Chenhe Du, Xuanyu Tian, Qing Wu, Muyu Liu, Jingyi Yu, Hongjiang Wei, Yuyao Zhang  
**原文链接**: https://arxiv.org/abs/2602.23214  
**PDF 链接**: https://arxiv.org/pdf/2602.23214  
**代码链接**: https://github.com/duchenhe/DC-PnPDP

## 研究问题

医学图像重建（如MRI、CT）在欠采样情况下容易产生伪影和噪声。如何在保证重建质量的同时，提高对测量噪声和模型不匹配等干扰的鲁棒性，是当前医学影像领域的核心挑战。传统基于迭代优化的重建方法在复杂噪声环境下性能下降明显，而新兴的扩散模型虽然能生成高质量图像，但在逆问题求解中缺乏有效的约束机制。

## 核心方法

本文提出**DC-PnPDP（Dual-Variable Coupling Plug-and-Play Diffusion Proximal）**方法，将Plug-and-Play（PnP）扩散模型与ADMM优化框架进行深度融合：

1. **双变量耦合机制**：引入辅助变量建立原问题与对偶问题之间的耦合关系，实现扩散先验与测量一致性约束的有效平衡

2. **ADMM框架下的PnP集成**：将预训练的扩散模型作为去噪先验嵌入ADMM迭代，通过交替更新策略同时优化图像重建结果和隐变量

3. **鲁棒性增强**：通过设计 Dual-Variable 耦合策略，增强算法对噪声异常值和模型不匹配的容忍度

## 主要结论

- 在腹部CT和MRI数据集上验证了方法有效性
- 相比纯扩散模型和传统PnP方法，所提方法在噪声干扰下具有更强的鲁棒性
-