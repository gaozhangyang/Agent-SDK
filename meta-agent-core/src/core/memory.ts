// [核心层 / 记忆] core/memory.ts — 结构化长期记忆，追加写 .jsonl

import fs from 'fs/promises';
import path from 'path';

/**
 * MemoryEntry：结构化记忆记录
 * 每条记录包含用户请求 + 解决结论，形成长期记忆
 */
export type MemoryEntry = {
  ts: number;
  userRequest: string;      // 用户原始请求
  solutionSummary: string;  // 解决方案总结
  sessionId?: string;        // 可选的会话标识
  archivedSubgoal?: string; // 对应的已归档子目标
};

/**
 * Memory：长期记忆存储
 * 与 Trace 分开维护，专门存储"用户请求 + 解决结论"的结构化记录
 */
export class Memory {
  private entries: MemoryEntry[] = [];
  private logFilePath?: string;
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  /**
   * 从文件加载累积的 Memory 条目（用于 Session 恢复）
   */
  async loadFromFile(): Promise<void> {
    if (!this.logFilePath) return;
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as MemoryEntry;
          this.entries.push(entry);
        } catch {
          // 跳过解析失败的行
        }
      }
    } catch {
      // 文件不存在或读取失败，忽略
    }
  }

  private async appendToFile(entry: MemoryEntry): Promise<void> {
    if (!this.logFilePath) return;
    try {
      const dir = path.dirname(this.logFilePath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 写文件失败不抛错，静默忽略
    }
  }

  /**
   * 追加一条记忆记录
   * 在子目标真正完成后，由 Loop 统一调用
   */
  append(entry: Omit<MemoryEntry, 'ts'>): void {
    const fullEntry: MemoryEntry = { ...entry, ts: Date.now() };
    this.entries.push(fullEntry);
    // 确保写入顺序
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(fullEntry);
    });
    this.pendingWrites.push(this.lastWritePromise);
  }

  /**
   * 等待所有待处理的写入完成
   */
  async flush(): Promise<void> {
    await this.lastWritePromise;
    this.pendingWrites = [];
  }

  /**
   * 获取所有记忆
   */
  all(): MemoryEntry[] {
    return [...this.entries];
  }

  /**
   * 根据 userRequest 关键词检索记忆
   */
  search(query: string): MemoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.entries.filter(e => 
      e.userRequest.toLowerCase().includes(lowerQuery) ||
      e.solutionSummary.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 获取最近的 N 条记忆
   */
  recent(n: number): MemoryEntry[] {
    return this.entries.slice(-n);
  }

  /**
   * 序列化（JSON 格式）
   */
  serialize(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * 获取记忆数量
   */
  size(): number {
    return this.entries.length;
  }
}
