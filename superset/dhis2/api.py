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
"""DHIS2 REST API endpoints."""
import logging
from typing import Any

from flask import request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset.extensions import event_logger

logger = logging.getLogger(__name__)


class DHIS2RestApi(BaseApi):
    """REST API for DHIS2 metadata and dataset building."""

    resource_name = "dhis2"
    csrf_exempt = False
    allow_browser_login = True
    openapi_spec_tag = "DHIS2"

    @expose("/metadata/data-elements", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "dhis2_metadata_fetch",
        log_to_statsd=False,
    )
    def get_data_elements(self) -> Response:
        """
        Fetch DHIS2 data elements (indicators, data elements, program indicators).

        When ``instance_id`` is provided the credentials for that specific
        DHIS2 instance are used instead of the database-level credentials,
        enabling multi-instance metadata retrieval without changing the URL
        of the existing endpoint.

        ---
        get:
          summary: Get DHIS2 data elements
          parameters:
            - in: query
              name: database_id
              required: true
              schema:
                type: integer
              description: Database ID
            - in: query
              name: instance_id
              required: false
              schema:
                type: integer
              description: >
                Optional DHIS2 instance ID.  When supplied, credentials are
                sourced from the identified DHIS2Instance record rather than
                the database-level configuration.
            - in: query
              name: type
              schema:
                type: string
                enum: [all, indicators, dataElements, dataSets, programIndicators]
              description: Filter by element type
            - in: query
              name: search
              schema:
                type: string
              description: Search term
            - in: query
              name: page
              schema:
                type: integer
                default: 1
              description: Page number
            - in: query
              name: page_size
              schema:
                type: integer
                default: 50
              description: Items per page
          responses:
            200:
              description: Data elements retrieved
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      items:
                        type: array
                        items:
                          type: object
                      total:
                        type: integer
                      pager:
                        type: object
            400:
              description: Bad request
            404:
              description: Database not found or instance not found
        """
        from superset.dhis2.metadata import get_metadata_fetcher

        database_id = request.args.get('database_id', type=int)
        if not database_id:
            return self.response_400(message="database_id is required")

        element_type = request.args.get('type', 'all')
        search = request.args.get('search')
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)

        # ------------------------------------------------------------------
        # Optional instance_id: override credentials from a DHIS2Instance.
        # ------------------------------------------------------------------
        instance_id = request.args.get('instance_id', type=int)
        if instance_id is not None:
            from superset.dhis2 import instance_service as inst_svc

            dhis2_instance = inst_svc.get_instance(instance_id)
            if dhis2_instance is None:
                return self.response_404()

            # Build a fetcher using the instance's URL and credentials.
            from superset.dhis2.metadata import DHIS2MetadataFetcher

            fetcher = DHIS2MetadataFetcher(
                base_url=dhis2_instance.url,
                username=dhis2_instance.username or "",
                password=dhis2_instance.password or "",
            )
            # Inject PAT token when the instance uses token-based auth,
            # overriding the Basic-auth session that DHIS2MetadataFetcher sets
            # up by default.
            if dhis2_instance.auth_type == "pat" and dhis2_instance.access_token:
                fetcher.session.auth = None
                fetcher.session.headers.update(
                    dhis2_instance.get_auth_headers()
                )
        else:
            fetcher = get_metadata_fetcher(database_id)
            if not fetcher:
                return self.response_404()

        try:
            result = fetcher.fetch_data_elements(element_type, search, page, page_size)
            return self.response(200, **result)
        except Exception as e:
            logger.error(f"Error fetching data elements: {e}")
            return self.response_500(message=str(e))

    @expose("/metadata/org-units", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "dhis2_metadata_fetch",
        log_to_statsd=False,
    )
    def get_org_units(self) -> Response:
        """
        Fetch DHIS2 organization units.

        ---
        get:
          summary: Get DHIS2 organization units
          parameters:
            - in: query
              name: database_id
              required: true
              schema:
                type: integer
            - in: query
              name: level
              schema:
                type: integer
              description: Org unit level filter
            - in: query
              name: search
              schema:
                type: string
            - in: query
              name: page
              schema:
                type: integer
                default: 1
            - in: query
              name: page_size
              schema:
                type: integer
                default: 50
          responses:
            200:
              description: Org units retrieved
            400:
              description: Bad request
            404:
              description: Database not found
        """
        from superset.dhis2.metadata import get_metadata_fetcher

        database_id = request.args.get('database_id', type=int)
        if not database_id:
            return self.response_400(message="database_id is required")

        level = request.args.get('level', type=int)
        search = request.args.get('search')
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)

        fetcher = get_metadata_fetcher(database_id)
        if not fetcher:
            return self.response_404()

        try:
            result = fetcher.fetch_org_units(level, search, page, page_size)
            return self.response(200, **result)
        except Exception as e:
            logger.error(f"Error fetching org units: {e}")
            return self.response_500(message=str(e))

    @expose("/dataset/generate-sql", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "dhis2_generate_sql",
        log_to_statsd=False,
    )
    def generate_sql(self) -> Response:
        """
        Generate SQL query for DHIS2 dataset based on selected data elements.

        ---
        post:
          summary: Generate SQL for DHIS2 dataset
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    data_source:
                      type: string
                      enum: [analytics, dataValueSets, events, trackedEntityInstances]
                    data_element_ids:
                      type: array
                      items:
                        type: string
                    periods:
                      type: array
                      items:
                        type: string
                    org_units:
                      type: array
                      items:
                        type: string
                    filters:
                      type: object
          responses:
            200:
              description: SQL generated
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      sql:
                        type: string
                      comment:
                        type: string
            400:
              description: Bad request
        """
        data = request.json
        if not data:
            return self.response_400(message="Request body is required")

        data_source = data.get('data_source', 'analytics')
        data_element_ids = data.get('data_element_ids', [])
        periods = data.get('periods', [])

        if not data_element_ids:
            return self.response_400(message="At least one data element must be selected")

        # Generate DHIS2 API parameters for SQL comment
        dimension_params = []
        if data_element_ids:
            dimension_params.append(f"dx:{';'.join(data_element_ids)}")
        if periods:
            dimension_params.append(f"pe:{';'.join(periods)}")
        if (org_units := data.get('org_units', [])):
            dimension_params.append(f"ou:{';'.join(org_units)}")

        dimension_str = '&dimension='.join(dimension_params) if dimension_params else ''

        # Generate SQL based on data source
        if data_source == 'analytics':
            sql_comment = f"-- DHIS2: dimension={dimension_str}&displayProperty=NAME&skipMeta=false"
            sql_query = f"{sql_comment}\nSELECT * FROM analytics LIMIT 10000"

        elif data_source == 'dataValueSets':
            sql_comment = f"-- DHIS2 DataValueSets: dataElement={';'.join(data_element_ids)}"
            where_clauses = []
            if data_element_ids:
                where_clauses.append(f"dataElement IN ({', '.join(repr(de) for de in data_element_ids)})")
            if periods:
                where_clauses.append(f"period IN ({', '.join(repr(p) for p in periods)})")

            where_clause = ' AND '.join(where_clauses) if where_clauses else '1=1'
            sql_query = f"{sql_comment}\nSELECT * FROM dataValueSets WHERE {where_clause} LIMIT 10000"

        elif data_source == 'events':
            sql_comment = f"-- DHIS2 Events"
            sql_query = f"{sql_comment}\nSELECT * FROM events LIMIT 10000"

        else:
            return self.response_400(message=f"Unsupported data source: {data_source}")

        return self.response(200, sql=sql_query, comment=sql_comment)


class DHIS2CacheApi(BaseApi):
    """
    REST API for DHIS2 cache management.

    Provides endpoints to:
    - View cache statistics (hit rate, total requests)
    - Invalidate cache entries
    - Trigger cache warming
    - Toggle caching on/off
    """

    resource_name = "dhis2_cache"
    csrf_exempt = False
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Cache"

    @expose("/stats", methods=["GET"])
    @safe
    @protect()
    @permission_name("read")
    def get_stats(self) -> Response:
        """
        Get DHIS2 cache statistics.

        ---
        get:
          summary: Get DHIS2 cache statistics
          responses:
            200:
              description: Cache statistics
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      hits:
                        type: integer
                      misses:
                        type: integer
                      hit_rate_percent:
                        type: number
                      total_requests:
                        type: integer
        """
        try:
            from superset.db_engine_specs.dhis2_cache import DHIS2CacheService

            cache = DHIS2CacheService.get_instance()
            stats = cache.get_stats()

            return self.response(200, result=stats)
        except Exception as e:
            logger.error(f"Failed to get DHIS2 cache stats: {e}")
            return self.response_500(message=str(e))

    @expose("/invalidate", methods=["POST"])
    @safe
    @protect()
    @permission_name("write")
    def invalidate(self) -> Response:
        """
        Invalidate DHIS2 cache entries.

        ---
        post:
          summary: Invalidate DHIS2 cache
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    endpoint:
                      type: string
                      description: Specific endpoint to invalidate (or null for all)
          responses:
            200:
              description: Invalidation result
        """
        try:
            from superset.db_engine_specs.dhis2_cache import DHIS2CacheService

            data = request.get_json() or {}
            endpoint = data.get("endpoint")

            cache = DHIS2CacheService.get_instance()
            count = cache.invalidate(endpoint)

            logger.info(f"DHIS2 cache invalidated: {count} entries for endpoint={endpoint}")

            return self.response(200, result={
                "invalidated_count": count,
                "endpoint": endpoint,
            })
        except Exception as e:
            logger.error(f"Failed to invalidate DHIS2 cache: {e}")
            return self.response_500(message=str(e))

    @expose("/warm", methods=["POST"])
    @safe
    @protect()
    @permission_name("write")
    def warm(self) -> Response:
        """
        Trigger DHIS2 cache warming.

        ---
        post:
          summary: Trigger cache warming for DHIS2 datasets
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    database_id:
                      type: integer
                      description: DHIS2 database ID
                    async:
                      type: boolean
                      description: Run warming asynchronously via Celery
                      default: true
          responses:
            200:
              description: Warming triggered
        """
        try:
            data = request.get_json() or {}
            database_id = data.get("database_id")
            run_async = data.get("async", True)

            if not database_id:
                return self.response_400(message="database_id is required")

            if run_async:
                try:
                    from superset.tasks.dhis2_cache import warm_dhis2_cache
                    task = warm_dhis2_cache.delay(database_id)

                    return self.response(200, result={
                        "status": "started",
                        "task_id": task.id,
                        "message": "Cache warming started asynchronously",
                    })
                except Exception as e:
                    logger.warning(f"Celery not available, falling back to sync: {e}")
                    run_async = False

            if not run_async:
                from superset.tasks.dhis2_cache import warm_dhis2_cache
                result = warm_dhis2_cache(database_id)

                return self.response(200, result={
                    "status": "completed",
                    **result,
                })

        except Exception as e:
            logger.error(f"Failed to trigger DHIS2 cache warming: {e}")
            return self.response_500(message=str(e))

    @expose("/toggle", methods=["POST"])
    @safe
    @protect()
    @permission_name("write")
    def toggle(self) -> Response:
        """
        Enable or disable DHIS2 caching.

        ---
        post:
          summary: Toggle DHIS2 caching on/off
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    enabled:
                      type: boolean
                      description: Whether to enable caching
          responses:
            200:
              description: Toggle result
        """
        try:
            from superset.db_engine_specs.dhis2_cache import DHIS2CacheService

            data = request.get_json() or {}
            enabled = data.get("enabled", True)

            cache = DHIS2CacheService.get_instance()

            if enabled:
                cache.enable()
            else:
                cache.disable()

            return self.response(200, result={
                "enabled": cache.is_enabled,
            })
        except Exception as e:
            logger.error(f"Failed to toggle DHIS2 cache: {e}")
            return self.response_500(message=str(e))

    @expose("/query_async", methods=["POST"])
    @safe
    @protect()
    @permission_name("read")
    def query_async(self) -> Response:
        """
        Trigger an async dataset query in the background.

        This allows the frontend to start loading data without blocking,
        and poll for results when ready.

        ---
        post:
          summary: Start async dataset query
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - database_id
                    - sql_query
                  properties:
                    database_id:
                      type: integer
                      description: DHIS2 database ID
                    sql_query:
                      type: string
                      description: SQL query with DHIS2 params
                    cache_key:
                      type: string
                      description: Optional cache key for results
          responses:
            200:
              description: Query task started
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      task_id:
                        type: string
                      status:
                        type: string
        """
        try:
            data = request.get_json() or {}
            database_id = data.get("database_id")
            sql_query = data.get("sql_query")
            cache_key = data.get("cache_key")

            if not database_id:
                return self.response_400(message="database_id is required")
            if not sql_query:
                return self.response_400(message="sql_query is required")

            try:
                from superset.tasks.dhis2_cache import query_dataset_async
                task = query_dataset_async.delay(
                    database_id=database_id,
                    sql_query=sql_query,
                    cache_key=cache_key,
                )

                return self.response(200, result={
                    "status": "queued",
                    "task_id": task.id,
                    "cache_key": cache_key,
                    "message": "Query started in background",
                })
            except Exception as e:
                logger.warning(f"Celery not available for async query: {e}")
                return self.response_500(message="Background task service unavailable")

        except Exception as e:
            logger.error(f"Failed to start async query: {e}")
            return self.response_500(message=str(e))

    @expose("/query_status/<task_id>", methods=["GET"])
    @safe
    @protect()
    @permission_name("read")
    def query_status(self, task_id: str) -> Response:
        """
        Get status of an async query task.

        ---
        get:
          summary: Get async query status
          parameters:
            - in: path
              name: task_id
              required: true
              schema:
                type: string
          responses:
            200:
              description: Task status
        """
        try:
            from celery.result import AsyncResult
            from superset.extensions import celery_app

            result = AsyncResult(task_id, app=celery_app)

            response = {
                "task_id": task_id,
                "status": result.status,
                "ready": result.ready(),
            }

            if result.ready():
                if result.successful():
                    response["result"] = result.result
                else:
                    response["error"] = str(result.result)
            elif result.status == 'PROGRESS':
                response["progress"] = result.info

            return self.response(200, result=response)

        except Exception as e:
            logger.error(f"Failed to get task status: {e}")
            return self.response_500(message=str(e))

    @expose("/query_result/<cache_key>", methods=["GET"])
    @safe
    @protect()
    @permission_name("read")
    def query_result(self, cache_key: str) -> Response:
        """
        Get cached result of an async query.

        ---
        get:
          summary: Get cached query result
          parameters:
            - in: path
              name: cache_key
              required: true
              schema:
                type: string
          responses:
            200:
              description: Query result
            404:
              description: Result not found in cache
        """
        try:
            from superset.extensions import cache_manager

            cached = cache_manager.data_cache.get(f"dhis2_async_query_{cache_key}")

            if cached is None:
                return self.response_404()

            return self.response(200, result=cached)

        except Exception as e:
            logger.error(f"Failed to get cached result: {e}")
            return self.response_500(message=str(e))

    @expose("/prefetch_dashboard", methods=["POST"])
    @safe
    @protect()
    @permission_name("read")
    def prefetch_dashboard(self) -> Response:
        """
        Prefetch all DHIS2 chart data for a dashboard.

        Call this when a user opens a dashboard to start loading
        all chart data in the background.

        ---
        post:
          summary: Prefetch dashboard data
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - dashboard_id
                  properties:
                    dashboard_id:
                      type: integer
                      description: Dashboard ID to prefetch
                    database_ids:
                      type: array
                      items:
                        type: integer
                      description: Optional list of DHIS2 database IDs
          responses:
            200:
              description: Prefetch started
        """
        try:
            data = request.get_json() or {}
            dashboard_id = data.get("dashboard_id")
            database_ids = data.get("database_ids")

            if not dashboard_id:
                return self.response_400(message="dashboard_id is required")

            try:
                from superset.tasks.dhis2_cache import prefetch_dashboard_data
                task = prefetch_dashboard_data.delay(
                    dashboard_id=dashboard_id,
                    database_ids=database_ids,
                )

                return self.response(200, result={
                    "status": "started",
                    "task_id": task.id,
                    "dashboard_id": dashboard_id,
                    "message": "Dashboard prefetch started",
                })
            except Exception as e:
                logger.warning(f"Celery not available for prefetch: {e}")
                return self.response_500(message="Background task service unavailable")

        except Exception as e:
            logger.error(f"Failed to start dashboard prefetch: {e}")
            return self.response_500(message=str(e))
