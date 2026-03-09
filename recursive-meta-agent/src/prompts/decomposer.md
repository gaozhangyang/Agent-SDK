Break down this task into subtasks.

Goal:
{goal}

Context:
{context}

Return a JSON array of subtasks:
[
    {{"name": "subtask1", "description": "description of subtask 1", "depends_on": []}},
    {{"name": "subtask2", "description": "description of subtask 2", "depends_on": ["subtask1"]}}
]

IMPORTANT: Each subtask description MUST contain four sections:

## 任务
（做什么）

## 输出要求
（需要输出什么，具体到信息粒度，不是泛泛的"输出结果"）

## 输出用途
（下游哪个子任务会消费这个输出，用于做什么；
  若无下游子任务，写"输出给父节点用于最终结果"）

## 后续兄弟任务
（当前任务完成后，接下来还有哪些任务，每个任务一行简要描述；
  verifier 结合此信息判断哪些 observation 对后续任务有直接帮助；
  若无后续任务，此段留空或省略）

Example:
[
    {{"name": "fetch_papers", "description": "## 任务\n从 arXiv 获取论文\n\n## 输出要求\n返回论文列表，每项包含 title, authors, abstract, url\n\n## 输出用途\n输出给 screen_papers 用于筛选相关论文\n\n## 后续兄弟任务\n- screen_papers：根据关键词筛选论文，需要知道每个主题的筛选阈值\n- write_summary：生成论文摘要报告，需要通过筛选的论文列表", "depends_on": []}},
    {{"name": "screen_papers", "description": "## 任务\n根据关键词筛选论文\n\n## 输出要求\n返回通过筛选的论文列表，每项包含 title, relevance_score, reason\n\n## 输出用途\n输出给 write_summary 用于生成摘要\n\n## 后续兄弟任务\n- write_summary：生成论文摘要报告，需要通过筛选的论文列表", "depends_on": ["fetch_papers"]}},
    {{"name": "write_summary", "description": "## 任务\n生成论文摘要报告\n\n## 输出要求\n返回 Markdown 格式的摘要报告\n\n## 输出用途\n输出给父节点用于最终结果\n\n## 后续兄弟任务\n（无后续任务）", "depends_on": ["screen_papers"]}}
]

IMPORTANT: Each subtask name MUST:
- Only contain letters, numbers, underscores, and hyphens (a-z, A-Z, 0-9, _, -)
- NOT contain spaces, slashes, colons, or any special characters
- Be unique within the list
- Example good names: "fetch_papers", "screen-results", "write_summary"
- Example bad names: "fetch papers", "screen/results", "write:summary"

{dependency_error}
