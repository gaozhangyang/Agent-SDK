Analyze this task and decide whether to solve it directly or decompose it into subtasks.

Goal:
{goal}

Context:
{context}

## 决策标准

在返回 "direct" 之前，先回答以下两个问题：
1. 完成这个目标需要哪些具体信息（文件路径、接口格式、工具用法、skill 说明）？
2. 这些信息是否已经完整地出现在 context 中？(不能是文件的引用, 如名称、路径、宏观描述; 而是要能直接在python代码里面可用的代码context信息, 如from XXX import func; out = func(input))

两个问题都是"是" → 返回 "direct"。
任何一个是"否" → 返回 "decompose"。

## 有信息缺口时：分解为 [explore, execute]

把探索步骤作为第一个子任务，主任务 depends_on 探索任务：

```json
{{
  "type": "decompose",
  "subtasks": [
    {{
      "name": "explore_environment",
      "description": "读取 [具体文件/工具/skill]，在 OBSERVATIONS 中输出：[列出下游任务需要的具体信息，例如：skill 的调用命令、输入输出格式、文件实际路径]",
      "depends_on": []
    }},
    {{
      "name": "execute_main_task",
      "description": "主任务描述。所需信息已在父节点 context 中（由 explore_environment 提供）。",
      "depends_on": ["explore_environment"]
    }}
  ]
}}
```

explore 子任务的 description 必须明确说明：
- 要读取什么
- 下游任务需要从 OBSERVATIONS 中获取什么具体信息

## 分解时的四段式子任务描述

每个子任务的 description 必须包含四段：

## 任务
（做什么）

## 输出要求
（需要输出什么，具体到信息粒度，不是泛泛的"输出结果"）

## 输出用途
（下游哪个子任务会消费这个输出，用于做什么；
  若无下游子任务，写"输出给父节点用于最终结果"）

## 后续兄弟任务
（当前任务完成后，接下来还有哪些任务，每个任务一行简要描述；
  observer 结合此信息判断哪些 observation 对后续任务有直接帮助；
  若无后续任务，此段留空或省略）

Example:
```json
{{
  "type": "decompose",
  "subtasks": [
    {{
      "name": "fetch_papers",
      "description": "## 任务\n从 arXiv 获取论文\n\n## 输出要求\n返回论文列表，每项包含 title, authors, abstract, url\n\n## 输出用途\n输出给 screen_papers 用于筛选相关论文\n\n## 后续兄弟任务\n- screen_papers：根据关键词筛选论文，需要知道每个主题的筛选阈值\n- write_summary：生成论文摘要报告，需要通过筛选的论文列表",
      "depends_on": []
    }},
    {{
      "name": "screen_papers",
      "description": "## 任务\n根据关键词筛选论文\n\n## 输出要求\n返回通过筛选的论文列表，每项包含 title, relevance_score, reason\n\n## 输出用途\n输出给 write_summary 用于生成摘要\n\n## 后续兄弟任务\n- write_summary：生成论文摘要报告，需要通过筛选的论文列表",
      "depends_on": ["fetch_papers"]
    }},
    {{
      "name": "write_summary",
      "description": "## 任务\n生成论文摘要报告\n\n## 输出要求\n返回 Markdown 格式的摘要报告\n\n## 输出用途\n输出给父节点用于最终结果\n\n## 后续兄弟任务\n（无后续任务）",
      "depends_on": ["screen_papers"]
    }}
  ]
}}
```

子任务名称规则：
- 只允许字母、数字、下划线、连字符 (a-z, A-Z, 0-9, _, -)
- 不能包含空格、斜杠、冒号或其他特殊字符
- 在列表中必须唯一

## 关键原则

不要用"先试试看"代替"先想清楚"。
如果预见到需要两步完成（先探索，再执行），直接分解，不要寄希望于重试。

## 其他分解考量

- 任务是否包含多个独立的阶段（如：获取数据、处理数据、输出报告）？
- 是否有天然的串行依赖关系？

Return ONLY valid JSON:
```json
{{"type": "direct"}}
```
or
```json
{{"type": "decompose", "subtasks": [...]}}
```
