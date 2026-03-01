[step10] 2026-03-01T19:17:58.010Z
$ # 论文深度分析

## 已有信息提取

从PDF元数据和arXiv页面链接中提取到：

- **标题**: Retrieve and Segment: Are a Few Examples Enough to Bridge the Supervision Gap in Open-Vocabulary Segmentation?
- **ArXiv ID**: 2602.23339
- **作者**: Tilemachos Aravanis, Vladan Stojnić, Bill Psomas, Nikos Komodakis, Giorgos Tolias
- **GitHub**: https://github.com/TilemahosAravanis/Retrieve-and-Segment
- **License**: CC BY 4.0

从PDF结构来看，这是一篇关于开放词汇分割（Open-Vocabulary Segmentation）的论文，研究如何用少量示例（few-shot）来弥合监督差距。

```json
{"uncertainty": {"score": 0.7, "reasons": ["PDF内容被压缩(FlateDecode)，无法直接提取正文文本", "需要更详细的实验数据来生成完整的总结", "建议下载后用文本提取工具获取完整内容"]}}
```

由于PDF内容是压缩的，我需要使用工具来提取文本。让我尝试用Python来提取：
<minimax:tool_call>
<invoke name="Bash">
<parameter name="command">cd /Applications/workspace/ailab/research/agent_runtime_core_final/survey_agent && python3 -c "
import subprocess
result = subprocess.run(['pdftotext', 'data/pdfs/2602.23339.pdf', '-'], capture_output=True, text=True, timeout=60)
print(result.stdout[:15000])
print('---STDERR---')
print(result.stderr[:2000])
"</parameter>
</invoke>
</minimax:tool_call>