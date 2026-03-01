[step2] 2026-03-01T18:15:18.665Z
$ 我需要完成以下任务：
1. 读取原始论文数据 data/raw_papers_2026-03-02.json
2. 根据各板块的meta.json信息筛选论文
3. 评分阈值设为7.0
4. 输出筛选后的论文到 data/selected_papers_2026-03-02.json

让我先查看原始数据和各板块的meta信息：
<minimax:tool_call>
<invoke name="Read">
<parameter name="file_path">data/raw_papers_2026-03-02.json</parameter>
</invoke>
</minimax:tool_call>