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
"""Shared serving-table build helpers for DHIS2 staged datasets."""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from superset.dhis2.analytical_serving import (
    build_serving_manifest,
    dataset_columns_payload,
    materialize_serving_rows,
    prune_empty_hierarchy_columns,
)
from superset.local_staging.engine_factory import get_active_staging_engine

logger = logging.getLogger(__name__)


class ServingBuildValidationError(RuntimeError):
    """Raised when a serving build produces an invalid result."""


@dataclass(frozen=True)
class ServingBuildResult:
    serving_table_ref: str
    serving_columns: list[dict[str, Any]]
    diagnostics: dict[str, Any]


def _serving_row_count(engine: Any, dataset: Any) -> int | None:
    try:
        result = engine.query_serving_table(
            dataset,
            selected_columns=[],
            filters=None,
            limit=1,
            page=1,
            count_rows=True,
        )
    except Exception:  # pylint: disable=broad-except
        return None
    try:
        return int(result.get("total_rows") or 0)
    except (TypeError, ValueError, AttributeError):
        return None


def build_serving_table(
    dataset: Any,
    *,
    engine: Any | None = None,
    refresh_scope: Iterable[str] | None = None,
) -> ServingBuildResult:
    """Build and validate the canonical ``sv_*`` table for *dataset*."""
    resolved_engine = engine or get_active_staging_engine(dataset.database_id)

    if resolved_engine.engine_name == "clickhouse":
        from superset.dhis2.clickhouse_build_service import (
            build_serving_table_clickhouse,
        )

        return build_serving_table_clickhouse(
            dataset, engine=resolved_engine, refresh_scope=refresh_scope
        )

    manifest = build_serving_manifest(dataset)

    from superset.dhis2.sync_service import _build_ou_filter_for_dataset

    ou_filter = _build_ou_filter_for_dataset(dataset)
    source_row_count = 0
    source_periods: set[str] = set()

    def _tracked_raw_rows() -> Any:
        nonlocal source_row_count
        for raw_row in resolved_engine.fetch_staging_rows(
            dataset,
            limit=0,
            ou_filter=ou_filter,
        ):
            source_row_count += 1
            period_value = str(raw_row.get("pe") or "").strip()
            if period_value:
                source_periods.add(period_value)
            yield raw_row

    serving_columns, serving_rows = materialize_serving_rows(
        dataset,
        _tracked_raw_rows(),
        manifest,
    )
    serving_columns, serving_rows = prune_empty_hierarchy_columns(
        serving_columns,
        serving_rows,
    )

    required_columns = [
        str(column.get("column_name") or "").strip()
        for column in list(serving_columns or [])
        if str(column.get("column_name") or "").strip()
    ]
    if not required_columns:
        raise ServingBuildValidationError(
            f"Serving manifest for dataset id={dataset.id} produced no columns"
        )

    serving_row_count = len(serving_rows)
    if source_row_count > 0 and serving_row_count == 0:
        raise ServingBuildValidationError(
            "Serving build produced zero rows from a non-empty staging source"
        )

    resolved_engine.create_or_replace_serving_table(
        dataset,
        columns=serving_columns,
        rows=serving_rows,
    )

    actual_row_count = _serving_row_count(resolved_engine, dataset)
    if source_row_count > 0 and actual_row_count == 0:
        raise ServingBuildValidationError(
            "Serving promotion completed but the live serving table is empty"
        )

    diagnostics = {
        "source_row_count": source_row_count,
        "serving_row_count": serving_row_count,
        "live_serving_row_count": actual_row_count,
        "selected_serving_columns": required_columns,
        "source_period_count": len(source_periods),
        "source_period_sample": sorted(source_periods)[:10],
        "preview_row_count": min(serving_row_count, 1),
        "preview_sample": serving_rows[:1],
        "org_unit_hierarchy": manifest.get("org_unit_hierarchy_diagnostics") or {},
        "period_hierarchy": manifest.get("period_hierarchy_diagnostics") or {},
        "staging_table_ref": resolved_engine.get_superset_sql_table_ref(dataset),
        "serving_table_ref": resolved_engine.get_serving_sql_table_ref(dataset),
    }
    logger.info(
        "Serving build complete for dataset id=%s source_rows=%s serving_rows=%s live_rows=%s",
        getattr(dataset, "id", None),
        source_row_count,
        serving_row_count,
        actual_row_count,
    )
    return ServingBuildResult(
        serving_table_ref=resolved_engine.get_serving_sql_table_ref(dataset),
        serving_columns=dataset_columns_payload(serving_columns),
        diagnostics=diagnostics,
    )
