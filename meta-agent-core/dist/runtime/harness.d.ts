import type { Primitives } from '../core/primitives';
export declare class Harness {
    private primitives;
    private workDir;
    private agentDir?;
    private snapshots;
    constructor(primitives: Primitives, workDir?: string, agentDir?: string | undefined);
    /**
     * 快照：只对可能产生持久副作用的操作调用
     * 使用 git commit 管理版本
     */
    snapshot(label: string): Promise<boolean>;
    /**
     * 回退到最近快照
     */
    rollback(): Promise<boolean>;
    /**
     * 获取快照历史
     */
    getSnapshots(): string[];
}
//# sourceMappingURL=harness.d.ts.map