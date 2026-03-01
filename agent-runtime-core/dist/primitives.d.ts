/**
 * L0.1 — 四个执行原语
 *
 * 接口定义冻结，永不修改
 * 实现层可以替换（本地 fs、sandbox、远程等），但签名不变
 */
export interface Primitives {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    edit(path: string, old: string, next: string): Promise<void>;
    bash(command: string): Promise<string>;
}
/**
 * 默认实现：本地文件系统 + 子进程
 */
export declare const localPrimitives: Primitives;
//# sourceMappingURL=primitives.d.ts.map