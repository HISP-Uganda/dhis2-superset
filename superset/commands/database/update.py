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

from __future__ import annotations

import logging
from functools import partial
from typing import Any

from flask_appbuilder.models.sqla import Model
from marshmallow import ValidationError

from superset import db, is_feature_enabled
from superset.commands.base import BaseCommand
from superset.commands.database.exceptions import (
    DatabaseExistsValidationError,
    DatabaseInvalidError,
    DatabaseNotFoundError,
    DatabaseUpdateFailedError,
    MissingOAuth2TokenError,
    UserNotFoundInSessionError,
)
from superset.commands.database.ssh_tunnel.create import CreateSSHTunnelCommand
from superset.commands.database.ssh_tunnel.delete import DeleteSSHTunnelCommand
from superset.commands.database.ssh_tunnel.exceptions import (
    SSHTunnelingNotEnabledError,
)
from superset.commands.database.ssh_tunnel.update import UpdateSSHTunnelCommand
from superset.commands.database.sync_permissions import SyncPermissionsCommand
from superset.daos.database import DatabaseDAO
from superset.databases.ssh_tunnel.models import SSHTunnel
from superset.db_engine_specs.dhis2 import DHIS2EngineSpec
from superset.dhis2.database_repository_org_unit_service import (
    DatabaseRepositoryOrgUnitService,
    extract_repository_reporting_unit_payload,
)
from superset.dhis2.metadata_staging_service import (
    schedule_database_metadata_refresh_after_commit,
)
from superset.exceptions import OAuth2RedirectError
from superset.models.core import Database
from superset.utils import json
from superset.utils.core import get_username
from superset.utils.decorators import on_error, transaction

logger = logging.getLogger(__name__)


class UpdateDatabaseCommand(BaseCommand):
    _model: Database | None

    def __init__(self, model_id: int, data: dict[str, Any]):
        self._properties = data.copy()
        self._model_id = model_id
        self._model: Database | None = None
        self._repository_reporting_unit_payload = (
            extract_repository_reporting_unit_payload(self._properties)
        )

    @transaction(on_error=partial(on_error, reraise=DatabaseUpdateFailedError))
    def run(self) -> Model:
        self._model = DatabaseDAO.find_by_id(self._model_id)

        if not self._model:
            raise DatabaseNotFoundError()

        self.validate()
        is_dhis2_shell = self._is_dhis2_shell_database()

        if "masked_encrypted_extra" in self._properties:
            # unmask ``encrypted_extra``
            self._properties["encrypted_extra"] = (
                self._model.db_engine_spec.unmask_encrypted_extra(
                    self._model.encrypted_extra,
                    self._properties.pop("masked_encrypted_extra"),
                )
            )

            # Depending on the changes to the OAuth2 configuration we may need to purge
            # existing personal tokens.
            self._handle_oauth2()

        # Some DBs require running a query to get the default catalog.
        # In these cases, if the current connection is broken then
        # `get_default_catalog` would raise an exception. We need to
        # gracefully handle that so that the connection can be fixed.
        original_database_name = self._model.database_name
        force_update = False
        original_catalog = None
        if not is_dhis2_shell:
            try:
                original_catalog = self._model.get_default_catalog()
            except Exception:
                force_update = True

        # build new DB
        try:
            database = DatabaseDAO.update(self._model, self._properties)
            database.set_sqlalchemy_uri(database.sqlalchemy_uri)
            if self._repository_reporting_unit_payload:
                DatabaseRepositoryOrgUnitService.validate_and_stage(
                    database,
                    self._repository_reporting_unit_payload,
                )
        except ValidationError as ex:
            raise DatabaseInvalidError(exceptions=[ex]) from ex
        ssh_tunnel = self._handle_ssh_tunnel(database)
        new_catalog = None if is_dhis2_shell else database.get_default_catalog()

        # update assets when the database catalog changes, if the database was not
        # configured with multi-catalog support; if it was enabled or is enabled in the
        # update we don't update the assets
        if (
            not is_dhis2_shell
            and (
                force_update
                or new_catalog != original_catalog
                and not self._model.allow_multi_catalog
                and not database.allow_multi_catalog
            )
        ):
            self._update_catalog_attribute(self._model.id, new_catalog)

        # if the database name changed we need to update any existing permissions,
        # since they're name based
        if not is_dhis2_shell:
            try:
                current_username = get_username()
                SyncPermissionsCommand(
                    self._model_id,
                    current_username,
                    old_db_connection_name=original_database_name,
                    db_connection=database,
                    ssh_tunnel=ssh_tunnel,
                ).run()
            except (
                OAuth2RedirectError,
                MissingOAuth2TokenError,
                UserNotFoundInSessionError,
            ):
                pass

        self._schedule_dhis2_metadata_refresh(database)
        return database

    def _handle_oauth2(self) -> None:
        """
        Handle changes in OAuth2.
        """
        if not self._model:
            return

        if self._properties["encrypted_extra"] is None:
            self._model.purge_oauth2_tokens()
            return

        current_config = self._model.get_oauth2_config()
        if not current_config:
            return

        encrypted_extra = json.loads(self._properties["encrypted_extra"])
        new_config = encrypted_extra.get("oauth2_client_info", {})

        # Keys that require purging personal tokens because they probably are no longer
        # valid. For example, if the scope has changed the existing tokens are still
        # associated with the old scope. Similarly, if the endpoints changed the tokens
        # are probably no longer valid.
        keys = {
            "id",
            "scope",
            "authorization_request_uri",
            "token_request_uri",
        }
        for key in keys:
            if current_config.get(key) != new_config.get(key):
                self._model.purge_oauth2_tokens()
                break

    def _handle_ssh_tunnel(self, database: Database) -> SSHTunnel | None:
        """
        Delete, create, or update an SSH tunnel.
        """
        if "ssh_tunnel" not in self._properties:
            return None

        if not is_feature_enabled("SSH_TUNNELING"):
            raise SSHTunnelingNotEnabledError()

        current_ssh_tunnel = DatabaseDAO.get_ssh_tunnel(database.id)
        ssh_tunnel_properties = self._properties["ssh_tunnel"]

        if ssh_tunnel_properties is None:
            if current_ssh_tunnel:
                DeleteSSHTunnelCommand(current_ssh_tunnel.id).run()
            return None

        if current_ssh_tunnel is None:
            return CreateSSHTunnelCommand(database, ssh_tunnel_properties).run()

        return UpdateSSHTunnelCommand(
            current_ssh_tunnel.id,
            ssh_tunnel_properties,
        ).run()

    def _update_catalog_attribute(
        self,
        database_id: int,
        new_catalog: str | None,
    ) -> None:
        """
        Update the catalog of the datasets that are associated with database.
        """
        from superset.connectors.sqla.models import SqlaTable
        from superset.models.sql_lab import Query, SavedQuery, TableSchema, TabState

        for model in [
            SqlaTable,
            Query,
            SavedQuery,
            TabState,
            TableSchema,
        ]:
            fk = "db_id" if model == SavedQuery else "database_id"
            predicate = {fk: database_id}
            update = {"catalog": new_catalog}
            db.session.query(model).filter_by(**predicate).update(update)

    def validate(self) -> None:
        if database_name := self._properties.get("database_name"):
            if not DatabaseDAO.validate_update_uniqueness(
                self._model_id,
                database_name,
            ):
                raise DatabaseInvalidError(exceptions=[DatabaseExistsValidationError()])

    def _is_dhis2_shell_database(self) -> bool:
        if not self._model:
            return False

        backend = (
            self._properties.get("backend")
            or self._properties.get("engine")
            or self._model.backend
        )
        if backend != "dhis2":
            return False

        sqlalchemy_uri = (
            self._properties.get("sqlalchemy_uri")
            or getattr(self._model, "sqlalchemy_uri_decrypted", None)
            or getattr(self._model, "sqlalchemy_uri", None)
        )
        parameters = self._properties.get("parameters")

        return DHIS2EngineSpec.is_shell_sqlalchemy_uri(sqlalchemy_uri) or (
            isinstance(parameters, dict)
            and DHIS2EngineSpec.is_configured_connection_shell(parameters)
        )

    @staticmethod
    def _schedule_dhis2_metadata_refresh(database: Database) -> None:
        if database.backend != "dhis2":
            return
        schedule_database_metadata_refresh_after_commit(
            database.id,
            reason="database_updated",
        )
        if database.repository_reporting_unit_approach:
            DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit(
                database.id
            )
