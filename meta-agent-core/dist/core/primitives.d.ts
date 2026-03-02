import type { TerminalLog } from './trace';
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
export declare function localPrimitives(coreDir: string, terminalLog: TerminalLog): Primitives;
//# sourceMappingURL=primitives.d.ts.map