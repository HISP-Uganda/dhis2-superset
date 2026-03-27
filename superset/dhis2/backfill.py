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
"""Backward-compatibility backfill for DHIS2 staging/serving tables.

Runs **once at startup** (inside the Flask app context) to bring existing
datasets created by earlier versions of the code fully up-to-date without
any data loss or table rebuilds.

Three operations per dataset
----------------------------
1. **Add missing serving-table indexes** — uses ``_create_serving_index``
   (silent no-op if the index already exists) so old tables gain the same
   performance indexes that newly-built tables receive.

2. **Refresh query-planner statistics** — calls ``_run_analyze`` so the
   database chooses optimal execution plans immediately after upgrade.

3. **Re-register the serving table as a Superset SqlaTable** — the
   idempotent ``register_serving_table_as_superset_dataset`` call ensures:

   * ``dhis2_staged_dataset_id`` is present in ``SqlaTable.extra`` (required
     for the native-filter routing added in this release).
   * ``TableColumn.extra`` carries all current DHIS2 metadata flags
     (``dhis2_is_period``, ``dhis2_is_ou_hierarchy``, etc.) so the frontend
     can render hierarchy-aware filter controls without waiting for the next
     manual sync.

Idempotency
-----------
Every sub-operation is safe to run multiple times:
* ``CREATE INDEX IF NOT EXISTS`` / per-index try-except → no-op on re-run.
* ``ANALYZE`` → updates statistics, harmless on re-run.
* ``register_serving_table_as_superset_dataset`` checks for an existing
  ``SqlaTable`` record and only patches what is missing.

The backfill is intentionally non-fatal: a failure for one dataset is logged
and skipped; the remaining datasets continue to be processed.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy.exc import OperationalError as _SAOperationalError

logger = logging.getLogger(__name__)

# Column names that are always indexed regardless of extra metadata
_ALWAYS_INDEX: frozenset[str] = frozenset({"period", "dhis2_instance"})

# Known OU hierarchy column names (used to classify physical columns)
_OU_HIERARCHY_NAMES: frozenset[str] = frozenset({
    "national", "region", "district_city", "dlg_municipality_city_council",
    "sub_county_town_council_division", "health_facility", "ward_department",
    "ou_name", "organisation_unit",
})
_OU_LEVEL_NAMES: frozenset[str] = frozenset({"ou_level", "level"})
_PERIOD_NAMES: frozenset[str] = frozenset({"period"})
_INTERNAL_NAMES: frozenset[str] = frozenset({"dhis2_instance", "_manifest_build_v5"})


def _sanitize_for_column(value: str) -> str:
    """Replicate analytical_serving.sanitize_serving_identifier logic."""
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        return "column"
    if sanitized[0].isdigit():
        sanitized = f"c_{sanitized}"
    return sanitized.lower()


def _build_variable_type_lookup() -> dict[str, str]:
    """Build column-name → dhis2_variable_type mapping from metadata cache.

    Loads cached DHIS2 metadata snapshots (dataElements, indicators,
    programIndicators, eventDataItems, dataSets) and reverses the
    sanitize_serving_identifier transform to map each item's display name
    to the expected column name.  Returns ``{}`` on any error.
    """
    try:
        from superset import db  # pylint: disable=import-outside-toplevel
        from sqlalchemy import text  # pylint: disable=import-outside-toplevel

        type_map: dict[str, str] = {}
        ns_to_type = {
            "dhis2_snapshot:dataElements": "dataElement",
            "dhis2_snapshot:indicators": "indicator",
            "dhis2_snapshot:programIndicators": "programIndicator",
            "dhis2_snapshot:eventDataItems": "eventDataItem",
            "dhis2_snapshot:dataSets": "dataSet",
        }
        for ns, vtype in ns_to_type.items():
            rows = db.session.execute(
                text("SELECT metadata_json FROM source_metadata_cache "
                     "WHERE cache_namespace = :ns"),
                {"ns": ns},
            ).fetchall()
            for cache_row in rows:
                try:
                    payload = json.loads(cache_row[0])
                    items = payload.get("result") or []
                    for item in items:
                        name = item.get("name") or item.get("displayName") or ""
                        if not name:
                            continue
                        col_name = _sanitize_for_column(name)
                        if col_name and col_name not in type_map:
                            type_map[col_name] = vtype
                        # Also try shortName
                        short = item.get("shortName") or ""
                        if short and short != name:
                            col_short = _sanitize_for_column(short)
                            if col_short and col_short not in type_map:
                                type_map[col_short] = vtype
                except Exception:  # pylint: disable=broad-except
                    continue
        return type_map
    except Exception:  # pylint: disable=broad-except
        return {}


def _supplement_columns_from_physical(
    manifest_columns: list[dict[str, Any]],
    physical_cols: set[str],
    engine: Any,
    dataset: Any,
) -> list[dict[str, Any]]:
    """Add basic column specs for physical columns absent from the manifest.

    When DHIS2DatasetVariable records are missing, the manifest only contains
    OU hierarchy + period columns.  This function adds minimal specs for all
    other physical columns so SqlaTable registration does not remove them.

    Variable-type tags (DE/IN etc.) are recovered from the metadata cache
    where possible.
    """
    manifest_names = {str(c.get("column_name") or "") for c in manifest_columns}
    missing = [col for col in physical_cols if col not in manifest_names]
    if not missing:
        return manifest_columns

    # Build variable-type lookup lazily
    type_map = _build_variable_type_lookup()

    # Fetch ClickHouse column types for the serving table
    ch_type_map: dict[str, str] = {}
    try:
        serving_name = engine.get_serving_table_name(dataset)
        result = engine._qry(  # pylint: disable=protected-access
            "SELECT name, type FROM system.columns "
            "WHERE database = {db:String} AND table = {tbl:String} "
            "ORDER BY position",
            parameters={"db": engine._serving_database, "tbl": serving_name},  # pylint: disable=protected-access
        )
        ch_type_map = {r[0]: r[1] for r in result.result_rows}
    except Exception:  # pylint: disable=broad-except
        pass

    supplemented = list(manifest_columns)
    for col_name in missing:
        if col_name in _INTERNAL_NAMES:
            continue  # skip internal/marker columns

        ch_type = ch_type_map.get(col_name, "")
        is_numeric = any(t in ch_type for t in ("Float", "Int", "Decimal", "Numeric"))

        col_spec: dict[str, Any] = {
            "column_name": col_name,
            "verbose_name": col_name.replace("_", " ").title(),
            "type": "FLOAT" if is_numeric else "STRING",
            "is_dttm": False,
        }

        if col_name in _PERIOD_NAMES:
            col_spec["type"] = "STRING"
            col_spec["extra"] = {"dhis2_is_period": True}
        elif col_name in _OU_LEVEL_NAMES:
            col_spec["type"] = "INTEGER"
            col_spec["extra"] = {"dhis2_is_ou_level": True}
        elif col_name in _OU_HIERARCHY_NAMES or (
            not is_numeric and col_name not in _PERIOD_NAMES
        ):
            col_spec["type"] = "STRING"
            col_spec["extra"] = {"dhis2_is_ou_hierarchy": True}
        elif is_numeric:
            # Metric column — try to recover variable type from cache
            vtype = type_map.get(col_name)
            if vtype:
                col_spec["extra"] = {"dhis2_variable_type": vtype}

        supplemented.append(col_spec)

    logger.debug(
        "compat_backfill: supplemented %d columns from physical table for dataset id=%s",
        len(supplemented) - len(manifest_columns),
        dataset.id,
    )
    return supplemented


def _col_should_be_indexed(col_spec: dict[str, Any]) -> bool:
    """Return True if this column deserves a serving-table index."""
    col_name: str = str(col_spec.get("column_name") or "")
    if col_name in _ALWAYS_INDEX:
        return True

    raw_extra = col_spec.get("extra") or {}
    if isinstance(raw_extra, str):
        try:
            raw_extra = json.loads(raw_extra)
        except Exception:  # pylint: disable=broad-except
            raw_extra = {}

    return bool(
        raw_extra.get("dhis2_is_period")
        or raw_extra.get("dhis2_is_ou_hierarchy")
        or raw_extra.get("dhis2_is_dimension")
    )


def _backfill_one_dataset(
    dataset: Any,
    engine: Any,
    manifest_columns: list[dict[str, Any]],
) -> None:
    """Backfill indexes, statistics, and SqlaTable registration for one dataset."""
    from superset import db  # pylint: disable=import-outside-toplevel
    from superset.dhis2.analytical_serving import (  # pylint: disable=import-outside-toplevel
        dataset_columns_payload,
    )
    from superset.dhis2.superset_dataset_service import (  # pylint: disable=import-outside-toplevel
        register_serving_table_as_superset_dataset,
    )

    full_name = engine.get_serving_sql_table_ref(dataset)
    table_name = engine.get_serving_table_name(dataset)

    # ------------------------------------------------------------------
    # 1 + 2. Indexes + ANALYZE — Postgres/DHIS2StagingEngine only
    # DuckDB and ClickHouse engines do not expose these private helpers.
    # ------------------------------------------------------------------
    if hasattr(engine, "_dialect_name"):
        try:
            dialect = engine._dialect_name  # pylint: disable=protected-access
            with db.engine.connect() as conn:
                engine.apply_connection_optimizations(conn, dialect)

                for col_spec in manifest_columns:
                    col_name = str(col_spec.get("column_name") or "")
                    if not col_name:
                        continue
                    if _col_should_be_indexed(col_spec):
                        engine._create_serving_index(  # pylint: disable=protected-access
                            conn, table_name, full_name, col_name
                        )

                engine._run_analyze(conn, full_name)  # pylint: disable=protected-access
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "compat_backfill: index/analyze step failed for dataset id=%s",
                dataset.id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 3. Re-register SqlaTable (idempotent — patches missing fields only)
    # ------------------------------------------------------------------
    # Use the engine's canonical serving Database (DuckDB/ClickHouse) not the
    # DHIS2 source database stored in engine.database_id.
    if hasattr(engine, "get_or_create_superset_database"):
        try:
            _sdb = engine.get_or_create_superset_database()
            serving_db_id = getattr(_sdb, "id", None)
        except Exception:  # pylint: disable=broad-except
            serving_db_id = getattr(engine, "database_id", None)
    else:
        serving_db_id = getattr(engine, "database_id", None)
    if serving_db_id is None:
        return

    try:
        from superset.dhis2.superset_dataset_service import (  # pylint: disable=import-outside-toplevel
            register_specialized_marts_as_superset_datasets,
        )
        serving_cols = dataset_columns_payload(manifest_columns)

        # Derive mart table ref for this dataset
        mart_table_name = f"{table_name}_mart"
        has_mart = (
            hasattr(engine, "named_table_exists_in_serving")
            and engine.named_table_exists_in_serving(mart_table_name)
        )
        if has_mart:
            # Register/update mart record (MART_DATASET role, sql → _mart table)
            register_specialized_marts_as_superset_datasets(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=full_name,
                serving_columns=serving_cols,
                serving_database_id=serving_db_id,
                engine=engine,
                dataset=dataset,
            )
        else:
            # No mart yet — just register the base record without overwriting role
            register_serving_table_as_superset_dataset(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=full_name,
                serving_columns=serving_cols,
                serving_database_id=serving_db_id,
            )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "compat_backfill: SqlaTable re-registration failed for dataset id=%s",
            dataset.id,
            exc_info=True,
        )


def run_compatibility_backfill() -> None:
    """Entry point called once at application startup.

    Iterates every ``DHIS2StagedDataset`` that already has a serving table and
    runs the three backfill steps described in the module docstring.  Datasets
    whose serving tables do not yet exist are skipped — they will be built
    correctly when the next sync runs.
    """
    try:
        from superset import db  # pylint: disable=import-outside-toplevel
        from superset.dhis2.analytical_serving import (  # pylint: disable=import-outside-toplevel
            build_serving_manifest,
        )
        from superset.dhis2.models import DHIS2StagedDataset  # pylint: disable=import-outside-toplevel
        from superset.local_staging.engine_factory import (  # pylint: disable=import-outside-toplevel
            get_active_staging_engine,
        )

        # Clear any dirty session state left by alembic DDL operations so the
        # query below gets a clean transaction.
        try:
            db.session.rollback()
        except Exception:  # pylint: disable=broad-except
            pass

        datasets = db.session.query(DHIS2StagedDataset).all()
    except _SAOperationalError as _oe:
        # ORM model references columns not yet added by a pending migration
        # (e.g. warehouse extension columns).  Skip silently — the next
        # 'superset db upgrade' run will apply those columns and this
        # backfill will succeed on the following startup.
        logger.debug(
            "compat_backfill: schema not fully migrated yet — skipping. "
            "Run 'superset db upgrade' to apply pending migrations. "
            "Detail: %s",
            _oe,
            exc_info=True,
        )
        return
    except Exception:  # pylint: disable=broad-except
        logger.warning("compat_backfill: could not load datasets — skipping", exc_info=True)
        return

    processed = skipped = errors = 0

    # Suppress noisy urllib3/clickhouse_connect WARNING logs that fire when the
    # staging engine (e.g. ClickHouse) is not yet reachable during db upgrade/init.
    # We handle those cases gracefully below; the library warnings are redundant.
    import logging as _logging  # pylint: disable=import-outside-toplevel
    _urllib3_logger = _logging.getLogger("urllib3.connectionpool")
    _ch_logger = _logging.getLogger("clickhouse_connect.driver.httpclient")
    _urllib3_prev = _urllib3_logger.level
    _ch_prev = _ch_logger.level
    _urllib3_logger.setLevel(_logging.ERROR)
    _ch_logger.setLevel(_logging.ERROR)

    for dataset in datasets:
        try:
            engine = get_active_staging_engine(dataset.database_id)

            if not engine.serving_table_exists(dataset):
                skipped += 1
                continue

            manifest = build_serving_manifest(dataset)
            all_columns: list[dict[str, Any]] = manifest.get("columns") or []

            # Filter to only columns that physically exist in the serving table.
            # Empty OU hierarchy columns may have been pruned at sync time;
            # registering them would add non-existent columns to the SqlaTable.
            physical_cols = set(engine.get_serving_table_columns(dataset))
            columns = (
                [c for c in all_columns if str(c.get("column_name") or "") in physical_cols]
                if physical_cols
                else all_columns
            )

            # When DHIS2DatasetVariable records are absent, the manifest only
            # has OU hierarchy + period columns.  Supplement with all remaining
            # physical columns so SqlaTable registration does not strip metric
            # columns — recovering dhis2_variable_type from metadata cache.
            has_variable_columns = any(c.get("variable_id") for c in columns)
            if not has_variable_columns and physical_cols:
                columns = _supplement_columns_from_physical(
                    columns, physical_cols, engine, dataset
                )

            _backfill_one_dataset(dataset, engine, columns)
            processed += 1

        except Exception as exc:  # pylint: disable=broad-except
            # Connection-refused means the staging engine (e.g. ClickHouse) is not
            # yet running when backfill executes during `db upgrade` / `init`.
            # This is expected — log at INFO only and do not count as an error.
            exc_str = str(exc)
            
            # Handle both network connectivity errors and partial database migrations
            # (where the model has columns not yet added to the actual database table).
            is_unreachable = "Connection refused" in exc_str or "NewConnectionError" in exc_str or "Max retries exceeded" in exc_str
            is_not_migrated = "UndefinedColumn" in exc_str or "ProgrammingError" in exc_str
            
            if is_unreachable or is_not_migrated:
                skipped += 1
                if is_unreachable:
                    logger.info(
                        "compat_backfill: staging engine not reachable for dataset id=%s — will retry on next startup",
                        dataset.id,
                    )
                else:
                    logger.info(
                        "compat_backfill: database schema not fully migrated for dataset id=%s — skipping for now",
                        dataset.id,
                    )
            else:
                errors += 1
                logger.warning(
                    "compat_backfill: unexpected error for dataset id=%s — skipping",
                    dataset.id,
                    exc_info=True,
                )

    # Restore log levels after the dataset loop
    _urllib3_logger.setLevel(_urllib3_prev)
    _ch_logger.setLevel(_ch_prev)

    # Ensure the DuckDB Superset Database record has read_only=True connect args
    # so chart queries don't compete for the write lock with the staging engine.
    try:
        from superset.local_staging.engine_factory import (  # pylint: disable=import-outside-toplevel
            get_active_staging_engine,
        )
        _probe_engine = get_active_staging_engine(0)
        if hasattr(_probe_engine, "get_or_create_superset_database"):
            _probe_engine.get_or_create_superset_database()
    except Exception:  # pylint: disable=broad-except
        logger.debug("compat_backfill: could not patch DuckDB database read_only — skipping", exc_info=True)

    # Commit any pending SqlaTable changes accumulated during registration
    try:
        from superset import db as _db  # pylint: disable=import-outside-toplevel
        _db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.warning("compat_backfill: final commit failed", exc_info=True)

    logger.info(
        "compat_backfill: complete — processed=%d skipped=%d errors=%d",
        processed,
        skipped,
        errors,
    )
