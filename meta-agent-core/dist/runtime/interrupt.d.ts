export type InterruptSignal = {
    message: string;
    ts: number;
};
export type UserDirective = {
    action: 'continue' | 'modify_goal' | 'stop';
    newGoal?: string;
    message?: string;
};
/**
 * InterruptChannel：用户实时打断机制
 * 纯内存实现，使用数组队列，FIFO
 */
export declare class InterruptChannel {
    private queue;
    /**
     * 添加中断信号到队列
     */
    push(signal: InterruptSignal): void;
    /**
     * 非阻塞取出并移除队列头部
     * 队列为空返回 null
     */
    poll(): InterruptSignal | null;
    /**
     * 检查队列是否为空
     */
    isEmpty(): boolean;
    /**
     * 获取队列长度
     */
    size(): number;
}
//# sourceMappingURL=interrupt.d.ts.map