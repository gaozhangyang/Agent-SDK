端到端测试run.py，联合测试meta-agent-core的状态是否符合预期，可参考meta-agent-core/agent-design-principles-merged.md。请修复bug和不符合预期的地方,上次测试的时候报错信息是:[SDK Error] Cannot read properties of undefined (reading 'length') TypeError: Cannot read properties of undefined (reading 'length')
    at truncateOutput (/Applications/workspace/ailab/research/agent_runtime_core_final/meta-agent-core/src/runtime/loop.ts:20:14)
    at runLoop (/Applications/workspace/ailab/research/agent_runtime_core_final/meta-agent-core/src/runtime/loop.ts:299:57)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Applications/workspace/ailab/research/agent_runtime_core_final/meta-agent-core/src/server/index.ts:215:32。最后更新survey_agent_python/README.md和meta-agent-core/README.md，使得项目状态和描述一致