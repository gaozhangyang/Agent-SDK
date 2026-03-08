# Change Proposal: Script Console Output & Verifier Feedback

## 背景

当前两个核心问题：

1. script.py 执行"成功"但任务未完成时，verifier 信息不足，无法向父节点传递有效反馈
2. observations 由 script.py 自己填写，但 script.py 是盲目执行者，不知道哪些信息对解决问题有用，导致父节点拿到的 context 语义空洞

---

## 修改一：script.py 的 print 规范

### 原则

script.py 是纯执行者，只 print 可观测的事实，不做成功/失败的语义判断。

### 结构化标记规范

```
[DONE] <完成的操作描述>
[FAILED] <失败的操作描述>
[DATA:<label>] <<<
<完整数据内容，不截断>
>>>
```

### 示例

```python
print(f"[DONE] 读取 AGENT.md，路径: {agent_md_path}，长度: {len(agent_content)} 字符")
print(f"[DONE] topics 解析完成，结果条目数: {len(topics_found)}")
print(f"[DATA:agent_content] <<<\n{agent_content}\n>>>")
```

### code_generator 的职责

生成 script.py 时，在每个关键操作后埋入对应 print：
- 每次文件读写 → `[DONE]` 或 `[FAILED]`
- 每次解析/提取操作 → `[DONE]` + 结果数量/长度等可观测量
- 所有中间数据 → `[DATA:<label>]` 块（完整输出，不截断）

---

## 修改二：results.md 写入分两个阶段

### 阶段一：script.py 执行后写入

script.py 只负责写 `result` 和 `console`，**不写 observations**：

```
status: pending

--- result ---
（做了什么，或失败原因，一句话）

--- console ---
（script.py 完整 stdout/stderr）
```

### 阶段二：verifier 分析后补全

verifier 读取 goal.md + results.md（含 console），分析后填写 `status` 和 `observations`：

```
status: completed | escalated

--- result ---
（保持不变）

--- console ---
（保持不变）

--- observations ---
（verifier 填写，追加在末尾）
```

### verifier 的输入

- `goal.md`
- `results.md`（已包含 result + console，不单独再传 console）

---

## 修改三：verifier 生成 observations 的规范

### observations 的本质

verifier 从 console 原始数据中提炼出对父节点解决问题有用的具体信息，直接写入父节点 context.md。

**不是**描述执行了什么操作，**而是**从数据中提取出可直接使用的具体细节。

### 内容要求

**1. 已获取的有效信息**（精确到可直接被 LLM 使用的文本细节，无需额外工具调用或代码操作）
- ✅ `topics: ['Computer_Vision', 'NLP_and_LLM', 'Reinforcement_Learning']`
- ✅ `screening_threshold: 0.6，fetch_max_papers: 10`
- ✅ `知识库路径格式: knowledge_base/{topic}/meta.json`
- ❌ `成功读取了 AGENT.md 文件`（没有提炼出可直接使用的内容）
- ❌ `AGENT.md 中包含 topics 配置`（仍需额外操作才能获取具体值）

**2. 失败的具体原因**（为什么这个方式行不通）
- ✅ `topics 提取失败：代码按行遍历无法处理 JSON embedded in Markdown 的格式`
- ❌ `topics 格式未知，提取失败`

**3. 下一步建议**（仅 escalated 时）
- ✅ `需用 llm_call 直接阅读 AGENT.md 原文提取 topics，而非代码解析`

### 示例：escalated 场景

```
- AGENT.md 已确认存在，内容完整可读
- topics 提取失败：代码按行遍历无法处理 JSON embedded in Markdown 格式，结果条目数为 0
- 下一步：需用 llm_call 直接阅读 AGENT.md 原文提取 topics
```

### 示例：completed 场景

```
- topics 共 3 个：Computer_Vision（cs.CV）、NLP_and_LLM（cs.CL, cs.LG）、Reinforcement_Learning（cs.LG, cs.AI）
- screening_threshold: 0.6，fetch_max_papers: 10
- 知识库路径格式：knowledge_base/{topic}/meta.json
```

---

## 重要

完成任务后需要更新README.md(只做必要修改)