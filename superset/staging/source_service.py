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
"""Generic staged-source registry and capability helpers."""

from __future__ import annotations

from typing import Any

from superset import db
from superset.models.core import Database
from superset.staging.compat import ensure_dhis2_logical_database, ensure_staged_source
from superset.staging.models import DHIS2LogicalDatabase, StagedSource


def classify_database_source(database: Database) -> str:
    """Map a Superset database connection to a generic staged-source type."""

    return "dhis2" if database.backend == "dhis2" else "sql_database"


def get_database_staging_capabilities(database_id: int) -> dict[str, Any]:
    """Return staged-source capabilities for a Superset database."""

    database = db.session.get(Database, database_id)
    if database is None:
        raise ValueError(f"Database with id={database_id} not found")

    source_type = classify_database_source(database)
    return {
        "database_id": database.id,
        "database_name": database.database_name,
        "backend": database.backend,
        "source_type": source_type,
        "staging_supported": True,
        "builder_mode": "dhis2_federated"
        if source_type == "dhis2"
        else "sql_table",
        "requires_instance_selection": False,
        "supports_connection_scoping": source_type == "dhis2",
        "supports_live_browse": True,
        "supports_background_refresh": True,
        "background_refresh_forced": True,
    }


def get_source_for_database(database_id: int) -> StagedSource | None:
    """Return the registered staged-source row for a database if it exists."""

    database = db.session.get(Database, database_id)
    if database is None:
        raise ValueError(f"Database with id={database_id} not found")

    source_type = classify_database_source(database)
    if source_type == "dhis2":
        logical_database = (
            db.session.query(DHIS2LogicalDatabase)
            .filter(DHIS2LogicalDatabase.database_id == database_id)
            .one_or_none()
        )
        if logical_database is None:
            return None
        return db.session.get(StagedSource, logical_database.staged_source_id)

    return (
        db.session.query(StagedSource)
        .filter(
            StagedSource.source_type == source_type,
            StagedSource.source_connection_id == database_id,
        )
        .order_by(StagedSource.id.asc())
        .first()
    )


def ensure_source_for_database(database_id: int) -> tuple[StagedSource, dict[str, Any]]:
    """Ensure the staged-source row exists for a database and return capabilities."""

    database = db.session.get(Database, database_id)
    if database is None:
        raise ValueError(f"Database with id={database_id} not found")

    capabilities = get_database_staging_capabilities(database_id)
    source_type = capabilities["source_type"]

    if source_type == "dhis2":
        logical_database = ensure_dhis2_logical_database(
            database_id,
            source_name=database.database_name,
            description=f"Federated DHIS2 logical database for {database.database_name}",
        )
        source = db.session.get(StagedSource, logical_database.staged_source_id)
        if source is None:
            raise ValueError(
                f"Failed to resolve staged source for DHIS2 database id={database_id}"
            )
        return source, capabilities

    source = ensure_staged_source(
        source_type=source_type,
        source_connection_id=database.id,
        source_name=database.database_name,
        connection_key=f"db:{database.id}",
        config={
            "database_id": database.id,
            "database_backend": database.backend,
        },
    )
    return source, capabilities


def list_sources(*, include_inactive: bool = False) -> list[StagedSource]:
    """List generic staged-source rows."""

    query = db.session.query(StagedSource)
    if not include_inactive:
        query = query.filter(StagedSource.is_active.is_(True))
    return query.order_by(StagedSource.source_type.asc(), StagedSource.source_name.asc()).all()
