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
export type OperationType = 'llmcall' | 'collect' | 'read' | 'write' | 'edit' | 'bash';

export type TerminalEntry = {
  ts: number;
  seq: number;                 // 全局序号，与 Trace.terminal_seq 对应
  operation: OperationType;    // 操作类型：llmcall, collect, read, write, edit, bash
  command?: string;           // 原始命令（bash 专用）
  input?: string;              // 输入内容（read/write/edit 的路径或内容，llmcall 的 prompt）
  output: string;              // 操作结果（可能被截断）
  exitCode?: number;           // 退出码（bash 专用）
  durationMs?: number;        // 耗时（可选）
  dry_run?: boolean;           // Dry-run 标记（预留，默认 false）
  truncated?: boolean;         // 输出是否被截断
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
 * 支持两种格式：
 * 1. JSON 格式（trace.jsonl）：用于程序解析
 * 2. Shell 友好格式（terminal.log）：用于人类阅读
 */
export class TerminalLog {
  private entries: TerminalEntry[] = [];
  private seq = 0;
  private logFilePath?: string;        // JSON 格式日志路径
  private terminalLogFilePath?: string; // Shell 友好格式日志路径
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();

  constructor(logFilePath?: string, terminalLogFilePath?: string) {
    this.logFilePath = logFilePath;
    this.terminalLogFilePath = terminalLogFilePath;
  }

  /**
   * 格式化时间为 ISO 8601 格式（带毫秒）
   */
  private formatTimestamp(ts: number): string {
    return new Date(ts).toISOString();
  }

  /**
   * 将 TerminalEntry 转换为人类友好的 Shell 格式
   * 格式：[时间] [角色] >/< 内容
   */
  private formatAsShell(entry: TerminalEntry): string {
    const ts = this.formatTimestamp(entry.ts);
    
    // 根据操作类型确定角色和格式
    // USER: 用户输入（通过 run 方法的 userInput 参数传入）
    // AGENT: Agent 的所有操作输出
    
    let role = 'AGENT';
    let prefix = '>';
    let content = '';
    
    switch (entry.operation) {
      case 'llmcall':
        // LLM 调用：显示输入的 prompt（截取前 200 字符）
        content = `LLM Call:\n  Input: ${(entry.input || '').slice(0, 200)}${(entry.input || '').length > 200 ? '...' : ''}\n  Output: ${entry.output.slice(0, 500)}${entry.output.length > 500 ? '...(truncated)' : ''}`;
        break;
      case 'collect':
        // Collect 操作
        content = `Collect:\n  Query: ${entry.input || ''}\n  Result: ${entry.output.slice(0, 300)}${entry.output.length > 300 ? '...(truncated)' : ''}`;
        break;
      case 'read':
        // 文件读取
        content = `Read: ${entry.input}\n  Content: ${entry.output.slice(0, 300)}${entry.output.length > 300 ? '...(truncated)' : ''}`;
        break;
      case 'write':
        // 文件写入
        content = `Write: ${entry.input}\n  ${entry.output}`;
        break;
      case 'edit':
        // 文件编辑
        content = `Edit: ${entry.input}\n  ${entry.output}`;
        break;
      case 'bash':
        // Bash 命令
        const exitInfo = entry.exitCode !== undefined ? ` (exit=${entry.exitCode}` : '';
        const durationInfo = entry.durationMs !== undefined ? `, ${entry.durationMs}ms)` : ')';
        content = `Command: ${entry.command}\n  ${exitInfo}${durationInfo}\n  Output: ${entry.output.slice(0, 500)}${entry.output.length > 500 ? '...(truncated)' : ''}`;
        prefix = entry.output ? '<' : '>';
        break;
    }
    
    // 添加截断标记
    if (entry.truncated) {
      content += '\n  [WARNING: Output was truncated]';
    }
    
    return `[${ts}] [${role}] ${prefix} ${content}`;
  }

  /**
   * 添加用户输入记录（USER 角色）
   */
  appendUserInput(message: string): void {
    const ts = Date.now();
    this.seq++;
    const entry: TerminalEntry = {
      ts,
      seq: this.seq,
      operation: 'llmcall', // 使用 llmcall 作为占位操作类型
      input: message,
      output: '[User Input]',
    };
    this.entries.push(entry);
    
    // 写入 Shell 格式
    const shellLine = `[${this.formatTimestamp(ts)}] [USER] > ${message}`;
    this.writeShellFormat(shellLine);
    
    // 写入 JSON 格式
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(entry);
    });
    this.pendingWrites.push(this.lastWritePromise);
  }

  /**
   * 写入 Shell 格式日志
   */
  private async writeShellFormat(line: string): Promise<void> {
    if (!this.terminalLogFilePath) return;
    try {
      const dir = path.dirname(this.terminalLogFilePath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.appendFile(this.terminalLogFilePath, line + '\n', 'utf-8');
    } catch {
      // 写文件失败不抛错，静默忽略
    }
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
    
    // 1. 写入 JSON 格式（trace.jsonl）
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(fullEntry);
    });
    this.pendingWrites.push(this.lastWritePromise);
    
    // 2. 写入 Shell 友好格式（terminal.log）
    const shellLine = this.formatAsShell(fullEntry);
    this.writeShellFormat(shellLine);
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
