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
from flask_appbuilder.security.decorators import permission_name
from marshmallow import Schema, ValidationError, fields, validate

from superset import db
from superset.local_staging.admin_tools import (
    classify_table_name,
    get_dependency_status,
    install_engine_dependencies,
)
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
    http_port = fields.Int(load_default=8123)  # HTTP port used by clickhouse-connect
    port = fields.Int(load_default=9000)        # native TCP port (kept for reference)
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


class ExplorerTableActionSchema(Schema):
    schema = fields.Str(required=True)
    name = fields.Str(required=True)
    action = fields.Str(
        required=True,
        validate=validate.OneOf(["preview", "truncate", "drop", "optimize"]),
    )
    limit = fields.Int(
        load_default=100,
        validate=validate.Range(min=1, max=1000),
    )


class ExplorerDatabaseActionSchema(Schema):
    action = fields.Str(
        required=True,
        validate=validate.OneOf(["optimize_managed_tables", "cleanup_build_tables"]),
    )


class DependencyInstallSchema(Schema):
    engine = fields.Str(
        required=True,
        validate=validate.OneOf([ENGINE_SUPERSET_DB, ENGINE_DUCKDB, ENGINE_CLICKHOUSE]),
    )


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
    @permission_name("write")
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
    @permission_name("write")
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
    @permission_name("write")
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
    @permission_name("write")
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
            from superset.dhis2.staging_engine_migration_service import (
                StagingEngineMigrationService,
            )

            target_backend = LocalStagingSettings.get_active_engine_name()
            plan = StagingEngineMigrationService().plan_migration(
                source_backend=ENGINE_SUPERSET_DB,
                target_backend=target_backend,
            )
            return self.response(200, **plan)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Failed to list migratable datasets")
            return self.response_500(message=str(ex))

    @expose("/migrate-from-superset-db", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
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
            from superset.dhis2.staging_engine_migration_service import (
                StagingEngineMigrationService,
            )

            body = request.json or {}
            requested_ids: list[int] | None = body.get("dataset_ids") or None
            replace_existing = bool(body.get("replace_existing"))
            target_backend = LocalStagingSettings.get_active_engine_name()
            migration_result = StagingEngineMigrationService().migrate_staging_objects(
                source_backend=ENGINE_SUPERSET_DB,
                target_backend=target_backend,
                dataset_ids=requested_ids,
                replace_existing=replace_existing,
            )
            return self.response(200, **migration_result)
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Migration from superset_db failed")
            return self.response_500(message=str(ex))

    @expose("/sqllab-expose", methods=["PUT"])
    @protect()
    @safe
    @permission_name("write")
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

    @expose("/dependencies", methods=["GET"])
    @protect()
    @safe
    def get_dependencies(self) -> Any:
        try:
            return self.response(200, result=get_dependency_status())
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Failed to load dependency status")
            return self.response_500(message=str(ex))

    @expose("/install-dependencies", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def install_dependencies(self) -> Any:
        try:
            body = request.json or {}
            payload = DependencyInstallSchema().load(body)
            result = install_engine_dependencies(payload["engine"])
            return self.response(200, result=result)
        except ValidationError as err:
            return self.response_400(message=str(err.messages))
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Dependency installation failed")
            return self.response_500(message=str(ex))

    @expose("/table-action", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def run_table_action(self) -> Any:
        try:
            body = request.json or {}
            payload = ExplorerTableActionSchema().load(body)
        except ValidationError as err:
            return self.response_400(message=str(err.messages))

        try:
            engine = get_active_staging_engine(0)
            table_info = classify_table_name(payload["name"])
            action = payload["action"]
            destructive_actions = {"truncate", "drop", "optimize"}
            if action in destructive_actions and not table_info.get("managed"):
                return self.response_400(
                    message=(
                        "Only managed staging/serving/build tables can be "
                        "modified from the explorer"
                    )
                )

            if action == "preview":
                result = engine.preview_table(
                    payload["schema"],
                    payload["name"],
                    limit=payload["limit"],
                )
            elif action == "truncate":
                result = engine.truncate_table(payload["schema"], payload["name"])
            elif action == "drop":
                result = engine.drop_table(payload["schema"], payload["name"])
            else:
                result = engine.optimize_table(payload["schema"], payload["name"])

            return self.response(
                200,
                result={
                    **table_info,
                    "action": action,
                    "schema": payload["schema"],
                    "name": payload["name"],
                    **(result if isinstance(result, dict) else {"message": str(result)}),
                },
            )
        except NotImplementedError as ex:
            return self.response_400(message=str(ex))
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Explorer table action failed")
            return self.response_500(message=str(ex))

    @expose("/database-action", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def run_database_action(self) -> Any:
        try:
            body = request.json or {}
            payload = ExplorerDatabaseActionSchema().load(body)
        except ValidationError as err:
            return self.response_400(message=str(err.messages))

        try:
            engine = get_active_staging_engine(0)
            tables = engine.list_tables()
            if tables and isinstance(tables[0], dict) and tables[0].get("error"):
                return self.response_400(message=str(tables[0]["error"]))

            action = payload["action"]
            processed: list[dict[str, Any]] = []
            errors: list[dict[str, Any]] = []
            for table in tables:
                role = str(table.get("role") or "other")
                managed = bool(table.get("managed"))
                schema = str(table.get("schema") or "")
                name = str(table.get("name") or "")
                try:
                    if action == "cleanup_build_tables":
                        if role != "build":
                            continue
                        outcome = engine.drop_table(schema, name)
                    else:
                        if not managed or role == "build":
                            continue
                        outcome = engine.optimize_table(schema, name)
                    processed.append(
                        {
                            "schema": schema,
                            "name": name,
                            "role": role,
                            "outcome": outcome,
                        }
                    )
                except Exception as ex:  # pylint: disable=broad-except
                    errors.append(
                        {
                            "schema": schema,
                            "name": name,
                            "role": role,
                            "error": str(ex),
                        }
                    )

            return self.response(
                200,
                result={
                    "action": action,
                    "processed_count": len(processed),
                    "error_count": len(errors),
                    "processed": processed,
                    "errors": errors,
                },
            )
        except Exception as ex:  # pylint: disable=broad-except
            logger.exception("Explorer database action failed")
            return self.response_500(message=str(ex))
