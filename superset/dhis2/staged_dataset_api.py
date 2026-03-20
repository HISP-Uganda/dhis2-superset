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
DHIS2 Staged Dataset REST API

Exposes CRUD operations for :class:`~superset.dhis2.models.DHIS2StagedDataset`
and its child :class:`~superset.dhis2.models.DHIS2DatasetVariable` objects,
together with staging-table statistics and variable management endpoints.

Endpoints are mounted under ``/api/v1/dhis2/staged-datasets/``.

Routes
------
``GET    /``                              – list staged datasets
``GET    /<pk>``                          – get dataset + variables + stats
``POST   /``                             – create dataset
``PUT    /<pk>``                         – update dataset metadata + variables
``DELETE /<pk>``                         – delete dataset and staging table
``GET    /<pk>/variables``               – list variable mappings
``POST   /<pk>/variables``              – add a variable mapping
``DELETE /<pk>/variables/<var_id>``     – remove a variable mapping
``GET    /<pk>/stats``                  – staging-table statistics
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from flask import make_response, request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset.dhis2 import staged_dataset_service as svc
from superset.dhis2.staging_database_service import get_staging_database
from superset.dhis2.staging_engine import DHIS2StagingEngine
from superset.dhis2.sync_service import schedule_staged_dataset_sync, DHIS2SyncService
from superset.local_staging.engine_factory import get_active_staging_engine as _get_engine

logger = logging.getLogger(__name__)

# Cache TTLs (seconds) for read endpoints backed by local staging tables.
# Keyed on dataset_id + last_sync_at so entries are automatically superseded
# whenever a new sync completes — no explicit invalidation required.
_QUERY_CACHE_TTL = 300        # 5 min — chart data
_COLVALS_CACHE_TTL = 600      # 10 min — distinct column values
_PERIODS_CACHE_TTL = 600      # 10 min — available period list


def _data_cache():
    """Lazy accessor for Superset's Redis data-cache (DATA_CACHE_CONFIG)."""
    try:
        from superset.extensions import cache_manager  # pylint: disable=import-outside-toplevel
        return cache_manager.data_cache
    except Exception:  # pylint: disable=broad-except
        return None


def _cache_key(prefix: str, dataset_id: int, sync_ts: Any, **params: Any) -> str:
    """Build a deterministic cache key that embeds the dataset's sync timestamp.

    Including *sync_ts* means stale entries become unreachable as soon as a
    new sync updates ``last_sync_at`` — no explicit delete needed.
    """
    payload = json.dumps(params, sort_keys=True, default=str)
    digest = hashlib.md5(payload.encode()).hexdigest()[:16]  # noqa: S324 — not crypto
    return f"dhis2_sv_{prefix}_{dataset_id}_{sync_ts}_{digest}"


def _fetch_distinct_periods(
    engine: Any,
    dataset: Any,
    *,
    use_serving: bool = True,
) -> list[str]:
    """Return distinct period strings from staging or serving table.

    Delegates to the engine's own connection so DuckDB / ClickHouse engines
    are not forced to use Superset's metadata-DB connection.
    """
    try:
        return engine.get_distinct_periods(dataset, use_serving=use_serving)
    except Exception:  # pylint: disable=broad-except
        table_ref = (
            engine.get_serving_sql_table_ref(dataset)
            if use_serving
            else engine.get_superset_sql_table_ref(dataset)
        )
        logger.warning(
            "Failed to fetch distinct periods from %s", table_ref, exc_info=True
        )
        return []


def _normalize_variable_mappings(
    variables_data: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in variables_data or []:
        if not isinstance(item, dict):
            continue

        variable_id = str(item.get("variable_id") or "").strip()
        variable_type = str(item.get("variable_type") or "").strip()
        if not variable_id or not variable_type:
            continue

        try:
            instance_id = int(item.get("instance_id"))
        except (TypeError, ValueError):
            continue

        normalized_item = {
            "instance_id": instance_id,
            "variable_id": variable_id,
            "variable_type": variable_type,
        }
        variable_name = item.get("variable_name")
        alias = item.get("alias")
        extra_params = item.get("extra_params")
        if isinstance(variable_name, str) and variable_name.strip():
            normalized_item["variable_name"] = variable_name.strip()
        if isinstance(alias, str) and alias.strip():
            normalized_item["alias"] = alias.strip()
        if extra_params is not None:
            normalized_item["extra_params"] = extra_params
        normalized.append(normalized_item)

    return normalized


def _merge_dataset_lineage(
    body: dict[str, Any],
    variables_data: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    normalized_variables = _normalize_variable_mappings(variables_data)
    dataset_config = body.get("dataset_config")
    next_dataset_config = dict(dataset_config) if isinstance(dataset_config, dict) else {}

    if normalized_variables:
        next_dataset_config["variable_mappings"] = normalized_variables
        if not next_dataset_config.get("configured_connection_ids"):
            next_dataset_config["configured_connection_ids"] = list(
                dict.fromkeys(
                    variable["instance_id"] for variable in normalized_variables
                )
            )

    if next_dataset_config:
        body["dataset_config"] = next_dataset_config
    return body


class DHIS2StagedDatasetApi(BaseApi):
    """REST API for managing DHIS2 staged (materialised) datasets.

    All endpoints require standard Superset authentication via the
    ``@protect()`` decorator.  No credentials are exposed in any response.
    """

    resource_name = "dhis2/staged-datasets"
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Staged Datasets"

    # ------------------------------------------------------------------
    # Helper
    # ------------------------------------------------------------------

    def _dataset_to_dict(
        self,
        pk: int,
        *,
        include_variables: bool = False,
        include_stats: bool = False,
        include_dataset_config: bool = True,
    ) -> dict[str, Any] | None:
        """Serialise a staged dataset, optionally enriching with variables/stats.

        Args:
            pk: Primary key of the ``dhis2_staged_datasets`` row.
            include_variables: When ``True``, attach a ``variables`` key
                containing all child variable mappings (with instance details).
            include_stats: When ``True``, attach a ``stats`` key from the
                staging-table statistics query.

        Returns:
            A plain dict, or ``None`` when the dataset is not found.
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return None

        payload = dataset.to_json()
        if not include_dataset_config:
            payload.pop("dataset_config", None)
        payload["staging_table_ref"] = _get_engine(
            dataset.database_id
        ).get_superset_sql_table_ref(dataset)
        try:
            serving_table_ref, serving_columns = svc.ensure_serving_table(pk)
            # Reload so serving_superset_dataset_id (set by ensure_serving_table) is fresh
            dataset = svc.get_staged_dataset(pk) or dataset
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to build serving definition for staged dataset id=%s", pk
            )
            serving_table_ref = None
            serving_columns = []
        payload["serving_table_ref"] = serving_table_ref
        payload["serving_columns"] = serving_columns

        # Resolve the serving database from the engine so ClickHouse is handled
        # correctly (get_staging_database() falls back to SQLite for non-DuckDB engines).
        try:
            engine = _get_engine(dataset.database_id)
            if hasattr(engine, "get_or_create_superset_database"):
                serving_database = engine.get_or_create_superset_database()
            else:
                serving_database = get_staging_database()
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to resolve serving database for staged dataset id=%s", pk
            )
            serving_database = None
        if serving_database is not None:
            payload["serving_database_id"] = serving_database.id
            payload["serving_database_name"] = serving_database.name

        # ensure_serving_table already called register_serving_table_as_superset_dataset
        # and stored the resulting id on dataset.serving_superset_dataset_id.
        if dataset.serving_superset_dataset_id is not None:
            payload["serving_superset_dataset_id"] = dataset.serving_superset_dataset_id

        if include_variables:
            variables = svc.get_dataset_variables(pk)
            payload["variables"] = [
                {
                    **v.to_json(),
                    "instance": v.instance.to_json() if v.instance else None,
                }
                for v in variables
            ]

        if include_stats:
            try:
                payload["stats"] = svc.get_staging_stats(pk)
            except Exception:  # pylint: disable=broad-except
                logger.exception(
                    "Failed to retrieve staging stats for dataset id=%s", pk
                )
                payload["stats"] = None

        return payload

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    @expose("/", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_datasets(self) -> Response:
        """List staged datasets for a Superset database.

        ---
        get:
          summary: List DHIS2 staged datasets
          parameters:
            - in: query
              name: database_id
              required: true
              schema:
                type: integer
              description: Superset database ID
            - in: query
              name: include_inactive
              schema:
                type: boolean
                default: false
              description: Include inactive datasets
          responses:
            200:
              description: List of staged datasets
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        items:
                          type: object
                      count:
                        type: integer
            400:
              description: Missing or invalid query parameters
        """
        database_id = request.args.get("database_id", type=int)
        if not database_id:
            return self.response_400(
                message="'database_id' query parameter is required"
            )

        include_inactive_raw = request.args.get("include_inactive", "false").lower()
        include_inactive = include_inactive_raw in ("true", "1", "yes")
        include_stats_raw = request.args.get("include_stats", "false").lower()
        include_stats = include_stats_raw in ("true", "1", "yes")

        datasets = svc.list_staged_datasets(
            database_id, include_inactive=include_inactive
        )
        results: list[dict[str, Any]] = []
        for dataset in datasets:
            payload = self._dataset_to_dict(
                dataset.id,
                include_stats=include_stats,
                include_dataset_config=False,
            )
            results.append(payload or dataset.to_json())
        return self.response(
            200,
            result=results,
            count=len(datasets),
        )

    # ------------------------------------------------------------------
    # Get single
    # ------------------------------------------------------------------

    @expose("/<int:pk>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_dataset(self, pk: int) -> Response:
        """Retrieve a single staged dataset by primary key.

        The response includes all dataset fields, a ``variables`` list
        (each entry enriched with instance details), and a ``stats`` block
        from the physical staging table.

        ---
        get:
          summary: Get DHIS2 staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Staged dataset with variables and stats
            404:
              description: Dataset not found
        """
        payload = self._dataset_to_dict(
            pk, include_variables=True, include_stats=True
        )
        if payload is None:
            return self.response_404()
        return self.response(200, result=payload)

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    @expose("/", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def create_dataset(self) -> Response:
        """Create a new staged dataset and its PostgreSQL staging table.

        An optional ``variables`` array may be included in the request body;
        each element is passed directly to
        :func:`~superset.dhis2.staged_dataset_service.add_variable`.

        ---
        post:
          summary: Create DHIS2 staged dataset
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - database_id
                    - name
                  properties:
                    database_id:
                      type: integer
                    name:
                      type: string
                    description:
                      type: string
                    schedule_cron:
                      type: string
                    schedule_timezone:
                      type: string
                      default: UTC
                    is_active:
                      type: boolean
                      default: true
                    auto_refresh_enabled:
                      type: boolean
                      default: true
                    dataset_config:
                      type: object
                    variables:
                      type: array
                      items:
                        type: object
          responses:
            201:
              description: Created staged dataset
            400:
              description: Validation error
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}

        database_id = body.get("database_id")
        if not database_id:
            return self.response_400(message="'database_id' is required")

        existing_dataset = svc.get_staged_dataset_by_name(
            int(database_id),
            str(body.get("name") or ""),
        )
        variables_data: list[dict[str, Any]] = body.pop("variables", []) or []
        body = _merge_dataset_lineage(body, variables_data)

        try:
            dataset = svc.create_staged_dataset(int(database_id), body)
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error creating DHIS2StagedDataset")
            return self.response_500(message="Failed to create staged dataset")

        # Treat create requests as the full desired variable mapping so retries
        # replace the existing selection instead of appending duplicates.
        variable_errors: list[str] = []
        existing_variables = svc.get_dataset_variables(dataset.id)
        for var in existing_variables:
            try:
                svc.remove_variable(var.id)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception(
                    "Failed to remove variable id=%s before replacing dataset id=%s",
                    var.id,
                    dataset.id,
                )
                variable_errors.append(str(exc))

        for var_data in variables_data:
            try:
                svc.add_variable(dataset.id, var_data)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception(
                    "Failed to add variable %r to dataset id=%s",
                    var_data.get("variable_id"),
                    dataset.id,
                )
                variable_errors.append(str(exc))

        payload = self._dataset_to_dict(
            dataset.id, include_variables=True, include_stats=False
        )
        sync_schedule = None
        try:
            svc.ensure_serving_table(dataset.id)
            sync_schedule = schedule_staged_dataset_sync(
                dataset.id,
                job_type="scheduled",
                prefer_immediate=True,
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to queue initial sync for staged dataset id=%s",
                dataset.id,
            )
        response_body: dict[str, Any] = {"result": payload}
        if variable_errors:
            response_body["variable_errors"] = variable_errors
        if sync_schedule is not None:
            response_body["sync_schedule"] = sync_schedule

        return self.response(200 if existing_dataset else 201, **response_body)

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    @expose("/<int:pk>", methods=["PUT"])
    @protect()
    @safe
    @permission_name("write")
    def update_dataset(self, pk: int) -> Response:
        """Update a staged dataset's metadata and/or replace its variables.

        When ``variables`` is present in the request body the **complete**
        current variable list is replaced: existing variables are deleted and
        the supplied list is inserted.  Omit the ``variables`` key entirely to
        leave variable mappings unchanged.

        ---
        put:
          summary: Update DHIS2 staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    name:
                      type: string
                    description:
                      type: string
                    schedule_cron:
                      type: string
                    schedule_timezone:
                      type: string
                    is_active:
                      type: boolean
                    auto_refresh_enabled:
                      type: boolean
                    dataset_config:
                      type: object
                    variables:
                      type: array
                      items:
                        type: object
          responses:
            200:
              description: Updated staged dataset
            400:
              description: Validation error
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}
        variables_data: list[dict[str, Any]] | None = body.pop("variables", None)
        body = _merge_dataset_lineage(body, variables_data)

        try:
            dataset = svc.update_staged_dataset(pk, body)
        except ValueError as exc:
            message = str(exc)
            if "not found" in message.lower():
                return self.response_404()
            return self.response_400(message=message)
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error updating DHIS2StagedDataset id=%s", pk)
            return self.response_500(message="Failed to update staged dataset")

        variable_errors: list[str] = []
        if variables_data is not None:
            # Replace all variable mappings.
            existing = svc.get_dataset_variables(pk)
            for var in existing:
                try:
                    svc.remove_variable(var.id)
                except Exception:  # pylint: disable=broad-except
                    logger.exception(
                        "Failed to remove variable id=%s during update of dataset id=%s",
                        var.id,
                        pk,
                    )

            for var_data in variables_data:
                try:
                    svc.add_variable(pk, var_data)
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception(
                        "Failed to add variable %r to dataset id=%s",
                        var_data.get("variable_id"),
                        pk,
                    )
                    variable_errors.append(str(exc))

        payload = self._dataset_to_dict(
            dataset.id, include_variables=True, include_stats=False
        )
        sync_schedule = None
        try:
            svc.ensure_serving_table(dataset.id)
            sync_schedule = schedule_staged_dataset_sync(
                dataset.id,
                job_type="scheduled",
                prefer_immediate=True,
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to queue refresh sync for staged dataset id=%s",
                dataset.id,
            )
        response_body: dict[str, Any] = {"result": payload}
        if variable_errors:
            response_body["variable_errors"] = variable_errors
        if sync_schedule is not None:
            response_body["sync_schedule"] = sync_schedule

        return self.response(200, **response_body)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @expose("/<int:pk>/cleanup", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def cleanup_dataset(self, pk: int) -> Response:
        """Clear local staged rows while preserving the dataset definition.

        ---
        post:
          summary: Clear local staged data for a dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Local staged data cleared
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        try:
            result = svc.clear_staged_dataset_data(pk)
        except ValueError as exc:
            if "not found" in str(exc).lower():
                return self.response_404()
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error clearing local staged data for DHIS2StagedDataset id=%s",
                pk,
            )
            return self.response_500(message="Failed to clear local staged data")

        return self.response(
            200,
            result=result,
            message="Local staged data cleared successfully",
        )

    @expose("/<int:pk>", methods=["DELETE"])
    @protect()
    @safe
    @permission_name("write")
    def delete_dataset(self, pk: int) -> Response:
        """Delete a staged dataset and its physical staging table.

        ---
        delete:
          summary: Delete DHIS2 staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Deletion successful
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        try:
            deleted = svc.delete_staged_dataset(pk)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error deleting DHIS2StagedDataset id=%s", pk
            )
            return self.response_500(message="Failed to delete staged dataset")

        if not deleted:
            return self.response_404()

        return self.response(200, message="Staged dataset deleted successfully")

    # ------------------------------------------------------------------
    # Variables – list
    # ------------------------------------------------------------------

    @expose("/<int:pk>/variables", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_variables(self, pk: int) -> Response:
        """List all variable mappings for a staged dataset.

        ---
        get:
          summary: List variables for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Variable mapping list
            404:
              description: Dataset not found
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        variables = svc.get_dataset_variables(pk)
        return self.response(
            200,
            result=[
                {
                    **v.to_json(),
                    "instance": v.instance.to_json() if v.instance else None,
                }
                for v in variables
            ],
            count=len(variables),
        )

    # ------------------------------------------------------------------
    # Variables – add
    # ------------------------------------------------------------------

    @expose("/<int:pk>/variables", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def add_variable(self, pk: int) -> Response:
        """Add a variable mapping to a staged dataset.

        ---
        post:
          summary: Add variable to staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - instance_id
                    - variable_id
                    - variable_type
                  properties:
                    instance_id:
                      type: integer
                    variable_id:
                      type: string
                    variable_type:
                      type: string
                    variable_name:
                      type: string
                    alias:
                      type: string
                    extra_params:
                      type: object
          responses:
            201:
              description: Variable mapping created
            400:
              description: Validation error
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}

        try:
            variable = svc.add_variable(pk, body)
        except ValueError as exc:
            message = str(exc)
            if "not found" in message.lower():
                return self.response_404()
            return self.response_400(message=message)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error adding variable to DHIS2StagedDataset id=%s", pk
            )
            return self.response_500(message="Failed to add variable")

        return self.response(201, result=variable.to_json())

    # ------------------------------------------------------------------
    # Variables – remove
    # ------------------------------------------------------------------

    @expose("/<int:pk>/variables/<int:var_id>", methods=["DELETE"])
    @protect()
    @safe
    @permission_name("write")
    def remove_variable(self, pk: int, var_id: int) -> Response:
        """Remove a variable mapping from a staged dataset.

        ---
        delete:
          summary: Remove variable from staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
            - in: path
              name: var_id
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Variable removed
            404:
              description: Variable not found
            500:
              description: Internal server error
        """
        try:
            deleted = svc.remove_variable(var_id)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error removing variable id=%s from dataset id=%s",
                var_id,
                pk,
            )
            return self.response_500(message="Failed to remove variable")

        if not deleted:
            return self.response_404()

        return self.response(200, message="Variable removed successfully")

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    @expose("/<int:pk>/stats", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_stats(self, pk: int) -> Response:
        """Return staging-table statistics for a staged dataset.

        Statistics include total row count, per-instance row counts,
        timestamp range, and physical table size in bytes.

        ---
        get:
          summary: Get staging table statistics
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Staging table statistics
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          total_rows:
                            type: integer
                          rows_per_instance:
                            type: object
                          min_synced_at:
                            type: string
                            nullable: true
                          max_synced_at:
                            type: string
                            nullable: true
                          table_size_bytes:
                            type: integer
                            nullable: true
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        try:
            stats = svc.get_staging_stats(pk)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error fetching staging stats for dataset id=%s", pk
            )
            return self.response_500(message="Failed to retrieve staging statistics")

        return self.response(200, result=stats)

    # ------------------------------------------------------------------
    # Preview
    # ------------------------------------------------------------------

    @expose("/<int:pk>/preview", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_preview(self, pk: int) -> Response:
        """Return a preview of rows stored in local staged data for a dataset."""
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        limit = request.args.get("limit", type=int) or 50

        try:
            preview = svc.get_staging_preview(pk, limit=limit)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error fetching staging preview for dataset id=%s", pk
            )
            return self.response_500(message="Failed to retrieve staging preview")

        return self.response(200, result=preview)

    @expose("/<int:pk>/query", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def query_preview(self, pk: int) -> Response:
        """Return a filtered local-data preview for a staged dataset."""
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        body: dict[str, Any] = request.get_json() or {}
        selected_columns = body.get("columns")
        filters = body.get("filters")
        limit = body.get("limit", 100)
        page = body.get("page", 1)
        group_by_columns = body.get("group_by")
        metric_column = body.get("metric_column")
        metric_alias = body.get("metric_alias")
        aggregation_method = body.get("aggregation_method")

        safe_limit = int(limit or 100)
        safe_page = int(page or 1)
        safe_cols = selected_columns if isinstance(selected_columns, list) else None
        safe_filters = filters if isinstance(filters, list) else None
        safe_group = group_by_columns if isinstance(group_by_columns, list) else None
        safe_metric = str(metric_column).strip() if metric_column is not None and str(metric_column).strip() else None
        safe_alias = str(metric_alias).strip() if metric_alias is not None and str(metric_alias).strip() else None
        safe_agg = str(aggregation_method).strip() if aggregation_method is not None else None

        sync_ts = str(getattr(dataset, "last_sync_at", "") or "")
        ck = _cache_key(
            "q", pk, sync_ts,
            cols=safe_cols, filters=safe_filters, limit=safe_limit, page=safe_page,
            group=safe_group, metric=safe_metric, alias=safe_alias, agg=safe_agg,
        )
        cache = _data_cache()
        if cache is not None:
            cached = cache.get(ck)
            if cached is not None:
                return self.response(200, result=cached)

        try:
            result = svc.query_serving_data(
                pk,
                selected_columns=safe_cols,
                filters=safe_filters,
                limit=safe_limit,
                page=safe_page,
                group_by_columns=safe_group,
                metric_column=safe_metric,
                metric_alias=safe_alias,
                aggregation_method=safe_agg,
                count_rows=False,
            )
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error querying staged local data for dataset id=%s", pk
            )
            return self.response_500(message="Failed to query staged local data")

        if cache is not None:
            try:
                cache.set(ck, result, timeout=_QUERY_CACHE_TTL)
            except Exception:  # pylint: disable=broad-except
                pass

        return self.response(200, result=result)

    @expose("/<int:pk>/available-periods", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_available_periods(self, pk: int) -> Response:
        """Return distinct period values present in the serving table.

        Used by the DHIS2Map control panel to populate the period filter
        with the actual periods that have been synced, so users can pick
        from real values rather than typing free-form strings.

        Returns::

            {"result": ["2024Q1", "2024Q2", "2024Q3", "2024Q4"]}
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        sync_ts = str(getattr(dataset, "last_sync_at", "") or "")
        ck = _cache_key("periods", pk, sync_ts)
        cache = _data_cache()
        if cache is not None:
            cached = cache.get(ck)
            if cached is not None:
                return self.response(200, result=cached)

        try:
            engine = _get_engine(dataset.database_id)
            # Use the serving table when available; fall back to staging table.
            if engine.serving_table_exists(dataset):
                periods = _fetch_distinct_periods(engine, dataset, use_serving=True)
            elif engine.table_exists(dataset):
                periods = _fetch_distinct_periods(engine, dataset, use_serving=False)
            else:
                periods = []
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to load available periods for staged dataset id=%s", pk
            )
            return self.response_500(message="Failed to load available periods")

        result = sorted(set(str(p) for p in periods if p))
        if cache is not None:
            try:
                cache.set(ck, result, timeout=_PERIODS_CACHE_TTL)
            except Exception:  # pylint: disable=broad-except
                pass
        return self.response(200, result=result)

    @expose("/<int:pk>/column-values", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_column_values(self, pk: int) -> Response:
        """Return distinct values for a specific column in the staged serving table.

        Query parameter ``column`` is required.  Returns up to 2 000 distinct
        non-null values, ordered alphabetically, so the DHIS2Map filter control
        can show real values from the data without requiring free-form typing.

        Returns::

            {"result": ["value1", "value2", ...]}
        """
        column = request.args.get("column", "").strip()
        if not column:
            return self.response_400(message="'column' query parameter is required")

        # Reject obvious SQL-injection attempts — allow only identifier-safe chars
        if not re.match(r"^[A-Za-z0-9_\- ]+$", column):
            return self.response_400(message="Invalid column name")

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        sync_ts = str(getattr(dataset, "last_sync_at", "") or "")
        ck = _cache_key("cv", pk, sync_ts, column=column)
        cache = _data_cache()
        if cache is not None:
            cached = cache.get(ck)
            if cached is not None:
                return self.response(200, result=cached)

        try:
            from sqlalchemy import text  # pylint: disable=import-outside-toplevel
            from superset import db  # pylint: disable=import-outside-toplevel

            engine = _get_engine(dataset.database_id)

            if engine.serving_table_exists(dataset):
                table_ref = engine.get_serving_sql_table_ref(dataset)
            elif engine.table_exists(dataset):
                table_ref = engine.get_superset_sql_table_ref(dataset)
            else:
                return self.response(200, result=[])

            # Use quoted identifier to avoid reserved-word clashes
            sql = (
                f'SELECT DISTINCT "{column}" AS v FROM {table_ref} '
                f'WHERE "{column}" IS NOT NULL '
                f'ORDER BY "{column}" LIMIT 2000'
            )
            with db.engine.connect() as conn:
                DHIS2StagingEngine.apply_connection_optimizations(
                    conn, str(getattr(db.engine.dialect, "name", "") or "")
                )
                rows = conn.execute(text(sql)).fetchall()
                values = [str(row[0]) for row in rows if row[0] is not None]
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to load column values for dataset id=%s column=%s", pk, column
            )
            return self.response_500(message="Failed to load column values")

        if cache is not None:
            try:
                cache.set(ck, values, timeout=_COLVALS_CACHE_TTL)
            except Exception:  # pylint: disable=broad-except
                pass
        return self.response(200, result=values)

    @expose("/<int:pk>/filters", methods=["GET", "POST"])
    @protect()
    @safe
    @permission_name("read")
    def get_local_filter_options(self, pk: int) -> Response:
        """Return hierarchy-aware org-unit and period filter options."""
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        body: dict[str, Any] = request.get_json(silent=True) or {}
        filters = body.get("filters")

        try:
            result = svc.get_local_filter_options(
                pk,
                filters=filters if isinstance(filters, list) else None,
            )
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error loading staged local filter options for dataset id=%s",
                pk,
            )
            return self.response_500(message="Failed to load local filter options")

        return self.response(200, result=result)

    @expose("/<int:pk>/export", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def export_dataset(self, pk: int) -> Response:
        """Export the full serving table in the requested format.

        Accepts ``format`` query parameter: ``csv`` (default), ``tsv``, ``json``.
        Returns the full serving table without additional filters.
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        fmt = (request.args.get("format") or "csv").lower().strip()
        if fmt not in ("csv", "tsv", "json"):
            return self.response_400(message="format must be csv, tsv, or json")

        filename_base = re.sub(
            r"[^a-zA-Z0-9]+",
            "_",
            str(dataset.name or "dhis2_dataset").strip().lower(),
        ).strip("_") or "dhis2_dataset"

        try:
            if fmt == "tsv":
                data, _ref = svc.export_serving_data_tsv(pk)
                response = make_response(data)
                response.headers["Content-Type"] = "text/tab-separated-values; charset=utf-8"
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{filename_base}.tsv"'
                )
            elif fmt == "json":
                data, _ref = svc.export_serving_data_json(pk)
                response = make_response(data)
                response.headers["Content-Type"] = "application/json; charset=utf-8"
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{filename_base}.json"'
                )
            else:
                data, _ref = svc.export_serving_data_csv(pk)
                response = make_response(data)
                response.headers["Content-Type"] = "text/csv; charset=utf-8"
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{filename_base}.csv"'
                )
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error exporting staged data for dataset id=%s format=%s",
                pk,
                fmt,
            )
            return self.response_500(message="Failed to export data")

        return response

    @expose("/<int:pk>/download", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def download_query(self, pk: int) -> Response:
        """Download filtered local staged data as CSV."""
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        body: dict[str, Any] = request.get_json() or {}
        selected_columns = body.get("columns")
        filters = body.get("filters")
        limit = body.get("limit")

        try:
            csv_text, _table_ref = svc.export_serving_data_csv(
                pk,
                selected_columns=selected_columns
                if isinstance(selected_columns, list)
                else None,
                filters=filters if isinstance(filters, list) else None,
                limit=int(limit) if limit is not None else None,
            )
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error downloading staged local data for dataset id=%s",
                pk,
            )
            return self.response_500(message="Failed to download staged local data")

        filename_base = re.sub(
            r"[^a-zA-Z0-9]+",
            "_",
            str(dataset.name or "dhis2_dataset").strip().lower(),
        ).strip("_") or "dhis2_dataset"
        response = make_response(csv_text)
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = (
            f'attachment; filename="{filename_base}_local_data.csv"'
        )
        return response

    # ------------------------------------------------------------------
    # Ensure staging table
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Per-dataset sync job history
    # ------------------------------------------------------------------

    @expose("/<int:pk>/jobs", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_jobs(self, pk: int) -> Response:
        """Return recent sync jobs for a staged dataset.

        Accepts optional ``limit`` query parameter (default 20).

        ---
        get:
          summary: Sync job history for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
            - in: query
              name: limit
              schema:
                type: integer
                default: 20
          responses:
            200:
              description: List of sync jobs ordered newest first
            404:
              description: Dataset not found
        """
        from superset import db
        from superset.dhis2.models import DHIS2SyncJob

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        limit = request.args.get("limit", 20, type=int)
        jobs = (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=pk)
            .order_by(DHIS2SyncJob.created_on.desc())
            .limit(max(1, min(limit, 200)))
            .all()
        )
        return self.response(
            200,
            result=[j.to_json() for j in jobs],
            count=len(jobs),
        )

    # ------------------------------------------------------------------
    # Latest job (for UI polling during active sync)
    # ------------------------------------------------------------------

    @expose("/<int:pk>/jobs/latest", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def latest_job(self, pk: int) -> Response:
        """Return the most recent sync job for a staged dataset.

        Intended for UI polling while a sync is in progress.

        ---
        get:
          summary: Latest sync job for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Latest job or null if none exists
            404:
              description: Dataset not found
        """
        from superset import db
        from superset.dhis2.models import DHIS2SyncJob

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        job = (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=pk)
            .order_by(DHIS2SyncJob.created_on.desc())
            .first()
        )
        return self.response(
            200,
            result=job.to_json() if job else None,
            dataset_sync_status=dataset.last_sync_status,
            dataset_sync_rows=dataset.last_sync_rows,
        )

    @expose("/<int:pk>/ensure-table", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def ensure_table(self, pk: int) -> Response:
        """Ensure a staged dataset's physical table exists.

        ---
        post:
          summary: Ensure staging table exists for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Staging table exists or was created successfully
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        try:
            staging_table_ref = svc.ensure_staging_table(pk)
            payload = self._dataset_to_dict(
                pk, include_variables=False, include_stats=True
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error ensuring staging table for dataset id=%s", pk
            )
            return self.response_500(message="Failed to ensure staging table")

        return self.response(
            200,
            result={
                "dataset": payload,
                "staging_table_ref": staging_table_ref,
            },
        )

    # ------------------------------------------------------------------
    # Register serving table as Superset virtual dataset
    # ------------------------------------------------------------------

    @expose("/<int:pk>/register-dataset", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def register_dataset(self, pk: int) -> Response:
        """Force (re-)registration of the serving table as a Superset virtual dataset.

        Useful when auto-registration failed or column definitions have changed.

        ---
        post:
          summary: Register DHIS2 serving table as Superset dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Dataset registered or updated
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        from superset.dhis2.staged_dataset_service import ensure_serving_table
        from superset.dhis2.superset_dataset_service import (
            register_serving_table_as_superset_dataset,
        )
        from superset.local_staging.engine_factory import get_active_staging_engine

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        try:
            serving_table_ref, serving_columns = ensure_serving_table(pk)
            # Use the active staging engine (DuckDB / ClickHouse) so we register
            # under the correct Superset Database, not the DHIS2 source database.
            engine = get_active_staging_engine(dataset.database_id)
            if hasattr(engine, "get_or_create_superset_database"):
                _sdb = engine.get_or_create_superset_database()
                serving_db_id = getattr(_sdb, "id", None)
            else:
                serving_db_id = getattr(engine, "database_id", None)

            if not serving_db_id:
                return self.response_500(message="Could not determine serving database")

            sqla_id = register_serving_table_as_superset_dataset(
                dataset_id=pk,
                dataset_name=dataset.name,
                serving_table_ref=serving_table_ref,
                serving_columns=serving_columns,
                serving_database_id=serving_db_id,
                source_database_id=dataset.database_id,
            )
            if dataset.serving_superset_dataset_id != sqla_id:
                dataset.serving_superset_dataset_id = sqla_id
                db.session.commit()

            explore_url = f"/explore/?datasource_id={sqla_id}&datasource_type=table"
            return self.response(
                200,
                result={
                    "superset_dataset_id": sqla_id,
                    "explore_url": explore_url,
                    "serving_table_ref": serving_table_ref,
                },
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "register_dataset: failed for dataset_id=%s", pk
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Category option combos for a variable
    # ------------------------------------------------------------------

    @expose("/<int:pk>/variables/<string:variable_id>/category-option-combos", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def variable_category_option_combos(self, pk: int, variable_id: str) -> Response:
        """Return available category option combos for a variable from DHIS2 metadata.

        Query params
        ------------
        instance_id : int  (required — which DHIS2 instance to query)

        ---
        get:
          summary: Category option combos for a DHIS2 variable
          parameters:
            - in: path
              name: pk
              schema:
                type: integer
            - in: path
              name: variable_id
              schema:
                type: string
            - in: query
              name: instance_id
              schema:
                type: integer
              required: true
          responses:
            200:
              description: List of category option combos
            400:
              description: Missing parameters
            404:
              description: Dataset not found
        """
        from superset.dhis2.metadata_staging_service import (
            get_category_option_combos_for_element,
        )

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        instance_id = request.args.get("instance_id", type=int)
        if not instance_id:
            return self.response_400(message="instance_id query parameter is required")

        try:
            combos = get_category_option_combos_for_element(
                instance_id=instance_id,
                variable_id=variable_id,
            )
            return self.response(200, result=combos, count=len(combos))
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "variable_category_option_combos: failed for dataset=%s variable=%s instance=%s",
                pk, variable_id, instance_id,
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Sync Now (manual trigger)
    # ------------------------------------------------------------------

    @expose("/<int:pk>/sync", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def sync_now(self, pk: int) -> Response:
        """Trigger an immediate manual sync for a staged dataset.

        Resets any stuck ``running`` state first, then dispatches a new sync
        job via Celery (if available) or a background thread.

        ---
        post:
          summary: Trigger immediate sync for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    incremental:
                      type: boolean
                      default: true
                      description: >
                        When true only missing/changed periods are fetched.
                        When false a full replacement sync is performed.
          responses:
            200:
              description: Sync dispatched
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        body: dict[str, Any] = request.get_json(silent=True) or {}
        incremental: bool = bool(body.get("incremental", True))

        try:
            # Reset any stuck running status so the new job can proceed.
            service = DHIS2SyncService()
            if dataset.last_sync_status == "running":
                service.update_dataset_sync_state(pk, status="pending")
                logger.info(
                    "sync_now: reset stuck running status for dataset id=%s", pk
                )

            svc.ensure_serving_table(pk)
            sync_result = schedule_staged_dataset_sync(
                pk,
                job_type="manual",
                prefer_immediate=False,
                incremental=incremental,
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error triggering manual sync for dataset id=%s", pk
            )
            return self.response_500(message="Failed to trigger sync")

        return self.response(200, result=sync_result)

    # ------------------------------------------------------------------
    # Reset stuck sync status
    # ------------------------------------------------------------------

    @expose("/<int:pk>/reset-sync", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def reset_sync_status(self, pk: int) -> Response:
        """Reset a stuck ``running`` sync status back to ``pending``.

        Use this when a sync job is stuck in ``running`` state (e.g. after a
        server restart killed an in-flight background thread or Celery task).

        ---
        post:
          summary: Reset stuck sync status for a staged dataset
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Sync status reset successfully
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        from superset import db
        from superset.dhis2.models import DHIS2SyncJob

        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        try:
            service = DHIS2SyncService()

            # Reset the dataset-level sync state.
            old_status = dataset.last_sync_status
            service.update_dataset_sync_state(pk, status="pending")

            # Mark any stuck running jobs as failed so the history is clean.
            stuck_jobs = (
                db.session.query(DHIS2SyncJob)
                .filter_by(staged_dataset_id=pk, status="running")
                .all()
            )
            for job in stuck_jobs:
                service.update_job_status(
                    job,
                    status="failed",
                    error_message="Manually reset (was stuck in running state)",
                )

            logger.info(
                "reset_sync_status: dataset id=%s old_status=%s stuck_jobs=%d",
                pk,
                old_status,
                len(stuck_jobs),
            )
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error resetting sync status for dataset id=%s", pk
            )
            return self.response_500(message="Failed to reset sync status")

        return self.response(
            200,
            result={
                "message": "Sync status reset",
                "previous_status": old_status,
                "stuck_jobs_reset": len(stuck_jobs),
            },
        )

    # ------------------------------------------------------------------
    # Orphan cleanup
    # ------------------------------------------------------------------

    @expose("/orphans", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_orphans(self) -> Response:
        """Return orphaned staged datasets and DuckDB tables.

        An *orphaned staged dataset* is a ``DHIS2StagedDataset`` whose
        ``serving_superset_dataset_id`` no longer points to an existing
        ``SqlaTable`` (i.e. the dataset definition was deleted from the UI
        without triggering the cascade).

        An *orphaned DuckDB table* is a ``ds_*`` or ``sv_*`` table in the
        staging schema for which no ``DHIS2StagedDataset`` row exists.

        ---
        get:
          summary: List orphaned staged datasets and DuckDB tables
          responses:
            200:
              description: Orphan inventory
        """
        from superset.connectors.sqla.models import SqlaTable
        from superset.dhis2.models import DHIS2StagedDataset as StagedDataset
        from superset.local_staging.engine_factory import get_active_staging_engine

        # --- orphaned DHIS2StagedDataset rows ---
        orphaned_datasets: list[dict] = []
        all_staged = db.session.query(StagedDataset).all()
        sqla_ids = {
            r.id
            for r in db.session.query(SqlaTable.id).all()
        }
        for ds in all_staged:
            sid = ds.serving_superset_dataset_id
            if sid is not None and sid not in sqla_ids:
                orphaned_datasets.append({
                    "id": ds.id,
                    "name": ds.name,
                    "staging_table_name": ds.staging_table_name,
                    "serving_superset_dataset_id": sid,
                    "reason": "serving SqlaTable deleted",
                })

        # --- orphaned DuckDB tables ---
        orphaned_tables: list[str] = []
        try:
            engine = get_active_staging_engine(0)
            if hasattr(engine, "_connect"):
                conn = engine._connect()
                rows = conn.execute(
                    "SELECT table_schema || '.' || table_name "
                    "FROM information_schema.tables "
                    "WHERE table_name LIKE 'ds_%' OR table_name LIKE 'sv_%' "
                    "ORDER BY table_name"
                ).fetchall()
                staged_names = {ds.staging_table_name for ds in all_staged if ds.staging_table_name}
                for (ref,) in rows:
                    table_name = ref.split(".")[-1]
                    if table_name not in staged_names and not any(
                        table_name == f"sv_{ds.id}_{ds.staging_table_name[3+len(str(ds.id))+1:]}"
                        or table_name.startswith(f"ds_{ds.id}_")
                        or table_name.startswith(f"sv_{ds.id}_")
                        for ds in all_staged
                    ):
                        orphaned_tables.append(ref)
        except Exception:  # pylint: disable=broad-except
            logger.exception("list_orphans: failed to query DuckDB tables")

        return self.response(
            200,
            result={
                "orphaned_staged_datasets": orphaned_datasets,
                "orphaned_duckdb_tables": orphaned_tables,
                "total_staged_datasets": len(all_staged),
            },
        )

    @expose("/cleanup-orphans", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def cleanup_orphans(self) -> Response:
        """Delete orphaned staged datasets and drop their DuckDB tables.

        Handles two classes of orphans:

        1. ``DHIS2StagedDataset`` rows whose ``serving_superset_dataset_id``
           points to a deleted ``SqlaTable``.
        2. ``DHIS2StagedDataset`` rows with no ``serving_superset_dataset_id``
           at all (never registered).

        Drops the physical ``ds_*`` and ``sv_*`` DuckDB tables, then removes
        the metadata row.  Idempotent — safe to call repeatedly.

        ---
        post:
          summary: Delete orphaned staged datasets and their DuckDB tables
          responses:
            200:
              description: Cleanup summary
        """
        from superset.connectors.sqla.models import SqlaTable
        from superset.dhis2.models import DHIS2StagedDataset as StagedDataset
        from superset.dhis2.staged_dataset_service import delete_staged_dataset

        sqla_ids = {
            r.id
            for r in db.session.query(SqlaTable.id).all()
        }

        deleted: list[dict] = []
        errors: list[dict] = []

        for ds in db.session.query(StagedDataset).all():
            sid = ds.serving_superset_dataset_id
            is_orphan = sid is not None and sid not in sqla_ids
            if not is_orphan:
                continue
            try:
                delete_staged_dataset(ds.id)
                deleted.append({"id": ds.id, "name": ds.name})
                logger.info(
                    "cleanup_orphans: deleted orphaned staged dataset id=%s '%s'",
                    ds.id,
                    ds.name,
                )
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception(
                    "cleanup_orphans: failed to delete staged dataset id=%s", ds.id
                )
                errors.append({"id": ds.id, "name": ds.name, "error": str(exc)})

        return self.response(
            200,
            result={
                "deleted": deleted,
                "errors": errors,
                "message": (
                    f"Cleaned up {len(deleted)} orphaned staged dataset(s)."
                    + (f" {len(errors)} error(s)." if errors else "")
                ),
            },
        )
