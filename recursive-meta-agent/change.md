# Change Proposal: Global Context & Verifier Observations

## 背景

当前设计存在两个核心问题：

1. **observations 由 script.py 自己填写**：script.py 是盲目执行者，不知道哪些信息对解决问题有用，导致父节点拿到的 context 语义空洞
2. **context 信息传递局部化**：verifier 只保留"当前子目标相关"的信息，但丢掉的信息可能是后续子目标必须的，造成不必要的 escalate

**解决方案**：引入 global context，所有节点的 observations 累积写入，所有节点 probe 阶段均可读取；利用 LLM prefix cache 机制，global context 作为每次调用的前缀，缓存命中后成本极低。

---

## 修改一：引入 global context

### 文件位置

```
{rootGoalDir}/global_context.md
```

存放在根目标目录下，所有子节点均可访问。

### 写入规范

每次追加写入，不重组文档结构，保持顺序累积。每条记录用节点路径标记来源，路径本身隐含层级关系。

每个节点写入两部分：observations（精炼）在前，console（完整原文）在后：

```
# From: survey_20260308/1_read_agent_config
## observations
- topics: ['Computer_Vision', 'NLP_and_LLM', 'Reinforcement_Learning']
- screening_threshold: 0.6，fetch_max_papers: 10
- 知识库路径格式: knowledge_base/{topic}/meta.json

## console
[DONE] 读取 AGENT.md，长度: 4821 字符
[DATA:agent_content] <<<
...完整内容...
>>>

# From: survey_20260308/2_fetch_papers/1_call_arxiv_api
## observations
- arXiv API 返回格式: {id, title, abstract, authors, categories}
- 实际返回条目数: 10，含 cs.CV: 6, cs.CL: 4

## console
[DONE] bash 执行完成
[DATA:bash_output] <<<
...完整输出...
>>>
```

observations 供 LLM 快速阅读，console 保留完整原始数据防止信息丢失。追加写入天然支持 LLM prefix cache；压缩时优先保留 observations，console 可按需裁剪。

### 读取规范

所有节点 probe 阶段读取 global context，拼接进 prompt，作为 LLM 输入的前缀。

### 废弃

各节点本地 `context.md` 不再创建和维护。

---

## 修改二：script.py 的 print 规范

### 原则

script.py 是纯执行者，只 print 可观测的事实，不做成功/失败的语义判断。**从外部读入的任何数据必须完整 print 出来**，verifier 才能判断信息是否足以完成 goal。

### 需要完整 print 的变量

- 文件内容（`read` 原语读取的任何文件）
- bash 命令的 stdout/stderr 输出
- llm_call 的返回结果

### 不需要 print 的变量

- 脚本内部拼接的命令字符串、路径、参数
- 从已 print 数据加工而来的中间变量

### 结构化标记规范

```
[DONE] <完成的操作描述>
[FAILED] <失败的操作描述>
[DATA:<label>] <<<
<完整数据内容，不截断>
>>>
```

`[DONE]` 和 `[DATA]` 成对出现：

```python
print(f"[DONE] 读取 AGENT.md，长度: {len(agent_content)} 字符")
print(f"[DATA:agent_content] <<<\n{agent_content}\n>>>")

print(f"[DONE] bash 执行完成")
print(f"[DATA:bash_output] <<<\n{bash_output}\n>>>")
```

### code_generator 的职责

生成 script.py 时，在每个关键操作后埋入对应 print：
- 每次文件读写 → `[DONE]`/`[FAILED]` + `[DATA]`
- 每次 bash 调用 → `[DONE]`/`[FAILED]` + `[DATA:bash_output]`
- 每次 llm_call → `[DONE]` + `[DATA:llm_output]`

---

## 修改三：results.md 写入分两个阶段

### 阶段一：script.py 执行后

script.py 只写 `result` 和 `console`，**不写 observations**：

```
status: pending

--- result ---
（做了什么，或失败原因，一句话）

--- console ---
（script.py 完整 stdout/stderr）
```

### 阶段二：verifier 分析后追加

verifier 读取 goal.md + results.md（含 console），分析后在末尾追加 `status` 更新和 `observations`：

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

## 修改四：verifier 生成 observations 的规范

### observations 的本质

verifier 从 console 原始数据中提炼出可直接被 LLM 使用的具体信息，**精确到无需任何额外工具调用或代码操作**即可使用。

### 内容要求

**1. 已获取的有效信息**（直接可用的文本细节）
- ✅ `topics: ['Computer_Vision', 'NLP_and_LLM', 'Reinforcement_Learning']`
- ✅ `screening_threshold: 0.6，fetch_max_papers: 10`
- ❌ `成功读取了 AGENT.md 文件`（没有提炼出可直接使用的内容）
- ❌ `AGENT.md 中包含 topics 配置`（仍需额外操作才能获取具体值）

**2. 失败的具体原因**（为什么这个方式行不通，仅 escalated 时）
- ✅ `topics 提取失败：代码按行遍历无法处理 JSON embedded in Markdown 的格式`
- ❌ `topics 格式未知，提取失败`

**3. 下一步建议**（仅 escalated 时）
- ✅ `需用 llm_call 直接阅读 AGENT.md 原文提取 topics，而非代码解析`

### verifier 完成后

将 observations 追加写入 `{rootGoalDir}/global_context.md`，格式见修改一。

---

## 修改五：global context 压缩机制

### 触发时机

每次向 global context 写入前，检查当前文件长度。超过阈值则先压缩再写入。

### compressor 职责

新增 `compressor` 角色，接收当前 global context 全文，输出压缩后的版本：
- 保留所有 observations（key facts：具体数值、路径、配置、接口格式等）
- console 部分优先裁剪：丢弃已被 observations 覆盖的 DATA 块，保留 observations 未能覆盖的原始数据
- 保留来源标记（`# From: {path}`），合并同一子树的同类信息

### 压缩阈值

建议初始值：`context_budget_total` 的 60%，可在 AGENT.md 中配置项 `context_compression_threshold` 中设置。

---

## 涉及改动的文件

| 文件 | 改动内容 |
|------|---------|
| `prompts/code_generator.md` | 补充结构化 print 规范；script.py 不再写 observations，只写 result + console |
| `prompts/verifier.md` | 补充 console 标记说明；verifier 负责生成 observations 并写入 global context |
| `prompts/compressor.md` | 新增，定义压缩规则：保留 key facts，丢弃过程性描述 |
| `meta_agent.py`（probe） | 读取 global context 拼接进 prompt，不再读写本地 context.md |
| `meta_agent.py`（execute_with_verification） | results.md 写入改为两阶段；verifier 完成后触发 global context 写入（含压缩检查） |
| `AGENT.md` | 新增 `context_compression_threshold` 配置项 |

完成任务后需要修改对应的README.md