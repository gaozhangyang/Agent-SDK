"use strict";
/**
 * 服务端用：将 bash 限定在 workDir 下执行，read/write/edit 与本地一致（路径由调用方传绝对路径）
 * 符合 L0.1 原语接口冻结，仅替换实现
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkDirPrimitives = createWorkDirPrimitives;
const promises_1 = __importDefault(require("fs/promises"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const path_1 = require("path");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * 创建以 workDir 为 bash 工作目录的 Primitives
 * read/write/edit 使用绝对路径；bash 在 workDir 下执行
 */
function createWorkDirPrimitives(workDir) {
    return {
        async read(path) {
            return promises_1.default.readFile(path, 'utf-8');
        },
        async write(filePath, content) {
            const dir = (0, path_1.dirname)(filePath);
            await promises_1.default.mkdir(dir, { recursive: true });
            await promises_1.default.writeFile(filePath, content, 'utf-8');
        },
        async edit(path, old, next) {
            const content = await promises_1.default.readFile(path, 'utf-8');
            const count = content.split(old).length - 1;
            if (count !== 1) {
                throw new Error(`edit: old string must match exactly once, found ${count} times`);
            }
            await promises_1.default.writeFile(path, content.replace(old, next), 'utf-8');
        },
        async bash(command) {
            const { stdout, stderr } = await execAsync(command, { cwd: workDir });
            return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        },
    };
}
//# sourceMappingURL=primitives.js.map