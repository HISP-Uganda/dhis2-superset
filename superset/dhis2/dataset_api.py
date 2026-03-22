"""
DHIS2 Dataset REST API

Provides endpoints for optimized dataset management:
- Dataset preview with pagination
- Cached metadata retrieval
- Column detection
- Cache management
"""

import logging
from typing import Any, Dict, Union, Tuple

from flask import Response, jsonify, request
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name

from superset import db
from superset.models.core import Database
from superset.dhis2.dataset_cache import DHIS2DatasetMetadataCache

logger = logging.getLogger(__name__)


class DHIS2DatasetRestApi(BaseApi):
    """REST API for optimized DHIS2 dataset management."""

    resource_name = "dhis2_dataset"
    csrf_exempt = False
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Dataset"

    class_permission_name = "Database"
    method_permission_name = {
        "get_preview": "read",
        "get_data_elements": "read",
        "get_columns": "read",
        "get_cache_stats": "read",
        "clear_cache": "edit",
    }

    @expose("/<int:database_id>/preview/", methods=["POST"])
    @safe
    def get_preview(self, database_id: int) -> Union[Response, Tuple[Response, int]]:
        """
        Get paginated dataset preview with caching.

        Request body:
        {
          "endpoint": "analytics|dataValueSets|events",
          "dimension": "dx:uid1;uid2;pe:LAST_YEAR;ou:LEVEL-2",
          "limit": 50,
          "offset": 0,
          "columns": ["col1", "col2"]  # Optional: limit returned columns
        }

        Returns:
        {
          "data": [...],
          "columns": [...],
          "total_rows": 1000,
          "cached": true,
          "load_time_ms": 245
        }
        """
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            payload = request.get_json() or {}
            endpoint = payload.get("endpoint", "analytics")
            dimension = payload.get("dimension", "")
            limit = min(int(payload.get("limit", 50)), 1000)
            offset = int(payload.get("offset", 0))
            columns = payload.get("columns", [])

            import time

            start_time = time.time()

            # Check cache
            cache_key = f"{endpoint}_{dimension}_{limit}_{offset}"
            cached_result = DHIS2DatasetMetadataCache.get_metadata(
                database_id,
                cache_key,
            )

            if cached_result:
                elapsed = int((time.time() - start_time) * 1000)
                cached_result["cached"] = True
                cached_result["load_time_ms"] = elapsed
                return jsonify(cached_result)

            # Fetch fresh data (implementation depends on DHIS2 connection)
            # This would call the DHIS2 API via the database driver
            # For now, return placeholder
            result = {
                "data": [],
                "columns": columns or [],
                "total_rows": 0,
                "cached": False,
                "load_time_ms": int((time.time() - start_time) * 1000),
            }

            # Cache result
            DHIS2DatasetMetadataCache.set_metadata(
                db,
                database_id,
                "preview",
                cache_key,
                result,
                ttl_hours=4,
            )

            return jsonify(result)

        except Exception as e:
            logger.exception(f"Error getting preview for database {database_id}")
            return jsonify({"error": str(e)}), 500

    @expose("/<int:database_id>/data_elements/", methods=["GET"])
    @safe
    def get_data_elements(
        self, database_id: int
    ) -> Union[Response, Tuple[Response, int]]:
        """
        Get cached list of available data elements.

        Query parameters:
        - search: Filter data elements by name
        - type: Filter by element type (dataElement, indicator, etc.)
        - limit: Max results (default 100, max 1000)

        Returns:
        {
          "data_elements": [
            {"id": "uid", "name": "Display Name", "type": "dataElement"}
          ],
          "total": 450,
          "cached": true,
          "load_time_ms": 89
        }
        """
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            search = request.args.get("search", "")
            elem_type = request.args.get("type", "")
            limit = min(int(request.args.get("limit", 100)), 1000)

            import time

            start_time = time.time()

            # Check cache
            cache_key = f"data_elements_{search}_{elem_type}_{limit}"
            cached_result = DHIS2DatasetMetadataCache.get_metadata(
                database_id,
                cache_key,
            )

            if cached_result:
                elapsed = int((time.time() - start_time) * 1000)
                cached_result["cached"] = True
                cached_result["load_time_ms"] = elapsed
                return jsonify(cached_result)

            # Placeholder for fetching data elements
            result = {
                "data_elements": [],
                "total": 0,
                "cached": False,
                "load_time_ms": int((time.time() - start_time) * 1000),
            }

            # Cache result
            DHIS2DatasetMetadataCache.set_metadata(
                db,
                database_id,
                "data_elements",
                cache_key,
                result,
                ttl_hours=4,
            )

            return jsonify(result)

        except Exception as e:
            logger.exception(f"Error getting data elements for database {database_id}")
            return jsonify({"error": str(e)}), 500

    @expose("/<int:database_id>/columns/", methods=["GET"])
    @safe
    def get_columns(self, database_id: int) -> Union[Response, Tuple[Response, int]]:
        """
        Get detected columns for a dataset with caching.

        Query parameters:
        - endpoint: analytics, dataValueSets, etc.
        - dimension: DHIS2 dimension string

        Returns:
        {
          "columns": [
            {"name": "col_name", "type": "string", "is_numeric": false}
          ],
          "cached": true,
          "load_time_ms": 156
        }
        """
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            endpoint = request.args.get("endpoint", "analytics")
            dimension = request.args.get("dimension", "")

            import time

            start_time = time.time()

            cache_key = f"columns_{endpoint}_{dimension}"
            cached_result = DHIS2DatasetMetadataCache.get_metadata(
                database_id,
                cache_key,
            )

            if cached_result:
                elapsed = int((time.time() - start_time) * 1000)
                cached_result["cached"] = True
                cached_result["load_time_ms"] = elapsed
                return jsonify(cached_result)

            result = {
                "columns": [],
                "cached": False,
                "load_time_ms": int((time.time() - start_time) * 1000),
            }

            DHIS2DatasetMetadataCache.set_metadata(
                db,
                database_id,
                "columns",
                cache_key,
                result,
                ttl_hours=4,
            )

            return jsonify(result)

        except Exception as e:
            logger.exception(f"Error getting columns for database {database_id}")
            return jsonify({"error": str(e)}), 500

    @expose("/<int:database_id>/cache_stats/", methods=["GET"])
    @safe
    def get_cache_stats(self, database_id: int) -> Union[Response, Tuple[Response, int]]:
        """Get cache statistics for a database."""
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            stats = DHIS2DatasetMetadataCache.get_cache_stats(database_id)
            return jsonify(stats)

        except Exception as e:
            logger.exception(f"Error getting cache stats for database {database_id}")
            return jsonify({"error": str(e)}), 500

    @expose("/<int:database_id>/clear_cache/", methods=["POST"])
    @safe
    @permission_name("edit")
    def clear_cache(self, database_id: int) -> Union[Response, Tuple[Response, int]]:
        """
        Clear all cached metadata for a database.

        Query parameters:
        - cache_type: Optional specific cache type to clear (all if not specified)

        Returns:
        {
          "cleared_entries": 5,
          "message": "Cleared all cached metadata"
        }
        """
        try:
            database = db.session.query(Database).get(database_id)
            if not database:
                return jsonify({"error": "Database not found"}), 404

            cache_type = request.args.get("cache_type")
            count = DHIS2DatasetMetadataCache.invalidate_cache(
                database_id,
                cache_type,
            )

            return jsonify({
                "cleared_entries": count,
                "message": f"Cleared {count} cached metadata entries",
            })

        except Exception as e:
            logger.exception(f"Error clearing cache for database {database_id}")
            return jsonify({"error": str(e)}), 500
