// [核心层 / 原语] core/primitives.ts — 四个执行原语，接口永不修改

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { TerminalLog } from './trace';

const execAsync = promisify(exec);

export interface Primitives {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, old: string, next: string): Promise<void>;
  bash(command: string): Promise<string>;
}

/**
 * 创建本地原语实现
 * @param coreDir SDK 的 src/ 目录绝对路径，用于路径白名单保护
 * @param terminalLog TerminalLog 实例，用于 bash 执行后自动记录
 */
export function localPrimitives(coreDir: string, terminalLog: TerminalLog): Primitives {
  const isPathAllowed = (path: string): boolean => {
    const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
    const normalizedCoreDir = coreDir.replace(/\\/g, '/').toLowerCase();
    return !normalizedPath.startsWith(normalizedCoreDir + '/');
  };

  return {
    async read(path: string): Promise<string> {
      return fs.readFile(path, 'utf-8');
    },

    async write(path: string, content: string): Promise<void> {
      if (!isPathAllowed(path)) {
        throw new Error('write: cannot modify core directory');
      }
      await fs.writeFile(path, content, 'utf-8');
    },

    async edit(path: string, old: string, next: string): Promise<void> {
      if (!isPathAllowed(path)) {
        throw new Error('edit: cannot modify core directory');
      }
      const content = await fs.readFile(path, 'utf-8');
      const count = content.split(old).length - 1;
      if (count !== 1) {
        throw new Error(`edit: old string must match exactly once, found ${count} times`);
      }
      await fs.writeFile(path, content.replace(old, next), 'utf-8');
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

      // 自动写入 TerminalLog
      terminalLog.append({
        ts: Date.now(),
        command,
        stdout,
        stderr,
        exitCode,
        durationMs,
      });

      // 如果 exitCode 不为 0，抛出错误
      if (exitCode !== 0) {
        throw new Error(`Command exited with code ${exitCode}: ${command}`);
      }

      return output;
    },
  };
}
