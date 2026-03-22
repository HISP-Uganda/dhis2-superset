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

# pylint: disable=unused-argument, import-outside-toplevel, line-too-long, invalid-name

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY, Mock
from uuid import UUID

import pytest
import yaml
from flask import current_app
from freezegun import freeze_time
from pytest_mock import MockerFixture
from sqlalchemy.orm.session import Session

from superset import db
from superset.commands.database.uploaders.base import UploadCommand
from superset.commands.database.uploaders.columnar_reader import ColumnarReader
from superset.commands.database.uploaders.csv_reader import CSVReader
from superset.commands.database.uploaders.excel_reader import ExcelReader
from superset.db_engine_specs.sqlite import SqliteEngineSpec
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from superset.exceptions import OAuth2RedirectError, SupersetSecurityException
from superset.sql.parse import Table
from superset.superset_typing import OAuth2State
from superset.utils import json
from superset.utils.oauth2 import encode_oauth2_state
from tests.unit_tests.fixtures.common import (
    create_columnar_file,
    create_csv_file,
    create_excel_file,
)


def test_filter_by_uuid(
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we can filter databases by UUID.

    Note: this functionality is not used by the Superset UI, but is needed by 3rd
    party tools that use the Superset API. If this tests breaks, please make sure
    that the functionality is properly deprecated between major versions with
    enough warning so that tools can be adapted.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member
    db.session.add(
        Database(
            database_name="my_db",
            sqlalchemy_uri="sqlite://",
            uuid=UUID("7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"),
        )
    )
    db.session.commit()

    response = client.get(
        "/api/v1/database/?q=(filters:!((col:uuid,opr:eq,value:"
        "%277c1b7880-a59d-47cd-8bf1-f1eb8d2863cb%27)))"
    )
    assert response.status_code == 200

    payload = response.json
    assert len(payload["result"]) == 1
    assert payload["result"][0]["uuid"] == "7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"


def test_post_with_uuid(
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we can set the database UUID when creating it.
    """
    from superset.models.core import Database

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

    response = client.post(
        "/api/v1/database/",
        json={
            "database_name": "my_db",
            "sqlalchemy_uri": "sqlite://",
            "uuid": "7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb",
        },
    )
    assert response.status_code == 201

    # check that response includes UUID
    payload = response.json
    assert payload["result"]["uuid"] == "7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"

    database = session.query(Database).one()
    assert database.uuid == UUID("7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb")


def test_password_mask(
    mocker: MockerFixture,
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that sensitive information is masked.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

    database = Database(
        uuid=UUID("02feae18-2dd6-4bb4-a9c0-49e9d4f29d58"),
        database_name="my_database",
        sqlalchemy_uri="gsheets://",
        encrypted_extra=json.dumps(
            {
                "service_account_info": {
                    "type": "service_account",
                    "project_id": "black-sanctum-314419",
                    "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                    "private_key": "SECRET",
                    "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                    "client_id": "114567578578109757129",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                },
            }
        ),
    )
    db.session.add(database)
    db.session.commit()

    # mock the lookup so that we don't need to include the driver
    mocker.patch("sqlalchemy.engine.URL.get_driver_name", return_value="gsheets")
    mocker.patch("superset.utils.log.DBEventLogger.log")

    response = client.get("/api/v1/database/1/connection")

    # check that private key is masked
    assert (
        response.json["result"]["parameters"]["service_account_info"]["private_key"]
        == "XXXXXXXXXX"
    )
    assert "encrypted_extra" not in response.json["result"]


def test_database_connection(
    mocker: MockerFixture,
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that connection info is only returned in ``api/v1/database/${id}/connection``.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

    database = Database(
        uuid=UUID("02feae18-2dd6-4bb4-a9c0-49e9d4f29d58"),
        database_name="my_database",
        sqlalchemy_uri="gsheets://",
        encrypted_extra=json.dumps(
            {
                "service_account_info": {
                    "type": "service_account",
                    "project_id": "black-sanctum-314419",
                    "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                    "private_key": "SECRET",
                    "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                    "client_id": "114567578578109757129",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                },
            }
        ),
    )
    db.session.add(database)
    db.session.commit()

    # mock the lookup so that we don't need to include the driver
    mocker.patch("sqlalchemy.engine.URL.get_driver_name", return_value="gsheets")
    mocker.patch("superset.utils.log.DBEventLogger.log")

    response = client.get("/api/v1/database/1/connection")
    assert response.json == {
        "id": 1,
        "result": {
            "allow_ctas": False,
            "allow_cvas": False,
            "allow_dml": False,
            "allow_file_upload": False,
            "allow_run_async": False,
            "backend": "gsheets",
            "cache_timeout": None,
            "configuration_method": "sqlalchemy_form",
            "database_name": "my_database",
            "driver": "gsheets",
            "engine_information": {
                "disable_ssh_tunneling": True,
                "supports_dynamic_catalog": False,
                "supports_file_upload": True,
                "supports_oauth2": True,
            },
            "expose_in_sqllab": True,
            "extra": '{\n    "metadata_params": {},\n    "engine_params": {},\n    "metadata_cache_timeout": {},\n    "schemas_allowed_for_file_upload": []\n}\n',  # noqa: E501
            "force_ctas_schema": None,
            "id": 1,
            "impersonate_user": False,
            "is_managed_externally": False,
            "masked_encrypted_extra": json.dumps(
                {
                    "service_account_info": {
                        "type": "service_account",
                        "project_id": "black-sanctum-314419",
                        "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                        "private_key": "XXXXXXXXXX",
                        "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                        "client_id": "114567578578109757129",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                    }
                }
            ),
            "parameters": {
                "service_account_info": {
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                    "client_id": "114567578578109757129",
                    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                    "private_key": "XXXXXXXXXX",
                    "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                    "project_id": "black-sanctum-314419",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "type": "service_account",
                }
            },
            "parameters_schema": {
                "properties": {
                    "catalog": {"type": "object"},
                    "oauth2_client_info": {
                        "default": {
                            "authorization_request_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                            "scope": (
                                "https://www.googleapis.com/auth/drive.readonly "
                                "https://www.googleapis.com/auth/spreadsheets "
                                "https://spreadsheets.google.com/feeds"
                            ),
                            "token_request_uri": "https://oauth2.googleapis.com/token",
                        },
                        "description": "OAuth2 client information",
                        "nullable": True,
                        "type": "string",
                        "x-encrypted-extra": True,
                    },
                    "service_account_info": {
                        "description": "Contents of GSheets JSON credentials.",
                        "type": "string",
                        "x-encrypted-extra": True,
                    },
                },
                "type": "object",
            },
            "server_cert": None,
            "sqlalchemy_uri": "gsheets://",
            "uuid": "02feae18-2dd6-4bb4-a9c0-49e9d4f29d58",
        },
    }

    response = client.get("/api/v1/database/1")
    assert response.json == {
        "id": 1,
        "result": {
            "allow_ctas": False,
            "allow_cvas": False,
            "allow_dml": False,
            "allow_file_upload": False,
            "allow_run_async": False,
            "backend": "gsheets",
            "cache_timeout": None,
            "configuration_method": "sqlalchemy_form",
            "database_name": "my_database",
            "driver": "gsheets",
            "engine_information": {
                "disable_ssh_tunneling": True,
                "supports_dynamic_catalog": False,
                "supports_file_upload": True,
                "supports_oauth2": True,
            },
            "expose_in_sqllab": True,
            "force_ctas_schema": None,
            "id": 1,
            "impersonate_user": False,
            "is_managed_externally": False,
            "uuid": "02feae18-2dd6-4bb4-a9c0-49e9d4f29d58",
        },
    }


def test_update_with_password_mask(
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that an update with a masked password doesn't overwrite the existing password.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

    database = Database(
        database_name="my_database",
        sqlalchemy_uri="gsheets://",
        encrypted_extra=json.dumps(
            {
                "service_account_info": {
                    "project_id": "black-sanctum-314419",
                    "private_key": "SECRET",
                },
            }
        ),
    )
    db.session.add(database)
    db.session.commit()

    client.put(
        "/api/v1/database/1",
        json={
            "encrypted_extra": json.dumps(
                {
                    "service_account_info": {
                        "project_id": "yellow-unicorn-314419",
                        "private_key": "XXXXXXXXXX",
                    },
                }
            ),
        },
    )
    database = db.session.query(Database).one()
    assert (
        database.encrypted_extra
        == '{"service_account_info": {"project_id": "yellow-unicorn-314419", "private_key": "SECRET"}}'  # noqa: E501
    )


def test_import(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we can import a database export.
    """
    contents = {
        "metadata.yaml": yaml.safe_dump(
            {
                "version": "1.0.0",
                "type": "Database",
                "timestamp": "2021-01-01T00:00:00Z",
            }
        ),
        "databases/test.yaml": yaml.safe_dump(
            {
                "database_name": "test",
                "sqlalchemy_uri": "bigquery://gcp-project-id/",
                "cache_timeout": 0,
                "expose_in_sqllab": True,
                "allow_run_async": False,
                "allow_ctas": False,
                "allow_cvas": False,
                "allow_dml": False,
                "allow_file_upload": False,
                "encrypted_extra": json.dumps({"secret": "info"}),
                "extra": json.dumps({"allows_virtual_table_explore": True}),
                "uuid": "00000000-0000-0000-0000-123456789001",
            }
        ),
    }
    mocker.patch("superset.databases.api.is_zipfile", return_value=True)
    mocker.patch("superset.databases.api.ZipFile")
    mocker.patch(
        "superset.databases.api.get_contents_from_bundle",
        return_value=contents,
    )
    command = mocker.patch("superset.databases.api.ImportDatabasesCommand")

    form_data = {"formData": (BytesIO(b"test"), "test.zip")}
    client.post(
        "/api/v1/database/import/",
        data=form_data,
        content_type="multipart/form-data",
    )

    command.assert_called_with(
        contents,
        passwords=None,
        overwrite=False,
        ssh_tunnel_passwords=None,
        ssh_tunnel_private_keys=None,
        ssh_tunnel_priv_key_passwords=None,
    )


def test_non_zip_import(client: Any, full_api_access: None) -> None:
    """
    Test that non-ZIP imports are not allowed.
    """
    buf = BytesIO(b"definitely_not_a_zip_file")
    form_data = {
        "formData": (buf, "evil.pdf"),
    }
    response = client.post(
        "/api/v1/database/import/",
        data=form_data,
        content_type="multipart/form-data",
    )
    assert response.status_code == 422
    assert response.json == {
        "errors": [
            {
                "message": "Not a ZIP file",
                "error_type": "GENERIC_COMMAND_ERROR",
                "level": "warning",
                "extra": {
                    "issue_codes": [
                        {
                            "code": 1010,
                            "message": "Issue 1010 - Superset encountered an error while running a command.",  # noqa: E501
                        }
                    ]
                },
            }
        ]
    }


def test_delete_ssh_tunnel(
    mocker: MockerFixture,
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we can delete SSH Tunnel
    """
    with app.app_context():
        from superset.daos.database import DatabaseDAO
        from superset.databases.api import DatabaseRestApi
        from superset.databases.ssh_tunnel.models import SSHTunnel
        from superset.models.core import Database

        DatabaseRestApi.datamodel._session = session

        # create table for databases
        Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

        # Create our Database
        database = Database(
            database_name="my_database",
            sqlalchemy_uri="gsheets://",
            encrypted_extra=json.dumps(
                {
                    "service_account_info": {
                        "type": "service_account",
                        "project_id": "black-sanctum-314419",
                        "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                        "private_key": "SECRET",
                        "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                        "client_id": "SSH_TUNNEL_CREDENTIALS_CLIENT",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                    },
                }
            ),
        )
        db.session.add(database)
        db.session.commit()

        # mock the lookup so that we don't need to include the driver
        mocker.patch("sqlalchemy.engine.URL.get_driver_name", return_value="gsheets")
        mocker.patch("superset.utils.log.DBEventLogger.log")
        mocker.patch(
            "superset.commands.database.ssh_tunnel.delete.is_feature_enabled",
            return_value=True,
        )

        # Create our SSHTunnel
        tunnel = SSHTunnel(
            database_id=1,
            database=database,
        )

        db.session.add(tunnel)
        db.session.commit()

        # Get our recently created SSHTunnel
        response_tunnel = DatabaseDAO.get_ssh_tunnel(1)
        assert response_tunnel
        assert isinstance(response_tunnel, SSHTunnel)
        assert 1 == response_tunnel.database_id

        # Delete the recently created SSHTunnel
        response_delete_tunnel = client.delete(
            f"/api/v1/database/{database.id}/ssh_tunnel/"
        )
        assert response_delete_tunnel.json["message"] == "OK"

        response_tunnel = DatabaseDAO.get_ssh_tunnel(1)
        assert response_tunnel is None


def test_delete_ssh_tunnel_not_found(
    mocker: MockerFixture,
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we cannot delete a tunnel that does not exist
    """
    with app.app_context():
        from superset.daos.database import DatabaseDAO
        from superset.databases.api import DatabaseRestApi
        from superset.databases.ssh_tunnel.models import SSHTunnel
        from superset.models.core import Database

        DatabaseRestApi.datamodel._session = session

        # create table for databases
        Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

        # Create our Database
        database = Database(
            database_name="my_database",
            sqlalchemy_uri="gsheets://",
            encrypted_extra=json.dumps(
                {
                    "service_account_info": {
                        "type": "service_account",
                        "project_id": "black-sanctum-314419",
                        "private_key_id": "259b0d419a8f840056158763ff54d8b08f7b8173",
                        "private_key": "SECRET",
                        "client_email": "google-spreadsheets-demo-servi@black-sanctum-314419.iam.gserviceaccount.com",  # noqa: E501
                        "client_id": "SSH_TUNNEL_CREDENTIALS_CLIENT",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/google-spreadsheets-demo-servi%40black-sanctum-314419.iam.gserviceaccount.com",
                    },
                }
            ),
        )
        db.session.add(database)
        db.session.commit()

        # mock the lookup so that we don't need to include the driver
        mocker.patch("sqlalchemy.engine.URL.get_driver_name", return_value="gsheets")
        mocker.patch("superset.utils.log.DBEventLogger.log")
        mocker.patch(
            "superset.commands.database.ssh_tunnel.delete.is_feature_enabled",
            return_value=True,
        )

        # Create our SSHTunnel
        tunnel = SSHTunnel(
            database_id=1,
            database=database,
        )

        db.session.add(tunnel)
        db.session.commit()

        # Delete the recently created SSHTunnel
        response_delete_tunnel = client.delete("/api/v1/database/2/ssh_tunnel/")
        assert response_delete_tunnel.json["message"] == "Not found"

        # Get our recently created SSHTunnel
        response_tunnel = DatabaseDAO.get_ssh_tunnel(1)
        assert response_tunnel
        assert isinstance(response_tunnel, SSHTunnel)
        assert 1 == response_tunnel.database_id

        response_tunnel = DatabaseDAO.get_ssh_tunnel(2)
        assert response_tunnel is None


def test_apply_dynamic_database_filter(
    mocker: MockerFixture,
    app: Any,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test that we can filter the list of databases.
    First test the default behavior without a filter and then
    defining a filter function and patching the config to get
    the filtered results.
    """
    with app.app_context():
        from superset.daos.database import DatabaseDAO
        from superset.databases.api import DatabaseRestApi
        from superset.models.core import Database

        DatabaseRestApi.datamodel._session = session

        # create table for databases
        Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

        # Create our First Database
        database = Database(
            database_name="first-database",
            sqlalchemy_uri="gsheets://",
            encrypted_extra=json.dumps(
                {
                    "metadata_params": {},
                    "engine_params": {},
                    "metadata_cache_timeout": {},
                    "schemas_allowed_for_file_upload": [],
                }
            ),
        )
        db.session.add(database)
        db.session.commit()

        # Create our Second Database
        database = Database(
            database_name="second-database",
            sqlalchemy_uri="gsheets://",
            encrypted_extra=json.dumps(
                {
                    "metadata_params": {},
                    "engine_params": {},
                    "metadata_cache_timeout": {},
                    "schemas_allowed_for_file_upload": [],
                }
            ),
        )
        db.session.add(database)
        db.session.commit()

        # mock the lookup so that we don't need to include the driver
        mocker.patch("sqlalchemy.engine.URL.get_driver_name", return_value="gsheets")
        mocker.patch("superset.utils.log.DBEventLogger.log")
        mocker.patch(
            "superset.commands.database.ssh_tunnel.delete.is_feature_enabled",
            return_value=False,
        )

        def _base_filter(query):
            from superset.models.core import Database

            return query.filter(Database.database_name.startswith("second"))

        # Create a mock object
        base_filter_mock = Mock(side_effect=_base_filter)

        # Get our recently created Databases
        response_databases = DatabaseDAO.find_all()
        assert response_databases
        expected_db_names = ["first-database", "second-database"]
        actual_db_names = [db.database_name for db in response_databases]
        assert actual_db_names == expected_db_names

        # Ensure that the filter has not been called because it's not in our config
        assert base_filter_mock.call_count == 0

        # Temporarily update the config
        original_filters = current_app.config.get("EXTRA_DYNAMIC_QUERY_FILTERS", {})
        current_app.config["EXTRA_DYNAMIC_QUERY_FILTERS"] = {
            "databases": base_filter_mock
        }
        try:
            # Get filtered list
            response_databases = DatabaseDAO.find_all()
            assert response_databases
            expected_db_names = ["second-database"]
            actual_db_names = [db.database_name for db in response_databases]
            assert actual_db_names == expected_db_names

            # Ensure that the filter has been called once
            assert base_filter_mock.call_count == 1
        finally:
            # Restore original config
            current_app.config["EXTRA_DYNAMIC_QUERY_FILTERS"] = original_filters


def test_oauth2_happy_path(
    mocker: MockerFixture,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the OAuth2 endpoint when everything goes well.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database, DatabaseUserOAuth2Tokens

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member
    db.session.add(
        Database(
            id=1,
            database_name="my_db",
            sqlalchemy_uri="sqlite://",
            uuid=UUID("7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"),
        )
    )
    db.session.commit()

    mocker.patch.object(
        SqliteEngineSpec,
        "get_oauth2_config",
        return_value={"id": "one", "secret": "two"},
    )
    get_oauth2_token = mocker.patch.object(SqliteEngineSpec, "get_oauth2_token")
    get_oauth2_token.return_value = {
        "access_token": "YYY",
        "expires_in": 3600,
        "refresh_token": "ZZZ",
    }

    state: OAuth2State = {
        "user_id": 1,
        "database_id": 1,
        "tab_id": "42",
        "default_redirect_uri": "http://localhost:8088/api/v1/oauth2/",
    }

    mocker.patch("superset.databases.api.render_template", return_value="OK")

    with freeze_time("2024-01-01T00:00:00Z"):
        response = client.get(
            "/api/v1/database/oauth2/",
            query_string={
                "state": encode_oauth2_state(state),
                "code": "XXX",
            },
        )

    assert response.status_code == 200
    get_oauth2_token.assert_called_with({"id": "one", "secret": "two"}, "XXX")

    token = db.session.query(DatabaseUserOAuth2Tokens).one()
    assert token.user_id == 1
    assert token.database_id == 1
    assert token.access_token == "YYY"  # noqa: S105
    assert token.access_token_expiration == datetime(2024, 1, 1, 1, 0)
    assert token.refresh_token == "ZZZ"  # noqa: S105


def test_oauth2_permissions(
    mocker: MockerFixture,
    session: Session,
    client: Any,
) -> None:
    """
    Test the OAuth2 endpoint works for users without DB permissions.

    Anyone should be able to authenticate with OAuth2, even if they don't have
    permissions to read the database (which is needed to get the OAuth2 config).
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database, DatabaseUserOAuth2Tokens

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member
    db.session.add(
        Database(
            database_name="my_db",
            sqlalchemy_uri="sqlite://",
            uuid=UUID("7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"),
        )
    )
    db.session.commit()

    mocker.patch.object(
        SqliteEngineSpec,
        "get_oauth2_config",
        return_value={"id": "one", "secret": "two"},
    )
    get_oauth2_token = mocker.patch.object(SqliteEngineSpec, "get_oauth2_token")
    get_oauth2_token.return_value = {
        "access_token": "YYY",
        "expires_in": 3600,
        "refresh_token": "ZZZ",
    }

    state: OAuth2State = {
        "user_id": 1,
        "database_id": 1,
        "tab_id": "42",
        "default_redirect_uri": "http://localhost:8088/api/v1/oauth2/",
    }

    mocker.patch("superset.databases.api.render_template", return_value="OK")

    with freeze_time("2024-01-01T00:00:00Z"):
        response = client.get(
            "/api/v1/database/oauth2/",
            query_string={
                "state": encode_oauth2_state(state),
                "code": "XXX",
            },
        )

    assert response.status_code == 200
    get_oauth2_token.assert_called_with({"id": "one", "secret": "two"}, "XXX")

    token = db.session.query(DatabaseUserOAuth2Tokens).one()
    assert token.user_id == 1
    assert token.database_id == 1
    assert token.access_token == "YYY"  # noqa: S105
    assert token.access_token_expiration == datetime(2024, 1, 1, 1, 0)
    assert token.refresh_token == "ZZZ"  # noqa: S105


def test_oauth2_multiple_tokens(
    mocker: MockerFixture,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the OAuth2 endpoint when a second token is added.
    """
    from superset.databases.api import DatabaseRestApi
    from superset.models.core import Database, DatabaseUserOAuth2Tokens

    DatabaseRestApi.datamodel._session = session

    # create table for databases
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member
    db.session.add(
        Database(
            database_name="my_db",
            sqlalchemy_uri="sqlite://",
            uuid=UUID("7c1b7880-a59d-47cd-8bf1-f1eb8d2863cb"),
        )
    )
    db.session.commit()

    mocker.patch.object(
        SqliteEngineSpec,
        "get_oauth2_config",
        return_value={"id": "one", "secret": "two"},
    )
    get_oauth2_token = mocker.patch.object(SqliteEngineSpec, "get_oauth2_token")
    get_oauth2_token.side_effect = [
        {
            "access_token": "YYY",
            "expires_in": 3600,
            "refresh_token": "ZZZ",
        },
        {
            "access_token": "YYY2",
            "expires_in": 3600,
            "refresh_token": "ZZZ2",
        },
    ]

    state: OAuth2State = {
        "user_id": 1,
        "database_id": 1,
        "tab_id": "42",
        "default_redirect_uri": "http://localhost:8088/api/v1/oauth2/",
    }

    mocker.patch("superset.databases.api.render_template", return_value="OK")

    with freeze_time("2024-01-01T00:00:00Z"):
        response = client.get(
            "/api/v1/database/oauth2/",
            query_string={
                "state": encode_oauth2_state(state),
                "code": "XXX",
            },
        )

        # second request should delete token from the first request
        response = client.get(
            "/api/v1/database/oauth2/",
            query_string={
                "state": encode_oauth2_state(state),
                "code": "XXX",
            },
        )

    assert response.status_code == 200
    tokens = db.session.query(DatabaseUserOAuth2Tokens).all()
    assert len(tokens) == 1
    token = tokens[0]
    assert token.access_token == "YYY2"  # noqa: S105
    assert token.refresh_token == "ZZZ2"  # noqa: S105


def test_oauth2_error(
    mocker: MockerFixture,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the OAuth2 endpoint when OAuth2 errors.
    """
    response = client.get(
        "/api/v1/database/oauth2/",
        query_string={
            "error": "Something bad hapened",
        },
    )

    assert response.status_code == 500
    assert response.json == {
        "errors": [
            {
                "message": "Something went wrong while doing OAuth2",
                "error_type": "OAUTH2_REDIRECT_ERROR",
                "level": "error",
                "extra": {"error": "Something bad hapened"},
            }
        ]
    }


@pytest.mark.parametrize(
    "payload,upload_called_with,reader_called_with",
    [
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
            },
            (
                1,
                "table1",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "csv",
                    "already_exists": "fail",
                    "delimiter": ",",
                    "file": ANY,
                    "table_name": "table1",
                },
            ),
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table2",
                "delimiter": ";",
                "already_exists": "replace",
                "column_dates": "col1,col2",
            },
            (
                1,
                "table2",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "csv",
                    "already_exists": "replace",
                    "column_dates": ["col1", "col2"],
                    "delimiter": ";",
                    "file": ANY,
                    "table_name": "table2",
                },
            ),
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table2",
                "delimiter": ";",
                "already_exists": "replace",
                "columns_read": "col1,col2",
                "day_first": True,
                "rows_to_read": "1",
                "skip_blank_lines": True,
                "skip_initial_space": True,
                "skip_rows": "10",
                "null_values": "None,N/A,''",
                "column_data_types": '{"col1": "str"}',
            },
            (
                1,
                "table2",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "csv",
                    "already_exists": "replace",
                    "columns_read": ["col1", "col2"],
                    "null_values": ["None", "N/A", "''"],
                    "day_first": True,
                    "rows_to_read": 1,
                    "skip_blank_lines": True,
                    "skip_initial_space": True,
                    "skip_rows": 10,
                    "delimiter": ";",
                    "file": ANY,
                    "column_data_types": {"col1": "str"},
                    "table_name": "table2",
                },
            ),
        ),
    ],
)
def test_csv_upload(
    payload: dict[str, Any],
    upload_called_with: tuple[int, str, Any, dict[str, Any]],
    reader_called_with: dict[str, Any],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test CSV Upload success.
    """
    init_mock = mocker.patch.object(UploadCommand, "__init__")
    init_mock.return_value = None
    _ = mocker.patch.object(UploadCommand, "run")
    reader_mock = mocker.patch.object(CSVReader, "__init__")
    reader_mock.return_value = None
    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    assert response.json == {"message": "OK"}
    init_mock.assert_called_with(*upload_called_with)
    reader_mock.assert_called_with(*reader_called_with)


@pytest.mark.parametrize(
    "payload,expected_response",
    [
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "delimiter": ",",
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Missing data for required field."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "",
                "delimiter": ",",
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Length must be between 1 and 10000."]}},
        ),
        (
            {
                "type": "csv",
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
            },
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "csv",
                "file": "xpto",
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
            },
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "xpto",
            },
            {"message": {"already_exists": ["Must be one of: fail, replace, append."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "day_first": "test1",
            },
            {"message": {"day_first": ["Not a valid boolean."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "header_row": "test1",
            },
            {"message": {"header_row": ["Not a valid integer."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "rows_to_read": 0,
            },
            {"message": {"rows_to_read": ["Must be greater than or equal to 1."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "skip_blank_lines": "test1",
            },
            {"message": {"skip_blank_lines": ["Not a valid boolean."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "skip_initial_space": "test1",
            },
            {"message": {"skip_initial_space": ["Not a valid boolean."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "skip_rows": "test1",
            },
            {"message": {"skip_rows": ["Not a valid integer."]}},
        ),
        (
            {
                "type": "csv",
                "file": (create_csv_file(), "out.csv"),
                "table_name": "table1",
                "delimiter": ",",
                "already_exists": "fail",
                "column_data_types": "{test:1}",
            },
            {"message": {"_schema": ["Invalid JSON format for column_data_types"]}},
        ),
    ],
)
def test_csv_upload_validation(
    payload: Any,
    expected_response: dict[str, str],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test CSV Upload validation fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")

    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == expected_response


@pytest.mark.parametrize(
    "filename",
    [
        "out.xpto",
        "out.exe",
        "out",
        "out csv",
        "",
        "out.csv.exe",
        ".csv",
        "out.",
        ".",
        "out csv a.exe",
    ],
)
def test_csv_upload_file_extension_invalid(
    filename: str,
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test CSV Upload validation fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")
    response = client.post(
        "/api/v1/database/1/upload/",
        data={
            "type": "csv",
            "file": create_csv_file(filename=filename),
            "table_name": "table1",
            "delimiter": ",",
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


@pytest.mark.parametrize(
    "filename",
    [
        "out.csv",
        "out.txt",
        "out.tsv",
        "spaced name.csv",
        "spaced name.txt",
        "spaced name.tsv",
        "out.exe.csv",
        "out.csv.csv",
    ],
)
def test_csv_upload_file_extension_valid(
    filename: str,
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test CSV Upload validation fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")
    response = client.post(
        "/api/v1/database/1/upload/",
        data={
            "type": "csv",
            "file": create_csv_file(filename=filename),
            "table_name": "table1",
            "delimiter": ",",
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    "payload,upload_called_with,reader_called_with",
    [
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table1",
            },
            (
                1,
                "table1",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "excel",
                    "already_exists": "fail",
                    "file": ANY,
                    "table_name": "table1",
                },
            ),
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table2",
                "sheet_name": "Sheet1",
                "already_exists": "replace",
                "column_dates": "col1,col2",
            },
            (
                1,
                "table2",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "excel",
                    "already_exists": "replace",
                    "column_dates": ["col1", "col2"],
                    "sheet_name": "Sheet1",
                    "file": ANY,
                    "table_name": "table2",
                },
            ),
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table2",
                "sheet_name": "Sheet1",
                "already_exists": "replace",
                "columns_read": "col1,col2",
                "rows_to_read": "1",
                "skip_rows": "10",
                "null_values": "None,N/A,''",
            },
            (
                1,
                "table2",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "excel",
                    "already_exists": "replace",
                    "columns_read": ["col1", "col2"],
                    "null_values": ["None", "N/A", "''"],
                    "rows_to_read": 1,
                    "skip_rows": 10,
                    "sheet_name": "Sheet1",
                    "file": ANY,
                    "table_name": "table2",
                },
            ),
        ),
    ],
)
def test_excel_upload(
    payload: dict[str, Any],
    upload_called_with: tuple[int, str, Any, dict[str, Any]],
    reader_called_with: dict[str, Any],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload success.
    """
    init_mock = mocker.patch.object(UploadCommand, "__init__")
    init_mock.return_value = None
    _ = mocker.patch.object(UploadCommand, "run")
    reader_mock = mocker.patch.object(ExcelReader, "__init__")
    reader_mock.return_value = None
    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    assert response.json == {"message": "OK"}
    init_mock.assert_called_with(*upload_called_with)
    reader_mock.assert_called_with(*reader_called_with)


@pytest.mark.parametrize(
    "payload,expected_response",
    [
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "sheet_name": "Sheet1",
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Missing data for required field."]}},
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "",
                "sheet_name": "Sheet1",
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Length must be between 1 and 10000."]}},
        ),
        (
            {"type": "excel", "table_name": "table1", "already_exists": "fail"},
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "excel",
                "file": "xpto",
                "table_name": "table1",
                "already_exists": "fail",
            },
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table1",
                "already_exists": "xpto",
            },
            {"message": {"already_exists": ["Must be one of: fail, replace, append."]}},
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table1",
                "already_exists": "fail",
                "header_row": "test1",
            },
            {"message": {"header_row": ["Not a valid integer."]}},
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table1",
                "already_exists": "fail",
                "rows_to_read": 0,
            },
            {"message": {"rows_to_read": ["Must be greater than or equal to 1."]}},
        ),
        (
            {
                "type": "excel",
                "file": (create_excel_file(), "out.xls"),
                "table_name": "table1",
                "already_exists": "fail",
                "skip_rows": "test1",
            },
            {"message": {"skip_rows": ["Not a valid integer."]}},
        ),
    ],
)
def test_excel_upload_validation(
    payload: Any,
    expected_response: dict[str, str],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload validation fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")

    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == expected_response


@pytest.mark.parametrize(
    "filename",
    [
        "out.xpto",
        "out.exe",
        "out",
        "out xls",
        "",
        "out.slx.exe",
        ".xls",
        "out.",
        ".",
        "out xls a.exe",
    ],
)
def test_excel_upload_file_extension_invalid(
    filename: str,
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload file extension fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")
    response = client.post(
        "/api/v1/database/1/upload/",
        data={
            "type": "excel",
            "file": create_excel_file(filename=filename),
            "table_name": "table1",
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


@pytest.mark.parametrize(
    "payload,upload_called_with,reader_called_with",
    [
        (
            {
                "type": "columnar",
                "file": (create_columnar_file(), "out.parquet"),
                "table_name": "table1",
            },
            (
                1,
                "table1",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "columnar",
                    "already_exists": "fail",
                    "file": ANY,
                    "table_name": "table1",
                },
            ),
        ),
        (
            {
                "type": "columnar",
                "file": (create_columnar_file(), "out.parquet"),
                "table_name": "table2",
                "already_exists": "replace",
                "columns_read": "col1,col2",
                "dataframe_index": True,
                "index_label": "label",
            },
            (
                1,
                "table2",
                ANY,
                None,
                ANY,
            ),
            (
                {
                    "type": "columnar",
                    "already_exists": "replace",
                    "columns_read": ["col1", "col2"],
                    "file": ANY,
                    "table_name": "table2",
                    "dataframe_index": True,
                    "index_label": "label",
                },
            ),
        ),
    ],
)
def test_columnar_upload(
    payload: dict[str, Any],
    upload_called_with: tuple[int, str, Any, dict[str, Any]],
    reader_called_with: dict[str, Any],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload success.
    """
    init_mock = mocker.patch.object(UploadCommand, "__init__")
    init_mock.return_value = None
    _ = mocker.patch.object(UploadCommand, "run")
    reader_mock = mocker.patch.object(ColumnarReader, "__init__")
    reader_mock.return_value = None
    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    assert response.json == {"message": "OK"}
    init_mock.assert_called_with(*upload_called_with)
    reader_mock.assert_called_with(*reader_called_with)


@pytest.mark.parametrize(
    "payload,expected_response",
    [
        (
            {
                "type": "columnar",
                "file": (create_columnar_file(), "out.parquet"),
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Missing data for required field."]}},
        ),
        (
            {
                "type": "columnar",
                "file": (create_columnar_file(), "out.parquet"),
                "table_name": "",
                "already_exists": "fail",
            },
            {"message": {"table_name": ["Length must be between 1 and 10000."]}},
        ),
        (
            {"type": "columnar", "table_name": "table1", "already_exists": "fail"},
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "columnar",
                "file": "xpto",
                "table_name": "table1",
                "already_exists": "fail",
            },
            {"message": {"file": ["Field may not be null."]}},
        ),
        (
            {
                "type": "columnar",
                "file": (create_columnar_file(), "out.parquet"),
                "table_name": "table1",
                "already_exists": "xpto",
            },
            {"message": {"already_exists": ["Must be one of: fail, replace, append."]}},
        ),
    ],
)
def test_columnar_upload_validation(
    payload: Any,
    expected_response: dict[str, str],
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload validation fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")

    response = client.post(
        "/api/v1/database/1/upload/",
        data=payload,
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == expected_response


@pytest.mark.parametrize(
    "filename",
    [
        "out.parquet",
        "out.zip",
        "out.parquet.zip",
        "out something.parquet",
        "out something.zip",
    ],
)
def test_columnar_upload_file_extension_valid(
    filename: str,
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload file extension fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")
    response = client.post(
        "/api/v1/database/1/upload/",
        data={
            "type": "columnar",
            "file": (create_columnar_file(), filename),
            "table_name": "table1",
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    "filename",
    [
        "out.xpto",
        "out.exe",
        "out",
        "out zip",
        "",
        "out.parquet.exe",
        ".parquet",
        "out.",
        ".",
        "out parquet a.exe",
    ],
)
def test_columnar_upload_file_extension_invalid(
    filename: str,
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test Excel Upload file extension fails.
    """
    _ = mocker.patch.object(UploadCommand, "run")
    response = client.post(
        "/api/v1/database/1/upload/",
        data={
            "type": "columnar",
            "file": create_columnar_file(filename=filename),
            "table_name": "table1",
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


def test_csv_metadata(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(CSVReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "csv", "file": create_csv_file()},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200


def test_csv_metadata_bad_extension(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(CSVReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "csv", "file": create_csv_file(filename="test.out")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


def test_csv_metadata_validation(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(CSVReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "csv"},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["Field may not be null."]}}

    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"file": create_csv_file(filename="test.csv")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"type": ["Missing data for required field."]}}


def test_excel_metadata(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ExcelReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "excel", "file": create_excel_file()},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200


def test_excel_metadata_bad_extension(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ExcelReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "excel", "file": create_excel_file(filename="test.out")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


def test_excel_metadata_validation(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ExcelReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "excel"},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["Field may not be null."]}}


def test_columnar_metadata(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ColumnarReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "columnar", "file": create_columnar_file()},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200


def test_columnar_metadata_bad_extension(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ColumnarReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "columnar", "file": create_columnar_file(filename="test.out")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["File extension is not allowed."]}}


def test_columnar_metadata_validation(
    mocker: MockerFixture, client: Any, full_api_access: None
) -> None:
    _ = mocker.patch.object(ColumnarReader, "file_metadata")
    response = client.post(
        "/api/v1/database/upload_metadata/",
        data={"type": "columnar"},
        content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.json == {"message": {"file": ["Field may not be null."]}}


def test_table_metadata_happy_path(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_metadata` endpoint.
    """
    database = mocker.MagicMock()
    database.db_engine_spec.get_table_metadata.return_value = {"hello": "world"}
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch("superset.databases.api.security_manager.raise_for_access")

    response = client.get("/api/v1/database/1/table_metadata/?name=t")
    assert response.json == {"hello": "world"}
    database.db_engine_spec.get_table_metadata.assert_called_with(
        database,
        Table("t"),
    )

    response = client.get("/api/v1/database/1/table_metadata/?name=t&schema=s")
    database.db_engine_spec.get_table_metadata.assert_called_with(
        database,
        Table("t", "s"),
    )

    response = client.get("/api/v1/database/1/table_metadata/?name=t&catalog=c")
    database.db_engine_spec.get_table_metadata.assert_called_with(
        database,
        Table("t", None, "c"),
    )

    response = client.get(
        "/api/v1/database/1/table_metadata/?name=t&schema=s&catalog=c"
    )
    database.db_engine_spec.get_table_metadata.assert_called_with(
        database,
        Table("t", "s", "c"),
    )


def test_table_metadata_no_table(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_metadata` endpoint when no table name is passed.
    """
    database = mocker.MagicMock()
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    response = client.get("/api/v1/database/1/table_metadata/?schema=s&catalog=c")
    assert response.status_code == 422
    assert response.json == {
        "errors": [
            {
                "message": "An error happened when validating the request",
                "error_type": "INVALID_PAYLOAD_SCHEMA_ERROR",
                "level": "error",
                "extra": {
                    "messages": {"name": ["Missing data for required field."]},
                    "issue_codes": [
                        {
                            "code": 1020,
                            "message": "Issue 1020 - The submitted payload has the incorrect schema.",  # noqa: E501
                        }
                    ],
                },
            }
        ]
    }


def test_table_metadata_slashes(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_metadata` endpoint with names that have slashes.
    """
    database = mocker.MagicMock()
    database.db_engine_spec.get_table_metadata.return_value = {"hello": "world"}
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch("superset.databases.api.security_manager.raise_for_access")

    client.get("/api/v1/database/1/table_metadata/?name=foo/bar")
    database.db_engine_spec.get_table_metadata.assert_called_with(
        database,
        Table("foo/bar"),
    )


def test_table_metadata_invalid_database(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_metadata` endpoint when the database is invalid.
    """
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=None)

    response = client.get("/api/v1/database/1/table_metadata/?name=t")
    assert response.status_code == 404
    assert response.json == {
        "errors": [
            {
                "message": "No such database",
                "error_type": "DATABASE_NOT_FOUND_ERROR",
                "level": "error",
                "extra": {
                    "issue_codes": [
                        {
                            "code": 1011,
                            "message": "Issue 1011 - Superset encountered an unexpected error.",  # noqa: E501
                        },
                        {
                            "code": 1036,
                            "message": "Issue 1036 - The database was deleted.",
                        },
                    ]
                },
            }
        ]
    }


def test_table_metadata_unauthorized(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_metadata` endpoint when the user is unauthorized.
    """
    database = mocker.MagicMock()
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch(
        "superset.databases.api.security_manager.raise_for_access",
        side_effect=SupersetSecurityException(
            SupersetError(
                error_type=SupersetErrorType.TABLE_SECURITY_ACCESS_ERROR,
                message="You don't have access to the table",
                level=ErrorLevel.ERROR,
            )
        ),
    )

    response = client.get("/api/v1/database/1/table_metadata/?name=t")
    assert response.status_code == 404
    assert response.json == {
        "errors": [
            {
                "message": "No such table",
                "error_type": "TABLE_NOT_FOUND_ERROR",
                "level": "error",
                "extra": None,
            }
        ]
    }


def test_table_extra_metadata_happy_path(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_extra_metadata` endpoint.
    """
    database = mocker.MagicMock()
    database.db_engine_spec.get_extra_table_metadata.return_value = {"hello": "world"}
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch("superset.databases.api.security_manager.raise_for_access")

    response = client.get("/api/v1/database/1/table_metadata/extra/?name=t")
    assert response.json == {"hello": "world"}
    database.db_engine_spec.get_extra_table_metadata.assert_called_with(
        database,
        Table("t"),
    )

    response = client.get("/api/v1/database/1/table_metadata/extra/?name=t&schema=s")
    database.db_engine_spec.get_extra_table_metadata.assert_called_with(
        database,
        Table("t", "s"),
    )

    response = client.get("/api/v1/database/1/table_metadata/extra/?name=t&catalog=c")
    database.db_engine_spec.get_extra_table_metadata.assert_called_with(
        database,
        Table("t", None, "c"),
    )

    response = client.get(
        "/api/v1/database/1/table_metadata/extra/?name=t&schema=s&catalog=c"
    )
    database.db_engine_spec.get_extra_table_metadata.assert_called_with(
        database,
        Table("t", "s", "c"),
    )


def test_table_extra_metadata_no_table(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_extra_metadata` endpoint when no table name is passed.
    """
    database = mocker.MagicMock()
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    response = client.get("/api/v1/database/1/table_metadata/extra/?schema=s&catalog=c")
    assert response.status_code == 422
    assert response.json == {
        "errors": [
            {
                "message": "An error happened when validating the request",
                "error_type": "INVALID_PAYLOAD_SCHEMA_ERROR",
                "level": "error",
                "extra": {
                    "messages": {"name": ["Missing data for required field."]},
                    "issue_codes": [
                        {
                            "code": 1020,
                            "message": "Issue 1020 - The submitted payload has the incorrect schema.",  # noqa: E501
                        }
                    ],
                },
            }
        ]
    }


def test_table_extra_metadata_slashes(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_extra_metadata` endpoint with names that have slashes.
    """
    database = mocker.MagicMock()
    database.db_engine_spec.get_extra_table_metadata.return_value = {"hello": "world"}
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch("superset.databases.api.security_manager.raise_for_access")

    client.get("/api/v1/database/1/table_metadata/extra/?name=foo/bar")
    database.db_engine_spec.get_extra_table_metadata.assert_called_with(
        database,
        Table("foo/bar"),
    )


def test_table_extra_metadata_invalid_database(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_extra_metadata` endpoint when the database is invalid.
    """
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=None)

    response = client.get("/api/v1/database/1/table_metadata/extra/?name=t")
    assert response.status_code == 404
    assert response.json == {
        "errors": [
            {
                "message": "No such database",
                "error_type": "DATABASE_NOT_FOUND_ERROR",
                "level": "error",
                "extra": {
                    "issue_codes": [
                        {
                            "code": 1011,
                            "message": "Issue 1011 - Superset encountered an unexpected error.",  # noqa: E501
                        },
                        {
                            "code": 1036,
                            "message": "Issue 1036 - The database was deleted.",
                        },
                    ]
                },
            }
        ]
    }


def test_table_extra_metadata_unauthorized(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `table_extra_metadata` endpoint when the user is unauthorized.
    """
    database = mocker.MagicMock()
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch(
        "superset.databases.api.security_manager.raise_for_access",
        side_effect=SupersetSecurityException(
            SupersetError(
                error_type=SupersetErrorType.TABLE_SECURITY_ACCESS_ERROR,
                message="You don't have access to the table",
                level=ErrorLevel.ERROR,
            )
        ),
    )

    response = client.get("/api/v1/database/1/table_metadata/extra/?name=t")
    assert response.status_code == 404
    assert response.json == {
        "errors": [
            {
                "message": "No such table",
                "error_type": "TABLE_NOT_FOUND_ERROR",
                "level": "error",
                "extra": None,
            }
        ]
    }


def test_catalogs(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `catalogs` endpoint.
    """
    database = mocker.MagicMock()
    database.get_all_catalog_names.return_value = {"db1", "db2"}
    DatabaseDAO = mocker.patch("superset.databases.api.DatabaseDAO")  # noqa: N806
    DatabaseDAO.find_by_id.return_value = database

    security_manager = mocker.patch(
        "superset.databases.api.security_manager",
        new=mocker.MagicMock(),
    )
    security_manager.get_catalogs_accessible_by_user.return_value = {"db2"}

    response = client.get("/api/v1/database/1/catalogs/")
    assert response.status_code == 200
    assert response.json == {"result": ["db2"]}
    database.get_all_catalog_names.assert_called_with(
        cache=database.catalog_cache_enabled,
        cache_timeout=database.catalog_cache_timeout,
        force=False,
    )
    security_manager.get_catalogs_accessible_by_user.assert_called_with(
        database,
        {"db1", "db2"},
    )

    response = client.get("/api/v1/database/1/catalogs/?q=(force:!t)")
    database.get_all_catalog_names.assert_called_with(
        cache=database.catalog_cache_enabled,
        cache_timeout=database.catalog_cache_timeout,
        force=True,
    )


def test_catalogs_with_oauth2(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `catalogs` endpoint when OAuth2 is needed.
    """
    database = mocker.MagicMock()
    database.get_all_catalog_names.side_effect = OAuth2RedirectError(
        "url",
        "tab_id",
        "redirect_uri",
    )
    DatabaseDAO = mocker.patch("superset.databases.api.DatabaseDAO")  # noqa: N806
    DatabaseDAO.find_by_id.return_value = database

    security_manager = mocker.patch(
        "superset.databases.api.security_manager",
        new=mocker.MagicMock(),
    )
    security_manager.get_catalogs_accessible_by_user.return_value = {"db2"}

    response = client.get("/api/v1/database/1/catalogs/")
    assert response.status_code == 500
    assert response.json == {
        "errors": [
            {
                "message": "You don't have permission to access the data.",
                "error_type": "OAUTH2_REDIRECT",
                "level": "warning",
                "extra": {
                    "url": "url",
                    "tab_id": "tab_id",
                    "redirect_uri": "redirect_uri",
                },
            }
        ]
    }


def test_schemas(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `schemas` endpoint.
    """
    from superset.databases.api import DatabaseRestApi

    database = mocker.MagicMock()
    database.get_all_schema_names.return_value = {"schema1", "schema2"}
    datamodel = mocker.patch.object(DatabaseRestApi, "datamodel")
    datamodel.get.return_value = database

    security_manager = mocker.patch(
        "superset.databases.api.security_manager",
        new=mocker.MagicMock(),
    )
    security_manager.get_schemas_accessible_by_user.return_value = {"schema2"}

    response = client.get("/api/v1/database/1/schemas/")
    assert response.status_code == 200
    assert response.json == {"result": ["schema2"]}
    database.get_all_schema_names.assert_called_with(
        catalog=None,
        cache=database.schema_cache_enabled,
        cache_timeout=database.schema_cache_timeout,
        force=False,
    )
    security_manager.get_schemas_accessible_by_user.assert_called_with(
        database,
        None,
        {"schema1", "schema2"},
    )

    response = client.get("/api/v1/database/1/schemas/?q=(force:!t)")
    database.get_all_schema_names.assert_called_with(
        catalog=None,
        cache=database.schema_cache_enabled,
        cache_timeout=database.schema_cache_timeout,
        force=True,
    )

    response = client.get("/api/v1/database/1/schemas/?q=(force:!t,catalog:catalog2)")
    database.get_all_schema_names.assert_called_with(
        catalog="catalog2",
        cache=database.schema_cache_enabled,
        cache_timeout=database.schema_cache_timeout,
        force=True,
    )
    security_manager.get_schemas_accessible_by_user.assert_called_with(
        database,
        "catalog2",
        {"schema1", "schema2"},
    )


def test_schemas_with_oauth2(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test the `schemas` endpoint when OAuth2 is needed.
    """
    from superset.databases.api import DatabaseRestApi

    database = mocker.MagicMock()
    database.get_all_schema_names.side_effect = OAuth2RedirectError(
        "url",
        "tab_id",
        "redirect_uri",
    )
    datamodel = mocker.patch.object(DatabaseRestApi, "datamodel")
    datamodel.get.return_value = database

    security_manager = mocker.patch(
        "superset.databases.api.security_manager",
        new=mocker.MagicMock(),
    )
    security_manager.get_schemas_accessible_by_user.return_value = {"schema2"}

    response = client.get("/api/v1/database/1/schemas/")
    assert response.status_code == 500
    assert response.json == {
        "errors": [
            {
                "message": "You don't have permission to access the data.",
                "error_type": "OAUTH2_REDIRECT",
                "level": "warning",
                "extra": {
                    "url": "url",
                    "tab_id": "tab_id",
                    "redirect_uri": "redirect_uri",
                },
            }
        ]
    }


def test_dataset_sources_endpoint_filters_internal_connections(
    mocker: MockerFixture,
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    from superset.models.core import Database

    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member
    db.session.add_all(
        [
            Database(
                database_name="Analytics Warehouse",
                sqlalchemy_uri="sqlite://",
            ),
            Database(
                database_name="DHIS2 Serving (ClickHouse)",
                sqlalchemy_uri="sqlite://",
                extra=json.dumps({"dhis2_staging_internal": True}),
            ),
            Database(
                database_name="DHIS2 Local Staging",
                sqlalchemy_uri="sqlite://",
            ),
            Database(
                database_name="Explicit Internal Source",
                sqlalchemy_uri="sqlite://",
                extra=json.dumps(
                    {
                        "dhis2_staging_internal": True,
                        "is_dataset_source": True,
                    }
                ),
            ),
        ]
    )
    db.session.commit()

    mocker.patch(
        "superset.dhis2.dataset_source_service.security_manager.can_access_database",
        return_value=True,
    )

    response = client.get("/api/v1/database/dataset_sources/")

    assert response.status_code == 200
    assert [item["database_name"] for item in response.json["result"]] == [
        "Analytics Warehouse",
        "Explicit Internal Source",
    ]


def test_dhis2_metadata_federated_aggregates_configured_connections(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    instance_one = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={"Authorization": "Basic abc"},
    )
    instance_two = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={"Authorization": "ApiToken xyz"},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance_one, instance_two],
    )

    response_one = Mock(status_code=200, text="OK")
    response_one.json.return_value = {
        "dataElements": [{"id": "de1", "displayName": "ANC Visits"}]
    }
    response_two = Mock(status_code=200, text="OK")
    response_two.json.return_value = {
        "dataElements": [{"id": "de2", "displayName": "Malaria Cases"}]
    }
    requests_get = mocker.patch("superset.databases.api.requests.get")
    requests_get.side_effect = [response_one, response_two]

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/?type=dataElements&federated=true"
    )

    assert response.status_code == 200
    assert response.json["status"] == "success"
    assert response.json["instance_results"] == [
        {
            "count": 1,
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
        },
        {
            "count": 1,
            "id": 102,
            "name": "Non Routine DHIS2",
            "status": "success",
        },
    ]
    assert response.json["result"] == [
        {
            "displayName": "ANC Visits",
            "id": "de1",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
        },
        {
            "displayName": "Malaria Cases",
            "id": "de2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 102,
            "source_instance_name": "Non Routine DHIS2",
        },
    ]


def test_dhis2_metadata_federated_returns_partial_results(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    healthy_instance = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    failing_instance = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[healthy_instance, failing_instance],
    )

    success_response = Mock(status_code=200, text="OK")
    success_response.json.return_value = {
        "dataElements": [{"id": "de1", "displayName": "ANC Visits"}]
    }
    failure_response = Mock(
        status_code=503,
        text="Gateway timeout",
    )
    requests_get = mocker.patch("superset.databases.api.requests.get")
    requests_get.side_effect = [success_response, failure_response]

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/?type=dataElements&federated=true"
    )

    assert response.status_code == 200
    assert response.json["status"] == "partial"
    assert response.json["message"] == (
        "Some configured DHIS2 connections could not be loaded."
    )
    assert response.json["result"] == [
        {
            "displayName": "ANC Visits",
            "id": "de1",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
        }
    ]
    assert response.json["instance_results"] == [
        {
            "count": 1,
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
        },
        {
            "count": 0,
            "error": "DHIS2 API error: 503 Gateway timeout",
            "id": 102,
            "name": "Non Routine DHIS2",
            "status": "failed",
        },
    ]


def test_dhis2_org_unit_levels_federated_aggregates_configured_connections(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    instance_one = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    instance_two = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance_one, instance_two],
    )

    response_one = Mock(status_code=200, text="OK")
    response_one.json.return_value = {
        "organisationUnitLevels": [
            {"level": 1, "displayName": "National"},
            {"level": 2, "displayName": "Region"},
        ]
    }
    response_two = Mock(status_code=200, text="OK")
    response_two.json.return_value = {
        "organisationUnitLevels": [
            {"level": 2, "displayName": "Region"},
            {"level": 3, "displayName": "District"},
        ]
    }
    requests_get = mocker.patch("superset.databases.api.requests.get")
    requests_get.side_effect = [response_one, response_two]

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/?type=organisationUnitLevels"
        "&federated=true&instance_ids=101&instance_ids=102"
    )

    assert response.status_code == 200
    assert response.json["status"] == "success"
    assert response.json["result"] == [
        {
            "displayName": "National",
            "instance_level_names": {"101": "National"},
            "level": 1,
            "name": None,
            "source_instance_id": 101,
            "source_instance_ids": [101],
            "source_instance_name": "National eHMIS DHIS2",
            "source_instance_names": ["National eHMIS DHIS2"],
        },
        {
            "displayName": "Region",
            "instance_level_names": {
                "101": "Region",
                "102": "Region",
            },
            "level": 2,
            "name": None,
            "source_instance_ids": [101, 102],
            "source_instance_names": [
                "National eHMIS DHIS2",
                "Non Routine DHIS2",
            ],
        },
        {
            "displayName": "District",
            "instance_level_names": {"102": "District"},
            "level": 3,
            "name": None,
            "source_instance_id": 102,
            "source_instance_ids": [102],
            "source_instance_name": "Non Routine DHIS2",
            "source_instance_names": ["Non Routine DHIS2"],
        },
    ]
    assert response.json["instance_results"] == [
        {
            "count": 2,
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
        },
        {
            "count": 2,
            "id": 102,
            "name": "Non Routine DHIS2",
            "status": "success",
        },
    ]


def test_dhis2_org_unit_groups_federated_returns_partial_results(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    healthy_instance = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    failing_instance = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[healthy_instance, failing_instance],
    )

    success_response = Mock(status_code=200, text="OK")
    success_response.json.return_value = {
        "organisationUnitGroups": [
            {
                "id": "oug1",
                "displayName": "Referral facilities",
                "organisationUnits": [
                    {"id": "ou1", "displayName": "Mulago"},
                ],
            }
        ]
    }
    failure_response = Mock(status_code=503, text="Gateway timeout")
    requests_get = mocker.patch("superset.databases.api.requests.get")
    requests_get.side_effect = [success_response, failure_response]

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/?type=organisationUnitGroups&federated=true"
    )

    assert response.status_code == 200
    assert response.json["status"] == "partial"
    assert response.json["message"] == (
        "Some configured DHIS2 connections could not be loaded."
    )
    assert response.json["result"] == [
        {
            "displayName": "Referral facilities",
            "id": "oug1",
            "organisationUnits": [
                {"displayName": "Mulago", "id": "ou1"},
            ],
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
        }
    ]
    assert response.json["instance_results"] == [
        {
            "count": 1,
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
        },
        {
            "count": 0,
            "error": "DHIS2 API error: 503 Gateway timeout",
            "id": 102,
            "name": "Non Routine DHIS2",
            "status": "failed",
        },
    ]


def test_dhis2_metadata_returns_cached_payload_without_fetching_source(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value={
            "result": [{"id": "de_cached", "displayName": "Cached ANC Visits"}],
            "cached": True,
            "cache_refreshed_at": "2026-03-13T09:00:00",
        },
    )
    requests_get = mocker.patch("superset.databases.api.requests.get")

    response = client.get("/api/v1/database/9/dhis2_metadata/?type=dataElements")

    assert response.status_code == 200
    assert response.json["result"] == [
        {"id": "de_cached", "displayName": "Cached ANC Visits"}
    ]
    assert response.json["cached"] is True
    requests_get.assert_not_called()


def test_dhis2_metadata_staged_reads_from_local_snapshots_without_live_fetch(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    instance_one = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    instance_two = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance_one, instance_two],
    )
    cached_payloads = iter(
        [
            None,
            {
                "status": "success",
                "result": [
                    {
                        "id": "de1",
                        "displayName": "ANC Visits",
                        "domainType": "AGGREGATE",
                        "valueType": "NUMBER",
                        "aggregationType": "SUM",
                    }
                ],
            },
            {
                "status": "success",
                "result": [
                    {
                        "id": "de2",
                        "displayName": "Malaria Cases",
                        "domainType": "AGGREGATE",
                        "valueType": "INTEGER",
                        "aggregationType": "SUM",
                    }
                ],
            },
        ]
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        side_effect=lambda *_args, **_kwargs: next(cached_payloads),
    )
    schedule_refresh = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )
    requests_get = mocker.patch("superset.databases.api.requests.get")

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/"
        "?type=dataElements&federated=true&staged=true&instance_ids=101&instance_ids=102"
    )

    assert response.status_code == 200
    assert response.json["status"] == "success"
    assert response.json["result"] == [
        {
            "aggregationType": "SUM",
            "displayName": "ANC Visits",
            "domainType": "AGGREGATE",
            "id": "de1",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
            "valueType": "NUMBER",
        },
        {
            "aggregationType": "SUM",
            "displayName": "Malaria Cases",
            "domainType": "AGGREGATE",
            "id": "de2",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 102,
            "source_instance_name": "Non Routine DHIS2",
            "valueType": "INTEGER",
        },
    ]
    schedule_refresh.assert_not_called()
    requests_get.assert_not_called()


def test_dhis2_metadata_staged_returns_pending_when_snapshot_is_missing(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    instance_one = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[instance_one],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value=None,
    )
    schedule_refresh = mocker.patch(
        "superset.dhis2.metadata_staging_service.schedule_database_metadata_refresh"
    )
    requests_get = mocker.patch("superset.databases.api.requests.get")

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/"
        "?type=dataElements&federated=true&staged=true&instance_ids=101"
    )

    assert response.status_code == 200
    assert response.json["status"] == "pending"
    assert response.json["result"] == []
    assert "prepared in local staging" in response.json["message"]
    assert response.json["instance_results"] == [
        {
            "count": 0,
            "error": "Metadata snapshot not ready yet.",
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "pending",
        }
    ]
    schedule_refresh.assert_called_once()
    requests_get.assert_not_called()


def test_dhis2_metadata_staged_forwards_advanced_filters_and_pagination(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    staged_payload = mocker.patch(
        "superset.dhis2.metadata_staging_service.get_staged_metadata_payload",
        return_value={
            "status": "success",
            "result": [],
            "instance_results": [],
            "message": None,
            "staged": True,
            "pagination": {
                "page": 2,
                "page_size": 50,
                "total": 0,
                "total_pages": 1,
                "has_next": False,
                "has_previous": True,
            },
        },
    )

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/"
        "?type=indicators&federated=true&staged=true&instance_ids=101"
        "&groupId=grp_1&groupSetId=gs_1&indicatorTypeId=ity_1"
        "&valueType=PERCENTAGE&page=2&page_size=50"
    )

    assert response.status_code == 200
    staged_payload.assert_called_once_with(
        database=database,
        metadata_type="indicators",
        instance_id=None,
        requested_instance_ids=[101],
        federated=True,
        table_name=None,
        search_term="",
        level=None,
        parent_ids=[],
        domain_type=None,
        value_type="PERCENTAGE",
        aggregation_type=None,
        form_type=None,
        program_id=None,
        program_stage_id=None,
        indicator_type_id="ity_1",
        analytics_type=None,
        group_id="grp_1",
        group_set_id="gs_1",
        group_search="",
        org_unit_source_mode="federated",
        page=2,
        page_size=50,
    )
    assert response.json["pagination"]["page"] == 2


def test_dhis2_org_units_primary_instance_scope_uses_only_primary_connection(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)

    class _Instance(SimpleNamespace):
        def get_auth_headers(self) -> dict[str, str]:
            return self.headers

    primary_instance = _Instance(
        id=101,
        database_id=9,
        name="National eHMIS DHIS2",
        url="https://national.example.org",
        headers={},
    )
    secondary_instance = _Instance(
        id=102,
        database_id=9,
        name="Non Routine DHIS2",
        url="https://non-routine.example.org",
        headers={},
    )
    mocker.patch(
        "superset.dhis2.instance_service.get_instances_with_legacy_fallback",
        return_value=[primary_instance, secondary_instance],
    )
    mocker.patch(
        "superset.staging.metadata_cache_service.get_cached_metadata_payload",
        return_value=None,
    )
    cache_store = mocker.patch(
        "superset.staging.metadata_cache_service.set_cached_metadata_payload",
        side_effect=lambda *_args, **_kwargs: {
            "result": [
                {
                    "id": "OU_1",
                    "displayName": "Uganda",
                    "source_instance_id": 101,
                    "source_instance_name": "National eHMIS DHIS2",
                    "source_database_id": 9,
                    "source_database_name": "Malaria Repository Multiple Sources",
                }
            ],
            "status": "success",
            "instance_results": [
                {
                    "id": 101,
                    "name": "National eHMIS DHIS2",
                    "status": "success",
                    "count": 1,
                }
            ],
            "cached": False,
            "cache_refreshed_at": "2026-03-13T10:00:00",
        },
    )

    response_payload = Mock(status_code=200, text="OK")
    response_payload.json.return_value = {
        "organisationUnits": [{"id": "OU_1", "displayName": "Uganda"}]
    }
    requests_get = mocker.patch("superset.databases.api.requests.get")
    requests_get.return_value = response_payload

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/"
        "?type=organisationUnits&instance_ids=101&instance_ids=102"
        "&org_unit_source_mode=primary&primary_instance_id=101"
    )

    assert response.status_code == 200
    assert response.json["status"] == "success"
    assert response.json["instance_results"] == [
        {
            "count": 1,
            "id": 101,
            "name": "National eHMIS DHIS2",
            "status": "success",
        }
    ]
    assert response.json["result"] == [
        {
            "displayName": "Uganda",
            "id": "OU_1",
            "source_database_id": 9,
            "source_database_name": "Malaria Repository Multiple Sources",
            "source_instance_id": 101,
            "source_instance_name": "National eHMIS DHIS2",
        }
    ]
    assert requests_get.call_count == 1
    cache_store.assert_called_once()


def test_dhis2_geojson_staged_uses_local_boundary_snapshots(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    mocker.patch("superset.databases.api.DatabaseDAO.find_by_id", return_value=database)
    get_staged_geo_payload = mocker.patch(
        "superset.dhis2.metadata_staging_service.get_staged_geo_payload",
        return_value={
            "status": "success",
            "result": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "OU_1",
                        "geometry": {"type": "Polygon", "coordinates": [[[32.5, 0.3]]]},
                        "properties": {"id": "OU_1", "name": "Kampala", "level": 2},
                    }
                ],
            },
            "instance_results": [
                {
                    "id": 101,
                    "name": "National eHMIS DHIS2",
                    "status": "success",
                    "count": 1,
                }
            ],
            "staged": True,
            "count": 1,
        },
    )

    response = client.get(
        "/api/v1/database/9/dhis2_metadata/"
        "?type=geoJSON&levels=2&parents=ROOT&staged=true&federated=true"
    )

    assert response.status_code == 200
    assert response.json["status"] == "success"
    assert response.json["result"]["features"][0]["id"] == "OU_1"
    get_staged_geo_payload.assert_called_once_with(
        database=database,
        metadata_type="geoJSON",
        instance_id=None,
        requested_instance_ids=[],
        federated=True,
        levels=["2"],
        parent_ids=["ROOT"],
        allow_live_fallback=True,
    )


def test_resolve_dhis2_database_from_chart_context_prefers_source_database(
    mocker: MockerFixture,
) -> None:
    from superset.databases.api import DatabaseRestApi

    serving_database = SimpleNamespace(id=3, backend="sqlite")
    source_database = SimpleNamespace(id=9, backend="dhis2")
    chart = SimpleNamespace(
        datasource=SimpleNamespace(
            extra=json.dumps({"dhis2_source_database_id": 9}),
            database=serving_database,
        )
    )
    find_by_id = mocker.patch(
        "superset.databases.api.DatabaseDAO.find_by_id",
        return_value=source_database,
    )

    resolved_database = DatabaseRestApi._resolve_dhis2_database_from_chart_context(
        database=serving_database,
        chart=chart,
    )

    assert resolved_database is source_database
    find_by_id.assert_called_once_with(9)


def test_resolve_dhis2_instance_ids_from_chart_context_prefers_source_instances(
    mocker: MockerFixture,
) -> None:
    from superset.databases.api import DatabaseRestApi

    chart = SimpleNamespace(
        datasource=SimpleNamespace(
            extra=json.dumps(
                {
                    "dhis2_source_instance_ids": [101, "102", 101, "bad"],
                    "configured_connection_ids": [999],
                }
            ),
        )
    )

    resolved_instance_ids = (
        DatabaseRestApi._resolve_dhis2_instance_ids_from_chart_context(chart)
    )

    assert resolved_instance_ids == [101, 102]


def test_resolve_public_dhis2_chart_allows_guest_access_via_linked_dashboard(
    app: Any,
    mocker: MockerFixture,
) -> None:
    from superset.databases.api import DatabaseRestApi

    chart_dashboard = SimpleNamespace(id=33)
    chart = SimpleNamespace(
        id=9,
        is_public=False,
        dashboards=[chart_dashboard],
    )
    query = mocker.Mock()
    query.filter.return_value.one_or_none.return_value = chart
    mocker.patch("superset.databases.api.db.session.query", return_value=query)
    mocker.patch("superset.databases.api.security_manager.is_guest_user", return_value=True)
    has_guest_access = mocker.patch(
        "superset.databases.api.security_manager.has_guest_access",
        side_effect=lambda dashboard: dashboard is chart_dashboard,
    )

    with app.test_request_context(
        "/api/v1/database/1/dhis2_metadata_public/?slice_id=9"
    ):
        resolved_chart = DatabaseRestApi()._resolve_public_dhis2_chart()

    assert resolved_chart is chart
    has_guest_access.assert_called_once_with(chart_dashboard)


def test_dhis2_metadata_resolves_source_context_for_staged_local_chart(
    mocker: MockerFixture,
    client: Any,
    full_api_access: None,
) -> None:
    from superset.databases.api import DatabaseRestApi

    serving_database = SimpleNamespace(id=3, backend="sqlite")
    source_database = SimpleNamespace(
        id=9,
        backend="dhis2",
        database_name="Malaria Repository Multiple Sources",
    )
    chart = SimpleNamespace(
        datasource=SimpleNamespace(
            extra=json.dumps(
                {
                    "dhis2_source_database_id": 9,
                    "dhis2_source_instance_ids": [101, 102],
                }
            ),
            database=serving_database,
        )
    )
    mocker.patch(
        "superset.databases.api.DatabaseDAO.find_by_id",
        side_effect=[serving_database, source_database],
    )
    mocker.patch.object(
        DatabaseRestApi,
        "_resolve_authenticated_dhis2_chart",
        return_value=chart,
    )
    get_staged_geo_payload = mocker.patch(
        "superset.dhis2.metadata_staging_service.get_staged_geo_payload",
        return_value={
            "status": "success",
            "result": {"type": "FeatureCollection", "features": []},
            "instance_results": [],
            "staged": True,
            "count": 0,
        },
    )

    response = client.get(
        "/api/v1/database/3/dhis2_metadata/"
        "?type=geoJSON&levels=3&parents=&staged=true&slice_id=2"
    )

    assert response.status_code == 200
    get_staged_geo_payload.assert_called_once_with(
        database=source_database,
        metadata_type="geoJSON",
        instance_id=None,
        requested_instance_ids=[101, 102],
        federated=False,
        levels=["3"],
        parent_ids=[],
        allow_live_fallback=True,
    )
