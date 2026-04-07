from __future__ import annotations

import json
import logging
import re
from collections.abc import Generator
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from flask import g

from superset import security_manager
from superset.ai_insights.config import (
    AI_MODE_CHART,
    AI_MODE_DASHBOARD,
    AI_MODE_SQL,
    get_ai_insights_config,
    user_can_access_ai_mode,
)
from superset.ai_insights.providers import AIProviderError, ProviderRegistry, StreamChunk
from superset.ai_insights.sql import (
    AISQLValidationError,
    build_mart_schema_context,
    ensure_mart_only_sql,
    is_mart_table,
    resolve_mart_execution_database,
)
from superset.daos.chart import ChartDAO
from superset.daos.dashboard import DashboardDAO
from superset.daos.database import DatabaseDAO
from superset.models.core import Database

logger = logging.getLogger(__name__)

JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


class AIInsightError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class AuditMetadata:
    mode: str
    provider: str
    model: str
    duration_ms: int
    database_backend: str | None = None
    status: str = "success"


def _trim_conversation(conversation: list[dict[str, str]]) -> list[dict[str, str]]:
    max_messages = int(get_ai_insights_config().get("max_follow_up_messages") or 6)
    if len(conversation) <= max_messages:
        return conversation
    return conversation[-max_messages:]


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        if "\n" in candidate:
            candidate = candidate.split("\n", 1)[1]
    match = JSON_BLOCK_RE.search(candidate)
    payload = match.group(0) if match else candidate
    return json.loads(payload)


def _sanitize_context_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Sanitize and prune the frontend-supplied context payload.

    Removes noisy UI-only keys from ``form_data`` and trims large arrays
    so that only analytically meaningful data reaches the LLM.
    """
    if not payload:
        return {}
    return _prune_context(payload)


# ── Context pruning ─────────────────────────────────────────────────
# form_data contains dozens of UI-styling keys that consume tokens
# without contributing analytical value.  Keep only the semantic keys.

_FORM_DATA_KEEP_KEYS = frozenset({
    # Semantic / analytical
    "datasource", "viz_type", "metrics", "metric", "percent_metrics",
    "groupby", "columns", "all_columns", "order_by_cols",
    "row_limit", "time_range", "granularity_sqla", "time_grain_sqla",
    "adhoc_filters", "where", "having",
    "order_desc", "contribution",
    # Series / pivot
    "series", "entity", "x_axis", "temporal_columns_lookup",
    # Table-specific
    "query_mode", "include_time",
    # Map-specific
    "spatial", "mapbox_style",
})


def _prune_form_data(form_data: dict[str, Any] | None) -> dict[str, Any]:
    """Keep only analytically meaningful keys from chart form_data."""
    if not form_data:
        return {}
    return {k: v for k, v in form_data.items() if k in _FORM_DATA_KEEP_KEYS}


def _prune_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Recursively prune heavy UI-only data from context payloads."""
    result = {}
    for key, value in payload.items():
        if key == "form_data" and isinstance(value, dict):
            result[key] = _prune_form_data(value)
        elif key == "chart" and isinstance(value, dict):
            result[key] = _prune_context(value)
        elif key == "charts" and isinstance(value, list):
            result[key] = [_prune_context(c) if isinstance(c, dict) else c for c in value]
        elif key == "query_result" and isinstance(value, dict):
            result[key] = _compress_query_result(value)
        else:
            result[key] = value
    return result


def _compress_query_result(qr: dict[str, Any]) -> dict[str, Any]:
    """Compress query result to save tokens: fewer rows, summarize numerics."""
    config = get_ai_insights_config()
    max_rows = int(config.get("max_context_rows") or 20)
    max_cols = int(config.get("max_context_columns") or 25)

    columns = (qr.get("columns") or [])[:max_cols]
    sample_rows = (qr.get("sample_rows") or [])[:max_rows]

    compressed: dict[str, Any] = {
        "row_count": qr.get("row_count", 0),
        "columns": columns,
    }
    if sample_rows:
        compressed["sample_rows"] = sample_rows
    # Drop applied/rejected filters if empty
    if qr.get("applied_filters"):
        compressed["applied_filters"] = qr["applied_filters"]
    return compressed


def _compact_json(obj: Any) -> str:
    """Serialize to compact JSON with no unnecessary whitespace."""
    return json.dumps(obj, ensure_ascii=True, separators=(",", ":"), default=str)


# Patterns that indicate system prompt leakage in model output.
# These are instruction fragments that should never appear in the final report.
_PROMPT_LEAK_PATTERNS = re.compile(
    r"(?:"
    # Explicit rule references
    r"(?:Do NOT|NEVER|MUST|ALWAYS)\s+(?:exceed|echo|quote|reference|use)\s+(?:the\s+)?(?:rules?|instructions?|prompt|section names|meta-text|formatting rules|strict rules)"
    r"|(?:Strict Rules|FORMATTING RULES|PRESENTATION STYLE|CRITICAL OUTPUT RULE|OUTPUT RULE)"
    r"|(?:End with\s+##\s+\d+\.\s+Action Recommendations)"
    # Stop markers leaked
    r"|^STOP\s*(?:writing\s+immediately)?\.?\s*$"
    # Instruction headings leaked verbatim
    r"|^(?:ANALYSIS APPROACH|CROSS-CHART INTELLIGENCE|INTELLIGENT ANALYSIS REQUIREMENTS|"
    r"SLIDE DESIGN PRINCIPLES|EXECUTIVE PRESENTATION OUTPUT RULES|"
    r"ABSOLUTE REQUIREMENT|MANDATORY RESPONSE STRUCTURE|"
    r"HEALTH PROGRAM THRESHOLDS AND COLOR LEGENDS|"
    r"CHART TYPE INTERPRETATION GUIDE|ANALYTICAL REASONING FRAMEWORK|"
    r"DATA ANALYSIS DRAFT)\s*[:—]?\s*$"
    r")",
    re.IGNORECASE | re.MULTILINE,
)

_OUTPUT_NOISE_PATTERNS = re.compile(
    r"(?:"
    r"^\s*\.\.\.\s+and\s+\d+\s+more\s+rows?\s*$"
    r"|^\s*and\s+\d+\s+more\s+rows?\s*$"
    r"|^\s*\.\.\.\s*$"
    r")",
    re.IGNORECASE | re.MULTILINE,
)

_LEAKED_INSTRUCTION_BLOCK_PATTERNS = re.compile(
    r"(?:"
    r"\n?\s*---+\s*\n+\s*Write\s+a\s+concise\s+summary.*?(?=\n(?:##\s+|Executive Summary|Chart Summary|Key Takeaways|Leadership Watchouts|Why It Matters)\b|\Z)"
    r"|\n?\s*Context:\s*\n(?:.*\n){0,40}?(?=\n(?:##\s+|Executive Summary|Chart Summary|Key Takeaways|Leadership Watchouts|Why It Matters)\b|\Z)"
    r"|\n?\s*(?:Do not leave the report incomplete.*|Do not exceed.*|Do not use any unsupported claims.*|Focus on the most important takeaway.*|Generate a new insight\.)\s*"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_STUB_OUTPUT_PATTERNS = re.compile(
    r"(?:"
    r"\[STUB\b"
    r"|Add\s+\d+\s*-\s*\d+\s+more\s+rows"
    r"|Bullet\s+\d+\s*-\s*\d+"
    r"|Write\s+a\s+\d+\s*-\s*\d+\s+word\s+paragraph"
    r")",
    re.IGNORECASE,
)

_CONTEXT_ECHO_LINE_PATTERNS = re.compile(
    r"(?:"
    r"^\s*---\s*Chart\s*\d+.*$"
    r"|^\s*Chart\s*\d+\s*:.*$"
    r"|^\s*Type\s*:.*$"
    r"|^\s*Columns\s*:.*$"
    r"|^\s*Total\s+rows\s*:.*$"
    r"|^\s*Pre-?computed\s+analytics\s*:.*$"
    r"|^\s*Sample\s+data\s*\(.*$"
    r"|^\s*Row\s+\d+\s*:.*$"
    r"|^\s*Metric\s+'[^']+'\s*:.*$"
    r"|^\s*Highest\s*:.*$"
    r"|^\s*Lowest\s*:.*$"
    r")",
    re.IGNORECASE | re.MULTILINE,
)

_CONTEXT_ECHO_INLINE_PATTERNS = re.compile(
    r"(?:"
    r"chart\s*\d+\s*:.*?type\s*:.*?columns\s*:.*?total\s*rows\s*:?"
    r"|metric\s*'[^']+'\s*:.*?(?:highest\s*:|lowest\s*:)"
    r"|sample\s+data\s*\(\d+\s*rows?\)\s*:\s*row\s*1\s*:"
    r")",
    re.IGNORECASE | re.DOTALL,
)


def _looks_context_echo_output(text: str) -> bool:
    """Detect raw grounded-context scaffolding copied into the final insight."""
    normalized = str(text or "").strip()
    if not normalized:
        return False
    hits = _CONTEXT_ECHO_LINE_PATTERNS.findall(normalized)
    if len(hits) >= 3:
        return True
    lower = normalized.lower()
    return (
        bool(_CONTEXT_ECHO_INLINE_PATTERNS.search(normalized))
        or
        "pre-computed analytics" in lower
        or "sample data (" in lower
        or ("chart 1:" in lower and "columns:" in lower)
        or ("chart 9:" in lower and "type:" in lower and "columns:" in lower)
    )


def _strip_prompt_leakage(text: str) -> str:
    """Remove lines that contain system prompt fragments leaked by the model."""
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        if _PROMPT_LEAK_PATTERNS.search(line):
            continue
        if _OUTPUT_NOISE_PATTERNS.search(line):
            continue
        if _CONTEXT_ECHO_LINE_PATTERNS.search(line):
            continue
        cleaned.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned)).strip()


def _looks_repetitive_model_output(text: str) -> bool:
    """Detect clearly degenerate label/ID echoing from weaker local models."""
    normalized = re.sub(r"\s+", " ", str(text or "").strip()).lower()
    if not normalized:
        return False

    # Common local-model failure: pipe-delimited raw IDs/titles repeated over and over.
    pipe_tokens = [token.strip() for token in normalized.split("|") if token.strip()]
    if len(pipe_tokens) >= 8:
        counts: dict[str, int] = {}
        max_count = 0
        for token in pipe_tokens:
            counts[token] = counts.get(token, 0) + 1
            max_count = max(max_count, counts[token])
        if max_count >= 5 and max_count / len(pipe_tokens) >= 0.45:
            return True

    # Repeated long identifiers such as admissionsvsdeathsovertime
    repeated_id = re.search(r"\b([a-z0-9_]{10,})\b(?:\s*[|,]\s*\1\b){3,}", normalized)
    if repeated_id:
        return True

    # Many near-identical long lines is also a strong degeneration signal.
    lines = [line.strip() for line in normalized.splitlines() if len(line.strip()) >= 20]
    if len(lines) >= 4:
        prefixes: dict[str, int] = {}
        for line in lines:
            key = line[:80]
            prefixes[key] = prefixes.get(key, 0) + 1
            if prefixes[key] >= 3:
                return True

    return False


def _looks_placeholder_output(text: str) -> bool:
    """Detect placeholder scaffold output that should never reach the user."""
    normalized = str(text or "").strip()
    if not normalized:
        return False
    return bool(_STUB_OUTPUT_PATTERNS.search(normalized)) or _looks_context_echo_output(
        normalized
    )


def _context_has_meaningful_evidence(
    context_payload: dict[str, Any] | None,
    mode: str | None,
) -> bool:
    context_payload = context_payload or {}
    if mode == AI_MODE_CHART:
        qr = context_payload.get("query_result") or {}
        rows = qr.get("sample_rows") or qr.get("data") or []
        return not _is_trivial_data(rows)

    charts = context_payload.get("charts") or []
    for chart_entry in charts:
        qr = chart_entry.get("query_result") or {}
        rows = qr.get("sample_rows") or qr.get("data") or []
        if rows and not _is_trivial_data(rows):
            return True
    return False


def _count_meaningful_dashboard_charts(context_payload: dict[str, Any] | None) -> int:
    charts = (context_payload or {}).get("charts") or []
    count = 0
    for chart_entry in charts:
        qr = chart_entry.get("query_result") or {}
        rows = qr.get("sample_rows") or qr.get("data") or []
        if rows and not _is_trivial_data(rows):
            count += 1
    return count


def _looks_false_insufficient_data_output(
    text: str,
    context_payload: dict[str, Any] | None,
    mode: str | None,
) -> bool:
    normalized = str(text or "").strip().lower()
    if not normalized:
        return False
    if not _context_has_meaningful_evidence(context_payload, mode):
        return False
    return any(
        phrase in normalized
        for phrase in (
            "no charts contained enough data",
            "no charts had sufficient data",
            "insufficient data",
            "not enough data for reliable analysis",
            "not enough evidence for reliable analysis",
            "the current charts are insufficient",
            "please provide a dashboard with complete",
            "please provide a dashboard with complete",
            "restart the analysis when you have a complete",
            "the charts lack sufficient data points",
            "more recent, complete data is required",
        )
    )


def _build_localai_report_plan(
    insight_mode: str,
    scope_label: str,
) -> tuple[str, list[str]]:
    """Return a concise mode-aware structure for LocalAI output."""
    if scope_label == "dashboard":
        plans: dict[str, tuple[str, list[str]]] = {
            "summary": (
                "Use exactly these sections:\n"
                "## Executive Summary\n"
                "- 1 paragraph, 110-170 words, synthesizing the dashboard's main message.\n"
                "## Key Points\n"
                "- 4 to 6 bullets with specific metrics, entities, or trends.\n"
                "## Leadership Watchouts\n"
                "- 2 to 4 bullets focused on operational or strategic concerns.",
                [
                    "## Executive Summary",
                    "## Key Points",
                    "## Leadership Watchouts",
                ],
            ),
            "key_takeaways": (
                "Use exactly these sections:\n"
                "## Key Takeaways\n"
                "- Return exactly 5 bullets. Each bullet must contain a named metric, entity, value, or comparison.\n"
                "## Leadership Watchouts\n"
                "- Return 2 concise bullets on the most important risks or checks.",
                [
                    "## Key Takeaways",
                    "## Leadership Watchouts",
                ],
            ),
            "executive_brief": (
                "Use exactly these sections:\n"
                "## Executive Brief\n"
                "- 1 board-ready paragraph, 120-180 words.\n"
                "## Priority Decisions\n"
                "- 3 to 5 bullets.\n"
                "## Immediate Actions\n"
                "- 3 bullets with direct actions.",
                [
                    "## Executive Brief",
                    "## Priority Decisions",
                    "## Immediate Actions",
                ],
            ),
            "deep_dive": (
                "Use exactly these sections:\n"
                "## Executive Summary\n"
                "- 1 paragraph, 120-180 words.\n"
                "## Performance Overview\n"
                "- 1 paragraph or 4 to 6 bullets summarizing strengths, weaknesses, and direction.\n"
                "## Cross-Chart Patterns\n"
                "- 3 to 5 bullets grounded in multiple charts.\n"
                "## Risks and Recommended Actions\n"
                "- 3 to 5 bullets combining risk, evidence, and next step.\n"
                "## Data Quality and Confidence Notes\n"
                "- 1 to 3 bullets only if needed.",
                [
                    "## Executive Summary",
                    "## Performance Overview",
                    "## Cross-Chart Patterns",
                    "## Risks and Recommended Actions",
                ],
            ),
        }
    else:
        plans = {
            "summary": (
                "Use exactly these sections:\n"
                "## Chart Summary\n"
                "- 1 paragraph, 90-140 words, focused on the most important pattern.\n"
                "## What Stands Out\n"
                "- 3 to 5 bullets with specific evidence.\n"
                "## Why It Matters\n"
                "- 1 or 2 concise sentences.",
                [
                    "## Chart Summary",
                    "## What Stands Out",
                    "## Why It Matters",
                ],
            ),
            "key_takeaways": (
                "Use exactly these sections:\n"
                "## Key Takeaways\n"
                "- Return exactly 5 bullets. Each bullet must contain a named metric, entity, value, or comparison.\n"
                "## Immediate Watchouts\n"
                "- Return 2 concise bullets on the main operational implications.",
                [
                    "## Key Takeaways",
                    "## Immediate Watchouts",
                ],
            ),
            "deep_dive": (
                "Use exactly these sections:\n"
                "## Chart Summary\n"
                "- 1 paragraph, 100-160 words.\n"
                "## Metric Interpretation\n"
                "- 3 to 5 bullets.\n"
                "## Risks and Watchouts\n"
                "- 2 to 4 bullets.\n"
                "## Improvement Opportunities\n"
                "- 2 to 4 bullets.\n"
                "## Data Quality and Confidence Notes\n"
                "- 1 to 3 bullets only if needed.",
                [
                    "## Chart Summary",
                    "## Metric Interpretation",
                    "## Risks and Watchouts",
                    "## Improvement Opportunities",
                ],
            ),
        }

    default_plan = (
        "Use exactly these sections:\n"
        "## Executive Summary\n"
        "- 1 concise paragraph.\n"
        "## Key Points\n"
        "- 4 to 6 bullets.\n"
        "## Recommended Actions\n"
        "- 2 to 4 bullets tied directly to the evidence.",
        [
            "## Executive Summary",
            "## Key Points",
            "## Recommended Actions",
        ],
    )
    return plans.get(insight_mode, default_plan)


def _looks_incomplete_localai_output(
    text: str,
    expected_headings: list[str],
) -> bool:
    normalized = str(text or "").strip()
    if not normalized:
        return True

    lower = normalized.lower()
    if expected_headings:
        present = sum(1 for heading in expected_headings if heading.lower() in lower)
        if present < len(expected_headings) and len(normalized) >= 180:
            return True

    tail = normalized[-120:]
    if re.search(r"(?:\b(?:for|to|with|and|or|of|in|on|at)\s*$|[:(\[]\s*$)", tail, re.IGNORECASE):
        return True
    if len(normalized) >= 120 and not re.search(r"(?:[.!?]|\]|\)|`)\s*$", normalized):
        return True
    return False


def _fix_generated_word_spacing(text: str) -> str:
    """Repair common LocalAI word-joining AND word-splitting issues.

    Uses the full English dictionary (~370k words) from word_dictionary.py
    so that both rejoining ("f all in g" → "falling") and splitting
    ("regionsisacritical…" → "regions is a critical …") work for any
    English word — not just a hand-picked list.

    Local place names and domain terms are in the dictionary's _DOMAIN_WORDS
    set, so they are recognised as whole words and never incorrectly split.
    """
    from superset.ai_insights.word_dictionary import load_dictionary

    _dict = load_dictionary()  # frozenset, cached after first call

    # Common short words that get full quadratic scoring in the DP.
    # 1-2 char words are needed because the dictionary file has ≥3 chars only.
    # 3-char words are included so they score 9 (quadratic) instead of 4
    # (the penalty for obscure 3-char entries like "sta", "orf", "ing").
    _SMALL_WORDS: frozenset[str] = frozenset({
        # 1-2 char
        "a", "i", "an", "am", "as", "at", "be", "by", "do", "go",
        "he", "if", "in", "is", "it", "me", "my", "no", "of", "on",
        "or", "so", "to", "up", "us", "we",
        # 3-char common
        "the", "and", "for", "are", "but", "not", "you", "all", "any",
        "can", "had", "has", "her", "him", "his", "how", "its", "may",
        "new", "now", "old", "one", "our", "out", "own", "per", "say",
        "she", "too", "two", "use", "was", "way", "who", "why", "yet",
        "ago", "big", "did", "end", "far", "few", "got", "let", "low",
        "man", "men", "off", "put", "ran", "red", "run", "set", "sub",
        "ten", "top", "try",
    })

    # The DP dictionary: full dictionary + small common words.
    _dp_dict = _dict | _SMALL_WORDS

    def _is_word(w: str) -> bool:
        return w.lower() in _dp_dict

    # ── Phase 0: Fix split words (e.g. "f all in g" → "falling") ──

    def _rejoin_split_words(line: str) -> str:
        """Rejoin words that were split by spaces (e.g. 'Ho sp it al' → 'Hospital')."""
        words = line.split(" ")
        if len(words) < 2:
            return line
        result: list[str] = []
        i = 0
        while i < len(words):
            # Try merging sequences of short tokens (1-4 chars) with neighbors
            if len(words[i]) <= 4 and words[i].isalpha():
                best_merge = ""
                best_end = i
                best_punct = ""         # trailing punct from best_end's word
                candidate = words[i]
                split_last_at = 0
                for j in range(i + 1, min(i + 12, len(words))):
                    w_j = words[j]
                    # Strip trailing non-alpha so "on." and "g39%" can participate
                    w_j_punct = ""
                    if not w_j.isalpha() and len(w_j) >= 2:
                        # Strip trailing punctuation and digit-punct sequences
                        alpha = w_j
                        while alpha and not alpha[-1].isalpha():
                            alpha = alpha[:-1]
                        if alpha and alpha.isalpha():
                            w_j_punct = w_j[len(alpha):]
                            w_j = alpha
                    if not w_j.isalpha():
                        break
                    candidate += w_j
                    # All words from i to j inclusive
                    n_parts = j - i + 1
                    if _is_word(candidate):
                        # Guard: if starting token is a valid word and the
                        # merged result is short (<6 chars) AND only 2 tokens,
                        # it's likely a false match (e.g. "or"+"f" → "orf").
                        if (_is_word(words[i]) and len(candidate) < 6
                                and n_parts == 2):
                            pass  # skip this short false-merge
                        # Guard: don't merge 2-part pairs where both are
                        # valid standalone words (e.g. "a"+"critical",
                        # "sub"+"region").  3+ part merges are allowed since
                        # intermediate concatenations aren't words.
                        elif (n_parts == 2
                              and _is_word(words[i]) and _is_word(w_j)):
                            pass
                        else:
                            best_merge = candidate
                            best_end = j
                            best_punct = w_j_punct
                            split_last_at = 0
                    # Check if the last token has extra chars glued on
                    # e.g. "f all in gacross" → candidate "fallingacross":
                    # try splitting the last token so the prefix forms a word.
                    # Only when the next word is NOT a valid standalone word
                    # (prevents stealing chars from "Kampala" etc.).
                    if (len(w_j) > 3
                            and not _is_word(w_j)):
                        prefix_len = len(candidate) - len(w_j)
                        # Find the split where the remainder is also a
                        # valid word; fall back to longest merge otherwise.
                        _best_valid = ("", 0)   # (merge, k) with valid remainder
                        _best_any = ("", 0)     # longest merge regardless
                        for k in range(1, len(w_j)):
                            test_word = candidate[:prefix_len + k]
                            if (_is_word(test_word)
                                    and len(test_word) > len(best_merge)):
                                remainder = w_j[k:]
                                if (_is_word(remainder)
                                        and len(test_word) > len(_best_valid[0])):
                                    _best_valid = (test_word, k)
                                if len(test_word) > len(_best_any[0]):
                                    _best_any = (test_word, k)
                        _chosen, _chosen_k = _best_valid if _best_valid[0] else _best_any
                        if _chosen:
                            best_merge = _chosen
                            best_end = j
                            best_punct = ""  # remainder goes back, no punct to attach
                            split_last_at = _chosen_k
                if best_merge:
                    if split_last_at:
                        words[best_end] = words[best_end][split_last_at:]
                        best_end -= 1
                        best_punct = ""
                    # Re-attach trailing punctuation from the last consumed word
                    punct_suffix = best_punct if not split_last_at else ""
                if best_merge:
                    result.append(best_merge + punct_suffix)
                    i = best_end + 1
                    continue
            # Try merging current word with next if they form a known word,
            # but only when at least one part is not a standalone word
            # (prevents "sub region" → "subregion" when both are valid),
            # and the result is >= 6 chars when starting from a valid word
            # (prevents "or"+"f" → "orf").
            if i + 1 < len(words) and words[i].isalpha() and words[i + 1].isalpha():
                merged = words[i] + words[i + 1]
                if (_is_word(merged) and len(words[i]) <= 6
                        and (not _is_word(words[i]) or not _is_word(words[i + 1]))
                        and (not _is_word(words[i]) or len(merged) >= 6)):
                    result.append(merged)
                    i += 2
                    continue
            result.append(words[i])
            i += 1
        return " ".join(result)

    def _presplit_trailing_fragments(line: str) -> str:
        """Split tokens like 'bothf' → 'both f' where a valid word has a
        short non-word fragment glued to its end.  This lets the rejoin
        phase later merge 'f all in g' correctly."""
        def _split_token(m: re.Match[str]) -> str:
            tok = m.group(0)
            if _is_word(tok):
                return tok
            # Try splitting off a trailing 1-char fragment (e.g. "bothf" → "both f")
            # Only 1-char tails to avoid false splits like "galack" → "gala ck"
            if len(tok) >= 4 and not _is_word(tok[-1:]):
                head = tok[:-1]
                if _is_word(head):
                    return head + " " + tok[-1:]
            return tok
        return re.sub(r"[A-Za-z]{4,}", _split_token, line)

    # Pre-split trailing fragments, then apply split-word repair
    text = "\n".join(_presplit_trailing_fragments(line) for line in text.split("\n"))
    text = "\n".join(_rejoin_split_words(line) for line in text.split("\n"))

    # ── Phase 1: Split joined words (e.g. "regionsisacritical…") ──
    # Uses DP with the full dictionary for word segmentation.
    # Short dictionary words (≤3 chars) that are obscure fragments (e.g. "sta",
    # "ing", "ion") get a scoring penalty so they don't beat real words.

    def _merge_single_chars(parts: list[str]) -> list[str]:
        merged: list[str] = []
        buffer = ""
        for part in parts:
            if len(part) == 1 and part.isalpha():
                buffer += part
                continue
            if buffer:
                merged.append(buffer)
                buffer = ""
            merged.append(part)
        if buffer:
            merged.append(buffer)
        return merged

    def _split_joined_alpha_token(token: str) -> str:
        """Split a joined alpha token using DP word segmentation."""
        if len(token) < 7 or not token.isalpha():
            return token

        # If the whole token is already a known word, keep it as-is
        if _is_word(token):
            return token

        lower = token.lower()
        n = len(lower)
        scores = [-10**9] * (n + 1)
        paths: list[list[str] | None] = [None] * (n + 1)
        scores[0] = 0
        paths[0] = []

        for i in range(n):
            if paths[i] is None:
                continue
            # Unknown char penalty keeps original token when no good split exists.
            if scores[i] - 4 > scores[i + 1]:
                scores[i + 1] = scores[i] - 4
                paths[i + 1] = [*paths[i], token[i:i + 1]]

            # Try dictionary words up to 20 chars long
            for j in range(i + 1, min(n, i + 20) + 1):
                piece = lower[i:j]
                if piece not in _dp_dict:
                    continue
                plen = len(piece)
                # Quadratic scoring favours longer words.
                # Penalise short dictionary words (≤3 chars) that aren't common
                # function words — these are often obscure fragments like "sta",
                # "ing", "ion" that mislead the DP into bad splits.
                if plen <= 2:
                    if piece not in _SMALL_WORDS:
                        continue  # skip obscure 1-2 char dictionary entries
                    piece_score = scores[i] + plen  # linear, not quadratic
                elif plen == 3 and piece not in _SMALL_WORDS:
                    piece_score = scores[i] + 2  # small bonus, less than len*len=9
                else:
                    piece_score = scores[i] + plen * plen
                # Use >= so that ties are broken in favour of paths with
                # longer earlier words (processed later in the j loop).
                if piece_score >= scores[j]:
                    scores[j] = piece_score
                    paths[j] = [*paths[i], token[i:j]]

        parts = _merge_single_chars(paths[n] or [token])

        # Post-process: split DP words like "acritical" into "a" + "critical"
        # when the word starts with a common 1-char function word and the
        # remainder is a long dictionary word (>= 6 chars).  This corrects
        # the quadratic scoring bias towards single long words.
        final_parts: list[str] = []
        for part in parts:
            lp = part.lower()
            if (len(lp) >= 8
                    and lp[0] in ("a", "i")
                    and lp[1:] in _dp_dict
                    and len(lp[1:]) >= 6):
                final_parts.append(part[0])
                final_parts.append(part[1:])
            else:
                final_parts.append(part)
        parts = final_parts

        # Post-process: rebalance adjacent pairs where the current split
        # has a short/invalid piece.  Merge the pair and try all re-splits;
        # prefer a split where BOTH pieces are valid words ≥ 3 chars.
        # E.g. "we"+"reseen" → "were"+"seen",
        #      "areal"+"lstable" → "are"+"all" (then "lstable" stays for next pass).
        balanced: list[str] = []
        idx = 0
        while idx < len(parts):
            if idx + 1 < len(parts):
                a, b = parts[idx], parts[idx + 1]
                # Only rebalance when at least one piece is short or invalid
                a_ok = _is_word(a) and len(a) >= 3
                b_ok = _is_word(b) and len(b) >= 3
                if not (a_ok and b_ok):
                    merged = (a + b).lower()
                    best_split = None
                    best_score = 0
                    for sp in range(4, len(merged) - 3):
                        left, right = merged[:sp], merged[sp:]
                        if (left in _dp_dict and right in _dp_dict
                                and len(left) >= 4 and len(right) >= 4):
                            score = min(len(left), len(right))
                            if score > best_score:
                                best_score = score
                                best_split = sp
                    if best_split:
                        # Preserve case of first char from original
                        lpart = merged[:best_split]
                        if a and a[0].isupper():
                            lpart = lpart[0].upper() + lpart[1:]
                        balanced.append(lpart)
                        balanced.append(merged[best_split:])
                        idx += 2
                        continue
            balanced.append(parts[idx])
            idx += 1
        parts = balanced

        recognized = sum(len(part) for part in parts if _is_word(part))
        if len(parts) >= 2 and recognized / max(1, len(token)) >= 0.65:
            return " ".join(parts)
        return token

    def _split_joined_tokens_in_line(line: str) -> str:
        def _replace(match: re.Match[str]) -> str:
            token = match.group(0)
            if "-" in token:
                return "-".join(_split_joined_alpha_token(part) for part in token.split("-"))
            return _split_joined_alpha_token(token)

        return re.sub(r"[A-Za-z][A-Za-z-]{5,}", _replace, line)

    def _repair_fragmented_alpha_sequences(line: str) -> str:
        """Merge broken single/double-char fragments with immediate neighbors.

        Only starts a merge window from a token that is NOT a valid
        standalone word (genuine fragment like "f", "g", "pr").  Stops
        extending when the next token is a valid word ≥ 3 chars that
        isn't adjacent to another fragment.  This prevents the full-
        dictionary repair from swallowing entire phrases.
        """
        tokens = re.findall(r"[A-Za-z]+|[^A-Za-z]+", line)
        repaired: list[str] = []
        i = 0
        while i < len(tokens):
            if not tokens[i].isalpha():
                repaired.append(tokens[i])
                i += 1
                continue

            # Skip tokens that are already valid standalone words —
            # only start merging from genuine fragments.
            if _is_word(tokens[i]):
                repaired.append(tokens[i])
                i += 1
                continue

            # Skip single-char alpha tokens that are attached to
            # non-whitespace (e.g. the "k" in "100k" — it's part of
            # a unit, not a genuine fragment).
            if (len(tokens[i]) <= 2
                    and i > 0 and not re.fullmatch(r"\s+", tokens[i - 1])):
                repaired.append(tokens[i])
                i += 1
                continue

            # Found a fragment — collect adjacent alpha tokens separated
            # by whitespace, but stop when we hit a valid word ≥ 4 chars
            # that isn't followed by another fragment.
            j = i
            parts: list[str] = [tokens[j]]
            while True:
                if j + 1 >= len(tokens):
                    break
                if not re.fullmatch(r"\s+", tokens[j + 1] or ""):
                    break
                if j + 2 >= len(tokens) or not tokens[j + 2].isalpha():
                    break
                next_tok = tokens[j + 2]
                parts.append(next_tok)
                j += 2
                # If this token is a valid long word AND what follows
                # is also valid, stop extending.
                if _is_word(next_tok) and len(next_tok) >= 4:
                    if j + 2 >= len(tokens) or not tokens[j + 2].isalpha():
                        break
                    peek = tokens[j + 2]
                    if _is_word(peek) and len(peek) >= 3:
                        break

            if len(parts) >= 2:
                combined = "".join(parts)
                repaired_token = _split_joined_alpha_token(combined)
                if repaired_token != combined:
                    repaired.append(repaired_token)
                    i = j + 1
                    continue

            repaired.append(tokens[i])
            i += 1
        return "".join(repaired)

    fixed_lines: list[str] = []
    for line in str(text or "").split("\n"):
        stripped = line.strip()
        if (
            stripped.startswith("```")
            or stripped.startswith("|")
            or stripped.startswith("![")
            or re.match(r"^https?://", stripped)
        ):
            fixed_lines.append(line)
            continue

        fixed = line
        fixed = fixed.replace("¢", "- ")
        fixed = fixed.replace("\u2022", "- ")
        fixed = fixed.replace("\u2014", " - ")
        fixed = re.sub(r"(\d+(?:\.\d+)?)%([A-Za-z])", r"\1% \2", fixed)
        fixed = re.sub(r"([A-Za-z])(-\d(?:\.\d+)?)", r"\1 \2", fixed)
        # Letter-digit spacing: "same5" → "same 5", "at0.6%" → "at 0.6%"
        # Split when 2+ lowercase letters precede a digit (skips "v1", "H1", etc.)
        fixed = re.sub(r"([a-z]{2,})(\d)", r"\1 \2", fixed)
        # Single function word before digit: "a3.2" → "a 3.2"
        fixed = re.sub(r"\b([aiAI])(\d)", r"\1 \2", fixed)
        # Digit before long word: "-5malaria" → "-5 malaria"
        fixed = re.sub(r"(\d)([a-zA-Z]{3,})", r"\1 \2", fixed)
        fixed = re.sub(
            r"(\d+(?:\.\d+)?)(per|million|billion|thousand|population|cases|deaths|admissions|tests|patients|districts|regions|facilities|months|years|weeks|days)",
            r"\1 \2",
            fixed,
            flags=re.IGNORECASE,
        )
        fixed = _repair_fragmented_alpha_sequences(fixed)
        fixed = re.sub(r"([a-zA-Z%\d])([,;])([a-zA-Z])", r"\1\2 \3", fixed)
        # "2017.The" or "13.3%.Testing" — period/% before uppercase letter
        fixed = re.sub(r"([a-z0-9%])\.([A-Z])", r"\1. \2", fixed)
        fixed = re.sub(r"([a-zA-Z]):([a-zA-Z])", r"\1: \2", fixed)
        fixed = re.sub(r"([a-zA-Z])\((?!\))", r"\1 (", fixed)
        fixed = re.sub(r"(?<!`)([a-z]{2,})([A-Z][a-z])(?!`)", r"\1 \2", fixed)
        fixed = _split_joined_tokens_in_line(fixed)
        fixed = re.sub(r"\b(Key)(points)\b", r"\1 \2", fixed, flags=re.IGNORECASE)
        fixed = re.sub(
            r"\b(Leadership)(watchouts)\b",
            r"\1 \2",
            fixed,
            flags=re.IGNORECASE,
        )
        fixed = re.sub(r"\b(Executive)(Summary)\b", r"\1 \2", fixed, flags=re.IGNORECASE)
        fixed = re.sub(r"\b(year-over-year)([A-Za-z])", r"\1 \2", fixed, flags=re.IGNORECASE)
        fixed = re.sub(r"([a-zA-Z]{2,})(\d{2,})", r"\1 \2", fixed)
        fixed = _repair_fragmented_alpha_sequences(fixed)
        fixed = _split_joined_tokens_in_line(fixed)
        fixed = re.sub(r" {2,}", " ", fixed)
        fixed_lines.append(fixed)
    cleaned_text = "\n".join(fixed_lines)

    targeted_repairs: tuple[tuple[str, str], ...] = (
        (r"\bmalari\s+a\b", "malaria"),
        (r"\bho\s+sp\s+it\s+al\b", "hospital"),
        (r"\bper\s+for\s+m\s+an\s+ce\b", "performance"),
        (r"\bh\s+is\s+t\s+or\s+ical\b", "historical"),
        (r"\bhistoricalrec\s+or\s+d\b", "historical record"),
        (r"\bf\s+all\s+en\b", "fallen"),
        (r"\br\s+is\s+in\s+g\b", "rising"),
        (r"\bsoar\s+in\s+g\b", "soaring"),
        (r"\bdecl\s+in\s+e\b", "decline"),
        (r"\bin\s+cre\s+as\s+e\b", "increase"),
        (r"\bd\s+at\s+a\b", "data"),
        (r"\baction\s+able\b", "actionable"),
        (r"\bgene\s+rate\b", "generate"),
        (r"\bm\s+is\s+s\s+in\s+g\b", "missing"),
        (r"\bsupp\s+or\s+t\b", "support"),
        (r"\bcomp\s+are\s+d\b", "compared"),
        (r"\bdecre\s+as\s+ed\b", "decreased"),
        (r"\brema\s+in\s+s\b", "remains"),
        (r"\bin\s+cidence\b", "incidence"),
        (r"\bug\s+and\s+a\b", "Uganda"),
        (r"\bla\s+test\b", "latest"),
        (r"\bpri\s+or\b", "prior"),
        (r"\bno\s+t\b", "not"),
        (r"\ba\s+no\s+maly\b", "anomaly"),
        (r"\bis\s+sue\b", "issue"),
        (r"\bprep\s+are\b", "prepare"),
        (r"\bhospital\s+iz\s+at\s+i\s+on\b", "hospitalization"),
        (r"\bhospital\s+iz\s+at\s+i\s+on\s+s\b", "hospitalizations"),
        (r"\bactiv\s+it\s+y\b", "activity"),
        (r"\bc\s+are\b", "care"),
        (r"\bs\s+it\s+u\s+at\s+i\s+on\b", "situation"),
        (r"\bin\s+for\s+m\s+at\s+i\s+on\b", "information"),
        (r"\bimp\s+or\s+t\s+an\s+t\b", "important"),
        (r"\bfocus\s+in\s+g\b", "focusing"),
        (r"\brecord\s+ed\b", "recorded"),
        (r"\bpopulatio\s+n\s+s\b", "populations"),
        (r"\bpopulatio\s+n\b", "population"),
        (r"\bw\s+or\s+sen\s+in\s+g\b", "worsening"),
        (r"\br\s+is\s+k\b", "risk"),
        (r"\bn\s+at\s+i\s+on\s+al\b", "national"),
        (r"\bdem\s+and\s+s\b", "demands"),
        (r"\bc\s+on\s+cern\s+in\s+g\s*level\b", "concerning level"),
        (r"\bwhole-of-society\b", "whole-of-society"),
        (r"\btr\s+an\s+sm\s+is\s+si\s+on\b", "transmission"),
        (r"\bra\s+in\s+yse\s+as\s+on\b", "rainy season"),
        (r"\bnearlyhalf\b", "nearly half"),
        (r"\bfallensharply\b", "fallen sharply"),
    )
    for pattern, replacement in targeted_repairs:
        cleaned_text = re.sub(pattern, replacement, cleaned_text, flags=re.IGNORECASE)

    cleaned_text = re.sub(r"(\d)\s+and\s+(\d)", r"\1 and \2", cleaned_text)
    cleaned_text = re.sub(r"(\d)\s+respectively\b", r"\1 respectively", cleaned_text)
    return cleaned_text


def _proofread_generated_insight(text: str) -> str:
    """Apply backend cleanup so generated insight text is readable before render."""
    cleaned = _strip_prompt_leakage(text)
    cleaned = re.sub(_LEAKED_INSTRUCTION_BLOCK_PATTERNS, "\n", cleaned)
    cleaned = cleaned.replace("\\*", "*").replace("\\#", "#").replace("\\_", "_").replace("\\`", "`")
    heading_match = re.search(
        r"(?im)^(?:##\s+)?(?:Executive Summary|Chart Summary|Executive Brief|Key Takeaways)\b",
        cleaned,
    )
    if heading_match:
        preamble = cleaned[:heading_match.start()]
        if re.search(
            r"(?im)(?:min=|max=|avg=|total=|change=|rows analysed|active filters|cross-chart evidence|^\s*map:\s*$)",
            preamble,
        ):
            cleaned = cleaned[heading_match.start():]
        elif re.search(r"(?im)^(?:Do not|Focus on|Generate|Return only)\b", preamble):
            cleaned = cleaned[heading_match.start():]
    for _ in range(2):
        repaired = _fix_generated_word_spacing(cleaned)
        if repaired == cleaned:
            break
        cleaned = repaired
    cleaned = re.sub(_LEAKED_INSTRUCTION_BLOCK_PATTERNS, "\n", cleaned)
    sentence_counts: dict[str, int] = {}
    deduped_parts: list[str] = []
    for part in re.split(r"(?<=[.!?])\s+", cleaned):
        normalized = re.sub(r"\s+", " ", part).strip().lower()
        if len(normalized) >= 40:
            sentence_counts[normalized] = sentence_counts.get(normalized, 0) + 1
            if sentence_counts[normalized] > 1:
                continue
        deduped_parts.append(part)
    cleaned = " ".join(deduped_parts)
    if "Leadership Watchouts" in cleaned and "Bottom Line" in cleaned:
        lower_cleaned = cleaned.lower()
        bottom_idx = lower_cleaned.find("bottom line")
        if bottom_idx > 0:
            tail = cleaned[bottom_idx:]
            repeated_tail = re.search(r"(.{80,}?)\1{2,}", tail, re.DOTALL)
            if repeated_tail:
                cleaned = cleaned[:bottom_idx] + repeated_tail.group(1)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ── System prompts ──────────────────────────────────────────────────
# Kept terse to minimize input tokens while retaining instruction quality.

_CHART_TYPE_INTELLIGENCE = (
    "\n\nCHART TYPE INTERPRETATION GUIDE — adapt analysis to the visualization type:\n"
    "Detect the viz_type from context and apply the correct analytical approach.\n\n"
    "TIME-SERIES CHARTS (echarts_timeseries, echarts_timeseries_line, echarts_timeseries_bar, "
    "echarts_timeseries_scatter, echarts_timeseries_smooth, echarts_timeseries_step, echarts_area):\n"
    "  - Identify trend direction, inflection points, rate of change, seasonality\n"
    "  - Calculate period-over-period change (MoM, QoQ, YoY)\n"
    "  - Flag anomalies that break established patterns\n"
    "  - Forecast next period if trend is clear\n"
    "  - For step charts: identify plateau periods and sudden shifts\n\n"
    "MIXED TIMESERIES (mixed_timeseries):\n"
    "  - Analyze each series independently AND their relationships\n"
    "  - Identify correlations, divergences, and lead/lag between series\n"
    "  - Different series types (bar+line) signal different data natures — respect that\n\n"
    "BAR CHARTS (echarts_timeseries_bar, bar):\n"
    "  - Rank entities, identify top/bottom performers, calculate spread\n"
    "  - Note the gap between best and worst (range and ratio)\n"
    "  - Identify clusters, outliers, and distribution shape\n"
    "  - For stacked bars: analyze both absolute values AND proportions\n\n"
    "PIE / DONUT (pie):\n"
    "  - Focus on concentration: does one slice dominate? Pareto pattern?\n"
    "  - Note the top 2-3 segments and the long tail\n"
    "  - Calculate the HHI or equivalent concentration measure\n"
    "  - Recommend bar chart if >6 segments or small differences\n\n"
    "FUNNEL (funnel):\n"
    "  - Calculate stage-by-stage conversion rates AND cumulative retention\n"
    "  - Identify the biggest absolute drop (volume) and biggest rate drop (%)\n"
    "  - Compare multiple funnels period-over-period if available\n"
    "  - Name the critical bottleneck stage clearly\n\n"
    "BOX PLOT (box_plot):\n"
    "  - Compare median, IQR, and whisker range across groups\n"
    "  - Flag groups with high variance vs tight distributions\n"
    "  - Identify outliers beyond whiskers\n"
    "  - Compare symmetry/skew of each distribution\n\n"
    "HEATMAP (heatmap_v2):\n"
    "  - Identify hotspots (high-value cells) and cold spots\n"
    "  - Look for row patterns (entity-level trends) and column patterns (time/category trends)\n"
    "  - Note diagonal patterns if axes are ordered\n"
    "  - Quantify the range from coldest to hottest\n\n"
    "TREEMAP (treemap_v2):\n"
    "  - Emphasize size hierarchy — largest rectangle = largest value\n"
    "  - Analyze parent-child proportions in nested segments\n"
    "  - Note which sub-segments dominate within parent categories\n"
    "  - Identify unexpectedly large or small segments\n\n"
    "SUNBURST (sunburst_v2):\n"
    "  - Read from center (top-level) to edges (detail)\n"
    "  - Analyze proportions at each ring level\n"
    "  - Identify dominant paths from root to leaf\n"
    "  - Note asymmetric branches (one branch much larger than siblings)\n\n"
    "SANKEY (sankey_v2):\n"
    "  - Trace flow volumes from source to destination\n"
    "  - Identify the thickest flows (dominant pathways)\n"
    "  - Calculate conversion/retention at each stage\n"
    "  - Flag unexpected or undesirable flows (leakage)\n\n"
    "RADAR (radar):\n"
    "  - Compare overall shape/area across entities (larger area = stronger overall)\n"
    "  - Identify spikes (strengths) and dips (weaknesses) per entity\n"
    "  - Note which dimensions differentiate entities most\n"
    "  - Calculate balance score (how uniform is the shape?)\n\n"
    "GAUGE (gauge_chart):\n"
    "  - Compare current value to target/threshold\n"
    "  - State whether in green/yellow/red zone\n"
    "  - Calculate distance to target in absolute and percentage terms\n"
    "  - Recommend action if in warning/critical zone\n\n"
    "BIG NUMBER / POP KPI (big_number, big_number_total, pop_kpi, comparison_kpi, marquee_kpi):\n"
    "  - State the value clearly with context\n"
    "  - Interpret the period-over-period change (direction, magnitude, significance)\n"
    "  - Compare to benchmarks or targets if available\n"
    "  - For marquee KPIs: summarize the collection of KPIs and their overall story\n\n"
    "WATERFALL (waterfall):\n"
    "  - Trace the cumulative walk from start to end\n"
    "  - Identify which categories contribute most (positive) and which drag (negative)\n"
    "  - Calculate the net effect and name the largest contributors\n"
    "  - Note if a few items dominate the total change\n\n"
    "BUBBLE (bubble_v2):\n"
    "  - Analyze three dimensions: x-position, y-position, and bubble size\n"
    "  - Identify quadrant patterns (high-high, low-low, etc.)\n"
    "  - Flag outlier bubbles by position or size\n"
    "  - Describe the relationship between axes (positive/negative/none)\n\n"
    "HISTOGRAM (histogram_v2):\n"
    "  - Describe distribution shape: normal, skewed, bimodal, uniform\n"
    "  - Identify the mode, approximate mean/median position\n"
    "  - Note tail behavior — heavy tails, outlier bins\n"
    "  - Compare to expected distribution if applicable\n\n"
    "VIOLIN DISTRIBUTION (violin_distribution):\n"
    "  - Compare distribution shapes across groups\n"
    "  - Identify bimodal or multimodal groups\n"
    "  - Note width differences (where data concentrates)\n"
    "  - Compare medians AND distribution shapes (not just medians)\n\n"
    "SCATTER PLOT (echarts_timeseries_scatter):\n"
    "  - Estimate correlation direction and strength\n"
    "  - Identify clusters, outliers, and non-linear patterns\n"
    "  - Note heteroscedasticity (variance changing with values)\n"
    "  - State whether relationship suggests causation or just association\n\n"
    "CONTROL CHART (control_chart):\n"
    "  - Identify points outside control limits (UCL/LCL)\n"
    "  - Flag runs (7+ consecutive points above/below center)\n"
    "  - Note trends approaching control limits\n"
    "  - Distinguish common-cause from special-cause variation\n"
    "  - Apply Western Electric rules for process signals\n\n"
    "TABLE / PIVOT TABLE (table, pivot_table_v2, ag-grid-table, time_table):\n"
    "  - Identify top/bottom rows by the key metric\n"
    "  - Calculate totals, averages, and derived metrics from the data\n"
    "  - Spot patterns in cross-tabulated data (row and column trends)\n"
    "  - Highlight cells that are outliers within their row or column\n\n"
    "WORD CLOUD (word_cloud):\n"
    "  - Identify the dominant terms (largest words)\n"
    "  - Note thematic clusters and unexpected terms\n"
    "  - Interpret what the frequency pattern reveals about the source data\n\n"
    "SMALL MULTIPLES (small_multiples):\n"
    "  - Compare the SAME metric across multiple panels (entities, periods, categories)\n"
    "  - Identify which panels stand out as different from the majority\n"
    "  - Note common patterns that appear across most panels\n"
    "  - Flag panels that break the common pattern — these are the insights\n\n"
    "COHORT CASCADE (cohort_cascade):\n"
    "  - Track progression of cohorts through stages over time\n"
    "  - Calculate retention/attrition at each stage per cohort\n"
    "  - Compare newer cohorts vs older cohorts — is performance improving or declining?\n"
    "  - Identify the critical drop-off stage for each cohort\n\n"
    "AGE-SEX PYRAMID (age_sex_pyramid):\n"
    "  - Compare male and female distributions across age bands\n"
    "  - Identify bulges (large cohorts) and pinches (small cohorts)\n"
    "  - Note gender imbalances in specific age groups\n"
    "  - Interpret demographic structure: expansive, constrictive, or stationary\n"
    "  - In health: identify high-burden age-sex groups for targeted intervention\n\n"
    "STOCK STATUS (stock_status):\n"
    "  - Classify items by stock level: overstocked, adequate, low, stocked-out\n"
    "  - Calculate months-of-stock for each item\n"
    "  - Identify critical items at risk of stock-out\n"
    "  - Flag items that are both essential AND low-stock — highest priority\n"
    "  - Recommend redistribution from overstocked to understocked\n\n"
    "RANKED VARIANCE (ranked_variance):\n"
    "  - Identify top positive and negative variances\n"
    "  - Calculate the spread between best and worst performers\n"
    "  - Note whether variance is concentrated in few entities or spread evenly\n"
    "  - Prioritize action on the largest negative variances\n\n"
    "MAP VISUALIZATIONS (dhis2_map, vital_maps, deck_geojson, deck_scatter, deck_arc, "
    "deck_heatmap, deck_hex, deck_grid, deck_polygon, deck_path, deck_contour, "
    "cartodiagram, country_map, world_map, mapbox):\n"
    "  - Identify geographic clusters (hotspots and cold spots)\n"
    "  - Note regional patterns: urban vs rural, north vs south, coastal vs inland\n"
    "  - For choropleth: rank regions by intensity, identify the extremes\n"
    "  - For point/bubble maps: note clustering vs dispersal patterns\n"
    "  - For heatmaps: identify density centers and sparse areas\n"
    "  - For arc/flow maps: identify dominant origin-destination pairs\n"
    "  - For boundary layers: note which administrative boundaries contain hotspots\n"
    "  - For DHIS2 maps: interpret health facility distribution, catchment gaps, "
    "service coverage zones, and geographic equity in health service access\n"
    "  - For vital_maps layers (choropleth, bubble, point, heatmap, boundary, extrusion, marker): "
    "interpret each layer type appropriately — extrusions show 3D magnitude, markers show "
    "facility types, boundaries show administrative divisions\n\n"
    "GANTT CHART (gantt_chart):\n"
    "  - Identify critical path (longest chain of dependent tasks)\n"
    "  - Flag overdue or delayed tasks\n"
    "  - Note resource conflicts (overlapping tasks)\n"
    "  - Calculate overall project timeline and slack\n\n"
    "PARALLEL COORDINATES (para):\n"
    "  - Identify crossing patterns that reveal correlations\n"
    "  - Note lines that cluster vs lines that diverge\n"
    "  - Identify outlier entities that cross uniquely\n\n"
    "CHORD DIAGRAM (chord):\n"
    "  - Identify strongest bilateral relationships\n"
    "  - Note asymmetric flows (A→B much larger than B→A)\n"
    "  - Identify dominant nodes (most connections or thickest chords)\n\n"
    "ROSE DIAGRAM (rose):\n"
    "  - Compare petal sizes across directions/categories\n"
    "  - Identify dominant and weak directions\n"
    "  - Note symmetry or asymmetry in the pattern\n\n"
    "BULLET CHART (bullet):\n"
    "  - Compare actual vs target vs qualitative ranges\n"
    "  - State whether target is met, approaching, or missed\n"
    "  - Quantify the gap to target\n"
)

_ANALYTICAL_INTELLIGENCE = (
    "\n\nANALYTICAL REASONING FRAMEWORK — apply these to ANY data domain:\n"
    "1. DOMAIN DETECTION: Infer the domain (health, finance, education, agriculture, HR, "
    "logistics, etc.) from chart names, column labels, metric names, and data values. "
    "Adapt your vocabulary, benchmarks, and analytical lens to the detected domain. "
    "If health data: use clinical/epidemiological framing. If financial: use fiscal/ROI framing. "
    "If education: use learning outcomes framing. Always match the domain's mental model.\n"
    "2. STATISTICAL THINKING — apply automatically:\n"
    "   a) TREND ANALYSIS: Identify direction (rising, falling, flat, volatile), rate of change "
    "(accelerating, decelerating), and inflection points. State the magnitude: 'Revenue grew 18% "
    "YoY' not just 'Revenue grew'.\n"
    "   b) ANOMALY DETECTION: Flag values that deviate >1.5x from the mean or break an established "
    "pattern. Distinguish seasonal variation from true anomalies. State: 'District X is 2.3 SD "
    "above the mean — investigate data quality before acting.'\n"
    "   c) DISTRIBUTION ANALYSIS: Note skew, concentration, and spread. '80% of output comes from "
    "3 of 12 facilities' is more useful than listing all 12.\n"
    "   d) COMPARATIVE ANALYSIS: Always compare — period-over-period, entity-vs-entity, "
    "actual-vs-target, current-vs-benchmark. Raw numbers without comparison are meaningless.\n"
    "   e) RATE-OF-CHANGE: Calculate and report percentage changes, growth rates, velocity. "
    "'Cases dropped from 450 to 320' should also say '(-29% MoM)'.\n"
    "   f) CORRELATION: When multiple metrics move together, note the association but be explicit: "
    "'X and Y moved in parallel (correlation, not proven causation).'\n"
    "   g) SEASONALITY: Recognize cyclical patterns and distinguish them from structural shifts. "
    "'Q4 dip is consistent with historical seasonal pattern' vs 'this decline breaks the cycle.'\n"
    "3. CONTEXTUAL INTELLIGENCE:\n"
    "   a) Apply domain-appropriate thresholds and benchmarks. In health: WHO targets, national "
    "standards. In finance: industry ratios, budget targets. In education: pass rates, enrollment "
    "targets. When no benchmark is given, derive one from the data (mean, median, top quartile).\n"
    "   b) Identify LEADING vs LAGGING indicators. A drop in training attendance (leading) predicts "
    "future quality decline (lagging). Name the causal chain.\n"
    "   c) Distinguish DATA QUALITY issues from real performance issues. Missing data, reporting "
    "delays, denominator changes — flag these before drawing conclusions.\n"
    "   d) SEGMENT analysis: Break aggregate numbers into meaningful sub-groups. 'Overall 75% is "
    "misleading — urban sites are at 92% while rural sites are at 54%.'\n"
    "4. INSIGHT HIERARCHY — prioritize in this order:\n"
    "   a) URGENT/ACTIONABLE: Thresholds breached, targets missed, emerging crises\n"
    "   b) STRATEGIC: Structural trends, systemic patterns, resource allocation implications\n"
    "   c) OPERATIONAL: Process improvements, efficiency gains, workflow optimizations\n"
    "   d) INFORMATIONAL: Context, definitions, methodology notes\n"
)

# ── Unified insight prompt ──────────────────────────────────────────
# Applies to ALL providers (cloud and local) and ALL insight modes.

_INSIGHT_CORE_RULES = (
    "\n\nNON-NEGOTIABLE RULES:\n"
    "1. USE ONLY PROVIDED EVIDENCE — only use the supplied chart/dashboard context, "
    "metrics, values, labels, dates, filters, thresholds, comparisons, top/bottom "
    "entities, anomalies, and calculated summaries. Do not invent history, causes, "
    "targets, time durations, periods, or benchmarks.\n"
    "2. NEVER HALLUCINATE — never claim 'worst in history', 'no improvement in 3 months', "
    "'nationwide crisis', 'all districts are red', 'trend worsened', 'X caused Y' unless "
    "the supplied evidence directly supports it.\n"
    "3. SEPARATE FACT FROM INTERPRETATION — Observed fact = directly visible in the data. "
    "Interpretation = likely meaning of the pattern. Recommendation = action tied to evidence. "
    "Use careful phrasing for interpretations: 'suggests', 'may indicate', 'is consistent with', "
    "'could reflect'.\n"
    "4. BE NUMERICALLY SPECIFIC — include exact values, rank order, peaks and lows, counts by "
    "status, period deltas, top and bottom contributors, threshold breaches whenever possible.\n"
    "5. SELF-CHECK FOR CONSISTENCY — before responding, verify counts by status, best/worst "
    "performers, trend direction, whether prior-period data exists, whether a statement matches "
    "the provided data. If uncertain, say so clearly.\n"
    "6. HANDLE DATA QUALITY CAREFULLY — if there are zeros, nulls, suspicious collapses, blank "
    "periods, impossible values, or incomplete coverage, flag them as possible reporting/data "
    "quality issues. Do not assume real-world improvement.\n"
    "7. AVOID REPETITION — do not repeat the same finding across sections. Each paragraph or "
    "bullet must add distinct value.\n"
    "8. KEEP TONE PROFESSIONAL — write like a senior advisor. Avoid panic language, "
    "sensationalism, filler, generic phrasing, and repetitive warnings.\n\n"
    "ENFORCEMENT RULES:\n"
    "- Minimum narrative: 1 paragraph + support bullets for any summary\n"
    "- Dashboard summary: at least 4 evidence-bearing bullets\n"
    "- Chart summary: at least 3 evidence-bearing bullets\n"
    "- Every recommendation must include evidence, benefit, and risk if ignored\n"
    "- If a claim repeats one already made, rewrite with new analytical value or remove it\n"
    "- If a count can be computed from the supplied data, prefer the computed count\n"
    "- If trend period is not explicitly provided, do not state a duration like 'in 3 months'\n"
)

_INSIGHT_SCOPE_LOGIC = (
    "\n\nSUMMARY SCOPE LOGIC:\n"
    "DASHBOARD SUMMARY (multiple charts provided or dashboard scope requested):\n"
    "- 1 professional executive paragraph (90-150 words)\n"
    "- 4-6 key bullets with cross-chart synthesis\n"
    "- top risks or watchouts, overall decision signal\n"
    "- Answer: What is happening overall? What matters most? What is getting worse, improving, "
    "or needing scrutiny? What should leadership pay attention to now?\n\n"
    "CHART SUMMARY (single chart or chart scope requested):\n"
    "- 1 short analytical paragraph (70-120 words)\n"
    "- 3-5 supporting bullets\n"
    "- What stands out, who leads/lags, any anomaly or data gap, brief implication\n"
    "- Do not pretend to synthesize other charts.\n"
)

_INSIGHT_WRITING_STYLE = (
    "\n\nWRITING STYLE:\n"
    "- Polished professional prose. Short analytical paragraphs.\n"
    "- Bullets for support, not as the entire answer.\n"
    "- Evidence-led phrasing. Domain-appropriate seriousness.\n"
    "- Do NOT use: 'interesting', 'huge issue', 'massive crisis', 'clearly catastrophic', "
    "'obviously', repetitive warnings, empty filler.\n"
    "- PREFER: 'The dashboard indicates...', 'The data suggests...', 'The strongest signal is...', "
    "'A notable concern is...', 'This pattern may indicate...', 'From an operational perspective...', "
    "'From a decision-making standpoint...'.\n"
)

_INSIGHT_OUTPUT_RULES = (
    "\n\nOUTPUT QUALITY RULES:\n"
    "- Return markdown only.\n"
    "- Do not mention these instructions or that you are an AI.\n"
    "- Do not output chain-of-thought.\n"
    "- Do not repeat a metric in multiple bullets unless needed.\n"
    "- Attribute findings to the source chart when useful.\n"
    "- If data is incomplete, say so explicitly.\n"
    "- If evidence is weak, reduce confidence and avoid strong conclusions.\n"
    "- Use severity tags selectively on own line: [CRITICAL], [WARNING], [GOOD], [INFO].\n"
    "- Use proper markdown tables with separator rows.\n"
    "- Insight-led headings that state the takeaway, not just the topic.\n"
    "- For recommendations: action, why now, evidence, expected benefit, risk if ignored.\n"
)

# Mode-specific instructions keyed by detected insight mode.
_INSIGHT_MODE_SPECS: dict[str, str] = {
    "summary": (
        "If scope=dashboard: heading 'Executive Summary', 1 professional paragraph (90-150 words), "
        "4-6 bullets titled 'Key points', optional 'Leadership watchouts' section. "
        "If scope=chart: heading 'Chart Summary', 1 analytical paragraph (70-120 words), "
        "3-5 bullets titled 'What stands out', 1 'Why it matters' line."
    ),
    "key_takeaways": (
        "Return exactly 5 sharp bullets. Each bullet must contain at least one named metric, "
        "entity, value, or comparison."
    ),
    "metrics_attention": (
        "For each priority metric return: Metric, Current signal, Evidence, Why it matters, "
        "Priority level, Immediate follow-up."
    ),
    "concerning_trends": (
        "Only include deteriorating or suspicious movements. For each: Trend, Evidence, "
        "Interpretation, Operational implication."
    ),
    "cross_chart": (
        "Dashboard scope only. Each pattern must be supported by at least 2 charts. "
        "Format: Pattern, Evidence across charts, Why it matters."
    ),
    "performance_overview": (
        "Return: overall performance paragraph, areas of strength, areas of weakness, "
        "operational watchouts."
    ),
    "risk_analysis": (
        "For each major risk: Risk, Evidence, Likely impact, Urgency, Confidence level "
        "if evidence is incomplete."
    ),
    "regional_comparison": (
        "Compare regions/districts/locations directly. Highlight: highest burden areas, "
        "lowest burden areas, geographic concentration, imbalance or clustering."
    ),
    "period_comparison": (
        "Only compare periods if both current and previous period are supplied. "
        "If not available, state: 'Period comparison cannot be confirmed from the supplied context.'"
    ),
    "top_bottom": (
        "Return: top performers with values, laggards with values, one short "
        "interpretation paragraph."
    ),
    "target_achievement": (
        "Only assess against targets if a target or threshold is explicitly provided. "
        "If none exists, say: 'No explicit target or benchmark was provided in the supplied context.'"
    ),
    "leading_lagging": (
        "Separate early warning indicators from outcome indicators. Do not claim causality "
        "unless explicitly supported."
    ),
    "data_quality": (
        "Focus on: missing periods, sudden zeros, suspicious spikes/drops, incomplete fields, "
        "possible reporting lags. State how this affects confidence."
    ),
    "correlation": (
        "Only describe relationships that are visibly supported. Do not claim statistical "
        "significance unless explicitly provided."
    ),
    "executive_brief": (
        "Return: 1 board-ready paragraph, 3-5 executive bullets, 3 priority actions."
    ),
    "strategic_recommendations": (
        "For each recommendation: Action, Why now, Evidence, Expected benefit, Risk if ignored."
    ),
    "critical_alerts": (
        "Return only top priority alerts. Format: Alert, Evidence, Immediate implication, "
        "Recommended immediate check."
    ),
    "improvement": (
        "Focus on realistic leverage points. Each opportunity must tie to a bottleneck or "
        "underperformance signal."
    ),
    "deep_dive": (
        "If scope=dashboard: 1. Executive Summary, 2. Performance Overview, "
        "3. Detailed Analysis by Chart, 4. Cross-Chart Patterns, 5. Risk and Issue Analysis, "
        "6. Strategic Recommendations, 7. Data Quality / Confidence Notes. "
        "If scope=chart: 1. Chart Summary, 2. Metric Interpretation, "
        "3. Top and Bottom Signals, 4. Risks / Watchouts, 5. Improvement Opportunities, "
        "6. Data Quality / Confidence Notes."
    ),
    "outlier_analysis": (
        "Identify values that deviate significantly from the mean or break established patterns. "
        "Distinguish seasonal variation from true anomalies. Quantify deviation."
    ),
    "distribution": (
        "Note skew, concentration, and spread. Identify whether a few entities dominate. "
        "E.g., '80% of output comes from 3 of 12 facilities.'"
    ),
    "seasonal": (
        "Recognize cyclical patterns and distinguish from structural shifts. "
        "State whether observed patterns are consistent with historical seasonality."
    ),
    "forecast": (
        "Based on observed trends, state likely near-term direction. "
        "Use cautious language: 'if current trajectory continues', 'may reach X by Y'."
    ),
}

# Map frontend suggestion text → mode key
_MODE_MAP: dict[str, str] = {
    "summary": "summary",
    "key takeaways": "key_takeaways",
    "key trends": "key_takeaways",
    "top insights": "key_takeaways",
    "metrics needing attention": "metrics_attention",
    "metrics that need attention": "metrics_attention",
    "metrics to watch": "metrics_attention",
    "concerning trends": "concerning_trends",
    "warning trends": "concerning_trends",
    "cross-chart patterns": "cross_chart",
    "cross chart patterns": "cross_chart",
    "cross-chart analysis": "cross_chart",
    "cross chart analysis": "cross_chart",
    "performance overview": "performance_overview",
    "risk and issue analysis": "risk_analysis",
    "risk assessment": "risk_analysis",
    "regional comparison": "regional_comparison",
    "regional breakdown": "regional_comparison",
    "period-over-period trends": "period_comparison",
    "period-over-period comparison": "period_comparison",
    "top performers and laggards": "top_bottom",
    "top and bottom performers": "top_bottom",
    "target achievement status": "target_achievement",
    "performance against targets": "target_achievement",
    "leading vs lagging indicators": "leading_lagging",
    "leading and lagging indicators": "leading_lagging",
    "data gaps and quality": "data_quality",
    "data quality check": "data_quality",
    "data quality analysis": "data_quality",
    "correlation analysis": "correlation",
    "executive presentation brief": "executive_brief",
    "executive brief": "executive_brief",
    "strategic recommendations": "strategic_recommendations",
    "actionable recommendations": "strategic_recommendations",
    "critical alerts": "critical_alerts",
    "critical thresholds": "critical_alerts",
    "improvement opportunities": "improvement",
    "quarter-over-quarter changes": "period_comparison",
    "quarter over quarter changes": "period_comparison",
    "qoq changes": "period_comparison",
    "comprehensive deep dive": "deep_dive",
    "deep dive": "deep_dive",
    "comprehensive analysis": "deep_dive",
    "outlier analysis": "outlier_analysis",
    "ranking analysis": "top_bottom",
    "distribution analysis": "distribution",
    "year-on-year growth": "period_comparison",
    "seasonal patterns": "seasonal",
    "anomaly detection": "outlier_analysis",
    "rate of change": "concerning_trends",
    "forecast implications": "forecast",
}


def _detect_insight_mode(question: str) -> str:
    """Map a user question/suggestion to a recognized insight mode key."""
    q = question.strip().lower()
    # Direct match
    if q in _MODE_MAP:
        return _MODE_MAP[q]
    # Partial match — longest key first for greedy matching
    for key in sorted(_MODE_MAP, key=len, reverse=True):
        if key in q:
            return _MODE_MAP[key]
    # Default to comprehensive deep dive
    return "deep_dive"


def _extract_user_focus(question: str, insight_mode: str) -> str:
    """Preserve user-specific tuning beyond the detected insight mode phrase."""
    normalized_question = str(question or "").strip()
    if not normalized_question:
        return ""

    mode_phrases = sorted(
        [phrase for phrase, mode in _MODE_MAP.items() if mode == insight_mode],
        key=len,
        reverse=True,
    )
    residual = normalized_question
    for phrase in mode_phrases:
        residual = re.sub(re.escape(phrase), "", residual, flags=re.IGNORECASE)

    residual = re.sub(r"\s+", " ", residual).strip(" .,:;|-")
    if not residual:
        return ""

    generic_remainders = {
        "for this chart",
        "for this dashboard",
        "this chart",
        "this dashboard",
        "please",
        "show",
        "give",
        "generate",
        "create",
        "analyze",
        "analyse",
    }
    if residual.lower() in generic_remainders:
        return ""
    return residual

_HEALTH_THRESHOLDS = (
    "\n\nHEALTH PROGRAM THRESHOLDS AND COLOR LEGENDS:\n"
    "When health data is detected, automatically apply these program-specific thresholds "
    "and color bands. Use [CRITICAL], [WARNING], [GOOD] tags based on where values fall.\n\n"
    "MALARIA:\n"
    "  Test Positivity Rate (TPR): <5% GREEN, 5-15% YELLOW, 15-25% ORANGE, >25% RED\n"
    "  LLIN Coverage: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  IRS Coverage: >85% GREEN, 70-85% YELLOW, <70% RED\n"
    "  IPTp2+ Coverage: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Case Fatality Rate: <0.5% GREEN, 0.5-1% YELLOW, >1% RED\n"
    "  Reporting Completeness: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  ACT Treatment within 24hrs: >80% GREEN, 60-80% YELLOW, <60% RED\n\n"
    "HIV/AIDS (UNAIDS 95-95-95 Targets):\n"
    "  Know Status (1st 95): >95% GREEN, 80-95% YELLOW, <80% RED\n"
    "  On ART (2nd 95): >95% GREEN, 80-95% YELLOW, <80% RED\n"
    "  Viral Suppression (3rd 95): >95% GREEN, 80-95% YELLOW, <80% RED\n"
    "  PMTCT Coverage: >95% GREEN, 80-95% YELLOW, <80% RED\n"
    "  ART Retention (12 months): >85% GREEN, 70-85% YELLOW, <70% RED\n"
    "  HTS Positivity Yield: context-dependent (high yield = efficient targeting)\n"
    "  EID Coverage (<2 months): >80% GREEN, 60-80% YELLOW, <60% RED\n\n"
    "TUBERCULOSIS:\n"
    "  Treatment Success Rate: >85% GREEN, 75-85% YELLOW, <75% RED\n"
    "  Case Detection Rate: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  TB/HIV Co-infection Testing: >90% GREEN, 75-90% YELLOW, <75% RED\n"
    "  GeneXpert Coverage: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Lost to Follow-up: <5% GREEN, 5-15% YELLOW, >15% RED\n"
    "  Drug-Resistant TB Rate: <3% GREEN, 3-6% YELLOW, >6% RED\n"
    "  Contact Investigation: >90% GREEN, 70-90% YELLOW, <70% RED\n\n"
    "IMMUNIZATION (EPI):\n"
    "  DPT3/Penta3 Coverage: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  Measles 1st Dose: >95% GREEN, 85-95% YELLOW, <85% RED\n"
    "  Fully Immunized Child: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  Drop-out Rate (DPT1-DPT3): <10% GREEN, 10-20% YELLOW, >20% RED\n"
    "  BCG Coverage: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  Zero-Dose Children: <5% GREEN, 5-10% YELLOW, >10% RED\n"
    "  Cold Chain Functionality: >90% GREEN, 80-90% YELLOW, <80% RED\n\n"
    "MATERNAL HEALTH:\n"
    "  ANC 4+ Visits: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Skilled Birth Attendance: >90% GREEN, 70-90% YELLOW, <70% RED\n"
    "  Institutional Delivery: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  C-Section Rate: 10-15% GREEN, 5-10% or 15-25% YELLOW, <5% or >25% RED\n"
    "  Maternal Mortality Ratio: <140/100k GREEN, 140-340/100k YELLOW, >340/100k RED\n"
    "  PNC within 48hrs: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  EmONC Signal Functions (met): >7/9 GREEN, 5-7/9 YELLOW, <5/9 RED\n\n"
    "NUTRITION:\n"
    "  Stunting (under-5): <20% GREEN, 20-30% YELLOW, 30-40% ORANGE, >40% RED\n"
    "  Wasting (under-5): <5% GREEN, 5-10% YELLOW, 10-15% ORANGE, >15% RED\n"
    "  SAM Cure Rate: >75% GREEN, 50-75% YELLOW, <50% RED\n"
    "  SAM Default Rate: <15% GREEN, 15-25% YELLOW, >25% RED\n"
    "  SAM Death Rate: <10% GREEN, 10-15% YELLOW, >15% RED\n"
    "  Exclusive Breastfeeding (0-6m): >50% GREEN, 30-50% YELLOW, <30% RED\n"
    "  Vitamin A Supplementation: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Low Birth Weight: <10% GREEN, 10-15% YELLOW, >15% RED\n\n"
    "FAMILY PLANNING:\n"
    "  Modern CPR: >50% GREEN, 30-50% YELLOW, <30% RED\n"
    "  Unmet Need: <15% GREEN, 15-25% YELLOW, >25% RED\n"
    "  Method Mix Index: >0.5 GREEN, 0.3-0.5 YELLOW, <0.3 RED\n"
    "  Couple-Years of Protection: track trend (rising = GREEN, flat = YELLOW, falling = RED)\n\n"
    "SUPPLY CHAIN / COMMODITIES:\n"
    "  Stock-out Rate: <5% GREEN, 5-15% YELLOW, >15% RED\n"
    "  Months of Stock: 2-6 months GREEN, 1-2 or 6-9 months YELLOW, <1 or >9 months RED\n"
    "  Reporting Rate: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  Order Fill Rate: >90% GREEN, 75-90% YELLOW, <75% RED\n"
    "  Wastage Rate: <5% GREEN, 5-10% YELLOW, >10% RED\n\n"
    "DISEASE SURVEILLANCE (IDSR):\n"
    "  Completeness of Reporting: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Timeliness of Reporting: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Epidemic Threshold: below threshold GREEN, at threshold YELLOW, above threshold RED\n"
    "  Alert Response Time: <48hrs GREEN, 48-72hrs YELLOW, >72hrs RED\n\n"
    "WATER, SANITATION & HYGIENE (WASH):\n"
    "  Safe Water Access: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Improved Sanitation: >60% GREEN, 40-60% YELLOW, <40% RED\n"
    "  Handwashing Facilities: >60% GREEN, 40-60% YELLOW, <40% RED\n\n"
    "HEALTH WORKFORCE (HRH):\n"
    "  Staffing Level (vs. establishment): >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Health Worker Density (/10k pop): >23 GREEN, 15-23 YELLOW, <15 RED\n"
    "  Training Coverage: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Absenteeism Rate: <10% GREEN, 10-20% YELLOW, >20% RED\n\n"
    "DATA QUALITY:\n"
    "  Completeness: >90% GREEN, 80-90% YELLOW, <80% RED\n"
    "  Timeliness: >80% GREEN, 60-80% YELLOW, <60% RED\n"
    "  Consistency (year-over-year): within 33% GREEN, 33-50% deviation YELLOW, >50% RED\n"
    "  Outlier Rate: <5% GREEN, 5-10% YELLOW, >10% RED\n\n"
    "NCDs:\n"
    "  Hypertension Control (<140/90): >50% GREEN, 30-50% YELLOW, <30% RED\n"
    "  Diabetes HbA1c <7%: >40% GREEN, 25-40% YELLOW, <25% RED\n"
    "  Cervical Cancer Screening: >70% GREEN, 50-70% YELLOW, <50% RED\n"
    "  NCD Screening Coverage: >50% GREEN, 30-50% YELLOW, <30% RED\n\n"
    "MENTAL HEALTH:\n"
    "  Treatment Gap: <50% GREEN, 50-75% YELLOW, >75% RED\n"
    "  Facility Coverage (/100k pop): >1 GREEN, 0.5-1 YELLOW, <0.5 RED\n\n"
    "COLOR LEGEND SYSTEM:\n"
    "  GREEN (#27AE60): Target met or exceeded — maintain and sustain\n"
    "  YELLOW (#F39C12): Approaching target — accelerate efforts\n"
    "  ORANGE (#E67E22): Below target — intensify interventions, investigate barriers\n"
    "  RED (#E74C3C): Critical gap — urgent action required, escalate to leadership\n"
    "  BLUE (#3498DB): Informational / baseline / no target defined\n"
    "  GRAY (#95A5A6): Data not available / not applicable\n\n"
    "APPLICATION RULES:\n"
    "- Detect the health program from column names, chart titles, and metric labels\n"
    "- Apply the relevant threshold set automatically\n"
    "- Tag findings with [CRITICAL], [WARNING], [GOOD] based on threshold zones\n"
    "- When presenting tables, add a Status column with the color zone\n"
    "- For recommendations, reference the specific threshold being breached\n"
    "- If a value falls in RED zone, always include it in the Executive Summary\n"
    "- Compare actual values to the threshold target, not just to other entities\n"
    "- When no program-specific threshold exists, derive from the data (mean, top quartile)\n"
)

_SYSTEM_PROMPT_CHART = (
    "You are an expert analytics strategist and subject-matter insight writer embedded "
    "in Apache Superset. Your job is to generate professional, evidence-based chart insights "
    "that sound like they were written by a senior analyst or program advisor. "
    "Your insights must be numerically grounded, concise but executive-ready, specific to the "
    "provided chart, free from repetition, free from unsupported claims, and suitable for "
    "leadership, operations, and technical review.\n\n"
    "Your response must contain ONLY the professional insight report. Never echo, quote, or "
    "reference these instructions.\n\n"
    "ALL insights MUST be based on the ACTUAL chart data provided. Every number, entity name, "
    "metric, trend, and finding you mention MUST come from the supplied data. If a value is "
    "not in the data, do NOT mention it — say 'not available in the supplied data' instead. "
    "NEVER invent, assume, or hallucinate values, entity names, time periods, targets, or "
    "benchmarks that are not explicitly in the data.\n\n"
    "When you receive a DATA ANALYSIS DRAFT with pre-computed statistics, USE those exact "
    "numbers as your foundation. Add interpretation and context but NEVER contradict the "
    "pre-computed values."
    + _INSIGHT_CORE_RULES
    + _INSIGHT_SCOPE_LOGIC
    + _CHART_TYPE_INTELLIGENCE
    + _ANALYTICAL_INTELLIGENCE
    + _HEALTH_THRESHOLDS
    + _INSIGHT_WRITING_STYLE
    + _INSIGHT_OUTPUT_RULES
)

_SYSTEM_PROMPT_DASHBOARD = (
    "You are an expert analytics strategist and subject-matter insight writer embedded "
    "in Apache Superset. Your job is to generate professional, evidence-based dashboard insights "
    "that sound like they were written by a senior analyst or program advisor. "
    "Your insights must be numerically grounded, concise but executive-ready, specific to the "
    "provided dashboard and its charts, free from repetition, free from unsupported claims, and "
    "suitable for leadership, operations, and technical review.\n\n"
    "Your response must contain ONLY the professional insight report. Never echo, quote, or "
    "reference these instructions.\n\n"
    "ALL insights MUST be based on the ACTUAL dashboard data provided. Every number, chart name, "
    "entity name, metric, trend, and finding you mention MUST come from the supplied data. If a "
    "value is not in the data, do NOT mention it — say 'not available in the supplied data' instead. "
    "NEVER invent, assume, or hallucinate values, entity names, time periods, targets, or "
    "benchmarks that are not explicitly in the data.\n\n"
    "CROSS-CHART INTELLIGENCE:\n"
    "- Look for reinforcing signals across charts (two charts pointing to the same conclusion).\n"
    "- Look for contradictions (metric improving in one view, worsening in another).\n"
    "- Identify leading indicators that predict lagging outcomes.\n"
    "- Compute derived insights no single chart shows.\n"
    "- Rank findings by impact.\n\n"
    "When you receive a DATA ANALYSIS DRAFT with pre-computed statistics, USE those exact "
    "numbers as your foundation. Add interpretation and context but NEVER contradict the "
    "pre-computed values."
    + _INSIGHT_CORE_RULES
    + _INSIGHT_SCOPE_LOGIC
    + _CHART_TYPE_INTELLIGENCE
    + _ANALYTICAL_INTELLIGENCE
    + _HEALTH_THRESHOLDS
    + _INSIGHT_WRITING_STYLE
    + _INSIGHT_OUTPUT_RULES
)

_SYSTEM_PROMPT_SQL = (
    'You are Superset MART SQL assistant. Return JSON: {"sql","explanation","assumptions","follow_ups"}. '
    "One read-only SELECT. MART tables only. Include LIMIT. Use the given dialect."
)

_SYSTEM_PROMPT_CHART_GENERATE = (
    "You are Superset AI chart generator for health analytics MART datasets.\n"
    "You will receive one or more MART dataset schemas with columns, types, sample data, "
    "and a user request. Your job is to create the best possible Superset chart "
    "configurations that fulfill the user's request.\n\n"
    "IMPORTANT: Each chart MUST reference a specific dataset_id from the provided schemas.\n\n"
    "Return a JSON array of chart objects. Each chart object MUST have EXACTLY these fields:\n"
    '  {"slice_name": string, "viz_type": string, "dataset_id": int, '
    '"description": string, "alt_viz_types": [...], "params": {...}}\n\n'
    "RULES:\n"
    "1. slice_name: Professional, descriptive name "
    "(e.g. 'Malaria Test Positivity Rate by District')\n"
    "2. dataset_id: The integer ID of the MART dataset this chart should use. "
    "Pick the most appropriate dataset from the provided schemas.\n"
    "3. viz_type: The RECOMMENDED chart type. MUST be one of the supported types below.\n"
    "4. alt_viz_types: An array of 2-5 ALTERNATIVE chart types that could also "
    "visualize the same data. The user will choose from these. Include BOTH standard "
    "AND custom/specialized chart types where applicable. Each entry is an object:\n"
    '   {"viz_type": string, "label": string, "reason": string}\n'
    "   - label: Human-readable name (e.g. 'DHIS2 Map', 'Pie Chart')\n"
    "   - reason: One short sentence why this alternative fits (e.g. 'Better for "
    "geographic drill-down with OU hierarchy')\n"
    "   Always include the primary viz_type as the FIRST entry in alt_viz_types.\n"
    "   Always include at least one custom/specialized chart type when applicable.\n\n"
    "SUPPORTED CHART TYPES (use ONLY these exact viz_type keys):\n"
    "── Standard Charts ──\n"
    "   TIME SERIES: echarts_timeseries, echarts_timeseries_bar, echarts_timeseries_line, "
    "echarts_timeseries_scatter, echarts_area, echarts_timeseries_smooth, "
    "echarts_timeseries_step, mixed_timeseries, compare\n"
    "   CATEGORICAL: pie, funnel, treemap_v2, sunburst_v2, "
    "word_cloud, radar, rose\n"
    "   AGGREGATE: big_number_total, big_number, gauge_chart, bullet\n"
    "   TABLE: table, pivot_table_v2\n"
    "   STATISTICAL: box_plot, histogram_v2, bubble_v2\n"
    "   RELATIONSHIP: graph_chart, chord, sankey_v2, partition\n"
    "   TEMPORAL: cal_heatmap, gantt_chart, horizon, time_pivot, time_table\n"
    "   MAP: dhis2_map, vital_maps\n"
    "   OTHER: waterfall, heatmap_v2, tree_chart, handlebars, cartodiagram\n\n"
    "── Custom/Specialized Charts (PREFER these for health analytics) ──\n"
    "   dhis2_map: DHIS2 choropleth map with org unit boundaries and drill-down. "
    "PREFERRED for ANY geographic/OU visualization.\n"
    "   vital_maps: General-purpose thematic map (choropleth/point/bubble/heatmap layers). "
    "Use when data has lat/lon coordinates.\n"
    "   summary: High-density multi-indicator block with sparklines, progress bars, "
    "threshold coloring. Ideal for dashboard overview panels.\n"
    "   comparison_kpi: Single indicator vs target/baseline with delta, percentage change, "
    "and health-metric logic inversion. Use for target tracking.\n"
    "   marquee_kpi: Scrolling ticker of KPI cards. Great for headline metrics "
    "on executive dashboards and public displays.\n"
    "   control_chart: Statistical process control / epidemic channel chart. "
    "Use for anomaly detection, outbreak surveillance, Mean±SD thresholds.\n"
    "   ranked_variance: Compare entity performance vs targets with deviation bars. "
    "Shows On Track / Lagging / Critical color banding.\n"
    "   cohort_cascade: Patient progression through sequential care stages with "
    "auto-calculated retention/drop-off. Use for care cascades (90-90-90, treatment).\n"
    "   small_multiples: Grid of synchronized mini-charts for comparing trends across "
    "many categories. DHIS2-aware with auto OU/period splitting.\n"
    "   stock_status: Supply chain commodity tracker. Auto-calculates Months of Stock "
    "with Understock/Optimal/Overstock banding.\n"
    "   age_sex_pyramid: Mirrored horizontal bar chart for demographic distribution "
    "by age group and sex/gender.\n"
    "   violin_distribution: Kernel density violin plots for analyzing variance "
    "and distribution across groups.\n"
    "   slideshow: Rotating KPI slideshow for cycling through metrics. "
    "Ideal for welcome screens and public displays.\n\n"
    "   IMPORTANT: For MAP visualizations, ALWAYS prefer dhis2_map when data has "
    "OU/orgunit/district columns. NEVER use country_map.\n"
    "   IMPORTANT: Use ONLY the exact viz_type keys listed above. "
    "NEVER use these legacy/wrong keys: dist_bar, bar, line, area, scatter, bubble, "
    "treemap, sunburst, sankey, heatmap, histogram, echarts_funnel, echarts_graph, "
    "echarts_gauge, echarts_gantt, echarts_radar, echarts_heatmap, echarts_tree, "
    "country_map, world_map, dual_line, pivot_table, calendar, ag_grid. "
    "The correct keys all have specific suffixes like _v2, _chart, etc.\n"
    "   IMPORTANT: Always include custom chart types in alt_viz_types where the data "
    "fits. For example, if creating a KPI card, include summary, comparison_kpi, "
    "and marquee_kpi as alternatives. If showing geographic data, include dhis2_map "
    "and small_multiples as alternatives.\n\n"
    "4. description: One sentence explaining what the chart shows and why it matters.\n"
    "5. params: A valid Superset form_data JSON object. MUST contain:\n"
    "   - datasource: '<dataset_id>__table' (use the chart's dataset_id)\n"
    "   - viz_type: same as the chart's viz_type\n"
    "   - metrics: array of metric objects. Use simple aggregates:\n"
    '     {"expressionType":"SIMPLE","column":{"column_name":"<col>"},'
    '"aggregate":"<AGG>","label":"<Label>"}\n'
    "     AGG options: SUM, AVG, COUNT, MIN, MAX, COUNT_DISTINCT\n"
    "   - groupby: array of column name strings for categorical grouping\n"
    "   - columns: array of column name strings (for table/pivot viz)\n"
    "   - time_range: 'No filter' or 'Last year' or 'Last quarter' etc.\n"
    "   - row_limit: integer (50-1000)\n"
    "   - granularity_sqla: a date/time column name if time-series, else null\n"
    "   - x_axis: column name for x-axis on time-series charts\n"
    "   - order_desc: true/false\n"
    "   - adhoc_filters: [] (empty array)\n"
    "   - slice_id: 0\n"
    "6. Use diverse viz_type values. Maximize visual variety.\n\n"
    ""
    "PROFESSIONAL STYLING AND THEMING:\n"
    "Every chart MUST be professionally styled. Include ALL relevant styling params:\n"
    "- color_scheme: Choose contextually meaningful color schemes:\n"
    "  * 'supersetColors' — default multi-color palette for diverse categories\n"
    "  * 'bnbColors' — warm tones, good for positive indicators\n"
    "  * 'googleCategory20c' — muted professional palette for reports\n"
    "  * 'lyftColors' — vibrant, high-contrast palette for presentations\n"
    "- number_format: Format numbers professionally:\n"
    "  * ',.0f' for whole numbers (cases, counts, tests)\n"
    "  * ',.1f' for one decimal place\n"
    "  * ',.2f' for precise decimals\n"
    "  * ',.0%' for percentages (rates, positivity)\n"
    "  * '.2s' for abbreviated large numbers (1.2M, 350K)\n"
    "- currency_format: null (use number_format instead)\n"
    "- y_axis_format: same format as number_format (for axis readability)\n"
    "- x_axis_time_format: '%b %Y' for monthly, '%Y' for yearly, "
    "'%d %b %Y' for daily\n\n"
    "TIME SERIES STYLING (echarts_timeseries*, echarts_area):\n"
    "- show_legend: true\n"
    "- legendType: 'scroll' (for many series) or 'plain'\n"
    "- legendOrientation: 'top'\n"
    "- rich_tooltip: true\n"
    "- tooltipTimeFormat: '%b %d, %Y'\n"
    "- show_value: false (keep chart clean; true only for sparse data)\n"
    "- x_axis_title: descriptive label (e.g. 'Reporting Period')\n"
    "- x_axis_title_margin: 30\n"
    "- y_axis_title: descriptive label (e.g. 'Number of Cases')\n"
    "- y_axis_title_margin: 40\n"
    "- y_axis_title_position: 'Left'\n"
    "- truncateYAxis: false\n"
    "- zoomable: true (enables chart zoom)\n"
    "- markerEnabled: true (shows data point markers)\n"
    "- markerSize: 6\n"
    "- opacity: 0.2 (for area charts fill)\n"
    "- seriesType: 'line' (or 'bar', 'scatter', 'smooth', 'step')\n"
    "- stack: false (true for stacked area/bar charts)\n"
    "- only_total: false (true to show only total label on stacked)\n"
    "- percentageThreshold: 0\n"
    "- orientation: 'vertical'\n\n"
    "BAR CHART STYLING (echarts_timeseries_bar):\n"
    "- show_legend: true\n"
    "- show_bar_value: true (show values on bars)\n"
    "- bar_stacked: false (true for stacked bars)\n"
    "- order_bars: true\n"
    "- reduce_x_ticks: true (avoid overlapping labels)\n"
    "- y_axis_format: matching the metric type\n\n"
    "PIE/DONUT STYLING (pie):\n"
    "- show_legend: true\n"
    "- show_labels: true\n"
    "- label_type: 'key_percent' (show name + percentage)\n"
    "- number_format: ',.0f'\n"
    "- donut: true (modern donut style preferred)\n"
    "- show_labels_threshold: 5 (hide labels below 5%)\n"
    "- outerRadius: 80\n"
    "- innerRadius: 40 (for donut)\n"
    "- legendOrientation: 'right'\n\n"
    "BIG NUMBER STYLING (big_number_total, big_number):\n"
    "- header_font_size: 0.4 (relative size)\n"
    "- subheader_font_size: 0.15\n"
    "- y_axis_format: appropriate format for the metric\n"
    "- time_grain_sqla: 'P1M' for monthly, 'P1W' for weekly trend\n"
    "- For big_number (with trendline), also set granularity_sqla and "
    "time_range: 'Last year'\n\n"
    "TABLE STYLING (table, ag_grid):\n"
    "- page_length: 25\n"
    "- include_search: true\n"
    "- table_timestamp_format: '%Y-%m-%d'\n"
    "- order_desc: true\n"
    "- show_cell_bars: true (visual bar indicators in cells)\n"
    "- color_pn: true (color positive/negative values)\n\n"
    "PIVOT TABLE STYLING (pivot_table_v2):\n"
    "- aggregateFunction: 'Sum' (or 'Average', 'Count')\n"
    "- transposePivot: false\n"
    "- combineMetric: false\n"
    "- rowTotals: true\n"
    "- colTotals: true\n"
    "- valueFormat: matching number_format\n\n"
    "DHIS2 MAP STYLING (dhis2_map):\n"
    "- org_unit_column: the OU/orgunit/district column name\n"
    "- metric: the value metric (same format as metrics[0])\n"
    "- aggregation_method: 'sum' or 'average' or 'latest'\n"
    "- boundary_levels: [1, 2] (org unit levels to display)\n"
    "- use_linear_color_scheme: true\n"
    "- linear_color_scheme: 'superset_seq_1' or 'oranges'\n"
    "- legend_type: 'auto'\n"
    "- opacity: 0.8\n"
    "- show_labels: true\n"
    "- label_type: 'name_value'\n"
    "- show_legend: true\n"
    "- legend_position: 'bottomright'\n"
    "- enable_drill: true (enable drill-down navigation)\n"
    "- stroke_width: 1\n"
    "- show_all_boundaries: true\n"
    "NOTE: dhis2_map does NOT use 'metrics' array — it uses a single 'metric' field.\n"
    "NOTE: dhis2_map does NOT use 'groupby' — geographic grouping is via org_unit_column.\n\n"
    "GAUGE STYLING (gauge_chart):\n"
    "- min_val: 0\n"
    "- max_val: 100 (for percentages) or appropriate max\n"
    "- show_pointer: true\n"
    "- number_format: ',.1f'\n"
    "- start_angle: 225\n"
    "- end_angle: -45\n"
    "- font_size: 15\n\n"
    ""
    "COLUMN MAPPING AND DISAGGREGATION RULES:\n"
    "Carefully examine column names, types, and sample data to determine the correct "
    "role for each column:\n"
    "- DATE/TIME columns (period, date, month, year, quarter, periodid, reporting_date, "
    "  created, updated, timestamp): Use as granularity_sqla and x_axis for time-series.\n"
    "- GEOGRAPHIC/OU columns (district, region, facility, orgunit, ou, organisationunit, "
    "  organisation_unit, org_unit_name, province, county, subcounty, ward, village): "
    "  Use in groupby for geographic breakdowns. Use as org_unit_column for dhis2_map.\n"
    "- DISAGGREGATION columns (age_group, sex, gender, category, categoryoptioncombo, "
    "  attributeoptioncombo, disaggregation, classification, type, status, outcome, "
    "  severity, method): Use in groupby for demographic/categorical breakdowns. "
    "  These are CRITICAL for health analytics — always look for them.\n"
    "- VALUE/MEASURE columns (value, numerator, denominator, count, total, cases, tests, "
    "  positive, negative, confirmed, suspected, rate, percentage, ratio, score, target, "
    "  actual, stock, consumed, received, dispensed): Use as metric columns with "
    "  appropriate aggregation (SUM for counts, AVG for rates/percentages).\n"
    "- IDENTIFIER columns (id, uid, code, dataelement, dataelement_name, indicator, "
    "  indicator_name, dataset, data_element_id): Use in groupby when charting by "
    "  data element or indicator. Use in 'columns' for table views.\n\n"
    "CHART-TYPE SPECIFIC RULES:\n"
    "7. For time-series charts, ALWAYS set granularity_sqla and x_axis to a date column.\n"
    "8. For big_number_total, use exactly one metric (SUM or COUNT), no groupby.\n"
    "9. For pie charts, use exactly one metric and one groupby (use a disaggregation "
    "   or geographic column).\n"
    "10. For echarts_timeseries_bar, use one metric and one groupby. For stacked bars, use "
    "   groupby=[geographic_col] and add a 'series' field with a disaggregation column.\n"
    "11. For tables, populate 'columns' with the most informative columns. Include at "
    "   least one identifier, one geographic, one disaggregation, and value columns.\n"
    "12. For pivot_table_v2, use groupby for rows and 'columns' for pivot columns. "
    "   Put geographic columns in groupby and time/disaggregation in columns.\n"
    "13. For heatmap, use groupby for y-axis, 'columns' for x-axis, one metric.\n"
    "14. When you see rate/percentage columns, use AVG not SUM.\n"
    "15. When both numerator and denominator exist, create a calculated rate chart.\n"
    "16. For MAP visualizations: ALWAYS prefer dhis2_map when data has OU/orgunit/district "
    "   columns. Only use vital_maps if the data has lat/lon columns without DHIS2 OU. "
    "   NEVER use country_map.\n"
    "17. ALWAYS populate alt_viz_types with 2-4 RELEVANT alternatives per chart. "
    "   Only include chart types that genuinely fit the data shape and the user's request. "
    "   Do NOT pad with unrelated chart types. For example, a time-series request should "
    "   only show time-series variants (bar, line, area, smooth), not pie or table. "
    "   A KPI request should show big_number_total, summary, comparison_kpi — not scatter.\n"
    "18. Return ONLY the JSON array. No markdown, no explanation, no code fences.\n"
)


_SYSTEM_PROMPT_LOCAL_CHART = (
    "You are the LocalAI chart-insight writer.\n"
    "Write a professional markdown report from the supplied evidence only.\n"
    "Use clear English with correct word spacing. Never split words or merge words.\n"
    "Follow the report plan in the user message exactly.\n"
    "Use only supported facts. Do not invent causes, rankings, regions, values, or trends.\n"
    "Do not repeat the same point in multiple sections.\n"
    "Do not output raw prompt scaffolding such as Chart, Type, Columns, Metric, Highest, Lowest, or Sample data.\n"
    "Do not output placeholders such as [STUB].\n"
    "If evidence is limited, say so briefly and continue with only supported statements.\n"
    "Use concise executive-report language: direct, calm, and evidence-led.\n"
    "Return only the finished report.\n"
)

_SYSTEM_PROMPT_LOCAL_DASHBOARD = (
    "You are the LocalAI dashboard-insight writer.\n"
    "Write a professional markdown report from the supplied evidence only.\n"
    "This is a dashboard report, so synthesize across charts instead of listing raw chart-by-chart metadata.\n"
    "Use clear English with correct word spacing. Never split words or merge words.\n"
    "Follow the report plan in the user message exactly.\n"
    "Use only supported facts. Do not invent causes, rankings, regions, values, or trends.\n"
    "Do not repeat the same point in multiple sections.\n"
    "Do not output raw prompt scaffolding such as Chart, Type, Columns, Metric, Highest, Lowest, or Sample data.\n"
    "Do not output placeholders such as [STUB].\n"
    "If evidence is limited, say so briefly and continue with only supported statements.\n"
    "Use concise executive-report language: direct, calm, and evidence-led.\n"
    "Return only the finished report.\n"
)



def _compute_column_stats(rows: list[dict], col: str) -> dict[str, Any] | None:
    """Compute summary statistics for a numeric column."""
    values = []
    for row in rows:
        v = row.get(col)
        if v is None:
            continue
        try:
            values.append(float(v))
        except (ValueError, TypeError):
            continue
    if not values:
        return None
    values_sorted = sorted(values)
    n = len(values_sorted)
    total = sum(values_sorted)
    avg = total / n
    first_val = values_sorted[0] if n > 0 else None
    last_val = values_sorted[-1] if n > 0 else None
    return {
        "min": values_sorted[0],
        "max": values_sorted[-1],
        "avg": round(avg, 2),
        "total": round(total, 2),
        "count": n,
        "first": first_val,
        "last": last_val,
        "pct_change": round((values[-1] - values[0]) / values[0] * 100, 1) if values[0] != 0 else None,
        "trend": "Rising" if values[-1] > values[0] * 1.02 else "Falling" if values[-1] < values[0] * 0.98 else "Stable",
    }


def _format_number(v: float) -> str:
    """Format a number for display: 1234567 → 1,234,567 or 45.3 → 45.3."""
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    if v == int(v):
        return str(int(v))
    return f"{v:.1f}"


def _is_trivial_data(rows: list[dict]) -> bool:
    """Return True if chart data is trivially empty or placeholder.

    Charts with trivially empty data should be skipped — they add noise
    and cause the model to fabricate insights from empty data.

    Detected patterns:
    - No rows at all
    - All numeric values are 0 and all labels are Unknown/empty
    - Single row with label 'Unknown' and all numeric values <= 1 (placeholder)
    """
    if not rows or not isinstance(rows[0], dict):
        return True

    has_meaningful_numeric = False
    has_meaningful_label = False
    for row in rows:
        for v in row.values():
            if v is None:
                continue
            try:
                if float(v) != 0:
                    has_meaningful_numeric = True
            except (ValueError, TypeError):
                sv = str(v).strip().lower()
                if sv and sv not in ("unknown", "0", ""):
                    has_meaningful_label = True

    # All values are zero and all labels are Unknown/empty
    if not has_meaningful_numeric and not has_meaningful_label:
        return True

    # Very sparse placeholder rows such as region=Unknown, population=1
    # or region=Unknown with all zeros do not provide analytical value.
    if len(rows) <= 2 and not has_meaningful_label:
        all_small = True
        for row in rows:
            for v in row.values():
                if v is None:
                    continue
                try:
                    if abs(float(v)) > 1:
                        all_small = False
                        break
                except (ValueError, TypeError):
                    pass
            if not all_small:
                break
        if all_small:
            return True

    return False


def _looks_like_percent_metric_name(name: str) -> bool:
    lower = str(name or "").lower()
    return any(
        token in lower
        for token in (
            "rate",
            "percent",
            "percentage",
            "coverage",
            "positivity",
            "contribution",
            "proportion",
            "share",
            "ratio",
        )
    )


def _format_metric_value(value: float, metric_name: str = "") -> str:
    if _looks_like_percent_metric_name(metric_name):
        if 0 <= value <= 1:
            return f"{value * 100:.1f}%"
        return f"{value:.1f}%"
    return _format_number(value)


def _build_analytics_text(
    rows: list[dict],
    columns: list[str],
    label_col: str | None = None,
) -> list[str]:
    """Pre-compute analytics from data rows for the local model.

    Returns lines of pre-digested insights like:
      Metric: malaria_cases — min=277,602, max=434,485, avg=363,717, change=+56.5% (Rising)
      Top: District A (434,485), District B (414,593), District C (408,714)
      Bottom: District X (277,602), District Y (313,377), District Z (320,985)
    """
    if not rows:
        return []
    lines: list[str] = []

    def _clean_metric_name(col: str) -> str:
        name = str(col or "").replace("_", " ").strip()
        name = re.sub(r"\s+", " ", name)
        return name or str(col or "")

    # Identify numeric vs label columns
    numeric_cols = []
    for col in columns:
        sample_vals = [row.get(col) for row in rows[:5] if row.get(col) is not None]
        if sample_vals:
            try:
                [float(v) for v in sample_vals]
                numeric_cols.append(col)
            except (ValueError, TypeError):
                pass

    # Auto-detect label column if not provided
    if not label_col:
        for col in columns:
            if col not in numeric_cols:
                label_col = col
                break

    # Compute stats for each numeric column
    for col in numeric_cols[:6]:  # limit to 6 metrics
        stats = _compute_column_stats(rows, col)
        if not stats:
            continue
        metric_name = _clean_metric_name(col)

        change_str = ""
        if stats["pct_change"] is not None:
            sign = "+" if stats["pct_change"] > 0 else ""
            change_str = f", change={sign}{stats['pct_change']}% ({stats['trend']})"

        lines.append(
            f"  Metric '{metric_name}': "
            f"min={_format_metric_value(stats['min'], metric_name)}, "
            f"max={_format_metric_value(stats['max'], metric_name)}, "
            f"avg={_format_metric_value(stats['avg'], metric_name)}, "
            f"total={_format_metric_value(stats['total'], metric_name)}"
            f"{change_str}"
        )

        # Top and bottom entities (if we have a label column)
        if label_col:
            sorted_rows = sorted(
                [r for r in rows if r.get(col) is not None],
                key=lambda r: float(r.get(col, 0)),
                reverse=True,
            )
            top3 = sorted_rows[:3]
            bottom3 = sorted_rows[-3:] if len(sorted_rows) > 3 else []

            if top3:
                top_str = ", ".join(
                    f"{r.get(label_col, '?')} ({_format_metric_value(float(r[col]), metric_name)})"
                    for r in top3
                )
                lines.append(f"    Highest: {top_str}")
            if bottom3:
                bot_str = ", ".join(
                    f"{r.get(label_col, '?')} ({_format_metric_value(float(r[col]), metric_name)})"
                    for r in bottom3
                )
                lines.append(f"    Lowest: {bot_str}")

    return lines


def _context_to_plain_text(context_payload: dict[str, Any]) -> str:
    """Convert context dict to plain text with pre-computed analytics.

    Pre-computes summary statistics (averages, trends, top/bottom entities) and
    presents them alongside sample data. Used by _build_analysis_draft() to
    provide all providers with grounded, real-number foundations.
    """
    parts: list[str] = []

    def _normalize_viz_type(viz: str) -> str:
        value = str(viz or "").strip()
        if not value or value.lower() == "unknown":
            return "chart"
        return value

    def _clean_col_name(name: str) -> str:
        value = str(name or "").replace("_", " ").strip()
        value = re.sub(r"\s+", " ", value)
        return value

    # Dashboard info
    dash = context_payload.get("dashboard")
    if isinstance(dash, dict):
        name = dash.get("dashboard_title") or dash.get("name") or ""
        if name:
            parts.append(f"Dashboard: {name}")

    # Chart info — single chart mode
    chart_info = context_payload.get("chart")
    if isinstance(chart_info, dict):
        name = chart_info.get("slice_name") or chart_info.get("name") or ""
        viz = _normalize_viz_type(chart_info.get("viz_type") or "")
        if name:
            parts.append(f"Chart: {name} (type: {viz})")

    # Datasource — single chart mode
    ds = context_payload.get("datasource")
    if isinstance(ds, dict):
        table = ds.get("table_name")
        if table:
            parts.append(f"Data source: {table}")

    # Query result — single chart mode (with pre-computed analytics)
    qr = context_payload.get("query_result")
    if isinstance(qr, dict):
        columns = qr.get("columns") or []
        rows = qr.get("sample_rows") or qr.get("data") or []
        row_count = qr.get("row_count") or len(rows)
        if _is_trivial_data(rows):
            parts.append(
                "Data notice: this chart contains only sparse or unknown values, "
                "so no reliable analytical insight can be drawn from it."
            )
            return "\n".join(parts)
        if columns:
            parts.append(f"Columns: {', '.join(_clean_col_name(str(c)) for c in columns[:15])}")
        if row_count:
            parts.append(f"Total rows: {row_count}")

        # Pre-computed analytics
        if rows and isinstance(rows[0], dict):
            col_names = list(rows[0].keys()) if not columns else columns
            analytics = _build_analytics_text(rows, col_names)
            if analytics:
                parts.append("Pre-computed analytics:")
                parts.extend(analytics)

        # Also show a few sample rows for context
        if rows:
            parts.append(f"Sample data ({min(len(rows), 5)} rows):")
            for j, row in enumerate(rows[:5]):
                items = []
                for k, v in (row.items() if isinstance(row, dict) else []):
                    if v is not None and str(v).strip():
                        if isinstance(v, float):
                            items.append(f"{_clean_col_name(k)}={_format_number(v)}")
                        else:
                            items.append(f"{_clean_col_name(k)}={v}")
                if items:
                    parts.append(f"  Row {j + 1}: {', '.join(items[:12])}")

    # Charts array — dashboard mode
    charts = context_payload.get("charts") or []
    charts_with_data = 0
    for i, chart_entry in enumerate(charts[:8], 1):
        c = chart_entry.get("chart") or {}
        name = c.get("name") or c.get("slice_name") or f"Chart {i}"
        viz = _normalize_viz_type(c.get("viz_type") or "")

        # Query result data with pre-computed analytics
        qr = chart_entry.get("query_result") or {}
        columns = qr.get("columns") or []
        rows = qr.get("sample_rows") or []
        row_count = qr.get("row_count") or len(rows)

        # Skip charts with trivially empty data
        if _is_trivial_data(rows):
            logger.info(
                "Skipping empty chart '%s' in context — all values zero/unknown",
                name,
            )
            continue

        charts_with_data += 1
        parts.append("")
        parts.append(f"Chart {i}: {name}")
        parts.append(f"Type: {viz}")

        # Datasource info
        ds = chart_entry.get("datasource") or {}
        table = ds.get("table_name")
        if table:
            parts.append(f"Data source: {table}")

        if columns:
            parts.append(f"Columns: {', '.join(_clean_col_name(str(c)) for c in columns[:12])}")
        if row_count:
            parts.append(f"Total rows: {row_count}")

        # Pre-computed analytics for this chart
        if rows and isinstance(rows[0], dict):
            col_names = list(rows[0].keys()) if not columns else columns
            analytics = _build_analytics_text(rows, col_names)
            if analytics:
                parts.append("Pre-computed analytics:")
                parts.extend(analytics)

        # Show sample rows (limited)
        if rows:
            parts.append(f"Sample data ({min(len(rows), 3)} rows):")
            for j, row in enumerate(rows[:3]):
                items = []
                for k, v in (row.items() if isinstance(row, dict) else []):
                    if v is not None and str(v).strip():
                        if isinstance(v, float):
                            items.append(f"{_clean_col_name(k)}={_format_number(v)}")
                        else:
                            items.append(f"{_clean_col_name(k)}={v}")
                if items:
                    parts.append(f"  Row {j + 1}: {', '.join(items[:10])}")

        # Summary statistics if available
        stats = qr.get("statistics") or qr.get("summary")
        if isinstance(stats, dict):
            parts.append(f"Statistics: {stats}")

    if charts and charts_with_data == 0:
        parts.append(
            "\nDATA NOTICE: All charts in this dashboard have empty or zero-value "
            "data. No meaningful analysis is possible. Report that the data is "
            "insufficient and recommend verifying data sources."
        )

    # Filters
    filters = context_payload.get("applied_filters") or context_payload.get("filters")
    if filters:
        parts.append(f"\nActive filters: {json.dumps(filters, default=str)[:300]}")

    return "\n".join(parts)


def _build_localai_evidence_digest(
    context_payload: dict[str, Any],
    mode: str,
) -> str:
    """Build a compact evidence digest for LocalAI without raw prompt scaffolding."""
    parts: list[str] = []
    config = get_ai_insights_config()

    def _clean_name(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "").replace("_", " ")).strip()

    def _append_chart_evidence(
        *,
        chart_name: str,
        rows: list[dict[str, Any]],
        columns: list[str],
        row_count: int | None = None,
    ) -> None:
        if _is_trivial_data(rows):
            return
        col_names = columns or (list(rows[0].keys()) if rows and isinstance(rows[0], dict) else [])
        analytics = _build_analytics_text(rows, col_names)
        if not analytics:
            return
        parts.append(f"- {chart_name}:")
        if row_count:
            parts.append(f"  - Rows analysed: {row_count}")
        for line in analytics[:3]:
            compact = re.sub(r"\s+", " ", line).strip()
            compact = compact.replace("Metric '", "").replace("':", ":")
            parts.append(f"  - {compact}")

    if mode == AI_MODE_CHART:
        chart = context_payload.get("chart") or {}
        chart_name = chart.get("slice_name") or chart.get("name") or "Chart"
        qr = context_payload.get("query_result") or {}
        rows = qr.get("sample_rows") or qr.get("data") or []
        columns = qr.get("columns") or []
        row_count = qr.get("row_count") or len(rows)
        parts.append(f"Chart: {_clean_name(chart_name)}")
        _append_chart_evidence(
            chart_name="Key evidence",
            rows=rows,
            columns=columns,
            row_count=row_count,
        )
    else:
        dashboard = context_payload.get("dashboard") or {}
        dash_name = dashboard.get("dashboard_title") or dashboard.get("name") or "Dashboard"
        parts.append(f"Dashboard: {_clean_name(dash_name)}")
        total_charts = len(context_payload.get("charts") or [])
        meaningful_charts = _count_meaningful_dashboard_charts(context_payload)
        parts.append(
            f"Dashboard coverage: {meaningful_charts} of {total_charts} charts contain analyzable quantitative evidence."
        )
        parts.append("Cross-chart evidence:")
        included = 0
        chart_budget = int(config.get("max_dashboard_charts") or 12)
        for chart_entry in (context_payload.get("charts") or [])[:chart_budget]:
            chart = chart_entry.get("chart") or {}
            chart_name = chart.get("name") or chart.get("slice_name") or f"Chart {included + 1}"
            qr = chart_entry.get("query_result") or {}
            rows = qr.get("sample_rows") or qr.get("data") or []
            columns = qr.get("columns") or []
            row_count = qr.get("row_count") or len(rows)
            before = len(parts)
            _append_chart_evidence(
                chart_name=_clean_name(chart_name),
                rows=rows,
                columns=columns,
                row_count=row_count,
            )
            if len(parts) > before:
                included += 1
        if included == 0:
            parts.append("- No charts contained enough non-placeholder data for reliable analysis.")
        else:
            parts.append(
                f"Cross-chart coverage note: include patterns from all {included} charts with usable evidence, not only the first few."
            )

    filters = context_payload.get("applied_filters") or context_payload.get("filters")
    if isinstance(filters, dict):
        active_filter_keys = [
            str(key)
            for key, value in filters.items()
            if value not in (None, "", [], {}, ())
        ][:6]
        if active_filter_keys:
            parts.append(f"Active filters: {', '.join(active_filter_keys)}")

    return "\n".join(parts).strip()


def _build_analysis_draft(context_payload: dict[str, Any], mode: str) -> str:
    """Build a pre-written analysis draft with REAL numbers from the data.

    The 8B local model cannot extract numbers from raw data or compute analytics.
    This function builds the entire report skeleton using Python, with actual values
    from the Superset chart/dashboard data. The model only needs to expand it into
    professional prose.
    """

    def _extract_rows_and_columns(qr: dict) -> tuple[list[dict], list[str]]:
        rows = qr.get("sample_rows") or qr.get("data") or []
        columns = qr.get("columns") or (list(rows[0].keys()) if rows and isinstance(rows[0], dict) else [])
        return rows, columns

    _PERIOD_COL_NAMES = {
        "period", "periodid", "period_id", "date", "month", "year",
        "quarter", "week", "day", "fiscal_year", "financial_year",
        "reporting_period", "time", "timestamp", "created", "updated",
    }

    _PERIOD_PATTERN = re.compile(
        r"^("
        r"\d{4}[01]\d"           # 202503 (YYYYMM)
        r"|\d{4}-[01]\d"         # 2025-03
        r"|\d{4}Q[1-4]"          # 2025Q1
        r"|\d{4}W\d{1,2}"        # 2025W12
        r"|\d{4}-\d{2}-\d{2}"    # 2025-03-15
        r")$",
        re.IGNORECASE,
    )

    def _is_period_column(col_name: str, sample_vals: list) -> bool:
        """Detect columns that represent dates/periods, not metrics."""
        if col_name.lower().replace(" ", "_") in _PERIOD_COL_NAMES:
            return True
        str_vals = [str(v) for v in sample_vals[:5]]
        if str_vals and all(_PERIOD_PATTERN.match(sv) for sv in str_vals):
            return True
        return False

    def _classify_columns(rows: list[dict], columns: list[str]) -> tuple[list[str], list[str]]:
        """Split columns into numeric and label columns."""
        numeric, labels = [], []
        for col in columns:
            vals = [row.get(col) for row in rows[:5] if row.get(col) is not None]
            if vals:
                if _is_period_column(col, vals):
                    labels.append(col)
                    continue
                try:
                    [float(v) for v in vals]
                    numeric.append(col)
                except (ValueError, TypeError):
                    labels.append(col)
            else:
                labels.append(col)
        return numeric, labels

    def _build_perf_table(rows: list[dict], numeric_cols: list[str], label_col: str | None) -> str:
        """Build the Performance Overview markdown table."""
        table_lines = [
            "| Indicator | Current Value | Trend | Status |",
            "|-----------|---------------|-------|--------|",
        ]
        for col in numeric_cols[:8]:
            stats = _compute_column_stats(rows, col)
            if not stats:
                continue
            trend = stats.get("trend", "Stable")
            avg_val = _format_number(stats["avg"])
            # Simple threshold classification
            name = col.replace("_", " ").title()
            status = "[INFO]"
            table_lines.append(f"| {name} | {avg_val} | {trend} | {status} |")
        return "\n".join(table_lines) if len(table_lines) > 2 else ""

    def _build_findings(rows: list[dict], numeric_cols: list[str], label_col: str | None) -> str:
        """Build detailed findings from computed stats."""
        findings = []
        for col in numeric_cols[:6]:
            stats = _compute_column_stats(rows, col)
            if not stats:
                continue
            name = col.replace("_", " ").title()
            avg_s = _format_number(stats["avg"])
            min_s = _format_number(stats["min"])
            max_s = _format_number(stats["max"])
            total_s = _format_number(stats["total"])

            # Trend finding
            if stats["pct_change"] is not None:
                sign = "+" if stats["pct_change"] > 0 else ""
                findings.append(
                    f"- {name}: **{sign}{stats['pct_change']}%** change ({stats['trend']}). "
                    f"Range: **{min_s}** to **{max_s}**. "
                    f"Average: **{avg_s}**, total: **{total_s}**."
                )

            # Top/bottom entities
            if label_col:
                sorted_rows = sorted(
                    [r for r in rows if r.get(col) is not None],
                    key=lambda r: float(r.get(col, 0)),
                    reverse=True,
                )
                if len(sorted_rows) >= 2:
                    top = sorted_rows[0]
                    bottom = sorted_rows[-1]
                    top_name = top.get(label_col, "?")
                    top_val = _format_number(float(top.get(col, 0)))
                    bot_name = bottom.get(label_col, "?")
                    bot_val = _format_number(float(bottom.get(col, 0)))
                    gap = float(top.get(col, 0)) - float(bottom.get(col, 0))
                    findings.append(
                        f"- Highest {name}: **{top_name}** at **{top_val}**. "
                        f"Lowest: **{bot_name}** at **{bot_val}**. "
                        f"Gap: **{_format_number(gap)}**."
                    )
        return "\n".join(findings)

    # ── Build the draft ──
    draft_parts: list[str] = []

    # Determine chart name / dashboard title
    chart_info = context_payload.get("chart") or {}
    chart_name = chart_info.get("slice_name") or chart_info.get("name") or ""
    dash_info = context_payload.get("dashboard") or {}
    dash_name = dash_info.get("dashboard_title") or dash_info.get("name") or ""
    title = dash_name or chart_name or "Data Analysis"

    if mode == "chart":
        # ── Single chart mode ──
        qr = context_payload.get("query_result") or {}
        rows, columns = _extract_rows_and_columns(qr)
        if not rows:
            return f"Chart: {chart_name}\nNo data rows available for analysis."

        numeric_cols, label_cols = _classify_columns(rows, columns)
        label_col = label_cols[0] if label_cols else None

        draft_parts.append(f"Chart: {chart_name}")
        draft_parts.append(f"Data: {len(rows)} rows, columns: {', '.join(columns[:10])}")
        draft_parts.append("")

        # Section 1: Executive Summary bullets
        draft_parts.append("## Executive Summary")
        draft_parts.append(f"Expand these facts about **{chart_name}** into 3-5 professional bullets:")
        for col in numeric_cols[:4]:
            stats = _compute_column_stats(rows, col)
            if stats and stats["pct_change"] is not None:
                sign = "+" if stats["pct_change"] > 0 else ""
                name = col.replace("_", " ").title()
                draft_parts.append(
                    f"- {name}: average **{_format_number(stats['avg'])}**, "
                    f"changed **{sign}{stats['pct_change']}%** ({stats['trend']})"
                )
        draft_parts.append("")

        # Section 2: Performance Overview table
        perf_table = _build_perf_table(rows, numeric_cols, label_col)
        if perf_table:
            draft_parts.append("## Performance Overview")
            draft_parts.append(perf_table)
            draft_parts.append("")

        # Section 3: Detailed Analysis
        findings = _build_findings(rows, numeric_cols, label_col)
        if findings:
            draft_parts.append("## Detailed Analysis")
            draft_parts.append("Expand each finding into a professional insight paragraph:")
            draft_parts.append(findings)
            draft_parts.append("")

        # Section 4: Risk and Issue Analysis
        draft_parts.append("## Risk and Issue Analysis")
        draft_parts.append("Based on the findings above, identify 3-5 risks. Use the actual numbers.")
        draft_parts.append("")

        # Section 5: Action Recommendations
        draft_parts.append("## Action Recommendations")
        draft_parts.append("Write 5-6 specific recommendations citing the numbers above.")
        draft_parts.append("")

    else:
        # ── Dashboard mode ──
        charts = context_payload.get("charts") or []
        draft_parts.append(f"Dashboard: {dash_name}")
        draft_parts.append(f"Charts: {len(charts)}")
        draft_parts.append("")

        # Collect all chart summaries for executive summary
        all_summaries: list[str] = []

        # Section 1: Executive Summary
        draft_parts.append("## Executive Summary")
        draft_parts.append(f"Summarize **{dash_name}** dashboard key findings:")

        # Section 2: Performance Overview
        perf_rows: list[str] = [
            "## Performance Overview",
            "| Indicator | Current Value | Trend | Status |",
            "|-----------|---------------|-------|--------|",
        ]

        # Section 3: Chart by Chart
        chart_sections: list[str] = ["## Detailed Analysis — Chart by Chart"]

        for chart_entry in charts[:8]:
            c = chart_entry.get("chart") or {}
            cname = c.get("name") or c.get("slice_name") or "Unnamed Chart"
            qr = chart_entry.get("query_result") or {}
            rows, columns = _extract_rows_and_columns(qr)

            if not rows:
                chart_sections.append(f"\n### {cname}")
                chart_sections.append("No data available for this chart.")
                continue

            # Skip charts where all values are zero/trivial
            if _is_trivial_data(rows):
                continue

            numeric_cols, label_cols = _classify_columns(rows, columns)
            label_col = label_cols[0] if label_cols else None

            viz_type = c.get("viz_type") or "unknown"
            chart_sections.append(f"\n### {cname}")
            chart_sections.append(f"Data: {len(rows)} rows, type: {viz_type}")

            chart_max_severity = "[INFO]"
            for col in numeric_cols[:3]:
                stats = _compute_column_stats(rows, col)
                if not stats:
                    continue
                name = col.replace("_", " ").title()
                avg_s = _format_number(stats["avg"])
                trend = stats.get("trend", "Stable")

                if stats["pct_change"] is not None:
                    sign = "+" if stats["pct_change"] > 0 else ""
                    pct = abs(stats["pct_change"])
                    severity = (
                        "[CRITICAL]" if pct > 30 else
                        "[WARNING]" if pct > 10 else
                        "[GOOD]" if trend == "Stable" or pct < 5 else
                        "[INFO]"
                    )
                    # Track worst severity for this chart
                    sev_rank = {"[CRITICAL]": 3, "[WARNING]": 2, "[INFO]": 1, "[GOOD]": 0}
                    if sev_rank.get(severity, 0) > sev_rank.get(chart_max_severity, 0):
                        chart_max_severity = severity
                    chart_sections.append(
                        f"- {name}: avg **{avg_s}**, range **{_format_number(stats['min'])}** "
                        f"to **{_format_number(stats['max'])}**, change **{sign}{stats['pct_change']}%** ({trend})"
                    )
                    all_summaries.append(f"- {cname} — {name}: avg **{avg_s}**, {trend} ({sign}{stats['pct_change']}%)")
                    perf_rows.append(f"| {cname}: {name} | {avg_s} | {trend} | {severity} |")

                # Top/bottom
                if label_col:
                    sorted_rows = sorted(
                        [r for r in rows if r.get(col) is not None],
                        key=lambda r: float(r.get(col, 0)),
                        reverse=True,
                    )
                    if len(sorted_rows) >= 2:
                        top = sorted_rows[0]
                        bot = sorted_rows[-1]
                        chart_sections.append(
                            f"- Highest: **{top.get(label_col, '?')}** ({_format_number(float(top[col]))}), "
                            f"Lowest: **{bot.get(label_col, '?')}** ({_format_number(float(bot[col]))})"
                        )

            # Add severity tag and visual recommendation per chart
            chart_sections.append(chart_max_severity)
            viz_recs = {
                "line": "[Trend line recommended]",
                "bar": "[Bar chart recommended]",
                "pie": "[Pie chart recommended]",
                "big_number_total": "[Big Number KPI recommended]",
                "big_number": "[Big Number KPI recommended]",
                "summary": "[Summary KPI recommended]",
                "comparison_kpi": "[Comparison KPI recommended]",
                "table": "[Data table recommended]",
                "dist_bar": "[Stacked bar chart recommended]",
                "area": "[Area chart recommended]",
                "scatter": "[Scatter plot recommended]",
                "heatmap": "[Heatmap recommended]",
                "treemap": "[Treemap recommended]",
                "country_map": "[Choropleth map recommended]",
                "vital_maps": "[Map visualization recommended]",
                "dhis2_map": "[Choropleth map recommended]",
                "mixed_timeseries": "[Line and Bar combo recommended]",
                "small_multiples": "[Small multiples recommended]",
                "marquee_kpi": "[Marquee KPI recommended]",
            }
            chart_sections.append(viz_recs.get(viz_type, f"[{viz_type} recommended]"))

        # Assemble exec summary
        draft_parts.extend(all_summaries[:6] or ["- Dashboard data available for analysis"])
        draft_parts.append("")

        # Performance table
        if len(perf_rows) > 3:
            draft_parts.extend(perf_rows)
        draft_parts.append("")

        # Chart sections
        draft_parts.extend(chart_sections)
        draft_parts.append("")

        # ── Cross-chart synthesis (pre-computed) ──
        # Collect all metrics across charts for pattern detection
        all_metrics: list[dict] = []
        rising_metrics: list[str] = []
        falling_metrics: list[str] = []
        critical_items: list[str] = []
        stable_items: list[str] = []

        for chart_entry in charts[:8]:
            c = chart_entry.get("chart") or {}
            cname = c.get("name") or c.get("slice_name") or "Unnamed"
            qr = chart_entry.get("query_result") or {}
            rows, columns = _extract_rows_and_columns(qr)
            if not rows or _is_trivial_data(rows):
                continue
            numeric_cols, _ = _classify_columns(rows, columns)
            for col in numeric_cols[:3]:
                stats = _compute_column_stats(rows, col)
                if not stats or stats["pct_change"] is None:
                    continue
                name = col.replace("_", " ").title()
                label = f"{cname}: {name}"
                pct = stats["pct_change"]
                trend = stats["trend"]
                all_metrics.append({"label": label, "pct": pct, "trend": trend, "avg": stats["avg"]})
                if trend == "Rising":
                    rising_metrics.append(f"{label} ({'+' if pct > 0 else ''}{pct}%)")
                elif trend == "Falling":
                    falling_metrics.append(f"{label} ({pct}%)")
                else:
                    stable_items.append(label)
                if abs(pct) > 30:
                    critical_items.append(f"{label}: {'+' if pct > 0 else ''}{pct}%")

        draft_parts.append("## Cross-Chart Synthesis")
        if rising_metrics:
            draft_parts.append(f"Rising trends across the dashboard: {'; '.join(rising_metrics[:5])}")
        if falling_metrics:
            draft_parts.append(f"Falling trends: {'; '.join(falling_metrics[:5])}")
        if stable_items:
            draft_parts.append(f"Stable indicators: {', '.join(stable_items[:5])}")
        if critical_items:
            draft_parts.append(f"[CRITICAL] Metrics with >30% change: {'; '.join(critical_items[:5])}")
        if not all_metrics:
            draft_parts.append("Insufficient data for cross-chart synthesis.")
        draft_parts.append(
            "Synthesize these patterns into a professional narrative about what "
            "the dashboard reveals as a whole."
        )
        draft_parts.append("")

        draft_parts.append("## Leadership Watchouts")
        if critical_items:
            for item in critical_items[:4]:
                draft_parts.append(f"- {item}")
        draft_parts.append(
            "Identify 2-4 actionable concerns for leadership based on the data above."
        )
        draft_parts.append("")

        draft_parts.append("## Bottom Line")
        draft_parts.append(
            "Write one concise paragraph with the single most important takeaway "
            "from the entire dashboard."
        )
        draft_parts.append("")

    return "\n".join(draft_parts)


def _severity_for_pct(pct_change: float, trend: str) -> str:
    """Classify severity based on percentage change magnitude."""
    pct = abs(pct_change)
    if pct > 30:
        return "[CRITICAL]"
    if pct > 10:
        return "[WARNING]"
    if trend == "Stable" or pct < 5:
        return "[GOOD]"
    return "[INFO]"


def _prose_trend(name: str, stats: dict, label_col: str | None, rows: list[dict], col: str) -> str:
    """Generate a prose paragraph for a metric finding."""
    avg_s = _format_number(stats["avg"])
    min_s = _format_number(stats["min"])
    max_s = _format_number(stats["max"])
    total_s = _format_number(stats["total"])
    trend = stats.get("trend", "Stable")
    pct = stats.get("pct_change")
    sign = "+" if pct and pct > 0 else ""

    lines = []
    if pct is not None:
        if trend == "Rising":
            lines.append(f"{name} increased by **{sign}{pct}%**, averaging **{avg_s}** across the period.")
        elif trend == "Falling":
            lines.append(f"{name} declined by **{pct}%**, averaging **{avg_s}** across the period.")
        else:
            lines.append(f"{name} remained stable at an average of **{avg_s}** ({sign}{pct}% change).")
    else:
        lines.append(f"{name} averages **{avg_s}** across the dataset.")

    lines.append(f"Values range from **{min_s}** to **{max_s}** (total: **{total_s}**).")

    # Top/bottom entities
    if label_col:
        sorted_rows = sorted(
            [r for r in rows if r.get(col) is not None],
            key=lambda r: float(r.get(col, 0)),
            reverse=True,
        )
        if len(sorted_rows) >= 2:
            top = sorted_rows[0]
            bot = sorted_rows[-1]
            top_name = top.get(label_col, "?")
            top_val = _format_number(float(top.get(col, 0)))
            bot_name = bot.get(label_col, "?")
            bot_val = _format_number(float(bot.get(col, 0)))
            lines.append(
                f"**{top_name}** recorded the highest value at **{top_val}**, "
                f"while **{bot_name}** recorded the lowest at **{bot_val}**."
            )

    return " ".join(lines)


def _build_complete_report(
    context_payload: dict[str, Any],
    mode: str,
    question: str = "Summary",
) -> str:
    """Build a COMPLETE, presentation-ready report from data.

    Generates a fully-formed professional report matching the structure and
    depth of Gemini/cloud model output.  Used for local providers where the
    Python report streams directly — the model is bypassed entirely.

    The ``question`` param enables mode-aware output: "Summary" produces a
    concise executive summary while "Comprehensive deep dive" produces the
    full multi-section report.
    """
    insight_mode = _detect_insight_mode(question)

    # ── helpers ──────────────────────────────────────────────────────
    def _extract(qr: dict):
        rows = qr.get("sample_rows") or qr.get("data") or []
        cols = qr.get("columns") or (list(rows[0].keys()) if rows and isinstance(rows[0], dict) else [])
        return rows, cols

    def _classify(rows, columns):
        period_names = {
            "period", "periodid", "period_id", "date", "month", "year",
            "quarter", "week", "day", "fiscal_year", "reporting_period",
        }
        period_re = re.compile(r"^\d{4}[01]\d$|^\d{4}-[01]\d$|^\d{4}Q[1-4]$|^\d{4}-\d{2}-\d{2}", re.I)
        numeric, labels = [], []
        for col in columns:
            vals = [row.get(col) for row in rows[:5] if row.get(col) is not None]
            if not vals:
                labels.append(col)
                continue
            if col.lower().replace(" ", "_") in period_names:
                labels.append(col)
                continue
            str_vals = [str(v) for v in vals[:5]]
            if str_vals and all(period_re.match(sv) for sv in str_vals):
                labels.append(col)
                continue
            try:
                [float(v) for v in vals]
                numeric.append(col)
            except (ValueError, TypeError):
                labels.append(col)
        return numeric, labels

    def _clean_name(col: str) -> str:
        """Turn ugly DHIS2 column names into readable labels."""
        # Strip common prefixes: "Sum (", "Avg (", "Count (" etc.
        name = re.sub(r"^(?:Sum|Avg|Count|Min|Max)\s*\(\s*", "", col)
        name = re.sub(r"\s*\)\s*$", "", name)
        # Strip coded prefixes like "C 108 Ci 02 "
        name = re.sub(r"^[A-Z]\s*\d+\s+[A-Z][a-z]\s*\d+\s+", "", name)
        # Replace underscores with spaces
        name = name.replace("_", " ")
        # Title-case
        name = name.strip().title() if name.strip() else col.replace("_", " ").title()
        return name

    def _entity_table(rows, label_col, metric_col, metric_name, max_rows=10):
        """Build a ranked entity table."""
        valid = [r for r in rows if r.get(metric_col) is not None and r.get(label_col) is not None]
        if len(valid) < 2:
            return []
        sorted_rows = sorted(valid, key=lambda r: float(r.get(metric_col, 0)), reverse=True)
        lines = []
        lines.append(f"| Rank | {_clean_name(label_col)} | {metric_name} | Status |")
        lines.append("|------|" + "-" * (len(_clean_name(label_col)) + 2) + "|" + "-" * (len(metric_name) + 2) + "|--------|")
        for i, row in enumerate(sorted_rows[:max_rows], 1):
            val = float(row.get(metric_col, 0))
            entity = str(row.get(label_col, "?"))
            avg = sum(float(r.get(metric_col, 0)) for r in valid) / len(valid)
            if val > avg * 1.3:
                status = "[CRITICAL]" if val > avg * 1.5 else "[WARNING]"
            elif val < avg * 0.7:
                status = "[GOOD]" if metric_name.lower().find("positiv") >= 0 or metric_name.lower().find("death") >= 0 else "[WARNING]"
            else:
                status = "[INFO]"
            lines.append(f"| {i} | {entity} | {_format_number(val)} | {status} |")
        return lines

    VIZ_RECS = {
        "line": "Trend line", "bar": "Bar chart", "pie": "Pie chart",
        "big_number_total": "Big Number KPI", "big_number": "Big Number KPI",
        "summary": "Summary KPI", "comparison_kpi": "Comparison KPI",
        "table": "Data table", "dist_bar": "Stacked bar chart",
        "area": "Area chart", "scatter": "Scatter plot", "heatmap": "Heatmap",
        "treemap": "Treemap", "country_map": "Choropleth map",
        "vital_maps": "Map visualization", "dhis2_map": "Choropleth map",
        "mixed_timeseries": "Line and Bar combo",
        "small_multiples": "Small multiples", "marquee_kpi": "Marquee KPI",
    }

    # ── extract metadata ────────────────────────────────────────────
    parts: list[str] = []
    chart_info = context_payload.get("chart") or {}
    chart_name = chart_info.get("slice_name") or chart_info.get("name") or ""
    viz_type = chart_info.get("viz_type") or ""
    dash_info = context_payload.get("dashboard") or {}
    dash_name = dash_info.get("dashboard_title") or dash_info.get("name") or ""
    title = dash_name or chart_name or "Data Analysis"

    # ================================================================
    # CHART MODE
    # ================================================================
    if mode == "chart":
        qr = context_payload.get("query_result") or {}
        rows, columns = _extract(qr)
        if not rows:
            return (
                f"## No Data Available\n\n"
                f"No data was returned for **{chart_name or 'this chart'}**. "
                f"This may indicate an empty dataset, a filter that excludes all records, "
                f"or a data pipeline issue. Verify the data source and filter configuration."
            )

        numeric_cols, label_cols = _classify(rows, columns)
        label_col = label_cols[0] if label_cols else None
        n_entities = len(rows)

        # Pre-compute all metric stats
        all_metrics: list[dict] = []
        for col in numeric_cols[:6]:
            stats = _compute_column_stats(rows, col)
            if stats:
                all_metrics.append({"col": col, "stats": stats, "name": _clean_name(col)})

        if not all_metrics:
            return (
                f"## Executive Summary\n\n"
                f"**{chart_name or 'This chart'}** contains {n_entities} records "
                f"but no numeric metrics were identified for quantitative analysis."
            )

        # Find the primary metric and key entities
        primary = all_metrics[0]
        p_stats = primary["stats"]
        p_name = primary["name"]

        # Sort entities by primary metric
        sorted_entities = []
        if label_col:
            valid_rows = [r for r in rows if r.get(primary["col"]) is not None]
            sorted_entities = sorted(valid_rows, key=lambda r: float(r.get(primary["col"], 0)), reverse=True)

        top_entity = str(sorted_entities[0].get(label_col, "")) if sorted_entities and label_col else None
        top_val = float(sorted_entities[0].get(primary["col"], 0)) if sorted_entities else None
        bot_entity = str(sorted_entities[-1].get(label_col, "")) if sorted_entities and label_col else None
        bot_val = float(sorted_entities[-1].get(primary["col"], 0)) if sorted_entities else None

        # ── MODE-AWARE RENDERING ──────────────────────────────────────
        # Each mode produces detailed, expert-level content focused on
        # what was asked.  The deep_dive / unmatched modes fall through
        # to the full 7-section comprehensive report at the bottom.

        # ── Shared helper: build detailed metric analysis block ──
        def _metric_detail_block(m: dict, include_entities: bool = True) -> list[str]:
            """Rich analysis block for a single metric."""
            blk: list[str] = []
            s = m["stats"]
            name = m["name"]
            col = m["col"]
            sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
            blk.append(sev)
            blk.append("")
            blk.append(f"### {name}")
            blk.append("")
            blk.append(_prose_trend(name, s, label_col, rows, col))
            blk.append("")
            if include_entities and label_col and len(sorted_entities) >= 3:
                valid = [r for r in rows if r.get(col) is not None]
                by_col = sorted(valid, key=lambda r: float(r.get(col, 0)), reverse=True)
                top3 = by_col[:3]
                bot3 = by_col[-3:]
                blk.append("**Top performers:**")
                for r in top3:
                    blk.append(f"- {r.get(label_col, '?')}: **{_format_number(float(r.get(col, 0)))}**")
                blk.append("")
                blk.append("**Entities requiring attention:**")
                for r in reversed(bot3):
                    blk.append(f"- {r.get(label_col, '?')}: **{_format_number(float(r.get(col, 0)))}**")
                blk.append("")
                # Quartile/outlier analysis
                vals = sorted([float(r.get(col, 0)) for r in valid])
                q1_idx = len(vals) // 4
                q3_idx = 3 * len(vals) // 4
                if q1_idx < q3_idx:
                    q1, q3 = vals[q1_idx], vals[q3_idx]
                    iqr = q3 - q1
                    outlier_threshold = q3 + 1.5 * iqr
                    outliers = [r for r in valid if float(r.get(col, 0)) > outlier_threshold]
                    if outliers:
                        onames = ", ".join(str(r.get(label_col, "?")) for r in outliers[:4])
                        blk.append(f"**Outliers** (>{_format_number(outlier_threshold)}): {onames}")
                        blk.append("")
            return blk

        # ── Shared helper: entity ranking table ──
        def _full_ranking_section() -> list[str]:
            blk: list[str] = []
            if label_col and len(sorted_entities) >= 3:
                blk.append(f"## {_clean_name(label_col)} Ranking by {p_name}")
                blk.append("")
                tbl = _entity_table(rows, label_col, primary["col"], p_name, max_rows=min(n_entities, 15))
                blk.extend(tbl)
                blk.append("")
            return blk

        # ── Shared helper: disparity analysis section ──
        def _disparity_section() -> list[str]:
            blk: list[str] = []
            if label_col and len(sorted_entities) >= 4 and top_entity and bot_entity and top_val is not None and bot_val is not None:
                blk.append("## Disparity Analysis")
                blk.append("")
                gap = top_val - bot_val
                ratio = round(top_val / bot_val, 1) if bot_val > 0 else 0
                blk.append(
                    f"The data reveals **significant disparity** across {_clean_name(label_col).lower()} entities. "
                    f"**{top_entity}** leads with a {p_name} of **{_format_number(top_val)}**, "
                    f"while **{bot_entity}** is at **{_format_number(bot_val)}** — "
                    f"a **{ratio}x difference**."
                )
                blk.append("")
                avg = p_stats["avg"]
                high_tier = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > avg * 1.2]
                mid_tier = [r for r in sorted_entities if avg * 0.8 <= float(r.get(primary["col"], 0)) <= avg * 1.2]
                low_tier = [r for r in sorted_entities if float(r.get(primary["col"], 0)) < avg * 0.8]
                blk.append(f"- **High tier** (>{_format_number(avg * 1.2)}): {len(high_tier)} entities")
                blk.append(f"- **Middle tier** ({_format_number(avg * 0.8)} – {_format_number(avg * 1.2)}): {len(mid_tier)} entities")
                blk.append(f"- **Low tier** (<{_format_number(avg * 0.8)}): {len(low_tier)} entities")
                blk.append("")
                if high_tier:
                    blk.append(f"**High-tier entities**: {', '.join(str(r.get(label_col, '?')) for r in high_tier[:5])}")
                if low_tier:
                    blk.append(f"**Low-tier entities requiring intervention**: {', '.join(str(r.get(label_col, '?')) for r in low_tier[:5])}")
                blk.append("")
            return blk

        # ── Shared helper: risk section ──
        def _risk_section() -> list[str]:
            blk: list[str] = []
            blk.append("## Risk and Issue Analysis")
            blk.append("")
            risk_count = 0
            for m in all_metrics:
                s = m["stats"]
                name = m["name"]
                pct = s.get("pct_change")
                if pct is not None and abs(pct) > 10:
                    risk_count += 1
                    sev = _severity_for_pct(pct, s["trend"])
                    blk.append(sev)
                    blk.append("")
                    if s["trend"] == "Rising" and abs(pct) > 15:
                        blk.append(
                            f"- **{name} surge risk**: Rose by **+{pct}%**. If this trend continues, "
                            f"it may strain resources and capacity. Requires root cause analysis."
                        )
                    elif s["trend"] == "Falling" and abs(pct) > 15:
                        blk.append(
                            f"- **{name} decline risk**: Fell by **{pct}%**. This may indicate "
                            f"reduced reporting, service disruption, or genuine improvement requiring verification."
                        )
                    else:
                        blk.append(
                            f"- **{name} volatility**: Changed by **{'+' if pct > 0 else ''}{pct}%** "
                            f"({s['trend']}). Continued monitoring warranted."
                        )
                    blk.append(f"- **Evidence**: Range {_format_number(s['min'])} to {_format_number(s['max'])}, avg {_format_number(s['avg'])}")
                    blk.append(f"- **Urgency**: {'High — investigate immediately' if abs(pct) > 30 else 'Moderate — monitor closely'}")
                    blk.append(f"- **Confidence**: {'High — large shift clearly visible' if abs(pct) > 30 else 'Moderate — trend direction clear but magnitude may reflect data quality'}")
                    blk.append("")
            if label_col and sorted_entities:
                avg = p_stats["avg"]
                critical_entities = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > avg * 1.5]
                if critical_entities:
                    risk_count += 1
                    names = ", ".join(str(r.get(label_col, "?")) for r in critical_entities[:4])
                    blk.append(
                        f"- **Concentration risk**: {len(critical_entities)} entities exceed 1.5x the average "
                        f"({names}). These represent hotspots requiring prioritized attention."
                    )
                    blk.append("")
            if risk_count == 0:
                blk.append("[GOOD]")
                blk.append("")
                blk.append("- No significant risks identified. All metrics within moderate bounds.")
                blk.append("")
            return blk

        # ── Shared helper: recommendations section ──
        def _recommendations_section() -> list[str]:
            blk: list[str] = []
            blk.append("## Action Recommendations")
            blk.append("")
            rec_num = 0
            if top_entity and bot_entity and top_val is not None and bot_val is not None:
                gap = top_val - bot_val
                if gap > 0:
                    rec_num += 1
                    blk.append(
                        f"{rec_num}. **Investigate {top_entity} ({p_name}: {_format_number(top_val)})**: "
                        f"This entity is the highest in the dataset, significantly above the average of "
                        f"{_format_number(p_stats['avg'])}. Determine whether this reflects a genuine "
                        f"hotspot or a data quality issue. **Benefit**: Targeted intervention at the "
                        f"highest-burden entity yields the greatest impact. **Risk if ignored**: "
                        f"Unchecked escalation in the highest-performing area."
                    )
                    blk.append("")
            if label_col and sorted_entities:
                low_entities = sorted_entities[-3:]
                if low_entities:
                    rec_num += 1
                    names = ", ".join(str(r.get(label_col, "?")) for r in low_entities)
                    blk.append(
                        f"{rec_num}. **Support low-performing entities ({names})**: These entities "
                        f"have the lowest {p_name} values. Conduct root cause analysis to determine "
                        f"whether low values reflect underreporting, resource gaps, or genuine low burden. "
                        f"**Benefit**: Ensures equitable resource allocation. "
                        f"**Risk if ignored**: Hidden problems may go undetected."
                    )
                    blk.append("")
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change")
                if pct is None:
                    continue
                name = m["name"]
                trend = s["trend"]
                if abs(pct) > 10:
                    rec_num += 1
                    if trend == "Rising":
                        blk.append(
                            f"{rec_num}. **Monitor {name} increase (+{pct}%)**: Determine root causes "
                            f"and assess whether intervention is needed. **Benefit**: Early action "
                            f"prevents escalation. **Risk if ignored**: Unchecked growth may "
                            f"overwhelm systems."
                        )
                    else:
                        blk.append(
                            f"{rec_num}. **Verify {name} decline ({pct}%)**: Confirm whether this "
                            f"reflects genuine improvement or reporting gaps. **Benefit**: Confirms "
                            f"progress or identifies hidden problems. **Risk if ignored**: False "
                            f"confidence from incomplete data."
                        )
                    blk.append("")
                if rec_num >= 6:
                    break
            rec_num += 1
            blk.append(
                f"{rec_num}. **Validate data completeness and accuracy**: Cross-reference reported "
                f"values against facility registers and alternative data sources. Ensure all "
                f"{n_entities} entities are reporting consistently. **Benefit**: Informed decision-making. "
                f"**Risk if ignored**: Decisions based on incomplete data."
            )
            blk.append("")
            return blk

        # ── Shared helper: data quality section ──
        def _data_quality_section() -> list[str]:
            blk: list[str] = []
            blk.append("## Data Quality and Confidence Assessment")
            blk.append("")
            blk.append(f"- **Entities reporting**: {n_entities}")
            blk.append(f"- **Metrics analyzed**: {len(all_metrics)}")
            for m in all_metrics:
                s = m["stats"]
                null_count = sum(1 for r in rows if r.get(m["col"]) is None)
                blk.append(f"- **{m['name']}**: {s['count']} non-null values of {n_entities} rows"
                           + (f" ({null_count} missing)" if null_count > 0 else " (complete)"))
                if s["min"] == 0:
                    blk.append(f"  - Contains zero values — possible reporting/data quality issue")
                if s["max"] > s["avg"] * 3:
                    blk.append(f"  - Maximum ({_format_number(s['max'])}) is >3x the average — possible outlier")
            blk.append("")
            blk.append(f"**Decision confidence**: {'Moderate — some data gaps noted' if any(r.get(primary['col']) is None for r in rows) else 'High — data appears complete'}")
            blk.append("")
            return blk

        # ════════════════════════════════════════════════════════════════
        # MODE DISPATCH — each mode builds focused, detailed output
        # ════════════════════════════════════════════════════════════════

        if insight_mode == "summary":
            # Executive summary: analytical paragraph + key findings + ranking + risks
            parts.append(f"## Chart Summary — {chart_name or 'Analysis'}")
            parts.append("")
            para = (
                f"**{chart_name or 'This chart'}** presents {p_name} across "
                f"**{n_entities} entities**, averaging **{_format_number(p_stats['avg'])}** "
                f"(range: {_format_number(p_stats['min'])} to {_format_number(p_stats['max'])}). "
            )
            if top_entity and bot_entity and top_val is not None and bot_val is not None and bot_val > 0:
                ratio = round(top_val / bot_val, 1)
                para += (
                    f"The data reveals a **{ratio}x disparity** between {top_entity} "
                    f"({_format_number(top_val)}) and {bot_entity} ({_format_number(bot_val)}). "
                )
            if p_stats.get("trend") and p_stats["trend"] != "Stable":
                sign = "+" if p_stats.get("pct_change", 0) > 0 else ""
                para += f"The overall trend is **{p_stats['trend'].lower()}** ({sign}{p_stats.get('pct_change', 0)}%). "
            if label_col and sorted_entities:
                above = sum(1 for r in sorted_entities if float(r.get(primary["col"], 0)) > p_stats["avg"])
                para += f"{above} of {n_entities} entities exceed the average."
            parts.append(para)
            parts.append("")
            # Key findings per metric
            parts.append("**What stands out:**")
            parts.append("")
            for m in all_metrics:
                s = m["stats"]
                sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                sign = "+" if s.get("pct_change", 0) > 0 else ""
                parts.append(
                    f"- {sev} **{m['name']}**: avg {_format_number(s['avg'])}, "
                    f"range {_format_number(s['min'])}–{_format_number(s['max'])}, "
                    f"{s.get('trend', 'Stable')} ({sign}{s.get('pct_change', 0)}%)"
                )
            parts.append("")
            # Entity ranking
            parts.extend(_full_ranking_section())
            # Disparity
            parts.extend(_disparity_section())
            # Why it matters + risks
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "key_takeaways":
            parts.append(f"## Key Takeaways — {chart_name or 'Chart'}")
            parts.append("")
            # Opening context
            parts.append(
                f"**{chart_name or 'This chart'}** tracks {len(all_metrics)} indicator(s) "
                f"across {n_entities} entities. The following are the most significant "
                f"findings from the data."
            )
            parts.append("")
            bullet = 0
            if top_entity and bot_entity and top_val is not None and bot_val is not None:
                bullet += 1
                ratio = round(top_val / bot_val, 1) if bot_val and bot_val > 0 else 0
                parts.append(
                    f"{bullet}. **Widest disparity in {p_name}**: {top_entity} "
                    f"({_format_number(top_val)}) vs {bot_entity} ({_format_number(bot_val)}) — "
                    f"a {ratio}x gap. This concentration suggests uneven distribution "
                    f"that may require targeted intervention at both ends."
                )
                parts.append("")
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change", 0)
                if abs(pct) > 5 or s.get("trend") != "Stable":
                    bullet += 1
                    sign = "+" if pct > 0 else ""
                    parts.append(
                        f"{bullet}. **{m['name']} is {s.get('trend', 'Stable').lower()}** ({sign}{pct}%): "
                        f"Averaging {_format_number(s['avg'])} across the dataset with values "
                        f"from {_format_number(s['min'])} to {_format_number(s['max'])}. "
                        f"{'This upward movement may indicate escalating burden.' if pct > 10 else ''}"
                        f"{'This decline warrants verification — could reflect improvement or reporting gap.' if pct < -10 else ''}"
                    )
                    parts.append("")
            if label_col and sorted_entities:
                above = sum(1 for r in sorted_entities if float(r.get(primary["col"], 0)) > p_stats["avg"])
                below = n_entities - above
                if below > 0:
                    bullet += 1
                    parts.append(
                        f"{bullet}. **{below} of {n_entities} entities below average** "
                        f"({_format_number(p_stats['avg'])}): These entities may face resource "
                        f"constraints, underreporting, or genuinely lower burden — root cause "
                        f"analysis is recommended."
                    )
                    parts.append("")
                zeros = sum(1 for r in rows if r.get(primary["col"]) is not None and float(r.get(primary["col"], 0)) == 0)
                if zeros:
                    bullet += 1
                    parts.append(
                        f"{bullet}. **{zeros} entities report zero values**: This raises a data quality "
                        f"concern — verify whether these represent true zero activity or missing data."
                    )
                    parts.append("")
            # Include ranking for context
            parts.extend(_full_ranking_section())
            return "\n".join(parts)

        if insight_mode == "top_bottom":
            parts.append(f"## Top and Bottom Performers — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"This analysis ranks {n_entities} entities by {p_name}, which averages "
                f"**{_format_number(p_stats['avg'])}** across the dataset."
            )
            parts.append("")
            if label_col and sorted_entities:
                # Full ranking table
                tbl = _entity_table(rows, label_col, primary["col"], p_name, max_rows=min(n_entities, 20))
                parts.extend(tbl)
                parts.append("")
                # Top performers detail
                parts.append("### Top Performers")
                parts.append("")
                for r in sorted_entities[:5]:
                    val = float(r.get(primary["col"], 0))
                    entity = str(r.get(label_col, "?"))
                    diff = val - p_stats["avg"]
                    parts.append(
                        f"- **{entity}**: {_format_number(val)} "
                        f"(**{'+' if diff > 0 else ''}{_format_number(diff)}** vs average)"
                    )
                parts.append("")
                # Bottom performers detail
                parts.append("### Bottom Performers (Require Attention)")
                parts.append("")
                for r in reversed(sorted_entities[-5:]):
                    val = float(r.get(primary["col"], 0))
                    entity = str(r.get(label_col, "?"))
                    diff = val - p_stats["avg"]
                    parts.append(
                        f"- **{entity}**: {_format_number(val)} "
                        f"(**{_format_number(diff)}** vs average)"
                    )
                parts.append("")
                # Disparity analysis
                parts.extend(_disparity_section())
                # Additional metrics comparison
                for m in all_metrics[1:4]:
                    parts.append(f"### {m['name']} Ranking")
                    parts.append("")
                    tbl2 = _entity_table(rows, label_col, m["col"], m["name"], max_rows=min(n_entities, 10))
                    parts.extend(tbl2)
                    parts.append("")
            else:
                parts.append("Entity-level ranking requires a label dimension (e.g., district, region).")
                parts.append("")
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "regional_comparison":
            parts.append(f"## Regional Comparison — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"Comparing {n_entities} geographic entities across {len(all_metrics)} indicator(s). "
                f"The primary metric, {p_name}, averages **{_format_number(p_stats['avg'])}**."
            )
            parts.append("")
            if label_col and sorted_entities:
                # Full ranking for primary metric
                tbl = _entity_table(rows, label_col, primary["col"], p_name, max_rows=min(n_entities, 20))
                parts.extend(tbl)
                parts.append("")
                # Geographic concentration analysis
                parts.extend(_disparity_section())
                # Rankings for other metrics
                for m in all_metrics[1:4]:
                    parts.append(f"### {m['name']} by {_clean_name(label_col)}")
                    parts.append("")
                    tbl2 = _entity_table(rows, label_col, m["col"], m["name"], max_rows=min(n_entities, 15))
                    parts.extend(tbl2)
                    parts.append("")
                # Detailed per-metric analysis
                for m in all_metrics:
                    parts.extend(_metric_detail_block(m))
            else:
                parts.append("Regional comparison requires a geographic label dimension.")
                parts.append("")
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "risk_analysis":
            parts.append(f"## Risk and Issue Analysis — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"This risk assessment covers {len(all_metrics)} indicator(s) across "
                f"{n_entities} entities in **{chart_name or 'this chart'}**."
            )
            parts.append("")
            # Detailed risk analysis per metric
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change")
                sev = _severity_for_pct(pct or 0, s.get("trend", "Stable"))
                parts.append(sev)
                parts.append("")
                parts.append(f"### {m['name']}")
                parts.append("")
                parts.append(_prose_trend(m["name"], s, label_col, rows, m["col"]))
                parts.append("")
                if pct is not None and abs(pct) > 10:
                    parts.append(f"- **Risk**: {m['name']} changed {'+' if pct > 0 else ''}{pct}% ({s['trend']})")
                    parts.append(f"- **Evidence**: Range {_format_number(s['min'])} to {_format_number(s['max'])}, avg {_format_number(s['avg'])}")
                    parts.append(f"- **Likely impact**: {'Resource strain and capacity concerns' if pct > 0 else 'Possible service disruption or reporting gap'}")
                    parts.append(f"- **Urgency**: {'High — investigate immediately' if abs(pct) > 30 else 'Moderate — monitor closely'}")
                    parts.append(f"- **Confidence**: {'High — large shift clearly visible' if abs(pct) > 30 else 'Moderate — data supports direction but not magnitude with certainty'}")
                else:
                    parts.append(f"- **Risk level**: Low — metric is stable or showing minor variation")
                    parts.append(f"- **Evidence**: Range {_format_number(s['min'])} to {_format_number(s['max'])}, avg {_format_number(s['avg'])}")
                parts.append("")
            # Entity-level risks
            if label_col and sorted_entities:
                parts.append("### Entity-Level Risk Concentration")
                parts.append("")
                outliers = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > p_stats["avg"] * 1.5]
                if outliers:
                    for r in outliers[:5]:
                        entity = str(r.get(label_col, "?"))
                        val = float(r.get(primary["col"], 0))
                        parts.append(
                            f"- **{entity}**: {_format_number(val)} ({p_name}) — "
                            f"**{round(val / p_stats['avg'], 1)}x** the average. "
                            f"Potential hotspot requiring prioritized response."
                        )
                    parts.append("")
                else:
                    parts.append("No entities exceed 1.5x the average — no concentration risk detected.")
                    parts.append("")
            parts.extend(_data_quality_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "metrics_attention":
            parts.append(f"## Metrics Needing Attention — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"Assessing {len(all_metrics)} indicator(s) across {n_entities} entities "
                f"to identify metrics requiring immediate or near-term attention."
            )
            parts.append("")
            # Priority table
            parts.append("| Metric | Current Signal | Why It Matters | Severity | Follow-up |")
            parts.append("|--------|---------------|----------------|----------|-----------|")
            for m in all_metrics:
                s = m["stats"]
                trend = s.get("trend", "Stable")
                pct = s.get("pct_change", 0)
                sev = _severity_for_pct(pct, trend)
                signal = f"Avg {_format_number(s['avg'])}, {trend} ({'+' if pct > 0 else ''}{pct}%)"
                why = "Threshold concern" if abs(pct) > 20 else "Trend shift" if abs(pct) > 10 else "Stable"
                action = "Investigate root cause" if abs(pct) > 20 else "Increase surveillance" if abs(pct) > 10 else "Continue monitoring"
                parts.append(f"| {m['name']} | {signal} | {why} | {sev} | {action} |")
            parts.append("")
            # Detailed analysis for each metric
            for m in all_metrics:
                parts.extend(_metric_detail_block(m))
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "concerning_trends":
            parts.append(f"## Concerning Trends — {chart_name or 'Chart'}")
            parts.append("")
            found = False
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change", 0)
                if abs(pct) > 5 and s.get("trend") != "Stable":
                    found = True
                    parts.extend(_metric_detail_block(m))
                    parts.append(
                        f"**Interpretation**: This {'could reflect' if abs(pct) < 20 else 'suggests'} "
                        f"{'escalating burden that may strain resources' if pct > 0 else 'possible reporting gap, seasonal variation, or genuine improvement'}. "
                        f"{'Urgent investigation recommended.' if abs(pct) > 30 else 'Closer monitoring advised.'}"
                    )
                    parts.append("")
            if not found:
                parts.append(
                    "No concerning trends detected across the analyzed metrics. All indicators "
                    "are stable or showing minor variation within expected bounds."
                )
                parts.append("")
                # Still show the data for context
                parts.append("## Current Metric Status")
                parts.append("")
                for m in all_metrics:
                    s = m["stats"]
                    parts.append(
                        f"- **{m['name']}**: avg {_format_number(s['avg'])}, "
                        f"range {_format_number(s['min'])}–{_format_number(s['max'])}, Stable"
                    )
                parts.append("")
            parts.extend(_full_ranking_section())
            parts.extend(_data_quality_section())
            return "\n".join(parts)

        if insight_mode in ("strategic_recommendations", "improvement"):
            parts.append(f"## Strategic Recommendations — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"Based on the analysis of {len(all_metrics)} indicator(s) across "
                f"{n_entities} entities, the following evidence-based recommendations "
                f"are prioritized by urgency and expected impact."
            )
            parts.append("")
            # Show the evidence base first
            parts.append("### Evidence Base")
            parts.append("")
            parts.append("| Indicator | Average | Trend | Change | Status |")
            parts.append("|-----------|---------|-------|--------|--------|")
            for m in all_metrics:
                s = m["stats"]
                sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                sign = "+" if s.get("pct_change", 0) > 0 else ""
                parts.append(
                    f"| {m['name']} | {_format_number(s['avg'])} | "
                    f"{s.get('trend', 'Stable')} | {sign}{s.get('pct_change', 0)}% | {sev} |"
                )
            parts.append("")
            # Entity context
            parts.extend(_full_ranking_section())
            # Recommendations
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "executive_brief":
            parts.append(f"## Executive Brief — {chart_name or 'Chart'}")
            parts.append("")
            # Board-ready paragraph
            parts.append(
                f"**{chart_name or 'This chart'}** tracks {p_name} across {n_entities} entities. "
                f"The average stands at **{_format_number(p_stats['avg'])}** with a spread from "
                f"{_format_number(p_stats['min'])} to {_format_number(p_stats['max'])}."
                + (f" **{top_entity}** leads at {_format_number(top_val)} while **{bot_entity}** "
                   f"trails at {_format_number(bot_val)}." if top_entity and bot_entity and top_val and bot_val else "")
            )
            parts.append("")
            # Performance overview
            parts.append("### Performance at a Glance")
            parts.append("")
            parts.append("| Indicator | Average | Min | Max | Trend | Status |")
            parts.append("|-----------|---------|-----|-----|-------|--------|")
            for m in all_metrics:
                s = m["stats"]
                trend = s.get("trend", "Stable")
                sev = _severity_for_pct(s.get("pct_change", 0), trend)
                parts.append(
                    f"| {m['name']} | {_format_number(s['avg'])} | "
                    f"{_format_number(s['min'])} | {_format_number(s['max'])} | "
                    f"{trend} | {sev} |"
                )
            parts.append("")
            # Entity ranking
            parts.extend(_full_ranking_section())
            # Risks and actions
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "critical_alerts":
            parts.append(f"## Critical Alerts — {chart_name or 'Chart'}")
            parts.append("")
            alert_found = False
            # Metric-level alerts
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change", 0)
                if abs(pct) > 20:
                    alert_found = True
                    parts.append("[CRITICAL]")
                    parts.append("")
                    parts.append(f"### {m['name']} — {'Surged' if pct > 0 else 'Dropped'} {'+' if pct > 0 else ''}{pct}%")
                    parts.append("")
                    parts.append(_prose_trend(m["name"], s, label_col, rows, m["col"]))
                    parts.append("")
                    parts.append(f"- **Alert**: {m['name']} {'surged' if pct > 0 else 'dropped'} {'+' if pct > 0 else ''}{pct}%")
                    parts.append(f"- **Evidence**: Avg {_format_number(s['avg'])}, range {_format_number(s['min'])}–{_format_number(s['max'])}")
                    parts.append(f"- **Immediate implication**: {'Possible escalation requiring urgent review' if pct > 0 else 'Possible reporting gap or service disruption'}")
                    parts.append(f"- **Recommended immediate check**: Verify data source, compare with facility-level records, confirm reporting completeness")
                    parts.append("")
            # Entity-level alerts
            if label_col and sorted_entities:
                extreme = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > p_stats["avg"] * 2]
                if extreme:
                    alert_found = True
                    parts.append("### Entity-Level Critical Alerts")
                    parts.append("")
                    for r in extreme[:5]:
                        entity = str(r.get(label_col, "?"))
                        val = float(r.get(primary["col"], 0))
                        parts.append(f"[CRITICAL]")
                        parts.append("")
                        parts.append(f"- **Alert**: {entity} at {_format_number(val)} ({p_name}) — **{round(val / p_stats['avg'], 1)}x** above average")
                        parts.append(f"- **Evidence**: Average is {_format_number(p_stats['avg'])}, this entity is {_format_number(val - p_stats['avg'])} above")
                        parts.append(f"- **Immediate implication**: Potential hotspot requiring prioritized response")
                        parts.append(f"- **Recommended immediate check**: Verify facility-level data, assess resource adequacy")
                        parts.append("")
            if not alert_found:
                parts.append("[GOOD]")
                parts.append("")
                parts.append("No critical alerts detected. All metrics and entities within acceptable bounds.")
                parts.append("")
                # Still show status overview
                parts.append("### Current Status Overview")
                parts.append("")
                for m in all_metrics:
                    s = m["stats"]
                    sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                    parts.append(f"- {sev} **{m['name']}**: avg {_format_number(s['avg'])}, {s.get('trend', 'Stable')}")
                parts.append("")
            parts.extend(_data_quality_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "data_quality":
            parts.append(f"## Data Quality Assessment — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"Assessing data completeness, consistency, and reliability for "
                f"**{chart_name or 'this chart'}** across {n_entities} entities "
                f"and {len(all_metrics)} indicator(s)."
            )
            parts.append("")
            # Completeness analysis
            parts.append("### Completeness")
            parts.append("")
            for m in all_metrics:
                s = m["stats"]
                null_count = sum(1 for r in rows if r.get(m["col"]) is None)
                completeness = round((s["count"] / n_entities) * 100, 1) if n_entities > 0 else 0
                parts.append(f"- **{m['name']}**: {s['count']} non-null values of {n_entities} rows "
                             f"(**{completeness}%** complete)"
                             + (f" — **{null_count} missing**" if null_count > 0 else ""))
            parts.append("")
            # Consistency analysis
            parts.append("### Consistency and Anomalies")
            parts.append("")
            for m in all_metrics:
                s = m["stats"]
                issues = []
                if s["min"] == 0:
                    zeros = sum(1 for r in rows if r.get(m["col"]) is not None and float(r.get(m["col"], 0)) == 0)
                    issues.append(f"{zeros} zero value(s) — possible reporting gap")
                if s["max"] > s["avg"] * 3:
                    issues.append(f"Maximum ({_format_number(s['max'])}) is >{round(s['max'] / s['avg'], 1)}x the average — possible outlier")
                if s.get("pct_change") is not None and abs(s["pct_change"]) > 50:
                    issues.append(f"Change of {'+' if s['pct_change'] > 0 else ''}{s['pct_change']}% may indicate data discontinuity")
                if issues:
                    parts.append(f"**{m['name']}**:")
                    for issue in issues:
                        parts.append(f"  - {issue}")
                else:
                    parts.append(f"**{m['name']}**: No anomalies detected")
            parts.append("")
            # Entity-level data quality
            if label_col:
                parts.append("### Entity-Level Reporting")
                parts.append("")
                incomplete_entities = []
                for r in rows:
                    missing = sum(1 for m in all_metrics if r.get(m["col"]) is None)
                    if missing > 0:
                        incomplete_entities.append((str(r.get(label_col, "?")), missing))
                if incomplete_entities:
                    for entity, miss in incomplete_entities[:10]:
                        parts.append(f"- **{entity}**: {miss} metric(s) missing")
                else:
                    parts.append("All entities have complete data across analyzed metrics.")
                parts.append("")
            parts.append(f"### Overall Decision Confidence")
            parts.append("")
            has_nulls = any(r.get(primary["col"]) is None for r in rows)
            has_zeros = any(r.get(primary["col"]) is not None and float(r.get(primary["col"], 0)) == 0 for r in rows)
            has_outliers = any(m["stats"]["max"] > m["stats"]["avg"] * 3 for m in all_metrics)
            if has_nulls or has_zeros or has_outliers:
                parts.append(
                    "**Moderate** — Data quality issues noted above may affect the reliability "
                    "of analytical conclusions. Recommend verifying flagged anomalies before "
                    "making resource allocation decisions."
                )
            else:
                parts.append(
                    "**High** — Data appears complete and consistent across all entities and "
                    "metrics. Analytical conclusions can be relied upon with reasonable confidence."
                )
            parts.append("")
            return "\n".join(parts)

        if insight_mode == "performance_overview":
            parts.append(f"## Performance Overview — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                f"**{chart_name or 'This chart'}** presents {len(all_metrics)} indicator(s) "
                f"across {n_entities} entities."
            )
            parts.append("")
            # Performance table
            parts.append("| Indicator | Average | Min | Max | Trend | Status |")
            parts.append("|-----------|---------|-----|-----|-------|--------|")
            for m in all_metrics:
                s = m["stats"]
                trend = s.get("trend", "Stable")
                sev = _severity_for_pct(s.get("pct_change", 0), trend)
                parts.append(
                    f"| {m['name']} | {_format_number(s['avg'])} | "
                    f"{_format_number(s['min'])} | {_format_number(s['max'])} | "
                    f"{trend} | {sev} |"
                )
            parts.append("")
            # Detailed per-metric analysis
            for m in all_metrics:
                parts.extend(_metric_detail_block(m))
            parts.extend(_full_ranking_section())
            parts.extend(_disparity_section())
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "period_comparison":
            parts.append(f"## Period Comparison — {chart_name or 'Chart'}")
            parts.append("")
            # Check if we have period data
            has_period_data = any(m["stats"].get("pct_change") is not None for m in all_metrics)
            if has_period_data:
                parts.append(
                    f"Comparing metric performance across available periods in "
                    f"**{chart_name or 'this chart'}**."
                )
                parts.append("")
                for m in all_metrics:
                    parts.extend(_metric_detail_block(m))
                parts.extend(_full_ranking_section())
                parts.extend(_risk_section())
            else:
                parts.append(
                    "Period comparison cannot be confirmed from the supplied context. "
                    "The data does not include explicit prior-period values for comparison. "
                    "Below is the current-period analysis."
                )
                parts.append("")
                for m in all_metrics:
                    parts.extend(_metric_detail_block(m))
                parts.extend(_full_ranking_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "target_achievement":
            parts.append(f"## Target Achievement — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                "No explicit target or benchmark was provided in the supplied context. "
                "The following assessment uses derived baselines (entity averages and "
                "distribution quartiles) as proxy targets to evaluate relative performance."
            )
            parts.append("")
            # For each metric, show achievement against derived targets
            for m in all_metrics:
                s = m["stats"]
                parts.append(f"### {m['name']}")
                parts.append("")
                parts.append(f"- **Derived target (average)**: {_format_number(s['avg'])}")
                if label_col:
                    valid = [r for r in rows if r.get(m["col"]) is not None]
                    above = sum(1 for r in valid if float(r.get(m["col"], 0)) >= s["avg"])
                    below = len(valid) - above
                    parts.append(f"- **Entities meeting target**: {above} of {len(valid)} ({round(above / len(valid) * 100, 1) if valid else 0}%)")
                    parts.append(f"- **Entities below target**: {below}")
                parts.append(f"- **Range**: {_format_number(s['min'])} to {_format_number(s['max'])}")
                parts.append("")
                parts.extend(_metric_detail_block(m, include_entities=True))
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode in ("outlier_analysis", "distribution"):
            mode_title = "Outlier Analysis" if insight_mode == "outlier_analysis" else "Distribution Analysis"
            parts.append(f"## {mode_title} — {chart_name or 'Chart'}")
            parts.append("")
            for m in all_metrics:
                s = m["stats"]
                parts.append(f"### {m['name']}")
                parts.append("")
                parts.append(
                    f"Average: **{_format_number(s['avg'])}**, "
                    f"Range: {_format_number(s['min'])}–{_format_number(s['max'])}, "
                    f"Total: {_format_number(s['total'])}"
                )
                parts.append("")
                if label_col:
                    valid = [r for r in rows if r.get(m["col"]) is not None]
                    vals = sorted([float(r.get(m["col"], 0)) for r in valid])
                    if len(vals) >= 4:
                        q1_idx, q3_idx = len(vals) // 4, 3 * len(vals) // 4
                        q1, q3 = vals[q1_idx], vals[q3_idx]
                        iqr = q3 - q1
                        parts.append(f"- **Q1 (25th percentile)**: {_format_number(q1)}")
                        parts.append(f"- **Q3 (75th percentile)**: {_format_number(q3)}")
                        parts.append(f"- **IQR**: {_format_number(iqr)}")
                        upper_fence = q3 + 1.5 * iqr
                        lower_fence = q1 - 1.5 * iqr
                        parts.append(f"- **Upper fence**: {_format_number(upper_fence)}")
                        parts.append(f"- **Lower fence**: {_format_number(max(0, lower_fence))}")
                        parts.append("")
                        upper_outliers = [r for r in valid if float(r.get(m["col"], 0)) > upper_fence]
                        lower_outliers = [r for r in valid if float(r.get(m["col"], 0)) < lower_fence]
                        if upper_outliers:
                            parts.append(f"**Upper outliers** ({len(upper_outliers)} entities above {_format_number(upper_fence)}):")
                            for r in sorted(upper_outliers, key=lambda r: float(r.get(m["col"], 0)), reverse=True):
                                parts.append(f"- {r.get(label_col, '?')}: **{_format_number(float(r.get(m['col'], 0)))}**")
                            parts.append("")
                        if lower_outliers:
                            parts.append(f"**Lower outliers** ({len(lower_outliers)} entities below {_format_number(max(0, lower_fence))}):")
                            for r in sorted(lower_outliers, key=lambda r: float(r.get(m["col"], 0))):
                                parts.append(f"- {r.get(label_col, '?')}: **{_format_number(float(r.get(m['col'], 0)))}**")
                            parts.append("")
                        if not upper_outliers and not lower_outliers:
                            parts.append("No statistical outliers detected using the IQR method.")
                            parts.append("")
                        # Concentration
                        if len(vals) >= 3:
                            top_n = min(3, len(vals))
                            top_total = sum(vals[-top_n:])
                            all_total = sum(vals) if sum(vals) > 0 else 1
                            pct_conc = round(top_total / all_total * 100, 1)
                            parts.append(
                                f"**Concentration**: Top {top_n} entities account for "
                                f"**{pct_conc}%** of the total {m['name']}."
                            )
                            parts.append("")
                parts.extend(_metric_detail_block(m))
            parts.extend(_data_quality_section())
            return "\n".join(parts)

        if insight_mode in ("correlation", "leading_lagging"):
            mode_title = "Correlation Analysis" if insight_mode == "correlation" else "Leading vs Lagging Indicators"
            parts.append(f"## {mode_title} — {chart_name or 'Chart'}")
            parts.append("")
            if len(all_metrics) < 2:
                parts.append(
                    f"Only {len(all_metrics)} metric available — correlation analysis "
                    f"requires at least 2 metrics. Below is the detailed single-metric analysis."
                )
                parts.append("")
                for m in all_metrics:
                    parts.extend(_metric_detail_block(m))
            else:
                parts.append(
                    f"Examining relationships between {len(all_metrics)} indicators. "
                    f"Note: Only visibly supported relationships are described — "
                    f"no statistical significance is claimed without explicit testing."
                )
                parts.append("")
                for i, m1 in enumerate(all_metrics):
                    for m2 in all_metrics[i + 1:]:
                        s1, s2 = m1["stats"], m2["stats"]
                        same_dir = (s1.get("trend") == s2.get("trend") and s1.get("trend") != "Stable")
                        opp_dir = (
                            s1.get("trend") in ("Rising", "Falling") and
                            s2.get("trend") in ("Rising", "Falling") and
                            s1.get("trend") != s2.get("trend")
                        )
                        parts.append(f"### {m1['name']} vs {m2['name']}")
                        parts.append("")
                        if same_dir:
                            parts.append(
                                f"Both indicators are **{s1['trend'].lower()}**, suggesting a possible "
                                f"co-movement. {m1['name']} changed {'+' if s1.get('pct_change', 0) > 0 else ''}"
                                f"{s1.get('pct_change', 0)}% while {m2['name']} changed "
                                f"{'+' if s2.get('pct_change', 0) > 0 else ''}{s2.get('pct_change', 0)}%. "
                                f"This pattern is consistent with {'a common underlying driver' if insight_mode == 'correlation' else 'one indicator leading the other'}, "
                                f"but causality cannot be confirmed from the available data."
                            )
                        elif opp_dir:
                            parts.append(
                                f"These indicators move in **opposite directions**: {m1['name']} is "
                                f"{s1['trend'].lower()} while {m2['name']} is {s2['trend'].lower()}. "
                                f"This divergence may indicate a compensatory relationship or "
                                f"independent drivers affecting each metric."
                            )
                        else:
                            parts.append(
                                f"No clear directional relationship observed. {m1['name']} is "
                                f"{s1.get('trend', 'Stable').lower()} while {m2['name']} is "
                                f"{s2.get('trend', 'Stable').lower()}."
                            )
                        parts.append("")
                for m in all_metrics:
                    parts.extend(_metric_detail_block(m))
            parts.extend(_full_ranking_section())
            return "\n".join(parts)

        if insight_mode in ("seasonal", "forecast"):
            mode_title = "Seasonal Pattern Analysis" if insight_mode == "seasonal" else "Trend Forecast"
            parts.append(f"## {mode_title} — {chart_name or 'Chart'}")
            parts.append("")
            for m in all_metrics:
                s = m["stats"]
                pct = s.get("pct_change", 0)
                parts.append(f"### {m['name']}")
                parts.append("")
                parts.append(_prose_trend(m["name"], s, label_col, rows, m["col"]))
                parts.append("")
                if insight_mode == "forecast":
                    if s.get("trend") == "Rising":
                        parts.append(
                            f"If the current trajectory continues, {m['name']} may exceed "
                            f"**{_format_number(s['max'] * 1.1)}** in coming periods. "
                            f"This projection assumes stable reporting and no intervention."
                        )
                    elif s.get("trend") == "Falling":
                        parts.append(
                            f"At the current rate of decline ({pct}%), {m['name']} may drop "
                            f"below **{_format_number(s['min'] * 0.9)}** in the near term. "
                            f"Verify whether this reflects real improvement before celebrating."
                        )
                    else:
                        parts.append(
                            f"The indicator is stable — near-term values are likely to remain "
                            f"in the range of {_format_number(s['min'])} to {_format_number(s['max'])}."
                        )
                else:
                    parts.append(
                        f"Without multi-period granular data, definitive seasonal patterns "
                        f"cannot be confirmed. The current trend ({s.get('trend', 'Stable')}) "
                        f"may or may not reflect seasonality."
                    )
                parts.append("")
            parts.extend(_metric_detail_block(all_metrics[0]))
            parts.extend(_full_ranking_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "cross_chart":
            # For chart-level request, cross-chart doesn't apply
            parts.append(f"## Cross-Chart Analysis — {chart_name or 'Chart'}")
            parts.append("")
            parts.append(
                "Cross-chart pattern analysis applies to dashboard scope where multiple "
                "charts are available for synthesis. For this single chart, below is the "
                "comprehensive analysis of all available metrics."
            )
            parts.append("")
            for m in all_metrics:
                parts.extend(_metric_detail_block(m))
            parts.extend(_full_ranking_section())
            parts.extend(_disparity_section())
            parts.extend(_risk_section())
            parts.extend(_recommendations_section())
            return "\n".join(parts)

        # ── FALL THROUGH: deep_dive / any unhandled mode ──
        # Generates the full 7-section comprehensive report.

        # ── 1. Executive Summary ──
        parts.append(f"## {p_name} ranges from {_format_number(p_stats['min'])} to {_format_number(p_stats['max'])} across {n_entities} entities")
        parts.append("")
        # Key takeaway bullet
        if top_entity and bot_entity and top_val and bot_val:
            gap = top_val - bot_val
            ratio = round(top_val / bot_val, 1) if bot_val > 0 else 0
            parts.append(
                f"- **Widest gap**: **{top_entity}** ({_format_number(top_val)}) vs "
                f"**{bot_entity}** ({_format_number(bot_val)}) — a **{_format_number(gap)}** "
                f"point difference ({ratio}x ratio)"
            )
        parts.append(f"- **Average across entities**: **{_format_number(p_stats['avg'])}**")
        if p_stats.get("pct_change") is not None:
            sign = "+" if p_stats["pct_change"] > 0 else ""
            parts.append(f"- **Overall trend**: {p_stats['trend']} ({sign}{p_stats['pct_change']}%)")
        # Count entities above/below average
        if label_col and sorted_entities:
            above_avg = sum(1 for r in sorted_entities if float(r.get(primary["col"], 0)) > p_stats["avg"])
            below_avg = n_entities - above_avg
            parts.append(f"- **{above_avg} entities** above average, **{below_avg}** below average")
        for m in all_metrics[1:3]:
            s = m["stats"]
            parts.append(f"- **{m['name']}**: avg **{_format_number(s['avg'])}**, range {_format_number(s['min'])} to {_format_number(s['max'])}")
        parts.append("")

        # ── 2. Performance Overview Table ──
        parts.append("## Performance Overview")
        parts.append("")
        parts.append("| Indicator | Average | Min | Max | Trend | Status |")
        parts.append("|-----------|---------|-----|-----|-------|--------|")
        for m in all_metrics:
            s = m["stats"]
            trend = s.get("trend", "Stable")
            sev = _severity_for_pct(s.get("pct_change", 0), trend)
            parts.append(
                f"| {m['name']} | {_format_number(s['avg'])} | "
                f"{_format_number(s['min'])} | {_format_number(s['max'])} | "
                f"{trend} | {sev} |"
            )
        parts.append("")

        # ── 3. Entity Ranking ──
        if label_col and len(sorted_entities) >= 3:
            parts.append(f"## {_clean_name(label_col)} Ranking by {p_name}")
            parts.append("")
            tbl = _entity_table(rows, label_col, primary["col"], p_name, max_rows=min(n_entities, 15))
            parts.extend(tbl)
            parts.append("")

        # ── 4. Detailed Analysis ──
        parts.append("## Detailed Analysis")
        parts.append("")
        for m in all_metrics:
            s = m["stats"]
            name = m["name"]
            sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
            parts.append(sev)
            parts.append("")
            parts.append(f"### {name}")
            parts.append("")
            parts.append(_prose_trend(name, s, label_col, rows, m["col"]))
            parts.append("")

            # Add entity distribution analysis
            if label_col and len(sorted_entities) >= 4:
                col = m["col"]
                valid = [r for r in rows if r.get(col) is not None]
                sorted_by = sorted(valid, key=lambda r: float(r.get(col, 0)), reverse=True)
                # Top 3
                top3 = sorted_by[:3]
                bot3 = sorted_by[-3:]
                parts.append("**Top performers:**")
                for r in top3:
                    parts.append(f"- {r.get(label_col, '?')}: **{_format_number(float(r.get(col, 0)))}**")
                parts.append("")
                parts.append("**Entities requiring attention:**")
                for r in reversed(bot3):
                    val = float(r.get(col, 0))
                    parts.append(f"- {r.get(label_col, '?')}: **{_format_number(val)}**")
                parts.append("")

                # Quartile analysis
                vals = sorted([float(r.get(col, 0)) for r in valid])
                q1_idx = len(vals) // 4
                q3_idx = 3 * len(vals) // 4
                if q1_idx < q3_idx:
                    q1 = vals[q1_idx]
                    q3 = vals[q3_idx]
                    iqr = q3 - q1
                    outlier_threshold = q3 + 1.5 * iqr
                    outliers = [r for r in valid if float(r.get(col, 0)) > outlier_threshold]
                    if outliers:
                        names = ", ".join(str(r.get(label_col, "?")) for r in outliers[:3])
                        parts.append(f"**Outliers** (>{_format_number(outlier_threshold)}): {names}")
                        parts.append("")

            viz_label = VIZ_RECS.get(viz_type, "")
            if viz_label:
                parts.append(f"[{viz_label} recommended]")
                parts.append("")

        # ── 5. Geographic/Entity Disparity Analysis ──
        if label_col and len(sorted_entities) >= 4:
            parts.append("## Disparity Analysis")
            parts.append("")
            if top_entity and bot_entity and top_val is not None and bot_val is not None:
                gap = top_val - bot_val
                ratio = round(top_val / bot_val, 1) if bot_val > 0 else 0
                parts.append(
                    f"The data reveals **significant disparity** across {_clean_name(label_col).lower()} entities. "
                    f"**{top_entity}** leads with a {p_name} of **{_format_number(top_val)}**, "
                    f"while **{bot_entity}** is at **{_format_number(bot_val)}** — "
                    f"a **{ratio}x difference**."
                )
                parts.append("")
                # Group into tiers
                avg = p_stats["avg"]
                high_tier = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > avg * 1.2]
                mid_tier = [r for r in sorted_entities if avg * 0.8 <= float(r.get(primary["col"], 0)) <= avg * 1.2]
                low_tier = [r for r in sorted_entities if float(r.get(primary["col"], 0)) < avg * 0.8]
                parts.append(f"- **High tier** (>{_format_number(avg * 1.2)}): {len(high_tier)} entities")
                parts.append(f"- **Middle tier** ({_format_number(avg * 0.8)} - {_format_number(avg * 1.2)}): {len(mid_tier)} entities")
                parts.append(f"- **Low tier** (<{_format_number(avg * 0.8)}): {len(low_tier)} entities")
                parts.append("")
                if high_tier:
                    names = ", ".join(str(r.get(label_col, "?")) for r in high_tier[:5])
                    parts.append(f"**High-tier entities**: {names}")
                if low_tier:
                    names = ", ".join(str(r.get(label_col, "?")) for r in low_tier[:5])
                    parts.append(f"**Low-tier entities requiring intervention**: {names}")
                parts.append("")

        # ── 6. Risk and Issue Analysis ──
        parts.append("## Risk and Issue Analysis")
        parts.append("")
        risk_count = 0
        for m in all_metrics:
            s = m["stats"]
            name = m["name"]
            pct = s.get("pct_change")
            if pct is not None and abs(pct) > 10:
                risk_count += 1
                sev = _severity_for_pct(pct, s["trend"])
                parts.append(sev)
                parts.append("")
                if s["trend"] == "Rising" and abs(pct) > 15:
                    parts.append(
                        f"- **{name} surge risk**: Rose by **+{pct}%**. If this trend continues, "
                        f"it may strain resources and capacity. Requires root cause analysis."
                    )
                elif s["trend"] == "Falling" and abs(pct) > 15:
                    parts.append(
                        f"- **{name} decline risk**: Fell by **{pct}%**. This may indicate "
                        f"reduced reporting, service disruption, or genuine improvement requiring verification."
                    )
                else:
                    parts.append(
                        f"- **{name} volatility**: Changed by **{'+' if pct > 0 else ''}{pct}%** "
                        f"({s['trend']}). Continued monitoring warranted."
                    )
                parts.append("")
        # Entity-level risks
        if label_col and sorted_entities:
            avg = p_stats["avg"]
            critical_entities = [r for r in sorted_entities if float(r.get(primary["col"], 0)) > avg * 1.5]
            if critical_entities:
                risk_count += 1
                names = ", ".join(str(r.get(label_col, "?")) for r in critical_entities[:4])
                parts.append(
                    f"- **Concentration risk**: {len(critical_entities)} entities exceed 1.5x the average "
                    f"({names}). These represent hotspots requiring prioritized attention."
                )
                parts.append("")
        if risk_count == 0:
            parts.append("- No significant risks identified. All metrics within moderate bounds.")
            parts.append("")

        # ── 7. Action Recommendations ──
        parts.append("## Action Recommendations")
        parts.append("")
        rec_num = 0

        # Recommendation 1: address the biggest disparity
        if top_entity and bot_entity and top_val is not None and bot_val is not None:
            gap = top_val - bot_val
            if gap > 0:
                rec_num += 1
                parts.append(
                    f"{rec_num}. **Investigate {top_entity} ({p_name}: {_format_number(top_val)})**: "
                    f"This entity is the highest in the dataset, significantly above the average of "
                    f"{_format_number(p_stats['avg'])}. Determine whether this reflects a genuine "
                    f"hotspot or a data quality issue. **Benefit**: Targeted intervention at the "
                    f"highest-burden entity yields the greatest impact. **Risk if ignored**: "
                    f"Unchecked escalation in the highest-performing area."
                )
                parts.append("")

        # Recommendation 2: address entities needing improvement
        if label_col and sorted_entities:
            low_entities = sorted_entities[-3:]
            if low_entities:
                rec_num += 1
                names = ", ".join(str(r.get(label_col, "?")) for r in low_entities)
                parts.append(
                    f"{rec_num}. **Support low-performing entities ({names})**: These entities "
                    f"have the lowest {p_name} values. Conduct root cause analysis to determine "
                    f"whether low values reflect underreporting, resource gaps, or genuine low burden. "
                    f"**Benefit**: Ensures equitable resource allocation. "
                    f"**Risk if ignored**: Hidden problems may go undetected."
                )
                parts.append("")

        # Metric-specific recommendations
        for m in all_metrics:
            s = m["stats"]
            pct = s.get("pct_change")
            if pct is None:
                continue
            name = m["name"]
            trend = s["trend"]
            if abs(pct) > 10:
                rec_num += 1
                if trend == "Rising":
                    parts.append(
                        f"{rec_num}. **Monitor {name} increase (+{pct}%)**: Determine root causes "
                        f"and assess whether intervention is needed. **Benefit**: Early action "
                        f"prevents escalation. **Risk if ignored**: Unchecked growth may "
                        f"overwhelm systems."
                    )
                else:
                    parts.append(
                        f"{rec_num}. **Verify {name} decline ({pct}%)**: Confirm whether this "
                        f"reflects genuine improvement or reporting gaps. **Benefit**: Confirms "
                        f"progress or identifies hidden problems. **Risk if ignored**: False "
                        f"confidence from incomplete data."
                    )
                parts.append("")
            if rec_num >= 6:
                break

        # Always include a data quality recommendation
        rec_num += 1
        parts.append(
            f"{rec_num}. **Validate data completeness and accuracy**: Cross-reference reported "
            f"values against facility registers and alternative data sources. Ensure all "
            f"{n_entities} entities are reporting consistently. **Benefit**: Informed decision-making. "
            f"**Risk if ignored**: Decisions based on incomplete data."
        )
        parts.append("")

        if rec_num < 3:
            rec_num += 1
            parts.append(
                f"{rec_num}. **Maintain routine monitoring**: Continue tracking {p_name} across all "
                f"entities. Set alert thresholds for values exceeding {_format_number(p_stats['avg'] * 1.5)}. "
                f"**Benefit**: Early detection of emerging patterns. "
                f"**Risk if ignored**: Delayed response to deteriorating trends."
            )
            parts.append("")

        # ── 8. Suggested Visualizations ──
        parts.append("## Suggested Visualizations")
        parts.append("")
        viz_num = 0
        # Primary chart recommendation based on data shape
        has_time = any(
            col.lower().replace(" ", "_") in {
                "period", "periodid", "period_id", "date", "month", "year",
                "quarter", "week", "day",
            }
            for col in label_cols
        ) if label_cols else False
        if has_time and len(all_metrics) >= 1:
            viz_num += 1
            metric_names = ", ".join(m["name"] for m in all_metrics[:3])
            parts.append(
                f"{viz_num}. **Trend Line Chart**: Plot {metric_names} over time to visualize "
                f"temporal patterns and identify inflection points. Use `echarts_timeseries_line`."
            )
        if label_col and n_entities >= 3:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Ranked Bar Chart**: Compare {p_name} across {_clean_name(label_col).lower()} "
                f"entities to highlight disparities. Use `echarts_timeseries_bar` sorted descending."
            )
        if len(all_metrics) >= 2:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Scatter Plot**: Plot {all_metrics[0]['name']} vs {all_metrics[1]['name']} "
                f"to explore correlations between indicators. Use `echarts_timeseries_scatter`."
            )
        if label_col and n_entities >= 5:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Heatmap**: Cross-tabulate {_clean_name(label_col).lower()} entities "
                f"against indicators to spot concentration patterns. Use `heatmap_v2`."
            )
        if n_entities >= 4:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Big Number KPIs**: Display {p_name} average ({_format_number(p_stats['avg'])}) "
                f"and trend as headline KPIs for executive dashboards. Use `big_number_total`."
            )
        if label_col and n_entities >= 3 and n_entities <= 15:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Pie Chart**: Show proportional share of {p_name} across "
                f"entities. Use `pie` chart type."
            )
        if viz_num == 0:
            parts.append("- Data table recommended for the current dataset structure.")
        parts.append("")

        # ── Data quality footer ──
        parts.extend(_data_quality_section())

    # ================================================================
    # DASHBOARD MODE
    # ================================================================
    else:
        charts = context_payload.get("charts") or []

        # First pass: collect all chart stats
        chart_data: list[dict] = []
        for chart_entry in charts[:12]:
            c = chart_entry.get("chart") or {}
            cname = c.get("name") or c.get("slice_name") or "Unnamed Chart"
            viz = c.get("viz_type") or "unknown"
            qr = chart_entry.get("query_result") or {}
            rows, columns = _extract(qr)

            # Skip charts with all-zero / trivial data
            if _is_trivial_data(rows):
                continue

            numeric_cols, label_cols = _classify(rows, columns)
            label_col = label_cols[0] if label_cols else None
            metrics = []
            for col in numeric_cols[:3]:
                stats = _compute_column_stats(rows, col)
                if stats:
                    metrics.append({"col": col, "stats": stats, "name": _clean_name(col)})
            chart_data.append({
                "cname": cname, "viz": viz, "rows": rows, "columns": columns,
                "numeric_cols": numeric_cols, "label_col": label_col, "metrics": metrics,
            })

        n_charts = len(chart_data)
        n_with_data = sum(1 for cd in chart_data if cd["metrics"])

        # ── Shared dashboard helpers ──────────────────────────────────

        def _chart_by_chart_section() -> list[str]:
            """Detailed per-chart analysis — reusable across modes."""
            blk: list[str] = []
            blk.append("## Detailed Analysis — Chart by Chart")
            blk.append("")
            for cd in chart_data:
                cname = cd["cname"]
                viz = cd["viz"]
                viz_label = VIZ_RECS.get(viz, viz)
                if not cd["metrics"]:
                    blk.append(f"### {cname}")
                    blk.append("")
                    blk.append("No quantitative data available for this chart.")
                    blk.append("")
                    continue
                lead_m = cd["metrics"][0]
                lead_s = lead_m["stats"]
                if lead_s.get("pct_change") is not None and abs(lead_s["pct_change"]) > 5:
                    sign = "+" if lead_s["pct_change"] > 0 else ""
                    heading = f"### {cname} — {lead_m['name']} {lead_s['trend'].lower()} {sign}{lead_s['pct_change']}%"
                else:
                    heading = f"### {cname} — stable at {_format_number(lead_s['avg'])}"
                blk.append(heading)
                blk.append("")
                if lead_s.get("pct_change") is not None and abs(lead_s["pct_change"]) > 5:
                    blk.append(
                        f"{lead_m['name']} shows a **{lead_s['trend'].lower()}** trend "
                        f"with a **{'+' if lead_s['pct_change'] > 0 else ''}{lead_s['pct_change']}%** change, "
                        f"averaging **{_format_number(lead_s['avg'])}** across the dataset."
                    )
                else:
                    blk.append(
                        f"{lead_m['name']} remains broadly stable, "
                        f"averaging **{_format_number(lead_s['avg'])}** across the period."
                    )
                blk.append("")
                worst_sev = "[INFO]"
                sev_rank = {"[CRITICAL]": 3, "[WARNING]": 2, "[INFO]": 1, "[GOOD]": 0}
                for m in cd["metrics"]:
                    s = m["stats"]
                    sign = "+" if s.get("pct_change", 0) > 0 else ""
                    sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                    if sev_rank.get(sev, 0) > sev_rank.get(worst_sev, 0):
                        worst_sev = sev
                    blk.append(
                        f"- **{m['name']}**: avg {_format_number(s['avg'])}, "
                        f"range {_format_number(s['min'])} to {_format_number(s['max'])}, "
                        f"change {sign}{s.get('pct_change', 0)}% ({s.get('trend', 'Stable')})"
                    )
                if cd["label_col"] and cd["metrics"]:
                    col = cd["metrics"][0]["col"]
                    sorted_rows = sorted(
                        [r for r in cd["rows"] if r.get(col) is not None],
                        key=lambda r: float(r.get(col, 0)), reverse=True,
                    )
                    if len(sorted_rows) >= 3:
                        top3 = sorted_rows[:3]
                        bot3 = sorted_rows[-3:]
                        top_names = ", ".join(
                            f"**{r.get(cd['label_col'], '?')}** ({_format_number(float(r.get(col, 0)))})"
                            for r in top3)
                        bot_names = ", ".join(
                            f"**{r.get(cd['label_col'], '?')}** ({_format_number(float(r.get(col, 0)))})"
                            for r in reversed(bot3))
                        blk.append(f"- Top 3: {top_names}")
                        blk.append(f"- Bottom 3: {bot_names}")
                blk.append("")
                blk.append(worst_sev)
                if viz_label and viz_label != viz:
                    blk.append(f"[{viz_label} recommended]")
                blk.append("")
            return blk

        def _cross_chart_section() -> list[str]:
            """Cross-chart synthesis section."""
            blk: list[str] = []
            blk.append("## Cross-Chart Synthesis")
            blk.append("")
            rising = [cd for cd in chart_data if any(
                m["stats"].get("trend") == "Rising" and abs(m["stats"].get("pct_change", 0)) > 10
                for m in cd["metrics"]
            )]
            falling = [cd for cd in chart_data if any(
                m["stats"].get("trend") == "Falling" and abs(m["stats"].get("pct_change", 0)) > 10
                for m in cd["metrics"]
            )]
            synth_num = 0
            if rising:
                synth_num += 1
                names = ", ".join(f"**{cd['cname']}**" for cd in rising[:4])
                blk.append(
                    f"{synth_num}. **Rising trends across multiple charts**: {names} all show "
                    f"significant increases. This convergence suggests a systemic pattern "
                    f"rather than isolated variation. These charts should be analyzed together "
                    f"to identify common drivers."
                )
            if falling:
                synth_num += 1
                names = ", ".join(f"**{cd['cname']}**" for cd in falling[:4])
                blk.append(
                    f"{synth_num}. **Declining trends requiring attention**: {names} show "
                    f"notable decreases. Verify whether these reflect genuine improvement, "
                    f"seasonal patterns, or data reporting gaps."
                )
            if rising and falling:
                synth_num += 1
                blk.append(
                    f"{synth_num}. **Contradicting signals**: Some indicators are rising while "
                    f"others are falling. This divergence warrants deeper investigation — "
                    f"determine whether these trends are causally linked or reflect separate dynamics."
                )
            if not rising and not falling:
                synth_num += 1
                blk.append(
                    f"{synth_num}. **Overall stability**: Most indicators show stable trends "
                    f"across the dashboard. No significant cross-chart contradictions detected."
                )
            synth_num += 1
            blk.append(
                f"{synth_num}. **Data coverage**: {n_with_data} of {n_charts} charts returned "
                f"quantitative data for analysis."
                + (f" {n_charts - n_with_data} chart(s) without data may require investigation." if n_charts > n_with_data else "")
            )
            blk.append("")
            return blk

        def _dash_risk_section() -> list[str]:
            """Risk analysis across all dashboard charts."""
            blk: list[str] = []
            blk.append("## Risk and Issue Analysis")
            blk.append("")
            risk_num = 0
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change")
                    if pct is not None and abs(pct) > 15:
                        risk_num += 1
                        sign = "+" if pct > 0 else ""
                        sev = _severity_for_pct(pct, s["trend"])
                        blk.append(sev)
                        blk.append("")
                        blk.append(
                            f"- **{m['name']} in {cd['cname']}**: Changed by **{sign}{pct}%** ({s['trend']}). "
                            f"{'Rapid increase may strain resources and service capacity.' if pct > 0 else 'Decline may signal service disruption, reporting gaps, or positive intervention outcomes.'}"
                        )
                        blk.append(f"- **Evidence**: Avg {_format_number(s['avg'])}, range {_format_number(s['min'])}–{_format_number(s['max'])}")
                        blk.append(f"- **Urgency**: {'High — investigate immediately' if abs(pct) > 30 else 'Moderate — monitor closely'}")
                        blk.append(f"- **Confidence**: {'High — large shift clearly visible' if abs(pct) > 30 else 'Moderate — trend direction clear'}")
                        blk.append("")
                        if risk_num >= 8:
                            break
                if risk_num >= 8:
                    break
            if risk_num == 0:
                blk.append("[GOOD]")
                blk.append("")
                blk.append("- No high-risk trends identified. All metrics within moderate bounds. Continue routine monitoring.")
                blk.append("")
            return blk

        def _dash_recommendations_section() -> list[str]:
            """Action recommendations across all dashboard charts."""
            blk: list[str] = []
            blk.append("## Action Recommendations")
            blk.append("")
            rec_num = 0
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change")
                    if pct is None:
                        continue
                    trend = s["trend"]
                    if abs(pct) > 10:
                        rec_num += 1
                        sign = "+" if pct > 0 else ""
                        if trend == "Rising":
                            blk.append(
                                f"{rec_num}. **Investigate {m['name']} increase in {cd['cname']}** "
                                f"({sign}{pct}%): Determine root causes and deploy targeted interventions. "
                                f"**Benefit**: Early containment prevents escalation. "
                                f"**Risk if ignored**: Unchecked growth may overwhelm systems."
                            )
                        else:
                            blk.append(
                                f"{rec_num}. **Verify {m['name']} decline in {cd['cname']}** "
                                f"({pct}%): Confirm whether this reflects real improvement or "
                                f"reporting failure. **Benefit**: Restores decision-making visibility. "
                                f"**Risk if ignored**: False confidence from incomplete data."
                            )
                        blk.append("")
                        if rec_num >= 6:
                            break
                if rec_num >= 6:
                    break
            rec_num += 1
            blk.append(
                f"{rec_num}. **Establish dashboard review cadence**: Schedule regular reviews "
                f"with key stakeholders. Set automated alerts for metrics that breach critical "
                f"thresholds. **Benefit**: Timely detection and response. "
                f"**Risk if ignored**: Delayed action on emerging problems."
            )
            blk.append("")
            rec_num += 1
            blk.append(
                f"{rec_num}. **Validate data completeness**: Ensure all reporting units are "
                f"submitting data consistently across all {n_charts} charts. Cross-reference "
                f"with alternative data sources. **Benefit**: Informed decision-making. "
                f"**Risk if ignored**: Blind spots in coverage."
            )
            blk.append("")
            return blk

        def _dash_performance_table() -> list[str]:
            """Performance overview table for all charts."""
            blk: list[str] = []
            blk.append("## Performance Overview")
            blk.append("")
            blk.append("| Chart | Indicator | Average | Min | Max | Trend | Status |")
            blk.append("|-------|-----------|---------|-----|-----|-------|--------|")
            for cd in chart_data[:12]:
                for m in cd["metrics"][:2]:
                    s = m["stats"]
                    trend = s.get("trend", "Stable")
                    sev = _severity_for_pct(s.get("pct_change", 0), trend)
                    blk.append(
                        f"| {cd['cname']} | {m['name']} | {_format_number(s['avg'])} | "
                        f"{_format_number(s['min'])} | {_format_number(s['max'])} | {trend} | {sev} |"
                    )
            blk.append("")
            return blk

        def _dash_data_quality_section() -> list[str]:
            """Data quality assessment across dashboard charts."""
            blk: list[str] = []
            blk.append("## Data Quality and Confidence Assessment")
            blk.append("")
            blk.append(f"- **Charts analyzed**: {n_charts}")
            blk.append(f"- **Charts with quantitative data**: {n_with_data}")
            if n_charts > n_with_data:
                blk.append(f"- **Charts without data**: {n_charts - n_with_data} — investigate data pipeline")
            blk.append("")
            for cd in chart_data:
                if not cd["metrics"]:
                    blk.append(f"- **{cd['cname']}**: No data — possible pipeline issue")
                    continue
                m = cd["metrics"][0]
                s = m["stats"]
                issues = []
                null_count = sum(1 for r in cd["rows"] if r.get(m["col"]) is None)
                if null_count > 0:
                    issues.append(f"{null_count} missing values")
                if s["min"] == 0:
                    issues.append("contains zeros")
                if s["max"] > s["avg"] * 3:
                    issues.append(f"possible outlier (max {_format_number(s['max'])} > 3x avg)")
                if s.get("pct_change") is not None and abs(s["pct_change"]) > 50:
                    issues.append(f"large shift ({'+' if s['pct_change'] > 0 else ''}{s['pct_change']}%)")
                issue_str = "; ".join(issues) if issues else "complete, no anomalies"
                blk.append(f"- **{cd['cname']}** ({m['name']}): {s['count']} values — {issue_str}")
            blk.append("")
            confidence = "Low" if n_with_data < n_charts * 0.7 else "Moderate" if n_charts > n_with_data else "High"
            blk.append(f"**Overall decision confidence**: {confidence}")
            blk.append("")
            return blk

        # ════════════════════════════════════════════════════════════════
        # DASHBOARD MODE DISPATCH
        # ════════════════════════════════════════════════════════════════

        if insight_mode == "summary":
            crit = [cd for cd in chart_data if any(abs(m["stats"].get("pct_change", 0)) > 30 for m in cd["metrics"])]
            warn = [cd for cd in chart_data if any(10 < abs(m["stats"].get("pct_change", 0)) <= 30 for m in cd["metrics"]) and cd not in crit]
            parts.append("## Executive Summary")
            parts.append("")
            para = (
                f"**{dash_name or 'This dashboard'}** presents {n_charts} charts, "
                f"of which {n_with_data} provide quantitative data for analysis. "
            )
            if crit:
                para += f"**{len(crit)} chart(s)** show critical-level changes requiring urgent attention. "
            if warn:
                para += f"**{len(warn)} chart(s)** show moderate shifts warranting closer monitoring. "
            movers = []
            for cd in chart_data:
                for m in cd["metrics"][:1]:
                    pct = m["stats"].get("pct_change")
                    if pct is not None and abs(pct) > 10:
                        movers.append((cd["cname"], m["name"], pct, m["stats"]["trend"]))
            if movers:
                top_mover = max(movers, key=lambda x: abs(x[2]))
                sign = "+" if top_mover[2] > 0 else ""
                para += (
                    f"The most notable movement is in **{top_mover[0]}** where {top_mover[1]} "
                    f"{top_mover[3].lower()} {sign}{top_mover[2]}%. "
                )
            stable_count = n_with_data - len(crit) - len(warn)
            if stable_count > 0:
                para += f"{stable_count} chart(s) remain stable."
            parts.append(para)
            parts.append("")
            # Key findings per chart
            parts.append("**Key findings:**")
            parts.append("")
            for cd in chart_data:
                for m in cd["metrics"][:1]:
                    s = m["stats"]
                    pct = s.get("pct_change")
                    sev = _severity_for_pct(pct or 0, s.get("trend", "Stable"))
                    if pct is not None:
                        sign = "+" if pct > 0 else ""
                        verb = "surged" if s["trend"] == "Rising" and abs(pct) > 20 else \
                               "rose" if s["trend"] == "Rising" else \
                               "dropped" if s["trend"] == "Falling" and abs(pct) > 20 else \
                               "fell" if s["trend"] == "Falling" else "held steady"
                        parts.append(
                            f"- {sev} **{cd['cname']}**: {m['name']} {verb} **{sign}{pct}%** "
                            f"(avg {_format_number(s['avg'])})"
                        )
                    elif s.get("avg") is not None:
                        parts.append(f"- [INFO] **{cd['cname']}**: {m['name']} at {_format_number(s['avg'])}")
            parts.append("")
            # Performance table
            parts.extend(_dash_performance_table())
            parts.extend(_cross_chart_section())
            parts.extend(_dash_risk_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "key_takeaways":
            parts.append(f"## Key Takeaways — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"**{dash_name or 'This dashboard'}** covers {n_charts} charts with "
                f"{n_with_data} providing quantitative data. The following are the most "
                f"significant findings across all visualizations."
            )
            parts.append("")
            bullet = 0
            for cd in chart_data:
                for m in cd["metrics"][:1]:
                    s = m["stats"]
                    pct = s.get("pct_change")
                    if pct is not None and abs(pct) > 5:
                        bullet += 1
                        sign = "+" if pct > 0 else ""
                        sev = _severity_for_pct(pct, s["trend"])
                        parts.append(
                            f"{bullet}. {sev} **{cd['cname']}** — {m['name']} {s['trend'].lower()} "
                            f"{sign}{pct}%: Averaging {_format_number(s['avg'])} "
                            f"(range {_format_number(s['min'])}–{_format_number(s['max'])}). "
                            f"{'This escalation warrants investigation.' if pct > 20 else ''}"
                            f"{'Verify whether this decline reflects improvement or reporting gap.' if pct < -20 else ''}"
                        )
                        parts.append("")
            # Add stable charts for completeness
            for cd in chart_data:
                if not cd["metrics"]:
                    continue
                m = cd["metrics"][0]
                s = m["stats"]
                if s.get("pct_change") is None or abs(s.get("pct_change", 0)) <= 5:
                    bullet += 1
                    parts.append(
                        f"{bullet}. [INFO] **{cd['cname']}** — {m['name']} stable at "
                        f"{_format_number(s['avg'])} (range {_format_number(s['min'])}–{_format_number(s['max'])})"
                    )
                    parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_cross_chart_section())
            return "\n".join(parts)

        if insight_mode == "executive_brief":
            crit = [cd for cd in chart_data if any(abs(m["stats"].get("pct_change", 0)) > 30 for m in cd["metrics"])]
            parts.append(f"## Executive Brief — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"**{dash_name or 'This dashboard'}** covers {n_charts} visualizations "
                f"with {n_with_data} providing quantitative data. "
                + (f"**{len(crit)} critical alert(s)** detected. " if crit else "No critical alerts. ")
                + f"Overall decision posture: **{'Action required' if crit else 'Monitor'}**."
            )
            parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_chart_by_chart_section())
            parts.extend(_dash_risk_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "risk_analysis":
            parts.append(f"## Risk and Issue Analysis — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"This risk assessment covers {n_charts} charts in "
                f"**{dash_name or 'this dashboard'}**, identifying metrics and charts "
                f"that pose operational, clinical, or data quality risks."
            )
            parts.append("")
            # Detailed risk per chart with context
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change")
                    if pct is not None and abs(pct) > 10:
                        sev = _severity_for_pct(pct, s["trend"])
                        sign = "+" if pct > 0 else ""
                        parts.append(sev)
                        parts.append("")
                        parts.append(f"### {m['name']} in {cd['cname']}")
                        parts.append("")
                        parts.append(
                            f"{m['name']} changed by **{sign}{pct}%** ({s['trend']}), averaging "
                            f"**{_format_number(s['avg'])}** (range {_format_number(s['min'])}–{_format_number(s['max'])})."
                        )
                        parts.append("")
                        parts.append(f"- **Risk**: {'Rapid increase may strain resources' if pct > 0 else 'Decline may signal disruption or reporting gap'}")
                        parts.append(f"- **Evidence**: Avg {_format_number(s['avg'])}, range {_format_number(s['min'])}–{_format_number(s['max'])}")
                        parts.append(f"- **Likely impact**: {'Resource strain and capacity concerns' if pct > 0 else 'Possible service disruption or false improvement signal'}")
                        parts.append(f"- **Urgency**: {'High — investigate immediately' if abs(pct) > 30 else 'Moderate — monitor closely'}")
                        parts.append(f"- **Confidence**: {'High — large shift clearly visible' if abs(pct) > 30 else 'Moderate — direction is clear but data quality may influence magnitude'}")
                        parts.append("")
                        # Entity-level detail if available
                        if cd["label_col"] and cd["rows"]:
                            col = m["col"]
                            s_rows = sorted(
                                [r for r in cd["rows"] if r.get(col) is not None],
                                key=lambda r: float(r.get(col, 0)), reverse=True,
                            )
                            if len(s_rows) >= 2:
                                parts.append(f"- **Highest**: {s_rows[0].get(cd['label_col'], '?')} ({_format_number(float(s_rows[0].get(col, 0)))})")
                                parts.append(f"- **Lowest**: {s_rows[-1].get(cd['label_col'], '?')} ({_format_number(float(s_rows[-1].get(col, 0)))})")
                                parts.append("")
            # Charts with no risk
            stable = [cd for cd in chart_data if cd["metrics"] and all(
                abs(m["stats"].get("pct_change", 0)) <= 10 for m in cd["metrics"]
            )]
            if stable:
                parts.append("### Stable Charts (No Immediate Risk)")
                parts.append("")
                for cd in stable:
                    m = cd["metrics"][0]
                    parts.append(f"- [GOOD] **{cd['cname']}**: {m['name']} stable at {_format_number(m['stats']['avg'])}")
                parts.append("")
            parts.extend(_dash_data_quality_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "critical_alerts":
            parts.append(f"## Critical Alerts — {dash_name or 'Dashboard'}")
            parts.append("")
            alert_found = False
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change", 0)
                    if abs(pct) > 20:
                        alert_found = True
                        sign = "+" if pct > 0 else ""
                        parts.append("[CRITICAL]")
                        parts.append("")
                        parts.append(f"### {m['name']} in {cd['cname']} — {'Surged' if pct > 0 else 'Dropped'} {sign}{pct}%")
                        parts.append("")
                        parts.append(
                            f"{m['name']} {'surged' if pct > 0 else 'dropped'} **{sign}{pct}%**, "
                            f"averaging **{_format_number(s['avg'])}** (range {_format_number(s['min'])}–{_format_number(s['max'])})."
                        )
                        parts.append("")
                        parts.append(f"- **Alert**: {m['name']} in {cd['cname']} {'surged' if pct > 0 else 'dropped'} {sign}{pct}%")
                        parts.append(f"- **Evidence**: Avg {_format_number(s['avg'])}, range {_format_number(s['min'])}–{_format_number(s['max'])}")
                        parts.append(f"- **Immediate implication**: {'Possible escalation requiring urgent review' if pct > 0 else 'Possible reporting gap or service disruption'}")
                        parts.append(f"- **Recommended immediate check**: Verify data source, compare with facility-level records, confirm reporting completeness")
                        parts.append("")
                        if cd["label_col"] and cd["rows"]:
                            col = m["col"]
                            s_rows = sorted(
                                [r for r in cd["rows"] if r.get(col) is not None],
                                key=lambda r: float(r.get(col, 0)), reverse=True,
                            )
                            if len(s_rows) >= 3:
                                lbl = cd["label_col"]
                                top_str = ", ".join(f"{r.get(lbl, '?')} ({_format_number(float(r.get(col, 0)))})" for r in s_rows[:3])
                                bot_str = ", ".join(f"{r.get(lbl, '?')} ({_format_number(float(r.get(col, 0)))})" for r in reversed(s_rows[-3:]))
                                parts.append(f"- Top entities: {top_str}")
                                parts.append(f"- Bottom entities: {bot_str}")
                                parts.append("")
            if not alert_found:
                parts.append("[GOOD]")
                parts.append("")
                parts.append("No critical alerts detected across the dashboard.")
                parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_dash_data_quality_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode in ("strategic_recommendations", "improvement"):
            parts.append(f"## Strategic Recommendations — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"Based on the analysis of {n_charts} charts in "
                f"**{dash_name or 'this dashboard'}**, the following evidence-based "
                f"recommendations are prioritized by urgency and expected impact."
            )
            parts.append("")
            # Evidence base
            parts.extend(_dash_performance_table())
            parts.extend(_chart_by_chart_section())
            # Recommendations
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "concerning_trends":
            parts.append(f"## Concerning Trends — {dash_name or 'Dashboard'}")
            parts.append("")
            found = False
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change", 0)
                    if abs(pct) > 5 and s.get("trend") != "Stable":
                        found = True
                        sign = "+" if pct > 0 else ""
                        sev = _severity_for_pct(pct, s["trend"])
                        parts.append(sev)
                        parts.append("")
                        parts.append(f"### {m['name']} in {cd['cname']} — {s['trend']} ({sign}{pct}%)")
                        parts.append("")
                        parts.append(
                            f"{m['name']} shows a **{s['trend'].lower()}** trend, averaging "
                            f"**{_format_number(s['avg'])}** (range {_format_number(s['min'])}–{_format_number(s['max'])})."
                        )
                        parts.append("")
                        parts.append(
                            f"**Interpretation**: This {'could reflect escalating burden that may strain resources' if pct > 0 else 'may indicate reporting gaps, seasonal variation, or genuine improvement'}. "
                            f"{'Urgent investigation recommended.' if abs(pct) > 30 else 'Closer monitoring advised.'}"
                        )
                        parts.append("")
                        if cd["label_col"] and cd["rows"]:
                            col = m["col"]
                            s_rows = sorted(
                                [r for r in cd["rows"] if r.get(col) is not None],
                                key=lambda r: float(r.get(col, 0)), reverse=True,
                            )
                            if len(s_rows) >= 2:
                                parts.append(f"- Most affected: **{s_rows[0].get(cd['label_col'], '?')}** ({_format_number(float(s_rows[0].get(col, 0)))})")
                                parts.append(f"- Least affected: **{s_rows[-1].get(cd['label_col'], '?')}** ({_format_number(float(s_rows[-1].get(col, 0)))})")
                                parts.append("")
            if not found:
                parts.append("No concerning trends detected across dashboard charts. All metrics are stable or showing minor variation.")
                parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_cross_chart_section())
            parts.extend(_dash_data_quality_section())
            return "\n".join(parts)

        if insight_mode == "metrics_attention":
            parts.append(f"## Metrics Needing Attention — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"Assessing {sum(len(cd['metrics']) for cd in chart_data)} indicators across "
                f"{n_charts} charts to identify metrics requiring immediate or near-term attention."
            )
            parts.append("")
            parts.append("| Chart | Metric | Current Signal | Why It Matters | Severity | Follow-up |")
            parts.append("|-------|--------|---------------|----------------|----------|-----------|")
            for cd in chart_data:
                for m in cd["metrics"]:
                    s = m["stats"]
                    pct = s.get("pct_change", 0)
                    sev = _severity_for_pct(pct, s.get("trend", "Stable"))
                    sign = "+" if pct > 0 else ""
                    signal = f"Avg {_format_number(s['avg'])}, {s.get('trend', 'Stable')} ({sign}{pct}%)"
                    why = "Threshold concern" if abs(pct) > 20 else "Trend shift" if abs(pct) > 10 else "Stable"
                    action = "Investigate root cause" if abs(pct) > 20 else "Increase surveillance" if abs(pct) > 10 else "Continue monitoring"
                    parts.append(f"| {cd['cname']} | {m['name']} | {signal} | {why} | {sev} | {action} |")
            parts.append("")
            # Detailed analysis for flagged metrics
            parts.extend(_chart_by_chart_section())
            parts.extend(_dash_risk_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "data_quality":
            parts.append(f"## Data Quality Assessment — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"Assessing data completeness, consistency, and reliability across "
                f"**{dash_name or 'this dashboard'}** ({n_charts} charts)."
            )
            parts.append("")
            parts.extend(_dash_data_quality_section())
            # Detailed per-chart assessment
            parts.extend(_chart_by_chart_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "cross_chart":
            parts.append(f"## Cross-Chart Patterns — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"Synthesizing patterns across {n_charts} charts in "
                f"**{dash_name or 'this dashboard'}** to identify reinforcing signals, "
                f"contradictions, and systemic patterns."
            )
            parts.append("")
            parts.extend(_cross_chart_section())
            # Detailed chart-by-chart for evidence
            parts.extend(_chart_by_chart_section())
            parts.extend(_dash_risk_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "performance_overview":
            parts.append(f"## Performance Overview — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                f"**{dash_name or 'This dashboard'}** contains {n_charts} charts with "
                f"{n_with_data} providing quantitative data."
            )
            parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_chart_by_chart_section())
            parts.extend(_cross_chart_section())
            parts.extend(_dash_risk_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode == "target_achievement":
            parts.append(f"## Target Achievement — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.append(
                "No explicit target or benchmark was provided in the supplied context. "
                "The following assessment uses derived baselines (chart averages) as proxy "
                "targets to evaluate relative performance."
            )
            parts.append("")
            for cd in chart_data:
                if not cd["metrics"]:
                    continue
                m = cd["metrics"][0]
                s = m["stats"]
                parts.append(f"### {cd['cname']} — {m['name']}")
                parts.append("")
                parts.append(f"- **Derived target (average)**: {_format_number(s['avg'])}")
                parts.append(f"- **Range**: {_format_number(s['min'])} to {_format_number(s['max'])}")
                if cd["label_col"]:
                    valid = [r for r in cd["rows"] if r.get(m["col"]) is not None]
                    above = sum(1 for r in valid if float(r.get(m["col"], 0)) >= s["avg"])
                    parts.append(f"- **Entities meeting target**: {above} of {len(valid)}")
                sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                parts.append(f"- **Status**: {sev} {s.get('trend', 'Stable')}")
                parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode in ("period_comparison", "seasonal", "forecast"):
            titles = {"period_comparison": "Period Comparison", "seasonal": "Seasonal Pattern Analysis", "forecast": "Trend Forecast"}
            parts.append(f"## {titles.get(insight_mode, 'Analysis')} — {dash_name or 'Dashboard'}")
            parts.append("")
            has_period = any(any(m["stats"].get("pct_change") is not None for m in cd["metrics"]) for cd in chart_data)
            if not has_period and insight_mode == "period_comparison":
                parts.append(
                    "Period comparison cannot be confirmed from the supplied context. "
                    "Below is the current-period analysis."
                )
                parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_chart_by_chart_section())
            parts.extend(_cross_chart_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        if insight_mode in ("outlier_analysis", "distribution", "correlation", "leading_lagging"):
            titles = {
                "outlier_analysis": "Outlier Analysis",
                "distribution": "Distribution Analysis",
                "correlation": "Correlation Analysis",
                "leading_lagging": "Leading vs Lagging Indicators",
            }
            parts.append(f"## {titles.get(insight_mode, 'Analysis')} — {dash_name or 'Dashboard'}")
            parts.append("")
            parts.extend(_dash_performance_table())
            parts.extend(_chart_by_chart_section())
            parts.extend(_cross_chart_section())
            parts.extend(_dash_data_quality_section())
            parts.extend(_dash_recommendations_section())
            return "\n".join(parts)

        # ── FALL THROUGH: deep_dive / any unhandled mode ──
        # Generates the full 7-section comprehensive dashboard report.

        # Identify critical/warning charts
        critical_charts = [cd for cd in chart_data if any(
            abs(m["stats"].get("pct_change", 0)) > 30 for m in cd["metrics"]
        )]
        warning_charts = [cd for cd in chart_data if any(
            10 < abs(m["stats"].get("pct_change", 0)) <= 30 for m in cd["metrics"]
        ) and cd not in critical_charts]
        stable_charts = [cd for cd in chart_data if cd not in critical_charts and cd not in warning_charts and cd["metrics"]]

        # ── 1. Executive Summary ──
        summary_title = f"## Dashboard Analysis: {n_charts} charts analyzed, {len(critical_charts)} critical"
        if not critical_charts:
            summary_title = f"## Dashboard Analysis: {n_charts} charts analyzed, overall stable"
        parts.append(summary_title)
        parts.append("")
        parts.append(f"This dashboard contains **{n_charts} charts** with **{n_with_data}** providing quantitative data.")
        parts.append("")
        for cd in chart_data[:8]:
            for m in cd["metrics"][:1]:
                s = m["stats"]
                if s.get("pct_change") is not None:
                    sign = "+" if s["pct_change"] > 0 else ""
                    verb = "surged" if s["trend"] == "Rising" and abs(s["pct_change"]) > 20 else \
                           "rose" if s["trend"] == "Rising" else \
                           "dropped" if s["trend"] == "Falling" and abs(s["pct_change"]) > 20 else \
                           "fell" if s["trend"] == "Falling" else "held steady"
                    sev = _severity_for_pct(s["pct_change"], s["trend"])
                    parts.append(
                        f"- {sev} **{cd['cname']}**: {m['name']} {verb} **{sign}{s['pct_change']}%** "
                        f"(avg {_format_number(s['avg'])})"
                    )
                elif s.get("avg") is not None:
                    parts.append(
                        f"- [INFO] **{cd['cname']}**: {m['name']} averages **{_format_number(s['avg'])}**"
                    )
        parts.append("")

        # ── 2. Performance Overview ──
        parts.append("## Performance Overview")
        parts.append("")
        parts.append("| Chart | Indicator | Average | Min | Max | Trend | Status |")
        parts.append("|-------|-----------|---------|-----|-----|-------|--------|")
        for cd in chart_data[:10]:
            for m in cd["metrics"][:2]:
                s = m["stats"]
                trend = s.get("trend", "Stable")
                sev = _severity_for_pct(s.get("pct_change", 0), trend)
                parts.append(
                    f"| {cd['cname']} | {m['name']} | {_format_number(s['avg'])} | "
                    f"{_format_number(s['min'])} | {_format_number(s['max'])} | {trend} | {sev} |"
                )
        parts.append("")

        # ── 3. Detailed Analysis — Chart by Chart ──
        parts.append("## Detailed Analysis — Chart by Chart")
        parts.append("")
        for cd in chart_data:
            cname = cd["cname"]
            viz = cd["viz"]
            viz_label = VIZ_RECS.get(viz, viz)

            if not cd["metrics"]:
                parts.append(f"### {cname}")
                parts.append("")
                parts.append("No quantitative data available for this chart.")
                parts.append("")
                continue

            # Insight-led heading
            lead_m = cd["metrics"][0]
            lead_s = lead_m["stats"]
            if lead_s.get("pct_change") is not None and abs(lead_s["pct_change"]) > 5:
                sign = "+" if lead_s["pct_change"] > 0 else ""
                heading = f"### {cname} — {lead_m['name']} {lead_s['trend'].lower()} {sign}{lead_s['pct_change']}%"
            else:
                heading = f"### {cname} — stable at {_format_number(lead_s['avg'])}"
            parts.append(heading)
            parts.append("")

            # Lead paragraph
            if lead_s.get("pct_change") is not None and abs(lead_s["pct_change"]) > 5:
                parts.append(
                    f"{lead_m['name']} shows a **{lead_s['trend'].lower()}** trend "
                    f"with a **{'+' if lead_s['pct_change'] > 0 else ''}{lead_s['pct_change']}%** change, "
                    f"averaging **{_format_number(lead_s['avg'])}** across the dataset."
                )
            else:
                parts.append(
                    f"{lead_m['name']} remains broadly stable, "
                    f"averaging **{_format_number(lead_s['avg'])}** across the period."
                )
            parts.append("")

            # Metric bullets
            worst_sev = "[INFO]"
            sev_rank = {"[CRITICAL]": 3, "[WARNING]": 2, "[INFO]": 1, "[GOOD]": 0}
            for m in cd["metrics"]:
                s = m["stats"]
                sign = "+" if s.get("pct_change", 0) > 0 else ""
                sev = _severity_for_pct(s.get("pct_change", 0), s.get("trend", "Stable"))
                if sev_rank.get(sev, 0) > sev_rank.get(worst_sev, 0):
                    worst_sev = sev
                parts.append(
                    f"- **{m['name']}**: avg {_format_number(s['avg'])}, "
                    f"range {_format_number(s['min'])} to {_format_number(s['max'])}, "
                    f"change {sign}{s.get('pct_change', 0)}% ({s.get('trend', 'Stable')})"
                )

            # Top/bottom entities
            if cd["label_col"] and cd["metrics"]:
                col = cd["metrics"][0]["col"]
                sorted_rows = sorted(
                    [r for r in cd["rows"] if r.get(col) is not None],
                    key=lambda r: float(r.get(col, 0)),
                    reverse=True,
                )
                if len(sorted_rows) >= 3:
                    top3 = sorted_rows[:3]
                    bot3 = sorted_rows[-3:]
                    top_names = ", ".join(
                        f"**{r.get(cd['label_col'], '?')}** ({_format_number(float(r.get(col, 0)))})"
                        for r in top3
                    )
                    bot_names = ", ".join(
                        f"**{r.get(cd['label_col'], '?')}** ({_format_number(float(r.get(col, 0)))})"
                        for r in reversed(bot3)
                    )
                    parts.append(f"- Top 3: {top_names}")
                    parts.append(f"- Bottom 3: {bot_names}")
                elif len(sorted_rows) >= 2:
                    top = sorted_rows[0]
                    bot = sorted_rows[-1]
                    parts.append(
                        f"- Highest: **{top.get(cd['label_col'], '?')}** "
                        f"({_format_number(float(top.get(col, 0)))}), "
                        f"Lowest: **{bot.get(cd['label_col'], '?')}** "
                        f"({_format_number(float(bot.get(col, 0)))})"
                    )
            parts.append("")
            parts.append(worst_sev)
            if viz_label and viz_label != viz:
                parts.append(f"[{viz_label} recommended]")
            parts.append("")

        # ── 4. Cross-Chart Synthesis ──
        parts.append("## Cross-Chart Synthesis")
        parts.append("")
        rising = [cd for cd in chart_data if any(
            m["stats"].get("trend") == "Rising" and abs(m["stats"].get("pct_change", 0)) > 10
            for m in cd["metrics"]
        )]
        falling = [cd for cd in chart_data if any(
            m["stats"].get("trend") == "Falling" and abs(m["stats"].get("pct_change", 0)) > 10
            for m in cd["metrics"]
        )]
        synth_num = 0
        if rising:
            synth_num += 1
            names = ", ".join(f"**{cd['cname']}**" for cd in rising[:4])
            parts.append(
                f"{synth_num}. **Rising trends across multiple charts**: {names} all show "
                f"significant increases. This convergence suggests a systemic pattern "
                f"rather than isolated variation. These charts should be analyzed together "
                f"to identify common drivers."
            )
        if falling:
            synth_num += 1
            names = ", ".join(f"**{cd['cname']}**" for cd in falling[:4])
            parts.append(
                f"{synth_num}. **Declining trends requiring attention**: {names} show "
                f"notable decreases. Verify whether these reflect genuine improvement, "
                f"seasonal patterns, or data reporting gaps."
            )
        if rising and falling:
            synth_num += 1
            parts.append(
                f"{synth_num}. **Contradicting signals**: Some indicators are rising while "
                f"others are falling. This divergence warrants deeper investigation — "
                f"determine whether these trends are causally linked or reflect separate dynamics."
            )
        if not rising and not falling:
            synth_num += 1
            parts.append(
                f"{synth_num}. **Overall stability**: Most indicators show stable trends "
                f"across the dashboard. No significant cross-chart contradictions detected. "
                f"Maintain current monitoring cadence."
            )
        synth_num += 1
        parts.append(
            f"{synth_num}. **Data coverage**: {n_with_data} of {n_charts} charts returned "
            f"quantitative data for analysis. Charts without data may require investigation "
            f"into data pipeline status."
        )
        parts.append("")

        # ── 5. Risk and Issue Analysis ──
        parts.append("## Risk and Issue Analysis")
        parts.append("")
        risk_num = 0
        for cd in chart_data:
            for m in cd["metrics"]:
                s = m["stats"]
                pct = s.get("pct_change")
                if pct is not None and abs(pct) > 15:
                    risk_num += 1
                    sign = "+" if pct > 0 else ""
                    sev = _severity_for_pct(pct, s["trend"])
                    parts.append(sev)
                    parts.append("")
                    parts.append(
                        f"- **{m['name']} in {cd['cname']}**: Changed by **{sign}{pct}%** ({s['trend']}). "
                        f"{'Rapid increase may strain resources and service capacity.' if pct > 0 else 'Decline may signal service disruption, reporting gaps, or positive intervention outcomes.'}"
                    )
                    parts.append("")
                    if risk_num >= 6:
                        break
            if risk_num >= 6:
                break
        if risk_num == 0:
            parts.append("[GOOD]")
            parts.append("")
            parts.append("- No high-risk trends identified. All metrics within moderate bounds. Continue routine monitoring.")
            parts.append("")

        # ── 6. Action Recommendations ──
        parts.append("## Action Recommendations")
        parts.append("")
        rec_num = 0
        for cd in chart_data:
            for m in cd["metrics"]:
                s = m["stats"]
                pct = s.get("pct_change")
                if pct is None:
                    continue
                trend = s["trend"]
                if abs(pct) > 10:
                    rec_num += 1
                    sign = "+" if pct > 0 else ""
                    if trend == "Rising":
                        parts.append(
                            f"{rec_num}. **Investigate {m['name']} increase in {cd['cname']}** "
                            f"({sign}{pct}%): Determine root causes and deploy targeted interventions. "
                            f"**Benefit**: Early containment prevents escalation. "
                            f"**Risk if ignored**: Unchecked growth may overwhelm systems."
                        )
                    else:
                        parts.append(
                            f"{rec_num}. **Verify {m['name']} decline in {cd['cname']}** "
                            f"({pct}%): Confirm whether this reflects real improvement or "
                            f"reporting failure. **Benefit**: Restores decision-making visibility. "
                            f"**Risk if ignored**: False confidence from incomplete data."
                        )
                    parts.append("")
                    if rec_num >= 5:
                        break
            if rec_num >= 5:
                break

        # Always include monitoring and data quality recommendations
        rec_num += 1
        parts.append(
            f"{rec_num}. **Establish dashboard review cadence**: Schedule weekly or monthly "
            f"reviews of this dashboard with key stakeholders. Set automated alerts for "
            f"metrics that breach critical thresholds. **Benefit**: Timely detection and "
            f"response. **Risk if ignored**: Delayed action on emerging problems."
        )
        parts.append("")
        rec_num += 1
        parts.append(
            f"{rec_num}. **Validate data completeness**: Ensure all reporting units are "
            f"submitting data consistently across all {n_charts} charts. Cross-reference "
            f"with alternative data sources. **Benefit**: Informed decision-making. "
            f"**Risk if ignored**: Blind spots in coverage."
        )
        parts.append("")

        # ── 7. Suggested Visualizations ──
        parts.append("## Suggested Visualizations")
        parts.append("")
        viz_num = 0
        # Check if any chart has time-series data
        has_time_charts = [cd for cd in chart_data if cd["viz"] in (
            "line", "echarts_timeseries_line", "echarts_timeseries_bar",
            "area", "echarts_area", "mixed_timeseries",
        )]
        has_geo_charts = [cd for cd in chart_data if cd["viz"] in (
            "country_map", "dhis2_map", "vital_maps", "world_map",
        )]
        has_bar_charts = [cd for cd in chart_data if cd["viz"] in (
            "bar", "echarts_timeseries_bar", "dist_bar",
        )]
        # Identify charts with entity dimensions for geographic analysis
        charts_with_entities = [cd for cd in chart_data if cd["label_col"] and len(cd["rows"]) >= 3]

        if charts_with_entities and not has_geo_charts:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Choropleth Map**: Geographic visualization of key indicators "
                f"across entities to highlight regional disparities. Use `dhis2_map` or `vital_maps`."
            )
        if len(chart_data) >= 3:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Summary KPI Row**: Add `big_number_total` cards for the top "
                f"{min(4, len(chart_data))} indicators as a dashboard header for at-a-glance status."
            )
        rising_cd = [cd for cd in chart_data if any(
            m["stats"].get("trend") == "Rising" and abs(m["stats"].get("pct_change", 0)) > 10
            for m in cd["metrics"]
        )]
        if rising_cd and not has_time_charts:
            viz_num += 1
            names = ", ".join(cd["cname"] for cd in rising_cd[:3])
            parts.append(
                f"{viz_num}. **Trend Lines**: Add `echarts_timeseries_line` charts for "
                f"{names} to track temporal patterns of the rising indicators."
            )
        if charts_with_entities and not has_bar_charts:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Ranked Bar Chart**: Add a horizontal bar chart comparing "
                f"entities across key indicators, sorted by value. Use `echarts_timeseries_bar`."
            )
        if len(all_metrics_all := [m for cd in chart_data for m in cd["metrics"]]) >= 4:
            viz_num += 1
            parts.append(
                f"{viz_num}. **Heatmap**: Create a cross-indicator heatmap showing all "
                f"{len(all_metrics_all)} metrics across charts to identify systemic patterns. "
                f"Use `heatmap_v2`."
            )
        if viz_num == 0:
            parts.append("- Current dashboard visualizations provide adequate coverage of the data.")
        parts.append("")

        # ── Data Quality ──
        parts.extend(_dash_data_quality_section())

    return "\n".join(parts)


def _truncate_context_for_local(
    context_payload: dict[str, Any],
    system_prompt: str,
    question: str,
    max_total_chars: int = 20000,
) -> dict[str, Any]:
    """Progressively truncate context to fit within a local model's context window.

    Local models (8B params) typically have 32k token context.  We reserve ~16k
    tokens for generation.  JSON data tokenises at ~2.5 chars/token, so 20k chars
    ≈ 8k tokens — a safe input budget alongside the (condensed) system prompt.
    """
    import copy

    overhead = len(system_prompt) + len(question) + 200
    budget = max(max_total_chars - overhead, 8000)  # at least 8k for context
    compact = _compact_json(context_payload)
    if len(compact) <= budget:
        return context_payload

    ctx = copy.deepcopy(context_payload)
    logger.info(
        "Local context truncation: context=%d budget=%d, applying strategies",
        len(compact), budget,
    )

    # Strategy 1: reduce sample_rows to 5 per chart
    for chart in ctx.get("charts", []):
        qr = chart.get("query_result") or {}
        rows = qr.get("sample_rows")
        if isinstance(rows, list) and len(rows) > 5:
            qr["sample_rows"] = rows[:5]
    if len(_compact_json(ctx)) <= budget:
        return ctx

    # Strategy 2: reduce to 3 rows, limit columns to 10
    for chart in ctx.get("charts", []):
        qr = chart.get("query_result") or {}
        rows = qr.get("sample_rows")
        if isinstance(rows, list) and len(rows) > 3:
            qr["sample_rows"] = rows[:3]
        cols = qr.get("columns")
        if isinstance(cols, list) and len(cols) > 10:
            keep = cols[:10]
            qr["columns"] = keep
            qr["sample_rows"] = [
                {k: v for k, v in row.items() if k in set(keep)}
                for row in (qr.get("sample_rows") or [])
            ]
    if len(_compact_json(ctx)) <= budget:
        return ctx

    # Strategy 3: limit to 6 charts, remove sample_rows
    ctx["charts"] = ctx.get("charts", [])[:6]
    for chart in ctx["charts"]:
        qr = chart.get("query_result") or {}
        qr.pop("sample_rows", None)
    if len(_compact_json(ctx)) <= budget:
        return ctx

    # Strategy 4: limit to 4 charts, strip form_data and query_result
    ctx["charts"] = ctx.get("charts", [])[:4]
    for chart in ctx["charts"]:
        c = chart.get("chart") or {}
        c.pop("form_data", None)
        chart.pop("query_result", None)
        chart.pop("datasource", None)
    if len(_compact_json(ctx)) <= budget:
        return ctx

    # Strategy 5: keep only chart names and viz types
    ctx["charts"] = [
        {"chart": {"name": (c.get("chart") or {}).get("name"), "viz_type": (c.get("chart") or {}).get("viz_type")}}
        for c in ctx.get("charts", [])[:6]
    ]
    return ctx


def _build_text_messages(
    *,
    mode: str,
    question: str,
    context_payload: dict[str, Any],
    conversation: list[dict[str, str]] | None,
    is_local_provider: bool = False,
    provider_type: str | None = None,
) -> list[dict[str, str]]:
    # Detect the insight mode from the question (Summary, Key takeaways, etc.)
    insight_mode = _detect_insight_mode(question)
    mode_spec = _INSIGHT_MODE_SPECS.get(insight_mode, _INSIGHT_MODE_SPECS["deep_dive"])
    user_focus = _extract_user_focus(question, insight_mode)

    # ── System prompt ──
    # Local models get a condensed prompt to fit 32k context.
    # Cloud models get the full analytical framework.
    if is_local_provider:
        if mode == AI_MODE_DASHBOARD:
            system_prompt = _SYSTEM_PROMPT_LOCAL_DASHBOARD
        elif mode == AI_MODE_SQL:
            system_prompt = _SYSTEM_PROMPT_SQL
        else:
            system_prompt = _SYSTEM_PROMPT_LOCAL_CHART
    else:
        if mode == AI_MODE_DASHBOARD:
            system_prompt = _SYSTEM_PROMPT_DASHBOARD
        elif mode == AI_MODE_SQL:
            system_prompt = _SYSTEM_PROMPT_SQL
        else:
            system_prompt = _SYSTEM_PROMPT_CHART

    if (
        is_local_provider
        and provider_type != "localai"
        and mode in (AI_MODE_CHART, AI_MODE_DASHBOARD)
    ):
        context_payload = _truncate_context_for_local(
            context_payload=context_payload,
            system_prompt=system_prompt,
            question=question,
        )

    # ── Context and user message ──
    if provider_type == "localai" and mode in (AI_MODE_CHART, AI_MODE_DASHBOARD):
        evidence_digest = _build_localai_evidence_digest(context_payload, mode)
        scope_label = "dashboard" if mode == AI_MODE_DASHBOARD else "chart"
        report_plan, _ = _build_localai_report_plan(insight_mode, scope_label)

        user_content = f"Requested insight mode: {insight_mode}\n"
        user_content += f"Scope: {scope_label}\n"
        user_content += f"User question: {question}\n"
        user_content += f"Mode instructions: {mode_spec}\n\n"
        user_content += f"Required report plan:\n{report_plan}\n\n"
        if user_focus:
            user_content += (
                "User-specific emphasis:\n"
                f"- Prioritize this focus while staying grounded in the evidence: {user_focus}\n\n"
            )

        user_content += (
            "Generate this insight dynamically from the evidence below.\n"
            "Do not use template wording, boilerplate report language, or prewritten "
            "Python-style summaries.\n"
            "Keep the structure required by the system prompt, but make the content "
            "specific to the user's requested mode and the current evidence.\n"
            "Keep the report complete and evidence-led.\n"
            "Do not copy the evidence block verbatim.\n"
            "Do not output chart scaffolding such as Chart 9, Type, Columns, "
            "Total rows, Metric, Highest, Lowest, or Sample data.\n"
            "Do not echo raw IDs, slugs, or column codes.\n"
            "Do not output placeholders like [STUB] or draft instructions.\n"
            "Use only supported facts from the evidence. If evidence is insufficient, "
            "say so briefly instead of inventing details.\n"
            "For dashboard analysis, synthesize all dashboard contents that contain usable evidence.\n"
            "Ensure the report is complete and not cut off.\n"
            "Return only the finished markdown insight report.\n\n"
        )
        user_content += f"EVIDENCE SUMMARY:\n{evidence_digest}"
    elif is_local_provider and mode in (AI_MODE_CHART, AI_MODE_DASHBOARD):
        # Non-LocalAI local providers still use the deterministic Python report path.
        complete_report = _build_complete_report(context_payload, mode, question)
        logger.info(
            "LOCAL __direct_report__: provider=%s mode=%s insight_mode=%s report_len=%d",
            provider_type,
            mode,
            insight_mode,
            len(complete_report),
        )
        return [{"role": "__direct_report__", "content": complete_report}]
    elif is_local_provider:
        # SQL mode for local — still needs the model
        user_content = f"{question}\n\nContext:\n{_compact_json(context_payload)}"
    else:
        # Cloud providers: analysis draft + raw data + mode instruction
        analysis_draft = ""
        if mode in (AI_MODE_CHART, AI_MODE_DASHBOARD):
            analysis_draft = _build_analysis_draft(context_payload, mode)

        # Build structured user message with mode specification
        user_content = f"Requested insight mode: {insight_mode}\n"
        user_content += f"User question: {question}\n"
        user_content += f"Mode instructions: {mode_spec}\n\n"
        user_content += (
            "IMPORTANT: Generate insights based ONLY on the actual chart/dashboard "
            "data provided below. Every number, entity name, metric, trend, and "
            "finding you mention MUST come from this data. If a value is not in "
            "the data, do NOT mention it. If you are unsure, say so explicitly.\n\n"
        )

        if analysis_draft:
            user_content += (
                f"DATA ANALYSIS DRAFT (pre-computed from the real data — use these "
                f"exact numbers as your foundation):\n\n"
                f"{analysis_draft}\n\n"
            )
        user_content += f"Full data context:\n{_compact_json(context_payload)}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(_trim_conversation(conversation or []))
    messages.append({"role": "user", "content": user_content})

    total = sum(len(m["content"]) for m in messages)
    logger.info(
        "AI prompt: mode=%s local=%s msgs=%d sys=%d user=%d total=%d",
        mode, is_local_provider, len(messages), len(system_prompt),
        len(user_content), total,
    )

    return messages


def _build_sql_messages(
    *,
    question: str,
    database: Database,
    mart_schema_context: list[dict[str, Any]],
    current_sql: str | None,
    conversation: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": _SYSTEM_PROMPT_SQL}]
    messages.extend(_trim_conversation(conversation or []))

    # Compact MART schema: only table name + column names (skip types/descriptions
    # unless they exist and are short) to drastically cut input tokens.
    compact_tables = []
    for tbl in mart_schema_context:
        cols = []
        for col in tbl.get("columns") or []:
            col_entry = col["name"]
            col_type = col.get("type")
            if col_type:
                col_entry += f":{col_type}"
            cols.append(col_entry)
        entry: dict[str, Any] = {"t": tbl["table"], "cols": cols}
        if tbl.get("schema"):
            entry["s"] = tbl["schema"]
        if tbl.get("description"):
            entry["desc"] = tbl["description"][:120]
        compact_tables.append(entry)

    messages.append(
        {
            "role": "user",
            "content": _compact_json(
                {
                    "q": question,
                    "dialect": database.db_engine_spec.engine,
                    "sql": current_sql or "",
                    "tables": compact_tables,
                }
            ),
        }
    )
    return messages


def _audit(
    metadata: AuditMetadata,
    question_length: int = 0,
    response_length: int = 0,
    target_id: str | None = None,
    conversation_id: int | None = None,
    error_message: str | None = None,
) -> None:
    user_id = getattr(getattr(g, "user", None), "id", None)

    logger.info(
        "ai_insights request",
        extra={
            "mode": metadata.mode,
            "provider": metadata.provider,
            "model": metadata.model,
            "duration_ms": metadata.duration_ms,
            "database_backend": metadata.database_backend,
            "status": metadata.status,
            "user_id": user_id,
        },
    )

    # Persist to ai_usage_log table
    try:
        from superset.ai_insights.models import AIUsageLog
        from superset.extensions import db

        log_entry = AIUsageLog(
            user_id=user_id,
            conversation_id=conversation_id,
            mode=metadata.mode,
            provider_id=metadata.provider,
            model_name=metadata.model,
            question_length=question_length,
            response_length=response_length,
            duration_ms=metadata.duration_ms,
            status=metadata.status,
            target_id=target_id,
            error_message=error_message,
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.debug("Failed to persist AI usage log", exc_info=True)


def _build_chart_configs_python(
    datasets_context: list[dict[str, Any]],
    num_charts: int,
    prompt: str = "",
) -> list[dict[str, Any]]:
    """Generate chart configurations in Python for local providers.

    Local models cannot produce valid JSON chart configs, so this function
    builds sensible configs from the dataset schema — producing the same
    quality output that Gemini or other cloud providers would generate.
    """
    _PERIOD_COL_NAMES = {
        "period", "periodid", "period_id", "date", "month", "year",
        "quarter", "week", "day", "fiscal_year", "reporting_period",
        "time", "timestamp",
    }

    charts: list[dict[str, Any]] = []

    for ds in datasets_context:
        ds_id = ds["dataset_id"]
        table_name = ds.get("table_name") or ""
        columns = ds.get("columns") or []
        metrics = ds.get("metrics") or []
        sample = ds.get("sample_rows") or []

        # Classify columns
        numeric_cols: list[str] = []
        label_cols: list[str] = []
        period_cols: list[str] = []

        for col_info in columns:
            col_name = col_info["name"]
            col_type = str(col_info.get("type") or "").upper()

            if col_name.lower().replace(" ", "_") in _PERIOD_COL_NAMES:
                period_cols.append(col_name)
                continue

            if any(t in col_type for t in ("INT", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER")):
                numeric_cols.append(col_name)
            elif any(t in col_type for t in ("VARCHAR", "STRING", "TEXT", "CHAR")):
                label_cols.append(col_name)

        # Also check sample data to refine classification
        if sample and not numeric_cols:
            for col_info in columns:
                col_name = col_info["name"]
                vals = [r.get(col_name) for r in sample[:3] if r.get(col_name) is not None]
                if vals:
                    try:
                        [float(v) for v in vals]
                        if col_name not in period_cols:
                            numeric_cols.append(col_name)
                    except (ValueError, TypeError):
                        if col_name not in period_cols and col_name not in label_cols:
                            label_cols.append(col_name)

        # Use defined metrics if available
        metric_exprs = []
        for m in metrics[:6]:
            expr = m.get("expression") or ""
            name = m.get("name") or ""
            if expr and name:
                metric_exprs.append({"expressionType": "SQL", "sqlExpression": expr, "label": name})

        # Default metrics from numeric columns
        if not metric_exprs and numeric_cols:
            for nc in numeric_cols[:4]:
                metric_exprs.append({
                    "expressionType": "SQL",
                    "sqlExpression": f"SUM({nc})",
                    "label": f"Sum of {nc.replace('_', ' ').title()}",
                })

        if not metric_exprs:
            metric_exprs.append({
                "expressionType": "SQL",
                "sqlExpression": "COUNT(*)",
                "label": "Count",
            })

        label_col = label_cols[0] if label_cols else None
        period_col = period_cols[0] if period_cols else None
        clean_table = table_name.replace("_", " ").title()

        # 1. Big Number KPI for top metric
        if metric_exprs:
            charts.append({
                "slice_name": f"{clean_table} — Key Metric",
                "viz_type": "big_number_total",
                "description": f"Headline KPI for {clean_table}",
                "dataset_id": ds_id,
                "params": {
                    "metric": metric_exprs[0],
                    "viz_type": "big_number_total",
                    "datasource": f"{ds_id}__table",
                },
            })

        # 2. Bar chart by label
        if label_col and metric_exprs:
            charts.append({
                "slice_name": f"{clean_table} — by {label_col.replace('_', ' ').title()}",
                "viz_type": "echarts_timeseries_bar",
                "description": f"Comparison across {label_col.replace('_', ' ')}",
                "dataset_id": ds_id,
                "params": {
                    "metrics": metric_exprs[:2],
                    "groupby": [label_col],
                    "viz_type": "echarts_timeseries_bar",
                    "datasource": f"{ds_id}__table",
                    "order_desc": True,
                    "row_limit": 20,
                },
                "alt_viz_types": [
                    {"viz_type": "echarts_timeseries_bar", "label": "Bar Chart", "reason": "Best for entity comparison"},
                    {"viz_type": "pie", "label": "Pie Chart", "reason": "Shows proportional share"},
                    {"viz_type": "table", "label": "Data Table", "reason": "Precise values"},
                ],
            })

        # 3. Trend line if period column exists
        if period_col and metric_exprs:
            charts.append({
                "slice_name": f"{clean_table} — Trend Over Time",
                "viz_type": "echarts_timeseries_line",
                "description": f"Temporal trend of key indicators",
                "dataset_id": ds_id,
                "params": {
                    "metrics": metric_exprs[:3],
                    "x_axis": period_col,
                    "viz_type": "echarts_timeseries_line",
                    "datasource": f"{ds_id}__table",
                    "row_limit": 100,
                },
                "alt_viz_types": [
                    {"viz_type": "echarts_timeseries_line", "label": "Line Chart", "reason": "Best for trends"},
                    {"viz_type": "echarts_area", "label": "Area Chart", "reason": "Shows volume over time"},
                    {"viz_type": "echarts_timeseries_bar", "label": "Bar Chart", "reason": "Discrete period comparison"},
                ],
            })

        # 4. Pie chart for proportional share
        if label_col and metric_exprs:
            charts.append({
                "slice_name": f"{clean_table} — Distribution",
                "viz_type": "pie",
                "description": f"Proportional share across {label_col.replace('_', ' ')}",
                "dataset_id": ds_id,
                "params": {
                    "metric": metric_exprs[0],
                    "groupby": [label_col],
                    "viz_type": "pie",
                    "datasource": f"{ds_id}__table",
                    "row_limit": 15,
                },
                "alt_viz_types": [
                    {"viz_type": "pie", "label": "Pie Chart", "reason": "Shows proportions"},
                    {"viz_type": "treemap_v2", "label": "Treemap", "reason": "Hierarchical proportions"},
                ],
            })

        # 5. Table for detailed data
        charts.append({
            "slice_name": f"{clean_table} — Data Table",
            "viz_type": "table",
            "description": f"Detailed data view for {clean_table}",
            "dataset_id": ds_id,
            "params": {
                "metrics": metric_exprs[:4],
                "groupby": ([label_col] if label_col else []) + period_cols[:1],
                "viz_type": "table",
                "datasource": f"{ds_id}__table",
                "row_limit": 50,
                "order_desc": True,
            },
        })

        # 6. Heatmap if both label and period
        if label_col and period_col and metric_exprs:
            charts.append({
                "slice_name": f"{clean_table} — Heatmap",
                "viz_type": "heatmap_v2",
                "description": f"Cross-tabulation of {label_col.replace('_', ' ')} vs time",
                "dataset_id": ds_id,
                "params": {
                    "metric": metric_exprs[0],
                    "x_axis": period_col,
                    "groupby": [label_col],
                    "viz_type": "heatmap_v2",
                    "datasource": f"{ds_id}__table",
                },
                "alt_viz_types": [
                    {"viz_type": "heatmap_v2", "label": "Heatmap", "reason": "Shows patterns across dimensions"},
                    {"viz_type": "pivot_table_v2", "label": "Pivot Table", "reason": "Detailed cross-tabulation"},
                ],
            })

        if len(charts) >= num_charts:
            break

    return charts[:num_charts]


class AIInsightService:
    def __init__(self) -> None:
        self.registry = ProviderRegistry()

    def _generate_localai_response(
        self,
        *,
        messages: list[dict[str, str]],
        provider_id: str | None,
        model: str | None,
        context_payload: dict[str, Any] | None = None,
        mode: str | None = None,
        question: str | None = None,
    ):
        """Generate a LocalAI response and retry with stricter guidance when needed."""
        insight_mode = _detect_insight_mode(question or "")
        scope_label = "dashboard" if mode == AI_MODE_DASHBOARD else "chart"
        _, expected_headings = _build_localai_report_plan(insight_mode, scope_label)
        dashboard_chart_count = (
            _count_meaningful_dashboard_charts(context_payload)
            if mode == AI_MODE_DASHBOARD
            else 0
        )

        def _is_invalid(text: str) -> bool:
            return (
                _looks_repetitive_model_output(text)
                or _looks_placeholder_output(text)
                or _looks_false_insufficient_data_output(
                    text,
                    context_payload,
                    mode,
                )
                or _looks_incomplete_localai_output(text, expected_headings)
            )

        attempt_messages = messages
        last_response = None
        for attempt in range(3):
            response = self.registry.generate(
                messages=attempt_messages,
                provider_id=provider_id,
                model=model,
            )
            last_response = response
            if not _is_invalid(response.text):
                return response

            logger.warning(
                "LocalAI returned invalid output on attempt %d; retrying with stricter guidance",
                attempt + 1,
            )
            guidance = (
                "Restart from scratch. Return only the final professional insight report. "
                "Do not copy chart context labels such as Chart, Type, Columns, Total rows, "
                "Metric, Highest, Lowest, or Sample data. "
                "Do not copy raw IDs or slugs. Do not use [STUB] or template notes. "
                "Do not claim there is insufficient data when the evidence contains real chart "
                "metrics, trends, rankings, or sample rows. "
                "Use normal English words with correct spacing and markdown headings only. "
                f"Include every required heading in the report plan: {', '.join(expected_headings)}. "
                "Keep the report complete, concise, and fully finished."
            )
            if mode == AI_MODE_DASHBOARD and dashboard_chart_count > 0:
                guidance += (
                    f" This dashboard contains usable evidence in {dashboard_chart_count} charts. "
                    "Synthesize the full dashboard, not only the first few charts."
                )
            if attempt == 1:
                guidance += (
                    " Use all supported dashboard or chart evidence that is present. "
                    "If one conclusion cannot be confirmed, state that succinctly and continue "
                    "with the supported findings instead of rejecting the whole analysis."
                )
            attempt_messages = [
                *messages,
                {"role": "user", "content": guidance},
            ]

        assert last_response is not None
        return last_response

    def get_capabilities(self, mode: str) -> dict[str, Any]:
        if not user_can_access_ai_mode(mode):
            return {
                "enabled": False,
                "default_provider": None,
                "default_model": None,
                "providers": [],
                "allow_sql_execution": False,
                "max_context_rows": 0,
            }
        config = get_ai_insights_config()
        return {
            "enabled": True,
            **self.registry.capabilities(),
            "allow_sql_execution": bool(config.get("allow_sql_execution")),
            "max_context_rows": int(config.get("max_context_rows") or 20),
        }

    def generate_chart_insight(self, chart_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_mode_access(AI_MODE_CHART)
        chart = ChartDAO.get_by_id_or_uuid(str(chart_id))
        security_manager.raise_for_access(chart=chart)
        datasource = chart.datasource
        if datasource is None or not is_mart_table(datasource):
            raise AIInsightError("AI insights require a MART-backed chart datasource", 400)

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            context_payload = {
                "chart": {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                    "form_data": _prune_form_data(chart.form_data),
                },
                "datasource": {
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                },
            }

        question = str(payload.get("question") or "Summarize this chart")
        provider_id = payload.get("provider_id")
        _looked_up = self.registry._lookup_provider(provider_id)
        _is_local = _looked_up.is_local if _looked_up else False
        _provider_type = _looked_up.provider_type if _looked_up else None
        started_at = perf_counter()
        messages = _build_text_messages(
            mode=AI_MODE_CHART,
            question=question,
            context_payload=context_payload,
            conversation=payload.get("conversation") or [],
            is_local_provider=_is_local,
            provider_type=_provider_type,
        )
        if messages and messages[0].get("role") == "__direct_report__":
            from superset.ai_insights.providers import GenerateResponse
            response = GenerateResponse(
                text=messages[0]["content"],
                provider_id=provider_id or "local",
                model="python-report",
                duration_ms=int((perf_counter() - started_at) * 1000),
            )
        else:
            response = self.registry.generate(
                messages=messages,
                provider_id=provider_id,
                model=payload.get("model"),
            )
        total_ms = int((perf_counter() - started_at) * 1000)
        _audit(
            AuditMetadata(
                mode=AI_MODE_CHART,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
                database_backend=datasource.database.backend,
            ),
            question_length=len(question),
            response_length=len(response.text),
            target_id=str(chart_id),
            conversation_id=payload.get("conversation_id"),
        )
        return {
            "mode": AI_MODE_CHART,
            "question": question,
            "insight": _proofread_generated_insight(response.text),
            "provider": response.provider_id,
            "model": response.model,
            "duration_ms": total_ms,
        }

    def generate_dashboard_insight(
        self, dashboard_id: int | str, payload: dict[str, Any], public_mode: bool = False
    ) -> dict[str, Any]:
        from superset.ai_insights.config import AI_MODE_PUBLIC_DASHBOARD
        self._ensure_mode_access(AI_MODE_PUBLIC_DASHBOARD if public_mode else AI_MODE_DASHBOARD)
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        dashboard.raise_for_access()

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            max_charts = int(get_ai_insights_config().get("max_dashboard_charts") or 12)
            context_payload = {
                "dashboard": {
                    "title": dashboard.dashboard_title,
                },
                "charts": [
                    {"name": chart.slice_name, "viz_type": chart.viz_type}
                    for chart in dashboard.slices[:max_charts]
                ],
            }

        question = str(payload.get("question") or "Summarize this dashboard")
        provider_id = payload.get("provider_id")
        _looked_up = self.registry._lookup_provider(provider_id)
        _is_local = _looked_up.is_local if _looked_up else False
        _provider_type = _looked_up.provider_type if _looked_up else None
        started_at_dash = perf_counter()
        messages = _build_text_messages(
            mode=AI_MODE_DASHBOARD,
            question=question,
            context_payload=context_payload,
            conversation=payload.get("conversation") or [],
            is_local_provider=_is_local,
            provider_type=_provider_type,
        )
        if messages and messages[0].get("role") == "__direct_report__":
            from superset.ai_insights.providers import GenerateResponse
            response = GenerateResponse(
                text=messages[0]["content"],
                provider_id=provider_id or "local",
                model="python-report",
                duration_ms=int((perf_counter() - started_at_dash) * 1000),
            )
        else:
            response = self.registry.generate(
                messages=messages,
                provider_id=provider_id,
                model=payload.get("model"),
            )
        _audit(
            AuditMetadata(
                mode=AI_MODE_DASHBOARD,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
            ),
            question_length=len(question),
            response_length=len(response.text),
            target_id=str(dashboard_id),
            conversation_id=payload.get("conversation_id"),
        )
        return {
            "mode": AI_MODE_DASHBOARD,
            "question": question,
            "insight": _proofread_generated_insight(response.text),
            "provider": response.provider_id,
            "model": response.model,
            "duration_ms": response.duration_ms,
        }

    def assist_sql(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_mode_access(AI_MODE_SQL)
        database_id = int(payload.get("database_id") or 0)

        # Resolve the execution database.  MART tables registered against a
        # DHIS2 source database must be queried via the local staging DB.
        exec_database = resolve_mart_execution_database(database_id or None)

        if not exec_database and database_id:
            exec_database = DatabaseDAO.find_by_id(database_id)

        if not exec_database:
            raise AIInsightError(
                "No database found. Ensure a staging database is configured.", 404
            )

        security_manager.raise_for_access(database=exec_database)

        schema = payload.get("schema")
        # Build MART schema context — searches the provided database_id first,
        # then falls back to all MART datasets across all databases.
        mart_schema_context = build_mart_schema_context(
            database_id or exec_database.id, schema
        )
        if not mart_schema_context:
            raise AIInsightError(
                "No MART tables found. Ensure your datasets have the MART role "
                "or table names ending in _mart.",
                400,
            )

        question = str(payload.get("question") or "").strip()
        if not question:
            raise AIInsightError("A question is required", 400)

        response = self.registry.generate(
            messages=_build_sql_messages(
                question=question,
                database=exec_database,
                mart_schema_context=mart_schema_context,
                current_sql=payload.get("current_sql"),
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
        )
        try:
            structured = _extract_json_object(response.text)
        except json.JSONDecodeError as ex:
            raise AIInsightError("The AI provider returned invalid SQL metadata", 502) from ex

        sql = str(structured.get("sql") or "").strip()
        if not sql:
            raise AIInsightError("The AI provider did not generate SQL", 502)

        try:
            validation = ensure_mart_only_sql(exec_database, sql, schema=schema)
        except AISQLValidationError as ex:
            raise AIInsightError(str(ex), 400) from ex

        result_payload: dict[str, Any] = {
            "mode": AI_MODE_SQL,
            "question": question,
            "provider": response.provider_id,
            "model": response.model,
            "sql": validation["sql"],
            "tables": validation["tables"],
            "validated": True,
            "explanation": structured.get("explanation") or "",
            "assumptions": structured.get("assumptions") or [],
            "follow_ups": structured.get("follow_ups") or [],
            "database_backend": exec_database.backend,
            "execution_database_id": exec_database.id,
            "execution_database_name": exec_database.database_name,
        }

        config = get_ai_insights_config()
        should_execute = bool(payload.get("execute")) and bool(
            config.get("allow_sql_execution")
        )
        if should_execute:
            dataframe = exec_database.get_df(validation["sql"], schema=schema)
            rows = dataframe.to_dict(orient="records")
            result_payload["execution"] = {
                "row_count": len(rows),
                "sample_rows": rows[: int(config.get("max_context_rows") or 20)],
            }
        else:
            result_payload["execution"] = None

        _audit(
            AuditMetadata(
                mode=AI_MODE_SQL,
                provider=response.provider_id,
                model=response.model,
                duration_ms=response.duration_ms,
                database_backend=exec_database.backend,
            ),
            question_length=len(question),
            response_length=len(response.text),
            conversation_id=payload.get("conversation_id"),
        )
        return result_payload

    def stream_chart_insight(
        self, chart_id: int, payload: dict[str, Any]
    ) -> Generator[StreamChunk, None, None]:
        self._ensure_mode_access(AI_MODE_CHART)
        chart = ChartDAO.get_by_id_or_uuid(str(chart_id))
        security_manager.raise_for_access(chart=chart)
        datasource = chart.datasource
        if datasource is None or not is_mart_table(datasource):
            raise AIInsightError("AI insights require a MART-backed chart datasource", 400)

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            context_payload = {
                "chart": {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                    "form_data": _prune_form_data(chart.form_data),
                },
                "datasource": {
                    "table_name": getattr(datasource, "table_name", None),
                    "schema": datasource.schema,
                },
            }

        question = str(payload.get("question") or "Summarize this chart")
        provider_id = payload.get("provider_id")
        model = payload.get("model")

        # Resolve provider metadata without health-check so is_local is
        # always accurate — prevents fallback to model calls that time out.
        _looked_up = self.registry._lookup_provider(provider_id)
        audit_provider = _looked_up.provider_id if _looked_up else (provider_id or "unknown")
        audit_model = model or self.registry._default_model or (_looked_up.default_model if _looked_up else None) or "unknown"
        _is_local = _looked_up.is_local if _looked_up else False
        _provider_type = _looked_up.provider_type if _looked_up else None

        started_at = perf_counter()
        accumulated_text = ""
        error_msg: str | None = None
        try:
            messages = _build_text_messages(
                mode=AI_MODE_CHART,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
                is_local_provider=_is_local,
                provider_type=_provider_type,
            )

            if messages and messages[0].get("role") == "__direct_report__":
                report = messages[0]["content"]
                logger.info(
                    "stream_chart_insight: __direct_report__ len=%d",
                    len(report),
                )
                for line in report.split("\n"):
                    chunk_text = line + "\n"
                    accumulated_text += chunk_text
                    yield StreamChunk(text=chunk_text)
                yield StreamChunk(text="", done=True)
            elif _provider_type == "localai":
                logger.info(
                    "stream_chart_insight: LocalAI final-response mode, msgs=%d",
                    len(messages),
                )
                response = self._generate_localai_response(
                    messages=messages,
                    provider_id=provider_id,
                    model=model,
                    context_payload=context_payload,
                    mode=AI_MODE_CHART,
                    question=question,
                )
                final_text = _proofread_generated_insight(response.text)
                accumulated_text = final_text
                for paragraph in final_text.split("\n\n"):
                    chunk_text = paragraph.strip()
                    if not chunk_text:
                        continue
                    yield StreamChunk(text=chunk_text + "\n\n")
                yield StreamChunk(text="", done=True)
            else:
                logger.info(
                    "stream_chart_insight: streaming from model, "
                    "is_local=%s msgs=%d", _is_local, len(messages),
                )
                for chunk in self.registry.generate_stream(
                    messages=messages,
                    provider_id=provider_id,
                    model=model,
                ):
                    cleaned_text = _strip_prompt_leakage(chunk.text)
                    accumulated_text += cleaned_text
                    yield StreamChunk(text=cleaned_text, done=chunk.done)
        except Exception as exc:
            error_msg = str(exc)[:500]
            raise
        finally:
            duration_ms = int((perf_counter() - started_at) * 1000)
            _audit(
                AuditMetadata(
                    mode=AI_MODE_CHART,
                    provider=audit_provider,
                    model=audit_model,
                    duration_ms=duration_ms,
                    database_backend=getattr(getattr(datasource, "database", None), "backend", None),
                    status="error" if error_msg else "success",
                ),
                question_length=len(question),
                response_length=len(accumulated_text),
                target_id=str(chart_id),
                conversation_id=payload.get("conversation_id"),
                error_message=error_msg,
            )

    def stream_dashboard_insight(
        self, dashboard_id: int | str, payload: dict[str, Any], public_mode: bool = False
    ) -> Generator[StreamChunk, None, None]:
        from superset.ai_insights.config import AI_MODE_PUBLIC_DASHBOARD
        self._ensure_mode_access(AI_MODE_PUBLIC_DASHBOARD if public_mode else AI_MODE_DASHBOARD)
        dashboard = DashboardDAO.get_by_id_or_slug(dashboard_id)
        dashboard.raise_for_access()

        context_payload = _sanitize_context_payload(payload.get("context"))
        if not context_payload:
            max_charts = int(get_ai_insights_config().get("max_dashboard_charts") or 12)
            context_payload = {
                "dashboard": {
                    "title": dashboard.dashboard_title,
                },
                "charts": [
                    {"name": chart.slice_name, "viz_type": chart.viz_type}
                    for chart in dashboard.slices[:max_charts]
                ],
            }

        question = str(payload.get("question") or "Summarize this dashboard")
        provider_id = payload.get("provider_id")
        model = payload.get("model")

        # Resolve provider metadata without health-check so is_local is
        # always accurate — prevents fallback to model calls that time out.
        _looked_up = self.registry._lookup_provider(provider_id)
        audit_provider = _looked_up.provider_id if _looked_up else (provider_id or "unknown")
        audit_model = model or self.registry._default_model or (_looked_up.default_model if _looked_up else None) or "unknown"
        _is_local = _looked_up.is_local if _looked_up else False
        _provider_type = _looked_up.provider_type if _looked_up else None

        started_at = perf_counter()
        accumulated_text = ""
        error_msg: str | None = None
        try:
            messages = _build_text_messages(
                mode=AI_MODE_DASHBOARD,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
                is_local_provider=_is_local,
                provider_type=_provider_type,
            )

            if messages and messages[0].get("role") == "__direct_report__":
                report = messages[0]["content"]
                logger.info(
                    "stream_dashboard_insight: __direct_report__ len=%d",
                    len(report),
                )
                for line in report.split("\n"):
                    chunk_text = line + "\n"
                    accumulated_text += chunk_text
                    yield StreamChunk(text=chunk_text)
                yield StreamChunk(text="", done=True)
            elif _provider_type == "localai":
                logger.info(
                    "stream_dashboard_insight: LocalAI final-response mode, msgs=%d",
                    len(messages),
                )
                response = self._generate_localai_response(
                    messages=messages,
                    provider_id=provider_id,
                    model=model,
                    context_payload=context_payload,
                    mode=AI_MODE_DASHBOARD,
                    question=question,
                )
                final_text = _proofread_generated_insight(response.text)
                accumulated_text = final_text
                for paragraph in final_text.split("\n\n"):
                    chunk_text = paragraph.strip()
                    if not chunk_text:
                        continue
                    yield StreamChunk(text=chunk_text + "\n\n")
                yield StreamChunk(text="", done=True)
            else:
                logger.info(
                    "stream_dashboard_insight: streaming from model, "
                    "is_local=%s msgs=%d", _is_local, len(messages),
                )
                for chunk in self.registry.generate_stream(
                    messages=messages,
                    provider_id=provider_id,
                    model=model,
                ):
                    cleaned_text = _strip_prompt_leakage(chunk.text)
                    accumulated_text += cleaned_text
                    yield StreamChunk(text=cleaned_text, done=chunk.done)
        except Exception as exc:
            error_msg = str(exc)[:500]
            raise
        finally:
            duration_ms = int((perf_counter() - started_at) * 1000)
            _audit(
                AuditMetadata(
                    mode=AI_MODE_DASHBOARD,
                    provider=audit_provider,
                    model=audit_model,
                    duration_ms=duration_ms,
                    status="error" if error_msg else "success",
                ),
                question_length=len(question),
                response_length=len(accumulated_text),
                target_id=str(dashboard_id),
                conversation_id=payload.get("conversation_id"),
                error_message=error_msg,
            )

    def generate_chart_configs(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Use AI to generate chart configurations for MART datasets.

        Supports three modes:
        - ``dataset_id`` only: generate diverse charts for one specific dataset
        - ``prompt`` only: AI auto-discovers the best MART datasets for the request
        - ``dataset_id`` + ``prompt``: use specific dataset with custom instructions
        """
        from superset.connectors.sqla.models import SqlaTable
        from superset.extensions import db

        self._ensure_mode_access(AI_MODE_CHART)

        dataset_id = payload.get("dataset_id")
        if dataset_id is not None:
            dataset_id = int(dataset_id)
        prompt = str(payload.get("prompt") or "").strip()
        num_charts = min(int(payload.get("num_charts") or 6), 20)

        # Build dataset schemas for context
        datasets_context: list[dict[str, Any]] = []
        valid_dataset_ids: set[int] = set()

        if dataset_id:
            # Single dataset mode
            dataset = db.session.query(SqlaTable).filter_by(id=dataset_id).first()
            if not dataset:
                raise AIInsightError("Dataset not found", 404)
            security_manager.raise_for_access(datasource=dataset)
            if not is_mart_table(dataset):
                raise AIInsightError("AI chart generation requires a MART dataset", 400)
            datasets_context.append(self._build_dataset_context(dataset))
            valid_dataset_ids.add(dataset_id)
        else:
            # Auto-discover all MART datasets
            all_datasets = db.session.query(SqlaTable).all()
            mart_datasets = [ds for ds in all_datasets if is_mart_table(ds)]
            if not mart_datasets:
                raise AIInsightError(
                    "No MART datasets found. Create MART datasets first.", 404
                )
            # Limit to 15 datasets for context window
            for ds in mart_datasets[:15]:
                datasets_context.append(self._build_dataset_context(ds))
                valid_dataset_ids.add(ds.id)

        if not datasets_context:
            raise AIInsightError("No datasets available for chart generation", 400)

        # Build user question
        if prompt and dataset_id:
            question = (
                f"User request: {prompt}\n\n"
                f"Generate {num_charts} Superset chart configurations using "
                f"dataset_id={dataset_id} ('{datasets_context[0]['table_name']}'). "
                f"Follow the user's request closely."
            )
        elif prompt:
            question = (
                f"User request: {prompt}\n\n"
                f"Generate {num_charts} Superset chart configurations. "
                f"Choose the most appropriate dataset(s) from the available MART "
                f"datasets below. Pick datasets whose columns best match what the "
                f"user is asking for."
            )
        else:
            ds_name = datasets_context[0]["table_name"] if len(datasets_context) == 1 else "available MART datasets"
            question = (
                f"Generate {num_charts} diverse, meaningful Superset chart configurations "
                f"for {ds_name}. "
                f"Focus on health analytics insights. Create a mix of chart types "
                f"that would form a useful analytical dashboard."
            )

        schemas_json = _compact_json(datasets_context)

        # ── LocalAI / local provider fallback ──
        # Local models cannot reliably produce valid JSON chart configs.
        # Generate chart proposals in Python using the dataset schema.
        provider_id_gen = payload.get("provider_id")
        _looked_up_gen = self.registry._lookup_provider(provider_id_gen)
        _is_local_gen = _looked_up_gen.is_local if _looked_up_gen else False

        if _is_local_gen:
            charts = _build_chart_configs_python(
                datasets_context, num_charts, prompt,
            )
            return self._finalize_chart_configs(charts, valid_dataset_ids, payload, datasets_context)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT_CHART_GENERATE},
            {
                "role": "user",
                "content": f"{question}\n\nAvailable MART dataset schemas:\n{schemas_json}",
            },
        ]

        response = self.registry.generate(
            messages=messages,
            provider_id=provider_id_gen,
            model=payload.get("model"),
        )

        # Parse the JSON array from the AI response
        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if "\n" in raw:
                raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw[:-3]

        start = raw.find("[")
        end = raw.rfind("]")
        if start == -1 or end == -1:
            raise AIInsightError("AI did not return a valid chart configuration array", 502)

        try:
            charts = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as ex:
            raise AIInsightError(f"AI returned invalid JSON: {ex}", 502) from ex

        if not isinstance(charts, list):
            raise AIInsightError("AI did not return a chart array", 502)

        return self._finalize_chart_configs(charts, valid_dataset_ids, payload, datasets_context)

    def _finalize_chart_configs(
        self,
        charts: list[dict[str, Any]],
        valid_dataset_ids: set[int],
        payload: dict[str, Any],
        datasets_context: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Validate, normalize and enrich chart configs from AI or Python generation."""
        dataset_id = payload.get("dataset_id")
        if dataset_id is not None:
            dataset_id = int(dataset_id)

        # Incorrect/legacy viz_type → actual registered keys
        _LEGACY_VIZ_MAP: dict[str, str] = {
            # Legacy NVD3 types
            "dist_bar": "echarts_timeseries_bar",
            "bar": "echarts_timeseries_bar",
            "bar_chart": "echarts_timeseries_bar",
            "column": "echarts_timeseries_bar",
            "line": "echarts_timeseries_line",
            "line_chart": "echarts_timeseries_line",
            "area": "echarts_area",
            "scatter": "echarts_timeseries_scatter",
            "dual_line": "mixed_timeseries",
            # Wrong suffixes / missing _v2
            "bubble": "bubble_v2",
            "treemap": "treemap_v2",
            "sunburst": "sunburst_v2",
            "sankey": "sankey_v2",
            "heatmap": "heatmap_v2",
            "histogram": "histogram_v2",
            "pivot_table": "pivot_table_v2",
            # Wrong prefixed names
            "echarts_funnel": "funnel",
            "echarts_sankey": "sankey_v2",
            "echarts_treemap": "treemap_v2",
            "echarts_graph": "graph_chart",
            "echarts_gauge": "gauge_chart",
            "echarts_gantt": "gantt_chart",
            "echarts_radar": "radar",
            "echarts_heatmap": "heatmap_v2",
            "echarts_histogram": "histogram_v2",
            "echarts_tree": "tree_chart",
            "echarts_sunburst": "sunburst_v2",
            "echarts_bubble": "bubble_v2",
            "echarts_pie": "pie",
            # Geo / deck.gl legacy
            "country_map": "dhis2_map",
            "world_map": "dhis2_map",
            "deck_scatter": "vital_maps",
            "deck_hex": "vital_maps",
            "deck_geojson": "vital_maps",
            "mapbox": "vital_maps",
            # Calendar
            "calendar": "cal_heatmap",
            # Misc
            "ag_grid": "table",
            "parallel_coordinates": "table",
        }

        # Validate and normalize each chart config
        validated: list[dict[str, Any]] = []
        for chart in charts:
            if not isinstance(chart, dict):
                continue
            name = str(chart.get("slice_name") or "").strip()
            viz = str(chart.get("viz_type") or "table").strip()
            viz = _LEGACY_VIZ_MAP.get(viz, viz)  # auto-correct legacy types
            desc = str(chart.get("description") or "").strip()
            params = chart.get("params") or {}
            if not isinstance(params, dict):
                continue
            if not name:
                continue

            # Resolve dataset_id: from the chart config, fallback to single dataset
            chart_ds_id = chart.get("dataset_id")
            if chart_ds_id is not None:
                chart_ds_id = int(chart_ds_id)
            if not chart_ds_id and dataset_id:
                chart_ds_id = dataset_id
            if not chart_ds_id and len(valid_dataset_ids) == 1:
                chart_ds_id = next(iter(valid_dataset_ids))

            # Skip charts referencing invalid datasets
            if not chart_ds_id or chart_ds_id not in valid_dataset_ids:
                # Try to recover: if only one dataset, use it
                if len(valid_dataset_ids) == 1:
                    chart_ds_id = next(iter(valid_dataset_ids))
                else:
                    logger.warning(
                        "Skipping chart '%s' with invalid dataset_id=%s",
                        name, chart_ds_id,
                    )
                    continue

            # Ensure required params fields
            params["datasource"] = f"{chart_ds_id}__table"
            params["viz_type"] = viz
            params.setdefault("row_limit", 100)
            params.setdefault("color_scheme", "supersetColors")
            params.setdefault("adhoc_filters", [])
            params.setdefault("time_range", "No filter")

            # Parse alt_viz_types from AI response
            raw_alts = chart.get("alt_viz_types") or []
            alt_viz_types: list[dict[str, str]] = []
            seen_alts: set[str] = set()
            for alt in raw_alts:
                if isinstance(alt, dict) and alt.get("viz_type"):
                    alt_viz = _LEGACY_VIZ_MAP.get(
                        str(alt["viz_type"]).strip(),
                        str(alt["viz_type"]).strip(),
                    )
                    if alt_viz in seen_alts:
                        continue
                    seen_alts.add(alt_viz)
                    alt_viz_types.append({
                        "viz_type": alt_viz,
                        "label": str(alt.get("label") or alt_viz).strip(),
                        "reason": str(alt.get("reason") or "").strip(),
                    })
            # Ensure the primary viz_type is the first alternative
            primary_in_alts = any(a["viz_type"] == viz for a in alt_viz_types)
            if not primary_in_alts:
                alt_viz_types.insert(0, {
                    "viz_type": viz,
                    "label": viz.replace("_", " ").title(),
                    "reason": "Recommended by AI",
                })

            validated.append({
                "slice_name": name,
                "viz_type": viz,
                "description": desc,
                "datasource_id": chart_ds_id,
                "datasource_type": "table",
                "alt_viz_types": alt_viz_types,
                "params": params,
            })

        if not validated:
            raise AIInsightError("AI could not generate valid chart configurations", 502)

        # Enrich with dataset names for the review UI
        if datasets_context:
            ds_name_map: dict[int, str] = {
                d["dataset_id"]: d.get("table_name") or str(d["dataset_id"])
                for d in datasets_context
            }
            for v in validated:
                v["datasource_name"] = ds_name_map.get(v["datasource_id"], str(v["datasource_id"]))

        return validated

    @staticmethod
    def _build_dataset_context(dataset: Any) -> dict[str, Any]:
        """Build schema context for a single MART dataset."""
        columns_info = []
        for col in (dataset.columns or [])[:30]:
            col_info: dict[str, Any] = {
                "name": col.column_name,
                "type": str(col.type or ""),
            }
            if col.description:
                col_info["description"] = col.description[:80]
            columns_info.append(col_info)

        metrics_info = []
        for metric in (dataset.metrics or [])[:15]:
            metrics_info.append({
                "name": metric.metric_name,
                "expression": str(metric.expression or ""),
                "description": (metric.description or "")[:80],
            })

        sample_rows: list[dict[str, Any]] = []
        try:
            df = dataset.database.get_df(
                f"SELECT * FROM {dataset.table_name} LIMIT 5",
                schema=dataset.schema,
            )
            sample_rows = df.to_dict(orient="records")[:5]
        except Exception:  # pylint: disable=broad-except
            pass

        return {
            "dataset_id": dataset.id,
            "table_name": dataset.table_name,
            "schema": dataset.schema,
            "description": (dataset.description or "")[:200],
            "database_backend": dataset.database.backend,
            "columns": columns_info,
            "metrics": metrics_info,
            "sample_rows": sample_rows,
        }

    def save_generated_charts(
        self, charts: list[dict[str, Any]], *, owners: list[int] | None = None,
    ) -> list[dict[str, Any]]:
        """Persist AI-generated chart configs to the database."""
        from superset.commands.chart.create import CreateChartCommand

        user_id = getattr(getattr(g, "user", None), "id", None)
        saved: list[dict[str, Any]] = []

        for chart_config in charts:
            try:
                payload = {
                    "slice_name": chart_config["slice_name"],
                    "viz_type": chart_config["viz_type"],
                    "description": chart_config.get("description") or "",
                    "datasource_id": chart_config["datasource_id"],
                    "datasource_type": chart_config["datasource_type"],
                    "params": json.dumps(chart_config["params"]),
                    "owners": owners or ([user_id] if user_id else []),
                }
                chart = CreateChartCommand(payload).run()
                saved.append({
                    "id": chart.id,
                    "slice_name": chart.slice_name,
                    "viz_type": chart.viz_type,
                    "description": chart.description or "",
                    "url": chart.url,
                })
            except Exception as ex:  # pylint: disable=broad-except
                logger.warning("Failed to save AI chart '%s': %s", chart_config.get("slice_name"), ex)
                saved.append({
                    "id": None,
                    "slice_name": chart_config.get("slice_name"),
                    "error": str(ex),
                })

        return saved

    def generate_push_report(
        self, payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Generate a comprehensive AI analysis report for push analysis.

        Analyzes dashboard charts, MART data, and produces a structured
        report suitable for PDF generation and email delivery.
        """
        from superset.connectors.sqla.models import SqlaTable
        from superset.daos.chart import ChartDAO
        from superset.daos.dashboard import DashboardDAO
        from superset.extensions import db

        dashboard_id = payload.get("dashboard_id")
        chart_id = payload.get("chart_id")
        question = payload.get("question") or ""

        context: dict[str, Any] = {}
        charts_data: list[dict[str, Any]] = []

        if dashboard_id:
            dashboard = DashboardDAO.find_by_id(dashboard_id)
            if not dashboard:
                raise AIInsightError("Dashboard not found", 404)
            context["dashboard"] = {
                "id": dashboard.id,
                "title": dashboard.dashboard_title,
                "slug": dashboard.slug,
            }
            for chart in (dashboard.slices or [])[:15]:
                chart_ctx: dict[str, Any] = {
                    "id": chart.id,
                    "name": chart.slice_name,
                    "viz_type": chart.viz_type,
                }
                # Fetch sample data for each chart's datasource
                ds = chart.datasource
                if ds:
                    chart_ctx["datasource"] = {
                        "table_name": getattr(ds, "table_name", None),
                        "schema": ds.schema,
                    }
                    try:
                        table_name = getattr(ds, "table_name", "")
                        if table_name:
                            df = ds.database.get_df(
                                f"SELECT * FROM {table_name} LIMIT 10",
                                schema=ds.schema,
                            )
                            chart_ctx["sample_data"] = df.to_dict(orient="records")[:10]
                            chart_ctx["row_count"] = int(
                                ds.database.get_df(
                                    f"SELECT COUNT(*) as cnt FROM {table_name}",
                                    schema=ds.schema,
                                ).iloc[0]["cnt"]
                            )
                    except Exception:  # pylint: disable=broad-except
                        pass
                # Include pruned form_data for analytical context
                chart_ctx["form_data"] = _prune_form_data(chart.form_data)
                charts_data.append(chart_ctx)
            context["charts"] = charts_data

        elif chart_id:
            chart = ChartDAO.find_by_id(chart_id)
            if not chart:
                raise AIInsightError("Chart not found", 404)
            chart_ctx = {
                "id": chart.id,
                "name": chart.slice_name,
                "viz_type": chart.viz_type,
                "form_data": _prune_form_data(chart.form_data),
            }
            ds = chart.datasource
            if ds:
                chart_ctx["datasource"] = {
                    "table_name": getattr(ds, "table_name", None),
                    "schema": ds.schema,
                }
                try:
                    table_name = getattr(ds, "table_name", "")
                    if table_name:
                        df = ds.database.get_df(
                            f"SELECT * FROM {table_name} LIMIT 10",
                            schema=ds.schema,
                        )
                        chart_ctx["sample_data"] = df.to_dict(orient="records")[:10]
                except Exception:  # pylint: disable=broad-except
                    pass
            context["chart"] = chart_ctx
            charts_data = [chart_ctx]

        if not context:
            raise AIInsightError(
                "A dashboard_id or chart_id is required for push analysis", 400
            )

        # Add custom instructions
        if question:
            context["custom_instructions"] = question

        report_prompt = (
            "Generate a comprehensive professional health analytics report based on "
            "the provided dashboard and chart data. Structure the report as follows:\n\n"
            "## EXECUTIVE SUMMARY\n"
            "A 2-3 paragraph overview of the key findings.\n\n"
            "## KEY METRICS AND INDICATORS\n"
            "Numbered list of the most important metrics with their current values, "
            "trends, and status ([CRITICAL], [WARNING], [GOOD], [INFO]).\n\n"
            "## DETAILED ANALYSIS\n"
            "For each chart/data source, provide numbered analysis sections with:\n"
            "- What the data shows\n"
            "- Notable trends or anomalies\n"
            "- Comparison to expected ranges/thresholds\n\n"
            "## RECOMMENDATIONS\n"
            "Numbered, actionable recommendations based on the analysis.\n\n"
            "## DATA QUALITY NOTES\n"
            "Any data gaps, limitations, or quality concerns observed.\n\n"
            "Be specific, cite actual numbers from the data. No invented facts."
        )

        if question:
            report_prompt += f"\n\nAdditional focus areas: {question}"

        messages = _build_text_messages(
            mode=AI_MODE_DASHBOARD if dashboard_id else AI_MODE_CHART,
            question=report_prompt,
            context_payload=context,
            conversation=[],
        )

        response = self.registry.generate(
            messages=messages,
            provider_id=payload.get("provider_id"),
            model=payload.get("model_name"),
        )

        return {
            "insight_text": response.text,
            "provider_id": response.provider_id,
            "model": response.model,
            "duration_ms": response.duration_ms,
            "charts": charts_data,
        }

    def _ensure_mode_access(self, mode: str) -> None:
        if not user_can_access_ai_mode(mode):
            raise AIInsightError("AI insights are not enabled for this user", 403)
