"use strict";
// [核心层 / 原语] core/primitives.ts — 四个执行原语，接口永不修改
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localPrimitives = localPrimitives;
const promises_1 = __importDefault(require("fs/promises"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * 创建本地原语实现
 * @param coreDir SDK 的 src/ 目录绝对路径，用于路径白名单保护
 * @param terminalLog TerminalLog 实例，用于 bash 执行后自动记录
 */
function localPrimitives(coreDir, terminalLog) {
    const isPathAllowed = (path) => {
        const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
        const normalizedCoreDir = coreDir.replace(/\\/g, '/').toLowerCase();
        return !normalizedPath.startsWith(normalizedCoreDir + '/');
    };
    return {
        async read(path) {
            return promises_1.default.readFile(path, 'utf-8');
        },
        async write(path, content) {
            if (!isPathAllowed(path)) {
                throw new Error('write: cannot modify core directory');
            }
            await promises_1.default.writeFile(path, content, 'utf-8');
        },
        async edit(path, old, next) {
            if (!isPathAllowed(path)) {
                throw new Error('edit: cannot modify core directory');
            }
            const content = await promises_1.default.readFile(path, 'utf-8');
            const count = content.split(old).length - 1;
            if (count !== 1) {
                throw new Error(`edit: old string must match exactly once, found ${count} times`);
            }
            await promises_1.default.writeFile(path, content.replace(old, next), 'utf-8');
        },
        async bash(command) {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let exitCode = 0;
            try {
                const { stdout: out, stderr: err } = await execAsync(command);
                stdout = out;
                stderr = err || '';
            }
            catch (error) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
                exitCode = error.code || 1;
            }
            const durationMs = Date.now() - startTime;
            const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
            // 自动写入 TerminalLog
            terminalLog.append({
                ts: Date.now(),
                command,
                stdout,
                stderr,
                exitCode,
                durationMs,
            });
            // 如果 exitCode 不为 0，抛出错误
            if (exitCode !== 0) {
                throw new Error(`Command exited with code ${exitCode}: ${command}`);
            }
            return output;
        },
    };
}
//# sourceMappingURL=primitives.js.map