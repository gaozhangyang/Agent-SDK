/**
 * L0.1 — 四个执行原语
 * 
 * 接口定义冻结，永不修改
 * 实现层可以替换（本地 fs、sandbox、远程等），但签名不变
 */

import fs from 'fs/promises';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Primitives {
  read(path: string): Promise<string>;
  write(path: string, content: string, append?: boolean): Promise<void>;
  edit(path: string, old: string, next: string): Promise<void>;  // old 须唯一匹配
  bash(command: string): Promise<string>;
}

/**
 * 默认实现：本地文件系统 + 子进程
 */
export const localPrimitives: Primitives = {
  /**
   * 读取文件内容
   */
  async read(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8');
  },

  /**
   * 写入文件内容（创建或覆写）
   * 自动创建父目录
   * @param filePath 文件路径
   * @param content 要写入的内容
   * @param append 如果为true，则追加到文件末尾（适用于survey_output.md等日志文件）
   */
  async write(filePath: string, content: string, append: boolean = false): Promise<void> {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    if (append && filePath.includes('survey_output')) {
      // 追加模式：先读取现有内容，然后追加新内容
      try {
        const existing = await fs.readFile(filePath, 'utf-8');
        await fs.writeFile(filePath, existing + '\n' + content, 'utf-8');
      } catch {
        // 文件不存在，直接创建
        await fs.writeFile(filePath, content, 'utf-8');
      }
    } else {
      await fs.writeFile(filePath, content, 'utf-8');
    }
  },

  /**
   * 精确局部替换
   * @throws 如果 old 字符串在文件中不唯一匹配
   */
  async edit(path: string, old: string, next: string): Promise<void> {
    const content = await fs.readFile(path, 'utf-8');
    const count = content.split(old).length - 1;
    if (count !== 1) {
      throw new Error(`edit: old string must match exactly once, found ${count} times`);
    }
    await fs.writeFile(path, content.replace(old, next), 'utf-8');
  },

  /**
   * 执行系统命令
   */
  async bash(command: string): Promise<string> {
    const { stdout, stderr } = await execAsync(command);
    return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
  },
};
