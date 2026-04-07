#!/usr/bin/env bash
# =============================================================================
# superset-ai-insights-model Fine-Tuning Pipeline
# =============================================================================
# Orchestrates the full LoRA/QLoRA fine-tuning → GGUF export → deploy cycle.
#
# Path A (Easy): QLoRA fine-tuning via HuggingFace + PEFT
# Path B (Hard Fallback): Export training data for external fine-tuning services
#
# Usage:
#   bash localai/finetune/pipeline.sh                # full pipeline (Path A)
#   bash localai/finetune/pipeline.sh prepare        # data prep only
#   bash localai/finetune/pipeline.sh train          # train only
#   bash localai/finetune/pipeline.sh export         # merge + GGUF only
#   bash localai/finetune/pipeline.sh evaluate       # evaluate only
#   bash localai/finetune/pipeline.sh deploy         # deploy GGUF to LocalAI
#   bash localai/finetune/pipeline.sh baseline       # evaluate base model
#   bash localai/finetune/pipeline.sh fallback       # Path B: export for external
#
# Environment overrides:
#   FT_MODEL=small|balanced|large    Model size selection
#   FT_EPOCHS=5                      Training epochs
#   FT_LR=1e-4                       Learning rate
#   FT_BATCH=2                       Batch size
#   LOCALAI_API_KEY=sk-xxx           LocalAI API key
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="${SCRIPT_DIR}/config.yaml"
OUTPUT_DIR="${SCRIPT_DIR}/output"
VENV_DIR="${SCRIPT_DIR}/.venv"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[pipeline]${NC} $*"; }
ok()   { echo -e "${GREEN}[pipeline]${NC} $*"; }
warn() { echo -e "${YELLOW}[pipeline]${NC} $*"; }
err()  { echo -e "${RED}[pipeline]${NC} $*" >&2; }

# ── Environment Setup ────���──────────────────────────────────────────────────

setup_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        log "Creating Python virtual environment..."
        python3 -m venv "$VENV_DIR"
    fi
    source "$VENV_DIR/bin/activate"

    # Check if key packages are installed
    if ! python3 -c "import torch, peft, trl" 2>/dev/null; then
        log "Installing dependencies (one-time)..."
        pip install -q --upgrade pip
        pip install -q -r "${SCRIPT_DIR}/requirements.txt"
        ok "Dependencies installed"
    fi
}

check_gpu() {
    log "Checking compute environment..."
    python3 -c "
import torch
if torch.cuda.is_available():
    gpu = torch.cuda.get_device_name(0)
    mem = torch.cuda.get_device_properties(0).total_mem / (1024**3)
    print(f'  GPU: {gpu} ({mem:.0f} GB)')
elif torch.backends.mps.is_available():
    print('  Apple Silicon MPS available')
    print('  NOTE: QLoRA uses bitsandbytes which requires CUDA.')
    print('  On Apple Silicon, training will use CPU with reduced precision.')
    print('  For faster training, use a CUDA machine or cloud GPU.')
else:
    print('  CPU only — training will be slow')
    print('  Consider using a cloud GPU (Colab, Lambda, RunPod)')
"
}

# ── Pipeline Steps ────────────────────────────────────��─────────────────────

do_prepare() {
    log "Step 1/5: Preparing training data..."
    cd "$PROJECT_DIR"
    python3 "${SCRIPT_DIR}/prepare_data.py" --config "$CONFIG"
    ok "Data preparation complete"
}

do_train() {
    log "Step 2/5: QLoRA fine-tuning..."
    check_gpu
    cd "$PROJECT_DIR"

    # Check if Apple Silicon and offer guidance
    if python3 -c "import torch; exit(0 if torch.backends.mps.is_available() and not torch.cuda.is_available() else 1)" 2>/dev/null; then
        warn ""
        warn "Apple Silicon detected without CUDA."
        warn "QLoRA requires bitsandbytes which needs CUDA for 4-bit quantization."
        warn ""
        warn "Options:"
        warn "  1. Train on a CUDA machine (recommended for production)"
        warn "  2. Use full-precision LoRA on MPS (slower, more memory)"
        warn "  3. Use the 'fallback' command to export data for external training"
        warn ""
        warn "Attempting training with CPU fallback..."
    fi

    python3 "${SCRIPT_DIR}/train.py" --config "$CONFIG"
    ok "Training complete"
}

do_export() {
    log "Step 3/5: Merging adapter and exporting GGUF..."
    cd "$PROJECT_DIR"
    python3 "${SCRIPT_DIR}/merge_and_export.py" --config "$CONFIG" --deploy
    ok "Export complete"
}

do_evaluate() {
    log "Step 4/5: Running evaluation benchmarks..."
    cd "$PROJECT_DIR"
    python3 "${SCRIPT_DIR}/evaluate.py" --config "$CONFIG" \
        ${LOCALAI_API_KEY:+--api-key "$LOCALAI_API_KEY"}
    ok "Evaluation complete"
}

do_deploy() {
    log "Step 5/5: Deploying to LocalAI..."
    local gguf_dir="${OUTPUT_DIR}/gguf"
    local primary_gguf=$(ls "${gguf_dir}"/ai-insights-model-26.04.Q4_K_M.gguf 2>/dev/null || echo "")

    if [ -z "$primary_gguf" ]; then
        err "No GGUF found at ${gguf_dir}"
        err "Run 'export' step first"
        exit 1
    fi

    local models_dir="${HOME}/.local/share/localai/models"
    local dest="${models_dir}/$(basename "$primary_gguf")"

    log "Copying GGUF to LocalAI models dir..."
    cp "$primary_gguf" "$dest"
    ok "GGUF deployed: $dest ($(du -h "$dest" | cut -f1))"

    # Update YAML config
    local yaml_file="${models_dir}/ai-insights-model-26.04.yaml"
    if [ -f "$yaml_file" ]; then
        # Update the model reference in the YAML
        local new_gguf=$(basename "$primary_gguf")
        sed -i.bak "s/model:.*\.gguf/model: ${new_gguf}/" "$yaml_file"
        rm -f "${yaml_file}.bak"
        ok "YAML config updated to reference: ${new_gguf}"
    fi

    # Restart LocalAI if running
    if curl -s --connect-timeout 2 "http://127.0.0.1:39671/readyz" &>/dev/null; then
        log "Restarting LocalAI to load new model..."
        bash "${PROJECT_DIR}/scripts/setup_localai.sh" stop
        sleep 2
        bash "${PROJECT_DIR}/scripts/setup_localai.sh" start
    fi

    ok "Deployment complete"
}

do_baseline() {
    log "Running baseline evaluation on base model..."
    cd "$PROJECT_DIR"
    python3 "${SCRIPT_DIR}/evaluate.py" --config "$CONFIG" --base-only \
        ${LOCALAI_API_KEY:+--api-key "$LOCALAI_API_KEY"} \
        --output "${OUTPUT_DIR}/eval_baseline.json"
    ok "Baseline evaluation complete"
    log "Compare with: python localai/finetune/evaluate.py  (after fine-tuning)"
}

# ── Path B: Fallback for External Training ───────���──────────────────────────

do_fallback() {
    log "Path B: Preparing data for external fine-tuning..."
    cd "$PROJECT_DIR"

    local export_dir="${OUTPUT_DIR}/external_export"
    mkdir -p "$export_dir"

    # Prepare data
    python3 "${SCRIPT_DIR}/prepare_data.py" --config "$CONFIG"

    # Copy training files
    cp "${OUTPUT_DIR}/train.jsonl" "${export_dir}/"
    cp "${OUTPUT_DIR}/eval.jsonl" "${export_dir}/"

    # Convert to OpenAI fine-tuning format
    python3 -c "
import json, os
input_file = '${OUTPUT_DIR}/train.jsonl'
output_file = '${export_dir}/train_openai_format.jsonl'
with open(input_file) as fin, open(output_file, 'w') as fout:
    for line in fin:
        ex = json.loads(line)
        # OpenAI format is identical for chat fine-tuning
        fout.write(json.dumps(ex, ensure_ascii=False) + '\n')
print(f'Exported: {output_file}')
"

    # Generate Axolotl config (popular external fine-tuning framework)
    cat > "${export_dir}/axolotl_config.yaml" << 'AXOLOTL'
base_model: NousResearch/Hermes-3-Llama-3.1-8B
model_type: LlamaForCausalLM
tokenizer_type: AutoTokenizer
load_in_4bit: true
adapter: qlora
lora_r: 64
lora_alpha: 128
lora_dropout: 0.05
lora_target_modules:
  - q_proj
  - k_proj
  - v_proj
  - o_proj
  - gate_proj
  - up_proj
  - down_proj
datasets:
  - path: train.jsonl
    type: sharegpt
    conversation: chatml
sequence_len: 4096
num_epochs: 3
micro_batch_size: 1
gradient_accumulation_steps: 8
learning_rate: 2.0e-4
lr_scheduler: cosine
warmup_ratio: 0.05
optimizer: paged_adamw_8bit
bf16: auto
gradient_checkpointing: true
output_dir: ./output
AXOLOTL

    # Generate Unsloth notebook template
    cat > "${export_dir}/unsloth_colab.py" << 'UNSLOTH'
# Google Colab fine-tuning with Unsloth (2x faster, 60% less memory)
# Upload train.jsonl to your Colab environment first

# !pip install "unsloth[colab-new]" -q
from unsloth import FastLanguageModel
import torch

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="NousResearch/Hermes-3-Llama-3.1-8B",
    max_seq_length=4096,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=64,
    lora_alpha=128,
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
)

from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

dataset = load_dataset("json", data_files="train.jsonl", split="train")

def format_chat(example):
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False)
    return {"text": text}

dataset = dataset.map(format_chat)

trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=4096,
    args=TrainingArguments(
        output_dir="outputs",
        num_train_epochs=3,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        bf16=True,
        logging_steps=5,
        save_steps=50,
        optim="paged_adamw_8bit",
    ),
)

trainer.train()

# Save adapter
model.save_pretrained("ai-insights-lora-adapter")
# Or save merged GGUF directly:
# model.save_pretrained_ggml("ai-insights-model.Q4_K_M.gguf", quantization_method="q4_k_m")
UNSLOTH

    ok ""
    ok "================================================================="
    ok "  External training files exported to: ${export_dir}"
    ok ""
    ok "  Files:"
    ok "    train.jsonl              — Training data (chat format)"
    ok "    eval.jsonl               — Evaluation data"
    ok "    train_openai_format.jsonl — OpenAI fine-tuning format"
    ok "    axolotl_config.yaml      — Axolotl framework config"
    ok "    unsloth_colab.py         — Google Colab notebook (Unsloth)"
    ok ""
    ok "  External training options:"
    ok "    1. Axolotl:  axolotl train axolotl_config.yaml"
    ok "    2. Unsloth:  Upload to Google Colab (free T4 GPU)"
    ok "    3. Lambda:   SSH + pip install, run train.py"
    ok "    4. RunPod:   Docker with CUDA, run train.py"
    ok ""
    ok "  After training externally, bring the adapter back:"
    ok "    cp -r /path/to/adapter localai/finetune/output/adapter"
    ok "    bash localai/finetune/pipeline.sh export"
    ok "================================================================="
}

# ── Main ───────────────────────────────────────────��────────────────────────

case "${1:-}" in
    prepare)
        setup_venv
        do_prepare
        ;;
    train)
        setup_venv
        do_train
        ;;
    export)
        setup_venv
        do_export
        ;;
    evaluate)
        setup_venv
        do_evaluate
        ;;
    deploy)
        do_deploy
        ;;
    baseline)
        setup_venv
        do_baseline
        ;;
    fallback)
        setup_venv
        do_fallback
        ;;
    ""|full)
        log ""
        log "================================================================="
        log "  superset-ai-insights-model Fine-Tuning Pipeline"
        log "  Model: ${FT_MODEL:-balanced}"
        log "  Epochs: ${FT_EPOCHS:-3}"
        log "================================================================="
        log ""

        setup_venv
        do_prepare
        do_train
        do_export
        do_evaluate
        do_deploy

        ok ""
        ok "================================================================="
        ok "  Pipeline Complete!"
        ok ""
        ok "  1. Data prepared and split"
        ok "  2. QLoRA fine-tuning finished"
        ok "  3. Adapter merged + GGUF exported"
        ok "  4. Evaluation benchmarks passed"
        ok "  5. Model deployed to LocalAI"
        ok ""
        ok "  Test: curl http://127.0.0.1:39671/v1/chat/completions \\"
        ok "    -H 'Content-Type: application/json' \\"
        ok "    -d '{\"model\":\"ai-insights-model-26.04\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}'"
        ok "================================================================="
        ;;
    *)
        echo "Usage: $0 {full|prepare|train|export|evaluate|deploy|baseline|fallback}"
        exit 1
        ;;
esac
