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


# ── System prompts ──────────────────────────────────────────────────
# Kept terse to minimize input tokens while retaining instruction quality.

_HEALTH_ALERT_INSTRUCTIONS = (
    "\n\nFORMATTING RULES (strictly follow these):\n"
    "1. Use ONLY plain English text. Do NOT use emojis, emoticons, or special Unicode "
    "symbols (no map pins, flags, check marks, warning signs, arrows, etc.). "
    "Write everything in clear ASCII characters only.\n"
    "2. Number ALL major sections sequentially (1, 2, 3...) using markdown headers "
    "(## 1. Section Title). Number sub-sections where appropriate (1.1, 1.2, etc.).\n"
    "3. CRITICAL — WORD SPACING AND PUNCTUATION:\n"
    "   a) NEVER concatenate or join words together. Every word MUST be separated by a space. "
    "WRONG: 'treatedfor', 'highlightsa', 'surveillancequality'. "
    "RIGHT: 'treated for', 'highlights a', 'surveillance quality'.\n"
    "   b) Always put a space AFTER every comma, period, colon, and semicolon. "
    "WRONG: 'value,but' or 'system.The'. RIGHT: 'value, but' or 'system. The'.\n"
    "   c) Always put a space BEFORE opening parentheses. "
    "WRONG: 'rate(95%)'. RIGHT: 'rate (95%)'.\n"
    "   d) Proofread every sentence for missing spaces before outputting.\n"
    "4. Use markdown formatting: bold (**text**) for emphasis, bullet lists for details, "
    "tables for comparative data, and numbered lists for sequential items.\n"
    "5. Always complete your full analysis. Never stop mid-sentence or mid-list.\n"
    "6. For key findings, prefix the paragraph or bullet with a severity tag on its own line:\n"
    "   [CRITICAL] for dangerous thresholds, outbreaks, or urgent action items\n"
    "   [WARNING] for concerning trends approaching thresholds\n"
    "   [GOOD] for positive outcomes, targets met, or improving trends\n"
    "   [INFO] for neutral context, definitions, or methodology notes\n"
    "   Use these tags selectively for the most important findings, not on every line.\n"
    "7. Start with a brief executive summary, then present numbered sections with analysis."
)

_PRESENTATION_INSTRUCTIONS = (
    "\n\nEXECUTIVE PRESENTATION OUTPUT RULES:\n"
    "Your output will be converted into executive presentation slides. "
    "Structure your response so each ## section maps to one presentation slide.\n\n"
    "1. INSIGHT-LED TITLES: Each ## heading must state the takeaway, not just the topic. "
    "GOOD: '## Revenue growth slowed in Q3 despite stable volume'. "
    "BAD: '## Revenue Analysis'.\n"
    "2. ONE KEY MESSAGE per ## section. Focus each section on one primary insight.\n"
    "3. EXECUTIVE RELEVANCE: Every section must help answer: What is happening? "
    "Why does it matter? What risk or opportunity exists? What should be done?\n"
    "4. CONCISE BULLETS: Keep supporting points to 3-5 short, decision-relevant bullets per section. "
    "Avoid more than 5 bullets per section.\n"
    "5. PRIORITIZE CONCLUSIONS over observations. Do not stop at 'the value increased.' "
    "Explain significance, implications, and recommended action.\n"
    "6. TABLES: Use markdown tables (| col1 | col2 |) for comparative data. "
    "Tables render well in all export formats.\n"
    "7. RECOMMENDED FLOW: When appropriate, organize sections as: "
    "Executive Summary, Current State, Trend/Pattern, Root Cause, Risk/Opportunity, "
    "Recommendation/Next Step.\n"
    "8. Use strong action-oriented business language: increased, declined, concentrated, "
    "accelerated, underperformed, improved, constrained, indicates, suggests, signals, "
    "requires attention, presents an opportunity.\n"
    "9. Handle uncertainty carefully: use 'suggests', 'may indicate', 'appears linked to', "
    "'warrants further review'. Do not invent causes unsupported by data.\n"
    "10. If the data supports action, include a recommendation section with: "
    "what should be done, why, expected benefit, and key risk or tradeoff."
)

_SYSTEM_PROMPT_CHART = (
    "You are Superset AI, an Executive Presentation Insight Generator for health analytics. "
    "Analyze ONLY the provided MART-backed chart context. "
    "Be specific, cite numbers from the data, note uncertainty. No invented facts. "
    "Convert analytical insights into executive presentation-ready content that is "
    "message-driven, decision-oriented, and professionally structured. "
    "Each response should feel like it was prepared by a strategy analyst building "
    "an executive PowerPoint deck, not by a dashboard tooltip generator."
    + _HEALTH_ALERT_INSTRUCTIONS
    + _PRESENTATION_INSTRUCTIONS
)

_SYSTEM_PROMPT_DASHBOARD = (
    "You are Superset AI, an Executive Presentation Insight Generator for health analytics. "
    "Analyze ONLY the provided MART-backed dashboard context. "
    "Synthesize cross-chart patterns, highlight anomalies, cite specific values. "
    "No invented facts. Convert analytical insights into executive presentation-ready content. "
    "Each ## section should focus on one key message suitable for a single presentation slide. "
    "Frame the response as if it may be presented to leadership, board, or donors."
    + _HEALTH_ALERT_INSTRUCTIONS
    + _PRESENTATION_INSTRUCTIONS
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


def _build_text_messages(
    *,
    mode: str,
    question: str,
    context_payload: dict[str, Any],
    conversation: list[dict[str, str]] | None,
) -> list[dict[str, str]]:
    if mode == AI_MODE_DASHBOARD:
        system_prompt = _SYSTEM_PROMPT_DASHBOARD
    elif mode == AI_MODE_SQL:
        system_prompt = _SYSTEM_PROMPT_SQL
    else:
        system_prompt = _SYSTEM_PROMPT_CHART

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(_trim_conversation(conversation or []))
    messages.append(
        {
            "role": "user",
            "content": f"{question}\n\nContext:\n{_compact_json(context_payload)}",
        }
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
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.debug("Failed to persist AI usage log", exc_info=True)


class AIInsightService:
    def __init__(self) -> None:
        self.registry = ProviderRegistry()

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
        started_at = perf_counter()
        response = self.registry.generate(
            messages=_build_text_messages(
                mode=AI_MODE_CHART,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
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
        )
        return {
            "mode": AI_MODE_CHART,
            "question": question,
            "insight": response.text,
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
        response = self.registry.generate(
            messages=_build_text_messages(
                mode=AI_MODE_DASHBOARD,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
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
        )
        return {
            "mode": AI_MODE_DASHBOARD,
            "question": question,
            "insight": response.text,
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
        yield from self.registry.generate_stream(
            messages=_build_text_messages(
                mode=AI_MODE_CHART,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
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
        yield from self.registry.generate_stream(
            messages=_build_text_messages(
                mode=AI_MODE_DASHBOARD,
                question=question,
                context_payload=context_payload,
                conversation=payload.get("conversation") or [],
            ),
            provider_id=payload.get("provider_id"),
            model=payload.get("model"),
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

        messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT_CHART_GENERATE},
            {
                "role": "user",
                "content": f"{question}\n\nAvailable MART dataset schemas:\n{schemas_json}",
            },
        ]

        response = self.registry.generate(
            messages=messages,
            provider_id=payload.get("provider_id"),
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

