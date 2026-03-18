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
import json
import logging
import re
from typing import Any

from flask import current_app as app, request
from flask_appbuilder.api import expose, protect, safe

from superset import event_logger
from superset.connectors.sqla.models import BaseDatasource
from superset.daos.datasource import DatasourceDAO
from superset.daos.exceptions import DatasourceNotFound, DatasourceTypeNotSupportedError
from superset.exceptions import SupersetSecurityException
from superset.superset_typing import FlaskResponse
from superset.utils.core import apply_max_row_limit, DatasourceType, SqlExpressionType
from superset.views.base_api import BaseSupersetApi, statsd_metrics

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DHIS2 staging helpers
# ---------------------------------------------------------------------------

_SAFE_COLUMN_RE = re.compile(r'^[A-Za-z0-9_\- ]+$')
_STAGING_COL_LIMIT = 2000


def _get_dhis2_staged_dataset_id(datasource: Any) -> int | None:
    """Return the DHIS2 staged dataset ID if *datasource* is backed by one.

    The ``extra`` JSON field on the SqlaTable is set by
    :func:`~superset.dhis2.superset_dataset_service.register_serving_table_as_superset_dataset`
    and contains ``{"dhis2_staged_dataset_id": <int>}``.
    Returns ``None`` for any non-DHIS2-staging dataset.
    """
    try:
        extra = getattr(datasource, "extra", None)
        if not extra:
            return None
        if isinstance(extra, str):
            extra = json.loads(extra)
        val = extra.get("dhis2_staged_dataset_id")
        if val is None:
            return None
        id_ = int(val)
        return id_ if id_ > 0 else None
    except Exception:  # pylint: disable=broad-except
        return None


def _column_values_from_staging(
    staged_dataset_id: int,
    column_name: str,
    limit: int,
    cascade_parent_column: str | None = None,
    cascade_parent_values: Any = None,
) -> list[str]:
    """Query the serving table directly for distinct column values.

    Bypasses the DHIS2 dialect so that filter selects show real staged data
    rather than attempting live API calls to the DHIS2 server.

    Cascade filtering: when *cascade_parent_column* and *cascade_parent_values*
    are provided, a ``WHERE parent IN (...)`` clause is added so child filters
    (e.g. facility list) narrow when the user selects a parent value (e.g.
    district).
    """
    from sqlalchemy import text

    from superset import db
    from superset.dhis2.models import DHIS2StagedDataset
    from superset.local_staging.engine_factory import get_active_staging_engine

    if not _SAFE_COLUMN_RE.match(column_name):
        logger.warning(
            "staging column-values: unsafe column name %r for dataset %d — skipping",
            column_name,
            staged_dataset_id,
        )
        return []

    dataset: DHIS2StagedDataset | None = (
        db.session.query(DHIS2StagedDataset)
        .filter_by(id=staged_dataset_id)
        .first()
    )
    if dataset is None:
        logger.warning(
            "staging column-values: staged dataset id=%d not found", staged_dataset_id
        )
        return []

    try:
        engine = get_active_staging_engine(dataset.database_id)
        table_ref = engine.get_serving_sql_table_ref(dataset)
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "staging column-values: could not get serving table ref for dataset id=%d",
            staged_dataset_id,
        )
        return []

    quoted_col = f'"{column_name}"'
    safe_limit = max(1, min(int(limit), _STAGING_COL_LIMIT))

    # Build optional cascade WHERE clause
    cascade_clause = ""
    cascade_params: dict[str, Any] = {}
    if (
        cascade_parent_column
        and _SAFE_COLUMN_RE.match(cascade_parent_column)
        and cascade_parent_values
    ):
        parent_vals: list[str] = (
            cascade_parent_values
            if isinstance(cascade_parent_values, list)
            else [str(cascade_parent_values)]
        )
        # Build parameterised IN clause — one bind var per value
        placeholders = ", ".join(f":cv{i}" for i in range(len(parent_vals)))
        cascade_clause = (
            f' AND "{cascade_parent_column}" IN ({placeholders})'
        )
        cascade_params = {f"cv{i}": v for i, v in enumerate(parent_vals)}

    sql = (
        f"SELECT DISTINCT {quoted_col} FROM {table_ref}"
        f" WHERE {quoted_col} IS NOT NULL{cascade_clause}"
        f" ORDER BY {quoted_col} LIMIT {safe_limit}"
    )

    try:
        from superset.dhis2.staging_engine import DHIS2StagingEngine  # pylint: disable=import-outside-toplevel
        with db.engine.connect() as conn:
            DHIS2StagingEngine.apply_connection_optimizations(
                conn, str(getattr(db.engine.dialect, "name", "") or "")
            )
            rows = conn.execute(text(sql), cascade_params).fetchall()
        return [str(row[0]) for row in rows if row[0] is not None]
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "staging column-values: query failed for dataset id=%d column=%r",
            staged_dataset_id,
            column_name,
        )
        return []


class DatasourceRestApi(BaseSupersetApi):
    allow_browser_login = True
    class_permission_name = "Datasource"
    resource_name = "datasource"
    openapi_spec_tag = "Datasources"

    @expose(
        "/<datasource_type>/<int:datasource_id>/column/<column_name>/values/",
        methods=("GET",),
    )
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".get_column_values",
        log_to_statsd=False,
    )
    def get_column_values(
        self, datasource_type: str, datasource_id: int, column_name: str
    ) -> FlaskResponse:
        """Get possible values for a datasource column.
        ---
        get:
          summary: Get possible values for a datasource column
          parameters:
          - in: path
            schema:
              type: string
            name: datasource_type
            description: The type of datasource
          - in: path
            schema:
              type: integer
            name: datasource_id
            description: The id of the datasource
          - in: path
            schema:
              type: string
            name: column_name
            description: The name of the column to get values for
          - in: query
            schema:
              type: string
            name: cascade_parent_column
            description: The parent column for cascading filters
            required: false
          - in: query
            schema:
              type: string
            name: cascade_parent_value
            description: The selected value(s) from parent filter (comma-separated)
            required: false
          responses:
            200:
              description: A List of distinct values for the column
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        items:
                          oneOf:
                            - type: string
                            - type: integer
                            - type: number
                            - type: boolean
                            - type: object
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            datasource = DatasourceDAO.get_datasource(
                DatasourceType(datasource_type), datasource_id
            )
            datasource.raise_for_access()
        except ValueError:
            return self.response(
                400, message=f"Invalid datasource type: {datasource_type}"
            )
        except DatasourceTypeNotSupportedError as ex:
            return self.response(400, message=ex.message)
        except DatasourceNotFound as ex:
            return self.response(404, message=ex.message)
        except SupersetSecurityException as ex:
            return self.response(403, message=ex.message)

        from flask import request, g
        row_limit = apply_max_row_limit(app.config["FILTER_SELECT_ROW_LIMIT"])
        denormalize_column = not datasource.normalize_columns

        # Cascade filter parameters (forwarded to both staging and dialect paths)
        cascade_parent_column = request.args.get("cascade_parent_column")
        if (cascade_parent_value := request.args.get("cascade_parent_value")):
            parent_values = (
                cascade_parent_value.split(",")
                if "," in cascade_parent_value
                else cascade_parent_value
            )
        else:
            parent_values = None

        # ------------------------------------------------------------------
        # DHIS2 Staging path — if this SqlaTable was registered from a DHIS2
        # staged dataset, query the serving table directly instead of routing
        # through the DHIS2 dialect (which makes API calls to the DHIS2 server
        # and cannot see the local staging data).
        # ------------------------------------------------------------------
        staged_dataset_id = _get_dhis2_staged_dataset_id(datasource)
        if staged_dataset_id is not None:
            payload = _column_values_from_staging(
                staged_dataset_id=staged_dataset_id,
                column_name=column_name,
                limit=row_limit,
                cascade_parent_column=cascade_parent_column,
                cascade_parent_values=parent_values,
            )
            return self.response(200, result=payload)

        # Store cascade params in Flask g for DHIS2 dialect to access
        if cascade_parent_column and parent_values:
            g.dhis2_cascade_parent_column = cascade_parent_column
            g.dhis2_cascade_parent_value = parent_values
            g.dhis2_cascade_child_column = column_name
        g.dhis2_is_native_filter = True

        try:
            payload = datasource.values_for_column(
                column_name=column_name,
                limit=row_limit,
                denormalize_column=denormalize_column,
                cascade_parent_column=cascade_parent_column,
                cascade_parent_value=parent_values,
            )
            return self.response(200, result=payload)
        except KeyError:
            return self.response(
                400, message=f"Column name {column_name} does not exist"
            )
        except NotImplementedError:
            return self.response(
                400,
                message=(
                    "Unable to get column values for "
                    f"datasource type: {datasource_type}"
                ),
            )

    @expose(
        "/<datasource_type>/<int:datasource_id>/validate_expression/",
        methods=("POST",),
    )
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".validate_expression",
        log_to_statsd=False,
    )
    def validate_expression(
        self, datasource_type: str, datasource_id: int
    ) -> FlaskResponse:
        """Validate a SQL expression against a datasource.
        ---
        post:
          summary: Validate a SQL expression against a datasource
          parameters:
          - in: path
            schema:
              type: string
            name: datasource_type
            description: The type of datasource
          - in: path
            schema:
              type: integer
            name: datasource_id
            description: The id of the datasource
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    expression:
                      type: string
                      description: The SQL expression to validate
                    expression_type:
                      type: string
                      enum: [column, metric, where, having]
                      description: The type of SQL expression
                      default: where
                    clause:
                      type: string
                      enum: [WHERE, HAVING]
                      description: SQL clause type for filter expressions
                  required:
                    - expression
          responses:
            200:
              description: Validation result
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        description: Empty array for success, errors for failure
                        items:
                          type: object
                          properties:
                            message:
                              type: string
                            line_number:
                              type: integer
                            start_column:
                              type: integer
                            end_column:
                              type: integer
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            # Get datasource
            datasource = self._get_datasource_for_validation(
                datasource_type, datasource_id
            )

            # Parse and validate request
            expression, expression_type_enum = self._parse_validation_request()

            # Perform validation
            result = datasource.validate_expression(
                expression=expression,
                expression_type=expression_type_enum,
            )

            # Convert our format to match frontend expectations
            if result["valid"]:
                return self.response(200, result=[])
            else:
                return self.response(200, result=result["errors"])

        except ValueError as ex:
            return self.response(400, message=str(ex))
        except DatasourceTypeNotSupportedError as ex:
            return self.response(400, message=ex.message)
        except DatasourceNotFound as ex:
            return self.response(404, message=ex.message)
        except SupersetSecurityException as ex:
            return self.response(403, message=ex.message)
        except NotImplementedError:
            return self.response(
                400,
                message=(
                    "Unable to validate expression for "
                    f"datasource type: {datasource_type}"
                ),
            )
        except Exception as ex:
            return self.response(500, message=f"Error validating expression: {str(ex)}")

    def _get_datasource_for_validation(
        self, datasource_type: str, datasource_id: int
    ) -> BaseDatasource:
        """Get datasource for validation endpoint. Raises exceptions on error."""
        try:
            datasource = DatasourceDAO.get_datasource(
                DatasourceType(datasource_type), datasource_id
            )
            datasource.raise_for_access()
            return datasource
        except ValueError:
            raise ValueError(f"Invalid datasource type: {datasource_type}") from None
        # Let other exceptions propagate as-is

    def _parse_validation_request(self) -> tuple[str, SqlExpressionType]:
        """Parse and validate request data. Raises ValueError on error."""
        request_data = request.json or {}
        expression = request_data.get("expression")
        expression_type = request_data.get("expression_type", "where")

        if not expression:
            raise ValueError("Expression is required")

        # Convert string expression_type to SqlExpressionType enum
        expression_type_enum = self._convert_expression_type_for_validation(
            expression_type
        )

        return expression, expression_type_enum

    def _convert_expression_type_for_validation(
        self, expression_type: str
    ) -> SqlExpressionType:
        """Convert expression type to enum. Raises ValueError on error."""
        try:
            return SqlExpressionType(expression_type)
        except ValueError:
            raise ValueError(
                f"Invalid expression type: {expression_type}. "
                f"Valid types are: column, metric, where, having"
            ) from None
