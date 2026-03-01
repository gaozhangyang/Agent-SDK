"use strict";
/**
 * L0.1 — 四个执行原语
 *
 * 接口定义冻结，永不修改
 * 实现层可以替换（本地 fs、sandbox、远程等），但签名不变
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localPrimitives = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = require("path");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * 默认实现：本地文件系统 + 子进程
 */
exports.localPrimitives = {
    /**
     * 读取文件内容
     */
    async read(path) {
        return promises_1.default.readFile(path, 'utf-8');
    },
    /**
     * 写入文件内容（创建或覆写）
     * 自动创建父目录
     * @param filePath 文件路径
     * @param content 要写入的内容
     * @param append 如果为true，则追加到文件末尾（适用于survey_output.md等日志文件）
     */
    async write(filePath, content, append = false) {
        const dir = (0, path_1.dirname)(filePath);
        await promises_1.default.mkdir(dir, { recursive: true });
        if (append && filePath.includes('survey_output')) {
            // 追加模式：先读取现有内容，然后追加新内容
            try {
                const existing = await promises_1.default.readFile(filePath, 'utf-8');
                await promises_1.default.writeFile(filePath, existing + '\n' + content, 'utf-8');
            }
            catch {
                // 文件不存在，直接创建
                await promises_1.default.writeFile(filePath, content, 'utf-8');
            }
        }
        else {
            await promises_1.default.writeFile(filePath, content, 'utf-8');
        }
    },
    /**
     * 精确局部替换
     * @throws 如果 old 字符串在文件中不唯一匹配
     */
    async edit(path, old, next) {
        const content = await promises_1.default.readFile(path, 'utf-8');
        const count = content.split(old).length - 1;
        if (count !== 1) {
            throw new Error(`edit: old string must match exactly once, found ${count} times`);
        }
        await promises_1.default.writeFile(path, content.replace(old, next), 'utf-8');
    },
    /**
     * 执行系统命令
     */
    async bash(command) {
        const { stdout, stderr } = await execAsync(command);
        return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    },
};
//# sourceMappingURL=primitives.js.map