# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
DHIS2 Sync Service

Handles fetching data from DHIS2 instances and loading into staging tables.
Designed for large-scale data workloads with batched fetching and chunked inserts.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import requests
from flask import current_app, has_app_context

from superset import db
from superset.dhis2.analytical_serving import materialize_serving_rows
from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)
from superset.dhis2.staging_engine import DHIS2StagingEngine
from superset.staging.compat import sync_dhis2_staged_dataset, sync_dhis2_sync_job
from superset.staging import metadata_cache_service
from superset.staging.storage import record_dhis2_stage_rows

logger = logging.getLogger(__name__)

# Maximum number of DHIS2 variable UIDs to include in a single analytics request.
# Larger batches risk exceeding URL length limits on some DHIS2 deployments.
_MAX_VARS_PER_REQUEST = 50

# Page size for DHIS2 analytics pagination.
_ANALYTICS_PAGE_SIZE = 1000
_MIN_ANALYTICS_PAGE_SIZE = 100

# HTTP request timeout in seconds for analytics calls.
_REQUEST_TIMEOUT = 300
_ORG_UNIT_SOURCE_MODE_PRIMARY = "primary"
_ORG_UNIT_SOURCE_MODE_REPOSITORY = "repository"
_ORG_UNIT_SOURCE_MODE_PER_INSTANCE = "per_instance"
_ORG_UNIT_SCOPE_SELECTED = "selected"
_ORG_UNIT_SCOPE_CHILDREN = "children"
_ORG_UNIT_SCOPE_GRANDCHILDREN = "grandchildren"
_ORG_UNIT_SCOPE_ALL_LEVELS = "all_levels"
_ORG_UNIT_HIERARCHY_NAMESPACE = "dhis2_snapshot:orgUnitHierarchy"
_VARIABLE_TYPE_TO_METADATA_TYPE = {
    "dataelement": "dataElements",
    "dataelements": "dataElements",
    "indicator": "indicators",
    "indicators": "indicators",
    "programindicator": "programIndicators",
    "programindicators": "programIndicators",
    "dataset": "dataSets",
    "datasets": "dataSets",
    "eventdataitem": "eventDataItems",
    "eventdataitems": "eventDataItems",
    "eventdataelement": "eventDataItems",
}
_RETRYABLE_ANALYTICS_STATUS_CODES = {408, 429, 500, 502, 503, 504, 520, 522, 524}
_FIXED_PERIOD_PATTERNS = (
    re.compile(r"^\d{8}$"),
    re.compile(r"^\d{4}(?:Wed|Thu|Sat|Sun)?W\d{1,2}$"),
    re.compile(r"^\d{4}BiW\d{1,2}$"),
    re.compile(r"^\d{4}FW\d{1,2}$"),
    re.compile(r"^\d{6}$"),
    re.compile(r"^\d{6}B$"),
    re.compile(r"^\d{4}Q[1-4]$"),
    re.compile(r"^\d{4}S[1-2]$"),
    re.compile(r"^\d{4}AprilS[1-2]$"),
    re.compile(r"^\d{4}$"),
    re.compile(r"^\d{4}(?:April|July|Oct|Nov)$"),
)


@dataclass(frozen=True)
class _IncrementalPeriodPlan:
    use_incremental: bool
    periods_to_fetch: list[str]
    periods_to_delete: list[str]


def _coerce_instance_id(raw_value: Any) -> int | None:
    try:
        return int(raw_value) if raw_value is not None else None
    except (TypeError, ValueError):
        return None


def _normalize_instance_ids(raw_ids: Any) -> list[int]:
    if not isinstance(raw_ids, list):
        return []
    normalized: list[int] = []
    for raw_id in raw_ids:
        instance_id = _coerce_instance_id(raw_id)
        if instance_id is not None and instance_id not in normalized:
            normalized.append(instance_id)
    return normalized


def _normalized_variable_type(raw_value: Any) -> str:
    return "".join(ch for ch in str(raw_value or "").lower() if ch.isalnum())


def _metadata_type_for_variable_type(raw_value: Any) -> str | None:
    return _VARIABLE_TYPE_TO_METADATA_TYPE.get(_normalized_variable_type(raw_value))


def _variable_identity(variable_id: Any, variable_type: Any) -> tuple[str, str]:
    return (str(variable_id or "").strip(), _normalized_variable_type(variable_type))


def _normalize_config_variable_mappings(dataset_config: dict[str, Any]) -> list[dict[str, Any]]:
    raw_mappings = dataset_config.get("variable_mappings")
    if raw_mappings is None:
        raw_mappings = dataset_config.get("variableMappings")
    if not isinstance(raw_mappings, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw_mappings:
        if not isinstance(item, dict):
            continue
        variable_id = str(item.get("variable_id") or item.get("variableId") or "").strip()
        variable_type = str(
            item.get("variable_type") or item.get("variableType") or ""
        ).strip()
        instance_id = _coerce_instance_id(
            item.get("instance_id") or item.get("instanceId")
        )
        if not variable_id or not variable_type or instance_id is None:
            continue
        normalized_item = {
            "instance_id": instance_id,
            "variable_id": variable_id,
            "variable_type": variable_type,
        }
        variable_name = item.get("variable_name") or item.get("variableName")
        alias = item.get("alias")
        extra_params = item.get("extra_params") or item.get("extraParams")
        if isinstance(variable_name, str) and variable_name.strip():
            normalized_item["variable_name"] = variable_name.strip()
        if isinstance(alias, str) and alias.strip():
            normalized_item["alias"] = alias.strip()
        if extra_params is not None:
            normalized_item["extra_params"] = extra_params
        normalized.append(normalized_item)

    return normalized


def _append_unique_error(errors: list[str], message: str) -> None:
    if message not in errors:
        errors.append(message)


def _config_value(config: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in config:
            return config.get(key)
    return None


def _is_fixed_period_code(period: Any) -> bool:
    candidate = str(period or "").strip()
    return any(pattern.match(candidate) for pattern in _FIXED_PERIOD_PATTERNS)


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    absolute = (year * 12 + (month - 1)) + delta
    shifted_year = absolute // 12
    shifted_month = absolute % 12 + 1
    return shifted_year, shifted_month


def _month_period_id(year: int, month: int) -> str:
    return f"{year}{month:02d}"


def _bimonth_period_id(year: int, month: int) -> str:
    start_month = month if month % 2 == 1 else month - 1
    return f"{year}{start_month:02d}B"


def _quarter_period_id(year: int, quarter: int) -> str:
    return f"{year}Q{quarter}"


def _six_month_period_id(year: int, half: int) -> str:
    return f"{year}S{half}"


def _weekly_period_id(target: date, suffix: str = "") -> str:
    iso_year, iso_week, _ = target.isocalendar()
    return f"{iso_year}{suffix}W{iso_week}"


def _biweekly_period_id(target: date) -> str:
    iso_year, iso_week, _ = target.isocalendar()
    return f"{iso_year}BiW{max(1, (iso_week + 1) // 2)}"


def _fourweekly_period_id(target: date) -> str:
    iso_year, iso_week, _ = target.isocalendar()
    return f"{iso_year}FW{max(1, (iso_week + 3) // 4)}"


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))


def _expand_relative_period(period: str, today: date) -> list[str] | None:
    current_year = today.year
    current_month = today.month
    current_quarter = (current_month - 1) // 3 + 1
    current_half = 1 if current_month <= 6 else 2

    if period == "TODAY":
        return [today.strftime("%Y%m%d")]
    if period == "YESTERDAY":
        return [(today - timedelta(days=1)).strftime("%Y%m%d")]
    if period.startswith("LAST_") and period.endswith("_DAYS"):
        try:
            count = int(period.split("_", 2)[1])
        except (TypeError, ValueError):
            return None
        end_date = today - timedelta(days=1)
        return [
            (end_date - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(count - 1, -1, -1)
        ]

    if period == "THIS_WEEK":
        return [_weekly_period_id(today)]
    if period == "LAST_WEEK":
        return [_weekly_period_id(today - timedelta(days=7))]
    if period in {"LAST_4_WEEKS", "LAST_12_WEEKS", "LAST_52_WEEKS"}:
        count = int(period.split("_", 2)[1])
        return [
            _weekly_period_id(today - timedelta(days=7 * offset))
            for offset in range(count, 0, -1)
        ]
    if period == "WEEKS_THIS_YEAR":
        current_week = max(1, today.isocalendar()[1])
        return [f"{current_year}W{week}" for week in range(1, current_week + 1)]
    if period == "WEEKS_LAST_YEAR":
        return [f"{current_year - 1}W{week}" for week in range(1, 53)]

    if period == "THIS_BIWEEK":
        return [_biweekly_period_id(today)]
    if period == "LAST_BIWEEK":
        return [_biweekly_period_id(today - timedelta(days=14))]
    if period in {"LAST_4_BIWEEKS", "LAST_12_BIWEEKS"}:
        count = int(period.split("_", 2)[1])
        return [
            _biweekly_period_id(today - timedelta(days=14 * offset))
            for offset in range(count, 0, -1)
        ]
    if period == "BIWEEKS_THIS_YEAR":
        current_biweek = max(1, (today.isocalendar()[1] + 1) // 2)
        return [f"{current_year}BiW{biweek}" for biweek in range(1, current_biweek + 1)]
    if period == "BIWEEKS_LAST_YEAR":
        return [f"{current_year - 1}BiW{biweek}" for biweek in range(1, 27)]

    if period == "THIS_MONTH":
        return [_month_period_id(current_year, current_month)]
    if period == "LAST_MONTH":
        year, month = _shift_month(current_year, current_month, -1)
        return [_month_period_id(year, month)]
    if period in {"LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS"}:
        count = int(period.split("_", 2)[1])
        return [
            _month_period_id(*_shift_month(current_year, current_month, -offset))
            for offset in range(count, 0, -1)
        ]
    if period == "MONTHS_THIS_YEAR":
        return [_month_period_id(current_year, month) for month in range(1, current_month + 1)]
    if period == "MONTHS_LAST_YEAR":
        return [_month_period_id(current_year - 1, month) for month in range(1, 13)]

    if period == "THIS_BIMONTH":
        return [_bimonth_period_id(current_year, current_month)]
    if period == "LAST_BIMONTH":
        year, month = _shift_month(current_year, current_month, -2)
        return [_bimonth_period_id(year, month)]
    if period == "LAST_6_BIMONTHS":
        return [
            _bimonth_period_id(*_shift_month(current_year, current_month, -(offset * 2)))
            for offset in range(6, 0, -1)
        ]
    if period == "BIMONTHS_THIS_YEAR":
        return [
            _bimonth_period_id(current_year, month)
            for month in range(1, current_month + 1, 2)
        ]
    if period == "BIMONTHS_LAST_YEAR":
        return [
            _bimonth_period_id(current_year - 1, month)
            for month in range(1, 13, 2)
        ]

    if period == "THIS_QUARTER":
        return [_quarter_period_id(current_year, current_quarter)]
    if period == "LAST_QUARTER":
        year = current_year
        quarter = current_quarter - 1
        if quarter < 1:
            year -= 1
            quarter = 4
        return [_quarter_period_id(year, quarter)]
    if period == "LAST_4_QUARTERS":
        result: list[str] = []
        year = current_year
        quarter = current_quarter
        for _ in range(4):
            quarter -= 1
            if quarter < 1:
                year -= 1
                quarter = 4
            result.insert(0, _quarter_period_id(year, quarter))
        return result
    if period == "QUARTERS_THIS_YEAR":
        return [_quarter_period_id(current_year, quarter) for quarter in range(1, current_quarter + 1)]
    if period == "QUARTERS_LAST_YEAR":
        return [_quarter_period_id(current_year - 1, quarter) for quarter in range(1, 5)]

    if period == "THIS_SIX_MONTH":
        return [_six_month_period_id(current_year, current_half)]
    if period == "LAST_SIX_MONTH":
        if current_half == 1:
            return [_six_month_period_id(current_year - 1, 2)]
        return [_six_month_period_id(current_year, 1)]
    if period == "LAST_2_SIXMONTHS":
        if current_half == 1:
            return [
                _six_month_period_id(current_year - 1, 1),
                _six_month_period_id(current_year - 1, 2),
            ]
        return [
            _six_month_period_id(current_year - 1, 2),
            _six_month_period_id(current_year, 1),
        ]
    if period == "SIXMONTHS_THIS_YEAR":
        return [_six_month_period_id(current_year, half) for half in range(1, current_half + 1)]
    if period == "SIXMONTHS_LAST_YEAR":
        return [_six_month_period_id(current_year - 1, half) for half in range(1, 3)]

    if period == "THIS_YEAR":
        return [str(current_year)]
    if period == "LAST_YEAR":
        return [str(current_year - 1)]
    if period == "LAST_5_YEARS":
        return [str(year) for year in range(current_year - 5, current_year)]
    if period == "LAST_10_YEARS":
        return [str(year) for year in range(current_year - 10, current_year)]

    return None


def _expand_periods_for_incremental_sync(
    periods_cfg: list[str],
    today: date | None = None,
) -> tuple[list[str] | None, bool]:
    resolved_today = today or datetime.utcnow().date()
    expanded_periods: list[str] = []
    has_relative = False
    for period in periods_cfg:
        normalized = str(period or "").strip()
        if not normalized:
            continue
        if _is_fixed_period_code(normalized):
            expanded_periods.append(normalized)
            continue
        has_relative = True
        expanded = _expand_relative_period(normalized, resolved_today)
        if expanded is None:
            return None, True
        expanded_periods.extend(expanded)
    return _dedupe_preserve_order(expanded_periods), has_relative


def _build_variable_stub(
    *,
    instance_id: int,
    variable_id: str,
    variable_type: str,
    variable_name: str | None = None,
    alias: str | None = None,
    extra_params: Any = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        instance_id=instance_id,
        variable_id=variable_id,
        variable_type=variable_type,
        variable_name=variable_name,
        alias=alias,
        extra_params=extra_params,
    )


def _analytics_error_status_code(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    try:
        return int(response.status_code) if response is not None else None
    except (TypeError, ValueError, AttributeError):
        return None


def _is_retryable_analytics_error(exc: Exception) -> bool:
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return True
    status_code = _analytics_error_status_code(exc)
    return status_code in _RETRYABLE_ANALYTICS_STATUS_CODES


def get_instances_with_legacy_fallback(
    database_id: int,
    include_inactive: bool = False,
) -> list[DHIS2Instance]:
    from superset.dhis2.instance_service import (
        get_instances_with_legacy_fallback as _get_instances_with_legacy_fallback,
    )

    return _get_instances_with_legacy_fallback(
        database_id,
        include_inactive=include_inactive,
    )


def _sync_compat_dataset(dataset: DHIS2StagedDataset) -> None:
    try:
        sync_dhis2_staged_dataset(dataset)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to mirror DHIS2StagedDataset id=%s sync status into generic metadata",
            getattr(dataset, "id", None),
            exc_info=True,
        )


def _sync_compat_job(
    job: DHIS2SyncJob,
    result_payload: dict[str, Any] | None = None,
) -> None:
    try:
        sync_dhis2_sync_job(job, result_payload)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to mirror DHIS2SyncJob id=%s into generic metadata",
            getattr(job, "id", None),
            exc_info=True,
        )


def _normalize_org_unit_scope(scope: Any) -> str:
    candidate = str(scope or _ORG_UNIT_SCOPE_SELECTED).strip().lower()
    if candidate in {
        _ORG_UNIT_SCOPE_CHILDREN,
        _ORG_UNIT_SCOPE_GRANDCHILDREN,
        _ORG_UNIT_SCOPE_ALL_LEVELS,
    }:
        return candidate
    return _ORG_UNIT_SCOPE_SELECTED


def _node_level(node: dict[str, Any]) -> int | None:
    level = node.get("level")
    try:
        return int(level) if level is not None else None
    except (TypeError, ValueError):
        return None


def _ancestor_depth(node: dict[str, Any]) -> int:
    ancestors = node.get("ancestorIds")
    return len(ancestors) if isinstance(ancestors, list) else 0


def _load_org_unit_hierarchy(
    *,
    database_id: int | None,
    instance_id: int,
) -> list[dict[str, Any]]:
    if database_id is None:
        return []

    try:
        snapshot = metadata_cache_service.get_cached_metadata_payload(
            database_id,
            _ORG_UNIT_HIERARCHY_NAMESPACE,
            {"instance_id": instance_id},
        )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to load staged org-unit hierarchy for database=%s instance=%s",
            database_id,
            instance_id,
            exc_info=True,
        )
        return []

    if not isinstance(snapshot, dict) or snapshot.get("status") != "success":
        return []

    result = snapshot.get("result")
    return list(result) if isinstance(result, list) else []


def _expand_org_units_for_scope(
    *,
    instance: DHIS2Instance,
    allowed_units: list[str],
    scope: str,
) -> list[str]:
    if scope == _ORG_UNIT_SCOPE_SELECTED or not allowed_units:
        return allowed_units

    hierarchy_nodes = _load_org_unit_hierarchy(
        database_id=getattr(instance, "database_id", None),
        instance_id=instance.id,
    )
    if not hierarchy_nodes:
        return allowed_units

    node_lookup = {
        str(node.get("id") or "").strip(): node
        for node in hierarchy_nodes
        if isinstance(node, dict) and str(node.get("id") or "").strip()
    }
    if not node_lookup:
        return allowed_units

    selected_root_ids = list(dict.fromkeys(unit for unit in allowed_units if unit in node_lookup))
    if not selected_root_ids:
        return allowed_units

    max_depth = {
        _ORG_UNIT_SCOPE_CHILDREN: 1,
        _ORG_UNIT_SCOPE_GRANDCHILDREN: 2,
        _ORG_UNIT_SCOPE_ALL_LEVELS: None,
    }.get(scope)

    expanded = set(selected_root_ids)
    for root_id in selected_root_ids:
        root_node = node_lookup.get(root_id) or {}
        root_level = _node_level(root_node)
        root_ancestor_depth = _ancestor_depth(root_node)

        for node_id, node in node_lookup.items():
            if node_id == root_id:
                continue

            ancestor_ids = node.get("ancestorIds")
            if not isinstance(ancestor_ids, list) or root_id not in ancestor_ids:
                continue

            node_level = _node_level(node)
            if node_level is not None and root_level is not None:
                descendant_depth = node_level - root_level
            else:
                descendant_depth = _ancestor_depth(node) - root_ancestor_depth

            if descendant_depth <= 0:
                continue
            if max_depth is not None and descendant_depth > max_depth:
                continue
            expanded.add(node_id)

    ordered_units = [unit for unit in allowed_units if unit in expanded]
    ordered_units.extend(
        unit_id
        for unit_id in sorted(expanded)
        if unit_id not in ordered_units
    )
    return ordered_units


def _source_org_unit_id(detail: dict[str, Any]) -> str | None:
    candidate = _config_value(detail, "source_org_unit_id", "sourceOrgUnitId", "id")
    return candidate if isinstance(candidate, str) and candidate else None


def _selected_org_unit_depth(detail: dict[str, Any]) -> int:
    level = _config_value(detail, "level", "repositoryLevel")
    try:
        if level is not None:
            return int(level)
    except (TypeError, ValueError):
        pass

    path = detail.get("path")
    if isinstance(path, str) and path.strip():
        return len([segment for segment in path.split("/") if segment.strip()])

    return 0


def _selected_org_unit_is_descendant(
    detail: dict[str, Any],
    ancestor_source_id: str,
) -> bool:
    parent_id = _config_value(detail, "parentId", "parent_id")
    if isinstance(parent_id, str) and parent_id:
        normalized_parent_id = parent_id.split("::", 1)[1] if "::" in parent_id else parent_id
        if normalized_parent_id == ancestor_source_id:
            return True

    path = _config_value(detail, "path")
    if isinstance(path, str) and path.strip():
        path_segments = [segment for segment in path.split("/") if segment.strip()]
        return ancestor_source_id in path_segments[:-1]

    return False


def _prune_descendant_root_org_units(
    allowed_units: list[str],
    selected_detail_map: dict[str, dict[str, Any]],
) -> list[str]:
    """Remove descendant root selections when an ancestor is already selected.

    Dataset org-unit selections represent root scopes, not every descendant that
    should be fetched. Descendant units under an already selected ancestor would
    either be redundant or exceed the chosen stop level, so keep only the
    shallowest selected roots and let scope expansion handle the rest.
    """
    unique_units = list(dict.fromkeys(unit for unit in allowed_units if unit))
    if len(unique_units) <= 1:
        return unique_units

    detail_by_source_id: dict[str, dict[str, Any]] = {}
    for detail in selected_detail_map.values():
        if not isinstance(detail, dict):
            continue
        source_id = _source_org_unit_id(detail)
        if source_id and source_id not in detail_by_source_id:
            detail_by_source_id[source_id] = detail

    ordered_units = sorted(
        unique_units,
        key=lambda unit: (_selected_org_unit_depth(detail_by_source_id.get(unit, {})), unique_units.index(unit)),
    )

    kept: list[str] = []
    for unit in ordered_units:
        detail = detail_by_source_id.get(unit, {})
        if any(
            _selected_org_unit_is_descendant(detail, ancestor_unit)
            for ancestor_unit in kept
        ):
            continue
        kept.append(unit)

    return [unit for unit in unique_units if unit in kept]


def _resolve_incremental_period_plan(
    dataset: DHIS2StagedDataset,
    instance: DHIS2Instance,
    dataset_config: dict[str, Any],
) -> _IncrementalPeriodPlan:
    periods_cfg = dataset_config.get("periods", ["LAST_12_MONTHS"])
    if isinstance(periods_cfg, str):
        periods_cfg = [periods_cfg]
    if not isinstance(periods_cfg, list):
        periods_cfg = ["LAST_12_MONTHS"]

    expanded_periods, has_relative = _expand_periods_for_incremental_sync(
        [str(period).strip() for period in periods_cfg if str(period).strip()]
    )
    if expanded_periods is None:
        return _IncrementalPeriodPlan(
            use_incremental=False,
            periods_to_fetch=list(dict.fromkeys([str(period) for period in periods_cfg])),
            periods_to_delete=[],
        )
    if not expanded_periods:
        return _IncrementalPeriodPlan(
            use_incremental=False,
            periods_to_fetch=list(dict.fromkeys([str(period) for period in periods_cfg])),
            periods_to_delete=[],
        )

    staging_engine = DHIS2StagingEngine(dataset.database_id)
    existing_periods = staging_engine.get_instance_periods(dataset, instance.id)
    existing_period_set = set(existing_periods)
    target_period_set = set(expanded_periods)
    periods_to_delete = [
        period
        for period in existing_periods
        if period not in target_period_set
    ]

    if not existing_periods:
        return _IncrementalPeriodPlan(
            use_incremental=True,
            periods_to_fetch=expanded_periods,
            periods_to_delete=periods_to_delete,
        )

    if not has_relative:
        return _IncrementalPeriodPlan(
            use_incremental=True,
            periods_to_fetch=[
                period for period in expanded_periods if period not in existing_period_set
            ],
            periods_to_delete=periods_to_delete,
        )

    latest_existing_target = next(
        (
            period
            for period in reversed(expanded_periods)
            if period in existing_period_set
        ),
        None,
    )
    periods_to_fetch: list[str] = []
    if latest_existing_target:
        periods_to_fetch.append(latest_existing_target)
    periods_to_fetch.extend(
        period for period in expanded_periods if period not in existing_period_set
    )

    return _IncrementalPeriodPlan(
        use_incremental=True,
        periods_to_fetch=_dedupe_preserve_order(periods_to_fetch),
        periods_to_delete=periods_to_delete,
    )


class DHIS2SyncService:
    """Orchestrates multi-instance DHIS2 data sync into staging storage.

    Each call to :meth:`sync_staged_dataset` is designed to be idempotent.
    Full refresh mode replaces all rows for each source instance. Incremental
    refresh mode upserts only the newly required periods, re-fetches the latest
    in-window period to keep rolling windows current, and prunes periods that
    fall outside the configured window. If one instance fails, the rows for the
    remaining instances are still processed and loaded, so a partial failure
    leaves previously loaded data for the failed instance intact.
    """

    # ------------------------------------------------------------------
    # Public entrypoint
    # ------------------------------------------------------------------

    def _fetch_analytics_batch(
        self,
        *,
        instance: DHIS2Instance,
        batch: list[str],
        periods: list[str],
        org_units: list[str],
        variable_map: dict[str, DHIS2DatasetVariable],
        page_size: int,
    ) -> list[dict[str, Any]]:
        try:
            page = 1
            all_rows: list[dict[str, Any]] = []
            while True:
                raw = self._make_analytics_request(
                    instance=instance,
                    dx_ids=batch,
                    periods=periods,
                    org_units=org_units,
                    page=page,
                    page_size=page_size,
                )
                batch_rows = self._normalize_analytics_response(
                    raw,
                    variable_map,
                    instance,
                )
                all_rows.extend(batch_rows)

                pager = raw.get("pager", {})
                page_count = pager.get("pageCount", 1)
                current_page = pager.get("page", 1)
                if current_page >= page_count:
                    break
                page += 1

            return all_rows
        except Exception as exc:  # pylint: disable=broad-except
            if _is_retryable_analytics_error(exc):
                if page_size > _MIN_ANALYTICS_PAGE_SIZE:
                    reduced_page_size = max(_MIN_ANALYTICS_PAGE_SIZE, page_size // 2)
                    if reduced_page_size < page_size:
                        logger.warning(
                            "Sync: retryable analytics failure for instance '%s' batch_size=%d; retrying with page_size=%d",
                            instance.name,
                            len(batch),
                            reduced_page_size,
                            exc_info=True,
                        )
                        return self._fetch_analytics_batch(
                            instance=instance,
                            batch=batch,
                            periods=periods,
                            org_units=org_units,
                            variable_map=variable_map,
                            page_size=reduced_page_size,
                        )

                if len(batch) > 1:
                    midpoint = max(1, len(batch) // 2)
                    left_batch = batch[:midpoint]
                    right_batch = batch[midpoint:]
                    logger.warning(
                        "Sync: retryable analytics failure for instance '%s'; splitting variable batch from %d to %d and %d",
                        instance.name,
                        len(batch),
                        len(left_batch),
                        len(right_batch),
                        exc_info=True,
                    )
                    left_rows = self._fetch_analytics_batch(
                        instance=instance,
                        batch=left_batch,
                        periods=periods,
                        org_units=org_units,
                        variable_map=variable_map,
                        page_size=page_size,
                    )
                    right_rows = self._fetch_analytics_batch(
                        instance=instance,
                        batch=right_batch,
                        periods=periods,
                        org_units=org_units,
                        variable_map=variable_map,
                        page_size=page_size,
                    )
                    return [*left_rows, *right_rows]

            raise

    def _lookup_metadata_snapshot_ids(
        self,
        *,
        database_id: int,
        instance_id: int,
        metadata_type: str,
        cache: dict[tuple[int, str], set[str]],
    ) -> set[str]:
        cache_key = (instance_id, metadata_type)
        if cache_key in cache:
            return cache[cache_key]

        ids: set[str] = set()
        try:
            snapshot = metadata_cache_service.get_cached_metadata_payload(
                database_id,
                f"dhis2_snapshot:{metadata_type}",
                {"instance_id": instance_id},
            )
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Sync: failed to load staged metadata snapshot '%s' for database=%s instance=%s",
                metadata_type,
                database_id,
                instance_id,
                exc_info=True,
            )
            snapshot = None

        if isinstance(snapshot, dict) and snapshot.get("status") == "success":
            result = snapshot.get("result")
            if isinstance(result, list):
                for item in result:
                    if not isinstance(item, dict):
                        continue
                    metadata_id = str(item.get("id") or "").strip()
                    if metadata_id:
                        ids.add(metadata_id)

        cache[cache_key] = ids
        return ids

    def _resolve_instance_variable_plan(
        self,
        dataset: DHIS2StagedDataset,
        variables: list[DHIS2DatasetVariable],
        dataset_config: dict[str, Any],
    ) -> tuple[dict[int, DHIS2Instance], dict[int, list[Any]], list[str]]:
        configured_instance_ids = _normalize_instance_ids(
            dataset_config.get("configured_connection_ids")
        )
        available_instances = get_instances_with_legacy_fallback(
            dataset.database_id,
            include_inactive=True,
        )
        if configured_instance_ids:
            available_instances = [
                instance
                for instance in available_instances
                if instance.id in configured_instance_ids
            ]

        available_instance_lookup = {
            instance.id: instance for instance in available_instances
        }
        active_instance_lookup = {
            instance.id: instance
            for instance in available_instances
            if getattr(instance, "is_active", True)
        }

        configuration_errors: list[str] = []
        if not available_instances:
            if configured_instance_ids:
                _append_unique_error(
                    configuration_errors,
                    "None of the configured DHIS2 instances for this dataset are available on the selected database.",
                )
            else:
                _append_unique_error(
                    configuration_errors,
                    "No DHIS2 instances are configured for this dataset database.",
                )
            return active_instance_lookup, {}, configuration_errors

        config_mappings = _normalize_config_variable_mappings(dataset_config)
        config_by_identity: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(
            list
        )
        for mapping in config_mappings:
            config_by_identity[
                _variable_identity(mapping["variable_id"], mapping["variable_type"])
            ].append(mapping)

        metadata_match_cache: dict[tuple[int, str], set[str]] = {}
        instance_vars: dict[int, list[Any]] = defaultdict(list)
        resolved_keys: set[tuple[int, str, str]] = set()
        unresolved_variables: list[tuple[Any, tuple[str, str]]] = []

        for variable in variables:
            identity = _variable_identity(variable.variable_id, variable.variable_type)
            if not identity[0] or not identity[1]:
                _append_unique_error(
                    configuration_errors,
                    "A dataset variable is missing its DHIS2 id or type and cannot be refreshed.",
                )
                continue

            instance_id = _coerce_instance_id(getattr(variable, "instance_id", None))
            if instance_id is not None and instance_id in active_instance_lookup:
                resolved_key = (instance_id, identity[0], identity[1])
                if resolved_key not in resolved_keys:
                    instance_vars[instance_id].append(variable)
                    resolved_keys.add(resolved_key)
                continue

            if instance_id is not None:
                if instance_id in available_instance_lookup:
                    _append_unique_error(
                        configuration_errors,
                        (
                            f"Dataset variable '{identity[0]}' is mapped to inactive DHIS2 "
                            f"instance {instance_id}."
                        ),
                    )
                else:
                    _append_unique_error(
                        configuration_errors,
                        (
                            f"Dataset variable '{identity[0]}' is mapped to DHIS2 instance "
                            f"{instance_id}, which is not configured on the dataset database."
                        ),
                    )

            unresolved_variables.append((variable, identity))

        for variable, identity in unresolved_variables:
            candidate_instance_ids = list(
                dict.fromkeys(
                    mapping["instance_id"]
                    for mapping in config_by_identity.get(identity, [])
                    if mapping["instance_id"] in active_instance_lookup
                )
            )

            if not candidate_instance_ids:
                metadata_type = _metadata_type_for_variable_type(
                    getattr(variable, "variable_type", None)
                )
                if metadata_type is not None:
                    for instance_id in active_instance_lookup:
                        snapshot_ids = self._lookup_metadata_snapshot_ids(
                            database_id=dataset.database_id,
                            instance_id=instance_id,
                            metadata_type=metadata_type,
                            cache=metadata_match_cache,
                        )
                        if identity[0] in snapshot_ids:
                            candidate_instance_ids.append(instance_id)
                    candidate_instance_ids = list(dict.fromkeys(candidate_instance_ids))

            if len(candidate_instance_ids) == 1:
                resolved_instance_id = candidate_instance_ids[0]
                resolved_key = (resolved_instance_id, identity[0], identity[1])
                if resolved_key not in resolved_keys:
                    instance_vars[resolved_instance_id].append(
                        _build_variable_stub(
                            instance_id=resolved_instance_id,
                            variable_id=variable.variable_id,
                            variable_type=variable.variable_type,
                            variable_name=getattr(variable, "variable_name", None),
                            alias=getattr(variable, "alias", None),
                            extra_params=getattr(variable, "extra_params", None),
                        )
                    )
                    resolved_keys.add(resolved_key)
                continue

            if len(candidate_instance_ids) > 1:
                _append_unique_error(
                    configuration_errors,
                    (
                        f"Dataset variable '{identity[0]}' matches more than one configured "
                        "DHIS2 instance. Re-save the dataset to refresh the instance mapping."
                    ),
                )
                continue

            _append_unique_error(
                configuration_errors,
                (
                    f"Dataset variable '{identity[0]}' could not be matched to any configured "
                    "DHIS2 instance for this dataset."
                ),
            )

        for mapping in config_mappings:
            instance_id = mapping["instance_id"]
            resolved_key = (
                instance_id,
                str(mapping["variable_id"]).strip(),
                _normalized_variable_type(mapping["variable_type"]),
            )
            if resolved_key in resolved_keys:
                continue

            if instance_id not in available_instance_lookup:
                _append_unique_error(
                    configuration_errors,
                    (
                        f"Dataset configuration references DHIS2 instance {instance_id}, "
                        "which is not configured on the dataset database."
                    ),
                )
                continue
            if instance_id not in active_instance_lookup:
                _append_unique_error(
                    configuration_errors,
                    (
                        f"Dataset configuration references inactive DHIS2 instance "
                        f"{instance_id}."
                    ),
                )
                continue

            instance_vars[instance_id].append(
                _build_variable_stub(
                    instance_id=instance_id,
                    variable_id=mapping["variable_id"],
                    variable_type=mapping["variable_type"],
                    variable_name=mapping.get("variable_name"),
                    alias=mapping.get("alias"),
                    extra_params=mapping.get("extra_params"),
                )
            )
            resolved_keys.add(resolved_key)

        if not instance_vars and not configuration_errors:
            _append_unique_error(
                configuration_errors,
                "No DHIS2 variables could be resolved to a configured source instance for this dataset.",
            )

        return active_instance_lookup, instance_vars, configuration_errors

    def sync_staged_dataset(
        self,
        staged_dataset_id: int,
        job_id: int | None = None,
        incremental: bool = False,
    ) -> dict[str, Any]:
        """Synchronise all variables for a staged dataset from their source instances.

        Groups :class:`~superset.dhis2.models.DHIS2DatasetVariable` records by
        their source :class:`~superset.dhis2.models.DHIS2Instance`, fetches each
        instance in turn, and loads results into the staging table.  One instance
        failure does not abort the others.

        Args:
            staged_dataset_id: Primary key of the
                :class:`~superset.dhis2.models.DHIS2StagedDataset` to sync.
            job_id: If provided, progress is written back to this
                :class:`~superset.dhis2.models.DHIS2SyncJob` record.
            incremental: When ``True``, refresh only missing periods plus the
                latest in-window period for rolling relative selections, and
                prune periods that have fallen out of the configured window.
                When ``False``, perform a full per-instance replacement. The
                background/manual scheduling paths use incremental refresh by
                default; direct service callers may still request a full repair
                refresh explicitly.

        Returns:
            A dict with keys ``status``, ``total_rows``, ``instances``, and
            ``duration_seconds``::

                {
                    "status": "success" | "partial" | "failed",
                    "total_rows": int,
                    "instances": {
                        instance_id: {
                            "status": "success" | "failed",
                            "rows": int,
                            "error": str | None,
                        }
                    },
                    "duration_seconds": float,
                }
        """
        started_at = time.monotonic()

        # Retrieve the dataset and its variables in a single query.
        dataset: DHIS2StagedDataset | None = (
            db.session.query(DHIS2StagedDataset)
            .filter_by(id=staged_dataset_id)
            .first()
        )
        if dataset is None:
            raise ValueError(
                f"DHIS2StagedDataset with id={staged_dataset_id} not found"
            )

        dataset.last_sync_status = "running"
        dataset.last_sync_rows = 0
        _sync_compat_dataset(dataset)
        db.session.commit()

        dataset_config = dataset.get_dataset_config()
        variables: list[DHIS2DatasetVariable] = (
            db.session.query(DHIS2DatasetVariable)
            .filter_by(staged_dataset_id=staged_dataset_id)
            .all()
        )
        instance_lookup, instance_vars, configuration_errors = (
            self._resolve_instance_variable_plan(dataset, variables, dataset_config)
        )

        instance_results: dict[str, Any] = {}
        total_rows = 0
        any_success = False
        any_failure = bool(configuration_errors)

        for message in configuration_errors:
            logger.warning(
                "Sync: dataset=%d configuration issue: %s",
                staged_dataset_id,
                message,
            )

        for instance_id, inst_vars in instance_vars.items():
            instance = instance_lookup.get(instance_id)
            if instance is None:
                logger.warning(
                    "Sync: skipping unknown instance_id=%d for dataset=%d",
                    instance_id,
                    staged_dataset_id,
                )
                instance_results[str(instance_id)] = {
                    "status": "failed",
                    "rows": 0,
                    "error": f"DHIS2Instance {instance_id} not found",
                }
                any_failure = True
                continue

            logger.info(
                "Sync: fetching from instance '%s' (%d variables) for dataset=%d",
                instance.name,
                len(inst_vars),
                staged_dataset_id,
            )

            try:
                effective_config = dict(dataset_config)
                incremental_plan = _IncrementalPeriodPlan(
                    use_incremental=False,
                    periods_to_fetch=[],
                    periods_to_delete=[],
                )
                if incremental:
                    incremental_plan = _resolve_incremental_period_plan(
                        dataset,
                        instance,
                        dataset_config,
                    )
                    if incremental_plan.periods_to_fetch:
                        effective_config["periods"] = incremental_plan.periods_to_fetch
                rows: list[dict[str, Any]] = []
                if not incremental or incremental_plan.periods_to_fetch:
                    rows = self._fetch_from_instance(
                        instance,
                        inst_vars,
                        effective_config,
                    )
                row_count = self._load_rows(
                    dataset,
                    instance,
                    rows,
                    sync_job_id=job_id,
                    replace_instance_rows=not incremental_plan.use_incremental,
                    periods_to_prune=incremental_plan.periods_to_delete,
                )

                total_rows += row_count
                any_success = True
                instance_results[str(instance_id)] = {
                    "status": "success",
                    "rows": row_count,
                    "error": None,
                    "sync_mode": (
                        "incremental" if incremental_plan.use_incremental else "full"
                    ),
                }
                logger.info(
                    "Sync: loaded %d rows from instance '%s' into dataset=%d",
                    row_count,
                    instance.name,
                    staged_dataset_id,
                )
                try:
                    self._materialize_serving_table(dataset)
                except Exception:  # pylint: disable=broad-except
                    logger.exception(
                        "Sync: failed to publish partial serving rows for dataset=%d after instance='%s'",
                        staged_dataset_id,
                        instance.name,
                    )
                dataset.last_sync_status = "running"
                dataset.last_sync_rows = total_rows
                _sync_compat_dataset(dataset)
                db.session.commit()
            except Exception as exc:  # pylint: disable=broad-except
                any_failure = True
                err_msg = str(exc)
                instance_results[str(instance_id)] = {
                    "status": "failed",
                    "rows": 0,
                    "error": err_msg,
                }
                logger.exception(
                    "Sync: failed for instance '%s', dataset=%d: %s",
                    instance.name,
                    staged_dataset_id,
                    err_msg,
                )

        duration = time.monotonic() - started_at

        if any_failure and any_success:
            status = "partial"
        elif any_failure:
            status = "failed"
        else:
            status = "success"

        result: dict[str, Any] = {
            "status": status,
            "total_rows": total_rows,
            "instances": instance_results,
            "duration_seconds": round(duration, 3),
        }
        if configuration_errors:
            result["configuration_errors"] = configuration_errors

        if any_success:
            try:
                self._materialize_serving_table(dataset)
            except Exception:  # pylint: disable=broad-except
                logger.exception(
                    "Sync: failed to materialize analytical serving table for dataset=%d",
                    staged_dataset_id,
                )
                if status == "success":
                    status = "partial"
                result["status"] = status
                result["serving_materialization_error"] = (
                    "Failed to build the local analytical serving table."
                )

        # Update the sync tracking columns on the dataset record.
        dataset.last_sync_at = datetime.utcnow()
        dataset.last_sync_status = status
        dataset.last_sync_rows = total_rows
        _sync_compat_dataset(dataset)
        db.session.commit()

        # Propagate back to the job record if one was supplied.
        if job_id is not None:
            job: DHIS2SyncJob | None = db.session.query(DHIS2SyncJob).get(job_id)
            if job is not None:
                self.update_job_status(
                    job,
                    status=status,
                    rows_loaded=total_rows,
                    rows_failed=sum(
                        1
                        for v in instance_results.values()
                        if v["status"] == "failed"
                    ),
                    error_message="\n".join(configuration_errors)
                    if configuration_errors
                    else None,
                    instance_results=instance_results,
                )

        logger.info(
            "Sync: dataset=%d completed status=%s rows=%d duration=%.1fs",
            staged_dataset_id,
            status,
            total_rows,
            duration,
        )
        return result

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    def _fetch_from_instance(
        self,
        instance: DHIS2Instance,
        variables: list[DHIS2DatasetVariable],
        dataset_config: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Fetch analytics data for *variables* from *instance*.

        Variables are split into batches of at most :data:`_MAX_VARS_PER_REQUEST`
        UIDs to avoid URL length limits.  Each batch is fully paginated before
        the next batch is processed.  Metadata (org-unit names, period labels)
        is harvested from the ``metaData`` block returned by DHIS2.

        Args:
            instance: Authenticated DHIS2 instance record.
            variables: Dataset variable rows to fetch.
            dataset_config: Parsed ``DHIS2StagedDataset.dataset_config`` dict.
                Expected keys:

                - ``periods`` (list[str] | str): e.g. ``["LAST_12_MONTHS"]``
                - ``org_units`` (list[str]): e.g. ``["LEVEL-3"]``

        Returns:
            A flat list of row dicts suitable for insertion into the staging
            table.
        """
        periods_cfg = dataset_config.get("periods", ["LAST_12_MONTHS"])
        if isinstance(periods_cfg, str):
            periods_cfg = [periods_cfg]

        org_units_cfg = self._resolve_org_units_for_instance(instance, dataset_config)

        # Build a map of variable_id -> DHIS2DatasetVariable for metadata lookup.
        variable_map: dict[str, DHIS2DatasetVariable] = {
            var.variable_id: var for var in variables
        }
        dx_ids = list(variable_map.keys())

        all_rows: list[dict[str, Any]] = []

        # Split dx_ids into batches.
        for batch_start in range(0, len(dx_ids), _MAX_VARS_PER_REQUEST):
            batch = dx_ids[batch_start : batch_start + _MAX_VARS_PER_REQUEST]
            batch_rows = self._fetch_analytics_batch(
                instance=instance,
                batch=batch,
                periods=periods_cfg,
                org_units=org_units_cfg,
                variable_map=variable_map,
                page_size=_ANALYTICS_PAGE_SIZE,
            )
            all_rows.extend(batch_rows)

        return all_rows

    @staticmethod
    def _resolve_org_units_for_instance(
        instance: DHIS2Instance,
        dataset_config: dict[str, Any],
    ) -> list[str]:
        org_units_cfg = dataset_config.get("org_units", ["USER_ORGUNIT"])
        if isinstance(org_units_cfg, str):
            org_units_cfg = [org_units_cfg]

        org_unit_source_mode = str(
            dataset_config.get("org_unit_source_mode", _ORG_UNIT_SOURCE_MODE_REPOSITORY)
        ).lower()
        org_unit_scope = _normalize_org_unit_scope(
            dataset_config.get("org_unit_scope")
        )
        if org_unit_source_mode == "federated":
            org_unit_source_mode = _ORG_UNIT_SOURCE_MODE_REPOSITORY
        selected_details = dataset_config.get("org_unit_details", []) or []
        if not isinstance(selected_details, list):
            return list(dict.fromkeys(org_units_cfg))

        user_scope_units = [
            unit
            for unit in org_units_cfg
            if unit
            in {
                "USER_ORGUNIT",
                "USER_ORGUNIT_CHILDREN",
                "USER_ORGUNIT_GRANDCHILDREN",
            }
        ]
        concrete_units = [
            unit
            for unit in org_units_cfg
            if unit not in set(user_scope_units)
        ]
        selected_detail_map: dict[str, dict[str, Any]] = {}
        for item in selected_details:
            if not isinstance(item, dict):
                continue
            selection_key = _config_value(item, "selection_key", "selectionKey", "id")
            if isinstance(selection_key, str) and selection_key:
                selected_detail_map[selection_key] = item

        if org_unit_source_mode == _ORG_UNIT_SOURCE_MODE_PRIMARY:
            primary_units = [
                str(_config_value(item, "source_org_unit_id", "sourceOrgUnitId", "id"))
                for key, item in selected_detail_map.items()
                if key in concrete_units
                and isinstance(
                    _config_value(item, "source_org_unit_id", "sourceOrgUnitId", "id"),
                    str,
                )
            ]
            if not primary_units:
                primary_units = concrete_units
            primary_units = _prune_descendant_root_org_units(
                list(dict.fromkeys(primary_units)),
                selected_detail_map,
            )
            scoped_units = _expand_org_units_for_scope(
                instance=instance,
                allowed_units=primary_units,
                scope=org_unit_scope,
            )
            return list(dict.fromkeys([*user_scope_units, *scoped_units]))

        allowed_units: list[str] = []
        for selection_key in concrete_units:
            item = selected_detail_map.get(selection_key)
            if not isinstance(item, dict):
                continue
            source_org_unit_id = _config_value(
                item,
                "source_org_unit_id",
                "sourceOrgUnitId",
                "id",
            )
            if not isinstance(source_org_unit_id, str):
                continue

            source_instance_ids = _config_value(
                item,
                "source_instance_ids",
                "sourceInstanceIds",
            ) or []
            if not isinstance(source_instance_ids, list) or not source_instance_ids:
                allowed_units.append(source_org_unit_id)
                continue

            if instance.id in source_instance_ids:
                allowed_units.append(source_org_unit_id)

        if not allowed_units and concrete_units:
            allowed_units = [
                str(
                    _config_value(
                        selected_detail_map[key],
                        "source_org_unit_id",
                        "sourceOrgUnitId",
                        "id",
                    )
                )
                for key in concrete_units
                if isinstance(selected_detail_map.get(key), dict)
                and isinstance(
                    _config_value(
                        selected_detail_map[key],
                        "source_org_unit_id",
                        "sourceOrgUnitId",
                        "id",
                    ),
                    str,
                )
            ]
            if not allowed_units:
                allowed_units = [
                    key.split("::", 1)[1] if "::" in key else key
                    for key in concrete_units
                ]

        allowed_units = _prune_descendant_root_org_units(
            list(dict.fromkeys(allowed_units)),
            selected_detail_map,
        )
        scoped_units = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=allowed_units,
            scope=org_unit_scope,
        )
        return list(dict.fromkeys([*user_scope_units, *scoped_units]))

    def _make_analytics_request(
        self,
        instance: DHIS2Instance,
        dx_ids: list[str],
        periods: list[str],
        org_units: list[str],
        page: int = 1,
        page_size: int = _ANALYTICS_PAGE_SIZE,
    ) -> dict[str, Any]:
        """Execute a single ``/api/analytics.json`` request against *instance*.

        Args:
            instance: Source DHIS2 instance (provides base URL and auth headers).
            dx_ids: List of data-element / indicator UIDs for the ``dimension=dx:``
                parameter.
            periods: List of period expressions for ``dimension=pe:``.
            org_units: List of org-unit expressions for ``dimension=ou:``.
            page: 1-based page number for DHIS2 pagination.
            page_size: Number of rows per page.

        Returns:
            Raw DHIS2 analytics JSON response as a Python dict.

        Raises:
            :class:`requests.HTTPError`: For non-2xx responses.
            :class:`requests.RequestException`: For network-level failures.
            :class:`ValueError`: If the response body is not valid JSON.
        """
        base_url = instance.url.rstrip("/")
        url = f"{base_url}/api/analytics.json"

        params: dict[str, Any] = {
            "dimension": [
                f"dx:{';'.join(dx_ids)}",
                f"pe:{';'.join(periods)}",
                f"ou:{';'.join(org_units)}",
            ],
            "displayProperty": "NAME",
            "skipMeta": "false",
            "paging": "true",
            "page": page,
            "pageSize": page_size,
        }

        headers = {
            "Accept": "application/json",
            **instance.get_auth_headers(),
        }

        logger.debug(
            "Sync: GET %s page=%d (dx count=%d)",
            url,
            page,
            len(dx_ids),
        )

        resp = requests.get(url, params=params, headers=headers, timeout=_REQUEST_TIMEOUT)
        if not resp.ok:
            reason = str(getattr(resp, "reason", "") or "").strip() or None
            if resp.status_code == 524:
                reason = "Gateway Timeout from the upstream DHIS2 server"
            elif resp.status_code == 504:
                reason = reason or "Gateway Timeout"
            elif resp.status_code == 522:
                reason = reason or "Connection timed out"
            elif resp.status_code == 520:
                reason = reason or "Unknown upstream error"
            elif reason is None:
                reason = "Upstream server error"
            raise requests.HTTPError(
                f"{resp.status_code} Server Error: {reason} for url: {resp.url}",
                response=resp,
            )

        try:
            return resp.json()
        except ValueError as exc:
            raise ValueError(
                f"DHIS2 analytics endpoint returned non-JSON body from {instance.name}"
            ) from exc

    def _normalize_analytics_response(
        self,
        response: dict[str, Any],
        variable_map: dict[str, DHIS2DatasetVariable],
        instance: DHIS2Instance,
    ) -> list[dict[str, Any]]:
        """Convert a raw DHIS2 analytics response to a list of staging row dicts.

        The DHIS2 analytics response has the form::

            {
                "headers": [
                    {"name": "dx", "column": "Data", "valueType": "TEXT"},
                    {"name": "pe", "column": "Period", "valueType": "TEXT"},
                    {"name": "ou", "column": "Organisation unit", "valueType": "TEXT"},
                    {"name": "value", "column": "Value", "valueType": "NUMBER"},
                ],
                "rows": [["dxUid", "202301", "ouUid", "42.5"], ...],
                "metaData": {
                    "items": {"dxUid": {"name": "..."}, ...},
                    "dimensions": {"ou": [...], "pe": [...], ...},
                },
            }

        Each output row dict contains the columns expected by the staging table:
        ``dx_uid``, ``dx_name``, ``dx_type``, ``pe``, ``ou``, ``ou_name``,
        ``ou_level``, ``value``, ``value_numeric``, ``co_uid``, ``co_name``,
        ``aoc_uid``, and ``instance_id``.

        Args:
            response: Raw analytics API response.
            variable_map: Mapping of ``variable_id`` -> ``DHIS2DatasetVariable``.
            instance: Source instance (provides ``instance_id`` for each row).

        Returns:
            List of row dicts; empty if the response contains no rows.
        """
        headers: list[dict[str, Any]] = response.get("headers", [])
        rows: list[list[str]] = response.get("rows", [])
        meta_items: dict[str, Any] = (
            response.get("metaData", {}).get("items", {})
        )

        # Build a column-name to column-index map from the response headers.
        col_index: dict[str, int] = {
            h["name"]: idx for idx, h in enumerate(headers)
        }

        dx_col = col_index.get("dx")
        pe_col = col_index.get("pe")
        ou_col = col_index.get("ou")
        value_col = col_index.get("value")
        co_col = col_index.get("co")
        aoc_col = col_index.get("aoc")

        result: list[dict[str, Any]] = []

        for raw_row in rows:
            def _get(idx: int | None) -> str | None:
                if idx is None or idx >= len(raw_row):
                    return None
                v = raw_row[idx]
                return v if v != "" else None

            dx_uid = _get(dx_col)
            pe = _get(pe_col)
            ou = _get(ou_col)
            raw_value = _get(value_col)

            # Resolve names from metaData.
            dx_meta = meta_items.get(dx_uid or "", {})
            dx_name = dx_meta.get("name")

            ou_meta = meta_items.get(ou or "", {})
            ou_name = ou_meta.get("name")
            ou_level_raw = ou_meta.get("level")
            ou_level: int | None = None
            if ou_level_raw is not None:
                try:
                    ou_level = int(ou_level_raw)
                except (ValueError, TypeError):
                    pass

            # Resolve variable metadata from our registry.
            var = variable_map.get(dx_uid or "")
            dx_type = var.variable_type if var else None

            # Parse numeric value; keep raw string for non-numeric indicators.
            value_numeric: float | None = None
            if raw_value is not None:
                try:
                    value_numeric = float(raw_value)
                except (ValueError, TypeError):
                    pass

            co_uid = _get(co_col)
            co_meta = meta_items.get(co_uid or "", {})
            co_name = co_meta.get("name")

            aoc_uid = _get(aoc_col)

            result.append(
                {
                    "instance_id": instance.id,
                    "dx_uid": dx_uid,
                    "dx_name": dx_name,
                    "dx_type": dx_type,
                    "pe": pe,
                    "ou": ou,
                    "ou_name": ou_name,
                    "ou_level": ou_level,
                    "value": raw_value,
                    "value_numeric": value_numeric,
                    "co_uid": co_uid,
                    "co_name": co_name,
                    "aoc_uid": aoc_uid,
                }
            )

        return result

    # ------------------------------------------------------------------
    # Staging table I/O
    # ------------------------------------------------------------------

    def _load_rows(
        self,
        dataset: DHIS2StagedDataset,
        instance: DHIS2Instance,
        rows: list[dict[str, Any]],
        sync_job_id: int | None = None,
        *,
        replace_instance_rows: bool = True,
        periods_to_prune: list[str] | None = None,
    ) -> int:
        """Replace staging data for *instance* within *dataset* atomically.

        Delegates to :class:`DHIS2StagingEngine` so the sync path uses the same
        physical schema and column names that table creation defined.

        Args:
            dataset: Owning staged dataset (provides ``staging_table_name``).
            instance: Source instance whose data is being replaced.
            rows: Normalised row dicts to insert.
            sync_job_id: Optional sync-job identifier written onto staged rows.
        """
        if not (dataset.staging_table_name or dataset.id):
            logger.warning(
                "Sync: dataset=%d has no staging_table_name configured; skipping load",
                dataset.id,
            )
            return 0

        staging_engine = DHIS2StagingEngine(dataset.database_id)
        row_count = 0
        if replace_instance_rows:
            row_count = staging_engine.replace_rows_for_instance(
                dataset,
                instance_id=instance.id,
                instance_name=instance.name,
                rows=rows,
                sync_job_id=sync_job_id,
            )
        else:
            if periods_to_prune:
                staging_engine.delete_rows_for_instance_periods(
                    dataset,
                    instance.id,
                    periods_to_prune,
                )
            row_count = staging_engine.upsert_rows_for_instance(
                dataset,
                instance_id=instance.id,
                instance_name=instance.name,
                rows=rows,
                sync_job_id=sync_job_id,
            )
        record_dhis2_stage_rows(
            dataset=dataset,
            instance=instance,
            rows=rows,
            sync_job_id=sync_job_id,
        )
        return row_count

    def _materialize_serving_table(self, dataset: DHIS2StagedDataset) -> None:
        staging_engine = DHIS2StagingEngine(dataset.database_id)
        raw_rows = staging_engine.fetch_staging_rows(dataset)
        serving_columns, serving_rows = materialize_serving_rows(dataset, raw_rows)
        staging_engine.create_or_replace_serving_table(
            dataset,
            columns=serving_columns,
            rows=serving_rows,
        )

    # ------------------------------------------------------------------
    # Job management helpers
    # ------------------------------------------------------------------

    def create_sync_job(
        self,
        staged_dataset_id: int,
        job_type: str = "manual",
    ) -> DHIS2SyncJob:
        """Create and persist a new ``PENDING`` sync job record.

        Args:
            staged_dataset_id: Dataset this job belongs to.
            job_type: Discriminator string (``"manual"`` or ``"scheduled"``).

        Returns:
            The newly-committed :class:`~superset.dhis2.models.DHIS2SyncJob`.
        """
        job = DHIS2SyncJob(
            staged_dataset_id=staged_dataset_id,
            job_type=job_type,
            status="pending",
            created_on=datetime.utcnow(),
        )
        db.session.add(job)
        db.session.flush()
        _sync_compat_job(job)
        db.session.commit()
        logger.info(
            "Sync: created job id=%d type=%s dataset=%d",
            job.id,
            job_type,
            staged_dataset_id,
        )
        return job

    def update_job_status(
        self,
        job: DHIS2SyncJob,
        status: str,
        rows_loaded: int | None = None,
        rows_failed: int | None = None,
        error_message: str | None = None,
        instance_results: dict[str, Any] | None = None,
    ) -> None:
        """Persist status and result fields onto *job*.

        Automatically sets ``started_at`` when transitioning to ``"running"``
        and ``completed_at`` for any terminal status (``"success"``,
        ``"partial"``, ``"failed"``).

        Args:
            job: The :class:`~superset.dhis2.models.DHIS2SyncJob` to update.
            status: New status string.
            rows_loaded: Total rows successfully loaded.
            rows_failed: Count of instance-level failures.
            error_message: Top-level error message (for full failures).
            instance_results: Per-instance outcome dict to serialise into
                ``job.instance_results``.
        """
        now = datetime.utcnow()
        job.status = status
        job.changed_on = now

        if status == "running" and job.started_at is None:
            job.started_at = now

        if status in ("success", "partial", "failed"):
            job.completed_at = now

        if rows_loaded is not None:
            job.rows_loaded = rows_loaded
        if rows_failed is not None:
            job.rows_failed = rows_failed
        if error_message is not None:
            job.error_message = error_message
        if instance_results is not None:
            job.instance_results = json.dumps(instance_results)

        _sync_compat_job(
            job,
            {
                "status": status,
                "rows_loaded": rows_loaded,
                "rows_failed": rows_failed,
                "instances": instance_results or job.get_instance_results(),
            },
        )
        db.session.commit()

    def update_dataset_sync_state(
        self,
        staged_dataset_id: int,
        *,
        status: str,
        rows_loaded: int | None = None,
    ) -> None:
        dataset = db.session.get(DHIS2StagedDataset, staged_dataset_id)
        if dataset is None:
            return

        dataset.last_sync_status = status
        if rows_loaded is not None:
            dataset.last_sync_rows = rows_loaded
        _sync_compat_dataset(dataset)
        db.session.commit()

    def get_sync_jobs(
        self,
        staged_dataset_id: int,
        limit: int = 20,
    ) -> list[DHIS2SyncJob]:
        """Return the most recent sync jobs for *staged_dataset_id*.

        Args:
            staged_dataset_id: Dataset whose jobs to list.
            limit: Maximum number of records to return.

        Returns:
            List of :class:`~superset.dhis2.models.DHIS2SyncJob` ordered newest
            first.
        """
        return (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=staged_dataset_id)
            .order_by(DHIS2SyncJob.created_on.desc())
            .limit(limit)
            .all()
        )


def schedule_staged_dataset_sync(
    staged_dataset_id: int,
    *,
    job_type: str = "scheduled",
    prefer_immediate: bool = False,
    incremental: bool = True,
) -> dict[str, Any]:
    service = DHIS2SyncService()
    job = service.create_sync_job(staged_dataset_id, job_type=job_type)

    app = current_app._get_current_object() if has_app_context() else None

    def _run() -> None:
        if app is not None:
            with app.app_context():
                _run_sync_job_thread(staged_dataset_id, job.id, incremental=incremental)
        else:
            _run_sync_job_thread(staged_dataset_id, job.id, incremental=incremental)

    if not prefer_immediate:
        try:
            from superset.tasks.dhis2_sync import sync_staged_dataset_task

            task = sync_staged_dataset_task.apply_async(
                kwargs={
                    "staged_dataset_id": staged_dataset_id,
                    "job_type": job_type,
                    "job_id": job.id,
                    "incremental": incremental,
                },
            )
            service.update_dataset_sync_state(
                staged_dataset_id,
                status="queued",
                rows_loaded=0,
            )
            return {
                "scheduled": True,
                "mode": "celery",
                "job_id": job.id,
                "task_id": getattr(task, "id", None),
                "status": "queued",
            }
        except Exception:  # pylint: disable=broad-except
            logger.info(
                "Celery staged dataset sync unavailable for dataset id=%s",
                staged_dataset_id,
                exc_info=True,
            )

    service.update_job_status(job, status="running")
    service.update_dataset_sync_state(
        staged_dataset_id,
        status="running",
        rows_loaded=0,
    )
    thread = threading.Thread(
        target=_run,
        name=f"dhis2-sync-{staged_dataset_id}-{job.id}",
        daemon=True,
    )
    thread.start()
    return {
        "scheduled": True,
        "mode": "thread",
        "job_id": job.id,
        "task_id": None,
        "status": "running",
    }


def _run_sync_job_thread(
    staged_dataset_id: int,
    job_id: int,
    *,
    incremental: bool = True,
) -> None:
    db.session.remove()
    try:
        thread_service = DHIS2SyncService()
        thread_job = db.session.get(DHIS2SyncJob, job_id)
        if thread_job is None:
            return
        try:
            thread_service.sync_staged_dataset(
                staged_dataset_id,
                job_id=thread_job.id,
                incremental=incremental,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Thread fallback staged dataset sync failed for dataset id=%s",
                staged_dataset_id,
                exc_info=True,
            )
            failed_job = db.session.get(DHIS2SyncJob, job_id)
            if failed_job is not None:
                thread_service.update_job_status(
                    failed_job,
                    status="failed",
                    error_message=str(exc),
                )
            thread_service.update_dataset_sync_state(
                staged_dataset_id,
                status="failed",
            )
    finally:
        db.session.remove()
