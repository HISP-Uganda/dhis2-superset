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
Platform-wide settings for the local staging engine.

Stored in a single-row table ``local_staging_settings`` in Superset's metadata
database.  :meth:`LocalStagingSettings.get` always returns an instance; a
default row is created on first access if none exists.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import sqlalchemy as sa

from superset import db

logger = logging.getLogger(__name__)

# Engine identifier constants
ENGINE_SUPERSET_DB = "superset_db"
ENGINE_DUCKDB = "duckdb"
ENGINE_CLICKHOUSE = "clickhouse"

SUPPORTED_ENGINES = {ENGINE_SUPERSET_DB, ENGINE_DUCKDB, ENGINE_CLICKHOUSE}

# Default path for DuckDB staging file.  Can be overridden via
# the admin UI or DHIS2_DUCKDB_PATH environment variable.
DEFAULT_DUCKDB_PATH = "/var/lib/superset/dhis2_staging.duckdb"


class LocalStagingSettings(db.Model):  # type: ignore[name-defined]
    """Single-row table that stores the active engine configuration.

    The row with ``id=1`` is the canonical settings row.  All code should
    access settings via :meth:`get` rather than querying directly.
    """

    __tablename__ = "local_staging_settings"

    id = sa.Column(sa.Integer, primary_key=True, default=1)

    # Which engine is currently active.
    # DuckDB is the default: embedded, zero-infrastructure, accessible only
    # by the DHIS2 integration layer (not exposed in Superset's SQL Lab).
    active_engine = sa.Column(
        sa.String(50),
        nullable=False,
        default=ENGINE_DUCKDB,
        server_default=ENGINE_DUCKDB,
    )

    # DuckDB-specific config (JSON: {"db_path": "/data/dhis2_staging.duckdb"})
    duckdb_config = sa.Column(sa.Text, nullable=True)

    # ClickHouse-specific config (JSON: {"host", "port", "database", "user", "password", "secure"})
    clickhouse_config = sa.Column(sa.Text, nullable=True)

    # Retention policy (JSON — see retention.py for schema)
    retention_enabled = sa.Column(sa.Boolean, nullable=False, default=False)
    retention_config = sa.Column(sa.Text, nullable=True)

    # Last health-check result (JSON: {"ok": bool, "message": str, "checked_at": iso})
    engine_health_status = sa.Column(sa.Text, nullable=True)

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------

    def get_duckdb_config(self) -> dict[str, Any]:
        try:
            return json.loads(self.duckdb_config or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}

    def get_clickhouse_config(self) -> dict[str, Any]:
        try:
            return json.loads(self.clickhouse_config or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}

    def get_retention_config(self) -> dict[str, Any]:
        try:
            return json.loads(self.retention_config or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}

    def get_engine_health_status(self) -> dict[str, Any]:
        try:
            return json.loads(self.engine_health_status or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_duckdb_config(self, config: dict[str, Any]) -> None:
        self.duckdb_config = json.dumps(config)

    def set_clickhouse_config(self, config: dict[str, Any]) -> None:
        self.clickhouse_config = json.dumps(config)

    def set_retention_config(self, config: dict[str, Any]) -> None:
        self.retention_config = json.dumps(config)

    def set_engine_health_status(self, status: dict[str, Any]) -> None:
        self.engine_health_status = json.dumps(status)

    def to_dict(self) -> dict[str, Any]:
        from superset.local_staging.admin_tools import get_dependency_status

        dependency_status = get_dependency_status()
        return {
            "active_engine": self.active_engine,
            "duckdb_config": self.get_duckdb_config(),
            "clickhouse_config": self.get_clickhouse_config(),
            "retention_enabled": self.retention_enabled,
            "retention_config": self.get_retention_config(),
            "engine_health_status": self.get_engine_health_status(),
            "duckdb_available": bool(
                dependency_status.get(ENGINE_DUCKDB, {}).get("ready")
            ),
            "clickhouse_available": bool(
                dependency_status.get(ENGINE_CLICKHOUSE, {}).get("ready")
            ),
            "dependency_status": dependency_status,
        }

    # ------------------------------------------------------------------
    # Factory / singleton access
    # ------------------------------------------------------------------

    @classmethod
    def get(cls) -> "LocalStagingSettings":
        """Return the singleton settings row, creating it if absent."""
        import json as _json
        import os as _os

        row = db.session.get(cls, 1)
        if row is None:
            default_duckdb_path = (
                _os.environ.get("DHIS2_DUCKDB_PATH") or DEFAULT_DUCKDB_PATH
            )
            row = cls(
                id=1,
                active_engine=ENGINE_DUCKDB,
                duckdb_config=_json.dumps(
                    {"db_path": default_duckdb_path, "memory_limit": "1GB", "threads": 2}
                ),
            )
            db.session.add(row)
            try:
                db.session.commit()
            except Exception:  # pylint: disable=broad-except
                db.session.rollback()
                # Another worker may have created the row concurrently
                row = db.session.get(cls, 1) or cls(
                    id=1, active_engine=ENGINE_DUCKDB
                )
        return row

    @classmethod
    def get_active_engine_name(cls) -> str:
        """Return the active engine identifier without a full ORM load."""
        try:
            row = cls.get()
            return row.active_engine or ENGINE_DUCKDB
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "local_staging_settings table not accessible; defaulting to duckdb",
                exc_info=True,
            )
            return ENGINE_DUCKDB
