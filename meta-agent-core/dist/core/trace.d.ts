export type Confidence = {
    coverage: number;
    reliability: number;
    gaps: string[];
    by_source: Record<string, number>;
};
export type Uncertainty = {
    score: number;
    reasons: string[];
};
export type TraceEntry = {
    ts: number;
    seq?: number;
    kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' | 'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
    data: unknown;
    confidence?: Confidence;
    uncertainty?: Uncertainty;
    terminal_seq?: number;
    tags?: string[];
    judge_type?: string;
    operation?: string;
    input?: string;
    output?: string;
    durationMs?: number;
};
export type OperationType = 'llmcall' | 'collect' | 'read' | 'write' | 'edit' | 'bash';
export type TerminalEntry = {
    ts: number;
    seq: number;
    operation: OperationType;
    command?: string;
    input?: string;
    output: string;
    exitCode?: number;
    durationMs?: number;
    dry_run?: boolean;
    truncated?: boolean;
};
/**
 * 全局序号管理器 - 统一 seq 序号空间
 * Trace 和 TerminalLog 共享同一个全局递增序号
 */
export declare class GlobalSeqManager {
    private seq;
    private logFilePath?;
    constructor(logFilePath?: string);
    /**
     * 从文件加载累积的 seq（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    /**
     * 获取下一个全局序号
     */
    next(): number;
    /**
     * 获取当前序号
     */
    get(): number;
    /**
     * 设置序号（用于恢复场景）
     */
    set(seq: number): void;
}
/**
 * Trace：推理轨迹
 * 使用全局序号管理器，与 TerminalLog 共享序号空间
 */
export declare class Trace {
    private entries;
    private seqManager;
    private logFilePath?;
    private pendingWrites;
    private lastWritePromise;
    constructor(logFilePath?: string);
    /**
     * 从文件加载累积的 Trace 条目（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    private appendToFile;
    /**
     * 追加 Trace 条目
     * @param entry 忽略 seq 字段，由全局序号管理器分配（除非显式传入）
     */
    append(entry: TraceEntry): number;
    flush(): Promise<void>;
    filterByTag(tag: string): TraceEntry[];
    all(): TraceEntry[];
    serialize(): string;
    getSeq(): number;
    /**
     * 设置全局序号管理器（由外部注入，实现与 TerminalLog 共享）
     */
    setSeqManager(seqManager: GlobalSeqManager): void;
    /**
     * 获取全局序号管理器（供 TerminalLog 共享）
     */
    getSeqManager(): GlobalSeqManager;
}
/**
 * TerminalLog：执行终端日志
 * 支持两种格式：
 * 1. JSON 格式（trace.jsonl）：用于程序解析
 * 2. Markdown 格式（terminal.md）：用于人类阅读
 *
 * 修改：使用全局序号管理器统一 seq、terminal.md 格式优化
 */
export declare class TerminalLog {
    private entries;
    private seqManager;
    private logFilePath?;
    private terminalLogFilePath?;
    private pendingWrites;
    private lastWritePromise;
    private pathAliases;
    private baseDir;
    constructor(logFilePath?: string, terminalLogFilePath?: string, baseDir?: string);
    /**
     * 设置全局序号管理器（由外部注入，实现与 Trace 共享）
     */
    setSeqManager(seqManager: GlobalSeqManager): void;
    /**
     * 初始化路径别名
     */
    private initPathAliases;
    /**
     * 将路径转换为别名形式
     */
    private shortenPath;
    /**
     * 格式化时间为 HH:mm:ss 格式（更简洁）
     */
    private formatTimestamp;
    /**
     * 将 TerminalEntry 转换为人类友好的 Markdown 格式
     *
     * 修改：采用 terminal.md 格式
     * - 路径别名
     * - 操作图标：📖 read · ✏️ write · 🔧 edit · 💻 bash · 🔍 collect · 🤖 llmcall
     * - 折叠块：<details> 收纳 input/output 正文
     * - 截断引用
     * - 耗时标注
     *
     * Markdown 渲染规则：
     * 1. 表格前后必须有空行
     * 2. 表格必须有分隔符行（|---|---|）
     * 3. 表格单元格只放单行纯文本，截断用省略号
     * 4. 多行内容、含 Markdown 语法的内容全部放进 <details> 块
     * 5. </details> 后必须有空行，再写下一个 ## 标题
     */
    private formatAsMarkdown;
    /**
     * 写入 Markdown 格式日志
     */
    private writeMarkdownFormat;
    /**
     * 将内容转换为单行纯文本（用于表格单元格）
     */
    private toSingleLine;
    /**
     * 检查内容是否需要放进 <details> 块
     */
    private needsDetailsBlock;
    /**
     * 添加用户输入记录（USER 角色）
     */
    appendUserInput(message: string): void;
    /**
     * 写入 Markdown 格式日志
     */
    private writeMarkdown;
    /**
     * 从文件加载累积的 Terminal Log 条目（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    private appendToFile;
    /**
     * 追加 Terminal Entry
     * @param entry 忽略 seq 字段，由全局序号管理器分配
     * @param writeTrace 是否同时写入 trace.jsonl（默认 false，避免重复记录）
     *                   只有 loop.ts 层的操作才需要写入 trace.jsonl
     */
    append(entry: Omit<TerminalEntry, 'seq'>, writeTrace?: boolean): number;
    flush(): Promise<void>;
    all(): TerminalEntry[];
    serialize(): string;
    getSeq(): number;
}
//# sourceMappingURL=trace.d.ts.map