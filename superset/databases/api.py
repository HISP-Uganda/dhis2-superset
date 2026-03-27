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
# pylint: disable=too-many-lines

from __future__ import annotations

import logging
from datetime import datetime
from io import BytesIO
from typing import Any, Callable, cast
from zipfile import is_zipfile, ZipFile

from deprecation import deprecated
from flask import (
    current_app as app,
    make_response,
    render_template,
    request,
    Response,
    send_file,
)
import gzip
import json as json_lib
from functools import wraps
from flask_appbuilder.api import expose, protect, rison, safe
from flask_appbuilder.models.sqla.interface import SQLAInterface
from marshmallow import ValidationError
import requests
from sqlalchemy.exc import NoSuchTableError, OperationalError, SQLAlchemyError
from sqlalchemy.engine.url import make_url

from superset import db, event_logger
from superset.commands.database.create import CreateDatabaseCommand
from superset.commands.database.delete import DeleteDatabaseCommand
from superset.commands.database.exceptions import (
    DatabaseConnectionFailedError,
    DatabaseCreateFailedError,
    DatabaseDeleteDatasetsExistFailedError,
    DatabaseDeleteFailedError,
    DatabaseInvalidError,
    DatabaseNotFoundError,
    DatabaseUpdateFailedError,
    InvalidParametersError,
)
from superset.commands.database.export import ExportDatabasesCommand
from superset.commands.database.importers.dispatcher import ImportDatabasesCommand
from superset.commands.database.oauth2 import OAuth2StoreTokenCommand
from superset.commands.database.ssh_tunnel.delete import DeleteSSHTunnelCommand
from superset.commands.database.ssh_tunnel.exceptions import (
    SSHTunnelDatabasePortError,
    SSHTunnelDeleteFailedError,
    SSHTunnelingNotEnabledError,
)
from superset.commands.database.sync_permissions import SyncPermissionsCommand
from superset.commands.database.tables import TablesDatabaseCommand
from superset.commands.database.test_connection import TestConnectionDatabaseCommand
from superset.commands.database.update import UpdateDatabaseCommand
from superset.commands.database.uploaders.base import (
    BaseDataReader,
    UploadCommand,
    UploadFileType,
)
from superset.commands.database.uploaders.columnar_reader import ColumnarReader
from superset.commands.database.uploaders.csv_reader import CSVReader
from superset.commands.database.uploaders.excel_reader import ExcelReader
from superset.commands.database.validate import ValidateDatabaseParametersCommand
from superset.commands.database.validate_sql import ValidateSQLCommand
from superset.commands.importers.exceptions import (
    IncorrectFormatError,
    NoValidFilesFoundError,
)
from superset.commands.importers.v1.utils import get_contents_from_bundle
from superset.constants import MODEL_API_RW_METHOD_PERMISSION_MAP, RouteMethod
from superset.daos.database import DatabaseDAO
from superset.databases.decorators import check_table_access
from superset.databases.filters import (
    DatabaseDHIS2StagingInternalFilter,
    DatabaseFilter,
    DatabaseUploadEnabledFilter,
)
from superset.databases.schemas import (
    CatalogsResponseSchema,
    database_catalogs_query_schema,
    database_schemas_query_schema,
    database_tables_query_schema,
    DatabaseConnectionSchema,
    DatabaseFunctionNamesResponse,
    DatabasePostSchema,
    DatabasePutSchema,
    DatabaseRelatedObjectsResponse,
    DatabaseSchemaAccessForFileUploadResponse,
    DatabaseTablesResponse,
    DatabaseTestConnectionSchema,
    DatabaseValidateParametersSchema,
    get_export_ids_schema,
    OAuth2ProviderResponseSchema,
    openapi_spec_methods_override,
    QualifiedTableSchema,
    SchemasResponseSchema,
    SelectStarResponseSchema,
    TableExtraMetadataResponseSchema,
    TableMetadataResponseSchema,
    UploadFileMetadata,
    UploadFileMetadataPostSchema,
    UploadPostSchema,
    ValidateSQLRequest,
    ValidateSQLResponse,
)
from superset.databases.utils import get_table_metadata
from superset.db_engine_specs import get_available_engine_specs
from superset.dhis2.org_unit_level_metadata import merge_org_unit_level_items
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from superset.exceptions import (
    DatabaseNotFoundException,
    InvalidPayloadSchemaError,
    OAuth2RedirectError,
    SupersetErrorsException,
    SupersetException,
    SupersetSecurityException,
    TableNotFoundException,
)
from superset.extensions import cache_manager, security_manager
from superset.models.core import Database
from superset.sql.parse import Table
from superset.superset_typing import FlaskResponse
from superset.utils import json
from superset.utils.core import (
    error_msg_from_exception,
    get_username,
    parse_js_uri_path_item,
)
from superset.utils.decorators import transaction
from superset.utils.oauth2 import decode_oauth2_state
from superset.utils.ssh_tunnel import mask_password_info
from superset.views.base_api import (
    BaseSupersetModelRestApi,
    RelatedFieldFilter,
    requires_form_data,
    requires_json,
    statsd_metrics,
)
from superset.views.error_handling import handle_api_exception, json_error_response
from superset.views.filters import BaseFilterRelatedUsers, FilterRelatedOwners

logger = logging.getLogger(__name__)


def compress_response_if_supported(response_data: dict) -> Response:
    """
    Compress JSON response with gzip if client supports it.

    This is especially important for DHIS2 responses which can be very large (MB+).
    Compression reduces payload size by 60-70%, critical for slow DHIS2 servers.

    Args:
        response_data: Dictionary to be JSON-serialized and optionally compressed

    Returns:
        Flask Response object, compressed if client supports gzip
    """
    # Serialize to JSON
    json_data = json_lib.dumps(response_data)
    json_bytes = json_data.encode('utf-8')

    # Check if client supports gzip compression
    accept_encoding = request.headers.get('Accept-Encoding', '')

    if 'gzip' in accept_encoding and len(json_bytes) > 1024:  # Only compress if > 1KB
        # Compress the response
        compressed = gzip.compress(json_bytes, compresslevel=6)  # Balance speed vs compression

        # Log compression ratio for monitoring
        compression_ratio = (1 - len(compressed) / len(json_bytes)) * 100
        logger.info(f"[DHIS2 Compression] Compressed {len(json_bytes)} → {len(compressed)} bytes ({compression_ratio:.1f}% reduction)")

        # Create compressed response
        response = make_response(compressed)
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Content-Type'] = 'application/json'
        response.headers['Content-Length'] = str(len(compressed))
        return response
    else:
        # Return uncompressed
        response = make_response(json_data)
        response.headers['Content-Type'] = 'application/json'
        return response


# pylint: disable=too-many-public-methods
class DatabaseRestApi(BaseSupersetModelRestApi):
    datamodel = SQLAInterface(Database)
    csrf_exempt = True

    include_route_methods = RouteMethod.REST_MODEL_VIEW_CRUD_SET | {
        RouteMethod.EXPORT,
        RouteMethod.IMPORT,
        RouteMethod.RELATED,
        "tables",
        "table_metadata",
        "table_metadata_deprecated",
        "table_extra_metadata",
        "table_extra_metadata_deprecated",
        "select_star",
        "catalogs",
        "schemas",
        "test_connection",
        "related_objects",
        "function_names",
        "available",
        "validate_parameters",
        "validate_sql",
        "delete_ssh_tunnel",
        "dataset_sources",
        "schemas_access_for_file_upload",
        "get_connection",
        "upload_metadata",
        "upload",
        "oauth2",
        "sync_permissions",
        "dhis2_metadata",
        "dhis2_metadata_public",
        "dhis2_preview_columns",
        "dhis2_preview_data",
        "dhis2_chart_data",
        "dhis2_expanded_org_units",
    }

    resource_name = "database"
    class_permission_name = "Database"
    method_permission_name = MODEL_API_RW_METHOD_PERMISSION_MAP
    allow_browser_login = True
    base_filters = [
        ["id", DatabaseFilter, lambda: []],
        ["id", DatabaseDHIS2StagingInternalFilter, lambda: []],
    ]
    show_columns = [
        "id",
        "uuid",
        "database_name",
        "cache_timeout",
        "expose_in_sqllab",
        "allow_run_async",
        "allow_file_upload",
        "configuration_method",
        "allow_ctas",
        "allow_cvas",
        "allow_dml",
        "backend",
        "driver",
        "force_ctas_schema",
        "impersonate_user",
        "is_managed_externally",
        "engine_information",
    ]
    list_columns = [
        "allow_file_upload",
        "allow_ctas",
        "allow_cvas",
        "allow_dml",
        "allow_run_async",
        "allows_cost_estimate",
        "allows_subquery",
        "allows_virtual_table_explore",
        "backend",
        "changed_on",
        "changed_on_delta_humanized",
        "changed_by.first_name",
        "changed_by.last_name",
        "created_by.first_name",
        "created_by.last_name",
        "database_name",
        "explore_database_id",
        "expose_in_sqllab",
        "extra",
        "force_ctas_schema",
        "id",
        "uuid",
        "disable_data_preview",
        "disable_drill_to_detail",
        "allow_multi_catalog",
        "engine_information",
    ]
    add_columns = [
        "database_name",
        "sqlalchemy_uri",
        "cache_timeout",
        "expose_in_sqllab",
        "allow_run_async",
        "allow_file_upload",
        "allow_ctas",
        "allow_cvas",
        "allow_dml",
        "configuration_method",
        "force_ctas_schema",
        "impersonate_user",
        "extra",
        "encrypted_extra",
        "server_cert",
    ]

    edit_columns = add_columns

    search_columns = [
        "allow_file_upload",
        "allow_dml",
        "allow_run_async",
        "created_by",
        "changed_by",
        "database_name",
        "expose_in_sqllab",
        "uuid",
    ]
    search_filters = {"allow_file_upload": [DatabaseUploadEnabledFilter]}
    allowed_rel_fields = {"changed_by", "created_by"}

    list_select_columns = list_columns + ["extra", "sqlalchemy_uri", "password"]
    order_columns = [
        "allow_file_upload",
        "allow_dml",
        "allow_run_async",
        "changed_on",
        "changed_on_delta_humanized",
        "created_by.first_name",
        "database_name",
        "expose_in_sqllab",
    ]
    # Removes the local limit for the page size
    max_page_size = -1
    add_model_schema = DatabasePostSchema()
    edit_model_schema = DatabasePutSchema()

    apispec_parameter_schemas = {
        "database_catalogs_query_schema": database_catalogs_query_schema,
        "database_schemas_query_schema": database_schemas_query_schema,
        "database_tables_query_schema": database_tables_query_schema,
        "get_export_ids_schema": get_export_ids_schema,
    }

    openapi_spec_tag = "Database"
    openapi_spec_component_schemas = (
        CatalogsResponseSchema,
        DatabaseConnectionSchema,
        DatabaseFunctionNamesResponse,
        DatabaseSchemaAccessForFileUploadResponse,
        DatabaseRelatedObjectsResponse,
        DatabaseTablesResponse,
        DatabaseTestConnectionSchema,
        DatabaseValidateParametersSchema,
        TableExtraMetadataResponseSchema,
        TableMetadataResponseSchema,
        SelectStarResponseSchema,
        SchemasResponseSchema,
        UploadFileMetadataPostSchema,
        UploadFileMetadata,
        UploadPostSchema,
        ValidateSQLRequest,
        ValidateSQLResponse,
    )

    openapi_spec_methods = openapi_spec_methods_override
    """ Overrides GET methods OpenApi descriptions """

    related_field_filters = {
        "changed_by": RelatedFieldFilter("first_name", FilterRelatedOwners),
    }
    base_related_field_filters = {
        "changed_by": [["id", BaseFilterRelatedUsers, lambda: []]],
    }

    @expose("/<int:pk>/connection", methods=("GET",))
    @protect()
    @safe
    def get_connection(self, pk: int) -> Response:
        """Get database connection info.
        ---
        get:
          summary: Get a database connection info
          parameters:
          - in: path
            schema:
              type: integer
            description: The database id
            name: pk
          responses:
            200:
              description: Database with connection info
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/DatabaseConnectionSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        database = DatabaseDAO.find_by_id(pk)
        database_connection_schema = DatabaseConnectionSchema()
        response = {
            "id": pk,
            "result": database_connection_schema.dump(database, many=False),
        }
        try:
            if ssh_tunnel := DatabaseDAO.get_ssh_tunnel(pk):
                response["result"]["ssh_tunnel"] = ssh_tunnel.data
            return self.response(200, **response)
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

    @expose("/<int:pk>", methods=("GET",))
    @protect()
    @safe
    def get(self, pk: int, **kwargs: Any) -> Response:
        """Get a database.
        ---
        get:
          summary: Get a database
          parameters:
          - in: path
            schema:
              type: integer
            description: The database id
            name: pk
          responses:
            200:
              description: Database
              content:
                application/json:
                  schema:
                    type: object
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        data = self.get_headless(pk, **kwargs)
        try:
            if ssh_tunnel := DatabaseDAO.get_ssh_tunnel(pk):
                payload = data.json
                payload["result"]["ssh_tunnel"] = ssh_tunnel.data
                return payload
            return data
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

    @expose("/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.post",
        log_to_statsd=False,
    )
    @requires_json
    def post(self) -> FlaskResponse:  # noqa: C901
        """Create a new database.
        ---
        post:
          summary: Create a new database
          requestBody:
            description: Database schema
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/{{self.__class__.__name__}}.post'
          responses:
            201:
              description: Database added
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      id:
                        type: number
                      result:
                        $ref: '#/components/schemas/{{self.__class__.__name__}}.post'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            item = self.add_model_schema.load(request.json)
        # This validates custom Schema with custom validations
        except ValidationError as error:
            return self.response_400(message=error.messages)
        try:
            new_model = CreateDatabaseCommand(item).run()
            item["uuid"] = new_model.uuid
            # Return censored version for sqlalchemy URI
            item["sqlalchemy_uri"] = new_model.sqlalchemy_uri
            item["expose_in_sqllab"] = new_model.expose_in_sqllab

            # If parameters are available return them in the payload
            if new_model.parameters:
                item["parameters"] = new_model.parameters

            if new_model.driver:
                item["driver"] = new_model.driver

            # Return SSH Tunnel and hide passwords if any
            if item.get("ssh_tunnel"):
                item["ssh_tunnel"] = mask_password_info(new_model.ssh_tunnel)

            return self.response(201, id=new_model.id, result=item)
        except OAuth2RedirectError:
            raise
        except DatabaseInvalidError as ex:
            return self.response_422(message=ex.normalized_messages())
        except DatabaseConnectionFailedError as ex:
            return self.response_422(message=str(ex))
        except SupersetErrorsException as ex:
            return json_error_response(ex.errors, status=ex.status)
        except DatabaseCreateFailedError as ex:
            logger.error(
                "Error creating model %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))
        except (SSHTunnelingNotEnabledError, SSHTunnelDatabasePortError) as ex:
            return self.response_400(message=str(ex))
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

    @expose("/<int:pk>", methods=("PUT",))
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.put",
        log_to_statsd=False,
    )
    @requires_json
    def put(self, pk: int) -> Response:
        """Update a database.
        ---
        put:
          summary: Change a database
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          requestBody:
            description: Database schema
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/{{self.__class__.__name__}}.put'
          responses:
            200:
              description: Database changed
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      id:
                        type: number
                      result:
                        $ref: '#/components/schemas/{{self.__class__.__name__}}.put'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            item = self.edit_model_schema.load(request.json)
        # This validates custom Schema with custom validations
        except ValidationError as error:
            return self.response_400(message=error.messages)
        try:
            changed_model = UpdateDatabaseCommand(pk, item).run()
            # Return censored version for sqlalchemy URI
            item["sqlalchemy_uri"] = changed_model.sqlalchemy_uri
            if changed_model.parameters:
                item["parameters"] = changed_model.parameters
            # Return SSH Tunnel and hide passwords if any
            if item.get("ssh_tunnel"):
                item["ssh_tunnel"] = mask_password_info(changed_model.ssh_tunnel)
            return self.response(200, id=changed_model.id, result=item)
        except DatabaseNotFoundError:
            return self.response_404()
        except DatabaseInvalidError as ex:
            return self.response_422(message=ex.normalized_messages())
        except DatabaseConnectionFailedError as ex:
            return self.response_422(message=str(ex))
        except DatabaseUpdateFailedError as ex:
            logger.error(
                "Error updating model %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))
        except (SSHTunnelingNotEnabledError, SSHTunnelDatabasePortError) as ex:
            return self.response_400(message=str(ex))

    @expose("/<int:pk>", methods=("DELETE",))
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.delete",
        log_to_statsd=False,
    )
    def delete(self, pk: int) -> Response:
        """Delete a database.
        ---
        delete:
          summary: Delete a database
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          responses:
            200:
              description: Database deleted
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            DeleteDatabaseCommand(pk).run()
            return self.response(200, message="OK")
        except DatabaseNotFoundError:
            return self.response_404()
        except DatabaseDeleteDatasetsExistFailedError as ex:
            return self.response_422(message=str(ex))
        except DatabaseDeleteFailedError as ex:
            logger.error(
                "Error deleting model %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))

    @expose("/<int:pk>/sync_permissions/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".sync-permissions",
        log_to_statsd=False,
    )
    def sync_permissions(self, pk: int, **kwargs: Any) -> FlaskResponse:
        """Sync all permissions for a database connection.
        ---
        post:
          summary: Re-sync all permissions for a database connection
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database connection ID
          responses:
            200:
              description: Task created to sync permissions.
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        current_username = get_username()
        SyncPermissionsCommand(
            pk,
            current_username,
        ).run()
        if app.config["SYNC_DB_PERMISSIONS_IN_ASYNC_MODE"]:
            return self.response(202, message="Async task created to sync permissions")
        return self.response(200, message="Permissions successfully synced")

    @expose("/<int:pk>/catalogs/")
    @protect()
    @rison(database_catalogs_query_schema)
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.catalogs",
        log_to_statsd=False,
    )
    def catalogs(self, pk: int, **kwargs: Any) -> FlaskResponse:
        """Get all catalogs from a database.
        ---
        get:
          summary: Get all catalogs from a database
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: query
            name: q
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/database_catalogs_query_schema'
          responses:
            200:
              description: A List of all catalogs from the database
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/CatalogsResponseSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        try:
            catalogs = database.get_all_catalog_names(
                cache=database.catalog_cache_enabled,
                cache_timeout=database.catalog_cache_timeout or None,
                force=kwargs["rison"].get("force", False),
            )
            catalogs = security_manager.get_catalogs_accessible_by_user(
                database,
                catalogs,
            )
            return self.response(200, result=list(catalogs))
        except OperationalError:
            return self.response(
                500,
                message="There was an error connecting to the database",
            )
        except OAuth2RedirectError:
            raise
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

    @expose("/<int:pk>/schemas/")
    @protect()
    @rison(database_schemas_query_schema)
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.schemas",
        log_to_statsd=False,
    )
    def schemas(self, pk: int, **kwargs: Any) -> FlaskResponse:
        """Get all schemas from a database.
        ---
        get:
          summary: Get all schemas from a database
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: query
            name: q
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/database_schemas_query_schema'
          responses:
            200:
              description: A List of all schemas from the database
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/SchemasResponseSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        database = self.datamodel.get(pk, self._base_filters)
        if not database:
            return self.response_404()
        try:
            params = kwargs["rison"]
            catalog = params.get("catalog")
            schemas = database.get_all_schema_names(
                catalog=catalog,
                cache=database.schema_cache_enabled,
                cache_timeout=database.schema_cache_timeout or None,
                force=params.get("force", False),
            )
            schemas = security_manager.get_schemas_accessible_by_user(
                database,
                catalog,
                schemas,
            )
            if params.get("upload_allowed"):
                if not database.allow_file_upload:
                    return self.response(200, result=[])
                if allowed_schemas := database.get_schema_access_for_file_upload():
                    # some databases might return the list of schemas in uppercase,
                    # while the list of allowed schemas is manually inputted so
                    # could be lowercase
                    allowed_schemas = {schema.lower() for schema in allowed_schemas}
                    return self.response(
                        200,
                        result=[
                            schema
                            for schema in schemas
                            if schema.lower() in allowed_schemas
                        ],
                    )
            return self.response(200, result=list(schemas))
        except OperationalError:
            return self.response(
                500, message="There was an error connecting to the database"
            )
        except OAuth2RedirectError:
            raise
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

    @expose("/<int:pk>/tables/")
    @protect()
    @rison(database_tables_query_schema)
    @statsd_metrics
    @handle_api_exception
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.tables",
        log_to_statsd=False,
    )
    def tables(self, pk: int, **kwargs: Any) -> FlaskResponse:
        """Get a list of tables for given database.
        ---
        get:
          summary: Get a list of tables for given database
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: query
            name: q
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/database_tables_query_schema'
          responses:
            200:
              description: Tables list
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      count:
                        type: integer
                      result:
                        description: >-
                          A List of tables for given database
                        type: array
                        items:
                          $ref: '#/components/schemas/DatabaseTablesResponse'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        force = kwargs["rison"].get("force", False)
        catalog_name = kwargs["rison"].get("catalog_name")
        schema_name = kwargs["rison"].get("schema_name", "")

        command = TablesDatabaseCommand(pk, catalog_name, schema_name, force)
        payload = command.run()
        return self.response(200, **payload)

    @expose("/<int:pk>/table/<path:table_name>/<schema_name>/", methods=("GET",))
    @protect()
    @check_table_access
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".table_metadata_deprecated",
        log_to_statsd=False,
    )
    def table_metadata_deprecated(
        self, database: Database, table_name: str, schema_name: str
    ) -> FlaskResponse:
        """Get database table metadata.
        ---
        get:
          summary: Get database table metadata
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: path
            schema:
              type: string
            name: table_name
            description: Table name
          - in: path
            schema:
              type: string
            name: schema_name
            description: Table schema
          responses:
            200:
              description: Table metadata information
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/TableMetadataResponseSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        self.incr_stats("init", self.table_metadata_deprecated.__name__)
        try:
            table_info = get_table_metadata(database, Table(table_name, schema_name))
        except SQLAlchemyError as ex:
            self.incr_stats("error", self.table_metadata_deprecated.__name__)
            return self.response_422(error_msg_from_exception(ex))
        except SupersetException as ex:
            return self.response(ex.status, message=ex.message)

        self.incr_stats("success", self.table_metadata_deprecated.__name__)
        return self.response(200, **table_info)

    @expose("/<int:pk>/table_extra/<path:table_name>/<schema_name>/", methods=("GET",))
    @protect()
    @check_table_access
    @safe
    @statsd_metrics
    @deprecated(deprecated_in="4.0")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".table_extra_metadata_deprecated",
        log_to_statsd=False,
    )
    def table_extra_metadata_deprecated(
        self, database: Database, table_name: str, schema_name: str
    ) -> FlaskResponse:
        """Get table extra metadata.

        A newer API was introduced between 4.0 and 5.0, with support for catalogs for
        SIP-95. This method was kept to prevent breaking API integrations, but will be
        removed in 5.0.
        ---
        get:
          summary: Get table extra metadata
          description: >-
            Response depends on each DB engine spec normally focused on partitions.
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: path
            schema:
              type: string
            name: table_name
            description: Table name
          - in: path
            schema:
              type: string
            name: schema_name
            description: Table schema
          responses:
            200:
              description: Table extra metadata information
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/TableExtraMetadataResponseSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        self.incr_stats("init", self.table_extra_metadata_deprecated.__name__)

        parsed_schema = parse_js_uri_path_item(schema_name, eval_undefined=True)
        table_name = cast(str, parse_js_uri_path_item(table_name))
        table = Table(table_name, parsed_schema)
        payload = database.db_engine_spec.get_extra_table_metadata(database, table)
        return self.response(200, **payload)

    @expose("/<int:pk>/table_metadata/", methods=["GET"])
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".table_metadata",
        log_to_statsd=False,
    )
    def table_metadata(self, pk: int) -> FlaskResponse:
        """
        Get metadata for a given table.

        Optionally, a schema and a catalog can be passed, if different from the default
        ones.
        ---
        get:
          summary: Get table metadata
          description: >-
            Metadata associated with the table (columns, indexes, etc.)
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: query
            schema:
              type: string
            name: name
            required: true
            description: Table name
          - in: query
            schema:
              type: string
            name: schema
            description: >-
              Optional table schema, if not passed default schema will be used
          - in: query
            schema:
              type: string
            name: catalog
            description: >-
              Optional table catalog, if not passed default catalog will be used
          responses:
            200:
              description: Table metadata information
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/TableExtraMetadataResponseSchema"
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        self.incr_stats("init", self.table_metadata.__name__)

        database = DatabaseDAO.find_by_id(pk)
        if database is None:
            raise DatabaseNotFoundException("No such database")

        try:
            parameters = QualifiedTableSchema().load(request.args)
        except ValidationError as ex:
            raise InvalidPayloadSchemaError(ex) from ex

        table = Table(parameters["name"], parameters["schema"], parameters["catalog"])
        try:
            security_manager.raise_for_access(database=database, table=table)
        except SupersetSecurityException as ex:
            # instead of raising 403, raise 404 to hide table existence
            raise TableNotFoundException("No such table") from ex

        # DHIS2 MART Column Exfiltration:
        # If this is a physical table that matches a DHIS2 MART dataset registered in Superset,
        # we prefer the Superset metadata (SqlaTable/TableColumn) over database introspection.
        # This ensures all MART columns are available for SQL Lab analysis even if they are 
        # virtual or the DB driver cannot introspect them correctly.
        from superset.connectors.sqla.models import SqlaTable
        from superset import db as superset_db

        # Try to find a matching SqlaTable in this database.
        # Physical tables have schema and table_name.
        sqla_table = (
            superset_db.session.query(SqlaTable)
            .filter(
                SqlaTable.database_id == pk,
                SqlaTable.schema == table.schema,
                SqlaTable.table_name == table.table,
            )
            .first()
        )
        
        # If not found by exact schema.table, try matching by physical table name 
        # in virtual datasets (where table_name is the friendly name and sql points to the table).
        if not sqla_table:
            # MART tables usually have a pattern like `sv_1_..._mart` or similar
            # Search virtual datasets where the SQL contains the table name
            pattern = f"%{table.table}%"
            sqla_table = (
                superset_db.session.query(SqlaTable)
                .filter(
                    SqlaTable.database_id == pk,
                    SqlaTable.sql.like(pattern),
                )
                .first()
            )

        # Only use Superset columns if it's explicitly marked as a DHIS2 staged local dataset
        if sqla_table:
            extra_dict = sqla_table.extra_dict
            if extra_dict.get("dhis2_staged_local") or extra_dict.get("dhis2StagedLocal"):
                logger.info(
                    "table_metadata: using Superset metadata for DHIS2 MART table %s (SqlaTable id=%d)",
                    table.table, sqla_table.id
                )
                # Use the SQL expression from SqlaTable if it's a virtual dataset, 
                # otherwise default to SELECT * FROM table.
                select_star = sqla_table.sql if sqla_table.sql else f"SELECT * FROM {table.table}"
                
                payload = {
                    "name": table.table,
                    "columns": [
                        {
                            "name": col.column_name,
                            "type": col.type,
                            "is_dttm": col.is_dttm,
                            "longType": col.type,
                            "comment": col.description,
                        }
                        for col in sqla_table.columns
                        if not col.extra_dict.get("dhis2_is_internal")
                    ],
                    "selectStar": select_star,
                    "primaryKey": [],
                    "foreignKeys": [],
                    "indexes": [],
                    "comment": sqla_table.description,
                }
                return self.response(200, **payload)

        payload = database.db_engine_spec.get_table_metadata(database, table)

        return self.response(200, **payload)

    @expose("/<int:pk>/table_metadata/extra/", methods=["GET"])
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".table_extra_metadata",
        log_to_statsd=False,
    )
    def table_extra_metadata(self, pk: int) -> FlaskResponse:
        """
        Get extra metadata for a given table.

        Optionally, a schema and a catalog can be passed, if different from the default
        ones.
        ---
        get:
          summary: Get table extra metadata
          description: >-
            Extra metadata associated with the table (partitions, description, etc.)
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: query
            schema:
              type: string
            name: name
            required: true
            description: Table name
          - in: query
            schema:
              type: string
            name: schema
            description: >-
              Optional table schema, if not passed the schema configured in the database
              will be used
          - in: query
            schema:
              type: string
            name: catalog
            description: >-
              Optional table catalog, if not passed the catalog configured in the
              database will be used
          responses:
            200:
              description: Table extra metadata information
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/TableExtraMetadataResponseSchema"
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        self.incr_stats("init", self.table_extra_metadata.__name__)

        if not (database := DatabaseDAO.find_by_id(pk)):
            raise DatabaseNotFoundException("No such database")

        try:
            parameters = QualifiedTableSchema().load(request.args)
        except ValidationError as ex:
            raise InvalidPayloadSchemaError(ex) from ex

        table = Table(parameters["name"], parameters["schema"], parameters["catalog"])
        try:
            security_manager.raise_for_access(database=database, table=table)
        except SupersetSecurityException as ex:
            # instead of raising 403, raise 404 to hide table existence
            raise TableNotFoundException("No such table") from ex

        payload = database.db_engine_spec.get_extra_table_metadata(database, table)

        return self.response(200, **payload)

    @expose("/<int:pk>/select_star/<path:table_name>/", methods=("GET",))
    @expose("/<int:pk>/select_star/<path:table_name>/<schema_name>/", methods=("GET",))
    @protect()
    @check_table_access
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.select_star",
        log_to_statsd=False,
    )
    def select_star(
        self, database: Database, table_name: str, schema_name: str | None = None
    ) -> FlaskResponse:
        """Get database select star for table.
        ---
        get:
          summary: Get database select star for table
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
            description: The database id
          - in: path
            schema:
              type: string
            name: table_name
            description: Table name
          - in: path
            schema:
              type: string
            name: schema_name
            description: Table schema
          responses:
            200:
              description: SQL statement for a select star for table
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/SelectStarResponseSchema"
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        self.incr_stats("init", self.select_star.__name__)
        try:
            result = database.select_star(
                Table(table_name, schema_name, database.get_default_catalog()),
                latest_partition=True,
            )
        except NoSuchTableError:
            self.incr_stats("error", self.select_star.__name__)
            return self.response(404, message="Table not found on the database")
        self.incr_stats("success", self.select_star.__name__)
        return self.response(200, result=result)

    @expose("/test_connection/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".test_connection",
        log_to_statsd=False,
    )
    @requires_json
    def test_connection(self) -> FlaskResponse:
        """Test a database connection.
        ---
        post:
          summary: Test a database connection
          requestBody:
            description: Database schema
            required: true
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/DatabaseTestConnectionSchema"
          responses:
            200:
              description: Database Test Connection
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            400:
              $ref: '#/components/responses/400'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            item = DatabaseTestConnectionSchema().load(request.json)
        # This validates custom Schema with custom validations
        except ValidationError as error:
            return self.response_400(message=error.messages)
        try:
            TestConnectionDatabaseCommand(item).run()
            return self.response(200, message="OK")
        except (SSHTunnelingNotEnabledError, SSHTunnelDatabasePortError) as ex:
            return self.response_400(message=str(ex))

    @expose("/<int:pk>/related_objects/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".related_objects",
        log_to_statsd=False,
    )
    def related_objects(self, pk: int) -> Response:
        """Get charts and dashboards count associated to a database.
        ---
        get:
          summary: Get charts and dashboards count associated to a database
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          responses:
            200:
              description: Query result
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/DatabaseRelatedObjectsResponse"
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        data = DatabaseDAO.get_related_objects(pk)
        charts = [
            {
                "id": chart.id,
                "slice_name": chart.slice_name,
                "viz_type": chart.viz_type,
            }
            for chart in data["charts"]
        ]
        dashboards = [
            {
                "id": dashboard.id,
                "json_metadata": dashboard.json_metadata,
                "slug": dashboard.slug,
                "title": dashboard.dashboard_title,
            }
            for dashboard in data["dashboards"]
        ]
        sqllab_tab_states = [
            {"id": tab_state.id, "label": tab_state.label, "active": tab_state.active}
            for tab_state in data["sqllab_tab_states"]
        ]
        return self.response(
            200,
            charts={"count": len(charts), "result": charts},
            dashboards={"count": len(dashboards), "result": dashboards},
            sqllab_tab_states={
                "count": len(sqllab_tab_states),
                "result": sqllab_tab_states,
            },
        )

    @expose("/<int:pk>/validate_sql/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.validate_sql",
        log_to_statsd=False,
    )
    def validate_sql(self, pk: int) -> FlaskResponse:
        """Validate that arbitrary SQL is acceptable for the given database.
        ---
        post:
          summary: Validate arbitrary SQL
          description: >-
            Validates that arbitrary SQL is acceptable for the given database.
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          requestBody:
            description: Validate SQL request
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ValidateSQLRequest'
          responses:
            200:
              description: Validation result
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        description: >-
                          A List of SQL errors found on the statement
                        type: array
                        items:
                          $ref: '#/components/schemas/ValidateSQLResponse'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            sql_request = ValidateSQLRequest().load(request.json)
        except ValidationError as error:
            return self.response_400(message=error.messages)
        try:
            validator_errors = ValidateSQLCommand(pk, sql_request).run()
            return self.response(200, result=validator_errors)
        except DatabaseNotFoundError:
            return self.response_404()

    @expose("/oauth2/", methods=["GET"])
    @transaction()
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.oauth2",
        log_to_statsd=True,
    )
    def oauth2(self) -> FlaskResponse:
        """
        ---
        get:
          summary: >-
            Receive personal access tokens from OAuth2
          description: ->
            Receive and store personal access tokens from OAuth for user-level
            authorization
          parameters:
          - in: query
            name: state
            schema:
              type: string
          - in: query
            name: code
            schema:
              type: string
          - in: query
            name: scope
            schema:
              type: string
          - in: query
            name: error
            schema:
              type: string
          responses:
            200:
              description: A dummy self-closing HTML page
              content:
                text/html:
                  schema:
                    type: string
            400:
              $ref: '#/components/responses/400'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        parameters = OAuth2ProviderResponseSchema().load(request.args)
        command = OAuth2StoreTokenCommand(parameters)
        command.run()

        state = decode_oauth2_state(parameters["state"])
        tab_id = state["tab_id"]

        # return blank page that closes itself
        return make_response(
            render_template("superset/oauth2.html", tab_id=tab_id),
            200,
        )

    @expose("/export/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @rison(get_export_ids_schema)
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.export",
        log_to_statsd=False,
    )
    def export(self, **kwargs: Any) -> Response:
        """Download database(s) and associated dataset(s) as a zip file.
        ---
        get:
          summary: Download database(s) and associated dataset(s) as a zip file
          parameters:
          - in: query
            name: q
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/get_export_ids_schema'
          responses:
            200:
              description: A zip file with database(s) and dataset(s) as YAML
              content:
                application/zip:
                  schema:
                    type: string
                    format: binary
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        requested_ids = kwargs["rison"]
        timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
        root = f"database_export_{timestamp}"
        filename = f"{root}.zip"

        buf = BytesIO()
        with ZipFile(buf, "w") as bundle:
            try:
                for file_name, file_content in ExportDatabasesCommand(
                    requested_ids
                ).run():
                    with bundle.open(f"{root}/{file_name}", "w") as fp:
                        fp.write(file_content().encode())
            except DatabaseNotFoundError:
                return self.response_404()
        buf.seek(0)

        response = send_file(
            buf,
            mimetype="application/zip",
            as_attachment=True,
            download_name=filename,
        )
        if token := request.args.get("token"):
            response.set_cookie(token, "done", max_age=600)
        return response

    @expose("/import/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.import_",
        log_to_statsd=False,
    )
    @requires_form_data
    def import_(self) -> Response:
        """Import database(s) with associated datasets.
        ---
        post:
          summary: Import database(s) with associated datasets
          requestBody:
            required: true
            content:
              multipart/form-data:
                schema:
                  type: object
                  properties:
                    formData:
                      description: upload file (ZIP)
                      type: string
                      format: binary
                    passwords:
                      description: >-
                        JSON map of passwords for each featured database in the
                        ZIP file. If the ZIP includes a database config in the path
                        `databases/MyDatabase.yaml`, the password should be provided
                        in the following format:
                        `{"databases/MyDatabase.yaml": "my_password"}`.
                      type: string
                    overwrite:
                      description: overwrite existing databases?
                      type: boolean
                    ssh_tunnel_passwords:
                      description: >-
                        JSON map of passwords for each ssh_tunnel associated to a
                        featured database in the ZIP file. If the ZIP includes a
                        ssh_tunnel config in the path `databases/MyDatabase.yaml`,
                        the password should be provided in the following format:
                        `{"databases/MyDatabase.yaml": "my_password"}`.
                      type: string
                    ssh_tunnel_private_keys:
                      description: >-
                        JSON map of private_keys for each ssh_tunnel associated to a
                        featured database in the ZIP file. If the ZIP includes a
                        ssh_tunnel config in the path `databases/MyDatabase.yaml`,
                        the private_key should be provided in the following format:
                        `{"databases/MyDatabase.yaml": "my_private_key"}`.
                      type: string
                    ssh_tunnel_private_key_passwords:
                      description: >-
                        JSON map of private_key_passwords for each ssh_tunnel associated
                        to a featured database in the ZIP file. If the ZIP includes a
                        ssh_tunnel config in the path `databases/MyDatabase.yaml`,
                        the private_key should be provided in the following format:
                        `{"databases/MyDatabase.yaml": "my_private_key_password"}`.
                      type: string
          responses:
            200:
              description: Database import result
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        upload = request.files.get("formData")
        if not upload:
            return self.response_400()
        if not is_zipfile(upload):
            raise IncorrectFormatError("Not a ZIP file")
        with ZipFile(upload) as bundle:
            contents = get_contents_from_bundle(bundle)

        if not contents:
            raise NoValidFilesFoundError()

        passwords = (
            json.loads(request.form["passwords"])
            if "passwords" in request.form
            else None
        )
        overwrite = request.form.get("overwrite") == "true"
        ssh_tunnel_passwords = (
            json.loads(request.form["ssh_tunnel_passwords"])
            if "ssh_tunnel_passwords" in request.form
            else None
        )
        ssh_tunnel_private_keys = (
            json.loads(request.form["ssh_tunnel_private_keys"])
            if "ssh_tunnel_private_keys" in request.form
            else None
        )
        ssh_tunnel_priv_key_passwords = (
            json.loads(request.form["ssh_tunnel_private_key_passwords"])
            if "ssh_tunnel_private_key_passwords" in request.form
            else None
        )

        command = ImportDatabasesCommand(
            contents,
            passwords=passwords,
            overwrite=overwrite,
            ssh_tunnel_passwords=ssh_tunnel_passwords,
            ssh_tunnel_private_keys=ssh_tunnel_private_keys,
            ssh_tunnel_priv_key_passwords=ssh_tunnel_priv_key_passwords,
        )
        command.run()
        return self.response(200, message="OK")

    @expose("/upload_metadata/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=(
            lambda self, *args, **kwargs: f"{self.__class__.__name__}.upload_metadata"
        ),
        log_to_statsd=False,
    )
    @requires_form_data
    def upload_metadata(self) -> Response:
        """Upload a file and returns file metadata.
        ---
        post:
          summary: Upload a file and returns file metadata
          requestBody:
            required: true
            content:
              multipart/form-data:
                schema:
                  $ref: '#/components/schemas/UploadFileMetadataPostSchema'
          responses:
            200:
              description: Upload response
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        $ref: '#/components/schemas/UploadFileMetadata'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            request_form = request.form.to_dict()
            request_form["file"] = request.files.get("file")
            parameters = UploadFileMetadataPostSchema().load(request_form)
        except ValidationError as error:
            return self.response_400(message=error.messages)
        if parameters["type"] == UploadFileType.CSV.value:
            metadata = CSVReader(parameters).file_metadata(parameters["file"])
        elif parameters["type"] == UploadFileType.EXCEL.value:
            metadata = ExcelReader(parameters).file_metadata(parameters["file"])
        elif parameters["type"] == UploadFileType.COLUMNAR.value:
            metadata = ColumnarReader(parameters).file_metadata(parameters["file"])
        else:
            self.response_400(message="Unexpected Invalid file type")
        return self.response(200, result=UploadFileMetadata().dump(metadata))

    @expose("/<int:pk>/upload/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.upload",
        log_to_statsd=False,
    )
    @requires_form_data
    def upload(self, pk: int) -> Response:
        """Upload a file into a database.
        ---
        post:
          summary: Upload a file to a database table
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          requestBody:
            required: true
            content:
              multipart/form-data:
                schema:
                  $ref: '#/components/schemas/UploadPostSchema'
          responses:
            201:
              description: CSV upload response
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            request_form = request.form.to_dict()
            request_form["file"] = request.files.get("file")
            parameters = UploadPostSchema().load(request_form)
            reader: BaseDataReader
            if parameters["type"] == UploadFileType.CSV.value:
                reader = CSVReader(parameters)
            elif parameters["type"] == UploadFileType.EXCEL.value:
                reader = ExcelReader(parameters)
            elif parameters["type"] == UploadFileType.COLUMNAR.value:
                reader = ColumnarReader(parameters)
            else:
                return self.response_400(message="Unexpected Invalid file type")
            UploadCommand(
                pk,
                parameters["table_name"],
                parameters["file"],
                parameters.get("schema"),
                reader,
            ).run()
        except ValidationError as error:
            return self.response_400(message=error.messages)
        return self.response(201, message="OK")

    @expose("/<int:pk>/function_names/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".function_names",
        log_to_statsd=False,
    )
    def function_names(self, pk: int) -> Response:
        """Get function names supported by a database.
        ---
        get:
          summary: Get function names supported by a database
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          responses:
            200:
              description: Query result
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/DatabaseFunctionNamesResponse"
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        return self.response(
            200,
            function_names=database.function_names,
        )

    @expose("/available/", methods=("GET",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.available",
        log_to_statsd=False,
    )
    def available(self) -> Response:
        """Get names of databases currently available.
        ---
        get:
          summary: Get names of databases currently available
          responses:
            200:
              description: Database names
              content:
                application/json:
                  schema:
                    type: array
                    items:
                      type: object
                      properties:
                        name:
                          description: Name of the database
                          type: string
                        engine:
                          description: Name of the SQLAlchemy engine
                          type: string
                        available_drivers:
                          description: Installed drivers for the engine
                          type: array
                          items:
                            type: string
                        sqlalchemy_uri_placeholder:
                          description: Placeholder for the SQLAlchemy URI
                          type: string
                        default_driver:
                          description: Default driver for the engine
                          type: string
                        preferred:
                          description: Is the database preferred?
                          type: boolean
                        sqlalchemy_uri_placeholder:
                          description: Example placeholder for the SQLAlchemy URI
                          type: string
                        parameters:
                          description: JSON schema defining the needed parameters
                          type: object
                        engine_information:
                          description: Dict with public properties form the DB Engine
                          type: object
                          properties:
                            supports_file_upload:
                              description: Whether the engine supports file uploads
                              type: boolean
                            disable_ssh_tunneling:
                              description: Whether the engine supports SSH Tunnels
                              type: boolean
            400:
              $ref: '#/components/responses/400'
            500:
              $ref: '#/components/responses/500'
        """
        preferred_databases: list[str] = app.config.get("PREFERRED_DATABASES", [])
        available_databases = []
        for engine_spec, drivers in get_available_engine_specs().items():
            if not drivers:
                continue

            payload: dict[str, Any] = {
                "name": engine_spec.engine_name,
                "engine": engine_spec.engine,
                "available_drivers": sorted(drivers),
                "sqlalchemy_uri_placeholder": engine_spec.sqlalchemy_uri_placeholder,
                "preferred": engine_spec.engine_name in preferred_databases,
                "engine_information": engine_spec.get_public_information(),
                "supports_oauth2": engine_spec.supports_oauth2,
            }

            if engine_spec.default_driver:
                payload["default_driver"] = engine_spec.default_driver

            # show configuration parameters for DBs that support it
            if (
                hasattr(engine_spec, "parameters_json_schema")
                and hasattr(engine_spec, "sqlalchemy_uri_placeholder")
                and engine_spec.default_driver in drivers
            ):
                payload["parameters"] = engine_spec.parameters_json_schema()
                payload["sqlalchemy_uri_placeholder"] = (
                    engine_spec.sqlalchemy_uri_placeholder
                )

            available_databases.append(payload)

        # sort preferred first
        response = sorted(
            (payload for payload in available_databases if payload["preferred"]),
            key=lambda payload: preferred_databases.index(payload["name"]),
        )

        # add others
        response.extend(
            sorted(
                (
                    payload
                    for payload in available_databases
                    if not payload["preferred"]
                ),
                key=lambda payload: payload["name"],
            )
        )

        return self.response(200, databases=response)

    @expose("/validate_parameters/", methods=("POST",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".validate_parameters",
        log_to_statsd=False,
    )
    @requires_json
    def validate_parameters(self) -> FlaskResponse:
        """Validate database connection parameters.
        ---
        post:
          summary: Validate database connection parameters
          requestBody:
            description: DB-specific parameters
            required: true
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/DatabaseValidateParametersSchema"
          responses:
            200:
              description: Database Test Connection
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            400:
              $ref: '#/components/responses/400'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            payload = DatabaseValidateParametersSchema().load(request.json)
        except ValidationError as ex:
            errors = [
                SupersetError(
                    message="\n".join(messages),
                    error_type=SupersetErrorType.INVALID_PAYLOAD_SCHEMA_ERROR,
                    level=ErrorLevel.ERROR,
                    extra={"invalid": [attribute]},
                )
                for attribute, messages in ex.messages.items()
            ]
            raise InvalidParametersError(errors) from ex

        command = ValidateDatabaseParametersCommand(payload)
        command.run()
        return self.response(200, message="OK")

    @expose("/<int:pk>/ssh_tunnel/", methods=("DELETE",))
    @protect()
    @statsd_metrics
    @deprecated(deprecated_in="4.0")
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".delete_ssh_tunnel",
        log_to_statsd=False,
    )
    def delete_ssh_tunnel(self, pk: int) -> Response:
        """Delete a SSH tunnel.
        ---
        delete:
          summary: Delete a SSH tunnel
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          responses:
            200:
              description: SSH Tunnel deleted
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        try:
            existing_ssh_tunnel_model = database.ssh_tunnels
            if existing_ssh_tunnel_model:
                DeleteSSHTunnelCommand(existing_ssh_tunnel_model.id).run()
                return self.response(200, message="OK")
            return self.response_404()
        except SSHTunnelDeleteFailedError as ex:
            logger.error(
                "Error deleting SSH Tunnel %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))
        except SSHTunnelingNotEnabledError as ex:
            logger.error(
                "Error deleting SSH Tunnel %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            return self.response_400(message=str(ex))

    @expose("/<int:pk>/schemas_access_for_file_upload/")
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".schemas_access_for_file_upload",
        log_to_statsd=False,
    )
    def schemas_access_for_file_upload(self, pk: int) -> Response:
        """The list of the database schemas where to upload information.
        ---
        get:
          summary: The list of the database schemas where to upload information
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          responses:
            200:
              description: The list of the database schemas where to upload information
              content:
                application/json:
                  schema:
                    $ref: "#/components/schemas/DatabaseSchemaAccessForFileUploadResponse"
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """  # noqa: E501
        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()

        schemas_allowed = database.get_schema_access_for_file_upload()
        # the list schemas_allowed should not be empty here
        # and the list schemas_allowed_processed returned from security_manager
        # should not be empty either,
        # otherwise the database should have been filtered out
        # in CsvToDatabaseForm
        schemas_allowed_processed = security_manager.get_schemas_accessible_by_user(
            database, database.get_default_catalog(), schemas_allowed, True
        )
        return self.response(200, schemas=schemas_allowed_processed)

    @expose("/<int:pk>/dhis2_metadata/", methods=["GET"])
    @protect()
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".dhis2_metadata",
        log_to_statsd=False,
    )
    def dhis2_metadata(self, pk: int) -> Response:
        """Fetch DHIS2 metadata (dataElements, indicators, orgUnits).
        ---
        get:
          summary: Fetch DHIS2 metadata for visual query builder
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          - in: query
            name: type
            schema:
              type: string
              enum: [dataElements, indicators, organisationUnits, periods]
          - in: query
            name: instance_id
            schema:
              type: integer
            description: Optional DHIS2 instance override for multi-instance metadata browsing
          - in: query
            name: table
            schema:
              type: string
              description: DHIS2 table name to filter compatible data elements (e.g., analytics, events)
          - in: query
            name: periodType
            schema:
              type: string
              enum: [YEARLY, QUARTERLY, MONTHLY, RELATIVE]
              description: Type of periods to return (for type=periods only)
          responses:
            200:
              description: DHIS2 metadata items
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        items:
                          type: object
                          properties:
                            id:
                              type: string
                            displayName:
                              type: string
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        chart = self._resolve_authenticated_dhis2_chart()
        resolved_database = (
            self._resolve_dhis2_database_from_chart_context(
                database=database,
                chart=chart,
            )
            if chart is not None
            else database
        )
        if not resolved_database:
            return self.response_404()
        return self._handle_dhis2_metadata_request(resolved_database, chart=chart)

    @expose("/<int:pk>/dhis2_metadata_public/", methods=["GET"])
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".dhis2_metadata_public",
        log_to_statsd=False,
    )
    def dhis2_metadata_public(self, pk: int) -> Response:
        """Fetch DHIS2 metadata for public charts and guest dashboard charts."""
        chart = self._resolve_public_dhis2_chart()
        if isinstance(chart, Response):
            return chart

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()

        resolved_database = self._resolve_dhis2_database_from_chart_context(
            database=database,
            chart=chart,
        )
        if not resolved_database:
            return self.response_404()

        return self._handle_dhis2_metadata_request(resolved_database, chart=chart)

    @expose("/dataset_sources/", methods=("GET",))
    @protect()
    @safe
    def dataset_sources(self) -> Response:
        """Return only dataset-creation-eligible source databases."""
        from superset.dhis2.dataset_source_service import list_dataset_source_databases

        result = list_dataset_source_databases()
        return self.response(200, count=len(result), result=result)

    def _handle_dhis2_metadata_request(
        self,
        database: Database,
        *,
        chart: Any | None = None,
    ) -> Response:
        if database.backend != "dhis2":
            return self.response_400(message="Database is not a DHIS2 connection")

        metadata_type = request.args.get("type", "dataElements")
        instance_id = request.args.get("instance_id", type=int)
        requested_instance_ids = self._parse_dhis2_instance_ids()
        if not requested_instance_ids and chart is not None:
            requested_instance_ids = self._resolve_dhis2_instance_ids_from_chart_context(
                chart,
            )
        federated = self._is_truthy(request.args.get("federated"))
        staged = self._is_truthy(request.args.get("staged"))
        level = request.args.get("level")  # Optional level filter for org units
        parent_ids = request.args.getlist("parent_ids")  # Optional parent org unit IDs to filter children
        period_type = request.args.get("periodType", "YEARLY")  # For periods
        org_unit_source_mode = (
            request.args.get("org_unit_source_mode", "federated").strip().lower()
        )
        primary_instance_id = request.args.get("primary_instance_id", type=int)
        period_year_raw = request.args.get("year")
        period_year = None
        if period_year_raw:
            try:
                period_year = int(period_year_raw)
            except (TypeError, ValueError):
                period_year = None
        table_name = request.args.get("table")  # Optional table context for filtering
        search_term = request.args.get("search", "")
        group_search = request.args.get("group_search", request.args.get("groupSearch", ""))
        
        # DX-specific filters
        domain_type = request.args.get("domainType")  # For data elements: AGGREGATE, TRACKER
        value_type = request.args.get("valueType")  # For data elements/indicators: NUMBER, INTEGER, etc.
        aggregation_type = request.args.get("aggregationType")  # For data elements: SUM, AVERAGE, etc.
        form_type = request.args.get("formType")  # For datasets: CUSTOM, SECTION, etc.
        program_id = request.args.get("programId")  # For program indicators, event data items
        program_stage_id = request.args.get("programStageId")
        indicator_type_id = request.args.get("indicatorTypeId")
        analytics_type = request.args.get("analyticsType")
        group_id = request.args.get("groupId", request.args.get("group"))
        group_set_id = request.args.get("groupSetId")
        page = request.args.get("page", type=int)
        page_size = request.args.get("page_size", request.args.get("pageSize"), type=int)

        # Handle periods specially - generate fixed periods
        if metadata_type == "periods":
            return self._generate_fixed_periods(period_type, period_year)

        if (
            metadata_type in {
                "organisationUnits",
                "organisationUnitLevels",
                "organisationUnitGroups",
                "geoFeatures",
                "geoJSON",
            }
            and org_unit_source_mode == "primary"
            and primary_instance_id is not None
        ):
            requested_instance_ids = [primary_instance_id]
            federated = False

        if metadata_type == "geoFeatures":
            ou_param = request.args.get("ou", "")
            return self._fetch_geo_features(
                database,
                ou_param,
                staged=staged,
                instance_id=instance_id,
                requested_instance_ids=requested_instance_ids,
                federated=federated,
            )

        if metadata_type == "geoJSON":
            levels_param = request.args.get("levels", "")
            parents_param = request.args.get("parents", "")
            return self._fetch_geo_json(
                database,
                levels_param,
                parents_param,
                staged=staged,
                instance_id=instance_id,
                requested_instance_ids=requested_instance_ids,
                federated=federated,
            )

        if staged:
            from superset.dhis2.metadata_staging_service import (
                get_staged_metadata_payload,
            )

            try:
                payload = get_staged_metadata_payload(
                    database=database,
                    metadata_type=metadata_type,
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                    table_name=table_name,
                    search_term=search_term,
                    level=level,
                    parent_ids=parent_ids,
                    domain_type=domain_type,
                    value_type=value_type,
                    aggregation_type=aggregation_type,
                    form_type=form_type,
                    program_id=program_id,
                    program_stage_id=program_stage_id,
                    indicator_type_id=indicator_type_id,
                    analytics_type=analytics_type,
                    group_id=group_id,
                    group_set_id=group_set_id,
                    group_search=group_search,
                    org_unit_source_mode=org_unit_source_mode,
                    page=page,
                    page_size=page_size,
                )
                return self.response(200, **payload)
            except ValueError as ex:
                return self.response_400(message=str(ex))
            except Exception as ex:
                logger.exception("Failed to fetch staged DHIS2 metadata")
                return self.response_500(message=str(ex))

        cache_key_parts = self._build_dhis2_metadata_cache_key_parts(
            metadata_type=metadata_type,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids,
            federated=federated,
            staged=staged,
            level=level,
            parent_ids=parent_ids,
            period_type=period_type,
            period_year=period_year,
            table_name=table_name,
            search_term=search_term,
            group_search=group_search,
            domain_type=domain_type,
            value_type=value_type,
            aggregation_type=aggregation_type,
            form_type=form_type,
            program_id=program_id,
            program_stage_id=program_stage_id,
            indicator_type_id=indicator_type_id,
            analytics_type=analytics_type,
            group_id=group_id,
            group_set_id=group_set_id,
            org_unit_source_mode=org_unit_source_mode,
            primary_instance_id=primary_instance_id,
            page=page,
            page_size=page_size,
        )
        cached_payload = self._get_cached_dhis2_metadata_payload(
            database.id,
            metadata_type,
            cache_key_parts,
        )
        if cached_payload is not None:
            return self.response(200, **cached_payload)

        # Handle organisationUnitLevels specially - different endpoint structure
        if metadata_type == "organisationUnitLevels":
            try:
                payload = self._build_org_unit_levels_payload(
                    database,
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                )
                payload = self._store_cached_dhis2_metadata_payload(
                    database.id,
                    metadata_type,
                    cache_key_parts,
                    payload,
                )
                return self.response(200, **payload)
            except Exception as ex:
                logger.exception("Failed to fetch DHIS2 organisation unit levels")
                return self.response_500(message=str(ex))

        # Handle organisationUnitGroups specially - different endpoint structure
        if metadata_type == "organisationUnitGroups":
            try:
                payload = self._build_org_unit_groups_payload(
                    database,
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                )
                payload = self._store_cached_dhis2_metadata_payload(
                    database.id,
                    metadata_type,
                    cache_key_parts,
                    payload,
                )
                return self.response(200, **payload)
            except Exception as ex:
                logger.exception("Failed to fetch DHIS2 organisation unit groups")
                return self.response_500(message=str(ex))

        try:
            payload = self._build_dhis2_metadata_payload(
                database=database,
                metadata_type=metadata_type,
                instance_id=instance_id,
                requested_instance_ids=requested_instance_ids,
                federated=federated,
                table_name=table_name,
                search_term=search_term,
                level=level,
                parent_ids=parent_ids,
                domain_type=domain_type,
                value_type=value_type,
                aggregation_type=aggregation_type,
                form_type=form_type,
                program_id=program_id,
                group_search=group_search,
            )
            payload = self._store_cached_dhis2_metadata_payload(
                database.id,
                metadata_type,
                cache_key_parts,
                payload,
            )
            return self.response(200, **payload)

        except DatabaseNotFoundException:
            return self.response_404()
        except ValueError as ex:
            return self.response_400(message=str(ex))
        except Exception as ex:
            logger.exception("Failed to fetch DHIS2 metadata")
            return self.response_500(message=str(ex))

    def _resolve_public_dhis2_chart(self) -> Any | Response:
        from sqlalchemy import and_, exists
        from superset.models.dashboard import Dashboard, dashboard_slices
        from superset.models.slice import Slice

        chart_id = request.args.get("slice_id", type=int) or request.args.get(
            "chart_id",
            type=int,
        )
        if not chart_id:
            return self.response_400(message="slice_id is required")

        # Use a direct query to avoid any session filters
        chart = db.session.query(Slice).filter(Slice.id == chart_id).one_or_none()
        if chart is None:
            return self.response_404()

        if getattr(chart, "is_public", False):
            return chart

        # Check if the chart belongs to any published dashboard
        from sqlalchemy import and_, exists
        is_in_published_dash = db.session.query(
            exists().where(
                and_(
                    dashboard_slices.c.slice_id == chart_id,
                    dashboard_slices.c.dashboard_id == Dashboard.id,
                    Dashboard.published == True,
                )
            )
        ).scalar()

        if is_in_published_dash:
            return chart

        # Fallback to check preloaded dashboards if any
        if any(getattr(d, "published", False) for d in chart.dashboards):
            return chart

        # Also check if it's explicitly allowed via dashboard_id in the request
        dashboard_id = request.args.get("dashboard_id", type=int)
        if dashboard_id:
            dashboard = (
                db.session.query(Dashboard)
                .filter(Dashboard.id == dashboard_id)
                .one_or_none()
            )
            # If the dashboard is published OR it's a public portal dashboard, allow access
            if dashboard and (dashboard.published or "/superset/public/" in (request.referrer or "")):
                return chart

        # Special case for DHIS2 Map: if it's a DHIS2 Map and we're in a public context,
        # be more permissive as these often need boundaries to even show anything.
        if chart.viz_type == "dhis2_map":
            # If we're on a public landing page or similar, allow it
            if "/superset/public/" in (request.referrer or ""):
                return chart

        if security_manager.is_guest_user():
            if dashboard_id:
                dashboard = (
                    db.session.query(Dashboard)
                    .filter(Dashboard.id == dashboard_id)
                    .one_or_none()
                )
                if dashboard and security_manager.has_guest_access(dashboard):
                    return chart

            chart_dashboards = getattr(chart, "dashboards", None) or []
            if any(
                security_manager.has_guest_access(existing_dashboard)
                for existing_dashboard in chart_dashboards
            ):
                return chart

        return self.response_403()

    @staticmethod
    def _resolve_authenticated_dhis2_chart() -> Any | None:
        from superset.models.slice import Slice

        chart_id = request.args.get("slice_id", type=int) or request.args.get(
            "chart_id",
            type=int,
        )
        if not chart_id:
            return None

        return db.session.query(Slice).filter(Slice.id == chart_id).one_or_none()

    @staticmethod
    def _get_chart_context_datasource_extra(chart: Any) -> dict[str, Any] | None:
        datasource = getattr(chart, "datasource", None)
        if datasource is None:
            return None

        extra_raw = getattr(datasource, "extra", None)
        extra: dict[str, Any] | None = None
        if isinstance(extra_raw, str) and extra_raw:
            try:
                extra = cast(dict[str, Any], json_lib.loads(extra_raw))
            except (TypeError, ValueError):
                extra = None
        elif isinstance(extra_raw, dict):
            extra = cast(dict[str, Any], extra_raw)

        return extra

    @staticmethod
    def _resolve_dhis2_database_from_chart_context(
        *,
        database: Database,
        chart: Any,
    ) -> Database | None:
        if getattr(database, "backend", None) == "dhis2":
            return database

        datasource = getattr(chart, "datasource", None)
        if datasource is None:
            return database

        extra = DatabaseRestApi._get_chart_context_datasource_extra(chart)

        source_database_id = (
            extra.get("dhis2_source_database_id")
            if extra
            else None
        ) or (
            extra.get("source_database_id") if extra else None
        ) or (
            extra.get("dhis2SourceDatabaseId") if extra else None
        )
        if source_database_id is not None:
            try:
                resolved_source_database_id = int(source_database_id)
            except (TypeError, ValueError):
                resolved_source_database_id = None
            if resolved_source_database_id is not None:
                source_database = DatabaseDAO.find_by_id(resolved_source_database_id)
                if source_database is not None:
                    return source_database

        datasource_database = getattr(datasource, "database", None)
        if getattr(datasource_database, "backend", None) == "dhis2":
            return datasource_database

        return database

    @staticmethod
    def _resolve_dhis2_instance_ids_from_chart_context(chart: Any) -> list[int]:
        extra = DatabaseRestApi._get_chart_context_datasource_extra(chart)
        if not extra:
            return []

        raw_values = (
            extra.get("dhis2_source_instance_ids")
            or extra.get("dhis2SourceInstanceIds")
            or extra.get("configured_connection_ids")
        )
        if not isinstance(raw_values, list):
            return []

        resolved_instance_ids: list[int] = []
        for raw_value in raw_values:
            try:
                parsed_value = int(raw_value)
            except (TypeError, ValueError):
                continue
            if parsed_value > 0:
                resolved_instance_ids.append(parsed_value)

        return list(dict.fromkeys(resolved_instance_ids))

    @staticmethod
    def _is_truthy(value: str | None) -> bool:
        return (value or "").strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _parse_dhis2_instance_ids() -> list[int]:
        requested_instance_ids: list[int] = []
        for raw_value in request.args.getlist("instance_ids"):
            for candidate in str(raw_value).split(","):
                candidate = candidate.strip()
                if not candidate:
                    continue
                try:
                    requested_instance_ids.append(int(candidate))
                except ValueError:
                    logger.warning(
                        "[DHIS2 Metadata] Ignoring invalid instance_ids value %r",
                        candidate,
                    )
        return list(dict.fromkeys(requested_instance_ids))

    @staticmethod
    def _build_dhis2_metadata_cache_key_parts(
        *,
        metadata_type: str,
        instance_id: int | None,
        requested_instance_ids: list[int],
        federated: bool,
        staged: bool,
        level: str | None,
        parent_ids: list[str],
        period_type: str,
        period_year: int | None,
        table_name: str | None,
        search_term: str,
        group_search: str,
        domain_type: str | None,
        value_type: str | None,
        aggregation_type: str | None,
        form_type: str | None,
        program_id: str | None,
        program_stage_id: str | None,
        indicator_type_id: str | None,
        analytics_type: str | None,
        group_id: str | None,
        group_set_id: str | None,
        org_unit_source_mode: str,
        primary_instance_id: int | None,
        page: int | None,
        page_size: int | None,
    ) -> dict[str, Any]:
        return {
            "metadata_type": metadata_type,
            "instance_id": instance_id,
            "instance_ids": sorted(requested_instance_ids),
            "federated": federated,
            "staged": staged,
            "level": level,
            "parent_ids": sorted(parent_ids),
            "period_type": period_type,
            "period_year": period_year,
            "table_name": table_name,
            "search_term": search_term,
            "group_search": group_search,
            "domain_type": domain_type,
            "value_type": value_type,
            "aggregation_type": aggregation_type,
            "form_type": form_type,
            "program_id": program_id,
            "program_stage_id": program_stage_id,
            "indicator_type_id": indicator_type_id,
            "analytics_type": analytics_type,
            "group_id": group_id,
            "group_set_id": group_set_id,
            "org_unit_source_mode": org_unit_source_mode,
            "primary_instance_id": primary_instance_id,
            "page": page,
            "page_size": page_size,
        }

    @staticmethod
    def _get_dhis2_metadata_cache_namespace(metadata_type: str) -> str:
        return f"dhis2_metadata:{metadata_type}"

    def _get_cached_dhis2_metadata_payload(
        self,
        database_id: int,
        metadata_type: str,
        key_parts: dict[str, Any],
    ) -> dict[str, Any] | None:
        from superset.staging import metadata_cache_service

        try:
            return metadata_cache_service.get_cached_metadata_payload(
                database_id,
                self._get_dhis2_metadata_cache_namespace(metadata_type),
                key_parts,
            )
        except Exception:  # pylint: disable=broad-except
            logger.debug(
                "Skipping DHIS2 metadata cache lookup for database id=%s",
                database_id,
                exc_info=True,
            )
            return None

    def _store_cached_dhis2_metadata_payload(
        self,
        database_id: int,
        metadata_type: str,
        key_parts: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        from superset.staging import metadata_cache_service

        if payload.get("status") == "failed":
            payload = dict(payload)
            payload["cached"] = False
            payload["cache_refreshed_at"] = None
            return payload

        try:
            return metadata_cache_service.set_cached_metadata_payload(
                database_id,
                self._get_dhis2_metadata_cache_namespace(metadata_type),
                key_parts,
                payload,
            )
        except Exception:  # pylint: disable=broad-except
            logger.debug(
                "Skipping DHIS2 metadata cache write for database id=%s",
                database_id,
                exc_info=True,
            )
            payload = dict(payload)
            payload["cached"] = False
            payload["cache_refreshed_at"] = None
            return payload

    def _build_dhis2_metadata_payload(
        self,
        *,
        database: Database,
        metadata_type: str,
        instance_id: int | None,
        requested_instance_ids: list[int],
        federated: bool,
        table_name: str | None,
        search_term: str,
        group_search: str,
        level: str | None,
        parent_ids: list[str],
        domain_type: str | None,
        value_type: str | None,
        aggregation_type: str | None,
        form_type: str | None,
        program_id: str | None,
    ) -> dict[str, Any]:
        contexts = self._build_dhis2_metadata_contexts(
            database=database,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids,
            federated=federated,
        )
        params = self._build_dhis2_metadata_params(
            metadata_type=metadata_type,
            table_name=table_name,
            search_term=search_term,
            level=level,
            parent_ids=parent_ids,
            domain_type=domain_type,
            value_type=value_type,
            aggregation_type=aggregation_type,
            form_type=form_type,
            program_id=program_id,
        )
        from superset.dhis2.metadata_staging_service import filter_metadata_items

        if federated or requested_instance_ids:
            aggregated_items: list[dict[str, Any]] = []
            instance_results: list[dict[str, Any]] = []
            successful_loads = 0

            for context in contexts:
                try:
                    items = self._fetch_dhis2_metadata_items(
                        metadata_type=metadata_type,
                        base_url=context["base_url"],
                        params=params,
                        auth=context["auth"],
                        headers=context["headers"],
                        table_name=table_name,
                        search_term=search_term,
                    )
                    items = filter_metadata_items(
                        metadata_type=metadata_type,
                        items=items,
                        table_name=table_name,
                        search_term=search_term,
                        level=level,
                        parent_ids=parent_ids,
                        domain_type=domain_type,
                        value_type=value_type,
                        aggregation_type=aggregation_type,
                        form_type=form_type,
                        program_id=program_id,
                        group_search=group_search,
                    )
                    successful_loads += 1
                    instance_results.append(
                        {
                            "id": context["instance_id"],
                            "name": context["instance_name"],
                            "status": "success",
                            "count": len(items),
                        }
                    )
                    aggregated_items.extend(
                        [
                            {
                                **item,
                                "source_instance_id": context["instance_id"],
                                "source_instance_name": context["instance_name"],
                                "source_database_id": database.id,
                                "source_database_name": database.database_name,
                            }
                            for item in items
                        ]
                    )
                except Exception as ex:  # pylint: disable=broad-except
                    logger.warning(
                        "[DHIS2 Metadata] Failed to load %s for instance id=%s",
                        metadata_type,
                        context["instance_id"],
                        exc_info=True,
                    )
                    instance_results.append(
                        {
                            "id": context["instance_id"],
                            "name": context["instance_name"],
                            "status": "failed",
                            "count": 0,
                            "error": str(ex),
                        }
                    )

            status = "failed"
            if successful_loads and successful_loads == len(contexts):
                status = "success"
            elif successful_loads:
                status = "partial"

            response_payload: dict[str, Any] = {
                "result": aggregated_items,
                "status": status,
                "instance_results": instance_results,
            }
            if status == "failed":
                response_payload["message"] = (
                    "Failed to load DHIS2 metadata from the configured connections."
                )
            elif status == "partial":
                response_payload["message"] = (
                    "Some configured DHIS2 connections could not be loaded."
                )
            return response_payload

        context = contexts[0]
        items = self._fetch_dhis2_metadata_items(
            metadata_type=metadata_type,
            base_url=context["base_url"],
            params=params,
            auth=context["auth"],
            headers=context["headers"],
            table_name=table_name,
            search_term=search_term,
        )
        items = filter_metadata_items(
            metadata_type=metadata_type,
            items=items,
            table_name=table_name,
            search_term=search_term,
            level=level,
            parent_ids=parent_ids,
            domain_type=domain_type,
            value_type=value_type,
            aggregation_type=aggregation_type,
            form_type=form_type,
            program_id=program_id,
            group_search=group_search,
        )
        return {"result": items}

    @staticmethod
    def _build_dhis2_database_context(database: Database) -> dict[str, Any]:
        uri = make_url(database.sqlalchemy_uri_decrypted)
        api_path = uri.database or "/api"
        if not api_path.startswith("/"):
            api_path = f"/{api_path}"

        base_url = f"https://{uri.host}{api_path}"
        auth = None
        headers: dict[str, str] = {}
        if not uri.username and uri.password:
            headers = {"Authorization": f"ApiToken {uri.password}"}
        else:
            auth = (uri.username, uri.password) if uri.username else None

        return {
            "instance_id": None,
            "instance_name": database.database_name,
            "base_url": base_url,
            "auth": auth,
            "headers": headers,
        }

    def _build_dhis2_metadata_contexts(
        self,
        *,
        database: Database,
        instance_id: int | None,
        requested_instance_ids: list[int],
        federated: bool,
    ) -> list[dict[str, Any]]:
        if instance_id is not None and not federated and not requested_instance_ids:
            from superset.dhis2 import instance_service as inst_svc

            dhis2_instance = inst_svc.get_instance(instance_id)
            if dhis2_instance is None:
                raise DatabaseNotFoundException("No such DHIS2 instance")
            if dhis2_instance.database_id != database.id:
                raise ValueError("DHIS2 instance does not belong to this database")
            return [
                {
                    "instance_id": dhis2_instance.id,
                    "instance_name": dhis2_instance.name,
                    "base_url": f"{dhis2_instance.url.rstrip('/')}/api",
                    "auth": None,
                    "headers": dhis2_instance.get_auth_headers(),
                }
            ]

        if federated or requested_instance_ids:
            from superset.dhis2 import instance_service as inst_svc

            instances = inst_svc.get_instances_with_legacy_fallback(
                database.id,
                include_inactive=False,
            )
            if requested_instance_ids:
                requested_ids = set(requested_instance_ids)
                instances = [
                    instance for instance in instances if instance.id in requested_ids
                ]
            return [
                {
                    "instance_id": instance.id,
                    "instance_name": instance.name,
                    "base_url": f"{instance.url.rstrip('/')}/api",
                    "auth": None,
                    "headers": instance.get_auth_headers(),
                }
                for instance in instances
            ]

        return [self._build_dhis2_database_context(database)]

    @staticmethod
    def _build_dhis2_metadata_params(
        *,
        metadata_type: str,
        table_name: str | None,
        search_term: str,
        level: str | None,
        parent_ids: list[str],
        domain_type: str | None,
        value_type: str | None,
        aggregation_type: str | None,
        form_type: str | None,
        program_id: str | None,
    ) -> dict[str, Any]:
        filters: list[str] = []

        if metadata_type == "dataElements":
            params: dict[str, Any] = {
                "fields": (
                    "id,displayName,name,aggregationType,valueType,domainType,"
                    "groups[id,displayName,name]"
                ),
                "paging": "false",
            }
            if domain_type:
                filters.append(f"domainType:eq:{domain_type}")
            if value_type:
                filters.append(f"valueType:eq:{value_type}")
            if aggregation_type:
                filters.append(f"aggregationType:eq:{aggregation_type}")
            if table_name == "analytics":
                filters.append(
                    "valueType:in:[NUMBER,INTEGER,INTEGER_POSITIVE,INTEGER_NEGATIVE,INTEGER_ZERO_OR_POSITIVE,PERCENTAGE,UNIT_INTERVAL]"
                )
            elif table_name == "events":
                filters.append("domainType:eq:TRACKER")
        elif metadata_type == "indicators":
            params = {
                "fields": (
                    "id,displayName,name,valueType,"
                    "indicatorType[id,displayName,name],groups[id,displayName,name]"
                ),
                "paging": "false",
            }
            if value_type:
                filters.append(f"valueType:eq:{value_type}")
        elif metadata_type == "dataSets":
            params = {
                "fields": "id,displayName,formType,dataSetElements",
                "paging": "false",
            }
            if form_type:
                filters.append(f"formType:eq:{form_type}")
        elif metadata_type == "programIndicators":
            params = {
                "fields": (
                    "id,displayName,name,program[id,displayName,name],analyticsType"
                ),
                "paging": "false",
            }
            if program_id:
                filters.append(f"program.id:eq:{program_id}")
        elif metadata_type == "eventDataItems":
            params = {
                "fields": (
                    "id,displayName,name,"
                    "programStage[id,displayName,name,program[id,displayName,name]],"
                    "dataElement[id,displayName,name,groups[id,displayName,name]]"
                ),
                "paging": "false",
            }
            if program_id:
                filters.append(f"programStage.program.id:eq:{program_id}")
        elif metadata_type in ["dataElementGroups", "indicatorGroups", "programs"]:
            params = {
                "fields": "id,displayName,members",
                "paging": "false",
            }
        elif metadata_type == "legendSets":
            params = {
                "fields": (
                    "id,displayName,name,"
                    "legends[id,displayName,name,startValue,endValue,color]"
                ),
                "paging": "false",
            }
        else:
            params = {
                "fields": "id,displayName,level,parent,path",
                "paging": "false",
            }
            if metadata_type == "organisationUnits" and level:
                filters.append(f"level:eq:{level}")
            if metadata_type == "organisationUnits" and parent_ids:
                filters.append("parent.id:in:[" + ",".join(parent_ids) + "]")

        if search_term:
            import re

            if re.match(r"^[a-zA-Z][a-zA-Z0-9]{10}$", search_term):
                filters.append(f"id:eq:{search_term}")
                logger.info("[DHIS2 Metadata] Searching by ID: %s", search_term)
            else:
                filters.append(f"displayName:ilike:{search_term}")
                logger.info(
                    "[DHIS2 Metadata] Searching by displayName: %s",
                    search_term,
                )

        if filters:
            params["filter"] = filters
        return params

    @staticmethod
    def _postprocess_dhis2_metadata_items(
        *,
        metadata_type: str,
        items: list[dict[str, Any]],
        table_name: str | None,
        search_term: str,
    ) -> list[dict[str, Any]]:
        processed_items = list(items)

        if metadata_type == "organisationUnits":
            processed_items = sorted(
                processed_items,
                key=lambda item: (
                    item.get("level", 999),
                    item.get("displayName", ""),
                ),
            )

        if metadata_type == "dataElements" and table_name == "analytics":
            for item in processed_items:
                agg_type = item.get("aggregationType", "NONE")
                value_type = item.get("valueType", "TEXT")
                item["category"] = "Aggregatable Data Elements"
                item["typeInfo"] = f"{value_type} ({agg_type})"

        max_items = 5000 if not search_term else len(processed_items)
        logger.info(
            "[DHIS2 Metadata] Returning %s items to frontend (total: %s)",
            min(len(processed_items), max_items),
            len(processed_items),
        )
        return processed_items[:max_items]

    def _fetch_dhis2_metadata_items(
        self,
        *,
        metadata_type: str,
        base_url: str,
        params: dict[str, Any],
        auth: Any,
        headers: dict[str, str],
        table_name: str | None,
        search_term: str,
    ) -> list[dict[str, Any]]:
        response = requests.get(
            f"{base_url}/{metadata_type}",
            params=params,
            auth=auth,
            headers=headers,
            timeout=30,
        )

        logger.info("[DHIS2 Metadata] Request URL: %s/%s", base_url, metadata_type)
        logger.info("[DHIS2 Metadata] Response status: %s", response.status_code)

        if response.status_code == 200:
            data = response.json()
            items = data.get(metadata_type, [])
            logger.info("[DHIS2 Metadata] Found %s %s", len(items), metadata_type)
            if items:
                logger.info(
                    "[DHIS2 Metadata] First item: %s",
                    items[0].get("displayName", items[0].get("name", "N/A")),
                )
            return self._postprocess_dhis2_metadata_items(
                metadata_type=metadata_type,
                items=items,
                table_name=table_name,
                search_term=search_term,
            )

        if response.status_code == 401:
            error_msg = (
                "DHIS2 API authentication failed. "
                f"Status: {response.status_code}. Please check database credentials."
            )
            logger.error("[DHIS2 Metadata] %s", error_msg)
            logger.error("[DHIS2 Metadata] Response: %s", response.text[:500])
            raise ValueError(error_msg)

        error_msg = f"DHIS2 API error: {response.status_code} {response.text[:200]}"
        logger.error("[DHIS2 Metadata] %s", error_msg)
        raise ValueError(error_msg)

    def _generate_fixed_periods(self, period_type: str, year: int | None = None) -> Response:
        """Generate fixed periods based on period type.

        Args:
            period_type: Type of periods - YEARLY, QUARTERLY, MONTHLY, etc.

        Returns:
            Response with list of period objects
        """
        from datetime import timedelta
        
        current_year = datetime.now().year
        current_month = datetime.now().month
        current_date = datetime.now().date()
        target_year = year or current_year
        periods = []
        month_labels = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ]

        if period_type == "DAILY":
            if year:
                start_date = datetime(target_year, 1, 1).date()
                end_date = datetime(target_year, 12, 31).date()
                d = start_date
                while d <= end_date:
                    periods.append({
                        "id": d.strftime("%Y%m%d"),
                        "displayName": d.strftime("%b %d, %Y"),
                        "type": "DAILY",
                    })
                    d += timedelta(days=1)
            else:
                # Generate last 365 days
                for i in range(364, -1, -1):
                    d = current_date - timedelta(days=i)
                    periods.append({
                        "id": d.strftime("%Y%m%d"),
                        "displayName": d.strftime("%b %d, %Y"),
                        "type": "DAILY"
                    })

        elif period_type == "WEEKLY" or period_type.startswith("WEEKLY"):
            # Map weekly types to their ID suffix
            suffix_map = {
                "WEEKLY": "",
                "WEEKLY_WED": "Wed",
                "WEEKLY_THU": "Thu",
                "WEEKLY_SAT": "Sat",
                "WEEKLY_SUN": "Sun",
            }
            suffix = suffix_map.get(period_type, "")
            if year:
                for week in range(1, 53):
                    periods.append({
                        "id": f"{target_year}{suffix}W{week}",
                        "displayName": f"Week {week} {target_year}" + (f" ({suffix} start)" if suffix else ""),
                        "type": period_type,
                    })
            else:
                # Generate weeks for last 52 weeks
                for week_offset in range(51, -1, -1):
                    week_start = current_date - timedelta(days=current_date.weekday() + 7 * week_offset)
                    iso_year, iso_week, _ = week_start.isocalendar()
                    periods.append({
                        "id": f"{iso_year}{suffix}W{iso_week}",
                        "displayName": f"Week {iso_week} {iso_year}" + (f" ({suffix} start)" if suffix else ""),
                        "type": period_type,
                    })

        elif period_type == "BI_WEEKLY":
            # Generate bi-weeks (DHIS2: YYYYBiW##)
            if year:
                for biweek in range(1, 27):
                    periods.append({
                        "id": f"{target_year}BiW{biweek}",
                        "displayName": f"Bi-week {biweek} {target_year}",
                        "type": "BI_WEEKLY",
                    })
            else:
                for biweek_offset in range(25, -1, -1):
                    biweek_start = current_date - timedelta(days=current_date.weekday() + 14 * biweek_offset)
                    iso_year, iso_week, _ = biweek_start.isocalendar()
                    biweek = max(1, (iso_week + 1) // 2)
                    periods.append({
                        "id": f"{iso_year}BiW{biweek}",
                        "displayName": f"Bi-week {biweek} {iso_year}",
                        "type": "BI_WEEKLY",
                    })

        elif period_type == "FOUR_WEEKLY":
            # Generate four-weekly periods for last 13 four-weeks
            if year:
                for fw in range(1, 14):
                    periods.append({
                        "id": f"{target_year}FW{fw}",
                        "displayName": f"Four-week {fw} {target_year}",
                        "type": "FOUR_WEEKLY",
                    })
            else:
                for fw_offset in range(12, -1, -1):
                    fw_start = current_date - timedelta(days=current_date.weekday() + 28 * fw_offset)
                    iso_year, iso_week, _ = fw_start.isocalendar()
                    fw = max(1, (iso_week + 3) // 4)
                    periods.append({
                        "id": f"{iso_year}FW{fw}",
                        "displayName": f"Four-week {fw} {iso_year}",
                        "type": "FOUR_WEEKLY",
                    })

        elif period_type == "MONTHLY":
            if year:
                for month in range(1, 13):
                    month_id = f"{target_year}{month:02d}"
                    periods.append({
                        "id": month_id,
                        "displayName": f"{month_labels[month-1]} {target_year}",
                        "type": "MONTHLY",
                    })
            else:
                # Generate months from January 2022 to present
                for y in range(2022, current_year + 1):
                    max_month = current_month if y == current_year else 12
                    for month in range(1, max_month + 1):
                        month_id = f"{y}{month:02d}"
                        periods.append({
                            "id": month_id,
                            "displayName": f"{month_labels[month-1]} {y}",
                            "type": "MONTHLY",
                        })
                periods.reverse()

        elif period_type == "BI_MONTHLY":
            # Generate bi-months
            if year:
                start_months = [1, 3, 5, 7, 9, 11]
                for start_month in start_months:
                    end_month = min(start_month + 1, 12)
                    periods.append({
                        "id": f"{target_year}{start_month:02d}B",
                        "displayName": f"{month_labels[start_month - 1]}-{month_labels[end_month - 1]} {target_year}",
                        "type": "BI_MONTHLY",
                    })
            else:
                for y in range(2022, current_year + 1):
                    for start_month in [1, 3, 5, 7, 9, 11]:
                        end_month = start_month + 1
                        if y < current_year or end_month <= current_month:
                            periods.append({
                                "id": f"{y}{start_month:02d}B",
                                "displayName": f"{month_labels[start_month - 1]}-{month_labels[end_month - 1]} {y}",
                                "type": "BI_MONTHLY",
                            })
                periods.reverse()

        elif period_type == "QUARTERLY":
            if year:
                for quarter in range(1, 5):
                    quarter_id = f"{target_year}Q{quarter}"
                    periods.append({
                        "id": quarter_id,
                        "displayName": f"Q{quarter} {target_year}",
                        "type": "QUARTERLY",
                    })
            else:
                # Generate quarters for last 3 years
                for y in range(current_year - 2, current_year + 1):
                    for quarter in range(1, 5):
                        quarter_id = f"{y}Q{quarter}"
                        periods.append({
                            "id": quarter_id,
                            "displayName": f"Q{quarter} {y}",
                            "type": "QUARTERLY"
                        })

        elif period_type == "SIX_MONTHLY":
            # Generate six-months
            if year:
                for half in range(1, 3):
                    label = "Jan-Jun" if half == 1 else "Jul-Dec"
                    periods.append({
                        "id": f"{target_year}S{half}",
                        "displayName": f"{label} {target_year}",
                        "type": "SIX_MONTHLY",
                    })
            else:
                for y in range(current_year - 4, current_year + 1):
                    for half in range(1, 3):
                        label = "Jan-Jun" if half == 1 else "Jul-Dec"
                        periods.append({
                            "id": f"{y}S{half}",
                            "displayName": f"{label} {y}",
                            "type": "SIX_MONTHLY",
                        })

        elif period_type == "SIX_MONTHLY_APR":
            # Generate six-months starting April
            if year:
                for half in range(1, 3):
                    label = "Apr-Sep" if half == 1 else f"Oct {target_year} - Mar {target_year + 1}"
                    periods.append({
                        "id": f"{target_year}AprilS{half}",
                        "displayName": f"{label}",
                        "type": "SIX_MONTHLY_APR",
                    })
            else:
                for y in range(current_year - 4, current_year + 1):
                    for half in range(1, 3):
                        label = "Apr-Sep" if half == 1 else f"Oct {y} - Mar {y + 1}"
                        periods.append({
                            "id": f"{y}AprilS{half}",
                            "displayName": f"{label}",
                            "type": "SIX_MONTHLY_APR",
                        })

        elif period_type == "YEARLY":
            # Generate last 10 years
            if year:
                periods.append({
                    "id": str(target_year),
                    "displayName": str(target_year),
                    "type": "YEARLY",
                })
            else:
                for y in range(current_year - 9, current_year + 1):
                    periods.append({
                        "id": str(y),
                        "displayName": str(y),
                        "type": "YEARLY"
                    })

        elif period_type in ["FINANCIAL_APR", "FINANCIAL_JUL", "FINANCIAL_OCT", "FINANCIAL_NOV"]:
            # Generate financial years
            suffix_map = {
                "FINANCIAL_APR": "April",
                "FINANCIAL_JUL": "July",
                "FINANCIAL_OCT": "Oct",
                "FINANCIAL_NOV": "Nov",
            }
            suffix_label = suffix_map.get(period_type, "April")
            if year:
                label = (
                    f"Apr {target_year} - Mar {target_year + 1}"
                    if period_type == "FINANCIAL_APR"
                    else f"Jul {target_year} - Jun {target_year + 1}"
                    if period_type == "FINANCIAL_JUL"
                    else f"Oct {target_year} - Sep {target_year + 1}"
                    if period_type == "FINANCIAL_OCT"
                    else f"Nov {target_year} - Oct {target_year + 1}"
                )
                periods.append({
                    "id": f"{target_year}{suffix_label}",
                    "displayName": label,
                    "type": period_type,
                })
            else:
                for y in range(current_year - 9, current_year + 1):
                    label = (
                        f"Apr {y} - Mar {y + 1}"
                        if period_type == "FINANCIAL_APR"
                        else f"Jul {y} - Jun {y + 1}"
                        if period_type == "FINANCIAL_JUL"
                        else f"Oct {y} - Sep {y + 1}"
                        if period_type == "FINANCIAL_OCT"
                        else f"Nov {y} - Oct {y + 1}"
                    )
                    periods.append({
                        "id": f"{y}{suffix_label}",
                        "displayName": label,
                        "type": period_type,
                    })

        return self.response(200, result=periods)

    @staticmethod
    def _fetch_dhis2_collection_items(
        *,
        base_url: str,
        collection_path: str,
        collection_key: str,
        params: dict[str, Any],
        auth: Any,
        headers: dict[str, str],
    ) -> list[dict[str, Any]]:
        response = requests.get(
            f"{base_url}/{collection_path}",
            params=params,
            auth=auth,
            headers=headers,
            timeout=30,
        )

        logger.info(
            "[DHIS2 Metadata] Request URL: %s/%s",
            base_url,
            collection_path,
        )
        logger.info("[DHIS2 Metadata] Response status: %s", response.status_code)

        if response.status_code == 200:
            data = response.json()
            return data.get(collection_key, [])

        if response.status_code == 401:
            error_msg = (
                "DHIS2 API authentication failed. "
                f"Status: {response.status_code}. Please check database credentials."
            )
            logger.error("[DHIS2 Metadata] %s", error_msg)
            logger.error("[DHIS2 Metadata] Response: %s", response.text[:500])
            raise ValueError(error_msg)

        error_msg = f"DHIS2 API error: {response.status_code} {response.text[:200]}"
        logger.error("[DHIS2 Metadata] %s", error_msg)
        raise ValueError(error_msg)

    @staticmethod
    def _merge_org_unit_level_items(
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return merge_org_unit_level_items(items)

    @staticmethod
    def _merge_org_unit_group_items(
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}

        for item in items:
            key = str(item.get("id") or item.get("displayName") or item.get("name") or "")
            if not key:
                continue

            current = merged.get(key)
            if current is None:
                current = dict(item)
                current["organisationUnits"] = []
                merged[key] = current

            if not current.get("displayName") and item.get("displayName"):
                current["displayName"] = item["displayName"]
            if not current.get("name") and item.get("name"):
                current["name"] = item["name"]

            existing_units = {
                str(unit.get("id") or unit.get("displayName") or unit.get("name") or ""): unit
                for unit in current.get("organisationUnits", [])
                if isinstance(unit, dict)
            }
            for unit in item.get("organisationUnits", []) or []:
                if not isinstance(unit, dict):
                    continue
                unit_key = str(
                    unit.get("id") or unit.get("displayName") or unit.get("name") or ""
                )
                if not unit_key:
                    continue
                if unit_key not in existing_units:
                    existing_units[unit_key] = unit

            current["organisationUnits"] = list(existing_units.values())

        return sorted(
            merged.values(),
            key=lambda item: (
                item.get("displayName", "") or item.get("name", ""),
                str(item.get("id", "")),
            ),
        )

    def _build_dhis2_special_collection_payload(
        self,
        *,
        database: Database,
        instance_id: int | None,
        requested_instance_ids: list[int],
        federated: bool,
        collection_path: str,
        collection_key: str,
        params: dict[str, Any],
        merge_items: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
    ) -> dict[str, Any]:
        contexts = self._build_dhis2_metadata_contexts(
            database=database,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids,
            federated=federated,
        )

        if not (federated or requested_instance_ids):
            context = contexts[0]
            items = self._fetch_dhis2_collection_items(
                base_url=context["base_url"],
                collection_path=collection_path,
                collection_key=collection_key,
                params=params,
                auth=context["auth"],
                headers=context["headers"],
            )
            return {"result": merge_items(items)}

        aggregated_items: list[dict[str, Any]] = []
        instance_results: list[dict[str, Any]] = []
        successful_loads = 0

        for context in contexts:
            try:
                items = self._fetch_dhis2_collection_items(
                    base_url=context["base_url"],
                    collection_path=collection_path,
                    collection_key=collection_key,
                    params=params,
                    auth=context["auth"],
                    headers=context["headers"],
                )
                successful_loads += 1
                instance_results.append(
                    {
                        "id": context["instance_id"],
                        "name": context["instance_name"],
                        "status": "success",
                        "count": len(items),
                    }
                )
                aggregated_items.extend(
                    [
                        {
                            **item,
                            "source_instance_id": context["instance_id"],
                            "source_instance_name": context["instance_name"],
                            "source_database_id": database.id,
                            "source_database_name": database.database_name,
                        }
                        for item in items
                    ]
                )
            except Exception as ex:  # pylint: disable=broad-except
                logger.warning(
                    "[DHIS2 Metadata] Failed to load %s for instance id=%s",
                    collection_path,
                    context["instance_id"],
                    exc_info=True,
                )
                instance_results.append(
                    {
                        "id": context["instance_id"],
                        "name": context["instance_name"],
                        "status": "failed",
                        "count": 0,
                        "error": str(ex),
                    }
                )

        status = "failed"
        if successful_loads and successful_loads == len(contexts):
            status = "success"
        elif successful_loads:
            status = "partial"

        response_payload: dict[str, Any] = {
            "result": merge_items(aggregated_items),
            "status": status,
            "instance_results": instance_results,
        }
        if status == "failed":
            response_payload["message"] = (
                "Failed to load DHIS2 metadata from the configured connections."
            )
        elif status == "partial":
            response_payload["message"] = (
                "Some configured DHIS2 connections could not be loaded."
            )
        return response_payload

    def _build_org_unit_levels_payload(
        self,
        database: Database,
        *,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        """Fetch organisation unit levels from DHIS2 API.

        Args:
            database: The DHIS2 database connection

        Returns:
            Response with list of organisation unit level objects
        """
        return self._build_dhis2_special_collection_payload(
            database=database,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids or [],
            federated=federated,
            collection_path="organisationUnitLevels",
            collection_key="organisationUnitLevels",
            params={
                "fields": "level,displayName,name",
                "paging": "false",
            },
            merge_items=self._merge_org_unit_level_items,
        )

    def _fetch_org_unit_levels(
        self,
        database: Database,
        *,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        try:
            return self.response(
                200,
                **self._build_org_unit_levels_payload(
                    database,
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                ),
            )
        except Exception as ex:
            logger.exception("Failed to fetch DHIS2 organisation unit levels")
            return self.response_500(message=str(ex))

    def _build_org_unit_groups_payload(
        self,
        database: Database,
        *,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        """Fetch organisation unit groups from DHIS2 API.

        Args:
            database: The DHIS2 database connection

        Returns:
            Response with list of organisation unit group objects
        """
        return self._build_dhis2_special_collection_payload(
            database=database,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids or [],
            federated=federated,
            collection_path="organisationUnitGroups",
            collection_key="organisationUnitGroups",
            params={
                "fields": "id,displayName,name,organisationUnits[id,displayName,level,parent[id]]",
                "paging": "false",
            },
            merge_items=self._merge_org_unit_group_items,
        )

    def _fetch_org_unit_groups(
        self,
        database: Database,
        *,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        try:
            return self.response(
                200,
                **self._build_org_unit_groups_payload(
                    database,
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                ),
            )
        except Exception as ex:
            logger.exception("Failed to fetch DHIS2 organisation unit groups")
            return self.response_500(message=str(ex))

    def _get_cached_or_fetch_dhis2(
        self,
        cache_key: str,
        fetch_func: callable,
        ttl: int = 86400,
        stale_threshold: int = 14400
    ) -> tuple[Any, bool]:
        """
        Get data from cache or fetch from DHIS2 with stale-while-revalidate pattern.

        This is critical for slow DHIS2 servers - users get instant responses from cache
        while data refreshes in the background.

        Args:
            cache_key: Unique key for this data
            fetch_func: Function to call if cache miss (should return data)
            ttl: Total cache lifetime in seconds (default: 24 hours)
            stale_threshold: Age after which to trigger background refresh (default: 4 hours)

        Returns:
            tuple: (data, from_cache) - data and whether it came from cache
        """
        import time

        # Try to get from cache (gracefully handle if cache not configured)
        try:
            cached = cache_manager.data_cache.get(cache_key)
        except Exception as e:
            logger.info(f"[DHIS2 Cache SWR] Cache not available, fetching directly: {e}")
            cached = None

        if cached:
            cache_age = time.time() - cached.get('timestamp', 0)

            # Check if cache is stale (but still valid)
            if cache_age > stale_threshold and cache_age < ttl:
                logger.info(f"[DHIS2 Cache SWR] Cache stale for {cache_key}, triggering background refresh")

                # Queue background refresh
                try:
                    from superset.tasks.dhis2_cache import warm_dhis2_cache
                    warm_dhis2_cache.delay(
                        database_id=cached.get('database_id'),
                        dataset_configs=[{
                            'cache_key': cache_key,
                            'fetch_func': 'geo_features'  # Identifier for the task
                        }]
                    )
                except Exception as e:
                    logger.warning(f"[DHIS2 Cache SWR] Failed to queue background refresh: {e}")

            logger.info(f"[DHIS2 Cache SWR] Cache hit for {cache_key} (age: {cache_age:.0f}s)")
            return cached.get('data'), True

        # Cache miss - fetch fresh data
        logger.info(f"[DHIS2 Cache SWR] Cache miss for {cache_key}, fetching fresh data")
        data = fetch_func()

        # Save to cache (if cache is available)
        try:
            cache_manager.data_cache.set(
                cache_key,
                {
                    'data': data,
                    'timestamp': time.time(),
                    'database_id': getattr(self, '_current_db_id', None),
                },
                timeout=ttl
            )
        except Exception as e:
            logger.info(f"[DHIS2 Cache SWR] Could not save to cache: {e}")

        return data, False

    def _fetch_geo_features(
        self,
        database: Database,
        ou_param: str,
        *,
        staged: bool = False,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        """Fetch geoFeatures from DHIS2 API with stale-while-revalidate caching.

        Args:
            database: The DHIS2 database connection
            ou_param: The ou dimension parameter (e.g., "LEVEL-1;LEVEL-2;parent_id")

        Returns:
            Response with list of geoFeature objects
        """
        import hashlib
        import requests
        from sqlalchemy.engine.url import make_url

        try:
            if staged:
                from superset.dhis2.metadata_staging_service import (
                    get_staged_geo_payload,
                )

                levels: list[str] = []
                parent_ids: list[str] = []
                for candidate in str(ou_param or "").split(";"):
                    candidate = candidate.strip()
                    if not candidate:
                        continue
                    normalized = candidate[3:] if candidate.upper().startswith("OU:") else candidate
                    if normalized.upper().startswith("LEVEL-"):
                        level_value = normalized.split("-", 1)[1].strip()
                        if level_value:
                            levels.append(level_value)
                    else:
                        parent_ids.append(normalized)

                response_data = get_staged_geo_payload(
                    database=database,
                    metadata_type="geoFeatures",
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                    levels=list(dict.fromkeys(levels)),
                    parent_ids=list(dict.fromkeys(parent_ids)),
                    # Keep map boundaries on the local staged snapshot path.
                    # A synchronous live DHIS2 fallback can block chart render
                    # for minutes and breaks the expected sub-second map load.
                    allow_live_fallback=False,
                )
                return compress_response_if_supported(response_data)

            # Generate cache key based on database and ou params
            cache_key_base = f"dhis2_geo_{database.id}_{ou_param}"
            cache_key = f"dhis2_geo_{hashlib.md5(cache_key_base.encode()).hexdigest()}"

            # Store database ID for background refresh
            self._current_db_id = database.id

            # Define fetch function
            def fetch_from_dhis2():
                # Parse database URI to get connection details
                uri = make_url(database.sqlalchemy_uri_decrypted)

                # Build DHIS2 API URL
                api_path = uri.database or "/api"
                if not api_path.startswith("/"):
                    api_path = f"/{api_path}"

                base_url = f"https://{uri.host}{api_path}"

                # Determine auth method
                if not uri.username and uri.password:
                    # PAT authentication
                    auth = None
                    headers = {"Authorization": f"ApiToken {uri.password}"}
                else:
                    # Basic authentication
                    auth = (uri.username, uri.password) if uri.username else None
                    headers = {}

                # Build geoFeatures URL
                # Format: /api/geoFeatures?ou=ou:LEVEL-1;LEVEL-2;parentId
                params = {}
                if ou_param:
                    params["ou"] = f"ou:{ou_param}"

                logger.info(f"[DHIS2 GeoFeatures] Fetching geoFeatures with params: {params}")

                response = requests.get(
                    f"{base_url}/geoFeatures",
                    params=params,
                    auth=auth,
                    headers=headers,
                    timeout=300,  # 5 minutes timeout for large geo data
                )

                logger.info(f"[DHIS2 GeoFeatures] Response status: {response.status_code}")

                if response.status_code == 200:
                    data = response.json()
                    # geoFeatures returns an array directly
                    features = data if isinstance(data, list) else data.get("geoFeatures", [])
                    logger.info(f"[DHIS2 GeoFeatures] Found {len(features)} features")

                    # Debug: Log coordinate structure of first feature
                    if features and len(features) > 0:
                        first_feature = features[0]
                        logger.info(f"[DHIS2 GeoFeatures] First feature sample: id={first_feature.get('id')}, name={first_feature.get('na')}, type={first_feature.get('ty')}")
                        coords_str = first_feature.get('co', '')
                        if coords_str:
                            import json as json_module
                            try:
                                coords = json_module.loads(coords_str) if isinstance(coords_str, str) else coords_str
                                # Detect nesting depth
                                def get_depth(c, d=0):
                                    if not isinstance(c, list) or len(c) == 0:
                                        return d
                                    if isinstance(c[0], (int, float)):
                                        return d + 1
                                    return get_depth(c[0], d + 1)
                                depth = get_depth(coords)
                                logger.info(f"[DHIS2 GeoFeatures] Coordinate depth: {depth}, outer_length: {len(coords) if isinstance(coords, list) else 'N/A'}")
                                # Log first coordinate for reference
                                sample = coords
                                for _ in range(min(depth - 1, 4)):
                                    if isinstance(sample, list) and len(sample) > 0:
                                        sample = sample[0]
                                logger.info(f"[DHIS2 GeoFeatures] Sample coordinate: {sample[:2] if isinstance(sample, list) else sample}")
                            except Exception as e:
                                logger.warning(f"[DHIS2 GeoFeatures] Failed to parse coords for logging: {e}")

                    return features
                elif response.status_code == 401:
                    error_msg = f"DHIS2 API authentication failed. Status: {response.status_code}"
                    logger.error(f"[DHIS2 GeoFeatures] {error_msg}")
                    raise Exception(error_msg)
                else:
                    error_msg = f"DHIS2 API error: {response.status_code} {response.text[:200]}"
                    logger.error(f"[DHIS2 GeoFeatures] {error_msg}")
                    raise Exception(error_msg)

            # Use stale-while-revalidate caching (24hr cache, 4hr stale threshold)
            features, from_cache = self._get_cached_or_fetch_dhis2(
                cache_key=cache_key,
                fetch_func=fetch_from_dhis2,
                ttl=86400,  # 24 hours
                stale_threshold=14400  # 4 hours
            )

            # Return compressed response for large geo datasets
            response_data = {
                "result": features,
                "from_cache": from_cache,
                "count": len(features) if isinstance(features, list) else 0
            }
            return compress_response_if_supported(response_data)

        except Exception as ex:
            logger.exception("Failed to fetch DHIS2 geoFeatures")
            return self.response_500(message=str(ex))

    def _fetch_geo_json(
        self,
        database: Database,
        levels_param: str,
        parents_param: str,
        *,
        staged: bool = False,
        instance_id: int | None = None,
        requested_instance_ids: list[int] | None = None,
        federated: bool = False,
    ) -> Response:
        """Fetch GeoJSON from DHIS2 organisationUnits.geojson endpoint.

        Args:
            database: The DHIS2 database connection
            levels_param: Comma-separated list of levels (e.g., "2,3,4")
            parents_param: Comma-separated list of parent org unit IDs

        Returns:
            Response with GeoJSON FeatureCollection
        """
        import requests
        from sqlalchemy.engine.url import make_url

        try:
            if staged:
                from superset.dhis2.metadata_staging_service import (
                    get_staged_geo_payload,
                )

                levels = [
                    candidate.strip()
                    for candidate in str(levels_param or "").split(",")
                    if candidate.strip()
                ]
                parents = [
                    candidate.strip()
                    for candidate in str(parents_param or "").split(",")
                    if candidate.strip()
                ]
                response_data = get_staged_geo_payload(
                    database=database,
                    metadata_type="geoJSON",
                    instance_id=instance_id,
                    requested_instance_ids=requested_instance_ids,
                    federated=federated,
                    levels=levels,
                    parent_ids=parents,
                    # Boundaries must stay local/staged for DHIS2 Map render
                    # performance. Missing levels should return immediately and
                    # queue a refresh instead of rehydrating from live DHIS2.
                    allow_live_fallback=False,
                )
                return compress_response_if_supported(response_data)

            # Parse database URI to get connection details
            uri = make_url(database.sqlalchemy_uri_decrypted)

            # Build DHIS2 API URL
            api_path = uri.database or "/api"
            if not api_path.startswith("/"):
                api_path = f"/{api_path}"

            base_url = f"https://{uri.host}{api_path}"

            # Determine auth method
            if not uri.username and uri.password:
                # PAT authentication
                auth = None
                headers = {
                    "Authorization": f"ApiToken {uri.password}",
                    "Accept": "application/json+geojson",
                }
            else:
                # Basic authentication
                auth = (uri.username, uri.password) if uri.username else None
                headers = {"Accept": "application/json+geojson"}

            # Build params for GeoJSON endpoint
            # Supports multiple level and parent params
            params = []
            if levels_param:
                for level in levels_param.split(","):
                    level = level.strip()
                    if level:
                        params.append(("level", level))

            if parents_param:
                for parent in parents_param.split(","):
                    parent = parent.strip()
                    if parent:
                        params.append(("parent", parent))

            # Use .geojson extension for native GeoJSON format
            url = f"{base_url}/organisationUnits.geojson"

            # Build cache key from params
            from superset.utils.dhis2_cache import get_dhis2_cache, get_ttl
            cache_key_parts = [f"geojson_{database.id}"]
            if levels_param:
                cache_key_parts.append(f"level_{levels_param.replace(',', '_')}")
            if parents_param:
                cache_key_parts.append(f"parent_{parents_param.replace(',', '_')}")
            cache_key = "_".join(cache_key_parts)

            # Try cache first
            cache = get_dhis2_cache()
            cached_data = cache.get(cache_key)

            if cached_data is not None:
                feature_count = len(cached_data.get("features", [])) if isinstance(cached_data, dict) else 0
                logger.info(f"[DHIS2 GeoJSON] Cache HIT: {cache_key} ({feature_count} features)")
                response_data = {"result": cached_data, "from_cache": True}
                return compress_response_if_supported(response_data)

            # Cache miss - fetch from DHIS2 API
            logger.info(f"[DHIS2 GeoJSON] Cache MISS: {cache_key} - fetching from API")
            logger.info(f"[DHIS2 GeoJSON] Fetching GeoJSON from: {url}")
            logger.info(f"[DHIS2 GeoJSON] Params: {params}")

            response = requests.get(
                url,
                params=params,
                auth=auth,
                headers=headers,
                timeout=300,  # 5 minutes timeout for large geo data
            )

            logger.info(f"[DHIS2 GeoJSON] Response status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                # Should be a GeoJSON FeatureCollection
                feature_count = len(data.get("features", [])) if isinstance(data, dict) else 0
                logger.info(f"[DHIS2 GeoJSON] Found {feature_count} features")

                # Cache the GeoJSON (6 hours TTL - geo boundaries rarely change)
                ttl = get_ttl('geojson')
                cache.set(cache_key, data, ttl=ttl)
                logger.info(f"[DHIS2 GeoJSON] Cached: {cache_key} (ttl: {ttl}s)")

                response_data = {"result": data, "from_cache": False}
                return compress_response_if_supported(response_data)
            elif response.status_code == 401:
                error_msg = f"DHIS2 API authentication failed. Status: {response.status_code}"
                logger.error(f"[DHIS2 GeoJSON] {error_msg}")
                return self.response_400(message=error_msg)
            else:
                error_msg = f"DHIS2 API error: {response.status_code} {response.text[:200]}"
                logger.error(f"[DHIS2 GeoJSON] {error_msg}")
                return self.response_400(message=error_msg)

        except Exception as ex:
            logger.exception("Failed to fetch DHIS2 GeoJSON")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_cache/stats/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    def dhis2_cache_stats(self, pk: int) -> Response:
        """Get DHIS2 cache statistics.
        ---
        get:
          summary: Get DHIS2 cache performance statistics
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          responses:
            200:
              description: Cache statistics
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      total_entries:
                        type: integer
                      active_entries:
                        type: integer
                      expired_entries:
                        type: integer
                      size_mb:
                        type: number
                      max_size_mb:
                        type: number
                      usage_percent:
                        type: number
                      hits:
                        type: integer
                      misses:
                        type: integer
                      hit_rate:
                        type: number
                      sets:
                        type: integer
                      evictions:
                        type: integer
                      avg_hit_time_ms:
                        type: number
                      avg_miss_time_ms:
                        type: number
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            from superset.utils.dhis2_cache import get_dhis2_cache

            cache = get_dhis2_cache()
            stats = cache.stats()

            logger.info(f"[DHIS2 Cache] Stats requested for database {pk}: {stats}")

            return self.response(200, **stats)

        except Exception as ex:
            logger.exception("Failed to get DHIS2 cache stats")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_cache/clear/", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    def dhis2_cache_clear(self, pk: int) -> Response:
        """Clear DHIS2 cache.
        ---
        post:
          summary: Clear DHIS2 cache (optionally by pattern)
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    pattern:
                      type: string
                      description: Optional pattern to match cache keys (e.g., "geojson_*")
          responses:
            200:
              description: Cache cleared successfully
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      message:
                        type: string
                      cleared_count:
                        type: integer
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            from superset.utils.dhis2_cache import get_dhis2_cache
            from flask import request

            pattern = None
            if request.json:
                pattern = request.json.get('pattern')

            cache = get_dhis2_cache()
            cleared_count = cache.clear(pattern=pattern)

            message = f"Cleared {cleared_count} cache entries"
            if pattern:
                message += f" matching pattern '{pattern}'"

            logger.info(f"[DHIS2 Cache] {message} for database {pk}")

            return self.response(200, message=message, cleared_count=cleared_count)

        except Exception as ex:
            logger.exception("Failed to clear DHIS2 cache")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_cache/keys/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    def dhis2_cache_keys(self, pk: int) -> Response:
        """Get DHIS2 cache keys.
        ---
        get:
          summary: Get list of cache keys
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          - in: query
            name: pattern
            schema:
              type: string
            description: Optional pattern to filter keys (e.g., "geojson_*")
          responses:
            200:
              description: List of cache keys
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      keys:
                        type: array
                        items:
                          type: string
                      count:
                        type: integer
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            from superset.utils.dhis2_cache import get_dhis2_cache
            from flask import request

            pattern = request.args.get('pattern')

            cache = get_dhis2_cache()
            keys = cache.get_keys(pattern=pattern)

            return self.response(200, keys=keys, count=len(keys))

        except Exception as ex:
            logger.exception("Failed to get DHIS2 cache keys")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_preview/columns/", methods=("POST",))
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}"
        f".dhis2_preview_columns",
        log_to_statsd=False,
    )
    def dhis2_preview_columns(self, pk: int) -> Response:
        """Generate column preview based on selected data elements, periods, and org units.
        ---
        post:
          summary: Generate column preview for DHIS2 dataset
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    data_elements:
                      type: array
                      items:
                        type: object
                        properties:
                          id:
                            type: string
                          displayName:
                            type: string
                    periods:
                      type: array
                      items:
                        type: object
                        properties:
                          id:
                            type: string
                          displayName:
                            type: string
                    org_units:
                      type: array
                      items:
                        type: object
                        properties:
                          id:
                            type: string
                          displayName:
                            type: string
                          level:
                            type: integer
                    include_children:
                      type: boolean
                      description: Include descendant org units
          responses:
            200:
              description: Column preview with data structure
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      columns:
                        type: array
                        items:
                          type: object
                      rows:
                        type: array
                        items:
                          type: object
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        from flask import request as flask_request
        from superset.db_engine_specs.dhis2 import DHIS2EngineSpec

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()

        if database.backend != "dhis2":
            return self.response_400(message="Database is not a DHIS2 connection")

        try:
            from datetime import datetime
            
            data = flask_request.get_json()
            data_elements = data.get("data_elements", [])
            periods = data.get("periods", [])
            org_units = data.get("org_units", [])
            include_children = data.get("include_children", False)
            data_level_scope = data.get("data_level_scope", "selected")

            if not data_elements:
                return self.response(200, columns=[], rows=[])
            
            from dateutil.relativedelta import relativedelta
            
            current_year = datetime.now().year
            current_month = datetime.now().month
            expanded_periods = []
            
            def expand_yearly_period(period_id: str) -> list:
                if period_id == "LAST_5_YEARS":
                    return [
                        {"id": str(current_year - i), "displayName": str(current_year - i)}
                        for i in range(5)
                    ]
                elif period_id == "LAST_10_YEARS":
                    return [
                        {"id": str(current_year - i), "displayName": str(current_year - i)}
                        for i in range(10)
                    ]
                elif period_id == "THIS_YEAR":
                    return [{"id": str(current_year), "displayName": str(current_year)}]
                elif period_id == "LAST_YEAR":
                    return [{"id": str(current_year - 1), "displayName": str(current_year - 1)}]
                return None
            
            def expand_monthly_period(period_id: str) -> list:
                if period_id == "LAST_12_MONTHS":
                    result = []
                    for i in range(12):
                        target_date = datetime.now() - relativedelta(months=i)
                        period_code = target_date.strftime("%Y%m")
                        period_name = target_date.strftime("%b %Y")
                        result.append({"id": period_code, "displayName": period_name})
                    return result
                elif period_id == "THIS_MONTH":
                    period_code = datetime.now().strftime("%Y%m")
                    period_name = datetime.now().strftime("%b %Y")
                    return [{"id": period_code, "displayName": period_name}]
                elif period_id == "LAST_MONTH":
                    last_month = datetime.now() - relativedelta(months=1)
                    period_code = last_month.strftime("%Y%m")
                    period_name = last_month.strftime("%b %Y")
                    return [{"id": period_code, "displayName": period_name}]
                elif period_id == "LAST_3_MONTHS":
                    result = []
                    for i in range(3):
                        target_date = datetime.now() - relativedelta(months=i)
                        period_code = target_date.strftime("%Y%m")
                        period_name = target_date.strftime("%b %Y")
                        result.append({"id": period_code, "displayName": period_name})
                    return result
                elif period_id == "LAST_6_MONTHS":
                    result = []
                    for i in range(6):
                        target_date = datetime.now() - relativedelta(months=i)
                        period_code = target_date.strftime("%Y%m")
                        period_name = target_date.strftime("%b %Y")
                        result.append({"id": period_code, "displayName": period_name})
                    return result
                return None
            
            for period in periods:
                period_id = period.get("id") if isinstance(period, dict) else period
                
                yearly_expanded = expand_yearly_period(period_id)
                if yearly_expanded:
                    expanded_periods.extend(yearly_expanded)
                    continue
                
                monthly_expanded = expand_monthly_period(period_id)
                if monthly_expanded:
                    expanded_periods.extend(monthly_expanded)
                    continue
                
                expanded_periods.append(period if isinstance(period, dict) else {"id": period_id, "displayName": period_id})
            
            periods = expanded_periods

            import re

            def sanitize_name(name: str) -> str:
                # Replace special characters (except alphanumerics) with underscores
                # This preserves distinctions: "Malaria-Total" -> "Malaria_Total"
                # instead of removing which would create duplicates
                sanitized = re.sub(r'[^a-zA-Z0-9_\s]', '_', name).strip()
                # Collapse multiple underscores to single
                sanitized = re.sub(r'_+', '_', sanitized)
                # Strip leading/trailing underscores
                sanitized = re.sub(r'^_+|_+$', '', sanitized)
                return sanitized

            de_ids = [
                de.get("id") if isinstance(de, dict) else de for de in data_elements
            ]
            period_ids = [p.get("id") if isinstance(p, dict) else p for p in periods]
            ou_ids = [ou.get("id") if isinstance(ou, dict) else ou for ou in org_units]

            # Fetch display names for all DX types from DHIS2 API
            # DX can be: dataElements, indicators, dataSets, programIndicators, eventDataItems
            import requests
            de_names = {}

            # Extract IDs from input (could be strings or dicts)
            all_dx_ids = []
            for de in data_elements:
                if isinstance(de, dict):
                    dx_id = de.get("id")
                    all_dx_ids.append(dx_id)
                    # Pre-populate from input if available
                    display_name = de.get("displayName") or de.get("name")
                    if display_name and display_name != dx_id:
                        de_names[dx_id] = display_name
                else:
                    all_dx_ids.append(de)

            # Fetch display names from all possible DX endpoints
            logger.info(f"[DHIS2 Preview] Fetching display names for {len(all_dx_ids)} DX items: {all_dx_ids}")
            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "base_url") and hasattr(connection, "auth"):
                        dx_filter = ",".join(all_dx_ids)

                        # Try each DX type endpoint to find display names
                        dx_endpoints = [
                            ("dataElements", "dataElements"),
                            ("indicators", "indicators"),
                            ("dataSets", "dataSets"),
                            ("programIndicators", "programIndicators"),
                        ]

                        for endpoint_name, response_key in dx_endpoints:
                            # Skip if we already have names for all IDs
                            missing_ids = [dx_id for dx_id in all_dx_ids if dx_id not in de_names]
                            if not missing_ids:
                                break

                            dx_filter = ",".join(missing_ids)
                            url = f"{connection.base_url}/{endpoint_name}.json?filter=id:in:[{dx_filter}]&fields=id,name,displayName&paging=false"
                            logger.info(f"[DHIS2 Preview] Trying {endpoint_name}: {url}")

                            try:
                                resp = requests.get(url, auth=connection.auth, timeout=30)
                                if resp.status_code == 200:
                                    dx_data = resp.json().get(response_key, [])
                                    if dx_data:
                                        logger.info(f"[DHIS2 Preview] Found {len(dx_data)} items in {endpoint_name}")
                                        for dx in dx_data:
                                            dx_id = dx.get("id")
                                            dx_display = dx.get("displayName") or dx.get("name") or dx_id
                                            de_names[dx_id] = dx_display
                                            logger.info(f"[DHIS2 Preview] {endpoint_name}: {dx_id} -> '{dx_display}'")
                            except Exception as endpoint_error:
                                logger.warning(f"[DHIS2 Preview] Error fetching {endpoint_name}: {endpoint_error}")
                                continue

            except Exception as e:
                logger.exception(f"[DHIS2 Preview] Could not fetch DX details: {e}")

            # Fill in any missing names with ID as fallback
            for dx_id in all_dx_ids:
                if dx_id not in de_names:
                    de_names[dx_id] = dx_id
                    logger.warning(f"[DHIS2 Preview] DX {dx_id} has no display name, using ID")

            logger.info(f"[DHIS2 Preview] Final dx_names: {de_names}")

            period_names = {}
            for p in periods:
                if isinstance(p, dict):
                    period_names[p.get("id")] = p.get("displayName", p.get("id"))
                else:
                    period_names[p] = p

            ou_names = {}
            ou_levels = {}
            ou_parents = {}
            for ou in org_units:
                if isinstance(ou, dict):
                    ou_names[ou.get("id")] = ou.get("displayName", ou.get("id"))
                    ou_levels[ou.get("id")] = ou.get("level", 0)
                    ou_parents[ou.get("id")] = ou.get("parent", {}).get("id") if isinstance(ou.get("parent"), dict) else None
                else:
                    ou_names[ou] = ou
                    ou_levels[ou] = 0
                    ou_parents[ou] = None

            # Fetch org unit level names from DHIS2 API
            # Using: /api/organisationUnitLevels?paging=false&fields=id,level,name
            org_unit_levels = []
            level_names = {}
            
            import requests
            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "base_url") and hasattr(connection, "auth"):
                        # Use the correct DHIS2 API endpoint
                        url = f"{connection.base_url}/organisationUnitLevels.json?paging=false&fields=id,level,name"
                        logger.info(f"[DHIS2 Preview] Fetching org unit levels from: {url}")
                        resp = requests.get(url, auth=connection.auth, timeout=30)
                        if resp.status_code == 200:
                            org_unit_levels = resp.json().get("organisationUnitLevels", [])
                            logger.info(f"[DHIS2 Preview] Fetched {len(org_unit_levels)} org unit levels: {org_unit_levels}")
                        else:
                            logger.warning(f"[DHIS2 Preview] Failed to fetch org unit levels: HTTP {resp.status_code}")
            except Exception as e:
                logger.warning(f"[DHIS2 Preview] Could not fetch org unit levels: {e}")
                # Fallback to DHIS2EngineSpec
                try:
                    org_unit_levels = DHIS2EngineSpec.fetch_org_unit_levels(database)
                    logger.info(f"[DHIS2 Preview] Fallback via EngineSpec: {len(org_unit_levels)} levels")
                except Exception as e2:
                    logger.warning(f"[DHIS2 Preview] Fallback also failed: {e2}")

            if org_unit_levels:
                for level_obj in org_unit_levels:
                    level_num = level_obj.get("level", 0)
                    # Use 'name' field (the actual level name like "Region", "District")
                    level_name = level_obj.get("name") or level_obj.get("displayName") or f"Level {level_num}"
                    level_names[level_num - 1] = level_name
                    logger.info(f"[DHIS2 Preview] Level {level_num} -> '{level_name}'")
                logger.info(f"[DHIS2 Preview] Final level_names: {level_names}")
            else:
                logger.warning("[DHIS2 Preview] No org unit levels from API, will infer from actual data...")

            # First, fetch ancestors for all selected org units to build complete hierarchy
            # This ensures we have parent org units like "Uganda" when user selects "Acholi Region"
            expanded_ou_ids = list(ou_ids)
            expanded_ous = []

            # Fetch org unit details including ancestors using the path
            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "base_url") and hasattr(connection, "auth"):
                        # Fetch selected org units with their ancestors
                        ou_filter = ",".join(ou_ids)
                        url = f"{connection.base_url}/organisationUnits.json?filter=id:in:[{ou_filter}]&fields=id,name,displayName,level,path,parent[id,name,displayName]&paging=false"
                        logger.info(f"[DHIS2 Preview] Fetching org units with path: {url}")
                        resp = requests.get(url, auth=connection.auth, timeout=30)
                        if resp.status_code == 200:
                            ou_data = resp.json().get("organisationUnits", [])
                            for ou in ou_data:
                                ou_id = ou.get("id")
                                ou_names[ou_id] = ou.get("displayName") or ou.get("name") or ou_id
                                ou_levels[ou_id] = ou.get("level", 0)
                                parent_info = ou.get("parent", {})
                                ou_parents[ou_id] = parent_info.get("id") if parent_info else None

                                # Parse the path to get all ancestor IDs
                                # Path format: /uid1/uid2/uid3/current_uid
                                path = ou.get("path", "")
                                if path:
                                    path_ids = [p for p in path.split("/") if p and p != ou_id]
                                    logger.info(f"[DHIS2 Preview] OU {ou_id} path ancestors: {path_ids}")

                                    # Fetch ancestor details
                                    if path_ids:
                                        ancestor_filter = ",".join(path_ids)
                                        ancestor_url = f"{connection.base_url}/organisationUnits.json?filter=id:in:[{ancestor_filter}]&fields=id,name,displayName,level&paging=false"
                                        ancestor_resp = requests.get(ancestor_url, auth=connection.auth, timeout=30)
                                        if ancestor_resp.status_code == 200:
                                            ancestors = ancestor_resp.json().get("organisationUnits", [])
                                            for anc in ancestors:
                                                anc_id = anc.get("id")
                                                if anc_id not in ou_names:
                                                    ou_names[anc_id] = anc.get("displayName") or anc.get("name") or anc_id
                                                    ou_levels[anc_id] = anc.get("level", 0)
                                                    logger.info(f"[DHIS2 Preview] Added ancestor: {anc_id} -> '{ou_names[anc_id]}' (level {ou_levels[anc_id]})")
            except Exception as e:
                logger.warning(f"[DHIS2 Preview] Could not fetch org unit details: {e}")

            # Expand to include children if requested
            if include_children:
                try:
                    with database.get_sqla_engine() as engine:
                        connection = engine.raw_connection()
                        if hasattr(connection, "fetch_org_units_with_descendants"):
                            expanded_ous = connection.fetch_org_units_with_descendants(ou_ids)
                            expanded_ou_ids = []
                            for ou in expanded_ous:
                                ou_id = ou.get("id")
                                expanded_ou_ids.append(ou_id)
                                ou_names[ou_id] = ou.get("displayName") or ou.get("name") or ou_id
                                ou_levels[ou_id] = ou.get("level", 0)
                                parent_id = ou.get("parent", {}).get("id") if isinstance(ou.get("parent"), dict) else None
                                ou_parents[ou_id] = parent_id
                        else:
                            logger.warning("Connection does not support fetch_org_units_with_descendants, using original list")
                except Exception as e:
                    logger.warning(f"Could not fetch descendants, using original list: {e}")
                    expanded_ou_ids = ou_ids
            
            if not level_names:
                logger.info("Level names still empty, inferring from expanded or selected organization units...")
                
                all_ous = expanded_ous if expanded_ous else org_units
                
                for ou in all_ous:
                    if isinstance(ou, dict):
                        ou_level = ou.get("level", 0)
                        if ou_level > 0 and (ou_level - 1) not in level_names:
                            level_names[ou_level - 1] = f"Level {ou_level}"
                
                if level_names:
                    logger.info(f"Inferred level names from org units: {level_names}")

            # Build hierarchy using the path from DHIS2
            def build_ou_hierarchy_from_levels(ou_ids_list, ou_names_map, ou_levels_map):
                """Build hierarchy based on actual DHIS2 levels, not parent-child relationships"""
                ou_hierarchy = {}

                for ou_id in ou_ids_list:
                    ou_level = ou_levels_map.get(ou_id, 0)

                    # Find ancestors by looking at org units with lower levels
                    # that are in the parent chain
                    ancestors_by_level = {}

                    # Walk up the parent chain
                    current_id = ou_id
                    while current_id:
                        current_level = ou_levels_map.get(current_id, 0)
                        if current_level > 0:
                            ancestors_by_level[current_level] = current_id
                        parent_id = ou_parents.get(current_id)
                        if parent_id and parent_id in ou_names_map:
                            current_id = parent_id
                        else:
                            break

                    # Build path from level 1 to current level
                    path = []
                    for lvl in sorted(ancestors_by_level.keys()):
                        path.append(ancestors_by_level[lvl])

                    ou_hierarchy[ou_id] = {
                        "level": ou_level,
                        "ancestors_by_level": ancestors_by_level,
                        "path": path,
                    }
                    logger.info(f"[DHIS2 Preview] OU {ou_id} (level {ou_level}): path={[ou_names_map.get(p, p) for p in path]}")

                return ou_hierarchy

            ou_hierarchy = build_ou_hierarchy_from_levels(expanded_ou_ids, ou_names, ou_levels)

            # Determine min and max levels from the data
            all_levels = [ou_levels.get(ou_id, 0) for ou_id in ou_ids]
            min_level = min(all_levels) if all_levels else 1
            max_level = max(all_levels) if all_levels else 1

            # Also check ancestors for min level
            for ou_id in ou_ids:
                hierarchy_info = ou_hierarchy.get(ou_id, {})
                for lvl in hierarchy_info.get("ancestors_by_level", {}).keys():
                    if lvl < min_level:
                        min_level = lvl

            # Adjust max level based on data_level_scope
            max_ou_unit_level = max(level_names.keys()) + 1 if level_names else 5
            if data_level_scope == "children":
                max_level = min(max_level + 1, max_ou_unit_level)
                # For children scope, show full hierarchy from level 1
                min_level = 1
                logger.info(f"[DHIS2 Preview] Adjusted max_level to {max_level} for 'children' scope")
            elif data_level_scope == "grandchildren":
                max_level = min(max_level + 2, max_ou_unit_level)
                # For grandchildren scope, show full hierarchy from level 1
                min_level = 1
                logger.info(f"[DHIS2 Preview] Adjusted max_level to {max_level} for 'grandchildren' scope")
            elif data_level_scope == "all_levels":
                max_level = max_ou_unit_level
                # For all_levels scope, show full hierarchy from level 1
                min_level = 1
                logger.info(f"[DHIS2 Preview] Adjusted max_level to {max_level} for 'all_levels' scope")

            logger.info(f"[DHIS2 Preview] Final level range: {min_level} to {max_level}")

            # Generate columns from min_level to max_level (DHIS2 levels are 1-indexed)
            columns = []
            for level in range(min_level, max_level + 1):
                # level_names uses 0-indexed keys, DHIS2 levels are 1-indexed
                level_name = level_names.get(level - 1, f"Level {level}")
                logger.info(f"[DHIS2 Preview] Column for DHIS2 level {level}: '{level_name}'")
                columns.append({
                    "title": level_name,
                    "dataIndex": f"ou_level_{level}",
                    "key": f"ou_level_{level}",
                    "width": 140,
                })

            columns.append({
                "title": "Period",
                "dataIndex": "period",
                "key": "period",
                "width": 120,
            })

            for de_id in de_ids:
                de_name = de_names.get(de_id, de_id)
                # Use the actual display name without sanitization
                logger.info(f"[DHIS2 Preview] Data Element Column: '{de_name}' (id: {de_id})")
                columns.append({
                    "title": de_name,
                    "dataIndex": f"de_{de_id}",
                    "key": f"de_{de_id}",
                    "width": 140,
                    "de_id": de_id,
                })

            ou_sorted = sorted(
                expanded_ou_ids,
                key=lambda x: (ou_levels.get(x, 0), ou_names.get(x, ""))
            )

            # Get leaf nodes (lowest level org units where data is tied)
            leaf_ou_ids = [ou_id for ou_id in ou_sorted if ou_levels.get(ou_id, 0) == max_level]
            
            logger.info(f"[DHIS2 Preview] Level range: {min_level}-{max_level}, Total expanded OUs: {len(expanded_ou_ids)}, Leaf nodes: {len(leaf_ou_ids)}")

            row_key_counter = 0
            rows = []
            for period_id in period_ids:
                period_name = period_names.get(period_id, period_id)
                for ou_id in leaf_ou_ids:
                    hierarchy_info = ou_hierarchy.get(ou_id, {})
                    ancestors_by_level = hierarchy_info.get("ancestors_by_level", {})

                    row = {
                        "key": f"{period_id}_{ou_id}_{row_key_counter}",
                        "period": period_name,
                    }

                    # Fill in hierarchy columns using DHIS2 levels (1-indexed)
                    for level in range(min_level, max_level + 1):
                        ancestor_id = ancestors_by_level.get(level)
                        if ancestor_id:
                            ancestor_name = ou_names.get(ancestor_id, ancestor_id)
                            row[f"ou_level_{level}"] = ancestor_name
                        else:
                            row[f"ou_level_{level}"] = ""

                    for de_id in de_ids:
                        row[f"de_{de_id}"] = "-"

                    rows.append(row)
                    row_key_counter += 1

            # Find non-empty levels (using DHIS2 1-indexed levels)
            non_empty_levels = set()
            for row in rows:
                for level in range(min_level, max_level + 1):
                    if row.get(f"ou_level_{level}", "").strip():
                        non_empty_levels.add(level)

            logger.info(f"[DHIS2 Preview] Non-empty org unit levels: {sorted(non_empty_levels)}")
            
            columns_to_keep = []
            for col in columns:
                data_index = col.get("dataIndex", "")
                if data_index.startswith("ou_level_"):
                    level_num = int(data_index.split("_")[-1])
                    if level_num in non_empty_levels:
                        columns_to_keep.append(col)
                else:
                    columns_to_keep.append(col)

            # Clean up empty level columns from rows
            for row in rows:
                for level in range(min_level, max_level + 1):
                    if level not in non_empty_levels and f"ou_level_{level}" in row:
                        del row[f"ou_level_{level}"]

            column_titles = [col.get("title") for col in columns_to_keep]
            logger.info(
                f"[DHIS2 Preview] Generated {len(columns_to_keep)} columns: {column_titles} "
                f"(removed {len(columns) - len(columns_to_keep)} empty) "
                f"for {len(rows)} rows"
            )
            return self.response(200, columns=columns_to_keep, rows=rows)

        except Exception as ex:
            logger.exception("Failed to generate DHIS2 column preview")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_expanded_org_units/", methods=("POST",))
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "DatabaseRestApi.dhis2_expanded_org_units",
        log_to_statsd=False,
    )
    def dhis2_expanded_org_units(self, pk: int) -> Response:
        """Return count of org units after expanding descendants.
        ---
        post:
          summary: Expand DHIS2 org units to include descendants (count only)
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    org_units:
                      type: array
                      items:
                        oneOf:
                        - type: string
                        - type: object
                          properties:
                            id:
                              type: string
                    include_children:
                      type: boolean
          responses:
            200:
              description: Expanded org unit count
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      count:
                        type: integer
        """
        from sqlalchemy.engine.url import make_url
        from superset.databases.dhis2_preview_utils import fetch_org_unit_descendants

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()
        if database.backend != "dhis2":
            return self.response_400(message="Database is not a DHIS2 connection")

        payload = request.get_json(silent=True) or {}
        raw_org_units = payload.get("org_units") or []
        include_children = bool(payload.get("include_children"))

        ou_ids: list[str] = []
        for ou in raw_org_units:
            if isinstance(ou, dict):
                ou_id = ou.get("id")
                if ou_id:
                    ou_ids.append(str(ou_id))
            else:
                ou_ids.append(str(ou))

        if not ou_ids:
            return self.response(200, count=0)

        if not include_children:
            return self.response(200, count=len(ou_ids))

        try:
            uri = make_url(database.sqlalchemy_uri_decrypted)
            api_path = uri.database or "/api"
            if not api_path.startswith("/"):
                api_path = f"/{api_path}"
            base_url = f"https://{uri.host}{api_path}"

            if not uri.username and uri.password:
                auth = None
            else:
                auth = (uri.username, uri.password) if uri.username else None

            expanded_ids = fetch_org_unit_descendants(base_url, auth, ou_ids)
            return self.response(200, count=len(expanded_ids))
        except Exception as ex:
            logger.exception("Failed to expand DHIS2 org units")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_preview/data/", methods=("POST",))
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "DatabaseRestApi.dhis2_preview_data",
        log_to_statsd=False,
    )
    def dhis2_preview_data(self, pk: int) -> Response:
        """Generate data preview with actual values from DHIS2.
        ---
        post:
          summary: Generate data preview for DHIS2 dataset
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    data_elements:
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
                    limit:
                      type: integer
                      default: 10
                    offset:
                      type: integer
                      default: 0
          responses:
            200:
              description: Data preview with actual values
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      columns:
                        type: array
                        items:
                          type: object
                      rows:
                        type: array
                        items:
                          type: object
                      total:
                        type: integer
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        from flask import request as flask_request
        from superset.databases.dhis2_preview_utils import (
            fetch_org_unit_level_names,
            fetch_dx_display_names,
            fetch_org_units_with_ancestors,
            build_ou_hierarchy,
            build_preview_columns,
            calculate_level_range,
            filter_empty_level_columns,
            build_ou_dimension_with_levels,
        )

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()

        if database.backend != "dhis2":
            return self.response_400(message="Database is not a DHIS2 connection")

        try:
            import requests
            from datetime import datetime
            from dateutil.relativedelta import relativedelta

            data = flask_request.get_json()
            data_elements = data.get("data_elements", [])
            periods = data.get("periods", [])
            org_units = data.get("org_units", [])
            endpoint = data.get("endpoint", "analytics")
            limit = data.get("limit", 10)
            offset = data.get("offset", 0)
            include_children = data.get("include_children", False)
            data_level_scope = data.get("data_level_scope", "selected")

            logger.info(f"[DHIS2 Data Preview] Received full payload: {data}")
            logger.info(f"[DHIS2 Data Preview] Received: endpoint={endpoint}, data_elements={data_elements}, periods={periods}, org_units={org_units}, include_children={include_children}, data_level_scope={data_level_scope}")
            logger.info(f"[DHIS2 Data Preview] Parameter types: data_elements={type(data_elements)}, periods={type(periods)}, org_units={type(org_units)}")
            logger.info(f"[DHIS2 Data Preview] Parameter lengths: data_elements={len(data_elements) if isinstance(data_elements, (list, dict)) else 'N/A'}, periods={len(periods) if isinstance(periods, (list, dict)) else 'N/A'}, org_units={len(org_units) if isinstance(org_units, (list, dict)) else 'N/A'}")

            if not data_elements or not periods or not org_units:
                logger.warning(f"[DHIS2 Data Preview] Empty input - returning empty response. data_elements_empty={not data_elements}, periods_empty={not periods}, org_units_empty={not org_units}")
                return self.response(
                    200, columns=[], rows=[], total=0
                )

            def sanitize_name(name: str) -> str:
                # Replace special characters (except alphanumerics) with underscores
                # This preserves distinctions: "Malaria-Total" -> "Malaria_Total"
                # instead of removing which would create duplicates
                sanitized = re.sub(r'[^a-zA-Z0-9_\s]', '_', name).strip()
                # Collapse multiple underscores to single
                sanitized = re.sub(r'_+', '_', sanitized)
                # Strip leading/trailing underscores
                sanitized = re.sub(r'^_+|_+$', '', sanitized)
                return sanitized

            de_ids = data_elements if isinstance(data_elements, list) else [
                data_elements
            ]
            
            def expand_yearly_period(period_id):
                if period_id == "LAST_5_YEARS":
                    result = []
                    for i in range(5):
                        year = datetime.now().year - i
                        result.append(str(year))
                    return result
                elif period_id == "LAST_3_YEARS":
                    result = []
                    for i in range(3):
                        year = datetime.now().year - i
                        result.append(str(year))
                    return result
                elif period_id == "LAST_YEAR":
                    year = datetime.now().year - 1
                    return [str(year)]
                return None
            
            def expand_monthly_period(period_id):
                if period_id == "THIS_YEAR":
                    result = []
                    for m in range(1, 13):
                        period_code = datetime.now().strftime("%Y") + f"{m:02d}"
                        result.append(period_code)
                    return result
                elif period_id == "LAST_YEAR":
                    result = []
                    last_year = datetime.now().year - 1
                    for m in range(1, 13):
                        period_code = f"{last_year}{m:02d}"
                        result.append(period_code)
                    return result
                elif period_id == "THIS_MONTH":
                    period_code = datetime.now().strftime("%Y%m")
                    return [period_code]
                elif period_id == "LAST_MONTH":
                    last_month = datetime.now() - relativedelta(months=1)
                    period_code = last_month.strftime("%Y%m")
                    return [period_code]
                elif period_id == "LAST_3_MONTHS":
                    result = []
                    for i in range(3):
                        target_date = datetime.now() - relativedelta(months=i)
                        period_code = target_date.strftime("%Y%m")
                        result.append(period_code)
                    return result
                elif period_id == "LAST_6_MONTHS":
                    result = []
                    for i in range(6):
                        target_date = datetime.now() - relativedelta(months=i)
                        period_code = target_date.strftime("%Y%m")
                        result.append(period_code)
                    return result
                return None
            
            expanded_periods = []
            for period in periods:
                period_id = period if isinstance(period, str) else period.get("id", period)
                
                yearly_expanded = expand_yearly_period(period_id)
                if yearly_expanded:
                    expanded_periods.extend(yearly_expanded)
                    continue
                
                monthly_expanded = expand_monthly_period(period_id)
                if monthly_expanded:
                    expanded_periods.extend(monthly_expanded)
                    continue
                
                expanded_periods.append(period_id)
            
            logger.info(f"[DHIS2 Data Preview] Expanded periods: {expanded_periods}")
            period_ids = expanded_periods
            
            # Handle org_units as either strings or objects
            # If objects, extract IDs and pre-populate metadata
            ou_ids: list[str] = []
            ou_names: dict[str, str] = {}
            ou_levels: dict[str, int] = {}
            ou_parents: dict[str, str | None] = {}

            raw_org_units = org_units if isinstance(org_units, list) else [org_units]
            for ou in raw_org_units:
                if isinstance(ou, dict):
                    ou_id = ou.get("id", "")
                    if ou_id:
                        ou_ids.append(ou_id)
                        # Pre-populate metadata from frontend if provided
                        if ou.get("displayName"):
                            ou_names[ou_id] = ou.get("displayName")
                        if ou.get("level"):
                            ou_levels[ou_id] = ou.get("level")
                        if ou.get("parent"):
                            parent = ou.get("parent")
                            if isinstance(parent, dict):
                                ou_parents[ou_id] = parent.get("id")
                            elif isinstance(parent, str):
                                ou_parents[ou_id] = parent
                elif isinstance(ou, str) and ou:
                    ou_ids.append(ou)

            logger.info(f"[DHIS2 Data Preview] Parsed {len(ou_ids)} org unit IDs, pre-populated {len(ou_names)} names, {len(ou_levels)} levels")

            # Get connection details for API calls to expand org units if needed
            base_url = None
            auth = None
            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "base_url") and hasattr(connection, "auth"):
                        base_url = connection.base_url
                        auth = connection.auth
            except Exception as e:
                logger.warning(f"[DHIS2 Data Preview] Could not get connection: {e}")

            if not base_url or not auth:
                return self.response_400(message="Could not connect to DHIS2")

            # Use shared utility functions for fetching metadata
            level_names = fetch_org_unit_level_names(base_url, auth)
            logger.info(f"[DHIS2 Data Preview] Fetched level_names: {level_names}")

            dx_names = fetch_dx_display_names(base_url, auth, de_ids)
            logger.info(f"[DHIS2 Data Preview] Fetched dx_names: {dx_names}")

            # Fetch additional org unit details (will merge with pre-populated data)
            add_ou_names, add_ou_levels, add_ou_parents = fetch_org_units_with_ancestors(base_url, auth, ou_ids)
            # Merge - API data takes precedence
            ou_names.update(add_ou_names)
            ou_levels.update(add_ou_levels)
            ou_parents.update(add_ou_parents)
            logger.info(f"[DHIS2 Data Preview] After merge: {len(ou_names)} names, {len(ou_levels)} levels, {len(ou_parents)} parents")

            # Build the org unit dimension with LEVEL syntax based on data_level_scope
            max_org_unit_level = max(level_names.keys()) if level_names else 5
            ou_dimension = build_ou_dimension_with_levels(
                ou_ids=ou_ids,
                ou_levels=ou_levels,
                data_level_scope=data_level_scope,
                max_org_unit_level=max_org_unit_level,
            )
            logger.info(f"[DHIS2 Data Preview] Built org unit dimension: {ou_dimension}")

            # Build hierarchy
            ou_hierarchy = build_ou_hierarchy(ou_ids, ou_names, ou_levels, ou_parents)

            # Calculate level range
            min_level, max_level = calculate_level_range(ou_ids, ou_levels, ou_hierarchy)
            logger.info(f"[DHIS2 Data Preview] Level range: {min_level} to {max_level}")

            # Adjust min/max level based on data_level_scope
            max_ou_unit_level = max(level_names.keys()) + 1 if level_names else 5
            if data_level_scope == "children":
                max_level = min(max_level + 1, max_ou_unit_level)
                min_level = 1
                logger.info(
                    f"[DHIS2 Data Preview] Adjusted level range for 'children': {min_level} to {max_level}"
                )
            elif data_level_scope == "grandchildren":
                max_level = min(max_level + 2, max_ou_unit_level)
                min_level = 1
                logger.info(
                    f"[DHIS2 Data Preview] Adjusted level range for 'grandchildren': {min_level} to {max_level}"
                )
            elif data_level_scope == "all_levels":
                max_level = max_ou_unit_level
                min_level = 1
                logger.info(
                    f"[DHIS2 Data Preview] Adjusted level range for 'all_levels': {min_level} to {max_level}"
                )

            # Fetch analytics data
            rows = []
            total_rows = 0

            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    logger.info(f"[DHIS2 Data Preview] Connection type: {type(connection)}")
                    logger.info(f"[DHIS2 Data Preview] Connection attributes: {dir(connection)[:10]}...")
                    
                    if hasattr(connection, "fetch_analytics_data"):
                        logger.info(f"[DHIS2 Data Preview] Fetching analytics data with custom ou dimension...")
                        logger.info(f"[DHIS2 Data Preview] fetch_analytics_data params: de_ids={de_ids}, period_ids={period_ids}, ou_ids={ou_ids}, ou_dimension={ou_dimension}")
                        data_values = connection.fetch_analytics_data(
                            de_ids=de_ids,
                            period_ids=period_ids,
                            ou_ids=ou_ids,
                            include_children=False,
                            ou_dimension=ou_dimension,
                            limit=limit,
                            offset=offset,
                        )

                        logger.info(f"[DHIS2 Data Preview] Received data_values type: {type(data_values)}")
                        logger.info(f"[DHIS2 Data Preview] data_values content: {data_values}")

                        if data_values and isinstance(data_values, dict):
                            all_rows = data_values.get("rows", [])
                            total_rows = len(all_rows)
                            logger.info(f"[DHIS2 Data Preview] Total rows from analytics: {total_rows}")
                            if total_rows == 0:
                                logger.warning(f"[DHIS2 Data Preview] No rows returned from analytics. Full response: {data_values}")
                    else:
                        logger.error(f"[DHIS2 Data Preview] Connection does not have fetch_analytics_data method. Available methods: {[m for m in dir(connection) if not m.startswith('_')]}")

                    # Get unique org unit IDs from analytics response
                    if data_values and isinstance(data_values, dict):
                        all_rows = data_values.get("rows", [])
                        analytics_ou_ids = list(set(row.get("ou", "") for row in all_rows if row.get("ou")))
                        logger.info(f"[DHIS2 Data Preview] Analytics returned {len(analytics_ou_ids)} unique org units: {analytics_ou_ids[:5]}...")

                        # Fetch details for any org units we don't have yet
                        # Process in batches to avoid URL length limits
                        missing_ou_ids = [ou_id for ou_id in analytics_ou_ids if ou_id not in ou_names]
                        logger.info(f"[DHIS2 Data Preview] Before fetch: ou_names={len(ou_names)}, ou_levels={len(ou_levels)}, ou_parents={len(ou_parents)}")
                        logger.info(f"[DHIS2 Data Preview] Missing org units to fetch: {len(missing_ou_ids)}")

                        if missing_ou_ids:
                            # Batch fetch to handle large numbers of org units
                            BATCH_SIZE = 50
                            for batch_start in range(0, len(missing_ou_ids), BATCH_SIZE):
                                batch_ids = missing_ou_ids[batch_start:batch_start + BATCH_SIZE]
                                logger.info(f"[DHIS2 Data Preview] Fetching batch {batch_start // BATCH_SIZE + 1}: {len(batch_ids)} org units")
                                add_ou_names, add_ou_levels, add_ou_parents = fetch_org_units_with_ancestors(base_url, auth, batch_ids)
                                logger.info(f"[DHIS2 Data Preview] Batch fetched: names={len(add_ou_names)}, levels={len(add_ou_levels)}, parents={len(add_ou_parents)}")
                                ou_names.update(add_ou_names)
                                ou_levels.update(add_ou_levels)
                                ou_parents.update(add_ou_parents)

                        logger.info(f"[DHIS2 Data Preview] After fetch: ou_names={len(ou_names)}, ou_levels={len(ou_levels)}, ou_parents={len(ou_parents)}")

                        # Rebuild hierarchy with all org units
                        logger.info(f"[DHIS2 Data Preview] Calling build_ou_hierarchy with {len(analytics_ou_ids)} ou_ids")
                        logger.info(f"[DHIS2 Data Preview] Sample analytics_ou_id: {analytics_ou_ids[0] if analytics_ou_ids else 'none'}")
                        if analytics_ou_ids:
                            sample_id = analytics_ou_ids[0]
                            logger.info(f"[DHIS2 Data Preview] Sample ou_names[{sample_id}]: {ou_names.get(sample_id, 'NOT FOUND')}")
                            logger.info(f"[DHIS2 Data Preview] Sample ou_levels[{sample_id}]: {ou_levels.get(sample_id, 'NOT FOUND')}")
                            logger.info(f"[DHIS2 Data Preview] Sample ou_parents[{sample_id}]: {ou_parents.get(sample_id, 'NOT FOUND')}")
                        ou_hierarchy = build_ou_hierarchy(analytics_ou_ids, ou_names, ou_levels, ou_parents)
                        logger.info(f"[DHIS2 Data Preview] Built hierarchy for {len(ou_hierarchy)} org units")
                        if analytics_ou_ids and ou_hierarchy:
                            sample_id = analytics_ou_ids[0]
                            sample_hierarchy = ou_hierarchy.get(sample_id, {})
                            logger.info(f"[DHIS2 Data Preview] Sample hierarchy for {sample_id}: {sample_hierarchy}")

                        # Recalculate level range
                        min_level, max_level = calculate_level_range(
                            analytics_ou_ids, ou_levels, ou_hierarchy
                        )
                        logger.info(f"[DHIS2 Data Preview] Updated level range: {min_level} to {max_level}")

                        # Re-apply level scope adjustment after recalculation
                        if data_level_scope == "children":
                            max_level = min(max_level + 1, max_ou_unit_level)
                            min_level = 1
                        elif data_level_scope == "grandchildren":
                            max_level = min(max_level + 2, max_ou_unit_level)
                            min_level = 1
                        elif data_level_scope == "all_levels":
                            max_level = max_ou_unit_level
                            min_level = 1

                        # Debug: log hierarchy info for first few rows
                        debug_logged = False

                        for idx, value_row in enumerate(all_rows):
                            if idx >= (offset + limit):
                                break
                            if idx < offset:
                                continue

                            ou_id = value_row.get("ou", "")
                            hierarchy_info = ou_hierarchy.get(ou_id, {})
                            ancestors_by_level = hierarchy_info.get("ancestors_by_level", {})

                            # Debug logging for first row
                            if not debug_logged:
                                logger.info(f"[DHIS2 Data Preview] DEBUG First row ou_id: '{ou_id}'")
                                logger.info(f"[DHIS2 Data Preview] DEBUG hierarchy_info: {hierarchy_info}")
                                logger.info(f"[DHIS2 Data Preview] DEBUG ancestors_by_level: {ancestors_by_level}")
                                logger.info(f"[DHIS2 Data Preview] DEBUG ou_names sample: {dict(list(ou_names.items())[:5])}")
                                logger.info(f"[DHIS2 Data Preview] DEBUG ou_levels sample: {dict(list(ou_levels.items())[:5])}")
                                logger.info(f"[DHIS2 Data Preview] DEBUG ou_parents sample: {dict(list(ou_parents.items())[:5])}")
                                debug_logged = True

                            row_data = {
                                "key": f"row_{idx}",
                                "period": value_row.get("pe", ""),
                            }

                            # Add hierarchy level columns using DHIS2 levels (1-indexed)
                            for level in range(min_level, max_level + 1):
                                ancestor_id = ancestors_by_level.get(level)
                                if ancestor_id:
                                    ancestor_name = ou_names.get(ancestor_id, ancestor_id)
                                    row_data[f"ou_level_{level}"] = ancestor_name
                                else:
                                    row_data[f"ou_level_{level}"] = ""

                            for de_id in de_ids:
                                # Use de_{id} key format to match column dataIndex
                                row_data[f"de_{de_id}"] = value_row.get(de_id, "-")

                            rows.append(row_data)
                        logger.info(f"[DHIS2 Data Preview] Processed {len(rows)} rows for response")
            except Exception as e:
                logger.exception(f"Could not fetch data values: {e}")
                total_rows = 0

            # Build columns using shared utility
            columns = build_preview_columns(level_names, dx_names, de_ids, min_level, max_level)

            # Filter empty level columns
            columns, rows = filter_empty_level_columns(columns, rows, min_level, max_level)

            logger.info(f"[DHIS2 Data Preview] Generated {len(columns)} columns for {len(rows)} rows")
            return self.response(
                200, columns=columns, rows=rows, total=total_rows
            )

        except Exception as ex:
            logger.exception("Failed to generate DHIS2 data preview")
            return self.response_500(message=str(ex))

    @expose("/<int:pk>/dhis2_chart_data/", methods=("POST",))
    @safe
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: "DatabaseRestApi.dhis2_chart_data",
        log_to_statsd=False,
    )
    def dhis2_chart_data(self, pk: int) -> Response:
        """Fetch DHIS2 data for charts using the same approach as DataPreview.

        This endpoint parses DHIS2 parameters from a dataset's SQL comment and
        returns data in the same format as the preview endpoint, ensuring charts
        can display DHIS2 data correctly.
        ---
        post:
          summary: Fetch DHIS2 data for chart visualization
          parameters:
          - in: path
            name: pk
            schema:
              type: integer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    sql:
                      type: string
                      description: Dataset SQL with DHIS2 comment parameters
                    columns:
                      type: array
                      items:
                        type: string
                      description: Columns to return (optional)
                    limit:
                      type: integer
                      default: 10000
          responses:
            200:
              description: Chart data with columns and rows
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      columns:
                        type: array
                      data:
                        type: array
                      total:
                        type: integer
            400:
              $ref: '#/components/responses/400'
            404:
              $ref: '#/components/responses/404'
            500:
              $ref: '#/components/responses/500'
        """
        import re
        from flask import request as flask_request
        from urllib.parse import unquote
        from superset.databases.dhis2_preview_utils import (
            fetch_org_unit_level_names,
            fetch_dx_display_names,
            fetch_org_units_with_ancestors,
            build_ou_hierarchy,
            build_preview_columns,
            calculate_level_range,
            filter_empty_level_columns,
            build_ou_dimension_with_levels,
        )

        database = DatabaseDAO.find_by_id(pk)
        if not database:
            return self.response_404()

        if database.backend != "dhis2":
            return self.response_400(message="Database is not a DHIS2 connection")

        try:
            from datetime import datetime
            from dateutil.relativedelta import relativedelta

            data = flask_request.get_json()
            sql = data.get("sql", "")
            requested_columns = data.get("columns", [])
            limit = data.get("limit", 10000)

            logger.info(f"[DHIS2 Chart Data] Received SQL: {sql[:200]}...")
            logger.info(f"[DHIS2 Chart Data] Requested columns: {requested_columns}")

            # Parse DHIS2 parameters from SQL comment
            # Format: /* DHIS2: table=analytics&dx=id1;id2&pe=LAST_5_YEARS&ou=ou1;ou2&ouMode=DESCENDANTS */
            params = {}
            block_comment_match = re.search(r'/\*\s*DHIS2:\s*(.+?)\s*\*/', sql, re.IGNORECASE | re.DOTALL)
            if block_comment_match:
                param_str = block_comment_match.group(1).strip()
                param_str = unquote(param_str)
                for param in param_str.split('&'):
                    if '=' in param:
                        key, value = param.split('=', 1)
                        params[key.strip()] = value.strip()

            if not params:
                logger.warning("[DHIS2 Chart Data] No DHIS2 parameters found in SQL")
                return self.response_400(message="No DHIS2 parameters found in SQL comment")

            logger.info(f"[DHIS2 Chart Data] Parsed params: {params}")

            # Extract parameters
            de_ids = params.get("dx", "").split(";") if params.get("dx") else []
            period_ids_raw = params.get("pe", "").split(";") if params.get("pe") else []
            ou_ids = params.get("ou", "").split(";") if params.get("ou") else []
            ou_mode = params.get("ouMode", "").upper()

            # Map ouMode to data_level_scope
            # DESCENDANTS = all levels below selected org units
            # CHILDREN = one level below selected org units
            # (default) = only selected org units
            if ou_mode == "DESCENDANTS":
                data_level_scope = "all_levels"
                include_children = True
            elif ou_mode == "CHILDREN":
                data_level_scope = "children"
                include_children = True
            elif ou_mode == "GRANDCHILDREN":
                data_level_scope = "grandchildren"
                include_children = True
            else:
                data_level_scope = "selected"
                include_children = False

            logger.info(f"[DHIS2 Chart Data] ouMode={ou_mode}, data_level_scope={data_level_scope}, include_children={include_children}")

            if not de_ids or not period_ids_raw or not ou_ids:
                return self.response_400(message="Missing required DHIS2 parameters (dx, pe, ou)")

            # Expand relative periods
            def expand_period(period_id):
                current_year = datetime.now().year
                if period_id == "LAST_5_YEARS":
                    return [str(current_year - i) for i in range(5)]
                elif period_id == "LAST_3_YEARS":
                    return [str(current_year - i) for i in range(3)]
                elif period_id == "THIS_YEAR":
                    return [str(current_year)]
                elif period_id == "LAST_YEAR":
                    return [str(current_year - 1)]
                return [period_id]

            period_ids = []
            for p in period_ids_raw:
                period_ids.extend(expand_period(p))

            logger.info(f"[DHIS2 Chart Data] Expanded periods: {period_ids}")

            # Get connection details
            base_url = None
            auth = None
            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "base_url") and hasattr(connection, "auth"):
                        base_url = connection.base_url
                        auth = connection.auth
            except Exception as e:
                logger.warning(f"[DHIS2 Chart Data] Could not get connection: {e}")

            if not base_url or not auth:
                return self.response_400(message="Could not connect to DHIS2")

            # Fetch metadata using the same utilities as DataPreview
            level_names = fetch_org_unit_level_names(base_url, auth)
            logger.info(f"[DHIS2 Chart Data] Fetched level_names: {level_names}")

            dx_names = fetch_dx_display_names(base_url, auth, de_ids)
            logger.info(f"[DHIS2 Chart Data] Fetched dx_names: {dx_names}")

            ou_names, ou_levels, ou_parents = fetch_org_units_with_ancestors(base_url, auth, ou_ids)
            logger.info(f"[DHIS2 Chart Data] Fetched {len(ou_names)} org units with ancestors")

            # Build org unit dimension with levels
            max_org_unit_level = max(level_names.keys()) if level_names else 5
            ou_dimension = build_ou_dimension_with_levels(
                ou_ids=ou_ids,
                ou_levels=ou_levels,
                data_level_scope=data_level_scope,
                max_org_unit_level=max_org_unit_level,
            )
            logger.info(f"[DHIS2 Chart Data] Built ou_dimension: {ou_dimension}")

            # Calculate level range
            ou_hierarchy = build_ou_hierarchy(ou_ids, ou_names, ou_levels, ou_parents)
            min_level, max_level = calculate_level_range(ou_ids, ou_levels, ou_hierarchy)

            # Adjust level scope
            max_ou_unit_level = max(level_names.keys()) + 1 if level_names else 5
            if data_level_scope == "all_levels":
                max_level = max_ou_unit_level
                min_level = 1

            # Fetch analytics data
            rows = []
            total_rows = 0

            try:
                with database.get_sqla_engine() as engine:
                    connection = engine.raw_connection()
                    if hasattr(connection, "fetch_analytics_data"):
                        logger.info(f"[DHIS2 Chart Data] Fetching analytics data with ou_mode={ou_mode}...")
                        data_values = connection.fetch_analytics_data(
                            de_ids=de_ids,
                            period_ids=period_ids,
                            ou_ids=ou_ids,
                            include_children=False,
                            ou_dimension=ou_dimension,
                            ou_mode=ou_mode,  # Pass DESCENDANTS, CHILDREN, etc.
                            limit=limit,
                            offset=0,
                        )

                        if data_values and isinstance(data_values, dict):
                            all_rows = data_values.get("rows", [])
                            total_rows = len(all_rows)
                            logger.info(f"[DHIS2 Chart Data] Total rows from analytics: {total_rows}")

                            # Fetch missing org unit details
                            analytics_ou_ids = list(set(row.get("ou", "") for row in all_rows if row.get("ou")))
                            missing_ou_ids = [ou_id for ou_id in analytics_ou_ids if ou_id not in ou_names]

                            BATCH_SIZE = 50
                            for batch_start in range(0, len(missing_ou_ids), BATCH_SIZE):
                                batch_ids = missing_ou_ids[batch_start:batch_start + BATCH_SIZE]
                                add_ou_names, add_ou_levels, add_ou_parents = fetch_org_units_with_ancestors(base_url, auth, batch_ids)
                                ou_names.update(add_ou_names)
                                ou_levels.update(add_ou_levels)
                                ou_parents.update(add_ou_parents)

                            # Rebuild hierarchy
                            ou_hierarchy = build_ou_hierarchy(analytics_ou_ids, ou_names, ou_levels, ou_parents)

                            # Recalculate level range
                            min_level, max_level = calculate_level_range(analytics_ou_ids, ou_levels, ou_hierarchy)
                            if data_level_scope == "all_levels":
                                max_level = max_ou_unit_level
                                min_level = 1

                            # Build rows with hierarchy
                            for idx, value_row in enumerate(all_rows):
                                if idx >= limit:
                                    break

                                ou_id = value_row.get("ou", "")
                                hierarchy_info = ou_hierarchy.get(ou_id, {})
                                ancestors_by_level = hierarchy_info.get("ancestors_by_level", {})

                                row_data = {
                                    "Period": value_row.get("pe", ""),
                                }

                                # Add hierarchy level columns
                                for level in range(min_level, max_level + 1):
                                    level_name = level_names.get(level, f"Level_{level}")
                                    # Sanitize column name to match dataset columns
                                    sanitized_level_name = re.sub(r'[^a-zA-Z0-9\s]', '', level_name).strip()
                                    sanitized_level_name = re.sub(r'\s+', '_', sanitized_level_name)

                                    ancestor_id = ancestors_by_level.get(level)
                                    if ancestor_id:
                                        row_data[sanitized_level_name] = ou_names.get(ancestor_id, ancestor_id)
                                    else:
                                        row_data[sanitized_level_name] = ""

                                # Add data element columns with sanitized names
                                for de_id in de_ids:
                                    de_name = dx_names.get(de_id, de_id)
                                    # Sanitize column name
                                    sanitized_de_name = re.sub(r'[^a-zA-Z0-9\s]', '', de_name).strip()
                                    sanitized_de_name = re.sub(r'\s+', '_', sanitized_de_name)

                                    raw_value = value_row.get(de_id, None)
                                    if raw_value is not None:
                                        try:
                                            row_data[sanitized_de_name] = float(raw_value)
                                        except (ValueError, TypeError):
                                            row_data[sanitized_de_name] = raw_value
                                    else:
                                        row_data[sanitized_de_name] = None

                                rows.append(row_data)

                            logger.info(f"[DHIS2 Chart Data] Processed {len(rows)} rows")

            except Exception as e:
                logger.exception(f"[DHIS2 Chart Data] Error fetching analytics: {e}")
                return self.response_500(message=f"Failed to fetch analytics data: {str(e)}")

            # Build column metadata
            columns = []
            if rows:
                for col_name in rows[0].keys():
                    col_type = "STRING"
                    # Data element columns are FLOAT
                    for de_id in de_ids:
                        de_name = dx_names.get(de_id, de_id)
                        sanitized_de_name = re.sub(r'[^a-zA-Z0-9\s]', '', de_name).strip()
                        sanitized_de_name = re.sub(r'\s+', '_', sanitized_de_name)
                        if col_name == sanitized_de_name:
                            col_type = "FLOAT"
                            break

                    columns.append({
                        "name": col_name,
                        "type": col_type,
                        "is_dttm": col_name == "Period",
                    })

            logger.info(f"[DHIS2 Chart Data] Returning {len(rows)} rows, {len(columns)} columns")

            return self.response(
                200,
                columns=columns,
                data=rows,
                total=total_rows,
            )

        except Exception as ex:
            logger.exception("Failed to generate DHIS2 chart data")
            return self.response_500(message=str(ex))
