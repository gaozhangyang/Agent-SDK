

上次运行 `survey_agent_python/run.py` 后的 trace.jsonl 分析： **⚠️ uncertainty 仍为 0.80**: LLM 虽然输出了包含工具调用的提案，但 uncertainty 评分仍为 0.80（超过阈值 0.7）

关于 uncertainty 评分：这是 LLM 本身的行为，虽然我们在 system prompt 中添加了关于工具调用的说明，但 LLM 仍然给出了较高的 uncertainty 评分。这可能需要进一步优化 prompt 或调整阈值，但这已经超出了 change.md 的修改范围。

能不能帮我修改meta-agent-core，使得在AGENT.md中可以设置阈值为运行时参数。改完之后调试survey_agent_python/run.py，严格测试修改的正确性。最后完成工作之后要更新survey_agent_python/README.md文档(只做必要的修改)，使得项目状态与描述一致。
