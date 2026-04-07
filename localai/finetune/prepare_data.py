#!/usr/bin/env python3
"""
Data preparation and validation for ai-insights fine-tuning.

Reads the JSONL training data, validates format, applies ChatML templating,
splits into train/eval sets, and writes HuggingFace-compatible datasets.

Usage:
    python localai/finetune/prepare_data.py
    python localai/finetune/prepare_data.py --config localai/finetune/config.yaml
    python localai/finetune/prepare_data.py --stats-only
"""

import argparse
import hashlib
import json
import os
import random
import sys
from collections import Counter
from pathlib import Path

import yaml


def load_config(config_path: str = "localai/finetune/config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def validate_example(example: dict, idx: int) -> list[str]:
    """Validate a single JSONL training example. Returns list of errors."""
    errors = []
    if "messages" not in example:
        errors.append(f"Example {idx}: missing 'messages' key")
        return errors

    messages = example["messages"]
    if not isinstance(messages, list) or len(messages) < 2:
        errors.append(f"Example {idx}: 'messages' must be a list with >= 2 entries")
        return errors

    roles = [m.get("role") for m in messages]
    if roles[-1] != "assistant":
        errors.append(f"Example {idx}: last message must be role=assistant, got {roles[-1]}")

    for i, msg in enumerate(messages):
        if "role" not in msg or "content" not in msg:
            errors.append(f"Example {idx}, message {i}: missing role or content")
        if msg.get("role") not in ("system", "user", "assistant"):
            errors.append(f"Example {idx}, message {i}: invalid role '{msg.get('role')}'")
        content = msg.get("content", "")
        if not content or not content.strip():
            errors.append(f"Example {idx}, message {i}: empty content")

    return errors


def apply_chatml_template(messages: list[dict]) -> str:
    """Convert messages to ChatML format string for token counting."""
    parts = []
    for msg in messages:
        parts.append(f"<|im_start|>{msg['role']}\n{msg['content']}<|im_end|>")
    return "\n".join(parts)


def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English text."""
    return len(text) // 4


def categorize_example(example: dict) -> str:
    """Heuristic categorization based on system prompt and content."""
    messages = example["messages"]
    full_text = " ".join(m.get("content", "") for m in messages).lower()

    if "sql" in full_text[:500]:
        return "sql_generation"
    if "dashboard" in full_text[:500] and ("layout" in full_text or "section" in full_text):
        return "dashboard_summary"
    if '"intent"' in full_text or '"dataset"' in full_text or '"chart_type"' in full_text:
        return "structured_json"
    if "recommend" in full_text[:500] or "best chart" in full_text[:500]:
        return "recommendation"
    if "threshold" in full_text[:500] or "tpr" in full_text[:200]:
        return "threshold_assessment"
    if "report" in full_text[:500] or "narrative" in full_text[:500]:
        return "narrative_report"
    return "chart_insight"


def load_and_validate(training_file: str) -> tuple[list[dict], list[str]]:
    """Load JSONL file, validate all examples."""
    examples = []
    all_errors = []

    with open(training_file) as f:
        for idx, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                example = json.loads(line)
            except json.JSONDecodeError as e:
                all_errors.append(f"Example {idx}: invalid JSON: {e}")
                continue

            errors = validate_example(example, idx)
            if errors:
                all_errors.extend(errors)
            else:
                examples.append(example)

    return examples, all_errors


def split_data(
    examples: list[dict],
    eval_ratio: float = 0.1,
    min_eval: int = 5,
    seed: int = 42,
) -> tuple[list[dict], list[dict]]:
    """Split examples into train/eval sets, stratified by category."""
    random.seed(seed)

    # Group by category
    by_cat: dict[str, list[dict]] = {}
    for ex in examples:
        cat = categorize_example(ex)
        by_cat.setdefault(cat, []).append(ex)

    train, eval_set = [], []
    for cat, cat_examples in by_cat.items():
        random.shuffle(cat_examples)
        n_eval = max(1, int(len(cat_examples) * eval_ratio))
        eval_set.extend(cat_examples[:n_eval])
        train.extend(cat_examples[n_eval:])

    # Ensure minimum eval size
    if len(eval_set) < min_eval and len(train) > min_eval:
        random.shuffle(train)
        deficit = min_eval - len(eval_set)
        eval_set.extend(train[:deficit])
        train = train[deficit:]

    random.shuffle(train)
    random.shuffle(eval_set)
    return train, eval_set


def write_dataset(examples: list[dict], output_path: str):
    """Write examples as JSONL."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")


def print_stats(examples: list[dict], label: str = "Dataset"):
    """Print dataset statistics."""
    categories = Counter(categorize_example(ex) for ex in examples)
    token_counts = [estimate_tokens(apply_chatml_template(ex["messages"])) for ex in examples]

    print(f"\n{'='*60}")
    print(f"  {label}: {len(examples)} examples")
    print(f"{'='*60}")
    print(f"  Token stats: min={min(token_counts)}, max={max(token_counts)}, "
          f"avg={sum(token_counts)//len(token_counts)}, total={sum(token_counts)}")
    print(f"\n  Categories:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"    {cat:25s} {count:4d}  ({100*count/len(examples):.1f}%)")

    # Check for near-duplicates
    hashes = Counter()
    for ex in examples:
        content = ex["messages"][-1]["content"][:200]
        h = hashlib.md5(content.encode()).hexdigest()[:8]
        hashes[h] += 1
    dupes = sum(1 for c in hashes.values() if c > 1)
    if dupes:
        print(f"\n  WARNING: {dupes} potential duplicate assistant responses detected")

    print()


def main():
    parser = argparse.ArgumentParser(description="Prepare fine-tuning data")
    parser.add_argument("--config", default="localai/finetune/config.yaml")
    parser.add_argument("--stats-only", action="store_true",
                        help="Print statistics without writing files")
    args = parser.parse_args()

    config = load_config(args.config)
    training_file = config["paths"]["training_data"]
    output_dir = config["paths"]["output_dir"]
    eval_ratio = config["eval"]["eval_split_ratio"]
    min_eval = config["eval"]["min_eval_examples"]

    print(f"Loading training data from: {training_file}")
    examples, errors = load_and_validate(training_file)

    if errors:
        print(f"\nValidation errors ({len(errors)}):")
        for err in errors:
            print(f"  - {err}")
        if not examples:
            print("\nNo valid examples found. Aborting.")
            sys.exit(1)
        print(f"\n{len(examples)} valid examples after filtering.")

    print_stats(examples, "Full Dataset")

    if args.stats_only:
        return

    train, eval_set = split_data(examples, eval_ratio, min_eval)
    print_stats(train, "Training Set")
    print_stats(eval_set, "Evaluation Set")

    train_path = os.path.join(output_dir, "train.jsonl")
    eval_path = os.path.join(output_dir, "eval.jsonl")
    write_dataset(train, train_path)
    write_dataset(eval_set, eval_path)

    print(f"Written: {train_path} ({len(train)} examples)")
    print(f"Written: {eval_path} ({len(eval_set)} examples)")

    # Write metadata
    meta = {
        "total_examples": len(examples),
        "train_examples": len(train),
        "eval_examples": len(eval_set),
        "categories": dict(Counter(categorize_example(ex) for ex in examples)),
        "source_file": training_file,
        "config": args.config,
    }
    meta_path = os.path.join(output_dir, "data_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Written: {meta_path}")


if __name__ == "__main__":
    main()
