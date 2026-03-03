import type { TerminalLog, Trace } from './trace';
export interface TruncationConfig {
    maxOutputLength: number;
}
/**
 * 从 AGENT.md 内容中解析截断配置
 * 支持两种格式：
 * 1. ```json 代码块中的 JSON 格式
 * 2. 直接写的格式（向后兼容）
 */
export declare function parseTruncationConfig(agentMdContent?: string): TruncationConfig;
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
export declare function localPrimitives(coreDir: string, terminalLog: TerminalLog, trace?: Trace, truncationConfig?: TruncationConfig): Primitives;
//# sourceMappingURL=primitives.d.ts.map