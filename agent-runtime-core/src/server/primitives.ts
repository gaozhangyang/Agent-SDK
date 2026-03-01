/**
 * 服务端用：将 bash 限定在 workDir 下执行，read/write/edit 与本地一致（路径由调用方传绝对路径）
 * 符合 L0.1 原语接口冻结，仅替换实现
 */

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname } from 'path';
import type { Primitives } from '../primitives';

const execAsync = promisify(exec);

/**
 * 创建以 workDir 为 bash 工作目录的 Primitives
 * read/write/edit 使用绝对路径；bash 在 workDir 下执行
 */
export function createWorkDirPrimitives(workDir: string): Primitives {
  return {
    async read(path: string): Promise<string> {
      return fs.readFile(path, 'utf-8');
    },
    async write(filePath: string, content: string): Promise<void> {
      const dir = dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
    },
    async edit(path: string, old: string, next: string): Promise<void> {
      const content = await fs.readFile(path, 'utf-8');
      const count = content.split(old).length - 1;
      if (count !== 1) {
        throw new Error(`edit: old string must match exactly once, found ${count} times`);
      }
      await fs.writeFile(path, content.replace(old, next), 'utf-8');
    },
    async bash(command: string): Promise<string> {
      const { stdout, stderr } = await execAsync(command, { cwd: workDir });
      return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    },
  };
}
