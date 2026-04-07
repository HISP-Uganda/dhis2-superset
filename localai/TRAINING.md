# Training `superset-ai-insights-model-26.04`

## Architecture

```
Base Model (Hermes-3-Llama-3.1-8B, 4.6GB GGUF)
    |
    +-- QLoRA Adapter (LoRA r=64, ~50MB)
    |       trained on 106+ domain-specific examples
    |
    +-- Merge → F16 → Quantize → GGUF (Q4_K_M)
    |
    +-- Deploy to LocalAI → /v1/chat/completions
```

**Key principle**: Adapter-only checkpoints during development. Merge only for release.

## Quick Start

```bash
# Full pipeline: prepare → train → export → evaluate → deploy
bash localai/finetune/pipeline.sh

# Or step by step:
bash localai/finetune/pipeline.sh prepare     # validate data, split train/eval
bash localai/finetune/pipeline.sh train       # QLoRA fine-tuning
bash localai/finetune/pipeline.sh export      # merge adapter + GGUF quantization
bash localai/finetune/pipeline.sh evaluate    # run benchmark suite
bash localai/finetune/pipeline.sh deploy      # copy GGUF to LocalAI

# Evaluate base model for comparison
bash localai/finetune/pipeline.sh baseline

# No GPU? Export for external training (Colab, Lambda, RunPod)
bash localai/finetune/pipeline.sh fallback
```

## Repo Structure

```
localai/
  finetune/
    config.yaml          # All hyperparameters, paths, model selection
    requirements.txt     # Python dependencies
    pipeline.sh          # Orchestration script (entry point)
    prepare_data.py      # Data validation, splitting, statistics
    train.py             # QLoRA fine-tuning with HuggingFace + PEFT
    merge_and_export.py  # Merge adapter → GGUF conversion + quantization
    evaluate.py          # Benchmark suite across 7 categories
    benchmarks/
      benchmarks.jsonl   # 14 curated evaluation prompts
    output/              # (generated) training artifacts
      train.jsonl        # Training split
      eval.jsonl         # Evaluation split
      adapter/           # LoRA adapter weights (~50MB)
      merged/            # Merged full model (~16GB)
      gguf/              # Quantized GGUF files
  models/
    ai-insights-model-26.04.yaml  # LocalAI model config
  training/
    ai-insights-training-data.jsonl  # 106 training examples
  train_and_deploy.sh    # Legacy script (uses LocalAI API)
  TRAINING.md            # This file
```

## Model Selection Policy

Configure in `config.yaml` or override with `FT_MODEL=small|balanced|large`:

| Policy   | Model                            | Params | VRAM  | Quality | Speed |
|----------|----------------------------------|--------|-------|---------|-------|
| small    | Qwen/Qwen2.5-3B-Instruct        | 3B     | 4 GB  | Good    | Fast  |
| balanced | NousResearch/Hermes-3-Llama-3.1-8B | 8B   | 8 GB  | Best    | Med   |
| large    | NousResearch/Hermes-2-Llama-3.1-13B | 13B  | 16 GB | Highest | Slow  |

Default: `balanced` (Hermes-3 8B). The 4.7GB base model is cached after first download.

## Training Data Format

Each example in `localai/training/ai-insights-training-data.jsonl`:

```json
{"messages":[
  {"role":"system","content":"...system prompt..."},
  {"role":"user","content":"...question + context..."},
  {"role":"assistant","content":"...target response in exact production style..."}
]}
```

Categories tracked:
- `chart_insight` — Interpret chart data with severity tags and recommendations
- `dashboard_summary` — Multi-chart executive summaries
- `sql_generation` — SQL for DHIS2 analytics marts
- `structured_json` — JSON responses (copilot, chart specs, dashboard plans)
- `recommendation` — Chart type and visualization recommendations
- `threshold_assessment` — Apply health program thresholds (WHO, national)
- `narrative_report` — Presentation-quality prose for exports

## Evaluation Benchmarks

7 categories, 14 curated prompts, automated scoring:

| Metric              | What it checks                                |
|---------------------|-----------------------------------------------|
| severity_tags       | Presence of [CRITICAL], [WARNING], [GOOD] etc |
| json_valid          | Valid JSON in structured responses             |
| sql_quality         | SQL keywords, structure, explanation           |
| threshold           | Correct threshold application + recommendations|
| narrative           | Structure, headings, bullets, actionability    |
| rouge_l             | ROUGE-L similarity to reference (when provided)|
| non_empty           | Response is substantive (>10 chars)            |

Quality gate: >= 0.70 PASS, >= 0.50 MARGINAL, < 0.50 FAIL

## QLoRA Hyperparameters

Defaults in `config.yaml`, override via env vars:

| Parameter              | Default  | Env Override |
|------------------------|----------|--------------|
| LoRA rank (r)          | 64       | —            |
| LoRA alpha             | 128      | —            |
| Epochs                 | 3        | FT_EPOCHS    |
| Learning rate          | 2e-4     | FT_LR        |
| Batch size             | 1        | FT_BATCH     |
| Gradient accumulation  | 8        | —            |
| Max sequence length    | 4096     | —            |
| Quantization           | NF4      | —            |
| Optimizer              | paged_adamw_8bit | —    |

## GGUF Quantization Variants

| Quant   | Size (8B) | Quality | Use case                    |
|---------|-----------|---------|------------------------------|
| Q4_K_M  | 4.6 GB    | Good    | Default deployment (LocalAI) |
| Q8_0    | 8.5 GB    | Better  | Higher quality fallback      |
| F16     | 16 GB     | Best    | Intermediate only (deleted)  |

## Path B: External Training Fallback

When no CUDA GPU is available locally:

```bash
bash localai/finetune/pipeline.sh fallback
```

Exports to `localai/finetune/output/external_export/`:
- `train.jsonl` — Chat-format training data
- `axolotl_config.yaml` — Axolotl framework config
- `unsloth_colab.py` — Google Colab notebook (free T4 GPU)

After training externally, bring the adapter back:

```bash
cp -r /path/to/adapter localai/finetune/output/adapter
bash localai/finetune/pipeline.sh export   # merge + GGUF
bash localai/finetune/pipeline.sh deploy   # deploy to LocalAI
```

## Download / Cache Optimization

The 4.7GB base model is downloaded once and cached at `~/.cache/huggingface/hub/`. Subsequent runs (including merge) use the cached weights. The LoRA adapter is ~50MB. Only the final GGUF (4.6GB) is copied to LocalAI.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Small training set (106 examples) | High LoRA rank (r=64) compensates; add more examples iteratively |
| Overfitting on small data | eval split + benchmark suite catches regression |
| No CUDA on Apple Silicon | Path B fallback exports for Colab/Lambda/RunPod |
| Base model too generic | System prompt in YAML provides domain context even without fine-tuning |
| GGUF conversion fails | llama-cpp-python or Homebrew llama.cpp as alternatives |

## Milestone Plan

1. **M0 (now)**: Base model deployed, serving via LocalAI, 106 training examples
2. **M1**: Run baseline evaluation, establish scores for base model
3. **M2**: First QLoRA fine-tune on CUDA machine, evaluate improvement
4. **M3**: Expand training data to 250+ examples, retrain
5. **M4**: Production deployment with fine-tuned GGUF

## Adding Training Data

Update `localai/training/ai-insights-training-data.jsonl`:

```bash
# Check data quality
python localai/finetune/prepare_data.py --stats-only

# After adding examples, retrain
bash localai/finetune/pipeline.sh
```

Rules:
- Assistant outputs must match exact production style
- Include realistic Superset contexts (chart names, viz types, metrics, filters)
- Cover strong and weak cases (missing data, noisy series, conflicting indicators)
- Avoid inconsistent formatting across examples
