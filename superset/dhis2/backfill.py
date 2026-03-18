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
from typing import Any

from sqlalchemy.exc import OperationalError as _SAOperationalError

logger = logging.getLogger(__name__)

# Column names that are always indexed regardless of extra metadata
_ALWAYS_INDEX: frozenset[str] = frozenset({"period", "dhis2_instance"})


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
        serving_cols = dataset_columns_payload(manifest_columns)
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

            _backfill_one_dataset(dataset, engine, columns)
            processed += 1

        except Exception:  # pylint: disable=broad-except
            errors += 1
            logger.warning(
                "compat_backfill: unexpected error for dataset id=%s — skipping",
                dataset.id,
                exc_info=True,
            )

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

    if processed or errors:
        logger.info(
            "compat_backfill: complete — processed=%d skipped=%d errors=%d",
            processed,
            skipped,
            errors,
        )
