# Survey Workflow Context

## Topics Configuration

```json
[
  {
    "name": "Computer_Vision",
    "keywords": [
      "video generation",
      "diffusion",
      "video synthesis",
      "long video",
      "image generation",
      "image editing"
    ],
    "arxiv_categories": [
      "cs.CV"
    ],
    "min_relevance_score": 0.6
  },
  {
    "name": "NLP_and_LLM",
    "keywords": [
      "language model",
      "LLM",
      "transformer",
      "attention",
      "large language model",
      "text generation"
    ],
    "arxiv_categories": [
      "cs.CL",
      "cs.LG"
    ],
    "min_relevance_score": 0.6
  },
  {
    "name": "Reinforcement_Learning",
    "keywords": [
      "reinforcement learning",
      "RL",
      "policy",
      "reward",
      "agent"
    ],
    "arxiv_categories": [
      "cs.LG",
      "cs.AI"
    ],
    "min_relevance_score": 0.5
  }
]
```

## Fetch Configuration

- fetch_max_papers: 10
- pdf_download_dir: data/pdfs
- screening_threshold: 0.6

## Skills Paths

- arxiv_api: /Applications/workspace/ailab/research/agent_runtime_core_final/recursive_survey_agent/skills/arxiv_api/SKILL.md
- screening: /Applications/workspace/ailab/research/agent_runtime_core_final/recursive_survey_agent/skills/screening/SKILL.md
- writing: /Applications/workspace/ailab/research/agent_runtime_core_final/recursive_survey_agent/skills/writing/SKILL.md
- pdf_extract: /Applications/workspace/ailab/research/agent_runtime_core_final/recursive_survey_agent/skills/pdf_extract/SKILL.md
