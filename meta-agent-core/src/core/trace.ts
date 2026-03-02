// [核心层 / 日志] core/trace.ts — Trace + TerminalLog 双流，追加写 .jsonl

import fs from 'fs/promises';
import path from 'path';

export type Confidence = {
  coverage: number;            // 0-1，信息充分性
  reliability: number;         // 0-1，信息可信度
  gaps: string[];             // 缺少哪些信息
  by_source: Record<string, number>; // 每个来源的可信度
};

export type Uncertainty = {
  score: number;               // 0-1，输出可靠性的反面
  reasons: string[];           // 具体不确定原因
};

// Trace：推理书，记录"为什么"
export type TraceEntry = {
  ts: number;
  seq: number;           // 全局自增序号
  kind: 'collect' | 'reason' | 'judge' | 'exec' | 'observe' |
        'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;
  uncertainty?: Uncertainty;
  terminal_seq?: number; // 关联的 TerminalLog 序号（exec 类型时填写）
  tags?: string[];
};

// TerminalLog：执行终端，记录"做了什么"
export type TerminalEntry = {
  ts: number;
  seq: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  dry_run?: boolean;     // Dry-run 标记（预留，默认 false）
};

/**
 * Trace：推理轨迹
 */
export class Trace {
  private entries: TraceEntry[] = [];
  private seq = 0;
  private logFilePath?: string;
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  /**
   * 从文件加载累积的 Trace 条目（用于 Session 恢复）
   */
  async loadFromFile(): Promise<void> {
    if (!this.logFilePath) return;
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TraceEntry;
          this.entries.push(entry);
          if (entry.seq > this.seq) {
            this.seq = entry.seq;
          }
        } catch {
          // 跳过解析失败的行
        }
      }
    } catch {
      // 文件不存在或读取失败，忽略
    }
  }

  private async appendToFile(entry: TraceEntry): Promise<void> {
    if (!this.logFilePath) return;
    try {
      // 使用 path.dirname 获取目录
      const dir = path.dirname(this.logFilePath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      // 等待目录创建完成后再写入文件
      await fs.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 写文件失败不抛错，静默忽略
    }
  }

  append(entry: Omit<TraceEntry, 'seq'>): void {
    this.seq++;
    const fullEntry: TraceEntry = { ...entry, seq: this.seq };
    this.entries.push(fullEntry);
    // 创建一个链接到上一个写入的 promise，确保顺序
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(fullEntry);
    });
    this.pendingWrites.push(this.lastWritePromise);
  }

  // 等待所有待处理的写入完成（按顺序）
  async flush(): Promise<void> {
    // 等待最后的写入完成
    await this.lastWritePromise;
    this.pendingWrites = [];
  }

  filterByTag(tag: string): TraceEntry[] {
    return this.entries.filter(e => e.tags?.includes(tag));
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }

  serialize(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  getSeq(): number {
    return this.seq;
  }
}

/**
 * TerminalLog：执行终端日志
 */
export class TerminalLog {
  private entries: TerminalEntry[] = [];
  private seq = 0;
  private logFilePath?: string;
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  /**
   * 从文件加载累积的 Terminal Log 条目（用于 Session 恢复）
   */
  async loadFromFile(): Promise<void> {
    if (!this.logFilePath) return;
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TerminalEntry;
          this.entries.push(entry);
          if (entry.seq > this.seq) {
            this.seq = entry.seq;
          }
        } catch {
          // 跳过解析失败的行
        }
      }
    } catch {
      // 文件不存在或读取失败，忽略
    }
  }

  private async appendToFile(entry: TerminalEntry): Promise<void> {
    if (!this.logFilePath) return;
    try {
      // 使用 path.dirname 获取目录
      const dir = path.dirname(this.logFilePath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      // 等待目录创建完成后再写入文件
      await fs.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 写文件失败不抛错，静默忽略
    }
  }

  append(entry: Omit<TerminalEntry, 'seq'>): void {
    this.seq++;
    const fullEntry: TerminalEntry = { ...entry, seq: this.seq };
    this.entries.push(fullEntry);
    // 创建一个链接到上一个写入的 promise，确保顺序
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(fullEntry);
    });
    this.pendingWrites.push(this.lastWritePromise);
  }

  // 等待所有待处理的写入完成（按顺序）
  async flush(): Promise<void> {
    // 等待最后的写入完成
    await this.lastWritePromise;
    this.pendingWrites = [];
  }

  all(): TerminalEntry[] {
    return [...this.entries];
  }

  serialize(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  getSeq(): number {
    return this.seq;
  }
}
