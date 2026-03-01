"use strict";
/**
 * Agent Runtime Core SDK
 *
 * 基于《Coding Agent 设计原则分级指南》L0 + L1 的最简约实现方案
 * 面向 opencode prompt / 系统集成，作为可复用 SDK 供上层应用调用
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValidTransitions = exports.canTransition = exports.createInitialState = exports.Trace = exports.Harness = exports.runLoop = exports.collect = exports.LLMCall = exports.localPrimitives = void 0;
// Re-export all modules
var primitives_1 = require("./primitives");
Object.defineProperty(exports, "localPrimitives", { enumerable: true, get: function () { return primitives_1.localPrimitives; } });
var llm_1 = require("./llm");
Object.defineProperty(exports, "LLMCall", { enumerable: true, get: function () { return llm_1.LLMCall; } });
var collect_1 = require("./collect");
Object.defineProperty(exports, "collect", { enumerable: true, get: function () { return collect_1.collect; } });
var loop_1 = require("./loop");
Object.defineProperty(exports, "runLoop", { enumerable: true, get: function () { return loop_1.runLoop; } });
var harness_1 = require("./harness");
Object.defineProperty(exports, "Harness", { enumerable: true, get: function () { return harness_1.Harness; } });
var trace_1 = require("./trace");
Object.defineProperty(exports, "Trace", { enumerable: true, get: function () { return trace_1.Trace; } });
var state_1 = require("./state");
Object.defineProperty(exports, "createInitialState", { enumerable: true, get: function () { return state_1.createInitialState; } });
Object.defineProperty(exports, "canTransition", { enumerable: true, get: function () { return state_1.canTransition; } });
Object.defineProperty(exports, "getValidTransitions", { enumerable: true, get: function () { return state_1.getValidTransitions; } });
//# sourceMappingURL=index.js.map