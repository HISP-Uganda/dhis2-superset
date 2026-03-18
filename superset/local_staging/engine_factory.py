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
Engine factory for the local staging subsystem.

Call :func:`get_active_staging_engine` anywhere you previously instantiated
:class:`~superset.dhis2.staging_engine.DHIS2StagingEngine` directly::

    # Before
    engine = DHIS2StagingEngine(database_id)

    # After
    from superset.local_staging.engine_factory import get_active_staging_engine
    engine = get_active_staging_engine(database_id)

The returned object satisfies the full
:class:`~superset.local_staging.base_engine.LocalStagingEngineBase` interface,
so all existing call sites work without further changes.
"""

from __future__ import annotations

import logging
from typing import Any

from superset.local_staging.base_engine import LocalStagingEngineBase
from superset.local_staging.exceptions import EngineNotSupportedError
from superset.local_staging.platform_settings import (
    ENGINE_CLICKHOUSE,
    ENGINE_DUCKDB,
    ENGINE_SUPERSET_DB,
    LocalStagingSettings,
)

logger = logging.getLogger(__name__)


def get_active_staging_engine(database_id: int) -> LocalStagingEngineBase:
    """Return the currently configured staging engine for *database_id*.

    The active engine is determined by reading ``local_staging_settings``.
    If the table does not yet exist (first-time setup before the migration has
    run) or any other error occurs, falls back silently to the
    :class:`~superset.local_staging.superset_db_engine.SupersetDBStagingEngine`.

    Args:
        database_id: The Superset ``Database`` PK that owns the staged datasets
            being processed.  Passed through to the engine for audit purposes.

    Returns:
        A :class:`LocalStagingEngineBase` instance.
    """
    try:
        engine_name = LocalStagingSettings.get_active_engine_name()
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Could not read local_staging_settings; defaulting to duckdb",
            exc_info=True,
        )
        engine_name = ENGINE_DUCKDB

    if engine_name == ENGINE_SUPERSET_DB:
        from superset.local_staging.superset_db_engine import SupersetDBStagingEngine

        return SupersetDBStagingEngine(database_id)

    if engine_name == ENGINE_DUCKDB:
        from superset.local_staging.duckdb_engine import DuckDBStagingEngine

        try:
            settings = LocalStagingSettings.get()
            config = settings.get_duckdb_config()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Could not read DuckDB config; defaulting to superset_db",
                exc_info=True,
            )
            from superset.local_staging.superset_db_engine import (
                SupersetDBStagingEngine,
            )

            return SupersetDBStagingEngine(database_id)
        return DuckDBStagingEngine(database_id, config)

    if engine_name == ENGINE_CLICKHOUSE:
        from superset.local_staging.clickhouse_engine import ClickHouseStagingEngine

        try:
            settings = LocalStagingSettings.get()
            config = settings.get_clickhouse_config()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Could not read ClickHouse config; defaulting to superset_db",
                exc_info=True,
            )
            from superset.local_staging.superset_db_engine import (
                SupersetDBStagingEngine,
            )

            return SupersetDBStagingEngine(database_id)
        return ClickHouseStagingEngine(database_id, config)

    raise EngineNotSupportedError(
        f"Unknown local staging engine: {engine_name!r}. "
        f"Supported values: {ENGINE_SUPERSET_DB}, {ENGINE_DUCKDB}, {ENGINE_CLICKHOUSE}"
    )


def get_engine_health_status() -> dict[str, Any]:
    """Run a health check against the active engine and return the result dict."""
    try:
        engine = get_active_staging_engine(0)
        status = engine.health_check()
    except Exception as exc:  # pylint: disable=broad-except
        status = {"ok": False, "message": str(exc)}

    # Persist result for the admin UI to display without re-running the check
    try:
        import json
        from datetime import datetime, timezone

        status["checked_at"] = datetime.now(timezone.utc).isoformat()
        settings = LocalStagingSettings.get()
        settings.set_engine_health_status(status)
        from superset import db

        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        pass

    return status
