"use strict";
// [核心层 / 日志] core/trace.ts — Trace + TerminalLog 双流，追加写 .jsonl
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalLog = exports.Trace = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
/**
 * Trace：推理轨迹
 */
class Trace {
    entries = [];
    seq = 0;
    logFilePath;
    pendingWrites = [];
    lastWritePromise = Promise.resolve();
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
    }
    async appendToFile(entry) {
        if (!this.logFilePath)
            return;
        try {
            // 使用 path.dirname 获取目录
            const dir = path_1.default.dirname(this.logFilePath);
            if (dir && dir !== '.') {
                await promises_1.default.mkdir(dir, { recursive: true });
            }
            // 等待目录创建完成后再写入文件
            await promises_1.default.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
        }
        catch {
            // 写文件失败不抛错，静默忽略
        }
    }
    append(entry) {
        this.seq++;
        const fullEntry = { ...entry, seq: this.seq };
        this.entries.push(fullEntry);
        // 创建一个链接到上一个写入的 promise，确保顺序
        this.lastWritePromise = this.lastWritePromise.then(() => {
            return this.appendToFile(fullEntry);
        });
        this.pendingWrites.push(this.lastWritePromise);
    }
    // 等待所有待处理的写入完成（按顺序）
    async flush() {
        // 等待最后的写入完成
        await this.lastWritePromise;
        this.pendingWrites = [];
    }
    filterByTag(tag) {
        return this.entries.filter(e => e.tags?.includes(tag));
    }
    all() {
        return [...this.entries];
    }
    serialize() {
        return JSON.stringify(this.entries, null, 2);
    }
    getSeq() {
        return this.seq;
    }
}
exports.Trace = Trace;
/**
 * TerminalLog：执行终端日志
 */
class TerminalLog {
    entries = [];
    seq = 0;
    logFilePath;
    pendingWrites = [];
    lastWritePromise = Promise.resolve();
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
    }
    async appendToFile(entry) {
        if (!this.logFilePath)
            return;
        try {
            // 使用 path.dirname 获取目录
            const dir = path_1.default.dirname(this.logFilePath);
            if (dir && dir !== '.') {
                await promises_1.default.mkdir(dir, { recursive: true });
            }
            // 等待目录创建完成后再写入文件
            await promises_1.default.appendFile(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
        }
        catch {
            // 写文件失败不抛错，静默忽略
        }
    }
    append(entry) {
        this.seq++;
        const fullEntry = { ...entry, seq: this.seq };
        this.entries.push(fullEntry);
        // 创建一个链接到上一个写入的 promise，确保顺序
        this.lastWritePromise = this.lastWritePromise.then(() => {
            return this.appendToFile(fullEntry);
        });
        this.pendingWrites.push(this.lastWritePromise);
    }
    // 等待所有待处理的写入完成（按顺序）
    async flush() {
        // 等待最后的写入完成
        await this.lastWritePromise;
        this.pendingWrites = [];
    }
    all() {
        return [...this.entries];
    }
    serialize() {
        return JSON.stringify(this.entries, null, 2);
    }
    getSeq() {
        return this.seq;
    }
}
exports.TerminalLog = TerminalLog;
//# sourceMappingURL=trace.js.map