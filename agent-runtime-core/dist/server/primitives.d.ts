/**
 * 服务端用：将 bash 限定在 workDir 下执行，read/write/edit 与本地一致（路径由调用方传绝对路径）
 * 符合 L0.1 原语接口冻结，仅替换实现
 */
import type { Primitives } from '../primitives';
/**
 * 创建以 workDir 为 bash 工作目录的 Primitives
 * read/write/edit 使用绝对路径；bash 在 workDir 下执行
 */
export declare function createWorkDirPrimitives(workDir: string): Primitives;
//# sourceMappingURL=primitives.d.ts.map