/**
 * MemoryEntry：结构化记忆记录
 * 每条记录包含用户请求 + 解决结论，形成长期记忆
 */
export type MemoryEntry = {
    ts: number;
    userRequest: string;
    solutionSummary: string;
    sessionId?: string;
    archivedSubgoal?: string;
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
    private appendToFile;
    /**
     * 追加一条记忆记录
     * 在子目标真正完成后，由 Loop 统一调用
     */
    append(entry: Omit<MemoryEntry, 'ts'>): void;
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