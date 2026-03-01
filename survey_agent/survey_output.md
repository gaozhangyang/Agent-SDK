我来执行获取论文的任务。根据脚本的使用方式，需要指定日期范围。

```bash
cd /Applications/workspace/ailab/research/agent_runtime_core_final/survey_agent && \
python scripts/fetch_arxiv.py \
  --categories "cs.AI,cs.LG,cs.CV,cs.CL" \
  --max-results 100 \
  --start-date 20260302 \
  --end-date 20260302 \
  --output data/raw_papers_2026-03-02.json
```

让我执行这个命令：

```json
{"uncertainty": {"score": 0.1, "reasons": ["用户指定的日期是2026年，需要确认arXiv API是否返回该日期的论文（当前系统时间可能是2025年）", "网络请求可能存在不确定性"]}}
```