"use strict";
/**
 * Trace - 系统调试基础
 *
 * 所有 confidence 和 uncertainty 统一写入 Trace
 * 这是整个系统可调试性的基础
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Trace = void 0;
class Trace {
    entries = [];
    /**
     * 追加新的 Trace 条目
     */
    append(entry) {
        this.entries.push(entry);
    }
    /**
     * L1.4：标签过滤检索（bash grep 的 TS 等价）
     */
    filterByTag(tag) {
        return this.entries.filter(e => e.tags?.includes(tag));
    }
    /**
     * 获取所有 Trace 条目
     */
    all() {
        return [...this.entries];
    }
    /**
     * 序列化供持久化或调试
     */
    serialize() {
        return JSON.stringify(this.entries, null, 2);
    }
    /**
     * 获取条目数量
     */
    length() {
        return this.entries.length;
    }
    /**
     * 清空所有条目（测试用）
     */
    clear() {
        this.entries = [];
    }
}
exports.Trace = Trace;
//# sourceMappingURL=trace.js.map