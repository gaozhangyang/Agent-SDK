/**
 * L0.6 — Harness（版本快照）
 * 
 * 三条硬性规则：
 * 1. 快照失败默认阻断副作用执行（降级模式需显式声明并记录到 Trace）
 * 2. 只对可能产生持久副作用的操作快照（只读的 bash 等不需要）
 * 3. 以"变更批次"为单位快照（不要每条命令都 commit，避免历史爆炸）
 */

import type { Primitives } from './primitives';

/** 将路径安全嵌入 sh 的 cd 命令（路径含空格/特殊字符时安全） */
function shellQuoteDir(dir: string): string {
  return `'${dir.replace(/'/g, "'\\''")}'`;
}

export class Harness {
  private snapshots: string[] = [];

  constructor(
    private primitives: Primitives,
    private workDir: string = '.',
  ) {}

  /**
   * 创建快照（只对可能产生持久副作用的操作调用）
   * @returns 快照是否成功
   */
  async snapshot(label: string): Promise<boolean> {
    try {
      const q = shellQuoteDir(this.workDir);
      // 使用 --allow-empty 避免无改动时 commit 失败
      await this.primitives.bash(
        `cd ${q} && git add -A && git commit -m "[agent-snapshot] ${label}" --allow-empty`
      );
      const hash = (await this.primitives.bash(`cd ${q} && git rev-parse HEAD`)).trim();
      this.snapshots.push(hash);
      return true;
    } catch {
      return false; // 快照失败，调用方负责阻断
    }
  }

  /**
   * 回退到最近快照（Judge 或用户触发，共用同一机制）
   * @returns 回退是否成功
   */
  async rollback(): Promise<boolean> {
    const target = this.snapshots[this.snapshots.length - 2]; // 上一个快照
    if (!target) return false;
    try {
      const q = shellQuoteDir(this.workDir);
      await this.primitives.bash(`cd ${q} && git checkout ${target}`);
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

  /**
   * 检查是否在 git 仓库中
   */
  async isGitRepo(): Promise<boolean> {
    try {
      const q = shellQuoteDir(this.workDir);
      await this.primitives.bash(`cd ${q} && git rev-parse --is-inside-work-tree`);
      return true;
    } catch {
      return false;
    }
  }
}
