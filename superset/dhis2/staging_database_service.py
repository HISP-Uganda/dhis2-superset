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
"""Helpers for resolving the local SQL database used to serve staged DHIS2 data."""

from __future__ import annotations

from flask import current_app

from superset import db
from superset.utils.database import get_or_create_db

DEFAULT_STAGING_DATABASE_NAME = "DHIS2 Local Staging"


def _get_duckdb_serving_uri() -> str | None:
    """Return a DuckDB SQLAlchemy URI if DuckDB is the active staging engine."""
    try:
        import os
        from superset.local_staging.platform_settings import (
            ENGINE_DUCKDB,
            LocalStagingSettings,
        )

        if LocalStagingSettings.get_active_engine_name() != ENGINE_DUCKDB:
            return None
        settings = LocalStagingSettings.get()
        config = settings.get_duckdb_config()
        db_path = config.get("db_path", "")
        if not db_path:
            return None
        return f"duckdb:///{os.path.abspath(db_path)}"
    except Exception:  # pylint: disable=broad-except
        return None


def get_staging_database(always_create: bool = True):
    """Return the Superset ``Database`` used to serve staged DHIS2 tables.

    Priority:
    1. Explicit ``DHIS2_STAGING_DATABASE_URI`` / ``DHIS2_STAGING_DATABASE_NAME`` config.
    2. Auto-detected DuckDB URI when the active staging engine is DuckDB.
    3. Fallback to the Superset metadata database (``SQLALCHEMY_DATABASE_URI``).
    """

    metadata_uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    configured_uri = str(
        current_app.config.get("DHIS2_STAGING_DATABASE_URI") or ""
    ).strip()
    configured_name = str(
        current_app.config.get("DHIS2_STAGING_DATABASE_NAME") or ""
    ).strip()

    # Auto-detect DuckDB when no explicit config is provided
    if not configured_uri and not configured_name:
        duckdb_uri = _get_duckdb_serving_uri()
        if duckdb_uri:
            configured_uri = duckdb_uri
            configured_name = DEFAULT_STAGING_DATABASE_NAME

    database_name = configured_name or (
        DEFAULT_STAGING_DATABASE_NAME if configured_uri else "main"
    )
    sqlalchemy_uri = configured_uri or metadata_uri

    from superset.models.core import Database as _Database  # avoid top-level circular

    already_exists = (
        db.session.query(_Database).filter_by(database_name=database_name).first()
        is not None
    )

    database = get_or_create_db(
        database_name,
        sqlalchemy_uri,
        always_create=always_create,
    )
    if database is None:
        return None

    is_new = not already_exists

    if configured_uri or configured_name:
        desired_expose_in_sqllab = bool(
            current_app.config.get("DHIS2_STAGING_DATABASE_EXPOSE_IN_SQLLAB", False)
        )
        changed = False
        if database.expose_in_sqllab != desired_expose_in_sqllab:
            database.expose_in_sqllab = desired_expose_in_sqllab
            changed = True
        if database.allow_ctas:
            database.allow_ctas = False
            changed = True
        if database.allow_cvas:
            database.allow_cvas = False
            changed = True
        if database.allow_dml:
            database.allow_dml = False
            changed = True
        if changed:
            db.session.flush()

    # Commit immediately so the new DB entry survives any subsequent
    # exception/rollback in the calling request handler.
    if is_new:
        try:
            db.session.commit()
        except Exception:  # pylint: disable=broad-except
            db.session.rollback()

    return database
