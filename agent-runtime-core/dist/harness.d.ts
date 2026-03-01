/**
 * L0.6 — Harness（版本快照）
 *
 * 三条硬性规则：
 * 1. 快照失败默认阻断副作用执行（降级模式需显式声明并记录到 Trace）
 * 2. 只对可能产生持久副作用的操作快照（只读的 bash 等不需要）
 * 3. 以"变更批次"为单位快照（不要每条命令都 commit，避免历史爆炸）
 */
import type { Primitives } from './primitives';
export declare class Harness {
    private primitives;
    private workDir;
    private snapshots;
    constructor(primitives: Primitives, workDir?: string);
    /**
     * 创建快照（只对可能产生持久副作用的操作调用）
     * @returns 快照是否成功
     */
    snapshot(label: string): Promise<boolean>;
    /**
     * 回退到最近快照（Judge 或用户触发，共用同一机制）
     * @returns 回退是否成功
     */
    rollback(): Promise<boolean>;
    /**
     * 获取快照历史
     */
    getSnapshots(): string[];
    /**
     * 检查是否在 git 仓库中
     */
    isGitRepo(): Promise<boolean>;
}
//# sourceMappingURL=harness.d.ts.map