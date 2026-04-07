#!/usr/bin/env python3
"""
Merge LoRA adapter into base model and export GGUF quantizations.

Pipeline:
  1. Load base model + LoRA adapter
  2. Merge adapter into base weights
  3. Save merged model (full precision or F16)
  4. Convert to GGUF format using llama.cpp
  5. Quantize to Q4_K_M (and optionally Q8_0)

Usage:
    python localai/finetune/merge_and_export.py
    python localai/finetune/merge_and_export.py --adapter localai/finetune/output/adapter
    python localai/finetune/merge_and_export.py --skip-merge  # if merged model already exists
    python localai/finetune/merge_and_export.py --quantize-only  # just re-quantize
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml


def load_config(config_path: str = "localai/finetune/config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def resolve_model_name(config: dict) -> str:
    policy = os.environ.get("FT_MODEL", config["model"]["policy"])
    return config["model"]["candidates"][policy]["name"]


def merge_adapter(base_model: str, adapter_dir: str, merged_dir: str, cache_dir: str):
    """Merge LoRA adapter into base model."""
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    print(f"\nLoading base model: {base_model}")
    print("  (Uses cached weights — no re-download)")
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16,
        device_map="cpu",  # merge on CPU to avoid OOM
        cache_dir=cache_dir,
        trust_remote_code=True,
    )

    print(f"Loading adapter from: {adapter_dir}")
    model = PeftModel.from_pretrained(model, adapter_dir)

    print("Merging adapter into base model...")
    model = model.merge_and_unload()

    print(f"Saving merged model to: {merged_dir}")
    Path(merged_dir).mkdir(parents=True, exist_ok=True)
    model.save_pretrained(merged_dir, safe_serialization=True)

    tokenizer = AutoTokenizer.from_pretrained(adapter_dir)
    tokenizer.save_pretrained(merged_dir)

    print(f"Merged model saved ({_dir_size_gb(merged_dir):.1f} GB)")


def convert_to_gguf(merged_dir: str, output_dir: str) -> str:
    """Convert merged HF model to GGUF F16 format."""
    gguf_f16 = os.path.join(output_dir, "model-f16.gguf")

    # Find the convert script from llama-cpp-python or llama.cpp
    convert_script = _find_convert_script()
    if not convert_script:
        print("ERROR: Could not find llama.cpp convert script.")
        print("Install llama-cpp-python or clone llama.cpp:")
        print("  pip install llama-cpp-python")
        print("  git clone https://github.com/ggerganov/llama.cpp")
        sys.exit(1)

    print(f"\nConverting to GGUF F16: {gguf_f16}")
    print(f"  Using converter: {convert_script}")

    cmd = [
        sys.executable, convert_script,
        merged_dir,
        "--outfile", gguf_f16,
        "--outtype", "f16",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Conversion failed:\n{result.stderr}")
        sys.exit(1)

    size_gb = os.path.getsize(gguf_f16) / (1024**3)
    print(f"  F16 GGUF: {size_gb:.1f} GB")
    return gguf_f16


def quantize_gguf(gguf_f16: str, output_dir: str, quant_type: str) -> str:
    """Quantize F16 GGUF to a specific quantization level."""
    quantize_bin = _find_quantize_bin()
    if not quantize_bin:
        print(f"ERROR: Could not find llama-quantize binary.")
        print("Install: brew install llama.cpp  OR  build from source")
        sys.exit(1)

    output_name = f"ai-insights-model-26.04.{quant_type}.gguf"
    output_path = os.path.join(output_dir, output_name)

    print(f"\nQuantizing to {quant_type}: {output_path}")
    cmd = [quantize_bin, gguf_f16, output_path, quant_type]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Quantization failed:\n{result.stderr}")
        sys.exit(1)

    size_gb = os.path.getsize(output_path) / (1024**3)
    print(f"  {quant_type} GGUF: {size_gb:.1f} GB")
    return output_path


def _find_convert_script() -> str | None:
    """Find llama.cpp's convert_hf_to_gguf.py script."""
    candidates = [
        # llama-cpp-python package
        os.path.join(
            os.path.dirname(__import__("llama_cpp").__file__) if _try_import("llama_cpp") else "",
            "..", "vendor", "llama.cpp", "convert_hf_to_gguf.py"
        ),
        # Common local clones
        "llama.cpp/convert_hf_to_gguf.py",
        os.path.expanduser("~/llama.cpp/convert_hf_to_gguf.py"),
        # Homebrew
        "/opt/homebrew/share/llama.cpp/convert_hf_to_gguf.py",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path

    # Try to find via pip show
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", "llama-cpp-python"],
            capture_output=True, text=True
        )
        for line in result.stdout.splitlines():
            if line.startswith("Location:"):
                site_dir = line.split(":", 1)[1].strip()
                path = os.path.join(site_dir, "llama_cpp", "vendor",
                                    "llama.cpp", "convert_hf_to_gguf.py")
                if os.path.isfile(path):
                    return path
    except Exception:
        pass

    return None


def _find_quantize_bin() -> str | None:
    """Find the llama-quantize binary."""
    candidates = [
        shutil.which("llama-quantize"),
        shutil.which("quantize"),
        "/opt/homebrew/bin/llama-quantize",
        os.path.expanduser("~/llama.cpp/build/bin/llama-quantize"),
        os.path.expanduser("~/llama.cpp/quantize"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def _try_import(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def _dir_size_gb(path: str) -> float:
    total = sum(
        f.stat().st_size for f in Path(path).rglob("*") if f.is_file()
    )
    return total / (1024**3)


def deploy_gguf(gguf_path: str, config: dict):
    """Copy GGUF to LocalAI models directory and update YAML config."""
    models_dir = os.path.expanduser(config["paths"]["localai_models_dir"])
    model_name = config["deploy"]["model_name"]

    dest = os.path.join(models_dir, os.path.basename(gguf_path))
    print(f"\nDeploying GGUF to LocalAI: {dest}")
    shutil.copy2(gguf_path, dest)

    # Update YAML config to reference the new GGUF
    yaml_path = os.path.join(models_dir, f"{model_name}.yaml")
    if os.path.exists(yaml_path):
        with open(yaml_path) as f:
            yaml_content = f.read()
        # Update the model reference
        old_gguf = None
        for line in yaml_content.splitlines():
            if "model:" in line and ".gguf" in line:
                old_gguf = line.strip().split("model:", 1)[1].strip()
                break
        if old_gguf:
            yaml_content = yaml_content.replace(old_gguf, os.path.basename(gguf_path))
            with open(yaml_path, "w") as f:
                f.write(yaml_content)
            print(f"  Updated YAML: {old_gguf} -> {os.path.basename(gguf_path)}")

    print(f"  Restart LocalAI to load the new model.")


def main():
    parser = argparse.ArgumentParser(description="Merge LoRA + export GGUF")
    parser.add_argument("--config", default="localai/finetune/config.yaml")
    parser.add_argument("--adapter", default=None, help="Path to LoRA adapter dir")
    parser.add_argument("--skip-merge", action="store_true",
                        help="Skip merge, assume merged model exists")
    parser.add_argument("--quantize-only", action="store_true",
                        help="Skip merge+convert, just re-quantize from existing F16")
    parser.add_argument("--deploy", action="store_true",
                        help="Deploy the primary GGUF to LocalAI after export")
    args = parser.parse_args()

    config = load_config(args.config)
    output_dir = config["paths"]["output_dir"]
    cache_dir = os.path.expanduser(config["paths"].get("model_cache", "~/.cache/huggingface/hub"))
    base_model = resolve_model_name(config)
    adapter_dir = args.adapter or os.path.join(output_dir, "adapter")
    merged_dir = os.path.join(output_dir, "merged")
    gguf_dir = os.path.join(output_dir, "gguf")

    Path(gguf_dir).mkdir(parents=True, exist_ok=True)

    print(f"{'='*60}")
    print(f"  Merge & Export Pipeline")
    print(f"{'='*60}")
    print(f"  Base model:  {base_model}")
    print(f"  Adapter:     {adapter_dir}")
    print(f"  Merged:      {merged_dir}")
    print(f"  GGUF output: {gguf_dir}")
    print(f"{'='*60}")

    # Step 1: Merge
    gguf_f16 = os.path.join(gguf_dir, "model-f16.gguf")
    if not args.skip_merge and not args.quantize_only:
        if not os.path.isdir(adapter_dir):
            print(f"\nAdapter not found at {adapter_dir}")
            print("Run train.py first: python localai/finetune/train.py")
            sys.exit(1)
        merge_adapter(base_model, adapter_dir, merged_dir, cache_dir)

    # Step 2: Convert to GGUF
    if not args.quantize_only:
        if not os.path.isdir(merged_dir):
            print(f"\nMerged model not found at {merged_dir}")
            sys.exit(1)
        gguf_f16 = convert_to_gguf(merged_dir, gguf_dir)
    else:
        if not os.path.isfile(gguf_f16):
            print(f"\nF16 GGUF not found at {gguf_f16}")
            sys.exit(1)

    # Step 3: Quantize
    quant_types = config["gguf"]["quantizations"]
    produced = {}
    for qt in quant_types:
        path = quantize_gguf(gguf_f16, gguf_dir, qt)
        produced[qt] = path

    # Clean up F16 if not needed
    if not config["gguf"].get("keep_f16", False) and os.path.isfile(gguf_f16):
        print(f"\nRemoving intermediate F16 GGUF ({os.path.getsize(gguf_f16)/(1024**3):.1f} GB)")
        os.remove(gguf_f16)

    # Summary
    print(f"\n{'='*60}")
    print(f"  Export Complete")
    print(f"{'='*60}")
    for qt, path in produced.items():
        size = os.path.getsize(path) / (1024**3)
        print(f"  {qt:10s}  {size:.1f} GB  {path}")
    print(f"{'='*60}")

    # Step 4: Deploy
    if args.deploy or config["deploy"].get("auto_deploy", False):
        primary_quant = quant_types[0]
        deploy_gguf(produced[primary_quant], config)

    # Save export metadata
    meta = {
        "base_model": base_model,
        "adapter_dir": adapter_dir,
        "quantizations": {qt: os.path.basename(p) for qt, p in produced.items()},
    }
    with open(os.path.join(gguf_dir, "export_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nNext step: python localai/finetune/evaluate.py")


if __name__ == "__main__":
    main()
