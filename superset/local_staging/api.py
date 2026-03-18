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
REST API for the local staging engine admin UI.

Endpoints
---------
GET  /api/v1/local-staging/settings          — read current settings
PUT  /api/v1/local-staging/settings          — update settings
POST /api/v1/local-staging/test-connection   — test active (or submitted) config
GET  /api/v1/local-staging/status            — last health-check result
POST /api/v1/local-staging/health-check      — run a fresh health check
"""

from __future__ import annotations

import logging
from typing import Any

from flask import Blueprint, jsonify, request
from flask_appbuilder.api import expose, protect, safe
from marshmallow import Schema, ValidationError, fields, validate

from superset import db
from superset.local_staging.engine_factory import (
    get_active_staging_engine,
    get_engine_health_status,
)
from superset.local_staging.platform_settings import (
    ENGINE_CLICKHOUSE,
    ENGINE_DUCKDB,
    ENGINE_SUPERSET_DB,
    LocalStagingSettings,
)
from superset.views.base_api import BaseSupersetApi

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Marshmallow schemas
# ------------------------------------------------------------------


class DuckDBConfigSchema(Schema):
    db_path = fields.Str(required=True)
    memory_limit = fields.Str(load_default="1GB")
    threads = fields.Int(load_default=2)


class ClickHouseConfigSchema(Schema):
    host = fields.Str(required=True)
    port = fields.Int(load_default=9000)
    database = fields.Str(load_default="dhis2_staging")
    user = fields.Str(load_default="default")
    password = fields.Str(load_default="")
    secure = fields.Bool(load_default=False)
    verify = fields.Bool(load_default=True)
    connect_timeout = fields.Int(load_default=10)
    send_receive_timeout = fields.Int(load_default=300)


class RetentionConfigSchema(Schema):
    max_age_days = fields.Int(load_default=None, allow_none=True)
    max_versions = fields.Int(load_default=None, allow_none=True)
    max_size_gb = fields.Float(load_default=None, allow_none=True)


class LocalStagingSettingsSchema(Schema):
    active_engine = fields.Str(
        required=False,
        validate=validate.OneOf([ENGINE_SUPERSET_DB, ENGINE_DUCKDB, ENGINE_CLICKHOUSE]),
    )
    duckdb_config = fields.Dict(load_default=None, allow_none=True)
    clickhouse_config = fields.Dict(load_default=None, allow_none=True)
    retention_enabled = fields.Bool(load_default=False)
    retention_config = fields.Dict(load_default=None, allow_none=True)


# ------------------------------------------------------------------
# Blueprint / view
# ------------------------------------------------------------------


class LocalStagingRestApi(BaseSupersetApi):
    resource_name = "local-staging"
    allow_browser_login = True

    @expose("/settings", methods=["GET"])
    @protect()
    @safe
    def get_settings(self) -> Any:
        """Return the current local staging settings.
        ---
        get:
          summary: Get local staging engine settings
          responses:
            200:
              description: Current settings
        """
        try:
            settings = LocalStagingSettings.get()
            return self.response(200, result=settings.to_dict())
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Error reading local staging settings")
            return self.response_500(message=str(ex))

    @expose("/settings", methods=["PUT"])
    @protect()
    @safe
    def update_settings(self) -> Any:
        """Update local staging engine settings.
        ---
        put:
          summary: Update local staging engine settings
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/LocalStagingSettingsSchema'
          responses:
            200:
              description: Updated settings
        """
        try:
            body = request.json or {}
            schema = LocalStagingSettingsSchema()
            data = schema.load(body)
        except ValidationError as err:
            return self.response_400(message=str(err.messages))

        try:
            settings = LocalStagingSettings.get()
            if "active_engine" in data:
                settings.active_engine = data["active_engine"]
            if "duckdb_config" in data and data["duckdb_config"] is not None:
                settings.set_duckdb_config(data["duckdb_config"])
            if "clickhouse_config" in data and data["clickhouse_config"] is not None:
                settings.set_clickhouse_config(data["clickhouse_config"])
            if "retention_enabled" in data:
                settings.retention_enabled = data["retention_enabled"]
            if "retention_config" in data and data["retention_config"] is not None:
                settings.set_retention_config(data["retention_config"])
            db.session.commit()
            return self.response(200, result=settings.to_dict())
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            logger.exception("Error updating local staging settings")
            return self.response_500(message=str(ex))

    @expose("/status", methods=["GET"])
    @protect()
    @safe
    def get_status(self) -> Any:
        """Return the last engine health-check result (cached).
        ---
        get:
          summary: Get last engine health-check result
          responses:
            200:
              description: Health status
        """
        try:
            settings = LocalStagingSettings.get()
            return self.response(200, result=settings.get_engine_health_status())
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_500(message=str(ex))

    @expose("/health-check", methods=["POST"])
    @protect()
    @safe
    def run_health_check(self) -> Any:
        """Run a live health check against the active engine.
        ---
        post:
          summary: Run a live engine health check
          responses:
            200:
              description: Health status result
        """
        try:
            status = get_engine_health_status()
            return self.response(200, result=status)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Health check failed")
            return self.response_500(message=str(ex))

    @expose("/test-connection", methods=["POST"])
    @protect()
    @safe
    def test_connection(self) -> Any:
        """Test connectivity using the submitted (unsaved) config.

        Useful for validating DuckDB path / ClickHouse credentials before saving.
        ---
        post:
          summary: Test engine connection with submitted config
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    engine:
                      type: string
                    config:
                      type: object
          responses:
            200:
              description: Connection test result
        """
        try:
            body = request.json or {}
            engine_name = body.get("engine", ENGINE_SUPERSET_DB)
            config = body.get("config", {})

            if engine_name == ENGINE_SUPERSET_DB:
                from superset.local_staging.superset_db_engine import (
                    SupersetDBStagingEngine,
                )
                engine = SupersetDBStagingEngine(0)

            elif engine_name == ENGINE_DUCKDB:
                from superset.local_staging.duckdb_engine import DuckDBStagingEngine
                engine = DuckDBStagingEngine(0, config)

            elif engine_name == ENGINE_CLICKHOUSE:
                from superset.local_staging.clickhouse_engine import (
                    ClickHouseStagingEngine,
                )
                engine = ClickHouseStagingEngine(0, config)

            else:
                return self.response_400(
                    message=f"Unknown engine: {engine_name!r}"
                )

            result = engine.health_check()
            return self.response(200, result=result)

        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Test connection failed")
            return self.response_500(message=str(ex))

    @expose("/tables", methods=["GET"])
    @protect()
    @safe
    def list_tables(self) -> Any:
        """List all tables in the active staging engine.
        ---
        get:
          summary: List staging engine tables
          responses:
            200:
              description: Table list
        """
        try:
            from superset.local_staging.engine_factory import get_active_staging_engine
            engine = get_active_staging_engine(0)
            tables = engine.list_tables()
            return self.response(200, result=tables)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Failed to list staging tables")
            return self.response_500(message=str(ex))

    @expose("/run-query", methods=["POST"])
    @protect()
    @safe
    def run_query(self) -> Any:
        """Run a read-only SQL query against the active staging engine.
        ---
        post:
          summary: Run SQL query against staging engine
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    sql:
                      type: string
                    limit:
                      type: integer
          responses:
            200:
              description: Query result
        """
        try:
            body = request.json or {}
            sql = str(body.get("sql") or "").strip()
            limit = int(body.get("limit") or 500)
            if not sql:
                return self.response_400(message="'sql' is required")
            # Safety: reject non-SELECT statements
            sql_upper = sql.lstrip().upper()
            if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
                return self.response_400(
                    message="Only SELECT / WITH queries are permitted"
                )
            from superset.local_staging.engine_factory import get_active_staging_engine
            engine = get_active_staging_engine(0)
            result = engine.run_explorer_query(sql, limit=limit)
            return self.response(200, result=result)
        except NotImplementedError as ex:
            return self.response_400(message=str(ex))
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Explorer query failed")
            return self.response_500(message=str(ex))

    @expose("/migrate-from-superset-db", methods=["GET"])
    @protect()
    @safe
    def list_migratable_datasets(self) -> Any:
        """List staged datasets that exist in the old superset_db engine but
        are missing from (or empty in) the active staging engine.

        Returns a list of datasets with their migration status so the admin UI
        can show what needs to be migrated.
        ---
        get:
          summary: List datasets eligible for superset_db → DuckDB migration
          responses:
            200:
              description: Migration status per dataset
        """
        try:
            from superset.dhis2.models import DHIS2StagedDataset
            from superset.dhis2.staging_engine import DHIS2StagingEngine
            from superset import db as superset_db
            from sqlalchemy import inspect as _inspect

            old_engine = DHIS2StagingEngine(0)
            dialect = str(getattr(superset_db.engine.dialect, "name", "") or "").lower()
            schema = old_engine.STAGING_SCHEMA if dialect != "sqlite" else None
            inspector = _inspect(superset_db.engine)

            datasets = (
                superset_db.session.query(DHIS2StagedDataset).all()
            )
            result = []
            for dataset in datasets:
                old_table = old_engine._get_physical_table_name(dataset)
                old_exists = inspector.has_table(old_table, schema=schema)
                if not old_exists:
                    continue

                from superset.local_staging.engine_factory import get_active_staging_engine
                active_engine = get_active_staging_engine(dataset.database_id)
                new_exists = active_engine.table_exists(dataset)

                # Count rows in source
                src_rows = 0
                if old_exists:
                    try:
                        from sqlalchemy import text as _text
                        old_ref = old_engine.get_superset_sql_table_ref(dataset)
                        with superset_db.engine.connect() as conn:
                            row = conn.execute(
                                _text(f"SELECT COUNT(*) FROM {old_ref}")
                            ).fetchone()
                            src_rows = int(row[0]) if row else 0
                    except Exception:  # pylint: disable=broad-except
                        src_rows = -1

                dst_rows = 0
                if new_exists:
                    try:
                        stats = active_engine.get_staging_table_stats(dataset)
                        dst_rows = int(stats.get("row_count") or 0)
                    except Exception:  # pylint: disable=broad-except
                        dst_rows = -1

                result.append({
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "source_table": old_engine.get_superset_sql_table_ref(dataset),
                    "source_rows": src_rows,
                    "destination_exists": new_exists,
                    "destination_rows": dst_rows,
                    "needs_migration": src_rows > 0 and (not new_exists or dst_rows == 0),
                })

            return self.response(200, result=result)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Failed to list migratable datasets")
            return self.response_500(message=str(ex))

    @expose("/migrate-from-superset-db", methods=["POST"])
    @protect()
    @safe
    def migrate_from_superset_db(self) -> Any:
        """Copy staging rows from the legacy superset_db engine into the active
        staging engine (typically DuckDB), then rebuild the serving table.

        Accepts an optional ``dataset_ids`` list; when omitted all datasets
        with source rows are migrated.
        ---
        post:
          summary: Migrate staged data from superset_db to active engine
          requestBody:
            required: false
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    dataset_ids:
                      type: array
                      items:
                        type: integer
          responses:
            200:
              description: Per-dataset migration results
        """
        try:
            from superset.dhis2.models import DHIS2StagedDataset
            from superset.dhis2.staged_dataset_service import ensure_serving_table
            from superset.local_staging.engine_factory import get_active_staging_engine
            from superset import db as superset_db

            body = request.json or {}
            requested_ids: list[int] | None = body.get("dataset_ids") or None

            if requested_ids is not None:
                datasets = [
                    superset_db.session.get(DHIS2StagedDataset, did)
                    for did in requested_ids
                    if superset_db.session.get(DHIS2StagedDataset, did) is not None
                ]
            else:
                datasets = superset_db.session.query(DHIS2StagedDataset).all()

            results = []
            for dataset in datasets:
                active_engine = get_active_staging_engine(dataset.database_id)
                if not hasattr(active_engine, "import_from_superset_db"):
                    results.append({
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Active engine does not support superset_db import",
                    })
                    continue

                migration_result = active_engine.import_from_superset_db(dataset)
                if migration_result.get("error") and migration_result["imported"] == 0:
                    results.append({
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": migration_result["error"],
                    })
                    continue

                # Rebuild the serving table from newly imported staging rows
                serving_error = None
                try:
                    ensure_serving_table(dataset.id)
                except Exception as exc:  # pylint: disable=broad-except
                    serving_error = str(exc)

                results.append({
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "status": "ok" if not serving_error else "partial",
                    "imported": migration_result["imported"],
                    "serving_error": serving_error,
                })

            return self.response(200, result=results)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Migration from superset_db failed")
            return self.response_500(message=str(ex))

    @expose("/sqllab-expose", methods=["PUT"])
    @protect()
    @safe
    def set_sqllab_expose(self) -> Any:
        """Toggle SQL Lab visibility for the staging engine database.
        ---
        put:
          summary: Expose or hide the staging database in SQL Lab
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    expose:
                      type: boolean
          responses:
            200:
              description: Updated exposure state
        """
        try:
            body = request.json or {}
            expose = bool(body.get("expose", False))
            from superset.local_staging.engine_factory import get_active_staging_engine
            engine = get_active_staging_engine(0)
            if not hasattr(engine, "get_or_create_superset_database"):
                return self.response_400(
                    message="Active engine does not support SQL Lab exposure"
                )
            srv_db = engine.get_or_create_superset_database()
            if srv_db is None:
                return self.response_400(
                    message="No serving database registered for this engine"
                )
            srv_db.expose_in_sqllab = expose
            db.session.commit()
            return self.response(200, result={
                "expose_in_sqllab": expose,
                "database_id": srv_db.id,
                "database_name": srv_db.database_name,
            })
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Failed to update SQL Lab exposure")
            return self.response_500(message=str(ex))
