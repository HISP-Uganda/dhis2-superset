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
from superset.dhis2.sync_service import schedule_staged_dataset_sync

logger = logging.getLogger(__name__)


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
        payload["staging_table_ref"] = DHIS2StagingEngine(
            dataset.database_id
        ).get_superset_sql_table_ref(dataset)
        try:
            serving_table_ref, serving_columns = svc.ensure_serving_table(pk)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to build serving definition for staged dataset id=%s", pk
            )
            serving_table_ref = None
            serving_columns = []
        payload["serving_table_ref"] = serving_table_ref
        payload["serving_columns"] = serving_columns
        try:
            serving_database = get_staging_database()
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Failed to resolve serving database for staged dataset id=%s", pk
            )
            serving_database = None
        if serving_database is not None:
            payload["serving_database_id"] = serving_database.id
            payload["serving_database_name"] = serving_database.name

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

        try:
            result = svc.query_serving_data(
                pk,
                selected_columns=selected_columns
                if isinstance(selected_columns, list)
                else None,
                filters=filters if isinstance(filters, list) else None,
                limit=int(limit or 100),
                page=int(page or 1),
            )
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error querying staged local data for dataset id=%s", pk
            )
            return self.response_500(message="Failed to query staged local data")

        return self.response(200, result=result)

    @expose("/<int:pk>/filters", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def get_local_filter_options(self, pk: int) -> Response:
        """Return hierarchy-aware org-unit and period filter options."""
        dataset = svc.get_staged_dataset(pk)
        if dataset is None:
            return self.response_404()

        body: dict[str, Any] = request.get_json() or {}
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
