"use strict";
// [核心层 / 记忆] core/memory.ts — 结构化长期记忆，追加写 .jsonl
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Memory = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
/**
 * Memory：长期记忆存储
 * 与 Trace 分开维护，专门存储"用户请求 + 解决结论"的结构化记录
 */
class Memory {
    entries = [];
    logFilePath;
    pendingWrites = [];
    lastWritePromise = Promise.resolve();
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
    }
    /**
     * 从文件加载累积的 Memory 条目（用于 Session 恢复）
     */
    async loadFromFile() {
        if (!this.logFilePath)
            return;
        try {
            const content = await promises_1.default.readFile(this.logFilePath, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    this.entries.push(entry);
                }
                catch {
                    // 跳过解析失败的行
                }
            }
        }
        catch {
            // 文件不存在或读取失败，忽略
        }
    }
    async appendToFile(entry) {
        if (!this.logFilePath)
            return;
        try {
            const dir = path_1.default.dirname(this.logFilePath);
            if (dir && dir !== '.') {
                await promises_1.default.mkdir(dir, { recursive: true });
            }
            await promises_1.default.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
        }
        catch {
            // 写文件失败不抛错，静默忽略
        }
    }
    /**
     * 追加一条记忆记录
     * 在子目标真正完成后，由 Loop 统一调用
     */
    append(entry) {
        const fullEntry = { ...entry, ts: Date.now() };
        this.entries.push(fullEntry);
        // 确保写入顺序
        this.lastWritePromise = this.lastWritePromise.then(() => {
            return this.appendToFile(fullEntry);
        });
        this.pendingWrites.push(this.lastWritePromise);
    }
    /**
     * 等待所有待处理的写入完成
     */
    async flush() {
        await this.lastWritePromise;
        this.pendingWrites = [];
    }
    /**
     * 获取所有记忆
     */
    all() {
        return [...this.entries];
    }
    /**
     * 根据 userRequest 关键词检索记忆
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.entries.filter(e => e.userRequest.toLowerCase().includes(lowerQuery) ||
            e.solutionSummary.toLowerCase().includes(lowerQuery));
    }
    /**
     * 获取最近的 N 条记忆
     */
    recent(n) {
        return this.entries.slice(-n);
    }
    /**
     * 序列化（JSON 格式）
     */
    serialize() {
        return JSON.stringify(this.entries, null, 2);
    }
    /**
     * 获取记忆数量
     */
    size() {
        return this.entries.length;
    }
}
exports.Memory = Memory;
//# sourceMappingURL=memory.js.map