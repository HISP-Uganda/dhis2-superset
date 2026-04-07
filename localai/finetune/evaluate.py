#!/usr/bin/env python3
"""
Evaluation benchmark suite for superset-ai-insights-model.

Runs the fine-tuned model against a curated benchmark set across 7 categories,
scores responses with automated metrics, and produces a report.

Categories:
  1. chart_insight       - Interpret chart data with severity tags and recommendations
  2. dashboard_summary   - Summarize multi-chart dashboards with executive takeaways
  3. sql_generation      - Generate correct SQL for analytical queries
  4. structured_json     - Produce valid JSON matching expected schemas
  5. recommendation      - Recommend chart types, filters, drill-downs
  6. threshold_assessment - Apply health program thresholds correctly
  7. narrative_report    - Generate presentation-quality narrative text

Usage:
    python localai/finetune/evaluate.py
    python localai/finetune/evaluate.py --model ai-insights-model-26.04
    python localai/finetune/evaluate.py --base-only  # evaluate base model for comparison
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import yaml

try:
    from rouge_score import rouge_scorer
    HAS_ROUGE = True
except ImportError:
    HAS_ROUGE = False


def load_config(config_path: str = "localai/finetune/config.yaml") -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def query_localai(
    model: str,
    messages: list[dict],
    port: int = 39671,
    api_key: str | None = None,
    max_tokens: int = 500,
    temperature: float = 0.1,
) -> dict:
    """Send a chat completion request to LocalAI."""
    import urllib.request

    url = f"http://127.0.0.1:{port}/v1/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode()

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            return {
                "content": data["choices"][0]["message"]["content"],
                "usage": data.get("usage", {}),
            }
    except Exception as e:
        return {"content": "", "error": str(e), "usage": {}}


# ── Scoring Functions ───────────────────────────────────────────────────────

def score_severity_tags(response: str) -> float:
    """Check if response includes expected severity tags."""
    tags = ["[CRITICAL]", "[WARNING]", "[GOOD]", "[INFO]"]
    found = sum(1 for tag in tags if tag in response)
    return min(1.0, found / 2)  # at least 2 tags for full score


def score_json_validity(response: str) -> float:
    """Check if response contains valid JSON."""
    # Try to extract JSON from the response
    json_patterns = [
        r'```json\s*(.*?)\s*```',
        r'```\s*([\[\{].*?[\]\}])\s*```',
        r'([\[\{].*[\]\}])',
    ]
    for pattern in json_patterns:
        match = re.search(pattern, response, re.DOTALL)
        if match:
            try:
                json.loads(match.group(1))
                return 1.0
            except json.JSONDecodeError:
                continue
    # Partial credit if response looks structured
    if any(c in response for c in ["{", "[", '":']):
        return 0.3
    return 0.0


def score_sql_quality(response: str) -> float:
    """Check SQL response quality."""
    score = 0.0
    upper = response.upper()
    # Contains SQL keywords
    sql_keywords = ["SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "JOIN"]
    found = sum(1 for kw in sql_keywords if kw in upper)
    score += min(0.5, found * 0.1)
    # Contains explanation
    if any(w in response.lower() for w in ["explanation", "assumes", "note"]):
        score += 0.2
    # Valid structure (not just keywords)
    if re.search(r"SELECT\s+.+\s+FROM\s+", upper):
        score += 0.3
    return min(1.0, score)


def score_threshold_accuracy(response: str) -> float:
    """Check if response applies health thresholds correctly."""
    score = 0.0
    lower = response.lower()
    # References specific thresholds/targets
    threshold_terms = ["target", "threshold", "benchmark", "who", "above", "below", "%"]
    found = sum(1 for t in threshold_terms if t in lower)
    score += min(0.4, found * 0.1)
    # Includes severity assessment
    if any(s in response for s in ["[CRITICAL]", "[WARNING]", "[GOOD]", "critical", "warning"]):
        score += 0.3
    # Includes recommendation
    if any(w in lower for w in ["recommend", "action", "intervene", "scale up", "investigate"]):
        score += 0.3
    return min(1.0, score)


def score_narrative_quality(response: str) -> float:
    """Score narrative report quality."""
    score = 0.0
    # Length check (min 100 chars for a narrative)
    if len(response) > 100:
        score += 0.2
    if len(response) > 300:
        score += 0.1
    # Structure (headings, bullets)
    if "#" in response or "**" in response:
        score += 0.2
    if "- " in response or "* " in response:
        score += 0.1
    # Actionable content
    lower = response.lower()
    if any(w in lower for w in ["recommend", "next step", "action", "priority"]):
        score += 0.2
    # No word concatenation (quality check)
    words = response.split()
    long_words = sum(1 for w in words if len(w) > 30)
    if long_words == 0:
        score += 0.2
    return min(1.0, score)


def score_rouge(response: str, reference: str) -> float:
    """ROUGE-L F1 score between response and reference."""
    if not HAS_ROUGE or not reference:
        return 0.0
    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    scores = scorer.score(reference, response)
    return scores["rougeL"].fmeasure


def score_response(category: str, response: str, reference: str = "") -> dict:
    """Score a response based on its category."""
    scores = {}

    # Category-specific scoring
    if category == "chart_insight":
        scores["severity_tags"] = score_severity_tags(response)
        scores["narrative"] = score_narrative_quality(response)
    elif category == "dashboard_summary":
        scores["narrative"] = score_narrative_quality(response)
        scores["severity_tags"] = score_severity_tags(response)
    elif category == "sql_generation":
        scores["sql_quality"] = score_sql_quality(response)
    elif category == "structured_json":
        scores["json_valid"] = score_json_validity(response)
    elif category == "recommendation":
        scores["narrative"] = score_narrative_quality(response)
    elif category == "threshold_assessment":
        scores["threshold"] = score_threshold_accuracy(response)
    elif category == "narrative_report":
        scores["narrative"] = score_narrative_quality(response)

    # Universal metrics
    scores["non_empty"] = 1.0 if len(response.strip()) > 10 else 0.0
    scores["no_error"] = 0.0 if "error" in response.lower()[:50] else 1.0

    if reference and HAS_ROUGE:
        scores["rouge_l"] = score_rouge(response, reference)

    scores["composite"] = sum(scores.values()) / len(scores) if scores else 0.0
    return scores


# ── Benchmark Loader ────────────────────────────────────────────────────────

def load_benchmarks(benchmarks_dir: str) -> list[dict]:
    """Load benchmark prompts from benchmarks directory or generate defaults."""
    bench_file = os.path.join(benchmarks_dir, "benchmarks.jsonl")

    if os.path.exists(bench_file):
        benchmarks = []
        with open(bench_file) as f:
            for line in f:
                line = line.strip()
                if line:
                    benchmarks.append(json.loads(line))
        return benchmarks

    # Generate default benchmarks
    return _default_benchmarks()


def _default_benchmarks() -> list[dict]:
    """Built-in benchmark prompts across all 7 categories."""
    return [
        {
            "category": "chart_insight",
            "messages": [
                {"role": "system", "content": "You are a health analytics assistant."},
                {"role": "user", "content": "Analyze: Bar chart 'Malaria TPR by District Q3 2025'. Districts: Gulu 42%, Lira 28%, Soroti 15%, Jinja 8%. National target: <10%. Top 2 districts are above the red threshold (>25%)."},
            ],
            "reference": "",
        },
        {
            "category": "chart_insight",
            "messages": [
                {"role": "system", "content": "You are a health analytics assistant."},
                {"role": "user", "content": "Analyze: Line chart 'ANC4+ Coverage Trend 2023-2025'. Values: Q1-2023: 45%, Q2: 48%, Q3: 52%, Q4: 55%, Q1-2024: 58%, Q2: 60%, Q3: 57%, Q4: 62%, Q1-2025: 64%. Target: 80%."},
            ],
            "reference": "",
        },
        {
            "category": "dashboard_summary",
            "messages": [
                {"role": "system", "content": "You are a health analytics assistant."},
                {"role": "user", "content": "Summarize this dashboard 'District Malaria Performance Q3 2025': Chart 1: TPR trend (rising from 18% to 34% over 6 months). Chart 2: LLIN coverage map (60% average, 3 districts below 40%). Chart 3: ACT stock-out days (median 12 days, Gulu at 28 days). Chart 4: IPTp2+ coverage (45% vs 80% target). Filters: Region=Northern, Period=Jul-Sep 2025."},
            ],
            "reference": "",
        },
        {
            "category": "sql_generation",
            "messages": [
                {"role": "system", "content": "You are a SQL assistant for DHIS2 analytics marts."},
                {"role": "user", "content": "Write SQL to find the top 10 districts by malaria test positivity rate for Q3 2025. Table: sv_malaria_mart with columns: district_name, period, tests_done, tests_positive. TPR = tests_positive / tests_done * 100."},
            ],
            "reference": "",
        },
        {
            "category": "sql_generation",
            "messages": [
                {"role": "system", "content": "You are a SQL assistant for DHIS2 analytics marts."},
                {"role": "user", "content": "Write SQL to calculate month-over-month change in OPD attendance. Table: sv_opd_mart with columns: facility_name, district_name, period (format YYYYMM), opd_total."},
            ],
            "reference": "",
        },
        {
            "category": "structured_json",
            "messages": [
                {"role": "system", "content": "You are an analytics copilot. Return JSON only."},
                {"role": "user", "content": "Parse this request into a structured query: 'Show me malaria trends in Northern region for 2024, broken down by district, as a line chart'"},
            ],
            "reference": "",
        },
        {
            "category": "structured_json",
            "messages": [
                {"role": "system", "content": "You are an analytics copilot. Return JSON with fields: intent, dataset, sql, chart_type, filters, assumptions, follow_ups."},
                {"role": "user", "content": "Which districts had the worst immunization dropout rates last quarter?"},
            ],
            "reference": "",
        },
        {
            "category": "recommendation",
            "messages": [
                {"role": "system", "content": "You are a data visualization expert."},
                {"role": "user", "content": "I have monthly malaria case counts for 50 districts over 2 years. I want to identify seasonal patterns and outlier districts. What visualization approach do you recommend?"},
            ],
            "reference": "",
        },
        {
            "category": "threshold_assessment",
            "messages": [
                {"role": "system", "content": "You are a health program performance analyst."},
                {"role": "user", "content": "Assess performance: DPT3 coverage 72%, Measles coverage 65%, Dropout rate DPT1-3 is 18%, Zero-dose children 8%. National targets: DPT3 >90%, Measles >95%, Dropout <10%, Zero-dose <5%."},
            ],
            "reference": "",
        },
        {
            "category": "threshold_assessment",
            "messages": [
                {"role": "system", "content": "You are a health program performance analyst."},
                {"role": "user", "content": "HIV 95-95-95 cascade: First 95 (know status): 87%. Second 95 (on ART): 91%. Third 95 (viral suppression): 78%. PMTCT coverage: 82%. EID testing <2 months: 55%."},
            ],
            "reference": "",
        },
        {
            "category": "narrative_report",
            "messages": [
                {"role": "system", "content": "You are a health analytics report writer."},
                {"role": "user", "content": "Write an executive summary paragraph for the Q3 2025 Malaria Program Review. Key findings: TPR increased from 22% to 31%, LLIN coverage dropped to 55% (target 80%), ACT stock-outs in 12/35 districts, IPTp2+ at 48% (target 80%), 3 districts declared epidemic threshold breach."},
            ],
            "reference": "",
        },
        {
            "category": "narrative_report",
            "messages": [
                {"role": "system", "content": "You are a health analytics report writer."},
                {"role": "user", "content": "Write 3 key recommendations for the TB program. Context: Treatment success rate 71% (target 90%), case detection rate 45% (target 70%), GeneXpert utilization 38%, LTFU rate 22%."},
            ],
            "reference": "",
        },
    ]


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Evaluate fine-tuned model")
    parser.add_argument("--config", default="localai/finetune/config.yaml")
    parser.add_argument("--model", default=None, help="Model name to evaluate")
    parser.add_argument("--base-only", action="store_true",
                        help="Evaluate base model (hermes-3) for comparison")
    parser.add_argument("--api-key", default=None, help="LocalAI API key")
    parser.add_argument("--output", default=None, help="Output report path")
    args = parser.parse_args()

    config = load_config(args.config)
    port = config["deploy"]["localai_port"]
    model_name = args.model or config["deploy"]["model_name"]

    if args.base_only:
        model_name = "hermes-3-llama-3.1-8b-lorablated"

    api_key = args.api_key or os.environ.get("LOCALAI_API_KEY")

    benchmarks = load_benchmarks(config["paths"]["benchmarks_dir"])
    print(f"{'='*60}")
    print(f"  Model Evaluation: {model_name}")
    print(f"  Benchmarks: {len(benchmarks)} prompts")
    print(f"{'='*60}")

    # Check LocalAI is running
    test = query_localai(model_name, [{"role": "user", "content": "hi"}],
                         port=port, api_key=api_key, max_tokens=5)
    if "error" in test:
        print(f"\nERROR: Cannot reach LocalAI: {test['error']}")
        print("Start LocalAI first: bash scripts/setup_localai.sh start")
        sys.exit(1)

    results = []
    category_scores: dict[str, list[float]] = {}
    total_tokens = 0

    for i, bench in enumerate(benchmarks, 1):
        cat = bench["category"]
        ref = bench.get("reference", "")
        user_msg = bench["messages"][-1]["content"]

        print(f"\n[{i}/{len(benchmarks)}] {cat}")
        print(f"  Prompt: {user_msg[:80]}...")

        t0 = time.time()
        resp = query_localai(
            model_name, bench["messages"],
            port=port, api_key=api_key, max_tokens=500,
        )
        elapsed = time.time() - t0

        content = resp.get("content", "")
        usage = resp.get("usage", {})
        total_tokens += usage.get("total_tokens", 0)

        scores = score_response(cat, content, ref)
        category_scores.setdefault(cat, []).append(scores["composite"])

        result = {
            "category": cat,
            "prompt": user_msg[:200],
            "response": content[:500],
            "scores": scores,
            "tokens": usage,
            "time_s": round(elapsed, 2),
        }
        results.append(result)

        print(f"  Score: {scores['composite']:.2f}  |  "
              f"Tokens: {usage.get('total_tokens', '?')}  |  "
              f"Time: {elapsed:.1f}s")
        if content:
            print(f"  Response: {content[:120]}...")

    # ── Summary ─────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  Evaluation Summary: {model_name}")
    print(f"{'='*60}")

    overall_scores = []
    for cat in sorted(category_scores.keys()):
        cat_avg = sum(category_scores[cat]) / len(category_scores[cat])
        overall_scores.append(cat_avg)
        n = len(category_scores[cat])
        bar = "#" * int(cat_avg * 20)
        print(f"  {cat:25s}  {cat_avg:.2f}  [{bar:20s}]  (n={n})")

    overall = sum(overall_scores) / len(overall_scores)
    print(f"\n  {'OVERALL':25s}  {overall:.2f}")
    print(f"  Total tokens: {total_tokens}")
    print(f"{'='*60}")

    # Quality gate
    if overall >= 0.7:
        print(f"\n  PASS - Model meets quality threshold (>= 0.70)")
    elif overall >= 0.5:
        print(f"\n  MARGINAL - Model below target but functional (>= 0.50)")
    else:
        print(f"\n  FAIL - Model needs more training data or tuning (< 0.50)")

    # ── Save report ─────────────────────────────────────────────────────────
    output_path = args.output or os.path.join(
        config["paths"]["output_dir"], f"eval_{model_name.replace('/', '_')}.json"
    )
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    report = {
        "model": model_name,
        "overall_score": round(overall, 4),
        "category_scores": {
            cat: round(sum(s) / len(s), 4)
            for cat, s in category_scores.items()
        },
        "total_tokens": total_tokens,
        "results": results,
    }
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved: {output_path}")


if __name__ == "__main__":
    main()
