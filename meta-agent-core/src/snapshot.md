最小闭环的阅读路径（从外到内）：

1. `src/index.ts`
   - 看 `createMetaAgent`：如何组装 Trace / TerminalLog / Memory / Primitives / LLM / Harness / Interrupt / StateManager / Hooks，并最终暴露 `MetaAgent.run()`
2. `src/runtime/loop.ts`
   - 看 `runLoop`：五种模式 `plan / execute / review / recovery / paused` 的主循环逻辑，以及中断、终止条件、Collect → Reason → Judge(risk/outcome) → 工具执行 → Recovery 的全流程
3. `src/runtime/state.ts`
   - 看 `AgentState`、`MODE_TRANSITIONS`、`StateManager`：状态结构、模式迁移规则和跨 Session 持久化
4. `src/core/primitives.ts` + `src/runtime/harness.ts`
   - 看原语与执行环境：`bash/read/write/edit` 等工具调用的真实实现，以及 snapshot / rollback 等安全机制
5. `src/core/collect.ts` + `src/core/llm.ts`
   - 看观测与 LLM 封装：`collect(...)` 如何从项目 & skills 收集上下文，`LLMCall` 如何封装 `reason / reasonMulti / judge(...)`
6. `src/core/trace.ts` + `src/core/memory.ts`
   - 看追踪与记忆：`Trace` / `TerminalLog` / `GlobalSeqManager` 如何统一 seq 与日志，`Memory` 如何记录用户请求与子目标总结

