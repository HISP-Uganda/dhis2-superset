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
"""DHIS2 dataValueSets fetching and caching service."""
import logging
from typing import Any, Dict, List, Optional

from flask import jsonify, request
from werkzeug.wrappers import Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset import db
from superset.extensions import cache_manager, event_logger
from superset.models.core import Database
from superset.dhis2.data_values import (
    build_data_value_params,
    convert_to_data_values_response,
)

logger = logging.getLogger(__name__)

DATA_VALUES_CACHE_TIMEOUT = 3600


class DHIS2DataValuesRestApi(BaseApi):
    """REST API for DHIS2 dataValueSets data."""

    resource_name = "dhis2_data_values"
    csrf_exempt = False
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Data Values"

    @expose("/<int:database_id>/", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "dhis2_data_values_fetch",
        log_to_statsd=False,
    )
    def get_data_values(self, database_id: int) -> Response:
        """
        Fetch data values from DHIS2 dataValueSets API.

        Query Parameters (required):
        - dataSet: Dataset UID
        - orgUnit: Comma-separated org unit UIDs (concrete, not relative)
        - period: Comma-separated period codes (2020,2021 format, not LAST_5_YEARS)

        Query Parameters (optional):
        - dataElement: Comma-separated data element UIDs
        - includeChildren: Include child org units (true/false)
        - format: json (default) or csv

        ---
        get:
          summary: Get DHIS2 data values
          parameters:
            - in: path
              name: database_id
              required: true
              schema:
                type: integer
              description: Database ID
            - in: query
              name: dataSet
              required: true
              schema:
                type: string
              description: Dataset UID
            - in: query
              name: orgUnit
              required: true
              schema:
                type: string
              description: Comma-separated organisation unit UIDs (concrete, not USER_ORGUNIT keywords)
            - in: query
              name: period
              required: true
              schema:
                type: string
              description: Comma-separated period codes (e.g., 2020,2021,2022)
            - in: query
              name: dataElement
              required: false
              schema:
                type: string
              description: Comma-separated data element UIDs
            - in: query
              name: includeChildren
              required: false
              schema:
                type: boolean
                default: false
              description: Include child org units
            - in: query
              name: format
              schema:
                type: string
                enum: [json, csv]
                default: json
              description: Output format
          responses:
            200:
              description: Data values from DHIS2
              content:
                application/json:
                  schema:
                    type: object
            400:
              description: Invalid parameters
            404:
              description: Database not found
            500:
              description: Failed to fetch data values
        """
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            dataset_uid = request.args.get("dataSet", type=str)
            org_units_str = request.args.get("orgUnit", type=str)
            periods_str = request.args.get("period", type=str)
            data_elements_str = request.args.get("dataElement", type=str)
            include_children = request.args.get(
                "includeChildren",
                type=lambda x: x.lower() == "true",
                default=False,
            )

            if not dataset_uid:
                return jsonify({"error": "dataSet parameter is required"}), 400

            if not org_units_str:
                return jsonify({"error": "orgUnit parameter is required"}), 400

            if not periods_str:
                return jsonify({"error": "period parameter is required"}), 400

            org_units = [ou.strip() for ou in org_units_str.split(",") if ou.strip()]
            periods = [p.strip() for p in periods_str.split(",") if p.strip()]
            data_elements = (
                [de.strip() for de in data_elements_str.split(",") if de.strip()]
                if data_elements_str
                else None
            )

            data_values = get_cached_data_values(
                database_id=database_id,
                dataset_uid=dataset_uid,
                org_units=org_units,
                periods=periods,
                data_elements=data_elements,
                include_children=include_children,
                database=database,
            )

            return jsonify(data_values)
        except ValueError as e:
            logger.warning(f"Invalid request for database {database_id}: {e}")
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            logger.exception(f"Error fetching data values for database {database_id}")
            return jsonify({"error": str(e)}), 500


def get_cached_data_values(
    database_id: int,
    dataset_uid: str,
    org_units: List[str],
    periods: List[str],
    data_elements: Optional[List[str]] = None,
    include_children: bool = False,
    database: Optional[Database] = None,
) -> Dict[str, Any]:
    """
    Get data values from cache or fetch from DHIS2.

    Args:
        database_id: Superset database ID
        dataset_uid: Dataset UID
        org_units: List of organisation unit UIDs
        periods: List of period codes
        data_elements: Optional list of data element UIDs
        include_children: Include child org units
        database: Database object (optional, will be fetched if not provided)

    Returns:
        Data values dictionary
    """
    cache_key = (
        f"dhis2_data_values_{database_id}_{dataset_uid}_"
        f"{'_'.join(sorted(org_units))}_{'_'.join(sorted(periods))}_"
        f"{'_'.join(sorted(data_elements or []))}_{'_'.join(str(include_children))}"
    )

    if (cached := cache_manager.cache.get(cache_key)):
        logger.info(f"Returning cached data values for {cache_key}")
        return cached

    if not database:
        database = db.session.query(Database).get(database_id)
        if not database:
            raise ValueError(f"Database {database_id} not found")

    data_values = fetch_data_values_from_dhis2(
        database=database,
        dataset_uid=dataset_uid,
        org_units=org_units,
        periods=periods,
        data_elements=data_elements,
        include_children=include_children,
    )

    cache_manager.cache.set(
        cache_key, data_values, timeout=DATA_VALUES_CACHE_TIMEOUT
    )
    return data_values


def fetch_data_values_from_dhis2(
    database: Database,
    dataset_uid: str,
    org_units: List[str],
    periods: List[str],
    data_elements: Optional[List[str]] = None,
    include_children: bool = False,
) -> Dict[str, Any]:
    """
    Fetch data values from DHIS2 instance.

    Args:
        database: Superset database object
        dataset_uid: Dataset UID
        org_units: List of organisation unit UIDs (must be concrete, not relative keywords)
        periods: List of period codes (must be fixed periods, not relative like LAST_5_YEARS)
        data_elements: Optional list of data element UIDs
        include_children: Include child org units

    Returns:
        Data values dictionary

    Raises:
        ValueError: If database is not DHIS2 or if parameters are invalid
    """
    try:
        from superset.db_engine_specs.dhis2 import DHIS2

        engine = database.get_sqla_engine()
        if not isinstance(engine.dialect, DHIS2):
            raise ValueError(f"Database {database.id} is not a DHIS2 instance")

        params = build_data_value_params(
            dataset_uid=dataset_uid,
            org_units=org_units,
            periods=periods,
            data_elements=data_elements,
            include_children=include_children,
        )

        response = engine.dialect.fetch_data_values(params)

        standardized = convert_to_data_values_response(response)

        return standardized

    except Exception as e:
        logger.exception(f"Failed to fetch data values from DHIS2")
        raise


def invalidate_data_values_cache(database_id: int) -> None:
    """Invalidate all data values cache for a database."""
    try:
        from superset.cache import BaseCache

        if hasattr(cache_manager.cache, "cache"):
            cache_obj = cache_manager.cache.cache
            if isinstance(cache_obj, BaseCache):
                pattern = f"dhis2_data_values_{database_id}_*"
                cache_obj.delete_mget(cache_obj.cache.keys(pattern))
    except Exception as e:
        logger.warning(f"Failed to invalidate data values cache: {e}")
