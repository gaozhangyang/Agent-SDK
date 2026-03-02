"use strict";
// [编排层 / 快照] runtime/harness.ts — Harness 骨架（snapshot / rollback）
Object.defineProperty(exports, "__esModule", { value: true });
exports.Harness = void 0;
class Harness {
    primitives;
    workDir;
    agentDir;
    snapshots = [];
    constructor(primitives, workDir = '.', agentDir) {
        this.primitives = primitives;
        this.workDir = workDir;
        this.agentDir = agentDir;
    }
    /**
     * 快照：只对可能产生持久副作用的操作调用
     * 使用 git commit 管理版本
     */
    async snapshot(label) {
        try {
            await this.primitives.bash(`cd ${this.workDir} && git add -A && git commit -m "[agent-snapshot] ${label}" --allow-empty`);
            const hash = (await this.primitives.bash(`cd ${this.workDir} && git rev-parse HEAD`)).trim();
            this.snapshots.push(hash);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 回退到最近快照
     */
    async rollback() {
        const target = this.snapshots[this.snapshots.length - 2]; // 上一个快照
        if (!target)
            return false;
        try {
            await this.primitives.bash(`cd ${this.workDir} && git checkout ${target}`);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 获取快照历史
     */
    getSnapshots() {
        return [...this.snapshots];
    }
}
exports.Harness = Harness;
//# sourceMappingURL=harness.js.map