/**
 * SubgoalOutcome: 子目标的结果类型
 * - completed: 成功完成
 * - voided: 被 Recovery 回滚，此路不通
 */
export type SubgoalOutcome = 'completed' | 'voided';
/**
 * Subgoal: 子目标记录
 */
export type Subgoal = {
    goal: string;
    summary: string;
    outcome: SubgoalOutcome;
};
/**
 * MemoryEntry：结构化记忆记录
 * 每条记录包含用户请求 + 解决结论，形成长期记忆
 */
export type MemoryEntry = {
    ts: number;
    userRequest: string;
    solutionSummary: string;
    sessionId?: string;
    subgoals?: Subgoal[];
};
/**
 * Memory：长期记忆存储
 * 与 Trace 分开维护，专门存储"用户请求 + 解决结论"的结构化记录
 */
export declare class Memory {
    private entries;
    private logFilePath?;
    private pendingWrites;
    private lastWritePromise;
    constructor(logFilePath?: string);
    /**
     * 从文件加载累积的 Memory 条目（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    private appendToFile;
    /**
     * 追加一条记忆记录
     * 在任务开始时调用，记录用户请求
     */
    append(entry: Omit<MemoryEntry, 'ts'>): void;
    /**
     * 更新最后一条记忆的 solutionSummary 和 subgoals
     * 在任务完成时调用，记录总结回答和子目标明细
     */
    updateLastEntry(solutionSummary: string, subgoals?: Subgoal[]): void;
    /**
     * 等待所有待处理的写入完成
     */
    flush(): Promise<void>;
    /**
     * 获取所有记忆
     */
    all(): MemoryEntry[];
    /**
     * 根据 userRequest 关键词检索记忆
     */
    search(query: string): MemoryEntry[];
    /**
     * 获取最近的 N 条记忆
     */
    recent(n: number): MemoryEntry[];
    /**
     * 序列化（JSON 格式）
     */
    serialize(): string;
    /**
     * 获取记忆数量
     */
    size(): number;
}
//# sourceMappingURL=memory.d.ts.map