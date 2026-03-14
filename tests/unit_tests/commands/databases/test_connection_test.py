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

import pytest
from pytest_mock import MockerFixture

from superset.commands.database.exceptions import DatabaseTestConnectionFailedError
from superset.commands.database.test_connection import TestConnectionDatabaseCommand
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from superset.exceptions import OAuth2RedirectError


def test_command(mocker: MockerFixture) -> None:
    """
    Test the happy path of the command.
    """
    user = mocker.MagicMock()
    user.email = "alice@example.org"
    mocker.patch("superset.db_engine_specs.gsheets.g", user=user)
    mocker.patch("superset.db_engine_specs.gsheets.create_engine")

    database = mocker.MagicMock()
    database.db_engine_spec.__name__ = "GSheetsEngineSpec"
    with database.get_sqla_engine() as engine:
        engine.dialect.do_ping.return_value = True

    DatabaseDAO = mocker.patch("superset.commands.database.test_connection.DatabaseDAO")  # noqa: N806
    DatabaseDAO.build_db_for_connection_test.return_value = database

    properties = {
        "sqlalchemy_uri": "gsheets://",
        "engine": "gsheets",
        "driver": "gsheets",
        "catalog": {"test": "https://example.org/"},
    }
    command = TestConnectionDatabaseCommand(properties)
    command.run()


def test_command_with_oauth2(mocker: MockerFixture) -> None:
    """
    Test the command when OAuth2 is needed.
    """
    user = mocker.MagicMock()
    user.email = "alice@example.org"
    mocker.patch("superset.db_engine_specs.gsheets.g", user=user)
    mocker.patch("superset.db_engine_specs.gsheets.create_engine")

    database = mocker.MagicMock()
    database.is_oauth2_enabled.return_value = True
    database.db_engine_spec.needs_oauth2.return_value = True
    database.start_oauth2_dance.side_effect = OAuth2RedirectError(
        "url",
        "tab_id",
        "redirect_uri",
    )
    database.db_engine_spec.__name__ = "GSheetsEngineSpec"
    with database.get_sqla_engine() as engine:
        engine.dialect.do_ping.side_effect = Exception("OAuth2 needed")

    DatabaseDAO = mocker.patch("superset.commands.database.test_connection.DatabaseDAO")  # noqa: N806
    DatabaseDAO.build_db_for_connection_test.return_value = database

    properties = {
        "sqlalchemy_uri": "gsheets://",
        "engine": "gsheets",
        "driver": "gsheets",
        "catalog": {"test": "https://example.org/"},
    }
    command = TestConnectionDatabaseCommand(properties)
    with pytest.raises(OAuth2RedirectError) as excinfo:
        command.run()
    assert excinfo.value.error == SupersetError(
        message="You don't have permission to access the data.",
        error_type=SupersetErrorType.OAUTH2_REDIRECT,
        level=ErrorLevel.WARNING,
        extra={"url": "url", "tab_id": "tab_id", "redirect_uri": "redirect_uri"},
    )


def test_dhis2_command_uses_engine_specific_connection_probe(
    mocker: MockerFixture,
) -> None:
    database = mocker.MagicMock()
    database.db_engine_spec.__name__ = "DHIS2EngineSpec"
    database.db_engine_spec.test_connection.return_value = True

    DatabaseDAO = mocker.patch(  # noqa: N806
        "superset.commands.database.test_connection.DatabaseDAO"
    )
    DatabaseDAO.build_db_for_connection_test.return_value = database

    properties = {
        "sqlalchemy_uri": "dhis2://admin:district@play.im.dhis2.org/stable-2-42-4/api",
    }

    TestConnectionDatabaseCommand(properties).run()

    database.db_engine_spec.test_connection.assert_called_once_with(database)
    database.get_sqla_engine.assert_not_called()


def test_dhis2_shell_command_skips_live_connection_probe(
    mocker: MockerFixture,
) -> None:
    DatabaseDAO = mocker.patch(  # noqa: N806
        "superset.commands.database.test_connection.DatabaseDAO"
    )

    properties = {
        "engine": "dhis2",
        "driver": "dhis2",
        "sqlalchemy_uri": "dhis2://",
        "parameters": {},
    }

    TestConnectionDatabaseCommand(properties).run()

    DatabaseDAO.build_db_for_connection_test.assert_not_called()


def test_dhis2_shell_uri_command_skips_live_connection_probe(
    mocker: MockerFixture,
) -> None:
    DatabaseDAO = mocker.patch(  # noqa: N806
        "superset.commands.database.test_connection.DatabaseDAO"
    )

    properties = {
        "sqlalchemy_uri": "dhis2://",
    }

    TestConnectionDatabaseCommand(properties).run()

    DatabaseDAO.build_db_for_connection_test.assert_not_called()


def test_dhis2_command_returns_clean_connection_failure(
    mocker: MockerFixture,
) -> None:
    database = mocker.MagicMock()
    database.db_engine_spec.__name__ = "DHIS2EngineSpec"
    database.unique_name = "Malaria Repository"
    database.db_engine_spec.test_connection.side_effect = Exception(
        "Connection test failed: Authentication failed. Please check your credentials."
    )
    database.db_engine_spec.extract_errors.return_value = [
        SupersetError(
            message="Authentication failed. Please check your credentials.",
            error_type=SupersetErrorType.GENERIC_DB_ENGINE_ERROR,
            level=ErrorLevel.ERROR,
            extra={"engine_name": "DHIS2"},
        )
    ]

    DatabaseDAO = mocker.patch(  # noqa: N806
        "superset.commands.database.test_connection.DatabaseDAO"
    )
    DatabaseDAO.build_db_for_connection_test.return_value = database

    properties = {
        "sqlalchemy_uri": "dhis2://admin:district@play.im.dhis2.org/stable-2-42-4/api",
    }

    with pytest.raises(DatabaseTestConnectionFailedError) as excinfo:
        TestConnectionDatabaseCommand(properties).run()

    assert excinfo.value.errors == [
        SupersetError(
            message="Authentication failed. Please check your credentials.",
            error_type=SupersetErrorType.GENERIC_DB_ENGINE_ERROR,
            level=ErrorLevel.ERROR,
            extra={"engine_name": "DHIS2"},
        )
    ]
