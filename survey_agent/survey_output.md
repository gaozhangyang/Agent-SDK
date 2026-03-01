[step14] 2026-03-01T21:34:57.507Z
$ 我需要分析这篇关于隐写术形式化和LLM监控的论文。让我先提取PDF的内容信息。
[TOOL_CALL]
{tool => "python", args => {
  --code "\nimport json\n\n# 从提供的信息中提取关键元数据\nmetadata = {\n    \"title\": \"A Decision-Theoretic Formalisation of Steganography With Applications to LLM Monitoring\",\n    \"arxiv_id\": \"2602.23163\",\n    \"authors\": \"Usman Anwar, Julianna Piskorz, David D. Baek, David Africa, Jim Weatherall, Max Tegmark, Christian Schroeder de Witt, Mihaela van der Schaar, David Krueger\",\n    \"submitted_date\": \"2026-02-27\",\n    \"categories\": [\"cs.AI\", \"cs.CL\", \"cs.CR\", \"cs.IT\", \"cs.MA\", \"math.IT\"]\n}\n\nprint(\"论文基本信息:\")\nprint(json.dumps(metadata, indent=2, ensure_ascii=False))\n"
}}
[/TOOL_CALL]