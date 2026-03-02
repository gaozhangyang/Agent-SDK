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
    seq: number;
    kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' | 'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
    data: unknown;
    confidence?: Confidence;
    uncertainty?: Uncertainty;
    terminal_seq?: number;
    tags?: string[];
};
export type TerminalEntry = {
    ts: number;
    seq: number;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    dry_run?: boolean;
};
/**
 * Trace：推理轨迹
 */
export declare class Trace {
    private entries;
    private seq;
    private logFilePath?;
    private pendingWrites;
    private lastWritePromise;
    constructor(logFilePath?: string);
    /**
     * 从文件加载累积的 Trace 条目（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    private appendToFile;
    append(entry: Omit<TraceEntry, 'seq'>): void;
    flush(): Promise<void>;
    filterByTag(tag: string): TraceEntry[];
    all(): TraceEntry[];
    serialize(): string;
    getSeq(): number;
}
/**
 * TerminalLog：执行终端日志
 */
export declare class TerminalLog {
    private entries;
    private seq;
    private logFilePath?;
    private pendingWrites;
    private lastWritePromise;
    constructor(logFilePath?: string);
    /**
     * 从文件加载累积的 Terminal Log 条目（用于 Session 恢复）
     */
    loadFromFile(): Promise<void>;
    private appendToFile;
    append(entry: Omit<TerminalEntry, 'seq'>): void;
    flush(): Promise<void>;
    all(): TerminalEntry[];
    serialize(): string;
    getSeq(): number;
}
//# sourceMappingURL=trace.d.ts.map