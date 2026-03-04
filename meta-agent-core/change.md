之前运行/survey_agent_python项目的轨迹存在survey_agent_python/.agent，帮我发现meta-agent-core工作时的bug并修复,目前已经发现的问题包括:
1. terminal.md不需要展示完整的输入输出, 只记录输入输出的来源即可. 但是目前你没有展示完整的引用源, 需要如下修改:
修改 `meta-agent-core/src/core/trace.ts` 中的 `formatAsMarkdown` 方法：
- **read 操作**：只显示文件路径和 `[read X bytes]`-->文件路径需要完整展示，不要截断, 如果有多个文件, 每个文件路径单独一行展示
- **write 操作**：只显示文件路径和 `[written]`-->文件路径需要完整展示，不要截断, 如果有多个文件, 每个文件路径单独一行展示
- **bash 操作**：只显示命令和 `[executed]` 状态-->不用调用LLM和裁剪,直接把bash终端的输出原封不动复制到这里展示
- **collect 操作**：只显示查询来源和收集到的来源数量-->来源的引用(文件路径、由Seq变量记录的trace里面的行数)需要完整展示，不要截断, 如果有多个来源, 每个来源单独一行展示
- **llmcall 操作**：只显示输入预览和 `[LLM response]`-->输入预览和输出预览，参考bash终端的规则，采用截断展示的方法, 截断窗口大小应该在AGENT.md里面配置
2. .agent/trace.jsonl里面记录的其它riskReason, 都需要修复导致其报错的背后的原因，不能只表面修复，实际上没有work
3. Agent 在执行过程中仍然遇到一些路径问题和工作目录问题, 如pdf有没有被有效下载、解析为文档、执行分析,需要进一步的 prompt 工程来优化。

反复调试survey_agent_python/run.py并观察新存放在survey_agent_python/.agent下的terminal.md和trace.jsonl，发现新问题、解决问题，直到没有问题为止(启动新调试之前先拷贝一份旧的survey_agent_python/.agent/terminal.md和survey_agent_python/.agent/trace.jsonl, 等新生成这两个文件后，需要读取、分析最新文件，方便发现新问题)。


最后完成工作之后要更新所有相关的README.md文档和survey_agent_python/.agent/AGENT.md(只做必要的修改)，使得项目状态与描述一致。

