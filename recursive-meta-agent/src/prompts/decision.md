Analyze this task and decide whether to solve it directly or decompose it into subtasks.

Goal:
{goal}

Context:
{context}

## 决策标准

在返回 "direct" 之前，先评估以下问题：
1. 我是否清楚完成这个目标需要哪些具体信息（文件路径、接口格式、工具用法）？
2. 这些信息是否已经在 context 中？

如果两个问题都是"是"，返回 "direct"。

如果有信息缺口，返回 "decompose"，并把探索步骤作为第一个子任务：
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

## 关键原则

不要用"先试试看"代替"先想清楚"。
如果预见到需要两步完成（先探索，再执行），直接分解，不要寄希望于重试。

考虑：
- Is the task complex enough to benefit from decomposition?
- Can the task be easily broken into independent subtasks?
- What is the max depth allowed? (from permissions)
- If the task needs file paths, skills, or env info that Context does not clearly provide, consider decomposing with a first subtask like "explore environment / list skills and paths" so the main task gets the needed paths in later context.
