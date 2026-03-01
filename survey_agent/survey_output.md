[step18] 2026-03-01T20:46:32.374Z
$ 我将分析这篇论文并生成总结。首先让我查看PDF的更多内容和结构信息。

从PDF元数据和引用中，我可以提取到以下关键信息：

**论文基本信息：**
- **标题**: Plug-and-Play Diffusion Meets ADMM: Dual-Variable Coupling for Robust Medical Image Reconstruction
- **作者**: Chenhe Du, Xuanyu Tian, Qing Wu, Muyu Liu, Jingyi Yu, Hongjiang Wei, Yuyao Zhang
- **ArXiv ID**: 2602.23214
- **类别**: cs.CV, cs.LG, eess.IV

**相关工作引用分析**（从PDF annotations可见）：
- 扩散模型: Ho et al. (2020), Song et al. (2020, 2021, 2024), Karras et al. (2022), Dhariwal et al. (2021)
- 图像重建: Rombach et al. (2022), Peebles et al. (2023), Chung et al. (2022, 2024)
- Plug-and-Play方法: Venkatakrishnan et al. (2013), Chan et al. (2016), Kamilov et al. (2023)
- 医学图像: Zhu et al. (2023), Yang et al. (2023), fastMRI (2018)

**GitHub仓库**: https://github.com/duchenhe/DC-PnPDP

现在让我生成完整的论文总结并写入文件：
```markdown
# Plug-and-Play Diffusion Meets ADMM: Dual-Variable Coupling for Robust Medical Image Reconstruction

**ArXiv ID**: 2602.23214
**发表日期**: 2026年2月
**作者**: Chenhe Du, Xuanyu Tian, Qing Wu, Muyu Liu, Jingyi Yu, Hongjiang Wei, Yuyao Zhang
**原文链接**: https://arxiv.org/abs/2602.23214
**PDF 链接**: https://arxiv.org/pdf/2602.23214

## 研究问题

医学图像重建任务（如MRI、CT等）面临两个核心挑战：（1）如何从欠采样或不完整的测量数据中恢复高质量图像；（2）如何在保证重建精度的同时增强模型对噪声、伪影和分布外数据的鲁棒性。传统基于优化的方法（如ADMM）和现代深度学习方法（如扩散模型）各有优缺点，前者具有良好的可解释性和理论基础但难以捕获复杂数据分布，后者生成能力强但计算开销大且缺乏明确的物理约束。

## 核心方法

本文提出 **DC-PnPDP (Dual-Variable Coupling Plug-and-Play Diffusion Prior)**，创新性地将扩散模型作为先验集成到ADMM优化框架中，采用双变量耦合机制实现更鲁棒的医学图像重建：

1. **双变量耦合机制**: 引入两个耦合变量分别处理图像重建的保真度项和先验项，通过交替优化实现扩散先验与传统优化方法的深度融合

2. **Plug-and-Play ADMM框架**: 将去噪扩散概率模型（DDPM/DDIM）作为不可学习的先验模块嵌入ADMM迭代过程，利用扩散模型的强大生成能力捕获医学图像的复杂纹理和结构信息

3. **双重变量更新策略**: 在