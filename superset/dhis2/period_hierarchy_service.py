from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_DHIS2_PERIOD_EXTRA_KEY = "dhis2_is_period"
_DHIS2_PERIOD_HIERARCHY_EXTRA_KEY = "dhis2_is_period_hierarchy"
_PERIOD_COLUMN_SPECS = [
    ("period", "Period", {"extra": {_DHIS2_PERIOD_EXTRA_KEY: True}}),
    ("period_level", "Period Level", {}),
    ("period_parent", "Parent Period", {}),
    ("period_year", "Period Year", {}),
    ("period_half", "Period Half", {}),
    ("period_quarter", "Period Quarter", {}),
    ("period_month", "Period Month", {}),
    ("period_week", "Period Week", {}),
    ("period_biweek", "Period Biweek", {}),
    ("period_bimonth", "Period Bimonth", {}),
    ("period_variant", "Period Variant", {}),
]
_PERIOD_KEY_ALIASES = {
    "period": "period",
    "level": "period_level",
    "period_level": "period_level",
    "parent": "period_parent",
    "period_parent": "period_parent",
    "year": "period_year",
    "period_year": "period_year",
    "half": "period_half",
    "period_half": "period_half",
    "quarter": "period_quarter",
    "period_quarter": "period_quarter",
    "month": "period_month",
    "period_month": "period_month",
    "week": "period_week",
    "period_week": "period_week",
    "biweek": "period_biweek",
    "period_biweek": "period_biweek",
    "bimonth": "period_bimonth",
    "period_bimonth": "period_bimonth",
    "variant": "period_variant",
    "period_variant": "period_variant",
}
_EXPLICIT_PERIOD_KEY_CONFIG_KEYS = (
    "period_hierarchy_keys",
    "period_hierarchy_levels",
    "period_columns",
)


def sanitize_serving_identifier(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        return "column"
    if sanitized[0].isdigit():
        sanitized = f"c_{sanitized}"
    return sanitized.lower()


def dedupe_identifier(value: str, used: set[str]) -> str:
    candidate = sanitize_serving_identifier(value)
    if candidate not in used:
        used.add(candidate)
        return candidate

    suffix = 2
    while f"{candidate}_{suffix}" in used:
        suffix += 1
    deduped = f"{candidate}_{suffix}"
    used.add(deduped)
    return deduped


@dataclass(frozen=True)
class PeriodHierarchyContext:
    columns: list[dict[str, Any]]
    dimension_column_names: list[str]
    primary_period_column: str
    column_names_by_key: dict[str, str]
    diagnostics: dict[str, Any]


class PeriodHierarchyService:
    _WEEK_PATTERN = re.compile(r"^(?P<year>\d{4})(?:Wed|Thu|Sat|Sun)?W(?P<week>\d{1,2})$")
    _BIWEEK_PATTERN = re.compile(r"^(?P<year>\d{4})BiW(?P<biweek>\d{1,2})$")
    _FOURWEEK_PATTERN = re.compile(r"^(?P<year>\d{4})FW(?P<period>\d{1,2})$")
    _DAY_PATTERN = re.compile(r"^(?P<year>\d{4})(?P<month>\d{2})(?P<day>\d{2})$")
    _MONTH_PATTERN = re.compile(r"^(?P<year>\d{4})(?P<month>\d{2})$")
    _BIMONTH_PATTERN = re.compile(r"^(?P<year>\d{4})(?P<month>\d{2})B$")
    _QUARTER_PATTERN = re.compile(r"^(?P<year>\d{4})Q(?P<quarter>[1-4])$")
    _HALF_PATTERN = re.compile(r"^(?P<year>\d{4})S(?P<half>[1-2])$")
    _APRIL_HALF_PATTERN = re.compile(r"^(?P<year>\d{4})AprilS(?P<half>[1-2])$")
    _CUSTOM_YEAR_PATTERN = re.compile(r"^(?P<year>\d{4})(?P<variant>April|July|Oct|Nov)$")
    _YEAR_PATTERN = re.compile(r"^(?P<year>\d{4})$")

    @staticmethod
    def _normalize_period_key(value: Any) -> str | None:
        normalized = str(value or "").strip().lower()
        if not normalized:
            return None
        return _PERIOD_KEY_ALIASES.get(normalized)

    def _configured_period_keys(self, dataset_config: dict[str, Any]) -> list[str]:
        selected: list[str] = []
        for config_key in _EXPLICIT_PERIOD_KEY_CONFIG_KEYS:
            raw_values = dataset_config.get(config_key)
            if isinstance(raw_values, str):
                raw_values = [raw_values]
            if not isinstance(raw_values, list):
                continue
            for raw_value in raw_values:
                normalized = self._normalize_period_key(raw_value)
                if normalized and normalized not in selected:
                    selected.append(normalized)
            if selected:
                break
        return selected

    def _infer_period_keys(
        self,
        dataset_config: dict[str, Any],
        period_values: list[str] | None = None,
    ) -> list[str]:
        configured_periods = (
            list(period_values or [])
            if period_values is not None
            else list(dataset_config.get("periods") or [])
        )
        normalized_periods = [
            self.normalize_period(period_value)
            for period_value in configured_periods
            if str(period_value or "").strip()
        ]
        if not normalized_periods:
            return ["period"]

        observed_keys: set[str] = set()
        for normalized_period in normalized_periods:
            period_level = str(normalized_period.get("period_level") or "").strip()
            if normalized_period.get("period_year"):
                observed_keys.add("period_year")

            if period_level in {"day", "month"}:
                observed_keys.update(
                    {
                        "period_year",
                        "period_half",
                        "period_quarter",
                        "period_month",
                    }
                )
            elif period_level == "quarter":
                observed_keys.update(
                    {"period_year", "period_half", "period_quarter"}
                )
            elif period_level == "half":
                observed_keys.update({"period_year", "period_half"})
            elif period_level == "year":
                observed_keys.add("period_year")
            elif period_level == "week":
                observed_keys.update({"period_year", "period_week"})
            elif period_level in {"biweek", "fourweek"}:
                observed_keys.update({"period_year", "period_biweek"})
            elif period_level == "bimonth":
                observed_keys.update(
                    {
                        "period_year",
                        "period_half",
                        "period_quarter",
                        "period_bimonth",
                    }
                )
            elif period_level == "custom_year":
                observed_keys.add("period_year")

            if normalized_period.get("period_variant"):
                observed_keys.add("period_variant")

        canonical_order = [spec[0] for spec in _PERIOD_COLUMN_SPECS]
        return [
            key
            for key in canonical_order
            if key == "period" or key in observed_keys
        ]

    def resolve_period_hierarchy(
        self,
        dataset_config: dict[str, Any],
        period_values: list[str] | None = None,
    ) -> dict[str, Any]:
        normalized_values = [
            self.normalize_period(period_value)
            for period_value in list(period_values or [])
            if str(period_value or "").strip()
        ]
        levels = sorted({value["period_level"] for value in normalized_values if value["period_level"]})
        return {
            "configured_periods": list(dataset_config.get("periods") or []),
            "auto_detect": bool(dataset_config.get("periods_auto_detect")),
            "levels": levels,
            "values_seen": len(normalized_values),
            "selected_period_keys": (
                self._configured_period_keys(dataset_config)
                or self._infer_period_keys(dataset_config, period_values)
            ),
        }

    def get_period_level_columns(
        self,
        context: PeriodHierarchyContext,
    ) -> list[dict[str, Any]]:
        return list(context.columns)

    def build_period_query_context(
        self,
        dataset_config: dict[str, Any],
        period_values: list[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "configured_periods": list(dataset_config.get("periods") or []),
            "periods_auto_detect": bool(dataset_config.get("periods_auto_detect")),
            "resolved_hierarchy": self.resolve_period_hierarchy(dataset_config, period_values),
        }

    def augment_serving_schema(
        self,
        dataset_config: dict[str, Any],
        used_identifiers: set[str],
    ) -> PeriodHierarchyContext:
        selected_period_keys = self._configured_period_keys(dataset_config)
        if not selected_period_keys:
            selected_period_keys = self._infer_period_keys(dataset_config)
        if "period" not in selected_period_keys:
            selected_period_keys.insert(0, "period")

        column_specs = [
            column_spec
            for column_spec in _PERIOD_COLUMN_SPECS
            if column_spec[0] in selected_period_keys
        ]

        columns: list[dict[str, Any]] = []
        dimension_column_names: list[str] = []
        column_names_by_key: dict[str, str] = {}
        primary_period_column = ""

        for key, label, extra_spec in column_specs:
            column_name = dedupe_identifier(key, used_identifiers)
            extra = {
                _DHIS2_PERIOD_HIERARCHY_EXTRA_KEY: True,
                "dhis2_period_key": key,
            }
            extra.update(extra_spec.get("extra") or {})
            column = {
                "column_name": column_name,
                "verbose_name": label,
                "type": "STRING",
                "sql_type": "TEXT",
                "is_dttm": False,
                "is_dimension": True,
                "extra": extra,
            }
            columns.append(column)
            dimension_column_names.append(column_name)
            column_names_by_key[key] = column_name
            if key == "period":
                primary_period_column = column_name

        diagnostics = self.build_period_query_context(dataset_config)
        diagnostics["selected_period_keys"] = selected_period_keys
        logger.info(
            "Period hierarchy resolved: configured_periods=%s auto_detect=%s selected_keys=%s",
            diagnostics["configured_periods"],
            diagnostics["periods_auto_detect"],
            selected_period_keys,
        )
        return PeriodHierarchyContext(
            columns=columns,
            dimension_column_names=dimension_column_names,
            primary_period_column=primary_period_column,
            column_names_by_key=column_names_by_key,
            diagnostics=diagnostics,
        )

    def normalize_period(self, value: Any) -> dict[str, Any]:
        raw_value = str(value or "").strip()
        normalized = {
            "period": raw_value or None,
            "period_level": None,
            "period_parent": None,
            "period_year": None,
            "period_half": None,
            "period_quarter": None,
            "period_month": None,
            "period_week": None,
            "period_biweek": None,
            "period_bimonth": None,
            "period_variant": None,
        }
        if not raw_value:
            return normalized

        if match := self._DAY_PATTERN.match(raw_value):
            year = match.group("year")
            month = match.group("month")
            normalized.update(
                {
                    "period_level": "day",
                    "period_parent": f"{year}{month}",
                    "period_year": year,
                    "period_quarter": self._quarter_from_month(year, int(month)),
                    "period_month": f"{year}{month}",
                    "period_half": self._half_from_month(year, int(month)),
                }
            )
            return normalized

        if match := self._WEEK_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "week",
                    "period_parent": year,
                    "period_year": year,
                    "period_week": raw_value,
                    "period_variant": self._week_variant(raw_value),
                }
            )
            return normalized

        if match := self._BIWEEK_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "biweek",
                    "period_parent": year,
                    "period_year": year,
                    "period_biweek": raw_value,
                }
            )
            return normalized

        if match := self._FOURWEEK_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "fourweek",
                    "period_parent": year,
                    "period_year": year,
                    "period_biweek": raw_value,
                    "period_variant": "four_week",
                }
            )
            return normalized

        if match := self._MONTH_PATTERN.match(raw_value):
            year = match.group("year")
            month = int(match.group("month"))
            normalized.update(
                {
                    "period_level": "month",
                    "period_parent": self._quarter_from_month(year, month),
                    "period_year": year,
                    "period_quarter": self._quarter_from_month(year, month),
                    "period_month": raw_value,
                    "period_half": self._half_from_month(year, month),
                }
            )
            return normalized

        if match := self._BIMONTH_PATTERN.match(raw_value):
            year = match.group("year")
            month = int(match.group("month"))
            normalized.update(
                {
                    "period_level": "bimonth",
                    "period_parent": self._quarter_from_month(year, month),
                    "period_year": year,
                    "period_quarter": self._quarter_from_month(year, month),
                    "period_half": self._half_from_month(year, month),
                    "period_bimonth": raw_value,
                }
            )
            return normalized

        if match := self._QUARTER_PATTERN.match(raw_value):
            year = match.group("year")
            quarter = match.group("quarter")
            normalized.update(
                {
                    "period_level": "quarter",
                    "period_parent": year,
                    "period_year": year,
                    "period_half": f"{year}S{1 if int(quarter) <= 2 else 2}",
                    "period_quarter": raw_value,
                }
            )
            return normalized

        if match := self._HALF_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "half",
                    "period_parent": year,
                    "period_year": year,
                    "period_half": raw_value,
                }
            )
            return normalized

        if match := self._APRIL_HALF_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "half",
                    "period_parent": f"{year}April",
                    "period_year": year,
                    "period_half": raw_value,
                    "period_variant": "april",
                }
            )
            return normalized

        if match := self._CUSTOM_YEAR_PATTERN.match(raw_value):
            year = match.group("year")
            normalized.update(
                {
                    "period_level": "custom_year",
                    "period_parent": year,
                    "period_year": year,
                    "period_variant": match.group("variant").lower(),
                }
            )
            return normalized

        if match := self._YEAR_PATTERN.match(raw_value):
            normalized.update(
                {
                    "period_level": "year",
                    "period_year": match.group("year"),
                }
            )
            return normalized

        # Try a lightweight parent inference for unexpected custom codes.
        inferred_year = raw_value[:4] if raw_value[:4].isdigit() else None
        normalized.update(
            {
                "period_level": "unknown",
                "period_parent": inferred_year,
                "period_year": inferred_year,
                "period_variant": "custom",
            }
        )
        return normalized

    @staticmethod
    def _quarter_from_month(year: str, month: int) -> str:
        quarter = ((month - 1) // 3) + 1
        return f"{year}Q{quarter}"

    @staticmethod
    def _half_from_month(year: str, month: int) -> str:
        half = 1 if month <= 6 else 2
        return f"{year}S{half}"

    @staticmethod
    def _week_variant(period_code: str) -> str:
        if "WedW" in period_code:
            return "wednesday_week"
        if "ThuW" in period_code:
            return "thursday_week"
        if "SatW" in period_code:
            return "saturday_week"
        if "SunW" in period_code:
            return "sunday_week"
        return "iso_week"
