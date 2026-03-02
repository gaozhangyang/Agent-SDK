// [编排层 / 快照] runtime/harness.ts — Harness 骨架（snapshot / rollback）

import type { Primitives } from '../core/primitives';

export class Harness {
  private snapshots: string[] = [];

  constructor(
    private primitives: Primitives,
    private workDir: string = '.',
    private agentDir?: string,  // v2 新增：用于确认 .agent/ 目录不在 git 管理范围内
  ) {}

  /**
   * 快照：只对可能产生持久副作用的操作调用
   * 使用 git commit 管理版本
   */
  async snapshot(label: string): Promise<boolean> {
    try {
      await this.primitives.bash(
        `cd ${this.workDir} && git add -A && git commit -m "[agent-snapshot] ${label}" --allow-empty`
      );
      const hash = (await this.primitives.bash(`cd ${this.workDir} && git rev-parse HEAD`)).trim();
      this.snapshots.push(hash);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 回退到最近快照
   */
  async rollback(): Promise<boolean> {
    const target = this.snapshots[this.snapshots.length - 2]; // 上一个快照
    if (!target) return false;
    try {
      await this.primitives.bash(`cd ${this.workDir} && git checkout ${target}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取快照历史
   */
  getSnapshots(): string[] {
    return [...this.snapshots];
  }
}
