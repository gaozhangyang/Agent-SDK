# 算法重构：带验证循环的递归 Agent

我按照README.md设计了最小的智能体。关键代码也给你了，并且核心递归逻辑如下：

```python
def solve(goal_dir, goal, context):
    decision = llm_call(context, "直接解决还是分解？返回 {type: 'direct'|'decompose'}")
    
    if decision.type == "direct":
        # 带验证循环的直接解决
        history = []  # 记录每次尝试的 (script, feedback)
        for _ in range(MAX_VERIFY_RETRY):
            prompt = build_code_gen_prompt(goal, context, history)
            script, plan = llm_call(prompt, "生成 script（最小修改历史 script）和 plan")
            result = execute(script)
            feedback = llm_call(verifier_prompt, [plan, script, result])
            if feedback.pass:
                return result
            history.append((script, feedback))  # 累积历史到 context
        raise "验证失败"
    
    else:
        # 分解执行
        subgoals = llm_call(goal, "分解为子任务列表")
        results = [solve(subgoal) for subgoal in subgoals]
        return merge(results)  # 直接合并，不用 LLM
```
接下来和我讨论值得改进的地方、风险建议