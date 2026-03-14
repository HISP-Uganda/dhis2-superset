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
DHIS2 Instance REST API

Exposes CRUD operations and connection-testing endpoints for
:class:`~superset.dhis2.models.DHIS2Instance` objects via Flask-AppBuilder.

All responses serialise instances through
:meth:`~superset.dhis2.models.DHIS2Instance.to_json`, which redacts
credential fields (``password``, ``access_token``) so they are never returned
in plain text.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset.dhis2 import instance_service as svc

logger = logging.getLogger(__name__)


class DHIS2InstanceApi(BaseApi):
    """REST API for managing DHIS2 server instances.

    Endpoints are mounted under ``/api/v1/dhis2/instances/``.
    All endpoints require authentication via Superset's standard
    ``@protect()`` decorator.  Credentials are never returned in plain text.
    """

    resource_name = "dhis2/instances"
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Instances"

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    @expose("/", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_instances(self) -> Response:
        """List DHIS2 instances for a database.

        ---
        get:
          summary: List DHIS2 instances
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
              description: Include inactive instances in the response
          responses:
            200:
              description: List of DHIS2 instances (credentials redacted)
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
            return self.response_400(message="'database_id' query parameter is required")

        include_inactive_raw = request.args.get("include_inactive", "false").lower()
        include_inactive = include_inactive_raw in ("true", "1", "yes")

        instances = svc.get_instances_with_legacy_fallback(
            database_id,
            include_inactive=include_inactive,
        )
        return self.response(
            200,
            result=[inst.to_json() for inst in instances],
            count=len(instances),
        )

    # ------------------------------------------------------------------
    # Get single
    # ------------------------------------------------------------------

    @expose("/<int:pk>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_instance(self, pk: int) -> Response:
        """Retrieve a single DHIS2 instance by primary key.

        ---
        get:
          summary: Get DHIS2 instance
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: DHIS2 instance (credentials redacted)
            404:
              description: Instance not found
        """
        instance = svc.get_instance(pk)
        if instance is None:
            return self.response_404()
        return self.response(200, result=instance.to_json())

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    @expose("/", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def create_instance(self) -> Response:
        """Create a new DHIS2 instance.

        ---
        post:
          summary: Create DHIS2 instance
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - database_id
                    - name
                    - url
                  properties:
                    database_id:
                      type: integer
                    name:
                      type: string
                    url:
                      type: string
                    description:
                      type: string
                    is_active:
                      type: boolean
                      default: true
                    auth_type:
                      type: string
                      enum: [basic, pat]
                      default: basic
                    username:
                      type: string
                    password:
                      type: string
                      format: password
                    access_token:
                      type: string
                      format: password
          responses:
            201:
              description: Created DHIS2 instance (credentials redacted)
            400:
              description: Validation error
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}

        database_id = body.get("database_id")
        if not database_id:
            return self.response_400(message="'database_id' is required")

        try:
            instance = svc.create_instance(int(database_id), body)
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error creating DHIS2Instance")
            return self.response_500(message="Failed to create instance")

        return self.response(201, result=instance.to_json())

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    @expose("/<int:pk>", methods=["PUT"])
    @protect()
    @safe
    @permission_name("write")
    def update_instance(self, pk: int) -> Response:
        """Update an existing DHIS2 instance.

        Only supplied fields are updated; absent fields retain their current
        values.  To leave a credential unchanged, omit the field entirely or
        pass ``null`` for ``password`` / ``access_token``.

        ---
        put:
          summary: Update DHIS2 instance
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
                    url:
                      type: string
                    description:
                      type: string
                    is_active:
                      type: boolean
                    auth_type:
                      type: string
                      enum: [basic, pat]
                    username:
                      type: string
                    password:
                      type: string
                      format: password
                    access_token:
                      type: string
                      format: password
          responses:
            200:
              description: Updated DHIS2 instance (credentials redacted)
            400:
              description: Validation error
            404:
              description: Instance not found
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}

        try:
            instance = svc.update_instance(pk, body)
        except ValueError as exc:
            message = str(exc)
            if "not found" in message.lower():
                return self.response_404()
            return self.response_400(message=message)
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error updating DHIS2Instance id=%s", pk)
            return self.response_500(message="Failed to update instance")

        return self.response(200, result=instance.to_json())

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @expose("/<int:pk>", methods=["DELETE"])
    @protect()
    @safe
    @permission_name("write")
    def delete_instance(self, pk: int) -> Response:
        """Delete a DHIS2 instance.

        ---
        delete:
          summary: Delete DHIS2 instance
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
              description: Instance not found
            500:
              description: Internal server error
        """
        try:
            deleted = svc.delete_instance(pk)
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error deleting DHIS2Instance id=%s", pk)
            return self.response_500(message="Failed to delete instance")

        if not deleted:
            return self.response_404()

        return self.response(200, message="Instance deleted successfully")

    # ------------------------------------------------------------------
    # Test connection (existing instance)
    # ------------------------------------------------------------------

    @expose("/<int:pk>/test", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def test_connection(self, pk: int) -> Response:
        """Test connectivity for a persisted DHIS2 instance.

        Issues an authenticated GET request to ``{instance.url}/api/me`` and
        returns success/failure with a round-trip time.

        ---
        post:
          summary: Test DHIS2 instance connection
          parameters:
            - in: path
              name: pk
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Connection test result
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          success:
                            type: boolean
                          message:
                            type: string
                          response_time_ms:
                            type: number
                            nullable: true
            404:
              description: Instance not found
        """
        try:
            result = svc.test_instance_connection(pk)
        except ValueError:
            return self.response_404()
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error testing DHIS2Instance id=%s", pk)
            return self.response_500(message="Connection test failed unexpectedly")

        return self.response(200, result=result)

    # ------------------------------------------------------------------
    # Test connection (pre-save / with raw config)
    # ------------------------------------------------------------------

    @expose("/test-config", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def test_config(self) -> Response:
        """Test a DHIS2 connection from raw configuration without saving.

        Useful for validating credentials before creating or updating an
        instance.  Credentials supplied in the request body are used only for
        the connection test and are never persisted.

        ---
        post:
          summary: Test DHIS2 connection from config
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - url
                  properties:
                    url:
                      type: string
                    auth_type:
                      type: string
                      enum: [basic, pat]
                      default: basic
                    username:
                      type: string
                    password:
                      type: string
                      format: password
                    access_token:
                      type: string
                      format: password
          responses:
            200:
              description: Connection test result
            400:
              description: Missing required fields
        """
        body: dict[str, Any] = request.get_json() or {}

        try:
            result = svc.test_instance_connection_with_config(body)
        except ValueError as exc:
            return self.response_400(message=str(exc))
        except Exception:  # pylint: disable=broad-except
            logger.exception("Unexpected error during config connection test")
            return self.response_500(message="Connection test failed unexpectedly")

        return self.response(200, result=result)

    # ------------------------------------------------------------------
    # Migrate legacy single-instance config
    # ------------------------------------------------------------------

    @expose("/migrate-legacy", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def migrate_legacy(self) -> Response:
        """Migrate legacy single-instance DHIS2 config to a named instance.

        Reads DHIS2 connection parameters from ``Database.encrypted_extra``
        and creates a ``DHIS2Instance`` named ``"default"`` for the specified
        database.  If the database already has instances this endpoint still
        attempts migration (caller should check beforehand if needed).

        ---
        post:
          summary: Migrate legacy DHIS2 config
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  required:
                    - database_id
                  properties:
                    database_id:
                      type: integer
          responses:
            200:
              description: Migrated instance, or null if no DHIS2 config found
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        nullable: true
            400:
              description: Missing database_id
            404:
              description: Database not found
            500:
              description: Internal server error
        """
        body: dict[str, Any] = request.get_json() or {}

        database_id = body.get("database_id")
        if not database_id:
            return self.response_400(message="'database_id' is required")

        try:
            instance = svc.migrate_legacy_instance(int(database_id))
        except ValueError as exc:
            message = str(exc)
            if "not found" in message.lower():
                return self.response_404()
            return self.response_400(message=message)
        except Exception:  # pylint: disable=broad-except
            logger.exception(
                "Unexpected error migrating legacy DHIS2 config for database_id=%s",
                database_id,
            )
            return self.response_500(message="Migration failed unexpectedly")

        return self.response(
            200,
            result=instance.to_json() if instance is not None else None,
        )
