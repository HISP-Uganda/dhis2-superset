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
from sqlalchemy import event

from superset import db
from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)
from superset.dhis2.serving_build_service import build_serving_table
from superset.dhis2.staging_engine import DHIS2StagingEngine
from superset.local_staging.engine_factory import get_active_staging_engine
from superset.staging.compat import sync_dhis2_staged_dataset, sync_dhis2_sync_job
from superset.staging import metadata_cache_service
from superset.staging.storage import record_dhis2_stage_rows

logger = logging.getLogger(__name__)

_CELERY_PING_TIMEOUT = 1.0  # seconds to wait for a worker ping


def _celery_workers_available() -> bool:
    """Return True if at least one Celery worker is reachable.

    Uses a short timeout so this never blocks the request thread.
    Falls back to False on any error so the caller uses the thread path.
    """
    try:
        from celery import current_app as celery_app  # lazy import

        response = celery_app.control.inspect(timeout=_CELERY_PING_TIMEOUT).ping()
        return bool(response)
    except Exception:  # pylint: disable=broad-except
        return False


# Maximum number of DHIS2 variable UIDs to include in a single analytics request.
# Larger batches risk exceeding URL length limits on some DHIS2 deployments.
# Override per-dataset via dataset_config["var_chunk_size"].
_MAX_VARS_PER_REQUEST = 50

# Maximum number of org-unit UIDs to include in a single analytics request.
# DHIS2 can time out or fail when asked to aggregate data across too many org units
# at once, even when using POST.  Some DHIS2 instances also raise a server-side
# NullPointerException (getOrgUnitCountMap() is null) when the OU list is too large
# for indicator calculations.  Keep this conservatively small.
# Override per-dataset via dataset_config["ou_chunk_size"].
_MAX_OUS_PER_REQUEST = 50

# Page size for DHIS2 analytics pagination.
# Override per-dataset via dataset_config["analytics_page_size"].
_ANALYTICS_PAGE_SIZE = 1000
_MIN_ANALYTICS_PAGE_SIZE = 100

# Allowed bounds for user-supplied chunk sizes (prevents foot-guns).
_OU_CHUNK_SIZE_MIN = 1
_OU_CHUNK_SIZE_MAX = 500
_VAR_CHUNK_SIZE_MIN = 1
_VAR_CHUNK_SIZE_MAX = 200
_ANALYTICS_PAGE_SIZE_MIN = 100
_ANALYTICS_PAGE_SIZE_MAX = 10000

# HTTP request timeout for analytics calls: (connect_timeout, read_timeout).
# A tuple is used so the connect phase fails fast (30 s) and the read phase
# allows up to 300 s for DHIS2 to begin streaming rows.  A single integer
# would restart on every TCP chunk, making it effectively unbounded for slow
# servers that trickle data.  300 s matches the dataValueSets extractor and
# accommodates slow test/staging DHIS2 instances (e.g. hmis-tests.health.go.ug).
_REQUEST_TIMEOUT = (30, 300)

# How long to sleep before a simple retry on transient timeout/connection
# errors.  A brief pause lets an overloaded DHIS2 server recover before we
# hammer it again.  Applied once before escalating to page-size splitting.
_TIMEOUT_RETRY_SLEEP_SECONDS = 5
_ORG_UNIT_SOURCE_MODE_PRIMARY = "primary"
_ORG_UNIT_SOURCE_MODE_REPOSITORY = "repository"
_ORG_UNIT_SOURCE_MODE_PER_INSTANCE = "per_instance"
_ORG_UNIT_SCOPE_SELECTED = "selected"
_ORG_UNIT_SCOPE_CHILDREN = "children"
_ORG_UNIT_SCOPE_GRANDCHILDREN = "grandchildren"
_ORG_UNIT_SCOPE_ALL_LEVELS = "all_levels"
_ORG_UNIT_HIERARCHY_NAMESPACE = "dhis2_snapshot:orgUnitHierarchy"
_STOCK_OUT_INDICATOR_RE = re.compile(r"\bstock\s*out\b", re.IGNORECASE)
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
_ACTIVE_SYNC_JOB_STATUSES = {"pending", "queued", "running", "retry_pending"}
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


def _get_sync_staging_engine(database_id: int) -> Any:
    """Return the staging engine for sync operations.

    Most production sync paths run inside a Flask app context and should honor
    the configured local-staging engine. A few unit tests and helper paths call
    into the sync service without an app context; fall back to the legacy
    ``DHIS2StagingEngine`` there so those isolated code paths remain testable
    and backwards compatible.
    """
    if not has_app_context():
        return DHIS2StagingEngine(database_id)

    try:
        return get_active_staging_engine(database_id)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Sync: failed to resolve active local staging engine for database=%s; "
            "falling back to DHIS2StagingEngine",
            database_id,
            exc_info=True,
        )
        return DHIS2StagingEngine(database_id)


def _assign_model_attr(instance: Any, attr_name: str, value: Any) -> None:
    """Assign an attribute on ORM rows and lightweight test doubles alike."""
    if getattr(instance, "_sa_instance_state", None) is None:
        instance.__dict__[attr_name] = value
        return
    setattr(instance, attr_name, value)


def _read_model_attr(instance: Any, attr_name: str, default: Any = None) -> Any:
    """Read an attribute from ORM rows and lightweight test doubles alike."""
    if getattr(instance, "_sa_instance_state", None) is None:
        return instance.__dict__.get(attr_name, default)
    try:
        return getattr(instance, attr_name)
    except Exception:  # pylint: disable=broad-except
        return default


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


def _expand_fixed_date_range_to_monthly_periods(
    start: str | None,
    end: str | None,
) -> list[str]:
    """Convert an ISO start–end date range to DHIS2 monthly period codes (YYYYMM).

    Falls back to ["LAST_12_MONTHS"] when either boundary is missing or invalid.
    Example: start="2023-01-01", end="2024-06-30" → ["202301", ..., "202406"].
    """
    if not start or not end:
        return ["LAST_12_MONTHS"]
    try:
        import re as _re  # noqa: PLC0415

        def _parse(s: str) -> date:
            # Accept YYYY-MM-DD or YYYY-MM
            if _re.match(r"^\d{4}-\d{2}$", s):
                s = s + "-01"
            return date.fromisoformat(s)

        d = _parse(start)
        e = _parse(end)
        if d > e:
            d, e = e, d

        codes: list[str] = []
        y, m = d.year, d.month
        while (y, m) <= (e.year, e.month):
            codes.append(f"{y}{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
        return codes if codes else ["LAST_12_MONTHS"]
    except Exception:  # pylint: disable=broad-except
        return ["LAST_12_MONTHS"]


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
    # RuntimeError is raised for non-retryable DHIS2 server-side conditions
    # (e.g. E7144 — analytics tables not built).  Never retry these.
    if isinstance(exc, RuntimeError):
        return False
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return True
    status_code = _analytics_error_status_code(exc)
    return status_code in _RETRYABLE_ANALYTICS_STATUS_CODES


def _is_ou_overflow_error(exc: Exception) -> bool:
    """Return True if the error is the DHIS2 getOrgUnitCountMap NullPointerException.

    This server-side bug is triggered when the analytics engine cannot build
    the org-unit count map required for indicator calculations.  It manifests
    as a 500 with a specific message fragment.  The only effective remedy is
    to reduce the number of org units in the request — reducing page size or
    splitting the variable batch will NOT help.

    DHIS2 sometimes returns the NPE message in the JSON body; other times it
    returns a generic "Internal Server Error" HTTP reason phrase.  We check
    both the formatted exception string and the raw response body so that
    either representation is caught.
    """
    _MARKER = "getOrgUnitCountMap"
    if _MARKER in str(exc):
        return True
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            if _MARKER in (response.text or ""):
                return True
        except Exception:  # pylint: disable=broad-except
            pass
    return False


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


def reset_stale_running_jobs(
    *,
    dataset_id: int | None = None,
    stale_after_minutes: int = 30,
    now: datetime | None = None,
) -> dict[str, int]:
    """Reset stale sync jobs and orphaned dataset statuses back to retryable states."""
    stale_now = now or datetime.utcnow()
    stale_cutoff = stale_now - timedelta(minutes=stale_after_minutes)
    service = DHIS2SyncService()

    job_query = db.session.query(DHIS2SyncJob).filter(DHIS2SyncJob.status == "running")
    if dataset_id is not None:
        job_query = job_query.filter(DHIS2SyncJob.staged_dataset_id == dataset_id)

    reset_jobs = 0
    for job in job_query.all():
        heartbeat = job.changed_on or job.started_at or job.created_on
        if heartbeat is not None and heartbeat >= stale_cutoff:
            continue
        logger.warning(
            "reset_stale_running_jobs: auto-resetting stale job id=%s dataset=%s",
            job.id,
            job.staged_dataset_id,
        )
        service.update_job_status(
            job,
            status="failed",
            error_message="Auto-reset: job was stuck in running state (server restart?)",
        )
        reset_jobs += 1

    dataset_query = db.session.query(DHIS2StagedDataset).filter(
        DHIS2StagedDataset.last_sync_status == "running"
    )
    if dataset_id is not None:
        dataset_query = dataset_query.filter(DHIS2StagedDataset.id == dataset_id)

    reset_datasets = 0
    for dataset in dataset_query.all():
        active_job = (
            db.session.query(DHIS2SyncJob)
            .filter(
                DHIS2SyncJob.staged_dataset_id == dataset.id,
                DHIS2SyncJob.status.in_(tuple(_ACTIVE_SYNC_JOB_STATUSES)),
            )
            .first()
        )
        if active_job is not None:
            continue
        logger.warning(
            "reset_stale_running_jobs: clearing orphaned running status for dataset id=%s",
            dataset.id,
        )
        service.update_dataset_sync_state(dataset.id, status="pending")
        reset_datasets += 1

    return {"reset_jobs": reset_jobs, "reset_datasets": reset_datasets}


def _normalize_org_unit_scope(scope: Any) -> str:
    candidate = str(scope or _ORG_UNIT_SCOPE_SELECTED).strip().lower()
    if candidate in {
        _ORG_UNIT_SCOPE_CHILDREN,
        _ORG_UNIT_SCOPE_GRANDCHILDREN,
        _ORG_UNIT_SCOPE_ALL_LEVELS,
    }:
        return candidate
    return _ORG_UNIT_SCOPE_SELECTED


def _clamp_chunk_size(
    value: Any,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    """Return *value* clamped to [*minimum*, *maximum*], or *default* if invalid."""
    if value is None:
        return default
    try:
        clamped = max(minimum, min(maximum, int(value)))
    except (TypeError, ValueError):
        return default
    return clamped


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
    max_level: int | None = None,
    allowed_levels: frozenset[int] | None = None,
) -> list[str]:
    """Expand *allowed_units* according to *scope*, with optional level constraints.

    Args:
        instance: Source DHIS2 instance (used to load hierarchy snapshot).
        allowed_units: Seed org unit UIDs (the explicitly selected roots).
        scope: One of ``"selected"``, ``"children"``, ``"grandchildren"``,
            ``"all_levels"``.
        max_level: If set, descendant nodes at levels above this value are
            excluded.  Prevents irrelevant generated levels (e.g. 7, 8) from
            leaking into the fetch plan.
        allowed_levels: If set, only nodes whose level is in this set are kept.
            Acts as a strict allowlist on top of ``max_level``.

    Returns:
        Ordered list of org unit UIDs, seeds first then expansions.
    """
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

            # Apply max_level constraint: skip nodes at levels above the cap.
            if max_level is not None and node_level is not None and node_level > max_level:
                continue
            # Apply allowed_levels allowlist: skip nodes not in the set.
            if (
                allowed_levels is not None
                and node_level is not None
                and node_level not in allowed_levels
            ):
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


def _detail_lineage(detail: dict[str, Any]) -> list[dict[str, Any]]:
    raw_lineage = _config_value(detail, "lineage")
    if not isinstance(raw_lineage, list):
        return []
    return [
        item
        for item in raw_lineage
        if isinstance(item, dict)
    ]


def _detail_instance_ids(detail: dict[str, Any]) -> list[int]:
    raw_ids = _config_value(detail, "source_instance_ids", "sourceInstanceIds") or []
    instance_ids: list[int] = []
    if isinstance(raw_ids, list):
        for item in raw_ids:
            try:
                instance_ids.append(int(item))
            except (TypeError, ValueError):
                continue
    if instance_ids:
        return list(dict.fromkeys(instance_ids))

    for lineage in _detail_lineage(detail):
        try:
            instance_ids.append(int(lineage.get("instance_id")))
        except (TypeError, ValueError):
            continue
    return list(dict.fromkeys(instance_ids))


def _resolve_selected_detail_for_instance(
    detail: dict[str, Any],
    instance_id: int,
) -> dict[str, Any] | None:
    lineages = _detail_lineage(detail)
    if not lineages:
        return detail

    for lineage in lineages:
        try:
            lineage_instance_id = int(lineage.get("instance_id"))
        except (TypeError, ValueError):
            continue
        if lineage_instance_id != instance_id:
            continue

        source_org_unit_uid = str(lineage.get("source_org_unit_uid") or "").strip()
        if not source_org_unit_uid:
            continue

        resolved = dict(detail)
        resolved["source_org_unit_id"] = source_org_unit_uid
        resolved["sourceOrgUnitId"] = source_org_unit_uid
        resolved["source_instance_ids"] = [instance_id]
        resolved["sourceInstanceIds"] = [instance_id]

        source_parent_uid = str(lineage.get("source_parent_uid") or "").strip()
        if source_parent_uid:
            resolved["parent_id"] = source_parent_uid
            resolved["parentId"] = source_parent_uid

        source_path = str(lineage.get("source_path") or "").strip()
        if source_path:
            resolved["path"] = source_path

        source_level = lineage.get("source_level")
        if source_level is not None:
            resolved["level"] = source_level

        return resolved

    return None


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


def _prune_ancestor_org_units(
    allowed_units: list[str],
    selected_detail_map: dict[str, dict[str, Any]],
    *,
    prefer_roots: bool = False,
) -> list[str]:
    """Prune overlapping org-unit selections to a stable, non-duplicated set.

    When a user selects both a parent (e.g., District) and one of its children
    (e.g., Parish), querying DHIS2 for both produces double-counting: the
    parent row already aggregates all child values.  By default this function
    keeps the most-granular leaves.  When ``prefer_roots`` is true it instead
    keeps the shallowest roots, which is useful before scope-expansion so
    ``children`` / ``grandchildren`` calculations start from the user-facing
    parent selection rather than an explicitly chosen descendant.

    Path/parentId metadata from ``selected_detail_map`` is used.  Units whose
    detail is missing are conservatively kept (no false removal).
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

    unit_set = set(unique_units)

    # Collect every unit in the set that is an ancestor of at least one other
    # unit in the set.  We read this from the *descendant* unit's path/parentId
    # so the check is O(n × path_depth) rather than O(n²).
    ancestors_in_set: set[str] = set()
    descendants_in_set: set[str] = set()
    for unit in unique_units:
        detail = detail_by_source_id.get(unit, {})

        # Path-based: ancestors are all path segments except the last (self)
        path = _config_value(detail, "path")
        if isinstance(path, str) and path.strip():
            segments = [s for s in path.split("/") if s.strip()]
            for ancestor_seg in segments[:-1]:
                if ancestor_seg in unit_set:
                    ancestors_in_set.add(ancestor_seg)
                    descendants_in_set.add(unit)
            continue  # path is authoritative; skip parentId check

        # parentId-based fallback (direct parent only)
        parent_id = _config_value(detail, "parentId", "parent_id")
        if isinstance(parent_id, str) and parent_id:
            normalized = (
                parent_id.split("::", 1)[1] if "::" in parent_id else parent_id
            )
            if normalized in unit_set:
                ancestors_in_set.add(normalized)
                descendants_in_set.add(unit)

    if prefer_roots:
        roots = [u for u in unique_units if u not in descendants_in_set]
        return roots if roots else unique_units

    leaves = [u for u in unique_units if u not in ancestors_in_set]
    # If no ancestry information was available, return all units unchanged so
    # we never silently lose a valid selection.
    return leaves if leaves else unique_units


# Legacy alias kept for any direct call-sites outside this module.
_prune_descendant_root_org_units = _prune_ancestor_org_units


def _resolve_incremental_period_plan(
    dataset: DHIS2StagedDataset,
    instance: DHIS2Instance,
    dataset_config: dict[str, Any],
) -> _IncrementalPeriodPlan:
    periods_cfg = dataset_config.get("periods", [])
    if isinstance(periods_cfg, str):
        periods_cfg = [periods_cfg]
    if not isinstance(periods_cfg, list):
        periods_cfg = []

    # When no manual periods are specified (auto-detect or empty), apply the
    # configured default period range instead of unconditionally using LAST_12_MONTHS.
    if not periods_cfg:
        range_type = dataset_config.get("default_period_range_type", "relative")
        if range_type == "fixed_range":
            start = dataset_config.get("default_period_start")
            end = dataset_config.get("default_period_end")
            periods_cfg = _expand_fixed_date_range_to_monthly_periods(start, end)
        else:
            default_rel = dataset_config.get("default_relative_period", "LAST_12_MONTHS")
            periods_cfg = [default_rel] if default_rel else ["LAST_12_MONTHS"]

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

    staging_engine = _get_sync_staging_engine(dataset.database_id)
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

    def __init__(self) -> None:
        # Accumulates per-batch request log entries during a sync run.
        # Each entry is a plain dict matching the DHIS2SyncJobRequest columns.
        # Flushed to the DB (via _flush_request_logs_to_session) after each
        # instance completes so that UI polling sees live progress.
        self._request_log_collector: list[dict[str, Any]] = []
        # Tracks analytics request slices that were exhaustively retried and
        # split but still could not be fetched (persistent DHIS2-side errors).
        # Populated by _fetch_analytics_batch; consumed by _fetch_from_instance
        # to surface bad-slice counts in instance_results.
        self._skipped_slices: list[dict[str, Any]] = []
        # Cache of org units that have already been isolated as persistent
        # DHIS2-side 500s for a given variable family during the current sync
        # run.  This prevents the same toxic OU slice from being rediscovered
        # repeatedly for each stock-out indicator in the same dataset.
        self._known_bad_analytics_ou_families: defaultdict[tuple[int, str], set[str]] = (
            defaultdict(set)
        )
        # Monotonically increasing counter to assign request_seq values
        # across multiple flush calls within one sync run.
        self._request_seq_offset: int = 0

    @staticmethod
    def _base_variable_id(dx_id: str) -> str:
        return str(dx_id or "").split(".", 1)[0]

    def _variable_skip_families(
        self,
        variable: DHIS2DatasetVariable | None,
    ) -> set[str]:
        if variable is None:
            return set()

        variable_id = str(getattr(variable, "variable_id", "") or "").strip()
        if not variable_id:
            return set()

        families = {f"var:{variable_id}"}
        variable_type = str(getattr(variable, "variable_type", "") or "").strip().lower()
        variable_name = str(getattr(variable, "variable_name", "") or "").strip()
        if variable_type == "indicator" and _STOCK_OUT_INDICATOR_RE.search(variable_name):
            families.add("family:indicator_stock_out")
        return families

    def _shared_batch_skip_families(
        self,
        batch: list[str],
        variable_map: dict[str, DHIS2DatasetVariable],
    ) -> set[str]:
        shared_families: set[str] | None = None
        for dx_id in batch:
            variable = variable_map.get(self._base_variable_id(dx_id))
            variable_families = self._variable_skip_families(variable)
            if not variable_families:
                continue
            if shared_families is None:
                shared_families = set(variable_families)
            else:
                shared_families &= variable_families
            if not shared_families:
                return set()
        return shared_families or set()

    # ------------------------------------------------------------------
    # Public entrypoint
    # ------------------------------------------------------------------

    def _append_request_log(
        self,
        instance: DHIS2Instance,
        batch: list[str],
        periods: list[str],
        org_units: list[str],
        *,
        status: str,
        pages_fetched: int,
        rows_returned: int,
        duration_ms: int,
        started_at: datetime,
        exc: Exception | None = None,
    ) -> None:
        """Append one entry to the in-memory request log collector.

        Extracts HTTP status code and DHIS2 error code from the exception when
        available so that the UI can display structured error diagnostics.
        """
        http_status: int | None = None
        dhis2_error_code: str | None = None
        error_message: str | None = None

        if exc is not None:
            error_message = str(exc)[:1000]
            err_response = getattr(exc, "response", None)
            if err_response is not None:
                http_status = getattr(err_response, "status_code", None)
                try:
                    body = err_response.json()
                    dhis2_error_code = body.get("errorCode")
                except Exception:  # pylint: disable=broad-except
                    pass
            # RuntimeError wraps E7144 and similar — parse the code from msg
            if isinstance(exc, RuntimeError) and dhis2_error_code is None:
                import re as _re
                m = _re.search(r"\(E\d{4}\)", str(exc))
                if m:
                    dhis2_error_code = m.group(0)[1:-1]  # strip parens

        self._request_log_collector.append({
            "instance_id": instance.id,
            "instance_name": instance.name,
            "ou_count": len(org_units),
            "dx_count": len(batch),
            "periods_json": json.dumps(periods),
            "status": status,
            "http_status_code": http_status,
            "dhis2_error_code": dhis2_error_code,
            "pages_fetched": pages_fetched,
            "rows_returned": rows_returned,
            "duration_ms": duration_ms,
            "error_message": error_message,
            "started_at": started_at,
        })

    def _flush_request_logs_to_session(self, job_id: int) -> None:
        """Add all collected request log entries to the current DB session.

        Assigns monotonically increasing ``request_seq`` values so that UI
        ordering is stable.  The caller is responsible for issuing a
        ``db.session.commit()`` to persist the records.
        """
        if not self._request_log_collector:
            return

        from superset.dhis2.models import DHIS2SyncJobRequest  # avoid circular

        for entry in self._request_log_collector:
            self._request_seq_offset += 1
            req = DHIS2SyncJobRequest(
                sync_job_id=job_id,
                request_seq=self._request_seq_offset,
                **entry,
            )
            db.session.add(req)

        self._request_log_collector.clear()

    def _create_running_request_log(
        self,
        job_id: int,
        instance: "DHIS2Instance",
        batch: list[str],
        periods: list[str],
        org_units: list[str],
        started_at: datetime,
    ) -> int | None:
        """Insert a status='running' request log row immediately and return its id.

        Committed right away so the UI shows the in-progress request before the
        HTTP call returns (which can take up to 300 s).  Returns None if the
        write fails (non-fatal).
        """
        from superset.dhis2.models import DHIS2SyncJobRequest  # avoid circular
        try:
            self._request_seq_offset += 1
            req = DHIS2SyncJobRequest(
                sync_job_id=job_id,
                request_seq=self._request_seq_offset,
                instance_id=instance.id,
                instance_name=instance.name,
                ou_count=len(org_units),
                dx_count=len(batch),
                periods_json=json.dumps(periods),
                status="running",
                pages_fetched=None,
                rows_returned=None,
                duration_ms=None,
                started_at=started_at,
            )
            db.session.add(req)
            db.session.commit()
            return req.id
        except Exception:  # pylint: disable=broad-except
            logger.warning("Sync: failed to write running request log", exc_info=True)
            try:
                db.session.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
            return None

    def _finalise_request_log(
        self,
        record_id: int,
        *,
        status: str,
        pages_fetched: int,
        rows_returned: int,
        duration_ms: int,
        exc: Exception | None = None,
    ) -> None:
        """Update an existing 'running' request log row with the final outcome."""
        from superset.dhis2.models import DHIS2SyncJobRequest  # avoid circular

        http_status: int | None = None
        dhis2_error_code: str | None = None
        error_message: str | None = None

        if exc is not None:
            error_message = str(exc)[:1000]
            err_response = getattr(exc, "response", None)
            if err_response is not None:
                http_status = getattr(err_response, "status_code", None)
                try:
                    body = err_response.json()
                    dhis2_error_code = body.get("errorCode")
                except Exception:  # pylint: disable=broad-except
                    pass
            if isinstance(exc, RuntimeError) and dhis2_error_code is None:
                import re as _re
                m = _re.search(r"\(E\d{4}\)", str(exc))
                if m:
                    dhis2_error_code = m.group(0)[1:-1]

        try:
            db.session.query(DHIS2SyncJobRequest).filter_by(id=record_id).update({
                "status": status,
                "pages_fetched": pages_fetched,
                "rows_returned": rows_returned,
                "duration_ms": duration_ms,
                "http_status_code": http_status,
                "dhis2_error_code": dhis2_error_code,
                "error_message": error_message,
            })
            db.session.commit()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Sync: failed to finalise request log id=%s", record_id, exc_info=True
            )
            try:
                db.session.rollback()
            except Exception:  # pylint: disable=broad-except
                pass

    def _fetch_analytics_batch(
        self,
        *,
        instance: DHIS2Instance,
        batch: list[str],
        periods: list[str],
        org_units: list[str],
        variable_map: dict[str, DHIS2DatasetVariable],
        page_size: int,
        include_combo_dimensions: bool = False,
        job_id: int | None = None,
    ) -> list[dict[str, Any]]:
        batch_started_at = datetime.utcnow()
        batch_start_mono = time.monotonic()
        pages_fetched = 0

        shared_skip_families = self._shared_batch_skip_families(batch, variable_map)
        known_bad_ous: set[str] = set()
        for family in shared_skip_families:
            known_bad_ous.update(
                self._known_bad_analytics_ou_families.get((instance.id, family), set())
            )
        if known_bad_ous:
            filtered_org_units = [ou for ou in org_units if ou not in known_bad_ous]
            if len(filtered_org_units) != len(org_units):
                logger.info(
                    "Sync: pre-skipping %d known bad org unit(s) for instance '%s' "
                    "batch_size=%d families=%s",
                    len(org_units) - len(filtered_org_units),
                    instance.name,
                    len(batch),
                    sorted(shared_skip_families),
                )
            if not filtered_org_units:
                return []
            org_units = filtered_org_units

        # Write a 'running' row immediately so the UI shows this request
        # before the HTTP call returns (which can take up to 300 s).
        running_id: int | None = None
        if job_id is not None:
            running_id = self._create_running_request_log(
                job_id, instance, batch, periods, org_units, batch_started_at
            )

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
                    include_combo_dimensions=include_combo_dimensions,
                )
                batch_rows = self._normalize_analytics_response(
                    raw,
                    variable_map,
                    instance,
                )
                all_rows.extend(batch_rows)
                pages_fetched += 1

                pager = raw.get("pager", {})
                page_count = pager.get("pageCount", 1)
                current_page = pager.get("page", 1)
                if current_page >= page_count:
                    break
                page += 1

            # Record successful batch
            duration_ms_ok = int((time.monotonic() - batch_start_mono) * 1000)
            if running_id is not None:
                self._finalise_request_log(
                    running_id,
                    status="success",
                    pages_fetched=pages_fetched,
                    rows_returned=len(all_rows),
                    duration_ms=duration_ms_ok,
                )
            else:
                self._append_request_log(
                    instance, batch, periods, org_units,
                    status="success",
                    pages_fetched=pages_fetched,
                    rows_returned=len(all_rows),
                    duration_ms=duration_ms_ok,
                    started_at=batch_started_at,
                )
            return all_rows
        except Exception as exc:  # pylint: disable=broad-except
            duration_ms = int((time.monotonic() - batch_start_mono) * 1000)

            # Record this failed attempt immediately, before any retry logic,
            # so we get a full audit trail (failure + subsequent sub-attempts).
            if running_id is not None:
                self._finalise_request_log(
                    running_id,
                    status="failed",
                    pages_fetched=pages_fetched,
                    rows_returned=0,
                    duration_ms=duration_ms,
                    exc=exc,
                )
            else:
                self._append_request_log(
                    instance, batch, periods, org_units,
                    status="failed",
                    pages_fetched=pages_fetched,
                    rows_returned=0,
                    duration_ms=duration_ms,
                    started_at=batch_started_at,
                    exc=exc,
                )

            if _is_retryable_analytics_error(exc):
                # ----------------------------------------------------------
                # Strategy 0: simple sleep-and-retry for transient network
                # failures (Timeout, ConnectionError).  A brief pause lets
                # an overloaded server recover before we escalate to splitting.
                # Only one extra attempt is made so the total delay is bounded.
                # ----------------------------------------------------------
                if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
                    logger.warning(
                        "Sync: transient network error for instance '%s' "
                        "(page=%d); sleeping %ds then retrying once",
                        instance.name,
                        page - 1,
                        _TIMEOUT_RETRY_SLEEP_SECONDS,
                        exc_info=True,
                    )
                    time.sleep(_TIMEOUT_RETRY_SLEEP_SECONDS)
                    try:
                        return self._fetch_analytics_batch(
                            instance=instance,
                            batch=batch,
                            periods=periods,
                            org_units=org_units,
                            variable_map=variable_map,
                            page_size=page_size,
                            include_combo_dimensions=include_combo_dimensions,
                            job_id=job_id,
                        )
                    except (requests.Timeout, requests.ConnectionError):
                        # Still timing out — fall through to splitting strategies.
                        pass
                    except Exception as retry_exc:  # pylint: disable=broad-except
                        if not _is_retryable_analytics_error(retry_exc):
                            raise
                        # Non-timeout retryable error — fall through.

                # ----------------------------------------------------------
                # Strategy 1: getOrgUnitCountMap NPE → split OUs immediately.
                # Reducing page size or variables will NOT help because DHIS2
                # fails before it starts paginating.
                # ----------------------------------------------------------
                if _is_ou_overflow_error(exc) and len(org_units) > 1:
                    ou_midpoint = max(1, len(org_units) // 2)
                    logger.warning(
                        "Sync: getOrgUnitCountMap error for instance '%s'; "
                        "splitting org-unit chunk from %d to %d+%d",
                        instance.name,
                        len(org_units),
                        ou_midpoint,
                        len(org_units) - ou_midpoint,
                        exc_info=True,
                    )
                    partial: list[dict[str, Any]] = []
                    for ou_half in (org_units[:ou_midpoint], org_units[ou_midpoint:]):
                        try:
                            partial.extend(self._fetch_analytics_batch(
                                instance=instance,
                                batch=batch,
                                periods=periods,
                                org_units=ou_half,
                                variable_map=variable_map,
                                page_size=page_size,
                                include_combo_dimensions=include_combo_dimensions,
                                job_id=job_id,
                            ))
                        except Exception as sub_exc:  # pylint: disable=broad-except
                            if not _is_retryable_analytics_error(sub_exc):
                                raise
                            logger.warning(
                                "Sync: skipping %d org unit(s) for instance '%s' "
                                "after exhausting retries (persistent 500)",
                                len(ou_half),
                                instance.name,
                            )
                    return partial

                # ----------------------------------------------------------
                # Strategy 2: reduce page size (helps with transient 500s and
                # large result sets, but NOT with OU-count NPEs).
                # Use try/except so that if the smaller page also fails we
                # fall through to variable/OU splitting instead of propagating.
                # ----------------------------------------------------------
                if page_size > _MIN_ANALYTICS_PAGE_SIZE and not _is_ou_overflow_error(exc):
                    reduced_page_size = max(_MIN_ANALYTICS_PAGE_SIZE, page_size // 2)
                    logger.warning(
                        "Sync: retryable analytics failure for instance '%s' "
                        "batch_size=%d; retrying with page_size=%d",
                        instance.name,
                        len(batch),
                        reduced_page_size,
                        exc_info=True,
                    )
                    try:
                        return self._fetch_analytics_batch(
                            instance=instance,
                            batch=batch,
                            periods=periods,
                            org_units=org_units,
                            variable_map=variable_map,
                            page_size=reduced_page_size,
                            include_combo_dimensions=include_combo_dimensions,
                            job_id=job_id,
                        )
                    except Exception as pg_exc:  # pylint: disable=broad-except
                        if not _is_retryable_analytics_error(pg_exc):
                            raise
                        # Page-size reduction didn't help; fall through.

                # ----------------------------------------------------------
                # Strategy 3: split the variable batch in half.
                # Each half is fetched independently so that a broken indicator
                # on the DHIS2 side does not prevent the other variables from
                # loading.
                # ----------------------------------------------------------
                if len(batch) > 1:
                    midpoint = max(1, len(batch) // 2)
                    logger.warning(
                        "Sync: retryable analytics failure for instance '%s'; "
                        "splitting variable batch from %d to %d+%d",
                        instance.name,
                        len(batch),
                        midpoint,
                        len(batch) - midpoint,
                        exc_info=True,
                    )
                    partial = []
                    for sub_batch in (batch[:midpoint], batch[midpoint:]):
                        try:
                            partial.extend(self._fetch_analytics_batch(
                                instance=instance,
                                batch=sub_batch,
                                periods=periods,
                                org_units=org_units,
                                variable_map=variable_map,
                                page_size=page_size,
                                include_combo_dimensions=include_combo_dimensions,
                                job_id=job_id,
                            ))
                        except Exception as sub_exc:  # pylint: disable=broad-except
                            if not _is_retryable_analytics_error(sub_exc):
                                raise
                            logger.warning(
                                "Sync: skipping %d variable(s) for instance '%s' "
                                "after exhausting retries (persistent 500)",
                                len(sub_batch),
                                instance.name,
                            )
                    return partial

                # ----------------------------------------------------------
                # Strategy 4: variable batch is size 1; split OUs as last
                # resort.  A generic 500 with no specific DHIS2 message may
                # still be caused by the OU count.  Each half is fetched
                # independently so a broken OU/indicator pair does not block
                # the rest.
                # ----------------------------------------------------------
                if len(org_units) > 1:
                    ou_midpoint = max(1, len(org_units) // 2)
                    logger.warning(
                        "Sync: single-variable batch still failing for instance '%s'; "
                        "splitting org-unit chunk from %d to %d+%d as final fallback",
                        instance.name,
                        len(org_units),
                        ou_midpoint,
                        len(org_units) - ou_midpoint,
                        exc_info=True,
                    )
                    partial = []
                    for ou_half in (org_units[:ou_midpoint], org_units[ou_midpoint:]):
                        try:
                            partial.extend(self._fetch_analytics_batch(
                                instance=instance,
                                batch=batch,
                                periods=periods,
                                org_units=ou_half,
                                variable_map=variable_map,
                                page_size=page_size,
                                include_combo_dimensions=include_combo_dimensions,
                                job_id=job_id,
                            ))
                        except Exception as sub_exc:  # pylint: disable=broad-except
                            if not _is_retryable_analytics_error(sub_exc):
                                raise
                            logger.warning(
                                "Sync: skipping %d org unit(s) for variable '%s' "
                                "on instance '%s' after exhausting retries",
                                len(ou_half),
                                batch[0] if batch else "?",
                                instance.name,
                            )
                    return partial

                # ----------------------------------------------------------
                # Dead-end: 1 variable + 1 org unit + persistent 500.
                # This is a broken indicator/OU combination on the DHIS2 side.
                # Record the bad slice and return empty so other slices keep
                # loading — do not fail the whole sync job for one bad cell.
                # ----------------------------------------------------------
                _bad_var = batch[0] if batch else "?"
                _bad_ou = org_units[0] if org_units else "?"
                logger.warning(
                    "Sync: skipping variable '%s' for org unit '%s' on instance '%s' "
                    "— persistent 500 with no further splits possible",
                    _bad_var,
                    _bad_ou,
                    instance.name,
                )
                _bad_variable = variable_map.get(self._base_variable_id(_bad_var))
                for family in self._variable_skip_families(_bad_variable):
                    self._known_bad_analytics_ou_families[(instance.id, family)].add(
                        _bad_ou
                    )
                self._skipped_slices.append({
                    "instance_id": instance.id,
                    "instance_name": instance.name,
                    "variable": _bad_var,
                    "org_unit": _bad_ou,
                    "periods": list(periods),
                    "reason": "persistent_500",
                })
                return []

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

        needs_definition_repair = not bool(
            _read_model_attr(dataset, "staging_table_name")
        )
        preview_config = dataset.get_dataset_config()
        if not needs_definition_repair and not _normalize_instance_ids(
            preview_config.get("configured_connection_ids")
        ):
            needs_definition_repair = True
        if not needs_definition_repair:
            needs_definition_repair = (
                db.session.query(DHIS2DatasetVariable.id)
                .filter_by(staged_dataset_id=staged_dataset_id)
                .first()
                is None
            )
        if needs_definition_repair:
            try:
                from superset.dhis2.staged_dataset_service import (
                    repair_staged_dataset_definition,
                )

                repair_staged_dataset_definition(staged_dataset_id)
                dataset = (
                    db.session.query(DHIS2StagedDataset)
                    .filter_by(id=staged_dataset_id)
                    .first()
                    or dataset
                )
            except Exception:  # pylint: disable=broad-except
                logger.warning(
                    "Sync: staged dataset definition repair failed for dataset id=%s",
                    staged_dataset_id,
                    exc_info=True,
                )

        _assign_model_attr(dataset, "last_sync_status", "running")
        _assign_model_attr(dataset, "last_sync_rows", 0)
        _sync_compat_dataset(dataset)
        # Write the very first visible status so operators see the sync has
        # begun before any configuration loading or network activity.
        self._update_job_progress(
            job_id,
            current_step=f"initializing — {dataset.name}",
            total_units=0,
            completed_units=0,
            failed_units=0,
            rows_extracted=0,
            rows_staged=0,
            rows_merged=0,
        )
        db.session.commit()

        dataset_config = dataset.get_dataset_config()

        # ------------------------------------------------------------------
        # Merge promoted model columns into dataset_config so that fields
        # configured via the Dataset Management UI are visible to all internal
        # helpers that read from the config dict (e.g. _resolve_org_units_for_instance,
        # _resolve_level_range in OrgUnitHierarchyService).
        # Model columns take precedence over JSON-blob values when both are set.
        # ------------------------------------------------------------------
        _model_max_level = _read_model_attr(dataset, "max_orgunit_level")
        if _model_max_level is not None:
            dataset_config["max_orgunit_level"] = _model_max_level

        _model_allowed_levels_json = _read_model_attr(dataset, "allowed_org_unit_levels_json")
        if _model_allowed_levels_json and "allowed_org_unit_levels" not in dataset_config:
            try:
                _parsed_levels = json.loads(_model_allowed_levels_json)
                if isinstance(_parsed_levels, list):
                    dataset_config["allowed_org_unit_levels"] = _parsed_levels
            except (json.JSONDecodeError, TypeError):
                pass

        _model_ou_source_mode = _read_model_attr(dataset, "org_unit_source_mode")
        if _model_ou_source_mode and "org_unit_source_mode" not in dataset_config:
            dataset_config["org_unit_source_mode"] = _model_ou_source_mode

        _model_ou_scope = _read_model_attr(dataset, "org_unit_scope")
        if _model_ou_scope and "org_unit_scope" not in dataset_config:
            dataset_config["org_unit_scope"] = _model_ou_scope

        _model_primary_inst_id = _read_model_attr(dataset, "primary_instance_id")
        if _model_primary_inst_id is not None and "primary_instance_id" not in dataset_config:
            dataset_config["primary_instance_id"] = _model_primary_inst_id

        # ------------------------------------------------------------------
        # Source-mode dispatch — delegate non-analytics paths early
        # ------------------------------------------------------------------
        source_mode = (
            _read_model_attr(dataset, "source_mode")
            or dataset_config.get("source_mode", "analytics")
            or "analytics"
        )
        if source_mode == "dataValueSets":
            return self._sync_datavalues_mode(
                dataset, dataset_config, job_id, incremental, started_at
            )
        if source_mode == "hybrid":
            r1 = self._sync_analytics_mode_inner(
                dataset, dataset_config, staged_dataset_id, job_id, incremental, started_at
            )
            r2 = self._sync_datavalues_mode(
                dataset, dataset_config, job_id, incremental, started_at
            )
            return self._merge_mode_results(r1, r2)
        # Default analytics path continues below unchanged.

        # Log the effective org unit hierarchy config so operators can verify
        # the correct settings are in effect without reading application logs.
        _eff_max_level = dataset_config.get("max_orgunit_level")
        _eff_allowed = dataset_config.get("allowed_org_unit_levels")
        _eff_scope = dataset_config.get("org_unit_scope", "selected")
        _eff_source = dataset_config.get("org_unit_source_mode", "repository")
        logger.info(
            "Sync: dataset=%d ou_source_mode=%s ou_scope=%s max_orgunit_level=%s "
            "allowed_org_unit_levels=%s",
            staged_dataset_id,
            _eff_source,
            _eff_scope,
            _eff_max_level,
            _eff_allowed,
        )

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
        _completed_units = 0
        _failed_units = 0
        _rows_extracted = 0
        _rows_staged = 0

        for message in configuration_errors:
            logger.warning(
                "Sync: dataset=%d configuration issue: %s",
                staged_dataset_id,
                message,
            )

        _total_var_count = sum(len(v) for v in instance_vars.values())
        self._update_job_progress(
            job_id,
            current_step=(
                f"preparing — {len(instance_vars)} instance(s), {_total_var_count} variable(s)"
            ),
            total_units=len(instance_vars),
            completed_units=0,
            failed_units=0,
            rows_extracted=0,
            rows_staged=0,
            rows_merged=0,
        )

        for instance_id, inst_vars in instance_vars.items():
            # Check for cancellation before each instance fetch
            if job_id is not None:
                _cancel_job = db.session.get(DHIS2SyncJob, job_id)
                if _cancel_job is not None:
                    db.session.refresh(_cancel_job)
                    if _cancel_job.cancel_requested:
                        logger.info(
                            "Sync: cancel requested for job_id=%s dataset=%d, aborting.",
                            job_id,
                            staged_dataset_id,
                        )
                        _cancel_job.status = "cancelled"
                        _cancel_job.completed_at = datetime.utcnow()
                        _cancel_job.error_message = "Cancelled by user"
                        _cancel_job.rows_loaded = total_rows
                        _cancel_job.instance_results = json.dumps(instance_results)
                        db.session.commit()
                        _assign_model_attr(dataset, "last_sync_status", "cancelled")
                        db.session.commit()
                        return {
                            "status": "cancelled",
                            "total_rows": total_rows,
                            "instances": instance_results,
                            "duration_seconds": round(time.monotonic() - started_at, 3),
                        }

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
            self._update_job_progress(
                job_id,
                current_step=f"fetching from {instance.name}",
                current_item=instance.name,
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
                # --- Incremental per-chunk staging ---
                # Each OU chunk's rows are staged to ClickHouse as soon as they
                # arrive so the UI shows a rising row count in real-time.
                _chunk_first = True  # first chunk triggers replace/prune
                _rows_staged_for_inst = 0

                def _on_chunk_rows(
                    chunk_rows: list[dict[str, Any]],
                    _inst=instance,
                    _ds=dataset,
                    _plan=incremental_plan,
                ) -> None:
                    nonlocal _chunk_first, _rows_staged_for_inst, _rows_staged, total_rows
                    _replace = _chunk_first and not _plan.use_incremental
                    _chunk_first = False
                    _prune = _plan.periods_to_delete if _replace else []
                    _count = self._load_rows(
                        _ds,
                        _inst,
                        chunk_rows,
                        sync_job_id=job_id,
                        replace_instance_rows=_replace,
                        periods_to_prune=_prune,
                    )
                    _rows_staged_for_inst += _count
                    _rows_staged += _count
                    total_rows += _count
                    self._update_job_progress(
                        job_id,
                        current_step=f"staging rows from {_inst.name}",
                        rows_staged=_rows_staged,
                    )
                    # Persist running total to DB so UI polling sees live counts.
                    if job_id is not None:
                        _interim = db.session.query(DHIS2SyncJob).get(job_id)
                        if _interim is not None:
                            _interim.rows_loaded = total_rows
                        try:
                            db.session.commit()
                        except Exception:  # pylint: disable=broad-except
                            logger.warning(
                                "Sync: failed to commit interim row count for job=%s",
                                job_id,
                                exc_info=True,
                            )
                            db.session.rollback()

                rows: list[dict[str, Any]] = []
                if not incremental or incremental_plan.periods_to_fetch:
                    rows = self._fetch_from_instance(
                        instance,
                        inst_vars,
                        effective_config,
                        job_id=job_id,
                        on_chunk_rows=_on_chunk_rows,
                    )
                _rows_extracted += len(rows)
                self._update_job_progress(
                    job_id,
                    current_step=f"loading rows from {instance.name}",
                    rows_extracted=_rows_extracted,
                )

                if not _chunk_first:
                    # At least one chunk was staged incrementally; _rows_staged
                    # and total_rows were already updated inside _on_chunk_rows.
                    row_count = _rows_staged_for_inst
                else:
                    # No chunks produced rows (dataset returned nothing).
                    # Still run _load_rows so replace/prune executes for full syncs.
                    row_count = self._load_rows(
                        dataset,
                        instance,
                        rows,
                        sync_job_id=job_id,
                        replace_instance_rows=not incremental_plan.use_incremental,
                        periods_to_prune=incremental_plan.periods_to_delete,
                    )
                    _rows_staged += row_count
                    total_rows += row_count

                _completed_units += 1
                any_success = True
                # Collect any bad slices that were isolated and skipped for
                # this instance during the fetch, then reset the accumulator.
                _inst_skipped = [
                    s for s in self._skipped_slices
                    if s.get("instance_id") == instance_id
                ]
                _skipped_count = len(_inst_skipped)
                # Remove reported slices so they don't re-appear in later instances.
                self._skipped_slices = [
                    s for s in self._skipped_slices
                    if s.get("instance_id") != instance_id
                ]
                _inst_status = "partial" if _skipped_count > 0 else "success"
                if _skipped_count > 0:
                    any_failure = True  # partial outcome
                instance_results[str(instance_id)] = {
                    "status": _inst_status,
                    "rows": row_count,
                    "error": None,
                    "sync_mode": (
                        "incremental" if incremental_plan.use_incremental else "full"
                    ),
                    "skipped_slices": _skipped_count,
                    "skipped_slice_details": _inst_skipped[:20],  # cap to 20 for DB
                }
                logger.info(
                    "Sync: loaded %d rows from instance '%s' into dataset=%d"
                    " (skipped_slices=%d)",
                    row_count,
                    instance.name,
                    staged_dataset_id,
                    _skipped_count,
                )
                # ... (previous code)
                try:
                    self._materialize_serving_table(
                        dataset,
                        refresh_scope=incremental_plan.periods_to_fetch
                        if incremental_plan.use_incremental
                        else None,
                    )
                except Exception:  # pylint: disable=broad-except
                    logger.exception(
                        "Sync: failed to publish partial serving rows for dataset=%d after instance='%s'",
                        staged_dataset_id,
                        instance.name,
                    )
                # ... (rest of loop)
                _assign_model_attr(dataset, "last_sync_status", "running")
                _assign_model_attr(dataset, "last_sync_rows", total_rows)
                _sync_compat_dataset(dataset)
                # Write interim progress to the job record so UI polling sees
                # live row counts (request logs already committed per-batch).
                if job_id is not None:
                    _interim_job: DHIS2SyncJob | None = (
                        db.session.query(DHIS2SyncJob).get(job_id)
                    )
                    if _interim_job is not None:
                        _interim_job.rows_loaded = total_rows
                        _interim_job.instance_results = json.dumps(instance_results)
                db.session.commit()
                self._update_job_progress(
                    job_id,
                    current_step=f"completed {instance.name}",
                    completed_units=_completed_units,
                    rows_staged=_rows_staged,
                    rows_merged=total_rows,
                )
            except Exception as exc:  # pylint: disable=broad-except
                any_failure = True
                _failed_units += 1
                err_msg = str(exc)
                instance_results[str(instance_id)] = {
                    "status": "failed",
                    "rows": 0,
                    "error": err_msg,
                }
                self._update_job_progress(
                    job_id,
                    completed_units=_completed_units,
                    failed_units=_failed_units,
                )
                logger.exception(
                    "Sync: failed for instance '%s', dataset=%d: %s",
                    instance.name,
                    staged_dataset_id,
                    err_msg,
                )
                # Any request logs from the failing batch were already flushed
                # per-batch inside _fetch_from_instance._fetch_analytics_batch.
                # Nothing extra to flush here.

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
                # Final build ensures all registered specialized marts are current.
                # If everything was already built incrementally during the loop, 
                # ensure_serving_table will detect it doesn't need a full rebuild
                # unless a change was detected.
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
        _assign_model_attr(dataset, "last_sync_at", datetime.utcnow())
        _assign_model_attr(dataset, "last_sync_status", status)
        _assign_model_attr(dataset, "last_sync_rows", total_rows)
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
                    error_message="\n".join(
                        configuration_errors
                        + [
                            f"{inst_id}: {v.get('error') or 'sync failed'}"
                            for inst_id, v in instance_results.items()
                            if v.get("status") == "failed" and v.get("error")
                        ]
                    ) or None,
                    instance_results=instance_results,
                )
                # Ensure final progress snapshot is complete
                job.completed_units = _completed_units
                job.failed_units = _failed_units
                job.rows_extracted = _rows_extracted
                job.rows_staged = _rows_staged
                job.rows_merged = total_rows
                job.total_units = len(instance_vars)
                job.percent_complete = 100.0 if status == "success" else (
                    round(_completed_units / max(len(instance_vars), 1) * 100, 1)
                )
                job.current_step = "done"
                job.current_item = None
                db.session.commit()

        logger.info(
            "Sync: dataset=%d completed status=%s rows=%d duration=%.1fs",
            staged_dataset_id,
            status,
            total_rows,
            duration,
        )
        return result

    # ------------------------------------------------------------------
    # Source-mode helpers
    # ------------------------------------------------------------------

    def _sync_analytics_mode_inner(
        self,
        dataset: DHIS2StagedDataset,
        dataset_config: dict[str, Any],
        staged_dataset_id: int,
        job_id: int | None,
        incremental: bool,
        started_at: float,
    ) -> dict[str, Any]:
        """Run the analytics sync path for a dataset already loaded in memory.

        This is a thin wrapper that delegates back to the full
        ``sync_staged_dataset`` method with the same arguments so that
        hybrid-mode callers share the same code path without duplication.
        The dataset's ``source_mode`` is temporarily masked as ``"analytics"``
        to prevent infinite recursion.
        """
        # Call sync_staged_dataset with source_mode forced to analytics.
        # We achieve this by temporarily overriding the attribute value so
        # the dispatch inside sync_staged_dataset falls through to the analytics
        # path naturally.
        original_mode = _read_model_attr(dataset, "source_mode")
        try:
            _assign_model_attr(dataset, "source_mode", "analytics")
            return self.sync_staged_dataset(
                staged_dataset_id,
                job_id=job_id,
                incremental=incremental,
            )
        finally:
            _assign_model_attr(dataset, "source_mode", original_mode)

    def _sync_datavalues_mode(
        self,
        dataset: DHIS2StagedDataset,
        dataset_config: dict[str, Any],
        job_id: int | None,
        incremental: bool,
        started_at: float,
    ) -> dict[str, Any]:
        """Fetch raw aggregate data via the DHIS2 dataValueSets API.

        Iterates over all active instances for this dataset, calls
        :class:`~superset.dhis2.data_value_extractor.DHIS2DataValueExtractor`,
        stores payloads in ``stg_dhis2_datavalueset_raw``, and normalises
        them into ``fact_dhis2_datavalue`` via
        :class:`~superset.dhis2.warehouse_service.DHIS2WarehouseService`.
        """
        import uuid
        from datetime import datetime as _datetime

        from sqlalchemy import text as _text

        from superset.dhis2.data_value_extractor import (
            DHIS2DataValueExtractor,
            _MAX_OUS_PER_REQUEST as _DVS_MAX_OUS,
            _MAX_PERIODS_PER_REQUEST as _DVS_MAX_PERIODS,
        )
        from superset.dhis2.warehouse_service import DHIS2WarehouseService

        staged_dataset_id = dataset.id
        instances = get_instances_with_legacy_fallback(dataset.database_id)

        instance_results: dict[str, Any] = {}
        total_rows = 0
        any_success = False
        any_failure = False
        batch_id = uuid.uuid4().hex
        warehouse = DHIS2WarehouseService()

        data_sets_cfg = dataset_config.get("data_sets", [])
        if isinstance(data_sets_cfg, str):
            data_sets_cfg = [data_sets_cfg]

        periods_cfg = dataset_config.get("periods", [])
        if isinstance(periods_cfg, str):
            periods_cfg = [periods_cfg]

        last_updated_duration = dataset_config.get("last_updated_duration")

        for instance in instances:
            inst_key = str(instance.id)
            try:
                extractor = DHIS2DataValueExtractor(instance)
                org_units = self._resolve_org_units_for_instance(instance, dataset_config)
                # Remove user-relative markers; dataValueSets needs concrete UIDs
                org_units = [
                    u for u in org_units
                    if u not in {"USER_ORGUNIT", "USER_ORGUNIT_CHILDREN", "USER_ORGUNIT_GRANDCHILDREN"}
                ]
                if not org_units:
                    logger.warning(
                        "dataValueSets: no concrete org units for instance=%d dataset=%d; skipping",
                        instance.id,
                        staged_dataset_id,
                    )
                    instance_results[inst_key] = {"status": "skipped", "rows": 0, "error": "no org units"}
                    continue

                all_values: list[dict[str, Any]] = []
                # Chunk org units and periods
                for ou_start in range(0, max(len(org_units), 1), _DVS_MAX_OUS):
                    ou_chunk = org_units[ou_start : ou_start + _DVS_MAX_OUS]
                    if periods_cfg and not last_updated_duration:
                        for pe_start in range(0, max(len(periods_cfg), 1), _DVS_MAX_PERIODS):
                            pe_chunk = periods_cfg[pe_start : pe_start + _DVS_MAX_PERIODS]
                            chunk_values = extractor.fetch(
                                data_sets=data_sets_cfg or None,
                                periods=pe_chunk,
                                org_units=ou_chunk,
                                id_scheme=dataset_config.get("id_scheme_input"),
                            )
                            all_values.extend(chunk_values)
                    else:
                        chunk_values = extractor.fetch(
                            data_sets=data_sets_cfg or None,
                            org_units=ou_chunk,
                            last_updated_duration=last_updated_duration,
                            id_scheme=dataset_config.get("id_scheme_input"),
                        )
                        all_values.extend(chunk_values)

                # Persist raw payload
                db.session.execute(
                    _text(
                        "INSERT INTO stg_dhis2_datavalueset_raw "
                        "(batch_id, dataset_config_id, connection_id, extracted_at, "
                        " payload_format, data_json) "
                        "VALUES (:batch_id, :dc_id, :conn_id, :now, :fmt, :data)"
                    ),
                    {
                        "batch_id": batch_id,
                        "dc_id": staged_dataset_id,
                        "conn_id": instance.id,
                        "now": _datetime.utcnow(),
                        "fmt": "json",
                        "data": json.dumps({"dataValues": all_values}),
                    },
                )
                db.session.commit()

                # Normalize to fact table
                fact_rows = warehouse.normalize_datavalues_to_fact(
                    batch_id, staged_dataset_id
                )

                instance_results[inst_key] = {
                    "status": "success",
                    "rows": fact_rows,
                    "error": None,
                }
                total_rows += fact_rows
                any_success = True

            except Exception as exc:  # pylint: disable=broad-except
                logger.exception(
                    "dataValueSets sync failed for instance=%d dataset=%d",
                    instance.id,
                    staged_dataset_id,
                )
                instance_results[inst_key] = {
                    "status": "failed",
                    "rows": 0,
                    "error": str(exc),
                }
                any_failure = True

        duration = round(time.monotonic() - started_at, 3)
        if any_success and any_failure:
            status = "partial"
        elif any_success:
            status = "success"
        elif any_failure:
            status = "failed"
        else:
            status = "success"

        _assign_model_attr(dataset, "last_sync_at", _datetime.utcnow())
        _assign_model_attr(dataset, "last_sync_status", status)
        _assign_model_attr(dataset, "last_sync_rows", total_rows)
        db.session.commit()

        if job_id is not None:
            job: DHIS2SyncJob | None = db.session.query(DHIS2SyncJob).get(job_id)
            if job is not None:
                self.update_job_status(
                    job,
                    status=status,
                    rows_loaded=total_rows,
                    rows_failed=sum(
                        1 for v in instance_results.values() if v["status"] == "failed"
                    ),
                    instance_results=instance_results,
                )

        return {
            "status": status,
            "total_rows": total_rows,
            "instances": instance_results,
            "duration_seconds": duration,
        }

    @staticmethod
    def _merge_mode_results(
        r1: dict[str, Any], r2: dict[str, Any]
    ) -> dict[str, Any]:
        """Merge results from analytics + dataValueSets mode runs."""
        statuses = {r1.get("status"), r2.get("status")}
        if "failed" in statuses and "success" in statuses:
            merged_status = "partial"
        elif statuses == {"failed"}:
            merged_status = "failed"
        else:
            merged_status = "success"

        merged_instances: dict[str, Any] = {}
        for key in set(list(r1.get("instances", {}).keys()) + list(r2.get("instances", {}).keys())):
            entry1 = r1.get("instances", {}).get(key, {})
            entry2 = r2.get("instances", {}).get(key, {})
            merged_instances[key] = {
                "status": entry1.get("status") or entry2.get("status"),
                "rows": (entry1.get("rows") or 0) + (entry2.get("rows") or 0),
                "error": entry1.get("error") or entry2.get("error"),
            }

        return {
            "status": merged_status,
            "total_rows": (r1.get("total_rows") or 0) + (r2.get("total_rows") or 0),
            "instances": merged_instances,
            "duration_seconds": (r1.get("duration_seconds") or 0) + (r2.get("duration_seconds") or 0),
        }

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    def _fetch_from_instance(
        self,
        instance: DHIS2Instance,
        variables: list[DHIS2DatasetVariable],
        dataset_config: dict[str, Any],
        job_id: int | None = None,
        on_chunk_rows: Any = None,
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
                - ``ou_chunk_size`` (int, optional): max org-unit UIDs per analytics
                  request.  Default: ``200``.  Clamped to [1, 500].
                - ``var_chunk_size`` (int, optional): max variable UIDs per request.
                  Default: ``50``.  Clamped to [1, 200].
                - ``analytics_page_size`` (int, optional): rows per analytics page.
                  Default: ``1000``.  Clamped to [100, 10000].

        Returns:
            A flat list of row dicts suitable for insertion into the staging
            table.
        """
        periods_cfg = dataset_config.get("periods", ["LAST_12_MONTHS"])
        if isinstance(periods_cfg, str):
            periods_cfg = [periods_cfg]
        if not isinstance(periods_cfg, list) or not periods_cfg:
            periods_cfg = ["LAST_12_MONTHS"]

        org_units_cfg = self._resolve_org_units_for_instance(instance, dataset_config)

        # When include_ancestor_levels is set, expand LEVEL-N selectors to also
        # request data at all parent levels (1 through N-1) from DHIS2. This gives
        # DHIS2-computed aggregated values at each level, which are correct for
        # percentage/rate indicators where SQL SUM would be wrong.
        if dataset_config.get("include_ancestor_levels"):
            expanded: list[str] = list(org_units_cfg)  # copy
            _LEVEL_RE = re.compile(r"^LEVEL-(\d+)$", re.IGNORECASE)
            max_leaf = 0
            for entry in org_units_cfg:
                m = _LEVEL_RE.match(str(entry))
                if m:
                    max_leaf = max(max_leaf, int(m.group(1)))
            if max_leaf > 1:
                existing_levels = {
                    int(m.group(1))
                    for entry in org_units_cfg
                    if (m := _LEVEL_RE.match(str(entry)))
                }
                for level in range(1, max_leaf):
                    if level not in existing_levels:
                        expanded.insert(0, f"LEVEL-{level}")
                org_units_cfg = list(dict.fromkeys(expanded))
                logger.info(
                    "Sync: include_ancestor_levels — expanded org_units to %s",
                    org_units_cfg,
                )

        # Allow per-dataset overrides for chunk / page sizes.  Values are
        # clamped to safe bounds so a misconfiguration can't OOM the worker.
        max_ous_per_request = _clamp_chunk_size(
            dataset_config.get("ou_chunk_size"),
            _MAX_OUS_PER_REQUEST,
            _OU_CHUNK_SIZE_MIN,
            _OU_CHUNK_SIZE_MAX,
        )
        max_vars_per_request = _clamp_chunk_size(
            dataset_config.get("var_chunk_size"),
            _MAX_VARS_PER_REQUEST,
            _VAR_CHUNK_SIZE_MIN,
            _VAR_CHUNK_SIZE_MAX,
        )
        analytics_page_size = _clamp_chunk_size(
            dataset_config.get("analytics_page_size"),
            _ANALYTICS_PAGE_SIZE,
            _ANALYTICS_PAGE_SIZE_MIN,
            _ANALYTICS_PAGE_SIZE_MAX,
        )

        # Build a map of variable_id -> DHIS2DatasetVariable for metadata lookup.
        variable_map: dict[str, DHIS2DatasetVariable] = {
            var.variable_id: var for var in variables
        }

        # Build dx_ids respecting per-variable disaggregation settings.
        # - "total" / "all" → pass the bare variable_id (DHIS2 returns the aggregated row
        #   when no COC filter is applied; staging captures co_uid from the response).
        # - "selected" → add "variable_id.coc_uid" dotted entries for each chosen COC.
        dx_ids: list[str] = []
        for var in variables:
            ep = var.get_extra_params() if hasattr(var, "get_extra_params") else {}
            disagg_mode = ep.get("disaggregation") or "total"
            if disagg_mode == "selected":
                selected_uids = ep.get("selected_coc_uids") or []
                if selected_uids:
                    for coc_uid in selected_uids:
                        dx_ids.append(f"{var.variable_id}.{coc_uid}")
                else:
                    # Fall back to bare ID if no UIDs configured
                    dx_ids.append(var.variable_id)
            else:
                dx_ids.append(var.variable_id)

        include_combo_dimensions = self._should_include_combo_dimensions(
            dataset_config,
            variables,
        )

        all_rows: list[dict[str, Any]] = []

        # Chunk org units to avoid sending too many OUs in a single request.
        # DHIS2 can time out or return errors when a single query spans hundreds of
        # org units, even via POST.  We iterate over chunks and merge the results.
        ou_chunks: list[list[str]] = (
            [
                org_units_cfg[ou_start : ou_start + max_ous_per_request]
                for ou_start in range(0, len(org_units_cfg), max_ous_per_request)
            ]
            if org_units_cfg
            else [[]]  # empty list means DHIS2 will use the requesting user's org units
        )
        logger.info(
            "Sync: instance '%s' — %d org unit(s) split into %d chunk(s) of up to %d "
            "(var_chunk=%d, page_size=%d)",
            instance.name,
            len(org_units_cfg),
            len(ou_chunks),
            max_ous_per_request,
            max_vars_per_request,
            analytics_page_size,
        )

        for ou_chunk in ou_chunks:
            chunk_rows: list[dict[str, Any]] = []
            # Split dx_ids into variable batches within each OU chunk.
            for batch_start in range(0, max(1, len(dx_ids)), max_vars_per_request):
                batch = dx_ids[batch_start : batch_start + max_vars_per_request]
                if not batch:
                    break
                try:
                    batch_rows = self._fetch_analytics_batch(
                        instance=instance,
                        batch=batch,
                        periods=periods_cfg,
                        org_units=ou_chunk,
                        variable_map=variable_map,
                        page_size=analytics_page_size,
                        include_combo_dimensions=include_combo_dimensions,
                        job_id=job_id,
                    )
                    chunk_rows.extend(batch_rows)
                    all_rows.extend(batch_rows)
                    # Heartbeat: refresh changed_on after every HTTP batch so
                    # the 30-min stale-reset detector does not kill a
                    # legitimately-running long fetch that yields no rows yet.
                    if job_id is not None:
                        try:
                            self._update_job_progress(
                                job_id,
                                current_step=f"fetching from {instance.name}",
                            )
                        except Exception:  # pylint: disable=broad-except
                            pass
                finally:
                    # Flush request log immediately after every batch (success
                    # or failure) so the UI shows live progress without waiting
                    # for the entire instance or job to complete.
                    # Wrap in try/except so a DB error here never suppresses
                    # the original batch exception.
                    if job_id is not None and self._request_log_collector:
                        try:
                            self._flush_request_logs_to_session(job_id)
                            db.session.commit()
                        except Exception:  # pylint: disable=broad-except
                            logger.warning(
                                "Sync: failed to flush request logs after batch "
                                "(instance '%s'); discarding %d pending entries",
                                instance.name,
                                len(self._request_log_collector),
                                exc_info=True,
                            )
                            self._request_log_collector.clear()
                            try:
                                db.session.rollback()
                            except Exception:  # pylint: disable=broad-except
                                pass

            # After all variable batches for this OU chunk complete, notify
            # the caller so it can stage rows incrementally (real-time progress).
            if on_chunk_rows is not None and chunk_rows:
                on_chunk_rows(chunk_rows)

        return all_rows

    @staticmethod
    def _resolve_level_constraints(
        dataset_config: dict[str, Any],
    ) -> tuple[int | None, frozenset[int] | None]:
        """Read max_level and allowed_levels constraints from *dataset_config*.

        Returns:
            ``(max_level, allowed_levels)`` where either may be ``None`` when
            the corresponding constraint is not configured.
        """
        max_level: int | None = None
        _ml = dataset_config.get("max_orgunit_level") or dataset_config.get(
            "org_unit_max_level"
        )
        if _ml is not None:
            try:
                _val = int(_ml)
                if _val > 0:
                    max_level = _val
            except (TypeError, ValueError):
                pass

        allowed_levels: frozenset[int] | None = None
        _al = dataset_config.get("allowed_org_unit_levels")
        if isinstance(_al, list) and _al:
            try:
                _set = frozenset(int(x) for x in _al if x is not None)
                if _set:
                    allowed_levels = _set
            except (TypeError, ValueError):
                pass

        return max_level, allowed_levels

    @staticmethod
    def _should_include_combo_dimensions(
        dataset_config: dict[str, Any],
        variables: list[DHIS2DatasetVariable],
    ) -> bool:
        # Per-variable disaggregation settings take priority over the
        # dataset-level toggle so dimensions always appear when needed.
        for variable in variables:
            getter = getattr(variable, "get_extra_params", None)
            extra_params = getter() if callable(getter) else {}
            if not isinstance(extra_params, dict):
                continue
            disaggregation = str(extra_params.get("disaggregation") or "").strip().lower()
            if disaggregation in {"all", "selected"}:
                return True
            selected_coc_uids = extra_params.get("selected_coc_uids")
            if isinstance(selected_coc_uids, list) and selected_coc_uids:
                return True
            disaggregate_by = extra_params.get("disaggregate_by")
            if isinstance(disaggregate_by, list) and disaggregate_by:
                return True

        explicit = dataset_config.get("preserve_category_dimensions")
        if explicit is None:
            explicit = dataset_config.get("include_disaggregation_dimension")
        if explicit is not None:
            return bool(explicit)

        return False

    @staticmethod
    def _resolve_org_units_for_instance(
        instance: DHIS2Instance,
        dataset_config: dict[str, Any],
    ) -> list[str]:
        org_units_cfg = dataset_config.get("org_units", ["USER_ORGUNIT"])
        if isinstance(org_units_cfg, str):
            org_units_cfg = [org_units_cfg]
        if not isinstance(org_units_cfg, list) or not org_units_cfg:
            org_units_cfg = ["USER_ORGUNIT"]

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

        # Read level constraints.  These filter descendants that would otherwise
        # expand into irrelevant generated levels (e.g. 7, 8).
        max_level, allowed_levels = DHIS2SyncService._resolve_level_constraints(
            dataset_config
        )

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
        resolved_detail_map: dict[str, dict[str, Any]] = {}
        for item in selected_details:
            if not isinstance(item, dict):
                continue
            selection_key = _config_value(item, "selection_key", "selectionKey", "id")
            if isinstance(selection_key, str) and selection_key:
                selected_detail_map[selection_key] = item
                resolved_item = _resolve_selected_detail_for_instance(item, instance.id)
                if isinstance(resolved_item, dict):
                    resolved_detail_map[selection_key] = resolved_item

        scoped_detail_map = {
            **selected_detail_map,
            **resolved_detail_map,
        }
        if not concrete_units and selected_detail_map:
            concrete_units = list(selected_detail_map.keys())

        if org_unit_source_mode == _ORG_UNIT_SOURCE_MODE_PRIMARY:
            primary_units = [
                str(_config_value(item, "source_org_unit_id", "sourceOrgUnitId", "id"))
                for key, item in scoped_detail_map.items()
                if key in concrete_units
                and isinstance(
                    _config_value(item, "source_org_unit_id", "sourceOrgUnitId", "id"),
                    str,
                )
            ]
            if not primary_units:
                primary_units = concrete_units
            primary_units = list(dict.fromkeys(primary_units))
            if org_unit_scope != _ORG_UNIT_SCOPE_SELECTED:
                primary_units = _prune_ancestor_org_units(
                    primary_units,
                    scoped_detail_map,
                    prefer_roots=True,
                )
            scoped_units = _expand_org_units_for_scope(
                instance=instance,
                allowed_units=primary_units,
                scope=org_unit_scope,
                max_level=max_level,
                allowed_levels=allowed_levels,
            )
            return list(dict.fromkeys([*user_scope_units, *scoped_units]))

        allowed_units: list[str] = []
        for selection_key in concrete_units:
            item = scoped_detail_map.get(selection_key)
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

            source_instance_ids = _detail_instance_ids(item)
            if not source_instance_ids:
                allowed_units.append(source_org_unit_id)
                continue

            if instance.id in source_instance_ids:
                allowed_units.append(source_org_unit_id)

        if not allowed_units and concrete_units:
            allowed_units = [
                str(
                    _config_value(
                        scoped_detail_map[key],
                        "source_org_unit_id",
                        "sourceOrgUnitId",
                        "id",
                    )
                )
                for key in concrete_units
                if isinstance(scoped_detail_map.get(key), dict)
                and isinstance(
                    _config_value(
                        scoped_detail_map[key],
                        "source_org_unit_id",
                        "sourceOrgUnitId",
                        "id",
                    ),
                    str,
                )
            ]
            if not allowed_units:
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
            if not allowed_units and org_unit_source_mode != _ORG_UNIT_SOURCE_MODE_REPOSITORY:
                allowed_units = [
                    key.split("::", 1)[1] if "::" in key else key
                    for key in concrete_units
                ]

        allowed_units = list(dict.fromkeys(allowed_units))
        if org_unit_scope != _ORG_UNIT_SCOPE_SELECTED:
            allowed_units = _prune_ancestor_org_units(
                allowed_units,
                scoped_detail_map,
                prefer_roots=True,
            )
        scoped_units = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=allowed_units,
            scope=org_unit_scope,
            max_level=max_level,
            allowed_levels=allowed_levels,
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
        include_combo_dimensions: bool = False,
    ) -> dict[str, Any]:
        """Execute a single ``GET /api/analytics`` request against *instance*.

        Uses the DHIS2 2.39+ recommended approach: GET with ``Accept:
        application/json``.  Falls back to POST (form-encoded) automatically
        when GET returns 414 URI Too Long (very large org-unit sets).

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
            :class:`RuntimeError`: For DHIS2 error codes that indicate a
                server-side configuration problem (e.g. E7144 — analytics
                tables not built).  These are non-retryable.
            :class:`requests.HTTPError`: For other non-2xx HTTP responses.
            :class:`requests.RequestException`: For network-level failures.
            :class:`ValueError`: If the response body is not valid JSON.
        """
        base_url = instance.url.rstrip("/")
        # DHIS2 2.39+ recommends GET /api/analytics with Accept: application/json.
        # The .json suffix URL variant is deprecated and may return 405 on some
        # reverse-proxy configurations.
        url = f"{base_url}/api/analytics"

        # Build the parameter list (repeated keys produce dimension=dx:…&dimension=pe:…)
        params: list[tuple[str, str]] = [
            ("dimension", f"dx:{';'.join(dx_ids)}"),
            ("dimension", f"pe:{';'.join(periods)}"),
            ("dimension", f"ou:{';'.join(org_units)}"),
            ("displayProperty", "NAME"),
            ("skipMeta", "false"),
            ("paging", "true"),
            ("page", str(page)),
            ("pageSize", str(page_size)),
        ]
        if include_combo_dimensions:
            params.extend(
                [
                    ("dimension", "co"),
                    ("dimension", "ao"),
                ]
            )

        auth_headers = instance.get_auth_headers()

        logger.debug(
            "Sync: GET %s page=%d (dx count=%d, ou count=%d)",
            url,
            page,
            len(dx_ids),
            len(org_units),
        )
        resp = requests.get(
            url,
            params=params,
            headers={"Accept": "application/json", **auth_headers},
            timeout=_REQUEST_TIMEOUT,
        )

        if resp.status_code == 414:
            # URI Too Long — fall back to POST with form-encoded body so that
            # very large org-unit sets don't hit query-string length limits.
            logger.debug(
                "Sync: GET returned 414 for instance '%s'; retrying as POST form-encoded",
                instance.name,
            )
            resp = requests.post(
                url,
                data=params,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    **auth_headers,
                },
                timeout=_REQUEST_TIMEOUT,
            )

        if not resp.ok:
            # Attempt to extract a structured DHIS2 error from the response body.
            dhis2_error_code: str | None = None
            dhis2_message: str | None = None
            try:
                error_body = resp.json()
                dhis2_error_code = error_body.get("errorCode")
                dhis2_message = (
                    error_body.get("message")
                    or error_body.get("devMessage")
                )
            except Exception:  # pylint: disable=broad-except
                pass

            # E7144: Analytics aggregation tables have not been built on this
            # DHIS2 instance.  This is a server-side prerequisite — retrying
            # will not help.  Raise a RuntimeError so that the caller does not
            # apply the normal retryable-error handling.
            if dhis2_error_code == "E7144":
                raise RuntimeError(
                    f"DHIS2 analytics tables not available on '{instance.name}' (E7144). "
                    "The DHIS2 Analytics aggregation job must be run via Data Administration "
                    f"before data can be exported. DHIS2 message: {dhis2_message}"
                )

            reason = dhis2_message or str(getattr(resp, "reason", "") or "").strip() or None
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

            if dhis2_error_code:
                reason = f"[{dhis2_error_code}] {reason}"

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
        aoc_col = col_index.get("aoc", col_index.get("ao"))

        result: list[dict[str, Any]] = []

        for raw_row in rows:
            def _get(idx: int | None) -> str | None:
                if idx is None or idx >= len(raw_row):
                    return None
                v = raw_row[idx]
                return v if v != "" else None

            dx_uid_raw = _get(dx_col)
            pe = _get(pe_col)
            ou = _get(ou_col)
            raw_value = _get(value_col)

            # DHIS2 may return dotted "varId.cocUid" in the dx column when
            # a specific category option combo was requested.  Split it out.
            dx_uid: str | None
            coc_uid_from_dx: str | None = None
            if dx_uid_raw and "." in dx_uid_raw:
                parts = dx_uid_raw.split(".", 1)
                dx_uid = parts[0]
                coc_uid_from_dx = parts[1]
            else:
                dx_uid = dx_uid_raw

            # Resolve names from metaData.
            dx_meta = meta_items.get(dx_uid_raw or "", {}) or meta_items.get(dx_uid or "", {})
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

            co_uid = _get(co_col) or coc_uid_from_dx or ""
            co_meta = meta_items.get(co_uid or "", {})
            co_name = co_meta.get("name")

            aoc_uid = _get(aoc_col) or ""
            aoc_meta = meta_items.get(aoc_uid or "", {})
            aoc_name = aoc_meta.get("name")

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
                    "aoc_name": aoc_name,
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
        if not (
            _read_model_attr(dataset, "staging_table_name")
            or _read_model_attr(dataset, "id")
        ):
            logger.warning(
                "Sync: dataset=%d has no staging_table_name configured; skipping load",
                _read_model_attr(dataset, "id"),
            )
            return 0

        staging_engine = _get_sync_staging_engine(dataset.database_id)

        # Auto-create the physical staging table if it doesn't exist yet.
        # This is a no-op when the table already exists (CREATE IF NOT EXISTS).
        if hasattr(staging_engine, "create_staging_table"):
            try:
                staging_engine.create_staging_table(dataset)
            except Exception:  # pylint: disable=broad-except
                logger.warning(
                    "Sync: could not auto-create staging table for dataset=%d",
                    _read_model_attr(dataset, "id"),
                    exc_info=True,
                )

        row_count = 0
        if replace_instance_rows:
            result = staging_engine.replace_rows_for_instance(
                dataset,
                instance_id=instance.id,
                instance_name=instance.name,
                rows=rows,
                sync_job_id=sync_job_id,
            )
            # replace_rows_for_instance returns {"deleted": int, "inserted": int}
            row_count = result.get("inserted", 0) if isinstance(result, dict) else int(result or 0)
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
            if isinstance(row_count, dict):
                row_count = row_count.get("inserted", 0)
            else:
                row_count = int(row_count or 0)
        if staging_engine.engine_name != "clickhouse":
            record_dhis2_stage_rows(
                dataset=dataset,
                instance=instance,
                rows=rows,
                sync_job_id=sync_job_id,
            )
        return row_count

    def _materialize_serving_table(
        self,
        dataset: DHIS2StagedDataset,
        refresh_scope: Iterable[str] | None = None,
    ) -> None:
        from superset.dhis2.staged_dataset_service import ensure_serving_table

        # force_rebuild=True: after staging new rows the serving table must
        # always be rebuilt, even when columns haven't changed and the table
        # already has data from a previous sync run.
        ensure_serving_table(dataset.id, refresh_scope=refresh_scope, force_rebuild=True)

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
            "Sync: created job id=%s type=%s dataset=%d",
            job.id,
            job_type,
            staged_dataset_id,
        )
        return job

    def _update_job_progress(
        self,
        job_id: int | None,
        *,
        current_step: str | None = None,
        current_item: str | None = None,
        completed_units: int | None = None,
        failed_units: int | None = None,
        total_units: int | None = None,
        rows_extracted: int | None = None,
        rows_staged: int | None = None,
        rows_merged: int | None = None,
    ) -> None:
        """Write a lightweight progress snapshot to the job record.

        Silently no-ops when *job_id* is ``None`` (e.g. direct service calls
        that don't track a job).  Commits immediately so the frontend sees
        live updates when it polls ``/api/v1/dhis2/sync/job/<job_id>``.
        """
        if job_id is None:
            return
        try:
            job: DHIS2SyncJob | None = db.session.get(DHIS2SyncJob, job_id)
            if job is None:
                return
            if total_units is not None:
                job.total_units = total_units
            if completed_units is not None:
                job.completed_units = completed_units
            if failed_units is not None:
                job.failed_units = failed_units
            if current_step is not None:
                job.current_step = current_step
            if current_item is not None:
                job.current_item = current_item
            if rows_extracted is not None:
                job.rows_extracted = rows_extracted
            if rows_staged is not None:
                job.rows_staged = rows_staged
            if rows_merged is not None:
                job.rows_merged = rows_merged
            # Recompute percent
            if (job.total_units or 0) > 0 and job.completed_units is not None:
                job.percent_complete = round(
                    job.completed_units / job.total_units * 100, 1
                )
            job.changed_on = datetime.utcnow()
            db.session.commit()
        except Exception:  # pylint: disable=broad-except
            logger.debug("_update_job_progress: non-fatal error for job_id=%s", job_id, exc_info=True)

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
        _assign_model_attr(job, "status", status)
        _assign_model_attr(job, "changed_on", now)

        if status == "running" and _read_model_attr(job, "started_at") is None:
            _assign_model_attr(job, "started_at", now)

        if status in ("success", "partial", "failed"):
            _assign_model_attr(job, "completed_at", now)

        if rows_loaded is not None:
            _assign_model_attr(job, "rows_loaded", rows_loaded)
        if rows_failed is not None:
            _assign_model_attr(job, "rows_failed", rows_failed)
        if error_message is not None:
            _assign_model_attr(job, "error_message", error_message)
        if instance_results is not None:
            _assign_model_attr(job, "instance_results", json.dumps(instance_results))

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

        _assign_model_attr(dataset, "last_sync_status", status)
        if rows_loaded is not None:
            _assign_model_attr(dataset, "last_sync_rows", rows_loaded)
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
    recovery_result = reset_stale_running_jobs(dataset_id=staged_dataset_id)
    existing_job = (
        db.session.query(DHIS2SyncJob)
        .filter(
            DHIS2SyncJob.staged_dataset_id == staged_dataset_id,
            DHIS2SyncJob.status.in_(tuple(_ACTIVE_SYNC_JOB_STATUSES)),
        )
        .order_by(DHIS2SyncJob.created_on.desc())
        .first()
    )
    if existing_job is not None:
        logger.info(
            "schedule_staged_dataset_sync: reusing active job id=%s dataset=%s status=%s recovery=%s",
            existing_job.id,
            staged_dataset_id,
            existing_job.status,
            recovery_result,
        )
        return {
            "scheduled": True,
            "mode": "existing",
            "job_id": existing_job.id,
            "task_id": getattr(existing_job, "task_id", None),
            "status": existing_job.status,
        }

    job = service.create_sync_job(staged_dataset_id, job_type=job_type)

    app = current_app._get_current_object() if has_app_context() else None

    def _run() -> None:
        if app is not None:
            with app.app_context():
                _run_sync_job_thread(staged_dataset_id, job.id, incremental=incremental)
        else:
            _run_sync_job_thread(staged_dataset_id, job.id, incremental=incremental)

    if not prefer_immediate and _celery_workers_available():
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
            task_id = getattr(task, "id", None)
            # Persist task_id so cancel/revoke works later
            job.task_id = task_id
            db.session.commit()
            service.update_dataset_sync_state(
                staged_dataset_id,
                status="queued",
                rows_loaded=0,
            )
            return {
                "scheduled": True,
                "mode": "celery",
                "job_id": job.id,
                "task_id": task_id,
                "status": "queued",
            }
        except Exception:  # pylint: disable=broad-except
            logger.info(
                "Celery staged dataset sync dispatch failed for dataset id=%s, falling back to thread",
                staged_dataset_id,
                exc_info=True,
            )
    elif not prefer_immediate:
        logger.info(
            "No Celery workers available for dataset id=%s, using thread fallback",
            staged_dataset_id,
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


def schedule_staged_dataset_sync_after_commit(
    staged_dataset_id: int,
    *,
    job_type: str = "manual",
    incremental: bool = False,
    prefer_immediate: bool = False,
) -> None:
    session = db.session()

    def _fire() -> None:
        schedule_staged_dataset_sync(
            staged_dataset_id,
            job_type=job_type,
            incremental=incremental,
            prefer_immediate=prefer_immediate,
        )

    def _remove_listener(event_name: str, callback: Any) -> None:
        try:
            event.remove(session, event_name, callback)
        except Exception:  # pylint: disable=broad-except
            pass

    def _after_commit(_session: Any) -> None:
        try:
            _fire()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Deferred staged dataset sync scheduling failed for dataset id=%s",
                staged_dataset_id,
                exc_info=True,
            )
        finally:
            _remove_listener("after_rollback", _after_rollback)

    def _after_rollback(_session: Any) -> None:
        _remove_listener("after_commit", _after_commit)

    event.listen(session, "after_commit", _after_commit, once=True)
    event.listen(session, "after_rollback", _after_rollback, once=True)


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


# ---------------------------------------------------------------------------
# OU scope filter helper (Phase 8)
# ---------------------------------------------------------------------------


def _build_ou_filter_for_dataset(
    dataset: DHIS2StagedDataset,
) -> "dict[int, frozenset[str] | None] | None":
    """Build a per-instance OU allowlist for serving-table materialization.

    When the serving table is (re-)materialized we should only include staging
    rows for org units that are currently in the dataset's OU configuration.
    This prevents stale rows for removed OUs from showing up in charts.

    Returns
    -------
    None
        No filtering — all rows included (e.g. no instances configured).
    dict mapping instance_id to:
        ``None``           → user-relative markers only; include ALL rows for this instance.
        ``frozenset[str]`` → concrete OU UIDs; only include rows whose ``ou`` matches.

    If every instance resolves to user-relative markers only, returns ``None``
    (no OU filtering is possible).
    """
    instances = get_instances_with_legacy_fallback(dataset.database_id)
    if not instances:
        return None

    dataset_config = dataset.get_dataset_config() if hasattr(dataset, "get_dataset_config") else {}

    _USER_MARKERS = {
        "USER_ORGUNIT",
        "USER_ORGUNIT_CHILDREN",
        "USER_ORGUNIT_GRANDCHILDREN",
    }

    result: dict[int, frozenset[str] | None] = {}
    for instance in instances:
        try:
            resolved = DHIS2SyncService._resolve_org_units_for_instance(instance, dataset_config)
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "_build_ou_filter_for_dataset: could not resolve OUs for instance id=%d",
                instance.id,
                exc_info=True,
            )
            # Fallback: include all rows for this instance
            result[instance.id] = None
            continue

        concrete = frozenset(u for u in resolved if u not in _USER_MARKERS)
        user_only = all(u in _USER_MARKERS for u in resolved)

        if user_only or not concrete:
            result[instance.id] = None
        else:
            result[instance.id] = concrete

    # If ALL instances are user-relative-only, no OU filtering is meaningful
    if all(v is None for v in result.values()):
        return None
    return result
