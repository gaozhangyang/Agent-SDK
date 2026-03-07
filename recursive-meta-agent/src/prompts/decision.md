Analyze this task and decide whether to solve it directly or decompose it into subtasks.

Goal:
{goal}

Context:
{context}

## 决策标准

在返回 "direct" 之前，先评估以下两个问题：
1. 我是否清楚完成这个目标需要哪些具体信息（文件路径、接口格式、工具用法）？
2. 这些信息是否已经在 context 中？

两个问题都是"是" → 返回 "direct"。

有信息缺口 → 返回 "decompose"，把探索步骤作为第一个子任务：

```json
{{
  "type": "decompose",
  "subtasks": [
    {{
      "name": "explore_environment",
      "description": "具体说明需要探索什么、期望获得什么信息",
      "depends_on": []
    }},
    {{
      "name": "execute_main_task",
      "description": "主任务描述",
      "depends_on": ["explore_environment"]
    }}
  ]
}}
```

## 关键原则

不要用"先试试看"代替"先想清楚"。
如果预见到需要两步完成（先探索，再执行），直接分解，不要寄希望于重试。

其他考量：
- 任务是否足够复杂需要分解？
- 是否能拆成有意义的独立子任务？
- Context 中是否缺少文件路径、skill 用法、环境信息？如果缺少，先分解一个探索子任务。

Return ONLY valid JSON:
```json
{{"type": "direct"}}
```
or
```json
{{"type": "decompose", "subtasks": [...]}}
```