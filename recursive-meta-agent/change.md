# Meta-Agent 第二轮改动方案

## 核心变更概述

本轮改动围绕三个主题：
1. verifier 职责重定位：从 pass/fail 判断改为直接信息提取
2. decomposer 补充兄弟任务上下文，让 verifier 知道"哪些信息对后续有用"
3. 引入 `<<read>>` 间接信息机制，probe 阶段自动解引用

---

## 改动一：verifier 职责重定位

### 现状
verifier 输出 `{"pass": bool, "reason": str}`，判断执行结果是否达到 goal，触发重试或 escalate。

### 改动
verifier 不再做 pass/fail 判断，只做**直接信息提取**。

**新职责**：
- 从 observation（script 的 stdout）中识别对后续任务有直接帮助的信息
- 区分直接信息和间接信息（定义见下文）
- 把直接信息整理后写入父节点 context.md
- 把间接信息以 `<<read>>` 块形式写入父节点 context.md

**直接信息**：code_generator 拿到后可以直接写进 script 使用，不需要额外读取或查询。例如：
- 脚本的具体调用方式和参数
- 已解析出的配置值、关键词列表
- API 的具体参数格式
- 任何可以直接复制进 script 的具体数据

**间接信息**：指向信息存储位置的指针，需要再次读取才能获得直接信息。例如：
- 文件路径（`结果写入了 data/selected_papers.json`）
- 目录位置（`配置在 AGENT.md 里`）
- 需要进一步读取才能使用的引用

### 新的 verifier prompt 结构

```
输入：
- goal.md 内容（做什么、输出要求、输出用途、后续兄弟任务）
- script 内容
- observation（script 的完整 stdout）

输出：
{
  "direct_info": "可直接写进 script 使用的具体信息，格式化为清晰的文本",
  "indirect_files": ["path/to/file1", "path/to/file2"]  // 需要读取的文件路径列表
}

规则：
- direct_info 里只放可以直接使用的具体值，不放文件路径
- indirect_files 里只放确实对后续任务有用的文件路径
- 结合 goal.md 的"后续兄弟任务"判断哪些信息对后续真正有用
- 失败信息也是直接信息，应写入 direct_info（失败原因、错误详情）
```

### 写入父节点 context.md 的格式

verifier 执行完后，执行器负责把结果写入父节点 context.md：

```
# From: {subtask_name}
{direct_info}

<<read>> path/to/file1 <<read/>>
<<read>> path/to/file2 <<read/>>
```

---

## 改动二：decomposer 补充后续兄弟任务信息

### 现状
decomposer 生成的子任务 description（即 goal.md 内容）只包含三段：做什么、输出要求、输出用途。

### 改动
在 goal.md 里增加第四段：**后续兄弟任务列表**。

decomposer 在生成子任务列表时，已经持有全局结构，知道每个子任务之后还有哪些任务。在写每个子任务的 goal.md 时，把它之后的兄弟任务名称和简要描述一并写入。

**新的 goal.md 四段式结构**：

```markdown
## 任务
（做什么）

## 输出要求
（需要输出什么，具体到信息粒度）

## 输出用途
（哪个后续任务会消费这个输出，用来做什么；
  若无后续任务，写"输出给父节点用于最终结果"）

## 后续兄弟任务
（当前任务完成后，接下来还有哪些任务，每个任务一行简要描述；
  verifier 结合此信息判断哪些 observation 对后续任务有直接帮助；
  若无后续任务，此段留空或省略）
```

**示例**：
```markdown
## 任务
读取 AGENT.md 配置文件，提取三个主题的配置信息

## 输出要求
输出每个主题的 name、keywords 列表、arxiv_categories 列表，格式为可直接使用的 Python 列表

## 输出用途
输出给 fetch_papers 任务，用于构建 arXiv API 查询请求

## 后续兄弟任务
- fetch_papers：根据主题配置从 arXiv 抓取论文，需要具体的 categories 和 keywords
- screen_papers：基于关键词筛选论文，需要知道每个主题的筛选阈值
```

### decomposer prompt 改动
要求 decomposer 在生成每个子任务时：
- 显式列出该子任务之后的所有兄弟任务
- 每个兄弟任务写一行，包含名称和它需要什么输入
- 没有后续任务时省略此段

---

## 改动三：`<<read>>` 间接信息机制

### 设计概述

间接信息（文件路径）通过 `<<read>>` 块写入父节点 context.md，probe 阶段自动解引用为直接信息，避免触发额外的 meta_agent 调用。

### 3.1 写入阶段（verifier → 执行器）

verifier 输出 `indirect_files` 列表后，执行器在写入父节点 context.md 时，把每个路径包装为 `<<read>>` 块：

```
<<read>> data/raw_papers.json <<read/>>
```

### 3.2 解引用阶段（probe）

probe 读取父节点 context.md 后，用正则提取所有 `<<read>>` 块，逐一处理：

**情况一：文件不存在**
```
<<read:error>> data/raw_papers.json 不存在 <<read/>>
```

**情况二：文件在预算内**
直接替换为文件内容：
```
# data/raw_papers.json
（完整文件内容）
```

**情况三：文件超出剩余 context 预算**
替换为截断内容，附加提示：
```
# data/raw_papers.json
[截断：仅显示前 N tokens，文件共 M tokens]
（截断范围内的文件内容）
[如需读取更多，可创建子任务：读取 offset=N 之后的部分，替换父节点 context.md 中本段内容]
```

截断阈值计算方式：`剩余预算 = context_budget_total - 当前 context.md 已用 tokens`，每个文件按剩余预算的比例分配，不单独设固定阈值。

### 3.3 续读阶段（按需，由 LLM 主动触发）

LLM 判断截断内容不够用时，主动创建子任务：
- 子任务 goal：读取指定文件从 offset=N 开始的内容
- 子任务完成后，用读取到的内容**精确替换**父节点 context.md 中对应的截断块
- 不追加，只替换，避免 context 膨胀

### 3.4 不支持嵌套
读取的文件内容里如果包含 `<<read>>` 块，probe 不递归处理，直接当作普通文本。

### 3.5 probe 处理顺序
```
1. 读取当前节点 goal.md
2. 读取父节点 goal.md，提取"后续兄弟任务"段落，追加到当前节点 context.md：
   # 父节点的后续兄弟任务
   （从父节点 goal.md 的"后续兄弟任务"段落直接复制）
3. 读取父节点 context.md
4. 正则提取所有 <<read>> 块
5. 按顺序逐一解引用（计算剩余预算时累减已替换内容的 tokens）
6. 写回 context.md（解引用后的版本）
7. 返回处理完毕的 context 供后续使用
```

**说明**：
- 步骤 2 使当前节点的 verifier 能感知到祖父层级的任务需求，判断哪些 observation 对更上层的后续任务也有直接帮助
- 只追溯一层（自己的兄弟 + 父节点的兄弟），更高层的祖先任务已经在父节点的 context.md 里，probe 读取时自然继承
- 根节点（depth=0）没有父节点，跳过步骤 2

---

## 文件变动总览

| 文件 | 操作 |
|------|------|
| `prompts/verifier.md` | 完全重写：去掉 pass/fail，改为直接信息提取 + 间接文件识别 |
| `prompts/decomposer.md` | 增加第四段：后续兄弟任务列表 |
| `executor.py` | verifier 结果解析改为读 direct_info + indirect_files；写父节点 context.md 时生成 `<<read>>` 块 |
| `probe.py` | 增加两处改动：(1) 固定读取父节点 goal.md 的"后续兄弟任务"段落写入当前 context.md；(2) `<<read>>` 块解引用逻辑，含预算计算、截断、错误处理 |
| `agent.py` | 去掉 verifier pass/fail 分支判断，verifier 结果直接交给执行器写 context |

---

## 不变的部分

- verifier 仍然在每个子节点执行完后触发，时机不变
- 失败信息仍作为 observation 写入父节点 context.md，只是现在由 verifier 的 direct_info 承载
- probe 的其余逻辑不变（读 goal.md、目录结构等）
- `<<read>>` 块只在 probe 阶段处理，其余阶段不感知

重要：要严格测试修改的正确性，完成修改后要记得更新recursive-meta-agent和recursive_survey_agent的README.m使得项目状态和描述一致。