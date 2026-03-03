// [核心层 / 原语] core/primitives.ts — 四个执行原语，接口永不修改
// 修改：trace.jsonl 补齐 kind 字段、统一 seq

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { TerminalLog, OperationType, Trace, TraceEntry } from './trace';

const execAsync = promisify(exec);

// 最大输出截断长度（100KB）- 默认值
const DEFAULT_MAX_OUTPUT_LENGTH = 100 * 1024;

// 截断配置接口
export interface TruncationConfig {
  maxOutputLength: number;  // 最大输出截断长度（字节）
}

/**
 * 从 AGENT.md 内容中解析截断配置
 * 支持两种格式：
 * 1. ```json 代码块中的 JSON 格式
 * 2. 直接写的格式（向后兼容）
 */
export function parseTruncationConfig(agentMdContent?: string): TruncationConfig {
  const defaultConfig: TruncationConfig = {
    maxOutputLength: DEFAULT_MAX_OUTPUT_LENGTH,
  };
  
  if (!agentMdContent) {
    return defaultConfig;
  }
  
  // 优先尝试解析 ```json 代码块
  const jsonBlockMatch = agentMdContent.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.maxOutputLength && typeof parsed.maxOutputLength === 'number') {
        return { maxOutputLength: parsed.maxOutputLength };
      }
    } catch (e) {
      console.warn('Failed to parse JSON config block, falling back to regex parsing:', e);
    }
  }
  
  // 尝试匹配多种配置格式（向后兼容）
  // 1. maxOutputLength: 102400
  // 2. max_output_length: 102400
  // 3. output_truncation: 102400
  const patterns = [
    /maxOutputLength:\s*(\d+)/i,
    /max_output_length:\s*(\d+)/i,
    /output_truncation:\s*(\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = agentMdContent.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      if (!isNaN(value) && value > 0) {
        return { maxOutputLength: value };
      }
    }
  }
  
  return defaultConfig;
}

/**
 * 截断过长的输出，并在末尾标记
 */
function truncateOutput(output: string | undefined | null, maxLength: number = DEFAULT_MAX_OUTPUT_LENGTH): { content: string; truncated: boolean } {
  // 防御性检查：处理 undefined 或 null
  if (output == null) {
    return { content: '', truncated: false };
  }
  if (output.length > maxLength) {
    const truncatedSizeKB = Math.round(maxLength / 1024);
    return {
      content: output.slice(0, maxLength) + `\n\n[... output truncated, exceeded ${truncatedSizeKB}KB limit]`,
      truncated: true,
    };
  }
  return { content: output, truncated: false };
}

export interface Primitives {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, old: string, next: string): Promise<void>;
  bash(command: string): Promise<string>;
}

/**
 * 创建本地原语实现
 * @param coreDir SDK 的 src/ 目录绝对路径，用于路径白名单保护
 * @param terminalLog TerminalLog 实例，用于所有操作自动记录
 * @param trace Trace 实例，用于记录 trace.jsonl（补齐 kind 字段）
 * @param truncationConfig 截断配置（可选，默认从 AGENT.md 解析）
 */
export function localPrimitives(
  coreDir: string, 
  terminalLog: TerminalLog,
  trace?: Trace,
  truncationConfig?: TruncationConfig
): Primitives {
  // 使用传入的配置或默认值
  const maxOutputLength = truncationConfig?.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
  
  const isPathAllowed = (path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
    const normalizedCoreDir = coreDir.replace(/\\/g, '/').toLowerCase();
    return !normalizedPath.startsWith(normalizedCoreDir + '/');
  };

  // 通用日志记录函数
  const logOperation = (
    operation: OperationType,
    input: string,
    output: string,
    options?: { command?: string; exitCode?: number; durationMs?: number }
  ) => {
    const { content: truncatedOutput, truncated } = truncateOutput(output, maxOutputLength);
    
    // 记录到 TerminalLog（返回分配的 seq）
    const seq = terminalLog.append({
      ts: Date.now(),
      operation,
      input,
      output: truncatedOutput,
      ...options,
      truncated,
    });
    
    // 同时写入 Trace，使用与 TerminalLog 相同的 seq，确保一致性
    // 注意：Trace 的写入由 loop.ts 在更高层级统一处理
    // 但 primitives 层的操作也需要记录到 trace.jsonl，使用相同的 seq
    if (trace) {
      // 根据操作类型确定 kind 字段
      let kind: 'exec' | 'observe' = 'exec';
      if (operation === 'read' || operation === 'bash') {
        kind = 'observe';
      }
      
      trace.append({
        ts: Date.now(),
        seq,  // 使用与 terminalLog 相同的 seq，确保一致性
        kind,
        data: { operation },  // 记录操作类型
        operation,  // 补齐 operation 字段
        input,
        output: truncatedOutput,  // 补齐 output 字段
        durationMs: options?.durationMs,
      });
    }
  };

  return {
    async read(path: string): Promise<string> {
      const startTime = Date.now();
      const content = await fs.readFile(path, 'utf-8');
      const durationMs = Date.now() - startTime;
      
      // 记录到 TerminalLog 和 Trace
      logOperation('read', path, content, { durationMs });
      
      return content;
    },

    async write(path: string, content: string): Promise<void> {
      const startTime = Date.now();
      
      if (!isPathAllowed(path)) {
        throw new Error('write: cannot modify core directory');
      }
      await fs.writeFile(path, content, 'utf-8');
      const durationMs = Date.now() - startTime;
      
      // 记录到 TerminalLog 和 Trace
      logOperation('write', path, `[written ${content.length} bytes]`, { durationMs });
    },

    async edit(path: string, old: string, next: string): Promise<void> {
      const startTime = Date.now();
      
      if (!isPathAllowed(path)) {
        throw new Error('edit: cannot modify core directory');
      }
      const content = await fs.readFile(path, 'utf-8');
      const count = content.split(old).length - 1;
      if (count !== 1) {
        throw new Error(`edit: old string must match exactly once, found ${count} times`);
      }
      await fs.writeFile(path, content.replace(old, next), 'utf-8');
      const durationMs = Date.now() - startTime;
      
      // 记录到 TerminalLog 和 Trace
      logOperation('edit', path, `[edited: replaced "${old.slice(0, 50)}..." with "${next.slice(0, 50)}..."]`, { durationMs });
    },

    async bash(command: string): Promise<string> {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      try {
        const { stdout: out, stderr: err } = await execAsync(command);
        stdout = out;
        stderr = err || '';
      } catch (error: any) {
        stdout = error.stdout || '';
        stderr = error.stderr || '';
        exitCode = error.code || 1;
      }

      const durationMs = Date.now() - startTime;
      const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');

      // 自动写入 TerminalLog 和 Trace
      logOperation('bash', command, output, { command, exitCode, durationMs });

      // 如果 exitCode 不为 0，抛出错误
      if (exitCode !== 0) {
        throw new Error(`Command exited with code ${exitCode}: ${command}`);
      }

      return output;
    },
  };
}
