# Compressor Prompt

Compress the global context to save token budget while preserving key information.

## 输入

当前 global context 全文：
{global_context}

## 压缩规则

### 1. 必须保留

- **所有 observations**：包含具体数值、路径、配置、接口格式等可直接使用的关键信息
- **来源标记**：`# From: {path}` 标记，保留每个信息来源的路径

### 2. 可以丢弃

- **console 部分**：优先裁剪已被 observations 覆盖的 DATA 块
- **重复信息**：同一来源的多次记录只保留最新的
- **过程性描述**：只保留结果，不保留中间过程

### 3. 合并策略

- 同一子树的同类信息合并
- 保留关键事实，删除冗余描述

## 输出格式

返回压缩后的 global context 文本，保持原有的 `# From:` 标记结构。

## 示例

输入：
```
# From: survey/1_read_config
## observations
- topics: ['Computer_Vision', 'NLP_and_LLM']
- threshold: 0.6

## console
[DONE] 读取文件...
[DATA:content] <<<
...
>>>
```

输出：
```
# From: survey/1_read_config
## observations
- topics: ['Computer_Vision', 'NLP_and_LLM']
- threshold: 0.6
```
