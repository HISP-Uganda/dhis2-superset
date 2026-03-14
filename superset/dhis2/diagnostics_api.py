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
DHIS2 Diagnostics REST API

Observability endpoints for the multi-instance DHIS2 integration.

Routes
------
``GET /health/<database_id>``         – Full health check for a database federation
``GET /instance/<instance_id>``       – Detailed instance diagnostic
``GET /sync-history/<database_id>``   – Recent sync job history for a database
``GET /stale/<database_id>``          – Stale/never-synced datasets for a database
``GET /admin/summary``                – System-wide admin summary
"""

from __future__ import annotations

import logging

from flask import request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset.dhis2.diagnostics import DHIS2DiagnosticsService

logger = logging.getLogger(__name__)

_svc = DHIS2DiagnosticsService()


class DHIS2DiagnosticsApi(BaseApi):
    """REST API exposing health checks and diagnostics for DHIS2 multi-instance federation.

    Endpoints are mounted under ``/api/v1/dhis2/diagnostics/``.
    All endpoints require authentication via Superset's standard ``@protect()`` decorator.
    """

    resource_name = "dhis2/diagnostics"
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Diagnostics"

    # ------------------------------------------------------------------
    # Federation health
    # ------------------------------------------------------------------

    @expose("/metadata-status/<int:database_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def metadata_status(self, database_id: int) -> Response:
        try:
            result = _svc.get_metadata_status(database_id)
            return self.response(200, result=result)
        except ValueError:
            return self.response_404()
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: get_metadata_status failed for database_id=%s",
                database_id,
            )
            return self.response_500(message=str(exc))

    @expose("/metadata-refresh/<int:database_id>", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def metadata_refresh(self, database_id: int) -> Response:
        try:
            result = _svc.request_metadata_refresh(database_id)
            return self.response(200, result=result)
        except ValueError:
            return self.response_404()
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: request_metadata_refresh failed for database_id=%s",
                database_id,
            )
            return self.response_500(message=str(exc))

    @expose("/health/<int:database_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def federation_health(self, database_id: int) -> Response:
        """Full health snapshot for all instances and staged datasets under a database.

        ---
        get:
          summary: DHIS2 federation health for a database
          parameters:
            - in: path
              name: database_id
              schema:
                type: integer
              required: true
          responses:
            200:
              description: Health snapshot
            500:
              $ref: '#/components/responses/500'
        """
        try:
            result = _svc.get_federation_health(database_id)
            return self.response(200, **result)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: get_federation_health failed for database_id=%s", database_id
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Instance diagnostic
    # ------------------------------------------------------------------

    @expose("/instance/<int:instance_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def instance_diagnostic(self, instance_id: int) -> Response:
        """Detailed diagnostic for a single DHIS2 instance (includes live connection test).

        ---
        get:
          summary: DHIS2 instance diagnostic
          parameters:
            - in: path
              name: instance_id
              schema:
                type: integer
              required: true
          responses:
            200:
              description: Instance diagnostic
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            result = _svc.get_instance_diagnostic(instance_id)
            return self.response(200, **result)
        except ValueError as exc:
            return self.response_404()
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: get_instance_diagnostic failed for instance_id=%s", instance_id
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Sync history
    # ------------------------------------------------------------------

    @expose("/sync-history/<int:database_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def sync_history(self, database_id: int) -> Response:
        """Recent sync job history across all staged datasets for a database.

        Accepts optional ``limit`` query parameter (default 50).

        ---
        get:
          summary: DHIS2 sync job history for a database
          parameters:
            - in: path
              name: database_id
              schema:
                type: integer
              required: true
            - in: query
              name: limit
              schema:
                type: integer
              required: false
          responses:
            200:
              description: List of sync jobs
            500:
              $ref: '#/components/responses/500'
        """
        try:
            limit = int(request.args.get("limit", 50))
            jobs = _svc.get_sync_history(database_id, limit=limit)
            return self.response(200, result=jobs, count=len(jobs))
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: get_sync_history failed for database_id=%s", database_id
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Stale datasets
    # ------------------------------------------------------------------

    @expose("/stale/<int:database_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def stale_datasets(self, database_id: int) -> Response:
        """Return datasets that are stale or have never been synced.

        Accepts optional ``threshold_hours`` query parameter (default 25).

        ---
        get:
          summary: Stale DHIS2 datasets for a database
          parameters:
            - in: path
              name: database_id
              schema:
                type: integer
              required: true
            - in: query
              name: threshold_hours
              schema:
                type: integer
              required: false
          responses:
            200:
              description: List of stale datasets
            500:
              $ref: '#/components/responses/500'
        """
        try:
            threshold_hours = int(request.args.get("threshold_hours", 25))
            result = _svc.get_stale_datasets(database_id, threshold_hours=threshold_hours)
            return self.response(200, result=result, count=len(result))
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "diagnostics: get_stale_datasets failed for database_id=%s", database_id
            )
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Admin summary
    # ------------------------------------------------------------------

    @expose("/admin/summary", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def admin_summary(self) -> Response:
        """System-wide admin summary across all databases.

        ---
        get:
          summary: DHIS2 system-wide admin summary
          responses:
            200:
              description: Admin summary
            500:
              $ref: '#/components/responses/500'
        """
        try:
            result = _svc.get_admin_summary()
            return self.response(200, **result)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("diagnostics: get_admin_summary failed")
            return self.response_500(message=str(exc))
