#!/usr/bin/env python3
"""
QLoRA fine-tuning script for superset-ai-insights-model.

Loads the base model in 4-bit quantization, attaches LoRA adapters,
trains on the prepared dataset, and saves adapter-only checkpoints.

Usage:
    python localai/finetune/train.py
    python localai/finetune/train.py --config localai/finetune/config.yaml
    python localai/finetune/train.py --resume localai/finetune/output/checkpoint-100

Environment variables:
    FT_EPOCHS=5          Override num_train_epochs
    FT_LR=1e-4           Override learning_rate
    FT_BATCH=2           Override per_device_train_batch_size
    FT_MODEL=small       Override model policy (small/balanced/large)
"""

import argparse
import json
import os
import sys
from pathlib import Path

import torch
import yaml
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from trl import SFTTrainer


def load_config(config_path: str = "localai/finetune/config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def resolve_model(config: dict) -> dict:
    """Resolve the model candidate based on policy or FT_MODEL env var."""
    policy = os.environ.get("FT_MODEL", config["model"]["policy"])
    candidates = config["model"]["candidates"]
    if policy not in candidates:
        print(f"Unknown model policy '{policy}'. Available: {list(candidates.keys())}")
        sys.exit(1)
    return candidates[policy]


def format_chatml(example: dict, tokenizer) -> dict:
    """Format a training example as ChatML text for SFTTrainer."""
    messages = example["messages"]
    # Use the tokenizer's built-in chat template if available
    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=False
        )
    else:
        # Manual ChatML fallback
        parts = []
        for msg in messages:
            parts.append(f"<|im_start|>{msg['role']}\n{msg['content']}<|im_end|>")
        text = "\n".join(parts)
    return {"text": text}


def main():
    parser = argparse.ArgumentParser(description="QLoRA fine-tuning")
    parser.add_argument("--config", default="localai/finetune/config.yaml")
    parser.add_argument("--resume", default=None, help="Resume from checkpoint path")
    parser.add_argument("--dry-run", action="store_true",
                        help="Load model and data but don't train")
    args = parser.parse_args()

    config = load_config(args.config)
    qlora = config["qlora"]
    paths = config["paths"]
    model_info = resolve_model(config)

    model_name = model_info["name"]
    output_dir = paths["output_dir"]
    cache_dir = os.path.expanduser(paths.get("model_cache", "~/.cache/huggingface/hub"))

    # Apply env var overrides
    num_epochs = int(os.environ.get("FT_EPOCHS", qlora["num_train_epochs"]))
    learning_rate = float(os.environ.get("FT_LR", qlora["learning_rate"]))
    batch_size = int(os.environ.get("FT_BATCH", qlora["per_device_train_batch_size"]))

    print(f"{'='*60}")
    print(f"  QLoRA Fine-Tuning: superset-ai-insights-model")
    print(f"{'='*60}")
    print(f"  Base model:    {model_name}")
    print(f"  LoRA rank:     {qlora['r']}")
    print(f"  LoRA alpha:    {qlora['lora_alpha']}")
    print(f"  Epochs:        {num_epochs}")
    print(f"  Learning rate: {learning_rate}")
    print(f"  Batch size:    {batch_size} (x{qlora['gradient_accumulation_steps']} accum)")
    print(f"  Max seq len:   {qlora['max_seq_length']}")
    print(f"  Output:        {output_dir}")
    print(f"  Cache:         {cache_dir}")
    print(f"{'='*60}")

    # ── Load datasets ───────────────────────────────────────────────────────
    train_path = os.path.join(output_dir, "train.jsonl")
    eval_path = os.path.join(output_dir, "eval.jsonl")

    if not os.path.exists(train_path):
        print(f"\nTraining data not found at {train_path}")
        print("Run prepare_data.py first: python localai/finetune/prepare_data.py")
        sys.exit(1)

    dataset = load_dataset("json", data_files={
        "train": train_path,
        "eval": eval_path if os.path.exists(eval_path) else train_path,
    })
    print(f"\nDataset: {len(dataset['train'])} train, {len(dataset['eval'])} eval")

    # ── Quantization config ─────────────────────────────────────────────────
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=qlora["load_in_4bit"],
        bnb_4bit_quant_type=qlora["bnb_4bit_quant_type"],
        bnb_4bit_compute_dtype=getattr(torch, qlora["bnb_4bit_compute_dtype"]),
        bnb_4bit_use_double_quant=qlora["bnb_4bit_use_double_quant"],
    )

    # ── Load tokenizer ──────────────────────────────────────────────────────
    print(f"\nLoading tokenizer: {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        cache_dir=cache_dir,
        trust_remote_code=True,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # ── Format dataset ──────────────────────────────────────────────────────
    print("Formatting dataset with ChatML template...")
    formatted = dataset.map(
        lambda ex: format_chatml(ex, tokenizer),
        remove_columns=dataset["train"].column_names,
    )

    # ── Load model ──────────────────────────────────────────────────────────
    print(f"\nLoading model: {model_name} (4-bit quantized)")
    print("  This will download ~4.7GB on first run, then use cache.")
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=bnb_config,
        device_map="auto",
        cache_dir=cache_dir,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        attn_implementation="eager",  # sdpa can cause issues with QLoRA
    )
    model = prepare_model_for_kbit_training(model)

    # Print model size info
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"  Parameters: {total:,} total, {trainable:,} trainable ({100*trainable/total:.2f}%)")

    # ── LoRA config ─────────────────────────────────────────────────────────
    lora_config = LoraConfig(
        r=qlora["r"],
        lora_alpha=qlora["lora_alpha"],
        lora_dropout=qlora["lora_dropout"],
        target_modules=qlora["target_modules"],
        bias=qlora["bias"],
        task_type=qlora["task_type"],
    )

    model = get_peft_model(model, lora_config)
    trainable_after = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  LoRA trainable params: {trainable_after:,} ({100*trainable_after/total:.4f}%)")

    if args.dry_run:
        print("\n[dry-run] Model and data loaded successfully. Exiting.")
        return

    # ── Training arguments ──────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=qlora["gradient_accumulation_steps"],
        learning_rate=learning_rate,
        lr_scheduler_type=qlora["lr_scheduler_type"],
        warmup_ratio=qlora["warmup_ratio"],
        max_grad_norm=qlora["max_grad_norm"],
        weight_decay=qlora["weight_decay"],
        fp16=qlora["fp16"],
        bf16=qlora["bf16"],
        gradient_checkpointing=qlora["gradient_checkpointing"],
        optim=qlora["optim"],
        logging_steps=qlora["logging_steps"],
        save_steps=qlora["save_steps"],
        eval_steps=qlora["eval_steps"],
        eval_strategy=qlora["eval_strategy"],
        save_total_limit=qlora["save_total_limit"],
        seed=qlora["seed"],
        report_to="none",
        remove_unused_columns=False,
        dataloader_pin_memory=False,
    )

    # ── Train ───────────────────────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=formatted["train"],
        eval_dataset=formatted["eval"],
        tokenizer=tokenizer,
        max_seq_length=qlora["max_seq_length"],
        dataset_text_field="text",
        packing=False,
    )

    print(f"\nStarting training ({num_epochs} epochs)...")
    if args.resume:
        print(f"Resuming from: {args.resume}")
        trainer.train(resume_from_checkpoint=args.resume)
    else:
        trainer.train()

    # ── Save adapter ────────────────────────────────────────────────────────
    adapter_dir = os.path.join(output_dir, "adapter")
    print(f"\nSaving LoRA adapter to: {adapter_dir}")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)

    # Save training metadata
    meta = {
        "base_model": model_name,
        "adapter_dir": adapter_dir,
        "lora_r": qlora["r"],
        "lora_alpha": qlora["lora_alpha"],
        "epochs": num_epochs,
        "learning_rate": learning_rate,
        "train_examples": len(dataset["train"]),
        "eval_examples": len(dataset["eval"]),
        "trainable_params": trainable_after,
        "total_params": total,
    }
    meta_path = os.path.join(output_dir, "training_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nTraining complete.")
    print(f"  Adapter:  {adapter_dir}")
    print(f"  Metadata: {meta_path}")
    print(f"\nNext step: python localai/finetune/merge_and_export.py")


if __name__ == "__main__":
    main()
