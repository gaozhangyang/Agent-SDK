"use strict";
// [编排层 / 打断] runtime/interrupt.ts — InterruptChannel（内存队列）
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterruptChannel = void 0;
/**
 * InterruptChannel：用户实时打断机制
 * 纯内存实现，使用数组队列，FIFO
 */
class InterruptChannel {
    queue = [];
    /**
     * 添加中断信号到队列
     */
    push(signal) {
        this.queue.push(signal);
    }
    /**
     * 非阻塞取出并移除队列头部
     * 队列为空返回 null
     */
    poll() {
        return this.queue.shift() ?? null;
    }
    /**
     * 检查队列是否为空
     */
    isEmpty() {
        return this.queue.length === 0;
    }
    /**
     * 获取队列长度
     */
    size() {
        return this.queue.length;
    }
}
exports.InterruptChannel = InterruptChannel;
//# sourceMappingURL=interrupt.js.map