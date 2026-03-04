// [核心层 / 日志] core/trace.ts — Trace + TerminalLog 双流，追加写 .jsonl
// 修改：统一 seq 序号空间、trace.jsonl 补齐字段、terminal.md 格式优化

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
  seq?: number;           // 全局自增序号（可选，由 append 方法自动分配）
  kind: 'collect' | 'reason' | 'judge' | 'exec' |
        'state' | 'escalate' | 'stop' | 'interrupt' | 'narrative';
  data: unknown;
  confidence?: Confidence;
  uncertainty?: Uncertainty;
  terminal_seq?: number; // 关联的 TerminalLog 序号（exec 类型时填写）
  tags?: string[];
  // 扩展字段：补齐 change.md 要求的字段
  judge_type?: string;   // Judge 调用的类型：outcome, milestone, capability
  operation?: string;   // 原子操作类型：read, write, edit, bash
  input?: string;       // 输入内容
  output?: string;      // 输出内容
  durationMs?: number; // 耗时
  // v2: riskApproved 字段（reason 类型条目使用）
  riskApproved?: boolean;
  riskReason?: string;
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
  trace_ref?: number;          // 关联的 Trace seq（两级检索跳转用）
};

/**
 * 全局序号管理器 - 统一 seq 序号空间
 * Trace 和 TerminalLog 共享同一个全局递增序号
 */
export class GlobalSeqManager {
  private seq = 0;
  private logFilePath?: string;

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  /**
   * 从文件加载累积的 seq（用于 Session 恢复）
   */
  async loadFromFile(): Promise<void> {
    if (!this.logFilePath) return;
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      // 从最后一条记录获取最大 seq
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
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

  /**
   * 获取下一个全局序号
   */
  next(): number {
    this.seq++;
    return this.seq;
  }

  /**
   * 获取当前序号
   */
  get(): number {
    return this.seq;
  }

  /**
   * 设置序号（用于恢复场景）
   */
  set(seq: number): void {
    this.seq = seq;
  }
}

/**
 * Trace：推理轨迹
 * 使用全局序号管理器，与 TerminalLog 共享序号空间
 */
export class Trace {
  private entries: TraceEntry[] = [];
  private seqManager: GlobalSeqManager;
  private logFilePath?: string;
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
    this.seqManager = new GlobalSeqManager(logFilePath);
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
        } catch {
          // 跳过解析失败的行
        }
      }
      // 从文件恢复 seq
      await this.seqManager.loadFromFile();
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

  /**
   * 追加 Trace 条目
   * @param entry 忽略 seq 字段，由全局序号管理器分配（除非显式传入）
   */
  append(entry: TraceEntry): number {
    // 如果传入 seq，使用传入的 seq；否则由全局序号管理器分配
    const seq = entry.seq ?? this.seqManager.next();
    const fullEntry: TraceEntry = { ...entry, seq };
    this.entries.push(fullEntry);
    // 创建一个链接到上一个写入的 promise，确保顺序
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(fullEntry);
    });
    this.pendingWrites.push(this.lastWritePromise);
    return seq; // 返回分配的 seq，供 TerminalLog 使用
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
    return this.seqManager.get();
  }

  /**
   * 设置全局序号管理器（由外部注入，实现与 TerminalLog 共享）
   */
  setSeqManager(seqManager: GlobalSeqManager): void {
    this.seqManager = seqManager;
  }

  /**
   * 获取全局序号管理器（供 TerminalLog 共享）
   */
  getSeqManager(): GlobalSeqManager {
    return this.seqManager;
  }
}

/**
 * TerminalLog：执行终端日志
 * 支持两种格式：
 * 1. JSON 格式（trace.jsonl）：用于程序解析
 * 2. Markdown 格式（terminal.md）：用于人类阅读
 * 
 * 修改：使用全局序号管理器统一 seq、terminal.md 格式优化
 */
export class TerminalLog {
  private entries: TerminalEntry[] = [];
  private seqManager: GlobalSeqManager;
  private logFilePath?: string;        // JSON 格式日志路径
  private terminalLogFilePath?: string; // Markdown 格式日志路径（从 terminal.log 改为 terminal.md）
  private pendingWrites: Promise<void>[] = [];
  private lastWritePromise: Promise<void> = Promise.resolve();
  // 路径别名映射（用于 terminal.md）
  private pathAliases: Map<string, string> = new Map();
  // 当前工作目录（用于生成路径别名）
  private baseDir: string = '';

  constructor(logFilePath?: string, terminalLogFilePath?: string, baseDir?: string) {
    this.logFilePath = logFilePath;
    this.terminalLogFilePath = terminalLogFilePath;
    this.baseDir = baseDir || '';
    // 如果没有传入 seqManager，需要创建一个（但应该由外部传入共享的）
    this.seqManager = new GlobalSeqManager(logFilePath);
  }

  /**
   * 设置全局序号管理器（由外部注入，实现与 Trace 共享）
   */
  setSeqManager(seqManager: GlobalSeqManager): void {
    this.seqManager = seqManager;
  }

  /**
   * 初始化路径别名
   */
  private initPathAliases(): void {
    this.pathAliases.clear();
    // 简化工作目录路径，生成别名
    if (this.baseDir) {
      const parts = this.baseDir.split('/');
      // 取最后 2-3 个有意义的目录名作为别名
      const shortParts = parts.slice(-3);
      const alias = '$' + shortParts.join('/');
      this.pathAliases.set(this.baseDir, alias);
    }
  }

  /**
   * 将路径转换为别名形式
   */
  private shortenPath(filePath: string): string {
    for (const [fullPath, alias] of this.pathAliases.entries()) {
      if (filePath.startsWith(fullPath)) {
        return filePath.replace(fullPath, alias);
      }
    }
    return filePath;
  }

  /**
   * 格式化时间为 HH:mm:ss 格式（更简洁）
   */
  private formatTimestamp(ts: number): string {
    const date = new Date(ts);
    return date.toTimeString().slice(0, 8);
  }

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
  private formatAsMarkdown(entry: TerminalEntry): string {
    const ts = this.formatTimestamp(entry.ts);
    const seq = String(entry.seq).padStart(3, '0');
    
    // 操作图标映射
    const iconMap: Record<OperationType, string> = {
      'llmcall': '🤖 llmcall',
      'collect': '🔍 collect',
      'read': '📖 read',
      'write': '✏️ write',
      'edit': '🔧 edit',
      'bash': '💻 bash',
    };
    
    const icon = iconMap[entry.operation] || entry.operation;
    const shortPath = entry.input ? this.shortenPath(entry.input) : '';
    
    // 耗时标注
    const durationStr = entry.durationMs !== undefined && entry.durationMs > 0 
      ? ` · ${entry.durationMs}ms` 
      : '';
    
    // 截断引用
    const truncatedRef = entry.truncated 
      ? ` → full output at trace.jsonl#seq:${entry.seq}` 
      : '';
    
    /**
     * 将内容转换为单行纯文本（用于表格单元格）
     * - 移除换行符
     * - 截断超长内容
     * - 转义管道符 | 以免破坏表格
     */
    const toSingleLine = (text: string, maxLen: number = 100): string => {
      // 替换换行符为空格，转义管道符
      const singleLine = text.replace(/[\n\r]/g, ' ').replace(/\|/g, '\\|');
      if (singleLine.length > maxLen) {
        return singleLine.slice(0, maxLen) + '...';
      }
      return singleLine;
    };
    
    /**
     * 检查内容是否需要放进 <details> 块
     * - 多行内容
     * - 包含 Markdown 语法（##, ```, **, _, `, -, [ 等）
     */
    const needsDetailsBlock = (text: string): boolean => {
      if (!text) return false;
      // 检查是否包含换行符
      if (/[\n\r]/.test(text)) return true;
      // 检查是否包含 Markdown 语法
      if (/^#{1,6}\s|```|^\*\*|^\* |^`|^\[|^\- |^> /m.test(text)) return true;
      return false;
    };

    /**
     * 检查内容是否为模板内容（包含模板占位符或模板标题）
     * 模板内容需要用 markdown 代码块包裹，避免 h1 标题污染层级
     */
    const isTemplateContent = (text: string): boolean => {
      if (!text) return false;
      // 检查是否包含模板标题或占位符
      if (/^#\s*\[论文标题\]/m.test(text)) return true;
      if (/\{arxiv_id\}|\{submitted_date\}|\{authors\}|\{generated_date\}/.test(text)) return true;
      return false;
    };
    
    let content = '';
    let hasFullContent = false;
    
    switch (entry.operation) {
      case 'llmcall':
        // LLM 调用
        const inputPreview = toSingleLine(entry.input || '', 100);
        const outputPreview = toSingleLine(entry.output, 200);
        content = `| input  | ${inputPreview} |\n| --- | --- |\n| output | ${outputPreview}${truncatedRef} |`;
        
        // 如果有 uncertainty，显示出来
        if (entry.durationMs !== undefined) {
          content += `\n| --- | --- |\n| duration | ${entry.durationMs}ms |`;
        }
        
        // 检查是否需要 <details> 块
        hasFullContent = needsDetailsBlock(entry.input || '') || needsDetailsBlock(entry.output);
        break;
        
      case 'collect':
        // Collect 操作
        const collectQuery = toSingleLine(shortPath || entry.input || '', 100);
        const collectResult = toSingleLine(entry.output, 200);
        content = `| query  | ${collectQuery} |\n| --- | --- |\n| result | ${collectResult}${truncatedRef} |`;
        hasFullContent = needsDetailsBlock(entry.input || '') || needsDetailsBlock(entry.output);
        break;
        
      case 'read':
        // 文件读取
        const readPath = toSingleLine(shortPath, 100);
        const readContent = toSingleLine(entry.output, 200);
        content = `| path   | ${readPath} |\n| --- | --- |\n| content | ${readContent}${truncatedRef} |`;
        hasFullContent = needsDetailsBlock(entry.output);
        break;
        
      case 'write':
        // 文件写入
        const writePath = toSingleLine(shortPath, 100);
        const writeResult = toSingleLine(entry.output, 200);
        content = `| path   | ${writePath} |\n| --- | --- |\n| result | ${writeResult} |`;
        hasFullContent = needsDetailsBlock(entry.output);
        break;
        
      case 'edit':
        // 文件编辑
        const editPath = toSingleLine(shortPath, 100);
        const editResult = toSingleLine(entry.output, 200);
        content = `| path   | ${editPath} |\n| --- | --- |\n| result | ${editResult} |`;
        hasFullContent = needsDetailsBlock(entry.output);
        break;
        
      case 'bash':
        // Bash 命令
        const exitInfo = entry.exitCode !== undefined ? ` (exit=${entry.exitCode})` : '';
        const bashCmd = toSingleLine(entry.command || '', 100);
        const bashOutput = toSingleLine(entry.output, 200);
        content = `| cmd    | ${bashCmd} |\n| --- | --- |\n| output | ${bashOutput}${exitInfo}${truncatedRef} |`;
        hasFullContent = needsDetailsBlock(entry.command || '') || needsDetailsBlock(entry.output);
        break;
    }
    
    // 构建 Markdown 格式
    // 规则1: 表格前必须有空行
    const lines = [
      `## \`seq:${seq}\` · \`${ts}\` · ${icon}${durationStr}`,
      '',
      content,
    ];
    
    // 规则4: 多行内容、含 Markdown 语法的内容放进 <details> 块
    // 注意：内层代码块使用四个反引号，避免与外层 Markdown 环境冲突
    // 修改：使用两个独立的折叠块，分别显示 input 和 output
    if (hasFullContent) {
      // 分别检查 input 和 output 是否需要放进 details 块
      const needsInputDetails = entry.input && needsDetailsBlock(entry.input);
      const needsOutputDetails = entry.output && needsDetailsBlock(entry.output);

      if (needsInputDetails && entry.input) {
        lines.push('');
        lines.push('<details><summary>完整的input</summary>');
        lines.push('');
        lines.push('### input');
        lines.push('');
        lines.push('````');
        lines.push(entry.input);
        lines.push('````');
        lines.push('');
        lines.push('</details>');
      }

      if (needsOutputDetails) {
        lines.push('');
        lines.push('<details><summary>完整的output</summary>');
        lines.push('');
        lines.push('### output');
        lines.push('');
        // 如果是模板内容，用 markdown 代码块包裹（避免 h1 标题污染层级）
        if (isTemplateContent(entry.output)) {
          lines.push('````markdown');
          lines.push(entry.output);
          lines.push('````');
        } else {
          lines.push('````');
          lines.push(entry.output);
          lines.push('````');
        }
        lines.push('');
        lines.push('</details>');
      }

      // 只有当 input 或 output 有内容时才添加空行
      if (needsInputDetails || needsOutputDetails) {
        // 规则5: </details> 后必须有空行
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 写入 Markdown 格式日志
   */
  private async writeMarkdownFormat(entry: TerminalEntry): Promise<void> {
    if (!this.terminalLogFilePath) return;
    try {
      const dir = path.dirname(this.terminalLogFilePath);
      if (dir && dir !== '.') {
        await fs.mkdir(dir, { recursive: true });
      }
      
      // 首次写入时添加头部
      const fileExists = await fs.access(this.terminalLogFilePath).then(() => true).catch(() => false);
      let header = '';
      if (!fileExists) {
        // 初始化路径别名
        this.initPathAliases();
        
        // 生成路径别名头部
        let aliasHeader = '# Terminal Log\n\n';
        for (const [fullPath, alias] of this.pathAliases.entries()) {
          aliasHeader += `${alias} = ${fullPath}\n`;
        }
        aliasHeader += '\n---\n\n';
        header = aliasHeader;
      }
      
      const mdContent = this.formatAsMarkdown(entry);
      const content = header + mdContent + '\n\n';
      
      if (header) {
        // 首次写入，写入头部 + 内容
        await fs.writeFile(this.terminalLogFilePath, content, 'utf-8');
      } else {
        // 追加内容
        await fs.appendFile(this.terminalLogFilePath, mdContent + '\n\n', 'utf-8');
      }
    } catch {
      // 写文件失败不抛错，静默忽略
    }
  }

  /**
   * 将内容转换为单行纯文本（用于表格单元格）
   */
  private toSingleLine(text: string, maxLen: number = 100): string {
    if (!text) return '';
    // 替换换行符为空格，转义管道符
    const singleLine = text.replace(/[\n\r]/g, ' ').replace(/\|/g, '\\|');
    if (singleLine.length > maxLen) {
      return singleLine.slice(0, maxLen) + '...';
    }
    return singleLine;
  }

  /**
   * 检查内容是否需要放进 <details> 块
   */
  private needsDetailsBlock(text: string): boolean {
    if (!text) return false;
    // 检查是否包含换行符
    if (/[\n\r]/.test(text)) return true;
    // 检查是否包含 Markdown 语法
    if (/^#{1,6}\s|```|^\*\*|^\* |^`|^\[|^\- |^> /m.test(text)) return true;
    return false;
  }

  /**
   * 添加用户输入记录（USER 角色）
   */
  appendUserInput(message: string): void {
    const ts = Date.now();
    const seq = this.seqManager.next();
    const entry: TerminalEntry = {
      ts,
      seq,
      operation: 'llmcall', // 使用 llmcall 作为占位操作类型
      input: message,
      output: '[User Input]',
    };
    this.entries.push(entry);
    
    // 写入 Markdown 格式
    const tsStr = this.formatTimestamp(ts);
    const seqStr = String(seq).padStart(3, '0');
    
    // 表格单元格只放单行纯文本
    const messagePreview = this.toSingleLine(message, 100);
    
    // 构建 Markdown 格式（遵循渲染规则）
    let mdContent = `## \`seq:${seqStr}\` · \`${tsStr}\` · 👤 USER\n`;
    mdContent += '\n';
    mdContent += `| input | ${messagePreview} |\n`;
    
    // 如果消息需要 <details> 块
    if (this.needsDetailsBlock(message)) {
      mdContent += '\n<details><summary>完整内容</summary>\n\n';
      mdContent += '````\n';
      mdContent += message + '\n';
      mdContent += '````\n\n';
      mdContent += '</details>\n';
      mdContent += '\n';
    }
    
    // 使用 writeMarkdown 追加内容（保持追加写语义）
    this.writeMarkdown(mdContent);
    
    // 写入 JSON 格式
    this.lastWritePromise = this.lastWritePromise.then(() => {
      return this.appendToFile(entry);
    });
    this.pendingWrites.push(this.lastWritePromise);
  }

  /**
   * 写入 Markdown 格式日志
   */
  private async writeMarkdown(line: string): Promise<void> {
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
        } catch {
          // 跳过解析失败的行
        }
      }
      // 从文件恢复 seq
      await this.seqManager.loadFromFile();
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

  /**
   * 追加 Terminal Entry
   * @param entry 忽略 seq 字段，由全局序号管理器分配
   * @param writeTrace 是否同时写入 trace.jsonl（默认 false，避免重复记录）
   *                   只有 loop.ts 层的操作才需要写入 trace.jsonl
   */
  append(entry: Omit<TerminalEntry, 'seq'>, writeTrace: boolean = false): number {
    const seq = this.seqManager.next();
    const fullEntry: TerminalEntry = { ...entry, seq };
    this.entries.push(fullEntry);
    
    // 1. 先写入 Markdown 友好格式（terminal.md）
    // 初始化路径别名（首次写入时）
    if (this.pathAliases.size === 0) {
      this.initPathAliases();
    }
    const mdContent = this.formatAsMarkdown(fullEntry);
    this.writeMarkdown(mdContent);
    
    // 2. 可选：写入 JSON 格式（trace.jsonl）
    // 只有明确指定 writeTrace=true 时才写入，避免重复记录
    // trace.jsonl 主要由 trace.append() 写入
    if (writeTrace) {
      this.lastWritePromise = this.lastWritePromise.then(() => {
        return this.appendToFile(fullEntry);
      });
      this.pendingWrites.push(this.lastWritePromise);
    }
    
    return seq; // 返回分配的 seq
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
    return this.seqManager.get();
  }
}
