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
