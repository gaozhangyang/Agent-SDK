"use strict";
// [核心层 / 日志] core/trace.ts — Trace + TerminalLog 双流，追加写 .jsonl
// 修改：统一 seq 序号空间、trace.jsonl 补齐字段、terminal.md 格式优化
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalLog = exports.Trace = exports.GlobalSeqManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
/**
 * 全局序号管理器 - 统一 seq 序号空间
 * Trace 和 TerminalLog 共享同一个全局递增序号
 */
class GlobalSeqManager {
    seq = 0;
    logFilePath;
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
    }
    /**
     * 从文件加载累积的 seq（用于 Session 恢复）
     */
    async loadFromFile() {
        if (!this.logFilePath)
            return;
        try {
            const content = await promises_1.default.readFile(this.logFilePath, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            // 从最后一条记录获取最大 seq
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.seq > this.seq) {
                        this.seq = entry.seq;
                    }
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
    /**
     * 获取下一个全局序号
     */
    next() {
        this.seq++;
        return this.seq;
    }
    /**
     * 获取当前序号
     */
    get() {
        return this.seq;
    }
    /**
     * 设置序号（用于恢复场景）
     */
    set(seq) {
        this.seq = seq;
    }
}
exports.GlobalSeqManager = GlobalSeqManager;
/**
 * Trace：推理轨迹
 * 使用全局序号管理器，与 TerminalLog 共享序号空间
 */
class Trace {
    entries = [];
    seqManager;
    logFilePath;
    pendingWrites = [];
    lastWritePromise = Promise.resolve();
    constructor(logFilePath) {
        this.logFilePath = logFilePath;
        this.seqManager = new GlobalSeqManager(logFilePath);
    }
    /**
     * 从文件加载累积的 Trace 条目（用于 Session 恢复）
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
            // 从文件恢复 seq
            await this.seqManager.loadFromFile();
        }
        catch {
            // 文件不存在或读取失败，忽略
        }
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
    /**
     * 追加 Trace 条目
     * @param entry 忽略 seq 字段，由全局序号管理器分配（除非显式传入）
     */
    append(entry) {
        // 如果传入 seq，使用传入的 seq；否则由全局序号管理器分配
        const seq = entry.seq ?? this.seqManager.next();
        const fullEntry = { ...entry, seq };
        this.entries.push(fullEntry);
        // 创建一个链接到上一个写入的 promise，确保顺序
        this.lastWritePromise = this.lastWritePromise.then(() => {
            return this.appendToFile(fullEntry);
        });
        this.pendingWrites.push(this.lastWritePromise);
        return seq; // 返回分配的 seq，供 TerminalLog 使用
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
        return this.seqManager.get();
    }
    /**
     * 设置全局序号管理器（由外部注入，实现与 TerminalLog 共享）
     */
    setSeqManager(seqManager) {
        this.seqManager = seqManager;
    }
    /**
     * 获取全局序号管理器（供 TerminalLog 共享）
     */
    getSeqManager() {
        return this.seqManager;
    }
}
exports.Trace = Trace;
/**
 * TerminalLog：执行终端日志
 * 支持两种格式：
 * 1. JSON 格式（trace.jsonl）：用于程序解析
 * 2. Markdown 格式（terminal.md）：用于人类阅读
 *
 * 修改：使用全局序号管理器统一 seq、terminal.md 格式优化
 */
class TerminalLog {
    entries = [];
    seqManager;
    logFilePath; // JSON 格式日志路径
    terminalLogFilePath; // Markdown 格式日志路径（从 terminal.log 改为 terminal.md）
    pendingWrites = [];
    lastWritePromise = Promise.resolve();
    // 路径别名映射（用于 terminal.md）
    pathAliases = new Map();
    // 当前工作目录（用于生成路径别名）
    baseDir = '';
    constructor(logFilePath, terminalLogFilePath, baseDir) {
        this.logFilePath = logFilePath;
        this.terminalLogFilePath = terminalLogFilePath;
        this.baseDir = baseDir || '';
        // 如果没有传入 seqManager，需要创建一个（但应该由外部传入共享的）
        this.seqManager = new GlobalSeqManager(logFilePath);
    }
    /**
     * 设置全局序号管理器（由外部注入，实现与 Trace 共享）
     */
    setSeqManager(seqManager) {
        this.seqManager = seqManager;
    }
    /**
     * 初始化路径别名
     */
    initPathAliases() {
        this.pathAliases.clear();
        // 简化工作目录路径，生成别名
        if (this.baseDir) {
            const parts = this.baseDir.split('/');
            // 取最后 2-3 个有意义的目录名作为别名
            const shortParts = parts.slice(-3);
            const alias = '$' + shortParts.join('/');
            this.pathAliases.set(this.baseDir, alias);
        }
    }
    /**
     * 将路径转换为别名形式
     */
    shortenPath(filePath) {
        for (const [fullPath, alias] of this.pathAliases.entries()) {
            if (filePath.startsWith(fullPath)) {
                return filePath.replace(fullPath, alias);
            }
        }
        return filePath;
    }
    /**
     * 格式化时间为 HH:mm:ss 格式（更简洁）
     */
    formatTimestamp(ts) {
        const date = new Date(ts);
        return date.toTimeString().slice(0, 8);
    }
    /**
     * 将 TerminalEntry 转换为人类友好的 Markdown 格式
     *
     * 修改：根据 change.md 要求
     * - terminal.md不需要展示完整的输入输出, 只记录输入输出的来源即可
     * - 比如阅读了什么文件、参考了trace里面的第几行
     * - 路径别名
     * - 操作图标：📖 read · ✏️ write · 🔧 edit · 💻 bash · 🔍 collect · 🤖 llmcall
     * - 折叠块：<details> 收纳 input/output 正文（可选，通过开关控制）
     * - 截断引用
     * - 耗时标注
     *
     * Markdown 渲染规则：
     * 1. 表格前后必须有空行
     * 2. 表格必须有分隔符行（|---|---|）
     * 3. 表格单元格只放单行纯文本，截断用省略号
     * 4. 多行内容、含 Markdown 语法的内容全部放进 <details> 块
     * 5. </details> 后必须有空行，再写下一个 ## 标题
     */
    formatAsMarkdown(entry) {
        const ts = this.formatTimestamp(entry.ts);
        const seq = String(entry.seq).padStart(3, '0');
        // 操作图标映射
        const iconMap = {
            'llmcall': '🤖 llmcall',
            'collect': '🔍 collect',
            'read': '📖 read',
            'write': '✏️ write',
            'edit': '🔧 edit',
            'bash': '💻 bash',
        };
        const icon = iconMap[entry.operation] || entry.operation;
        const shortPath = entry.input ? this.shortenPath(entry.input) : '';
        // 耗时标注
        const durationStr = entry.durationMs !== undefined && entry.durationMs > 0
            ? ` · ${entry.durationMs}ms`
            : '';
        // 截断引用
        const truncatedRef = entry.truncated
            ? ` → full output at trace.jsonl#seq:${entry.seq}`
            : '';
        /**
         * 将内容转换为单行纯文本（用于表格单元格）
         * - 移除换行符
         * - 截断超长内容
         * - 转义管道符 | 以免破坏表格
         */
        const toSingleLine = (text, maxLen = 100) => {
            // 替换换行符为空格，转义管道符
            const singleLine = text.replace(/[\n\r]/g, ' ').replace(/\|/g, '\\|');
            if (singleLine.length > maxLen) {
                return singleLine.slice(0, maxLen) + '...';
            }
            return singleLine;
        };
        /**
         * 检查内容是否需要放进 <details> 块
         * - 多行内容
         * - 包含 Markdown 语法（##, ```, **, _, `, -, [ 等）
         */
        const needsDetailsBlock = (text) => {
            if (!text)
                return false;
            // 检查是否包含换行符
            if (/[\n\r]/.test(text))
                return true;
            // 检查是否包含 Markdown 语法
            if (/^#{1,6}\s|```|^\*\*|^\* |^`|^\[|^\- |^> /m.test(text))
                return true;
            return false;
        };
        /**
         * 检查内容是否为模板内容（包含模板占位符或模板标题）
         * 模板内容需要用 markdown 代码块包裹，避免 h1 标题污染层级
         */
        const isTemplateContent = (text) => {
            if (!text)
                return false;
            // 检查是否包含模板标题或占位符
            if (/^#\s*\[论文标题\]/m.test(text))
                return true;
            if (/\{arxiv_id\}|\{submitted_date\}|\{authors\}|\{generated_date\}/.test(text))
                return true;
            return false;
        };
        let content = '';
        let hasFullContent = false;
        switch (entry.operation) {
            case 'llmcall':
                // LLM 调用 - 只显示输入来源，不显示完整内容
                const inputPreview = toSingleLine(entry.input || '', 100);
                // 根据 change.md: 只记录输入输出的来源
                // 如果有 trace_ref，显示关联的 trace seq
                const traceRef = entry.trace_ref ? ` [trace#${entry.trace_ref}]` : '';
                content = `| input  | ${inputPreview}${traceRef} |\n| --- | --- |\n| output | ${entry.output ? '[LLM response]' : '[empty]'}${truncatedRef} |`;
                // 如果有 uncertainty，显示出来
                if (entry.durationMs !== undefined) {
                    content += `\n| --- | --- |\n| duration | ${entry.durationMs}ms |`;
                }
                // 不再显示完整内容
                hasFullContent = false;
                break;
            case 'collect':
                // Collect 操作 - 只显示查询来源，不显示完整结果
                const collectQuery = toSingleLine(shortPath || entry.input || '', 100);
                // 只显示来源数量和简要信息
                const sourceCount = entry.input ? (entry.input.match(/"type"/g) || []).length : 0;
                content = `| query  | ${collectQuery} |\n| --- | --- |\n| sources | ${sourceCount} sources collected${truncatedRef} |`;
                hasFullContent = false;
                break;
            case 'read':
                // 文件读取 - 只显示文件路径，不显示内容
                const readPath = toSingleLine(shortPath, 100);
                // 根据 change.md: 只记录输入输出的来源
                content = `| path   | ${readPath} |\n| --- | --- |\n| content | [read ${entry.output.length} bytes]${truncatedRef} |`;
                hasFullContent = false;
                break;
            case 'write':
                // 文件写入 - 只显示文件路径
                const writePath = toSingleLine(shortPath, 100);
                content = `| path   | ${writePath} |\n| --- | --- |\n| result | [written] |`;
                hasFullContent = false;
                break;
            case 'edit':
                // 文件编辑 - 只显示文件路径
                const editPath = toSingleLine(shortPath, 100);
                content = `| path   | ${editPath} |\n| --- | --- |\n| result | [edited] |`;
                hasFullContent = false;
                break;
            case 'bash':
                // Bash 命令 - 只显示命令，不显示输出内容
                const exitInfo = entry.exitCode !== undefined ? ` (exit=${entry.exitCode})` : '';
                const bashCmd = toSingleLine(entry.command || '', 100);
                // 根据 change.md: 只记录命令来源，不显示完整输出
                content = `| cmd    | ${bashCmd} |\n| --- | --- |\n| output | [executed]${exitInfo}${truncatedRef} |`;
                hasFullContent = false;
                break;
        }
        // 构建 Markdown 格式
        // 规则1: 表格前必须有空行
        const lines = [
            `## \`seq:${seq}\` · \`${ts}\` · ${icon}${durationStr}`,
            '',
            content,
        ];
        // 根据 change.md: 只记录输入输出的来源，不显示完整内容
        // 已简化：不再使用 <details> 块显示完整内容
        return lines.join('\n');
    }
    /**
     * 写入 Markdown 格式日志
     */
    async writeMarkdownFormat(entry) {
        if (!this.terminalLogFilePath)
            return;
        try {
            const dir = path_1.default.dirname(this.terminalLogFilePath);
            if (dir && dir !== '.') {
                await promises_1.default.mkdir(dir, { recursive: true });
            }
            // 首次写入时添加头部
            const fileExists = await promises_1.default.access(this.terminalLogFilePath).then(() => true).catch(() => false);
            let header = '';
            if (!fileExists) {
                // 初始化路径别名
                this.initPathAliases();
                // 生成路径别名头部
                let aliasHeader = '# Terminal Log\n\n';
                for (const [fullPath, alias] of this.pathAliases.entries()) {
                    aliasHeader += `${alias} = ${fullPath}\n`;
                }
                aliasHeader += '\n---\n\n';
                header = aliasHeader;
            }
            const mdContent = this.formatAsMarkdown(entry);
            const content = header + mdContent + '\n\n';
            if (header) {
                // 首次写入，写入头部 + 内容
                await promises_1.default.writeFile(this.terminalLogFilePath, content, 'utf-8');
            }
            else {
                // 追加内容
                await promises_1.default.appendFile(this.terminalLogFilePath, mdContent + '\n\n', 'utf-8');
            }
        }
        catch {
            // 写文件失败不抛错，静默忽略
        }
    }
    /**
     * 将内容转换为单行纯文本（用于表格单元格）
     */
    toSingleLine(text, maxLen = 100) {
        if (!text)
            return '';
        // 替换换行符为空格，转义管道符
        const singleLine = text.replace(/[\n\r]/g, ' ').replace(/\|/g, '\\|');
        if (singleLine.length > maxLen) {
            return singleLine.slice(0, maxLen) + '...';
        }
        return singleLine;
    }
    /**
     * 检查内容是否需要放进 <details> 块
     */
    needsDetailsBlock(text) {
        if (!text)
            return false;
        // 检查是否包含换行符
        if (/[\n\r]/.test(text))
            return true;
        // 检查是否包含 Markdown 语法
        if (/^#{1,6}\s|```|^\*\*|^\* |^`|^\[|^\- |^> /m.test(text))
            return true;
        return false;
    }
    /**
     * 添加用户输入记录（USER 角色）
     */
    appendUserInput(message) {
        const ts = Date.now();
        const seq = this.seqManager.next();
        const entry = {
            ts,
            seq,
            operation: 'llmcall', // 使用 llmcall 作为占位操作类型
            input: message,
            output: '[User Input]',
        };
        this.entries.push(entry);
        // 写入 Markdown 格式
        const tsStr = this.formatTimestamp(ts);
        const seqStr = String(seq).padStart(3, '0');
        // 表格单元格只放单行纯文本
        const messagePreview = this.toSingleLine(message, 100);
        // 构建 Markdown 格式（遵循渲染规则）
        let mdContent = `## \`seq:${seqStr}\` · \`${tsStr}\` · 👤 USER\n`;
        mdContent += '\n';
        mdContent += `| input | ${messagePreview} |\n`;
        // 如果消息需要 <details> 块
        if (this.needsDetailsBlock(message)) {
            mdContent += '\n<details><summary>完整内容</summary>\n\n';
            mdContent += '````\n';
            mdContent += message + '\n';
            mdContent += '````\n\n';
            mdContent += '</details>\n';
            mdContent += '\n';
        }
        // 使用 writeMarkdown 追加内容（保持追加写语义）
        this.writeMarkdown(mdContent);
        // 写入 JSON 格式
        this.lastWritePromise = this.lastWritePromise.then(() => {
            return this.appendToFile(entry);
        });
        this.pendingWrites.push(this.lastWritePromise);
    }
    /**
     * 写入 Markdown 格式日志
     */
    async writeMarkdown(line) {
        if (!this.terminalLogFilePath)
            return;
        try {
            const dir = path_1.default.dirname(this.terminalLogFilePath);
            if (dir && dir !== '.') {
                await promises_1.default.mkdir(dir, { recursive: true });
            }
            await promises_1.default.appendFile(this.terminalLogFilePath, line + '\n', 'utf-8');
        }
        catch {
            // 写文件失败不抛错，静默忽略
        }
    }
    /**
     * 从文件加载累积的 Terminal Log 条目（用于 Session 恢复）
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
            // 从文件恢复 seq
            await this.seqManager.loadFromFile();
        }
        catch {
            // 文件不存在或读取失败，忽略
        }
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
    /**
     * 追加 Terminal Entry
     * @param entry 忽略 seq 字段，由全局序号管理器分配
     * @param writeTrace 是否同时写入 trace.jsonl（默认 false，避免重复记录）
     *                   只有 loop.ts 层的操作才需要写入 trace.jsonl
     */
    append(entry, writeTrace = false) {
        const seq = this.seqManager.next();
        const fullEntry = { ...entry, seq };
        this.entries.push(fullEntry);
        // 1. 先写入 Markdown 友好格式（terminal.md）
        // 初始化路径别名（首次写入时）
        if (this.pathAliases.size === 0) {
            this.initPathAliases();
        }
        const mdContent = this.formatAsMarkdown(fullEntry);
        this.writeMarkdown(mdContent);
        // 2. 可选：写入 JSON 格式（trace.jsonl）
        // 只有明确指定 writeTrace=true 时才写入，避免重复记录
        // trace.jsonl 主要由 trace.append() 写入
        if (writeTrace) {
            this.lastWritePromise = this.lastWritePromise.then(() => {
                return this.appendToFile(fullEntry);
            });
            this.pendingWrites.push(this.lastWritePromise);
        }
        return seq; // 返回分配的 seq
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
        return this.seqManager.get();
    }
}
exports.TerminalLog = TerminalLog;
//# sourceMappingURL=trace.js.map