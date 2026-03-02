// [编排层 / 打断] runtime/interrupt.ts — InterruptChannel（内存队列）

export type InterruptSignal = {
  message: string;
  ts: number;
};

export type UserDirective = {
  action: 'continue' | 'modify_goal' | 'stop';
  newGoal?: string;      // action === 'modify_goal' 时填写
  message?: string;      // 给 agent 的附加说明
};

/**
 * InterruptChannel：用户实时打断机制
 * 纯内存实现，使用数组队列，FIFO
 */
export class InterruptChannel {
  private queue: InterruptSignal[] = [];

  /**
   * 添加中断信号到队列
   */
  push(signal: InterruptSignal): void {
    this.queue.push(signal);
  }

  /**
   * 非阻塞取出并移除队列头部
   * 队列为空返回 null
   */
  poll(): InterruptSignal | null {
    return this.queue.shift() ?? null;
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 获取队列长度
   */
  size(): number {
    return this.queue.length;
  }
}
